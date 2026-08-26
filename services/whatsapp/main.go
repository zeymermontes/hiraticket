// Hiraticket — WhatsApp worker (whatsmeow, Go, multi-tenant).
//
// Connects each business's own WhatsApp number via whatsmeow (WebSocket
// multi-device, no browser) and bridges it to the app's Postgres (Supabase).
//
//   - whatsmeow device sessions are stored IN Postgres (sqlstore) — no disk.
//   - `whatsapp_sessions` rows drive connect/QR/pairing + status.
//   - inbound messages  -> contacts / conversations / messages
//   - outbound (queued)  -> sent over WhatsApp, flipped to 'sent'
//
// Unofficial (WhatsApp Web linked device) — same ban risk as any linked device.
//
// Env: DATABASE_URL (Supabase direct Postgres connection string, sslmode=require).
package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	_ "time/tzdata" // embed the IANA tz database so business timezones resolve on distroless

	"github.com/lib/pq"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
)

var nonDigits = regexp.MustCompile(`[^0-9]`)

func digits(s string) string { return nonDigits.ReplaceAllString(s, "") }

type session struct {
	ID         string
	BusinessID string
	Status     string
	Method     string
	Phone      sql.NullString
	DeviceJID  sql.NullString
}

type Manager struct {
	db        *sql.DB
	container *sqlstore.Container
	log       waLog.Logger
	mu        sync.Mutex
	clients   map[string]*whatsmeow.Client // sessionID -> client
	byBiz     map[string]*whatsmeow.Client // businessID -> client
	sessBiz   map[string]string            // sessionID -> businessID
	evtDone   map[string]chan struct{}     // sessionID -> cerrado al soltar la sesión (para la cola de eventos)
	replaced  map[string]time.Time         // sessionID -> don't reconnect until (after StreamReplaced)
	infoTried map[string]time.Time         // contactID -> último intento de buscarle nombre (ver wantContactInfo)
	mediaSem  chan struct{}                // tope global de adjuntos en vuelo (ver mediaConcurrency)
	supaURL   string                       // Supabase URL (for media storage REST)
	supaKey   string                       // service-role key
	appURL    string                       // URL de la app Next (para avisarle de mensajes nuevos)
	pushKey   string                       // secreto compartido con /api/push/notify
}

// mediaConcurrency: cuántos adjuntos se manipulan a la vez EN TODO EL WORKER, sumando los que
// entran y los que salen.
//
// Cada adjunto se maneja entero en memoria: bajarlo son sus bytes, subirlo a WhatsApp son esos
// bytes MÁS la copia cifrada, y una imagen que entra además se decodifica a RGBA para la miniatura.
// Un solo archivo puede costar más de 100 MB de pico en una instancia de 512 MB, así que el número
// de adjuntos simultáneos es lo que decide si el worker vive o lo mata el OOM.
//
// El tope es global a propósito: no sirve limitarlo por negocio cuando la memoria es una sola y la
// comparten todos. Los mensajes de texto no pasan por aquí, así que siguen saliendo en paralelo.
const mediaConcurrency = 2

// withMedia corre fn con un permiso del tope de adjuntos. Devuelve false si el contexto murió antes
// de conseguirlo (no llegó a correr).
//
// La etiqueta se registra a propósito. El log decía "adjuntos=1" sin decir CUÁL, y con eso no se
// puede saber si lo que tiene tomado el permiso es un mensaje que sale, uno que entra o una descarga
// bajo demanda —- que es exactamente lo que hacía falta averiguar cuando el worker moría con un
// adjunto en vuelo desde el primer segundo de cada arranque.
func (m *Manager) withMedia(ctx context.Context, label string, fn func()) bool {
	select {
	case m.mediaSem <- struct{}{}:
	case <-ctx.Done():
		return false
	}
	m.log.Infof("adjunto: %s — empieza", label)
	started := time.Now()
	defer func() {
		<-m.mediaSem
		// Devuelve al sistema la memoria que costó el adjunto en vez de dejarla en el heap de Go.
		// Render mata el proceso por su memoria TOTAL, no por lo que Go considere "en uso", así que
		// un heap que ya no se necesita pero sigue reservado cuenta igual para el OOM. Cuesta un GC
		// completo, pero comparado con bajar y subir un archivo es ruido.
		debug.FreeOSMemory()
		m.log.Infof("adjunto: %s — termina (%s)", label, time.Since(started).Round(time.Millisecond))
	}()
	fn()
	return true
}

// maxMediaBytes: tope de CUALQUIER adjunto que el worker cargue en memoria —- salga, entre o se baje
// bajo demanda. Los límites del propio WhatsApp son más bajos salvo para documentos (100 MB), y un
// documento de 100 MB necesita más de 200 MB de RAM entre los bytes y su copia cifrada: se lleva la
// instancia entera por delante.
//
// Fallar ESE mensaje con un motivo escrito es estrictamente mejor que tumbar el worker y con él la
// sesión de WhatsApp de todos los negocios. El tope se aplica ANTES de leer los bytes (readCapped),
// no después: comprobarlo sobre lo ya cargado es no comprobarlo, porque el proceso muere durante la
// lectura.
//
// DEBE COINCIDIR con MAX_MEDIA_FETCH_BYTES de src/lib/mediaLimits.ts: el chat usa ese valor para decir
// "ábrelo en tu teléfono" mirando el tamaño guardado, sin ofrecer un botón que aquí va a fallar.
const maxMediaBytes = 48 * 1024 * 1024

// dbTimeout acota TODA consulta del worker. Sin él, una sola query atorada en el pooler dejaba
// colgado para siempre el bucle de sondeo que la lanzó (el contexto es Background, no vence nunca)
// y el worker se quedaba mudo —- sin mandar nada y sin dar señal de error.
const dbTimeout = 25 * time.Second

func withDBTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, dbTimeout)
}

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		panic("DATABASE_URL is required")
	}
	if os.Getenv("MESSAGE_SECRET_KEY") == "" {
		// Not fatal (legacy plaintext still flows), but new outbound bodies written by the web app
		// are encrypted and will FAIL to send until this is set to the same value as the web service.
		fmt.Println("WARNING: MESSAGE_SECRET_KEY is not set — encrypted outbound messages will be marked failed instead of sent")
	}
	// Tell Go the container's memory ceiling so the GC stays aggressive near the limit instead of
	// letting the heap grow into an OOM kill (Go can't read the cgroup limit on its own).
	//
	// 380 y no 450: Render mide la memoria TOTAL del proceso, y este límite solo cubre lo que Go
	// administra. Las pilas, el runtime y lo que reserva el TLS de las conexiones van por fuera, así
	// que dejar solo 62 MiB de margen para todo eso era optimista —- y el OOM llegaba antes de que
	// el GC llegara a ponerse nervioso. Se ajusta con MEM_LIMIT_MIB.
	memMiB := int64(380)
	if v, err := strconv.ParseInt(os.Getenv("MEM_LIMIT_MIB"), 10, 64); err == nil && v > 0 {
		memMiB = v
	}
	debug.SetMemoryLimit(memMiB << 20)

	ctx := context.Background()
	logger := waLog.Stdout("WA", "INFO", true)

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		panic(err)
	}
	// One small SHARED pool for the worker AND whatsmeow's sqlstore. The Supabase Session pooler
	// caps total clients (~15) and a deploy briefly doubles instances, so stay lean and recycle
	// idle connections. (Previously sqlstore.New opened a second, uncapped pool → pool exhaustion.)
	//
	// 5 se quedó corto al mandar en paralelo: los sondeos, el sqlstore de whatsmeow (que consulta
	// en CADA descifrado) y los envíos se peleaban por las mismas conexiones y todo se encolaba.
	//
	// 7 y no más porque un despliegue solapa dos instancias un momento: 2 × 7 = 14 sigue por debajo
	// del tope del pooler (~15). Queda configurable porque ese techo lo pone el pooler y no el
	// worker: si el pooler empieza a rechazar conexiones, baja DB_MAX_CONNS sin tocar el código.
	maxConns := 7
	if v, err := strconv.Atoi(os.Getenv("DB_MAX_CONNS")); err == nil && v > 0 {
		maxConns = v
	}
	db.SetMaxOpenConns(maxConns)
	db.SetMaxIdleConns(3)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(60 * time.Second)

	container := sqlstore.NewWithDB(db, "postgres", waLog.Stdout("DB", "WARN", true))
	if err := container.Upgrade(ctx); err != nil {
		panic(err)
	}

	// Security hardening: whatsmeow's own tables (whatsmeow_*) live in the public schema and
	// hold the WhatsApp session/encryption keys. Without RLS they'd be reachable via Supabase's
	// public anon key. Enable RLS (no policy = deny all) so only the service-role worker, which
	// bypasses RLS, can touch them. Runs every boot; idempotent.
	if _, err := db.ExecContext(ctx, `do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' and tablename like 'whatsmeow\_%'
  loop execute format('alter table public.%I enable row level security;', t); end loop;
end $$;`); err != nil {
		logger.Warnf("rls harden whatsmeow tables: %v", err)
	}

	// Auto-retry bookkeeping columns (idempotent — works even if the migration wasn't run).
	if _, err := db.ExecContext(ctx, `alter table messages
		add column if not exists send_attempts int not null default 0,
		add column if not exists next_retry_at timestamptz,
		add column if not exists fail_reason text`); err != nil {
		logger.Warnf("add retry columns: %v", err)
	}

	// Index for fast paginated message loads (newest-N, then older pages). Idempotent.
	if _, err := db.ExecContext(ctx, `create index if not exists messages_conv_created_idx
		on public.messages (conversation_id, created_at desc)`); err != nil {
		logger.Warnf("create messages index: %v", err)
	}

	// Typing indicator: when the customer is composing, we stamp a short-lived window here. Idempotent.
	if _, err := db.ExecContext(ctx, `alter table conversations add column if not exists typing_until timestamptz`); err != nil {
		logger.Warnf("add typing_until column: %v", err)
	}
	// Per-business toggle: appear online to receive typing (default on). Idempotent.
	if _, err := db.ExecContext(ctx, `alter table businesses add column if not exists show_typing boolean not null default true`); err != nil {
		logger.Warnf("add show_typing column: %v", err)
	}
	// Deadline (due date) for orders/tasks. Idempotent.
	if _, err := db.ExecContext(ctx, `alter table orders add column if not exists due_at timestamptz`); err != nil {
		logger.Warnf("add due_at column: %v", err)
	}
	// Per-item (product/subtask) note. Idempotent.
	if _, err := db.ExecContext(ctx, `alter table order_items add column if not exists note text`); err != nil {
		logger.Warnf("add order_items.note column: %v", err)
	}
	// Group chat support (opt-in per business, chat-only — no orders). Idempotent.
	if _, err := db.ExecContext(ctx, `alter table conversations
		add column if not exists is_group boolean not null default false,
		add column if not exists group_jid text,
		add column if not exists group_subject text`); err != nil {
		logger.Warnf("add group columns: %v", err)
	}
	if _, err := db.ExecContext(ctx, `alter table messages
		add column if not exists sender_name text,
		add column if not exists sender_jid text`); err != nil {
		logger.Warnf("add message sender columns: %v", err)
	}
	if _, err := db.ExecContext(ctx, `alter table businesses add column if not exists allow_groups boolean not null default false`); err != nil {
		logger.Warnf("add allow_groups column: %v", err)
	}
	if _, err := db.ExecContext(ctx, `create unique index if not exists conversations_group_jid_uniq
		on public.conversations (business_id, group_jid) where group_jid is not null`); err != nil {
		logger.Warnf("create group_jid index: %v", err)
	}
	// "Stop listening": when a conversation is muted, incoming messages are dropped (not stored). Idempotent.
	if _, err := db.ExecContext(ctx, `alter table conversations add column if not exists muted boolean not null default false`); err != nil {
		logger.Warnf("add muted column: %v", err)
	}
	// Threads belong to the business number that served them (0078). Idempotent.
	if _, err := db.ExecContext(ctx, `alter table conversations add column if not exists number_phone text`); err != nil {
		logger.Warnf("add number_phone column: %v", err)
	}
	// Schedule-based flows (off-hours / holiday auto-reply): per-business timezone + per-flow config. Idempotent.
	if _, err := db.ExecContext(ctx, `alter table businesses add column if not exists timezone text not null default 'America/Mexico_City'`); err != nil {
		logger.Warnf("add timezone column: %v", err)
	}
	if _, err := db.ExecContext(ctx, `alter table automations add column if not exists trigger_config jsonb not null default '{}'::jsonb`); err != nil {
		logger.Warnf("add trigger_config column: %v", err)
	}
	// "Mantener conmigo": a pinned conversation always stays assigned to locked_to. Idempotent.
	if _, err := db.ExecContext(ctx, `alter table conversations add column if not exists locked_to uuid`); err != nil {
		logger.Warnf("add locked_to column: %v", err)
	}

	// Momento en que ESTE worker reclamó un envío. El rescate de envíos colgados tiene que medir
	// desde aquí y no desde created_at: un mensaje que esperó en la cola más que el plazo ya nacía
	// vencido en cuanto se reclamaba, así que el siguiente barrido lo re-encolaba mientras el envío
	// seguía en vuelo —- y al cliente le llegaba dos veces por WhatsApp mientras la app mostraba uno.
	if _, err := db.ExecContext(ctx, `alter table messages add column if not exists claimed_at timestamptz`); err != nil {
		logger.Warnf("add claimed_at column: %v", err)
	}

	// Índices de las rutas calientes del worker (ver 0079). Los sondeos corren cada 2-4 segundos
	// PARA SIEMPRE, así que sin índice cada vuelta era un recorrido completo de `messages` —- la
	// tabla más grande y la única que nunca se purga. Por eso el worker se degradaba solo con el
	// tiempo, sin que cambiara nada más.
	//
	// CONCURRENTLY a propósito: construirlos en caliente sobre una tabla grande bloquearía la
	// escritura de mensajes. Y en segundo plano porque aun así tardan: el worker tiene que empezar
	// a mandar y recibir desde el primer segundo, no cuando termine de indexar. Se crean aquí (y no
	// solo en la migración) para que un despliegue no dependa de que alguien corriera el SQL.
	go func() {
		for _, q := range []string{
			// pollOutbound: la cola de salida.
			`create index concurrently if not exists messages_outbox_idx on public.messages (created_at)
			   where direction='out' and state='queued'`,
			// pollOutbound: la reja de "no adelantes a un mensaje anterior de la misma conversación".
			`create index concurrently if not exists messages_outbox_conv_idx on public.messages (conversation_id, created_at)
			   where direction='out' and state in ('queued','sending')`,
			// pollOutbound: rescate de envíos colgados.
			`create index concurrently if not exists messages_outbox_stuck_idx on public.messages (claimed_at)
			   where direction='out' and state='sending'`,
			// pollHeartbeat: el recuento de fallidos.
			`create index concurrently if not exists messages_outbox_failed_idx on public.messages (created_at)
			   where direction='out' and state='failed'`,
			// pollContacts: las peticiones de "traer nombre y foto".
			`create index concurrently if not exists contacts_fetch_requested_idx on public.contacts (fetch_requested)
			   where fetch_requested is not null`,
		} {
			if _, err := db.ExecContext(ctx, q); err != nil {
				// Si CONCURRENTLY se cae a medias deja el índice en estado inválido y el
				// `if not exists` de la próxima vuelta lo dará por hecho. El aviso es para poder
				// verlo: se arregla con un DROP INDEX y volver a crearlo.
				logger.Warnf("hot-path index (revisa si quedó inválido): %v", err)
			}
		}
		logger.Infof("hot-path indexes listos")
	}()

	// Recover messages a previous instance claimed (state='sending') but never finished, so they
	// get retried instead of being stuck under the clock icon forever.
	if _, err := db.ExecContext(ctx, `UPDATE messages SET state='queued', claimed_at=NULL WHERE direction='out' AND state='sending'`); err != nil {
		logger.Warnf("requeue stale sending: %v", err)
	}

	m := &Manager{
		db: db, container: container, log: logger,
		clients:   map[string]*whatsmeow.Client{},
		byBiz:     map[string]*whatsmeow.Client{},
		sessBiz:   map[string]string{},
		evtDone:   map[string]chan struct{}{},
		replaced:  map[string]time.Time{},
		infoTried: map[string]time.Time{},
		mediaSem:  make(chan struct{}, mediaConcurrency),
		supaURL:   strings.TrimRight(os.Getenv("SUPABASE_URL"), "/"),
		supaKey:   os.Getenv("SUPABASE_SERVICE_ROLE_KEY"),
		appURL:    strings.TrimRight(os.Getenv("APP_URL"), "/"),
		pushKey:   os.Getenv("PUSH_HOOK_SECRET"),
	}
	if m.supaURL == "" || m.supaKey == "" {
		logger.Warnf("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — media will be skipped")
	}
	if m.appURL == "" || m.pushKey == "" {
		logger.Warnf("APP_URL/PUSH_HOOK_SECRET sin definir — no se mandarán notificaciones push")
	}

	// El identificador decía "pool5" cuando el pool ya eran 7: un build fijo escrito a mano miente
	// en cuanto algo cambia, y con eso no se puede saber qué versión está corriendo de verdad. Ahora
	// imprime los valores REALES, que es justo lo que hace falta al mirar un worker que se reinicia.
	logger.Infof("worker arrancando: pool=%d adjuntos=%d envios=%d memoria=%dMiB backfill=%v",
		maxConns, mediaConcurrency, outboundConcurrency, memMiB, os.Getenv("THUMB_BACKFILL") == "1")
	go m.pollSessions(ctx)
	go m.pollOutbound(ctx)
	go m.pollContacts(ctx)
	go m.pollOps(ctx)
	go m.pollHeartbeat(ctx)
	go m.pollMemory(ctx)
	// Apagado salvo THUMB_BACKFILL=1, y termina solo al no quedar fotos sin miniatura.
	go m.backfillThumbs(ctx)

	// Graceful shutdown: on SIGTERM (Render redeploy) disconnect all WhatsApp clients so this
	// instance RELEASES the session immediately instead of fighting the new one for it.
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	logger.Infof("shutting down — disconnecting clients")
	m.mu.Lock()
	for _, c := range m.clients {
		c.Disconnect()
	}
	m.mu.Unlock()
}

// ---------- polling loops ----------

// pollSessions: cada cuánto se mira si hay sesiones que levantar.
//
// El ritmo es adaptativo porque los dos casos no se parecen en nada. En reposo —- todas conectadas,
// que es el 99.9% del tiempo —- nadie espera nada y sondear seguido solo quema base. Pero mientras
// una sesión está a medio conectar hay una PERSONA mirando un cuadro vacío a que salga el QR, y
// esta espera es la primera mitad de ese tiempo: el worker ni se ha enterado de que existe la fila.
//
// Antes eran 4 s fijos, así que solo notar la sesión nueva costaba hasta 4 s de los ~7 que tardaba
// el QR en aparecer. La consulta es de ocho filas sobre un índice; correrla cada 2 s en vez de cada
// 4 no se nota en ninguna métrica, y baja el peor caso a la mitad.
const (
	pollIdle = 2 * time.Second // todo conectado: no hay nadie esperando
	pollBusy = 1 * time.Second // alguien está conectando y mirando la pantalla
)

func (m *Manager) pollSessions(ctx context.Context) {
	for {
		alive := map[string]bool{}
		waiting := false
		// connect_method='official' rows are Cloud API sessions (webhook + web app dispatch) —
		// never bring up a whatsmeow client for them, it would overwrite their status with a QR.
		qctx, cancel := withDBTimeout(ctx)
		rows, err := m.db.QueryContext(qctx,
			`SELECT id, business_id, status, connect_method, phone, device_jid
			   FROM whatsapp_sessions
			  WHERE status IN ('connecting','qr','connected','reconnecting')
			    AND COALESCE(connect_method,'qr') <> 'official'`)
		if err != nil {
			cancel()
			m.log.Errorf("sessions query: %v", err)
		}
		if err == nil {
			for rows.Next() {
				var s session
				if rows.Scan(&s.ID, &s.BusinessID, &s.Status, &s.Method, &s.Phone, &s.DeviceJID) == nil {
					alive[s.ID] = true
					if s.Status != "connected" {
						waiting = true
					}
					m.mu.Lock()
					_, running := m.clients[s.ID]
					cooldown := time.Now().Before(m.replaced[s.ID])
					m.mu.Unlock()
					if !running && !cooldown {
						go m.start(ctx, s)
					}
				}
			}
			rows.Close()
			cancel()
			m.reap(ctx, alive)
		}
		if waiting {
			time.Sleep(pollBusy)
		} else {
			time.Sleep(pollIdle)
		}
	}
}

// reap closes clients whose session is no longer active: a deleted row -> log out
// (unlink the device from the phone); a 'disconnected' row -> just close the socket
// (keep the device so it can reconnect without a new QR).
func (m *Manager) reap(ctx context.Context, alive map[string]bool) {
	type item struct {
		id, biz string
		cli     *whatsmeow.Client
	}
	m.mu.Lock()
	var stale []item
	for id, cli := range m.clients {
		if !alive[id] {
			stale = append(stale, item{id, m.sessBiz[id], cli})
		}
	}
	m.mu.Unlock()

	for _, it := range stale {
		var cnt int
		_ = m.db.QueryRowContext(ctx, `SELECT count(*) FROM whatsapp_sessions WHERE id=$1`, it.id).Scan(&cnt)
		if cnt == 0 {
			if it.cli.IsLoggedIn() {
				_ = it.cli.Logout(ctx)
			}
			it.cli.Disconnect()
			m.log.Infof("removed %s (logged out)", it.id)
		} else {
			it.cli.Disconnect()
			m.log.Infof("disconnected %s", it.id)
		}
		m.drop(it.id, it.biz)
	}
}

// outboundConcurrency: cuántos mensajes se mandan a la vez. La reja de orden de la consulta deja
// como mucho UN mensaje elegible por conversación, así que el lote son siempre conversaciones
// distintas y mandarlas en paralelo no altera el orden de ninguna.
//
// El tope existe por memoria: cada adjunto se baja entero a RAM para volver a subirlo a WhatsApp,
// y la instancia tiene 512 MB.
const outboundConcurrency = 4

func (m *Manager) pollOutbound(ctx context.Context) {
	for {
		// Rescate de un envío que se colgó (p.ej. un send que nunca volvió). Se mide desde
		// claimed_at —- cuándo lo reclamamos— y NO desde created_at: con created_at, un mensaje que
		// llevaba más de dos minutos esperando en la cola ya nacía vencido en el momento de
		// reclamarlo, así que la vuelta siguiente lo re-encolaba con el envío todavía en vuelo y el
		// cliente lo recibía dos veces por WhatsApp mientras la app mostraba uno solo.
		m.exec(ctx, `UPDATE messages SET state='queued' WHERE direction='out' AND state='sending'
			AND claimed_at IS NOT NULL AND claimed_at < now() - interval '3 minutes'`)
		// In-order delivery: only send a message once every EARLIER outbound message in the same
		// conversation has left the queue (sent), so a retry/backoff on one can't let a later one
		// jump ahead. A message that permanently 'failed' (gave up) no longer blocks the rest.
		qctx, cancel := withDBTimeout(ctx)
		rows, err := m.db.QueryContext(qctx,
			`SELECT m.id, m.business_id, m.conversation_id, m.body, m.type, m.media_url, m.media_mime, m.media_name, m.reply_to, m.meta, m.send_attempts, COALESCE(m.wa_id,'')
			   FROM messages m
			  WHERE m.direction='out' AND m.state='queued' AND (m.next_retry_at IS NULL OR m.next_retry_at <= now())
			    AND NOT EXISTS (
			      SELECT 1 FROM messages e
			       WHERE e.conversation_id = m.conversation_id AND e.direction='out'
			         AND e.created_at < m.created_at AND e.state IN ('queued','sending')
			    )
			  ORDER BY m.created_at LIMIT 50`)
		if err == nil {
			var pending []outMsg
			for rows.Next() {
				var o outMsg
				var body, murl, mmime, mname, replyTo, meta sql.NullString
				if rows.Scan(&o.id, &o.biz, &o.conv, &body, &o.mtype, &murl, &mmime, &mname, &replyTo, &meta, &o.attempts, &o.waID) == nil {
					o.body = decryptBody(o.biz, body.String) // stored encrypted at rest; WhatsApp needs plaintext
					// Guard: an encrypted body we can't decrypt (MESSAGE_SECRET_KEY missing/mismatched)
					// must NOT go out as an empty or garbled message — fail it loudly instead. It can
					// be retried from the app once the env is fixed.
					if isEncryptedBody(body.String) && o.body == "" {
						m.log.Errorf("cannot decrypt outbound %s — MESSAGE_SECRET_KEY missing or does not match the web app's; marking failed", o.id)
						m.exec(ctx, `UPDATE messages SET state='failed', fail_reason='cannot decrypt body' WHERE id=$1`, o.id)
						continue
					}
					o.murl = murl.String
					o.mmime = mmime.String
					o.mname = mname.String
					o.replyTo = replyTo.String
					o.meta = meta.String
					pending = append(pending, o)
				}
			}
			rows.Close()
			cancel()
			// En serie, un solo número inalcanzable dejaba parados detrás de él a todos los demás
			// negocios: SendMessage espera el acuse hasta 45 s, y los adjuntos además se bajan y se
			// resuben dentro de la misma vuelta. Este worker atiende a TODOS los negocios, así que
			// era un cuello de botella global.
			var wg sync.WaitGroup
			var smu sync.Mutex
			sent := 0
			slots := make(chan struct{}, outboundConcurrency)
			for _, o := range pending {
				wg.Add(1)
				go func(o outMsg) {
					defer wg.Done()
					slots <- struct{}{}
					defer func() { <-slots }()
					if m.sendOutbound(ctx, o) {
						smu.Lock()
						sent++
						smu.Unlock()
					}
				}(o)
			}
			wg.Wait()
			// If we delivered something, loop again right away to send the next in-order
			// message per conversation instead of waiting a full interval.
			if sent > 0 {
				continue
			}
		} else {
			cancel()
			// Antes esto era un `if err == nil` sin rama else: si la consulta de la cola fallaba,
			// el worker dejaba de mandar mensajes sin decir absolutamente nada.
			m.log.Errorf("outbound queue query: %v", err)
		}
		time.Sleep(2 * time.Second)
	}
}

// syncPresence sets the number's online presence to match the business's show_typing toggle:
// available (receive customers' typing + appear online) or unavailable (private, no typing).
func (m *Manager) syncPresence(ctx context.Context, businessID string, client *whatsmeow.Client) {
	if client == nil || !client.IsConnected() {
		return
	}
	show := true
	if err := m.db.QueryRowContext(ctx, `SELECT coalesce(show_typing, true) FROM businesses WHERE id=$1`, businessID).Scan(&show); err != nil {
		return
	}
	presence := types.PresenceAvailable
	if !show {
		presence = types.PresenceUnavailable
	}
	if err := client.SendPresence(ctx, presence); err != nil {
		m.log.Warnf("send presence: %v", err)
	}
}

// pollHeartbeat periodically logs how many outbound messages are stuck, so a recurring problem
// (queued not draining, anything 'failed') is visible without guessing.
// memWatermark recuerda el pico visto, para que el log diga si la memoria sube sin parar (fuga o
// mensaje envenenado que se reintenta) o si solo da picos y baja (un adjunto grande puntual). Esa
// distinción es exactamente la que no se pudo hacer cuando el worker empezó a morir por OOM sin
// ningún despliegue de por medio: no había ni un solo número registrado.
var memWatermark uint64

// pollMemory saca una lectura de memoria cada 5 segundos, desde el primer segundo de vida.
//
// Va aparte del heartbeat y NO cada 30 s por una razón aprendida a golpes: el worker estaba
// muriendo a los 30-90 segundos de arrancar y el heartbeat no alcanzaba a escribir ni una línea, así
// que los reinicios no dejaban ningún rastro de memoria —- justo el dato que hacía falta. Una
// muestra cada 5 s garantiza que, muera cuando muera, quede la curva de cómo llegó hasta ahí.
func (m *Manager) pollMemory(ctx context.Context) {
	mib := func(b uint64) uint64 { return b / (1 << 20) }
	for {
		time.Sleep(5 * time.Second)
		var ms runtime.MemStats
		runtime.ReadMemStats(&ms)
		if ms.HeapAlloc > memWatermark {
			memWatermark = ms.HeapAlloc
		}
		m.log.Infof("mem: heap=%dMiB pico=%dMiB sistema=%dMiB gc=%d goroutines=%d adjuntos=%d",
			mib(ms.HeapAlloc), mib(memWatermark), mib(ms.Sys), ms.NumGC, runtime.NumGoroutine(), len(m.mediaSem))
	}
}

func (m *Manager) pollHeartbeat(ctx context.Context) {
	for {
		time.Sleep(30 * time.Second)

		// Keep presence in sync with the show_typing toggle (applies runtime changes) and keep the
		// "online" status fresh so typing notifications keep flowing.
		m.mu.Lock()
		snap := make(map[string]*whatsmeow.Client, len(m.byBiz))
		for biz, c := range m.byBiz {
			snap[biz] = c
		}
		m.mu.Unlock()
		for biz, c := range snap {
			m.syncPresence(ctx, biz, c)
		}
		var queued, sending, failed int
		if err := m.db.QueryRowContext(ctx, `SELECT
			count(*) filter (where state='queued'),
			count(*) filter (where state='sending'),
			count(*) filter (where state='failed')
			FROM messages WHERE direction='out' AND created_at > now() - interval '2 hours'`).Scan(&queued, &sending, &failed); err == nil {
			if queued+sending+failed > 0 {
				m.mu.Lock()
				conn, live := len(m.byBiz), 0
				for _, c := range m.byBiz {
					if c.IsConnected() {
						live++
					}
				}
				m.mu.Unlock()
				m.log.Infof("outbound backlog (2h): queued=%d sending=%d failed=%d  (sessions=%d, actually connected=%d)", queued, sending, failed, conn, live)
				// Spell out each failed message so the cause (and whether it's a fresh failure or a
				// stale leftover) is obvious without grepping earlier logs.
				if failed > 0 {
					rows, qerr := m.db.QueryContext(ctx, `SELECT id, type, send_attempts,
						round(extract(epoch from (now()-created_at))/60)::int AS age_min, coalesce(fail_reason,'?')
						FROM messages WHERE direction='out' AND state='failed' AND created_at > now() - interval '2 hours'
						ORDER BY created_at DESC LIMIT 10`)
					if qerr == nil {
						for rows.Next() {
							var id, mtype, reason string
							var attempts, age int
							if rows.Scan(&id, &mtype, &attempts, &age, &reason) == nil {
								m.log.Infof("  failed %s (%s, %dm ago, %d attempts): %s", id, mtype, age, attempts, reason)
							}
						}
						rows.Close()
					}
					// Self-heal: a 'failed' with send_attempts=0 was never actually attempted by us
					// (e.g. a stale second worker / glitch marked it). Re-queue so the live session
					// genuinely tries it. The atomic claim prevents any double-send.
					//
					// fail_reason IS NULL acota el rescate a esos casos ajenos: los que SÍ fallamos
					// nosotros a propósito (sin teléfono, cuerpo indescifrable, JID de grupo malo)
					// dejan motivo escrito, y antes se re-encolaban cada 30 s durante diez minutos
					// para volver a fallar exactamente igual.
					if res, err := m.db.ExecContext(ctx, `UPDATE messages SET state='queued', next_retry_at=NULL, claimed_at=NULL
						WHERE direction='out' AND state='failed' AND send_attempts=0 AND fail_reason IS NULL AND created_at > now() - interval '10 minutes'`); err == nil {
						if n, _ := res.RowsAffected(); n > 0 {
							m.log.Infof("re-queued %d failed-with-0-attempts message(s) for a real send", n)
						}
					}
				}
			}
		}
	}
}

// ---------- media storage ----------

func extFromMime(mime string) string {
	switch {
	case strings.Contains(mime, "jpeg"):
		return "jpg"
	case strings.Contains(mime, "png"):
		return "png"
	case strings.Contains(mime, "webp"):
		return "webp"
	case strings.Contains(mime, "gif"):
		return "gif"
	case strings.Contains(mime, "mp4"):
		return "mp4"
	case strings.Contains(mime, "ogg"):
		return "ogg"
	case strings.Contains(mime, "mpeg"):
		return "mp3"
	case strings.Contains(mime, "pdf"):
		return "pdf"
	default:
		if i := strings.Index(mime, "/"); i >= 0 && i < len(mime)-1 {
			return strings.Split(mime[i+1:], ";")[0]
		}
		return "bin"
	}
}

// notifyPush le avisa a la app que llegó un mensaje, para que empuje la notificación.
//
// El worker NO firma VAPID por su cuenta a propósito: eso duplicaría el envío Y la decisión de a
// quién le toca cada aviso, y dos copias de esa regla acaban diciendo cosas distintas. Aquí solo se
// reporta el hecho; quién recibe lo decide `src/lib/push.ts`, que es el mismo que usa la ruta
// oficial de Cloud API.
//
// Se llama SIEMPRE en una goroutine y con su propio contexto y timeout: el mensaje ya está
// guardado, y si la app está caída o lenta eso no puede frenar la ingesta del siguiente.
func (m *Manager) notifyPush(businessID, convID, title, body string) {
	if m.appURL == "" || m.pushKey == "" {
		return
	}
	payload, err := json.Marshal(map[string]string{
		"businessId": businessID, "conversationId": convID, "title": title, "body": body,
	})
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "POST", m.appURL+"/api/push/notify", bytes.NewReader(payload))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-push-secret", m.pushKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		m.log.Warnf("push notify: %v", err)
		return
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body) // drenar para que la conexión se reuse
	if resp.StatusCode >= 300 {
		m.log.Warnf("push notify: HTTP %d", resp.StatusCode)
	}
}

// uploadMedia stores bytes in the 'media' bucket and returns the storage PATH (not a public
// URL) — the bucket is private and the app serves it via short-lived signed URLs.
func (m *Manager) uploadMedia(ctx context.Context, path string, data []byte, mime string) (string, error) {
	if m.supaURL == "" || m.supaKey == "" {
		return "", fmt.Errorf("storage not configured")
	}
	req, err := http.NewRequestWithContext(ctx, "POST", m.supaURL+"/storage/v1/object/media/"+path, bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+m.supaKey)
	req.Header.Set("apikey", m.supaKey)
	req.Header.Set("Content-Type", mime)
	req.Header.Set("x-upsert", "true")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("storage %d: %s", resp.StatusCode, string(b))
	}
	return path, nil
}

// fetchMedia resolves a stored media_url (a storage path, or a legacy full URL) to bytes,
// authenticating with the service role so it works with the private 'media' bucket.
func (m *Manager) fetchMedia(ctx context.Context, ref string) ([]byte, string, error) {
	if strings.HasPrefix(ref, "http") {
		return httpGet(ctx, ref) // legacy rows stored a full public URL
	}
	req, err := http.NewRequestWithContext(ctx, "GET", m.supaURL+"/storage/v1/object/media/"+ref, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Authorization", "Bearer "+m.supaKey)
	req.Header.Set("apikey", m.supaKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return nil, "", fmt.Errorf("media fetch %d: %s", resp.StatusCode, string(b))
	}
	data, err := readCapped(resp.Body, resp.ContentLength)
	return data, resp.Header.Get("Content-Type"), err
}

// readCapped lee un cuerpo HTTP sin pasar de maxMediaBytes.
//
// Aquí estaba el agujero: antes era un io.ReadAll pelado y el tope de tamaño se comprobaba DESPUÉS,
// sobre los bytes ya cargados —- o sea, nunca, porque el proceso moría durante la lectura. Y encima
// io.ReadAll crece duplicando el buffer: para leer 300 MB reserva 1, 2, 4… 256, 512 MB. Eso explica
// por qué el log mostraba sistema=630MiB con el heap en 232MiB: lo que reventaba no era lo que se
// guardaba, era el buffer creciendo.
//
// Con Content-Length se reserva de una vez el tamaño exacto (sin duplicaciones), y si no viene se
// lee con un tope duro. En ningún caso se pasa del límite.
func readCapped(r io.Reader, contentLength int64) ([]byte, error) {
	if contentLength > maxMediaBytes {
		return nil, fmt.Errorf("%w (%d MB)", errMediaTooBig, contentLength/(1024*1024))
	}
	var buf bytes.Buffer
	if contentLength > 0 {
		buf.Grow(int(contentLength))
	}
	// maxMediaBytes+1 para poder distinguir "justo en el límite" de "se pasó".
	n, err := buf.ReadFrom(io.LimitReader(r, maxMediaBytes+1))
	if err != nil {
		return nil, err
	}
	if n > maxMediaBytes {
		return nil, errMediaTooBig
	}
	return buf.Bytes(), nil
}

func httpGet(ctx context.Context, url string) ([]byte, string, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("get %d", resp.StatusCode)
	}
	data, err := readCapped(resp.Body, resp.ContentLength)
	return data, resp.Header.Get("Content-Type"), err
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// pollContacts fulfils on-demand "fetch name & photo" requests from the app.
func (m *Manager) pollContacts(ctx context.Context) {
	for {
		qctx, cancel := withDBTimeout(ctx)
		rows, err := m.db.QueryContext(qctx,
			`SELECT id, business_id, phone FROM contacts WHERE fetch_requested IS NOT NULL LIMIT 20`)
		if err != nil {
			cancel()
			m.log.Errorf("contacts fetch query: %v", err)
		}
		if err == nil {
			type c struct{ id, biz, phone string }
			var list []c
			for rows.Next() {
				var x c
				var ph sql.NullString
				if rows.Scan(&x.id, &x.biz, &ph) == nil {
					x.phone = ph.String
					list = append(list, x)
				}
			}
			rows.Close()
			cancel()
			for _, x := range list {
				m.fetchContactInfo(ctx, x.id, x.biz, x.phone)
			}
		}
		time.Sleep(3 * time.Second)
	}
}

/**
 * Pide el nombre y la foto de un contacto que todavía se llama como su número.
 *
 * Antes esto SOLO lo disparaba un botón ("Buscar nombre") en el chat. O sea: llegaba un cliente
 * nuevo, veías un +52…, y para saber quién era tenías que acordarte de pedirlo a mano, en cada
 * contacto y cada vez. La maquinaria completa ya existía —- la bandera, el bucle, la búsqueda—;
 * lo único que faltaba era que algo la encendiera solo.
 *
 * Se llama en cada mensaje entrante y no solo al crear el contacto, y ahí está la gracia: los
 * contactos que ya se quedaron con el número por nombre se arreglan en cuanto vuelvan a escribir,
 * sin migración y sin una avalancha de peticiones al conectar.
 *
 * Las tres condiciones van dentro del UPDATE a propósito, no en un SELECT previo: así es una sola
 * consulta y no hay carrera entre leer y escribir.
 *   · name = phone      → solo cuando el nombre sigue siendo el número. Un nombre puesto a mano
 *                         NUNCA se pisa (fetchContactInfo también lo respeta al escribir).
 *   · fetch_requested IS NULL → no repetir lo que ya está en cola.
 * Buscar el NOMBRE no cuesta red: sale del directorio que whatsmeow ya tiene sincronizado en local.
 * Lo que sí sale a la red es la foto, y por eso esto no se dispara para cualquier contacto sino
 * solo para los que no tienen nombre.
 */
func (m *Manager) wantContactInfo(ctx context.Context, id string) {
	if id == "" {
		return
	}
	// Freno de una hora por contacto, y hace falta: `fetchContactInfo` limpia la bandera aunque no
	// encuentre nada, así que un desconocido que no está en la agenda del teléfono seguiría sin
	// nombre —- y sin este freno le pediríamos la FOTO a WhatsApp por red en CADA mensaje suyo. Un
	// cliente hablador se convertiría solo en una tormenta de peticiones.
	//
	// En memoria y no en la base a propósito: no vale una migración, y perderlo al reiniciar solo
	// significa un intento de más. El botón de "Buscar nombre" del chat no pasa por aquí —- escribe
	// la bandera directo—, así que pedirlo a mano sigue funcionando al instante.
	m.mu.Lock()
	last, seen := m.infoTried[id]
	fresh := seen && time.Since(last) < time.Hour
	if !fresh {
		m.infoTried[id] = time.Now()
	}
	m.mu.Unlock()
	if fresh {
		return
	}
	m.exec(ctx, `UPDATE contacts SET fetch_requested=now()
	              WHERE id=$1 AND fetch_requested IS NULL AND name = phone`, id)
}

func (m *Manager) fetchContactInfo(ctx context.Context, id, biz, phone string) {
	m.mu.Lock()
	client := m.byBiz[biz]
	m.mu.Unlock()
	if client == nil {
		return // not connected — keep the flag, retry when a number is linked
	}
	defer m.exec(ctx, `UPDATE contacts SET fetch_requested=NULL WHERE id=$1`, id)

	num := digits(phone)
	if num == "" {
		return
	}
	jid := types.NewJID(num, types.DefaultUserServer)

	if ci, err := client.Store.Contacts.GetContact(ctx, jid); err == nil && ci.Found {
		name := firstNonEmpty(ci.FullName, ci.BusinessName, ci.PushName, ci.FirstName)
		if name != "" {
			// only override the auto name (the bare phone), never a manual rename
			m.exec(ctx, `UPDATE contacts SET name=$1 WHERE id=$2 AND name=$3`, name, id, phone)
		}
	}
	if pic, err := client.GetProfilePictureInfo(ctx, jid, nil); err == nil && pic != nil && pic.URL != "" {
		m.exec(ctx, `UPDATE contacts SET avatar_url=$1 WHERE id=$2`, pic.URL, id)
	}
	m.log.Infof("fetched contact info %s", phone)
}

// ---------- session lifecycle ----------

func (m *Manager) start(ctx context.Context, s session) {
	m.mu.Lock()
	if _, ok := m.clients[s.ID]; ok {
		m.mu.Unlock()
		return
	}
	m.mu.Unlock()

	var device *store.Device
	if s.DeviceJID.Valid && s.DeviceJID.String != "" {
		if jid, err := types.ParseJID(s.DeviceJID.String); err == nil {
			device, _ = m.container.GetDevice(ctx, jid)
		}
	}
	if device == nil {
		device = m.container.NewDevice()
	}

	client := whatsmeow.NewClient(device, m.log)
	done := make(chan struct{})
	m.mu.Lock()
	m.clients[s.ID] = client
	m.sessBiz[s.ID] = s.BusinessID
	m.evtDone[s.ID] = done
	m.mu.Unlock()

	// whatsmeow atiende los nodos del socket DE UNO EN UNO por cliente y espera hasta cinco
	// minutos a que cada manejador termine antes de pasar al siguiente (handlerQueueLoop). Nuestro
	// manejador habla con Postgres y, para los adjuntos, con dos CDNs: hacerlo ahí adentro
	// significaba que una sola foto de 8 MB dejaba parados detrás de ella TODOS los mensajes,
	// acuses y avisos de "escribiendo" de ese número. Eso es lo que se sentía como "va lentísimo"
	// y como "los mensajes llegan tardísimo o no llegan".
	//
	// El evento se pasa a nuestra propia cola: el socket vuelve al instante y el orden se conserva
	// porque hay un único consumidor por sesión.
	// 64 y no más: el buffer es por sesión y guarda mensajes ya descifrados, que pueden traer la
	// miniatura de WhatsApp dentro. Con muchos números conectados, un buffer generoso multiplicado
	// por sesión es memoria que esta instancia no tiene.
	queue := make(chan interface{}, 64)
	go func() {
		for {
			select {
			case evt := <-queue:
				m.handleEvent(ctx, s, client, evt)
			case <-done:
				return
			}
		}
	}()

	client.AddEventHandler(func(evt interface{}) {
		// Se filtra ANTES de encolar. El que importa es *events.HistorySync: WhatsApp manda el
		// historial del teléfono en trozos que whatsmeow baja, descomprime entero en memoria y
		// convierte en un árbol de protobuf —- para una cuenta con historial son cientos de MB, y
		// pueden venir hasta 32 trozos en fila. Nosotros no lo usamos para NADA: construimos el
		// historial de los mensajes en vivo. Encolarlo era pagar toda esa memoria para tirarla, y
		// además retenerla en la cola mientras tanto.
		switch v := evt.(type) {
		case *events.Connected, *events.PairSuccess, *events.ChatPresence, *events.LoggedOut,
			*events.Disconnected, *events.StreamReplaced, *events.Message,
			*events.UndecryptableMessage, *events.Receipt, *events.CallOffer,
			*events.CallOfferNotice, *events.CallTerminate, *events.CallReject:
			// son los que handleEvent atiende
		case *events.HistorySync:
			// Se registra el tamaño porque es justo el dato que falta para saber si esto es lo que
			// está tirando al worker, y se devuelve la memoria al sistema en cuanto se suelta.
			m.log.Warnf("descartado history sync: tipo=%s progreso=%d conversaciones=%d",
				v.Data.GetSyncType(), v.Data.GetProgress(), len(v.Data.GetConversations()))
			v.Data = nil
			debug.FreeOSMemory()
			return
		default:
			return // cualquier otro evento no se atiende: no tiene sentido ni encolarlo
		}

		select {
		case queue <- evt:
			return
		default:
		}
		// Cola llena: el consumidor va muy atrás. Se bloquea en vez de descartar —- perder un
		// mensaje entrante es peor que ir lento, y bloquear aquí es exactamente lo que pasaba
		// antes de tener cola.
		m.log.Warnf("session %s: cola de eventos llena (%d) — el consumidor va atrasado", s.ID, cap(queue))
		select {
		case queue <- evt:
		case <-done:
		}
	})

	if client.Store.ID == nil {
		// Not logged in yet — QR or pairing code.
		if s.Method == "pairing" && s.Phone.Valid && digits(s.Phone.String) != "" {
			if err := client.Connect(); err != nil {
				m.log.Errorf("connect (pairing) %s: %v", s.ID, err)
				m.fail(ctx, s)
				return
			}
			go func() {
				time.Sleep(2 * time.Second)
				code, err := client.PairPhone(ctx, digits(s.Phone.String), true, whatsmeow.PairClientChrome, "Hiraticket")
				if err != nil {
					m.log.Errorf("pairphone %s: %v", s.ID, err)
					return
				}
				m.exec(ctx, `UPDATE whatsapp_sessions SET status='qr', pairing_code=$1, updated_at=now() WHERE id=$2`, code, s.ID)
			}()
		} else {
			qrChan, _ := client.GetQRChannel(ctx)
			if err := client.Connect(); err != nil {
				m.log.Errorf("connect (qr) %s: %v", s.ID, err)
				m.fail(ctx, s)
				return
			}
			go func() {
				for item := range qrChan {
					if item.Event == "code" {
						m.exec(ctx, `UPDATE whatsapp_sessions SET status='qr', qr=$1, pairing_code=NULL, updated_at=now() WHERE id=$2`, item.Code, s.ID)
					}
				}
			}()
		}
		return
	}

	// Already paired — just reconnect.
	if err := client.Connect(); err != nil {
		m.log.Errorf("reconnect %s: %v", s.ID, err)
		m.fail(ctx, s)
	}
}

func (m *Manager) handleEvent(ctx context.Context, s session, client *whatsmeow.Client, evt interface{}) {
	switch v := evt.(type) {
	case *events.Connected, *events.PairSuccess:
		if client.Store.ID != nil {
			phone := "+" + client.Store.ID.User
			jid := client.Store.ID.String()
			m.mu.Lock()
			m.byBiz[s.BusinessID] = client
			delete(m.replaced, s.ID) // connected cleanly — clear any replace cooldown
			m.mu.Unlock()
			m.exec(ctx, `UPDATE whatsapp_sessions
				SET status='connected', qr=NULL, pairing_code=NULL, phone=$1, device_jid=$2, last_seen=now(), updated_at=now()
				WHERE id=$3`, phone, jid, s.ID)
			// Claim legacy threads (number_phone still NULL) for this number: whatsmeow tenants keep
			// their whole list across reconnects. Official (Cloud API) onboarding never claims —
			// a new number starts with a clean inbox by design.
			m.exec(ctx, `UPDATE conversations SET number_phone=$1 WHERE business_id=$2 AND number_phone IS NULL`, phone, s.BusinessID)
			m.log.Infof("connected %s as %s", s.ID, phone)
			// Presence per the business's show_typing toggle (available → receive typing + appear
			// online; unavailable → stay private but no typing indicators).
			m.syncPresence(ctx, s.BusinessID, client)
			// Auto-heal: give recently-failed sends (usually deploy-window/StreamReplaced casualties)
			// another shot now that the session is back, so the user doesn't have to hit Retry.
			if res, err := m.db.ExecContext(ctx, `UPDATE messages SET state='queued', send_attempts=0, next_retry_at=NULL
				WHERE business_id=$1 AND direction='out' AND state='failed' AND created_at > now() - interval '15 minutes'`, s.BusinessID); err == nil {
				if n, _ := res.RowsAffected(); n > 0 {
					m.log.Infof("requeued %d recently-failed message(s) after reconnect", n)
				}
			}
		}
	case *events.ChatPresence:
		// Customer typing / paused in a 1:1 chat → reflect on the conversation for the live UI.
		phone := v.Chat.User
		if phone == "" {
			return
		}
		if v.State == types.ChatPresenceComposing {
			// 8s window; only write when new or about to expire, to avoid update churn while typing.
			m.exec(ctx, `UPDATE conversations c SET typing_until = now() + interval '8 seconds'
				FROM contacts ct WHERE c.contact_id = ct.id AND ct.business_id=$1 AND ct.phone=$2
				AND c.status<>'resolved' AND (c.typing_until IS NULL OR c.typing_until < now() + interval '4 seconds')`, s.BusinessID, phone)
		} else {
			m.exec(ctx, `UPDATE conversations c SET typing_until = NULL
				FROM contacts ct WHERE c.contact_id = ct.id AND ct.business_id=$1 AND ct.phone=$2 AND c.typing_until IS NOT NULL`, s.BusinessID, phone)
		}
	case *events.LoggedOut:
		m.exec(ctx, `UPDATE whatsapp_sessions SET status='disconnected', qr=NULL, pairing_code=NULL, phone=NULL, device_jid=NULL, updated_at=now() WHERE id=$1`, s.ID)
		m.drop(s.ID, s.BusinessID)
		client.Disconnect()
	case *events.Disconnected:
		m.exec(ctx, `UPDATE whatsapp_sessions SET status='reconnecting', updated_at=now() WHERE id=$1 AND status='connected'`, s.ID)
	case *events.StreamReplaced:
		// Another connection took over this WhatsApp session — usually the previous deploy's
		// instance overlapping during a redeploy. Step aside and back off for a cooldown so we
		// don't tight-loop reconnecting and fighting it; pollSessions skips us until it elapses.
		m.log.Warnf("session %s was REPLACED by another connection — stepping aside 45s (deploy overlap, or a 2nd worker on the same number?)", s.ID)
		client.EnableAutoReconnect = false // don't let whatsmeow reconnect this one and fight for the socket
		m.mu.Lock()
		m.replaced[s.ID] = time.Now().Add(45 * time.Second)
		m.mu.Unlock()
		m.exec(ctx, `UPDATE whatsapp_sessions SET status='reconnecting', updated_at=now() WHERE id=$1`, s.ID)
		m.drop(s.ID, s.BusinessID)
		client.Disconnect()
	case *events.Message:
		m.handleIncoming(ctx, s, client, v)
	case *events.UndecryptableMessage:
		m.handleUnavailable(ctx, s, client, v)
	case *events.Receipt:
		m.handleReceipt(ctx, s.BusinessID, v)
	case *events.CallOffer:
		m.handleCall(ctx, s, client, v.BasicCallMeta, "ringing")
	case *events.CallOfferNotice:
		m.handleCall(ctx, s, client, v.BasicCallMeta, "ringing")
	case *events.CallTerminate:
		m.handleCall(ctx, s, client, v.BasicCallMeta, "missed")
	case *events.CallReject:
		m.handleCall(ctx, s, client, v.BasicCallMeta, "missed")
	}
}

// handleCall records an incoming WhatsApp call as a message in the conversation.
//
// whatsmeow only relays call SIGNALLING — there is no audio here, so a call can be shown and
// notified but never answered from Hiraticket.
//
// It lands as a normal `messages` row (type='call') on purpose: everything downstream already
// works for messages — realtime, toasts, sound, the conversation preview, the unread badge. The
// state column carries 'ringing' → 'missed' so the UI can swap the label in place; the call id
// goes in wa_id so the terminate event can find the row it has to update.
func (m *Manager) handleCall(ctx context.Context, s session, client *whatsmeow.Client, meta types.BasicCallMeta, state string) {
	callID, ts := meta.CallID, meta.Timestamp
	if !meta.GroupJID.IsEmpty() {
		return // llamada de grupo: no hay conversación 1:1 a la que colgarla
	}
	// El teléfono puede no venir en From: WhatsApp está migrando a JIDs @lid (HiddenUserServer) y
	// ahí From llega como "1234@lid", que no es un número. Se prueban los candidatos igual que en
	// los mensajes (que usan SenderAlt), y si solo hay LID se resuelve contra el store.
	phone := ""
	for _, j := range []types.JID{meta.CallCreatorAlt, meta.From, meta.CallCreator} {
		if j.Server == types.DefaultUserServer && j.User != "" {
			phone = "+" + j.User
			break
		}
	}
	if phone == "" {
		for _, j := range []types.JID{meta.From, meta.CallCreator} {
			if j.Server != types.HiddenUserServer || j.User == "" {
				continue
			}
			if pn, err := client.Store.LIDs.GetPNForLID(ctx, j.ToNonAD()); err == nil && pn.User != "" {
				phone = "+" + pn.User
				break
			}
		}
	}
	if phone == "" {
		// Antes esto era un return silencioso y por eso una llamada podía no aparecer sin dejar
		// rastro. Con el log se puede ver qué JID llegó.
		m.log.Warnf("call %s (%s): no pude resolver el teléfono — from=%s creator=%s alt=%s",
			callID, state, meta.From, meta.CallCreator, meta.CallCreatorAlt)
		return
	}
	m.log.Infof("call event %s from %s (%s)", state, phone, callID)

	var contactID, convID string
	var unread int
	err := m.db.QueryRowContext(ctx, `SELECT id FROM contacts WHERE business_id=$1 AND phone=$2`, s.BusinessID, phone).Scan(&contactID)
	if err == sql.ErrNoRows {
		if err = m.db.QueryRowContext(ctx,
			`INSERT INTO contacts (business_id, name, phone) VALUES ($1,$2,$3) RETURNING id`,
			s.BusinessID, phone, phone).Scan(&contactID); err != nil {
			m.log.Errorf("call contact insert: %v", err)
			return
		}
	} else if err != nil {
		return
	}
	ph := bizPhone(client)
	err = m.db.QueryRowContext(ctx,
		`SELECT id, unread FROM conversations WHERE business_id=$1 AND contact_id=$2
		    AND (number_phone IS NULL OR number_phone=$3)
		  ORDER BY last_message_at DESC LIMIT 1`, s.BusinessID, contactID, ph).Scan(&convID, &unread)
	if err == sql.ErrNoRows {
		if err = m.db.QueryRowContext(ctx,
			`INSERT INTO conversations (business_id, contact_id, status, unread, number_phone) VALUES ($1,$2,'open',0,NULLIF($3,'')) RETURNING id`,
			s.BusinessID, contactID, ph).Scan(&convID); err != nil {
			m.log.Errorf("call conv insert: %v", err)
			return
		}
		unread = 0
	} else if err != nil {
		return
	}
	m.exec(ctx, `UPDATE conversations SET number_phone=NULLIF($1,'') WHERE id=$2 AND number_phone IS NULL`, ph, convID)

	label := "📞 Llamada entrante"
	if state == "missed" {
		label = "📞 Llamada perdida"
	}

	// El terminate llega después del offer: si ya hay fila para esta llamada, se actualiza en vez
	// de crear una segunda. Sin esto el chat quedaría con dos renglones por llamada.
	res, uerr := m.db.ExecContext(ctx,
		`UPDATE messages SET state=$1, body=$2 WHERE business_id=$3 AND wa_id=$4 AND type='call'`,
		state, encryptBody(s.BusinessID, label), s.BusinessID, callID)
	if uerr == nil {
		if n, _ := res.RowsAffected(); n > 0 {
			m.exec(ctx, `UPDATE conversations SET last_message_at=now() WHERE id=$1`, convID)
			m.log.Infof("call %s from %s (updated)", state, phone)
			return
		}
	}

	m.exec(ctx, `INSERT INTO messages (business_id, conversation_id, direction, type, body, state, wa_id, created_at)
		VALUES ($1,$2,'in','call',$3,$4,$5,$6)`,
		s.BusinessID, convID, encryptBody(s.BusinessID, label), state, callID, ts)
	// Una llamada perdida cuenta como pendiente igual que un mensaje: reabre y sube el chat.
	m.exec(ctx, `UPDATE conversations SET unread=$1, last_message_at=now(), snoozed_until=NULL, hidden=false,
		status = CASE WHEN status='resolved' THEN 'open' ELSE status END WHERE id=$2`, unread+1, convID)
	m.log.Infof("call %s from %s", state, phone)
}

// handleUnavailable records a placeholder for messages WhatsApp won't deliver to a linked device —
// notably view-once media, which never arrives as a normal events.Message. So at least the chat
// shows that a one-time message was received.
func (m *Manager) handleUnavailable(ctx context.Context, s session, client *whatsmeow.Client, v *events.UndecryptableMessage) {
	if v.UnavailableType != events.UnavailableTypeViewOnce {
		return // only surface intentionally-unavailable view-once for now
	}
	info := v.Info
	if info.Chat.Server == "broadcast" || info.Chat.Server == "newsletter" {
		return
	}
	if info.IsGroup && !m.allowGroups(ctx, s.BusinessID) {
		return
	}
	waID := info.ID
	var exists bool
	_ = m.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM messages WHERE business_id=$1 AND wa_id=$2)`, s.BusinessID, waID).Scan(&exists)
	if exists {
		return
	}

	var contactID, convID string
	var unread int
	var muted bool
	senderName, senderJID := "", ""

	if info.IsGroup {
		groupJID := info.Chat.String()
		gerr := m.db.QueryRowContext(ctx, `SELECT id, contact_id, unread, muted FROM conversations WHERE business_id=$1 AND group_jid=$2 LIMIT 1`, s.BusinessID, groupJID).Scan(&convID, &contactID, &unread, &muted)
		if gerr == sql.ErrNoRows {
			subject := m.groupSubject(ctx, client, info.Chat)
			if ierr := m.db.QueryRowContext(ctx, `INSERT INTO contacts (business_id, name, is_group) VALUES ($1,$2,true) RETURNING id`, s.BusinessID, subject).Scan(&contactID); ierr != nil {
				return
			}
			if ierr := m.db.QueryRowContext(ctx, `INSERT INTO conversations (business_id, contact_id, status, unread, is_group, group_jid, group_subject, number_phone) VALUES ($1,$2,'open',0,true,$3,$4,NULLIF($5,'')) RETURNING id`, s.BusinessID, contactID, groupJID, subject, bizPhone(client)).Scan(&convID); ierr != nil {
				return
			}
		} else if gerr != nil {
			return
		}
		m.exec(ctx, `UPDATE conversations SET number_phone=NULLIF($1,'') WHERE id=$2 AND number_phone IS NULL`, bizPhone(client), convID)
		if !info.IsFromMe {
			senderName = info.PushName
			if senderName == "" {
				senderName = "+" + info.Sender.User
			}
			senderJID = info.Sender.ToNonAD().String()
		}
	} else {
		partner := partnerPhone(info)
		err := m.db.QueryRowContext(ctx, `SELECT id FROM contacts WHERE business_id=$1 AND phone=$2`, s.BusinessID, partner).Scan(&contactID)
		if err == sql.ErrNoRows {
			name := partner
			if !info.IsFromMe && info.PushName != "" {
				name = info.PushName
			}
			if e := m.db.QueryRowContext(ctx, `INSERT INTO contacts (business_id, name, phone) VALUES ($1,$2,$3) RETURNING id`, s.BusinessID, name, partner).Scan(&contactID); e != nil {
				return
			}
		} else if err != nil {
			return
		}
		m.wantContactInfo(ctx, contactID)
		err = m.db.QueryRowContext(ctx, `SELECT id, unread, muted FROM conversations WHERE business_id=$1 AND contact_id=$2 AND status<>'resolved' AND (number_phone IS NULL OR number_phone=$3) ORDER BY last_message_at DESC LIMIT 1`, s.BusinessID, contactID, bizPhone(client)).Scan(&convID, &unread, &muted)
		if err == sql.ErrNoRows {
			if e := m.db.QueryRowContext(ctx, `INSERT INTO conversations (business_id, contact_id, status, unread, number_phone) VALUES ($1,$2,'open',0,NULLIF($3,'')) RETURNING id`, s.BusinessID, contactID, bizPhone(client)).Scan(&convID); e != nil {
				return
			}
		} else if err != nil {
			return
		}
		m.exec(ctx, `UPDATE conversations SET number_phone=NULLIF($1,'') WHERE id=$2 AND number_phone IS NULL`, bizPhone(client), convID)
	}
	if muted {
		return
	}

	dir, state := "in", "delivered"
	if info.IsFromMe {
		dir, state = "out", "sent"
	}
	m.exec(ctx, `INSERT INTO messages (business_id, conversation_id, direction, type, body, state, wa_id, sender_name, sender_jid)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		s.BusinessID, convID, dir, "text", encryptBody(s.BusinessID, "📷 Foto de única vez — ábrela en tu teléfono"), state, waID, nullIf(senderName), nullIf(senderJID))
	if dir == "in" {
		m.exec(ctx, `UPDATE conversations SET unread=$1, last_message_at=now(), snoozed_until=NULL, hidden=false WHERE id=$2`, unread+1, convID)
	} else {
		m.exec(ctx, `UPDATE conversations SET last_message_at=now(), unread=0 WHERE id=$1`, convID)
	}
	m.log.Infof("recorded unavailable view-once %s from %s", waID, info.Sender.String())
}

// handleReceipt advances outbound message ticks to delivered/read.
//
// El business_id va en el WHERE por una razón muy concreta: el único índice que existe sobre wa_id
// es (business_id, wa_id), así que buscar SOLO por wa_id obligaba a Postgres a recorrer la tabla
// `messages` entera. Y los acuses son, con diferencia, el evento más frecuente de WhatsApp: era un
// recorrido completo de la tabla más grande por cada palomita de cada negocio, y encima dentro del
// hilo que despacha los mensajes entrantes. De ahí venía buena parte de la lentitud general.
//
// Los ids van en un solo UPDATE (= ANY) en vez de uno por id: un acuse trae varios de golpe.
func (m *Manager) handleReceipt(ctx context.Context, businessID string, v *events.Receipt) {
	var state string
	switch v.Type {
	case types.ReceiptTypeRead, types.ReceiptTypeReadSelf:
		state = "read"
	case types.ReceiptTypeDelivered:
		state = "delivered"
	default:
		return
	}
	if len(v.MessageIDs) == 0 {
		return
	}
	ids := make([]string, 0, len(v.MessageIDs))
	for _, id := range v.MessageIDs {
		ids = append(ids, string(id))
	}
	// El filtro por estado evita reescribir filas que ya están en ese estado: cada UPDATE inútil
	// es una fila entera al WAL en la tabla que más se actualiza.
	if state == "read" {
		m.exec(ctx, `UPDATE messages SET state='read'
			WHERE business_id=$1 AND wa_id = ANY($2) AND direction='out' AND state <> 'read'`, businessID, pq.Array(ids))
	} else {
		m.exec(ctx, `UPDATE messages SET state='delivered'
			WHERE business_id=$1 AND wa_id = ANY($2) AND direction='out' AND state NOT IN ('read','delivered')`, businessID, pq.Array(ids))
	}
}

// ---------- inbound / outbound ----------

// partnerPhone returns the conversation partner's real phone (+digits). WhatsApp
// now uses @lid addressing, so the phone lives in the alternate JID — prefer the
// s.whatsapp.net address; fall back to whatever Chat carries.
// bizPhone is the business's own number ("+521...") — stamped on conversations (number_phone, 0078)
// so each thread belongs to the number that served it.
func bizPhone(client *whatsmeow.Client) string {
	if client != nil && client.Store.ID != nil {
		return "+" + client.Store.ID.User
	}
	return ""
}

func partnerPhone(info types.MessageInfo) string {
	var cands []types.JID
	if info.IsFromMe {
		cands = []types.JID{info.RecipientAlt, info.Chat}
	} else {
		cands = []types.JID{info.SenderAlt, info.Chat}
	}
	for _, j := range cands {
		if j.Server == types.DefaultUserServer && j.User != "" {
			return "+" + j.User
		}
	}
	return "+" + info.Chat.User
}

// maxThumbBytes: tope para la miniatura que viene dentro del mensaje. Las de WhatsApp pesan unos
// pocos kilobytes; el tope solo evita que una rara infle la fila.
const maxThumbBytes = 24 * 1024

// withThumb guarda la miniatura JPEG que WhatsApp ya manda dentro del mensaje.
//
// Sin ella el chat no puede pintar NADA hasta bajar el archivo completo, así que una foto de 16 MB
// congelaba la interfaz entera al abrir la conversación. Con ella se pinta al instante y el original
// se baja solo cuando alguien lo abre.
//
// Va como data URI dentro de `meta` (que ya es jsonb y ya se usa para w/h, así que no hace falta
// migración) en vez de como archivo en storage: así viaja junto con el mensaje y no cuesta una
// petición extra por foto —- que es justo el costo que se está tratando de evitar.
func withThumb(m map[string]interface{}, thumb []byte) map[string]interface{} {
	if n := len(thumb); n > 0 && n <= maxThumbBytes {
		m["thumb"] = "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(thumb)
	}
	return m
}

func (m *Manager) handleIncoming(ctx context.Context, s session, client *whatsmeow.Client, v *events.Message) {
	// status@broadcast / newsletters are never handled.
	if v.Info.Chat.Server == "broadcast" || v.Info.Chat.Server == "newsletter" {
		return
	}
	// Group chats are opt-in per business (chat-only; they never create or link orders). Off → skip.
	if v.Info.IsGroup && !m.allowGroups(ctx, s.BusinessID) {
		return
	}

	msg := v.Message

	// Disappearing-messages chats wrap content in an ephemeral container; document+caption messages
	// wrap a document. Unwrap so the real message (text / media / view-once) is seen instead of an
	// empty wrapper (otherwise the message silently never appears).
	if eph := msg.GetEphemeralMessage().GetMessage(); eph != nil {
		msg = eph
	}
	if dwc := msg.GetDocumentWithCaptionMessage().GetMessage(); dwc != nil {
		msg = dwc
	}

	// Inbound edit/revoke (and reactions) — handled separately, not stored as new rows.
	if pm := msg.GetProtocolMessage(); pm != nil {
		m.handleProtocol(ctx, s, pm)
		return
	}
	if rm := msg.GetReactionMessage(); rm != nil {
		by := "contact"
		if v.Info.IsFromMe {
			by = "agent"
		}
		m.log.Infof("reaction received (%s) %q on %s", by, rm.GetText(), rm.GetKey().GetID())
		m.applyReaction(ctx, s.BusinessID, rm.GetKey().GetID(), rm.GetText(), by)
		return
	}

	// Unwrap "view once" (ephemeral) media so we can at least record that it arrived. It arrives two
	// ways: wrapped in a ViewOnceMessage* container, OR (newer/common) as a normal image/video/audio
	// message with the viewOnce flag set — catch both.
	viewOnce := false
	if vo := msg.GetViewOnceMessage().GetMessage(); vo != nil {
		msg, viewOnce = vo, true
	} else if vo := msg.GetViewOnceMessageV2().GetMessage(); vo != nil {
		msg, viewOnce = vo, true
	} else if vo := msg.GetViewOnceMessageV2Extension().GetMessage(); vo != nil {
		msg, viewOnce = vo, true
	}
	if msg.GetImageMessage().GetViewOnce() || msg.GetVideoMessage().GetViewOnce() || msg.GetAudioMessage().GetViewOnce() {
		viewOnce = true
	}

	// Text + media detection.
	text := msg.GetConversation()
	if text == "" {
		text = msg.GetExtendedTextMessage().GetText()
	}
	mtype, mmime, mname, meta := "text", "", "", ""
	switch {
	case msg.GetImageMessage() != nil:
		im := msg.GetImageMessage()
		mtype, mmime, text = "image", im.GetMimetype(), firstNonEmpty(im.GetCaption(), text)
		meta = jsonStr(withThumb(map[string]interface{}{"w": im.GetWidth(), "h": im.GetHeight()}, im.GetJPEGThumbnail()))
	case msg.GetStickerMessage() != nil:
		st := msg.GetStickerMessage()
		mtype, mmime = "sticker", st.GetMimetype()
		meta = jsonStr(map[string]interface{}{"w": st.GetWidth(), "h": st.GetHeight()})
	case msg.GetAudioMessage() != nil:
		mtype, mmime = "audio", msg.GetAudioMessage().GetMimetype()
	case msg.GetVideoMessage() != nil:
		vm := msg.GetVideoMessage()
		mtype, mmime, text = "video", vm.GetMimetype(), firstNonEmpty(vm.GetCaption(), text)
		meta = jsonStr(withThumb(map[string]interface{}{"w": vm.GetWidth(), "h": vm.GetHeight()}, vm.GetJPEGThumbnail()))
	case msg.GetDocumentMessage() != nil:
		mtype, mmime, mname = "document", msg.GetDocumentMessage().GetMimetype(), msg.GetDocumentMessage().GetFileName()
		text = firstNonEmpty(msg.GetDocumentMessage().GetCaption(), text)
	case msg.GetLocationMessage() != nil:
		loc := msg.GetLocationMessage()
		mtype = "location"
		text = firstNonEmpty(loc.GetName(), loc.GetAddress(), "Ubicación")
		meta = jsonStr(map[string]interface{}{"lat": loc.GetDegreesLatitude(), "lng": loc.GetDegreesLongitude(), "name": loc.GetName(), "address": loc.GetAddress()})
	case msg.GetLiveLocationMessage() != nil:
		ll := msg.GetLiveLocationMessage()
		mtype = "location"
		text = "Ubicación en vivo"
		meta = jsonStr(map[string]interface{}{"lat": ll.GetDegreesLatitude(), "lng": ll.GetDegreesLongitude(), "live": true})
	case msg.GetContactMessage() != nil:
		cm := msg.GetContactMessage()
		mtype = "contact"
		text = cm.GetDisplayName()
		meta = jsonStr(map[string]interface{}{"name": cm.GetDisplayName(), "vcard": cm.GetVcard()})
	}

	// View-once media isn't stored (ephemeral) — record that a one-time photo/video/audio arrived.
	if viewOnce {
		switch mtype {
		case "video":
			text = "🎥 Video de única vez"
		case "audio":
			text = "🎤 Audio de única vez"
		default:
			text = "📷 Foto de única vez"
		}
		mtype, mmime, meta = "text", "", ""
	}

	ci := getContextInfo(msg)
	forwarded := ci != nil && (ci.GetIsForwarded() || ci.GetForwardingScore() > 0)

	if mtype == "text" && text == "" {
		return // unsupported / empty
	}

	// Dedupe by WhatsApp message id (so the echo of an app-sent message, and
	// reconnect re-deliveries, don't create duplicates).
	waID := v.Info.ID
	var exists bool
	_ = m.db.QueryRowContext(ctx,
		`SELECT EXISTS(SELECT 1 FROM messages WHERE business_id=$1 AND wa_id=$2)`, s.BusinessID, waID).Scan(&exists)
	if exists {
		return
	}

	dir, state := "in", "delivered"
	if v.Info.IsFromMe {
		dir, state = "out", "sent"
	}

	var contactID, convID, partner string
	var unread int
	var muted bool         // when the conversation is muted ("stop listening"), drop the message
	var priorStatus string // the conversation's status before this message — used to reopen a resolved chat
	// Sender identity — only set for group messages, so the UI can show a color-coded name per
	// participant above each bubble. Empty for 1:1 chats (the conversation header already names them).
	senderName, senderJID := "", ""

	if v.Info.IsGroup {
		// One synthetic contact + conversation per group, keyed by the group JID.
		groupJID := v.Info.Chat.String()
		partner = groupJID // for the trailing log line
		gerr := m.db.QueryRowContext(ctx,
			`SELECT id, contact_id, unread, muted FROM conversations WHERE business_id=$1 AND group_jid=$2 LIMIT 1`,
			s.BusinessID, groupJID).Scan(&convID, &contactID, &unread, &muted)
		if gerr == sql.ErrNoRows {
			subject := m.groupSubject(ctx, client, v.Info.Chat)
			if ierr := m.db.QueryRowContext(ctx,
				`INSERT INTO contacts (business_id, name, is_group) VALUES ($1,$2,true) RETURNING id`,
				s.BusinessID, subject).Scan(&contactID); ierr != nil {
				m.log.Errorf("group contact insert: %v", ierr)
				return
			}
			if ierr := m.db.QueryRowContext(ctx,
				`INSERT INTO conversations (business_id, contact_id, status, unread, is_group, group_jid, group_subject, number_phone)
				 VALUES ($1,$2,'open',0,true,$3,$4,NULLIF($5,'')) RETURNING id`,
				s.BusinessID, contactID, groupJID, subject, bizPhone(client)).Scan(&convID); ierr != nil {
				m.log.Errorf("group conv insert: %v", ierr)
				return
			}
			unread = 0
		} else if gerr != nil {
			return
		}
		// Who in the group sent it (your own messages render on the right with no name).
		if !v.Info.IsFromMe {
			senderName = v.Info.PushName
			if senderName == "" {
				senderName = "+" + v.Info.Sender.User
			}
			senderJID = v.Info.Sender.ToNonAD().String() // strip device → stable key for @mentions
		}
	} else {
		// The conversation partner is the other side of the chat (Info.Chat),
		// whether the message is inbound or one you sent from your phone.
		partner = partnerPhone(v.Info)
		name := partner
		if !v.Info.IsFromMe && v.Info.PushName != "" {
			name = v.Info.PushName
		}
		err := m.db.QueryRowContext(ctx,
			`SELECT id FROM contacts WHERE business_id=$1 AND phone=$2`, s.BusinessID, partner).Scan(&contactID)
		if err == sql.ErrNoRows {
			if err = m.db.QueryRowContext(ctx,
				`INSERT INTO contacts (business_id, name, phone) VALUES ($1,$2,$3) RETURNING id`,
				s.BusinessID, name, partner).Scan(&contactID); err != nil {
				m.log.Errorf("contact insert: %v", err)
				return
			}
		} else if err != nil {
			return
		}
		m.wantContactInfo(ctx, contactID)
		// Reuse the contact's most recent conversation — including a resolved one — so the full history
		// stays in a single thread. A customer who comes back a week after being resolved lands in the
		// same chat (it gets reopened below), instead of a fresh conversation with no past context.
		err = m.db.QueryRowContext(ctx,
			`SELECT id, unread, muted, status FROM conversations
			  WHERE business_id=$1 AND contact_id=$2
			  ORDER BY last_message_at DESC LIMIT 1`, s.BusinessID, contactID).Scan(&convID, &unread, &muted, &priorStatus)
		if err == sql.ErrNoRows {
			if err = m.db.QueryRowContext(ctx,
				`INSERT INTO conversations (business_id, contact_id, status, unread, number_phone)
				 VALUES ($1,$2,'open',0,NULLIF($3,'')) RETURNING id`, s.BusinessID, contactID, bizPhone(client)).Scan(&convID); err != nil {
				m.log.Errorf("conv insert: %v", err)
				return
			}
			unread, priorStatus = 0, "open"
		} else if err != nil {
			return
		}
	}

	// El hilo tiene que quedar SELLADO con el número que lo atendió (number_phone, 0078), y este es
	// el único camino que no lo hacía: las llamadas y los mensajes indescifrables sí lo sellaban,
	// pero el mensaje entrante normal —- el que crea el 99% de los chats —- lo dejaba en NULL.
	//
	// Un NULL ahí no es un hueco cosmético: la lista de chats filtra por `number_phone = <número
	// conectado>`, y NULL nunca es igual a nada, así que el chat EXISTE, recibe mensajes, suma sin
	// leer y hasta manda notificación —- pero no se ve en ninguna parte. Solo se puede llegar a él
	// tocando la notificación.
	//
	// Llevaba así desde 0078 y no se notó porque el manejador de `Connected` reclama los NULL en
	// cada reconexión: mientras hubiera despliegues seguidos, el agujero se tapaba solo en minutos.
	// En cuanto el worker aguantó un día entero sin reiniciarse, los NULL se quedaron.
	//
	// Sellar aquí también (y no solo al insertar) reclama los hilos que ya quedaron en NULL: en
	// cuanto llega su siguiente mensaje vuelven a la lista, sin esperar a la próxima reconexión.
	m.exec(ctx, `UPDATE conversations SET number_phone=NULLIF($1,'') WHERE id=$2 AND number_phone IS NULL`, bizPhone(client), convID)

	// "Stop listening": the conversation is muted → drop this message (don't store it).
	if muted {
		m.log.Infof("muted conv %s — dropping %s message", convID, dir)
		return
	}

	// Media: los pesados NO se bajan. Se guarda el puntero y se materializan cuando alguien los
	// abra; los que nadie abre nunca ocupan storage.
	mediaURL := ""
	var mediaPtr interface{}
	var mediaSize interface{}
	if mtype != "text" {
		dl, kind, size := downloadableOf(msg)
		if size > 0 {
			mediaSize = int64(size)
		}
		// size == 0 significa que WhatsApp no declaró el tamaño, y entonces bajarlo es apostar a
		// ciegas: si resulta enorme, se lleva la instancia por delante. Se difiere igual que los
		// pesados —- el usuario lo abre con un toque cuando lo necesite— en vez de arriesgar el
		// worker por un archivo que ni sabemos cuánto pesa.
		if dl != nil && (size >= bigMediaBytes || size == 0) {
			mediaPtr = jsonStr(map[string]interface{}{
				"direct_path":  dl.GetDirectPath(),
				"media_key":    dl.GetMediaKey(),
				"file_sha":     dl.GetFileSHA256(),
				"file_enc_sha": dl.GetFileEncSHA256(),
				"kind":         kind,
			})
			if size == 0 {
				m.log.Infof("media %s diferida: WhatsApp no declaró el tamaño", waID)
			} else {
				m.log.Infof("media %s deferred (%d bytes) — se bajará bajo demanda", waID, size)
			}
		} else {
			// Bajar, subir y miniaturizar va bajo el tope global de adjuntos: es donde el worker
			// gasta la memoria, y sin tope varios adjuntos a la vez se comen los 512 MB.
			m.withMedia(ctx, fmt.Sprintf("entrante %s (%s, %d bytes)", waID, mtype, size), func() {
				data, derr := client.DownloadAny(ctx, msg)
				if derr != nil {
					m.log.Errorf("media download: %v", derr)
					return
				}
				if len(data) == 0 {
					return
				}
				path := fmt.Sprintf("%s/in/%s.%s", s.BusinessID, waID, extFromMime(mmime))
				if u, uerr := m.uploadMedia(ctx, path, data, firstNonEmpty(mmime, "application/octet-stream")); uerr == nil {
					mediaURL = u
				} else {
					m.log.Errorf("media upload: %v", uerr)
				}
				// Miniatura propia SIEMPRE que tengamos los bytes, aunque WhatsApp haya mandado la
				// suya: la de WhatsApp es una estampilla (~34x60 px) y en la burbuja se ve
				// destrozada —- fue exactamente el "se ve muy muy mal". La suya queda solo de
				// respaldo para los diferidos (>20MB), donde no hay bytes con qué generar la
				// nuestra. makeThumb se salta sola las fotos demasiado grandes para decodificar.
				if mtype == "image" {
					if t := makeThumb(data); t != "" {
						meta = withThumbJSON(meta, t)
					}
				}
			})
		}
	}
	body := text
	if body == "" && mname != "" {
		body = mname
	}

	// If this message quotes another (a reply), link it to our stored message so it renders as a reply.
	var replyTo interface{}
	if ci != nil && ci.GetStanzaID() != "" {
		var rid string
		if e := m.db.QueryRowContext(ctx,
			`SELECT id FROM messages WHERE business_id=$1 AND wa_id=$2 LIMIT 1`, s.BusinessID, ci.GetStanzaID()).Scan(&rid); e == nil {
			replyTo = rid
		}
	}

	// Respuesta a una HISTORIA (status). Llega como un mensaje normal dentro del chat del contacto,
	// pero su ContextInfo apunta a status@broadcast y trae la historia citada adentro. Sin esto el
	// agente veía un "me encanta 😍" suelto, sin manera de saber a qué le estaban contestando.
	//
	// Las historias no se ingieren como mensajes (status@broadcast se ignora como chat), así que no
	// hay fila a la cual apuntar con reply_to: la cita viaja dentro del propio meta del mensaje.
	if ci != nil && strings.HasPrefix(ci.GetRemoteJID(), "status@broadcast") {
		story := map[string]interface{}{"type": "text"}
		if q := ci.GetQuotedMessage(); q != nil {
			switch {
			case q.GetImageMessage() != nil:
				story["type"] = "image"
				story["caption"] = q.GetImageMessage().GetCaption()
			case q.GetVideoMessage() != nil:
				story["type"] = "video"
				story["caption"] = q.GetVideoMessage().GetCaption()
			default:
				// Historia de solo texto (la de fondo de color): el texto ES la historia.
				story["caption"] = firstNonEmpty(q.GetConversation(), q.GetExtendedTextMessage().GetText())
			}
			// La historia se baja bajo el MISMO tope de memoria que cualquier adjunto, y una pesada
			// se deja pasar: saber que respondieron a la historia ya vale por sí solo, y no vale
			// trabar el worker por un archivo que quizá nadie abra. Ojo: una historia caduca a las
			// 24 h en WhatsApp, así que si no se baja ahora ya no hay segunda oportunidad —- por eso
			// no se difiere con un puntero como el resto de la media.
			if dl, _, size := downloadableOf(q); dl != nil && size > 0 && size < bigMediaBytes {
				m.withMedia(ctx, fmt.Sprintf("historia citada %s (%d bytes)", waID, size), func() {
					data, derr := client.DownloadAny(ctx, q)
					if derr != nil || len(data) == 0 {
						m.log.Errorf("story download: %v", derr)
						return
					}
					smime := firstNonEmpty(q.GetImageMessage().GetMimetype(), q.GetVideoMessage().GetMimetype(), "application/octet-stream")
					if p, uerr := m.uploadMedia(ctx, fmt.Sprintf("%s/story/%s.%s", s.BusinessID, waID, extFromMime(smime)), data, smime); uerr == nil {
						story["path"] = p
						story["mime"] = smime
					} else {
						m.log.Errorf("story upload: %v", uerr)
					}
					// Miniatura propia para la cita: se pinta sin tener que firmar nada, y si la
					// subida falló sigue siendo lo único que queda de la historia.
					if story["type"] == "image" {
						if t := makeThumb(data); t != "" {
							story["thumb"] = t
						}
					}
				})
			}
		}
		meta = withStoryJSON(meta, story)
		m.log.Infof("respuesta a historia %s (tipo %v)", waID, story["type"])
	}

	m.exec(ctx, `INSERT INTO messages (business_id, conversation_id, direction, type, body, state, wa_id, media_url, media_mime, media_name, forwarded, meta, reply_to, sender_name, sender_jid, media_ptr, media_size)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
		s.BusinessID, convID, dir, mtype, encryptBody(s.BusinessID, body), state, waID, nullIf(mediaURL), nullIf(mmime), nullIf(mname), forwarded, nullIf(meta), replyTo, nullIf(senderName), nullIf(senderJID), mediaPtr, mediaSize)
	// A resolved chat that gets a new message (either side) is reopened so it leaves the resolved
	// bucket and the agent sees it — with the full prior history intact.
	reopened := priorStatus == "resolved"
	if reopened {
		m.exec(ctx, `INSERT INTO events (business_id, parent_type, parent_id, kind, text)
			VALUES ($1,'conversation',$2,'status','Reabierto por nuevo mensaje')`, s.BusinessID, convID)
	}
	if dir == "in" {
		// A new customer message resurfaces the chat: clear snooze/hidden and reopen if it was resolved.
		// A reactivated chat (resolved → open) comes back UNASSIGNED so anyone can take it — except a
		// pinned one ("mantener conmigo"), which returns to locked_to. An already-open chat keeps its
		// agent (restored from locked_to if pinned).
		m.exec(ctx, `UPDATE conversations SET unread=$1, last_message_at=now(), snoozed_until=NULL, hidden=false,
			status = CASE WHEN status='resolved' THEN 'open' ELSE status END,
			assignee_id = CASE WHEN status='resolved' THEN locked_to ELSE coalesce(locked_to, assignee_id) END
			WHERE id=$2`, unread+1, convID)
		// Off-hours / holiday auto-reply (schedule-based flows). 1:1 chats only — groups never auto-reply.
		if !v.Info.IsGroup {
			m.runScheduleAutomations(ctx, s.BusinessID, convID)
		}

		// Notificación push. Hasta ahora avisar dependía de tener la pestaña abierta —- el aviso lo
		// pintaba el navegador al oír a Supabase —- así que con la app cerrada no llegaba nada. Se le
		// reporta a la app, que decide a quién le toca (asignado, o todo el equipo si nadie lo ha
		// tomado) con las preferencias de cada quien.
		//
		// En goroutine: el mensaje ya está guardado y la app podría estar lenta o caída. Un aviso
		// que no sale es un aviso perdido; frenar la ingesta por esperarlo sería perder mensajes.
		title := senderName
		if title == "" {
			_ = m.db.QueryRowContext(ctx, `SELECT coalesce(c.name,'') FROM conversations cv JOIN contacts c ON c.id=cv.contact_id WHERE cv.id=$1`, convID).Scan(&title)
		}
		if title == "" {
			title = partner
		}
		go m.notifyPush(s.BusinessID, convID, title, pushPreview(mtype, body))
	} else {
		// Outbound — including a reply you sent from your phone. It's been answered, so clear the
		// unread/pending marker; reopen if it was resolved.
		m.exec(ctx, `UPDATE conversations SET last_message_at=now(), unread=0,
			status = CASE WHEN status='resolved' THEN 'open' ELSE status END WHERE id=$1`, convID)
	}
	m.log.Infof("saved %s %s from/to %s", dir, mtype, partner)
}

// pushPreview: qué se lee en la notificación. Un adjunto no trae texto, así que se nombra el tipo.
// El cuerpo se recorta porque una notificación no es el mensaje, es el aviso de que llegó uno.
//
// OJO: `body` aquí es texto PLANO (el cifrado se aplica al guardar, no antes), así que esto se
// llama con lo que se escribió, no con `encm:v1:…`.
func pushPreview(mtype, body string) string {
	if t := strings.TrimSpace(body); t != "" {
		r := []rune(t)
		if len(r) > 120 {
			return string(r[:120])
		}
		return t
	}
	switch mtype {
	case "image":
		return "📷 Foto"
	case "video":
		return "🎥 Video"
	case "audio":
		return "🎤 Audio"
	case "sticker":
		return "🈸 Sticker"
	case "document":
		return "📄 Documento"
	case "location":
		return "📍 Ubicación"
	case "contact":
		return "👤 Contacto"
	case "call":
		return "📞 Llamada"
	default:
		return "Mensaje nuevo"
	}
}

// ---------------------------------------------------------------- media bajo demanda

// bigMediaBytes: por encima de esto NO se bajan los bytes; se guarda solo el puntero de WhatsApp y
// el archivo se materializa la primera vez que alguien lo abre. Los pesados que nadie abre nunca
// llegan a ocupar storage.
const bigMediaBytes = 20 * 1024 * 1024

// mediaPointer son los datos mínimos para volver a bajar el archivo más tarde. Ocupa unos cientos
// de bytes frente a decenas de MB.
//
// Vive con fecha de caducidad: WhatsApp purga su CDN (entrante ~7 días, saliente ~30) y después
// esto devuelve 404 sin remedio. Es el precio de no guardar el archivo.
type mediaPointer struct {
	DirectPath  string `json:"direct_path"`
	MediaKey    []byte `json:"media_key"`
	FileSHA     []byte `json:"file_sha"`
	FileEncSHA2 []byte `json:"file_enc_sha"`
	Kind        string `json:"kind"` // image | video | audio | document | sticker
}

// downloadableOf devuelve la parte descargable del mensaje junto a su tamaño declarado.
func downloadableOf(msg *waE2E.Message) (whatsmeow.DownloadableMessage, string, uint64) {
	switch {
	case msg.GetImageMessage() != nil:
		return msg.GetImageMessage(), "image", msg.GetImageMessage().GetFileLength()
	case msg.GetVideoMessage() != nil:
		return msg.GetVideoMessage(), "video", msg.GetVideoMessage().GetFileLength()
	case msg.GetAudioMessage() != nil:
		return msg.GetAudioMessage(), "audio", msg.GetAudioMessage().GetFileLength()
	case msg.GetDocumentMessage() != nil:
		return msg.GetDocumentMessage(), "document", msg.GetDocumentMessage().GetFileLength()
	case msg.GetStickerMessage() != nil:
		return msg.GetStickerMessage(), "sticker", msg.GetStickerMessage().GetFileLength()
	}
	return nil, "", 0
}

func mediaTypeOf(kind string) whatsmeow.MediaType {
	switch kind {
	case "image", "sticker":
		return whatsmeow.MediaImage
	case "video":
		return whatsmeow.MediaVideo
	case "audio":
		return whatsmeow.MediaAudio
	default:
		return whatsmeow.MediaDocument
	}
}

func mmsTypeOf(kind string) string {
	switch kind {
	case "image", "sticker":
		return "image"
	case "video":
		return "video"
	case "audio":
		return "audio"
	default:
		return "document"
	}
}

// fetchDeferredMedia baja un adjunto que se dejó pendiente y lo guarda. Lo dispara la app poniendo
// pending_op='fetch_media'.
func (m *Manager) fetchDeferredMedia(ctx context.Context, client *whatsmeow.Client, id, biz, waID string, ptrJSON string) {
	var p mediaPointer
	if err := json.Unmarshal([]byte(ptrJSON), &p); err != nil || p.DirectPath == "" {
		m.exec(ctx, `UPDATE messages SET pending_op=NULL, media_fetch_error='bad-pointer' WHERE id=$1`, id)
		return
	}

	// Estos son, por definición, los archivos más pesados que toca el worker: se difirieron por
	// pasar de 20 MB. Si el tamaño guardado ya no cabe, se falla SIN bajarlo.
	var size sql.NullInt64
	_ = m.db.QueryRowContext(ctx, `SELECT media_size FROM messages WHERE id=$1`, id).Scan(&size)
	if size.Valid && size.Int64 > maxMediaBytes {
		m.log.Errorf("deferred media %s: %d MB no cabe en esta instancia", id, size.Int64/(1024*1024))
		m.exec(ctx, `UPDATE messages SET pending_op=NULL, media_fetch_error='too-big' WHERE id=$1`, id)
		return
	}

	// El pending_op se limpia ANTES de bajar nada, y esto es lo que rompe el bucle.
	//
	// Antes solo se limpiaba al terminar, así que si el worker moría durante la descarga —- justo lo
	// que pasa con un archivo enorme—, al reiniciar encontraba la misma petición intacta y volvía a
	// intentarlo. Arrancar, bajar, morir, arrancar: un solo archivo dejaba al worker en un bucle del
	// que no salía solo, y se llevaba por delante la sesión de WhatsApp de TODOS los negocios.
	//
	// Ahora un intento que mata al proceso deja la marca de interrumpido y no se repite: el usuario
	// vuelve a tocar "descargar" si lo quiere, y mientras tanto el worker vive.
	m.exec(ctx, `UPDATE messages SET pending_op=NULL, media_fetch_error='interrumpido' WHERE id=$1`, id)
	// Es el adjunto más pesado que maneja el worker (por definición: se difirió por pasar de 20 MB),
	// así que es el que más necesita esperar turno bajo el tope global.
	var data []byte
	var err error
	if !m.withMedia(ctx, "descarga bajo demanda "+id, func() {
		data, err = client.DownloadMediaWithPath(ctx, p.DirectPath, p.FileEncSHA2, p.FileSHA, p.MediaKey, mediaTypeOf(p.Kind), mmsTypeOf(p.Kind), true)
	}) {
		return
	}
	if err != nil || len(data) == 0 {
		// El caso frecuente es que WhatsApp ya lo purgó. Se distingue para que la UI pueda decir
		// "caducó, pídelo de nuevo" en vez de un error genérico.
		reason := "failed"
		if err != nil && (strings.Contains(err.Error(), "404") || errors.Is(err, whatsmeow.ErrMediaDownloadFailedWith404) || errors.Is(err, whatsmeow.ErrMediaDownloadFailedWith410)) {
			reason = "expired"
		}
		m.log.Errorf("deferred media %s: %v", id, err)
		m.exec(ctx, `UPDATE messages SET pending_op=NULL, media_fetch_error=$2 WHERE id=$1`, id, reason)
		return
	}
	var mmime string
	_ = m.db.QueryRowContext(ctx, `SELECT COALESCE(media_mime,'') FROM messages WHERE id=$1`, id).Scan(&mmime)
	path := fmt.Sprintf("%s/in/%s.%s", biz, waID, extFromMime(mmime))
	u, uerr := m.uploadMedia(ctx, path, data, firstNonEmpty(mmime, "application/octet-stream"))
	if uerr != nil {
		m.exec(ctx, `UPDATE messages SET pending_op=NULL, media_fetch_error='upload' WHERE id=$1`, id)
		return
	}
	// media_ptr se limpia: ya no hace falta y deja claro que el archivo está guardado.
	m.exec(ctx, `UPDATE messages SET media_url=$2, media_ptr=NULL, media_fetch_error=NULL, pending_op=NULL WHERE id=$1`, id, u)
	m.log.Infof("deferred media %s downloaded (%d bytes)", id, len(data))
}

// dayCfg is one weekday's business hours (message_hours, per-day schedule).
type dayCfg struct {
	Open bool   `json:"open"`
	From string `json:"from"` // "HH:MM"
	To   string `json:"to"`   // "HH:MM"
}

// scheduleCfg is the per-flow config stored in automations.trigger_config for the time/date triggers.
type scheduleCfg struct {
	Days          map[string]dayCfg `json:"days"`      // "0".."6" (Sun..Sat) business hours (message_hours)
	OpenFrom      string            `json:"open_from"` // legacy single-window open (message_hours)
	OpenTo        string            `json:"open_to"`   // legacy single-window close
	Date          string            `json:"date"`      // "YYYY-MM-DD" holiday (message_date)
	Recurring     bool              `json:"recurring"` // holiday repeats every year (month+day only)
	CooldownHours int               `json:"cooldown_hours"`
}

var placeholderRe = regexp.MustCompile(`{{[^}]*}}`)

// hhmmToMin parses "HH:MM" into minutes-since-midnight; -1 if malformed.
func hhmmToMin(s string) int {
	var h, mn int
	if _, err := fmt.Sscanf(strings.TrimSpace(s), "%d:%d", &h, &mn); err != nil {
		return -1
	}
	if h < 0 || h > 23 || mn < 0 || mn > 59 {
		return -1
	}
	return h*60 + mn
}

// runScheduleAutomations sends an off-hours / holiday auto-reply when an inbound 1:1 message lands
// outside business hours or on a configured holiday — throttled per conversation by cooldown_hours.
func (m *Manager) runScheduleAutomations(ctx context.Context, businessID, convID string) {
	// Los flujos se consultan ANTES que la zona horaria: esto corre en cada mensaje entrante y la
	// inmensa mayoría de los negocios no tiene ningún flujo de horario configurado, así que pedir
	// primero la zona era una ida y vuelta a la base por mensaje que no servía para nada.
	rows, err := m.db.QueryContext(ctx,
		`SELECT id, trigger_type, action_payload, trigger_config
		   FROM automations
		  WHERE business_id=$1 AND enabled=true AND action_type='send_template'
		    AND trigger_type IN ('message_hours','message_date')`, businessID)
	if err != nil {
		return
	}
	defer rows.Close()

	type flow struct {
		id, ttype, template string
		cfg                 scheduleCfg
	}
	var flows []flow
	for rows.Next() {
		var id, ttype string
		var payloadRaw, cfgRaw []byte
		if err := rows.Scan(&id, &ttype, &payloadRaw, &cfgRaw); err != nil {
			continue
		}
		var payload struct {
			Template string `json:"template"`
		}
		_ = json.Unmarshal(payloadRaw, &payload)
		var cfg scheduleCfg
		_ = json.Unmarshal(cfgRaw, &cfg)
		if payload.Template == "" {
			continue
		}
		flows = append(flows, flow{id: id, ttype: ttype, template: payload.Template, cfg: cfg})
	}
	rows.Close()
	if len(flows) == 0 {
		return
	}

	// Resolve the business timezone; fall back to a sane default if missing/invalid.
	tz := "America/Mexico_City"
	_ = m.db.QueryRowContext(ctx, `SELECT coalesce(timezone, 'America/Mexico_City') FROM businesses WHERE id=$1`, businessID).Scan(&tz)
	loc, lerr := time.LoadLocation(tz)
	if lerr != nil {
		m.log.Warnf("bad timezone %q for business %s: %v", tz, businessID, lerr)
		loc = time.UTC
	}
	now := time.Now().In(loc)

	for _, f := range flows {
		match := false
		switch f.ttype {
		case "message_hours":
			// Resolve today's hours from the per-day schedule, falling back to the legacy single window.
			day, hasDay := dayCfg{}, false
			if f.cfg.Days != nil {
				if d, ok := f.cfg.Days[strconv.Itoa(int(now.Weekday()))]; ok { // Weekday: Sun=0..Sat=6
					day, hasDay = d, true
				}
			}
			if !hasDay && f.cfg.OpenFrom != "" && f.cfg.OpenTo != "" {
				day, hasDay = dayCfg{Open: true, From: f.cfg.OpenFrom, To: f.cfg.OpenTo}, true
			}
			if hasDay {
				if !day.Open {
					match = true // closed all day → always outside hours
				} else {
					openMin, closeMin := hhmmToMin(day.From), hhmmToMin(day.To)
					if openMin >= 0 && closeMin >= 0 && openMin != closeMin {
						nowMin := now.Hour()*60 + now.Minute()
						if openMin < closeMin {
							match = nowMin < openMin || nowMin >= closeMin // outside daytime hours
						} else {
							// Overnight business (opens in the evening) — closed window is [close, open).
							match = nowMin >= closeMin && nowMin < openMin
						}
					}
				}
			}
		case "message_date":
			if d, derr := time.Parse("2006-01-02", strings.TrimSpace(f.cfg.Date)); derr == nil {
				if f.cfg.Recurring {
					match = d.Month() == now.Month() && d.Day() == now.Day()
				} else {
					match = d.Year() == now.Year() && d.Month() == now.Month() && d.Day() == now.Day()
				}
			}
		}
		if !match {
			continue
		}

		// Throttle: skip if we already auto-replied to this conversation within the cooldown window.
		cool := f.cfg.CooldownHours
		if cool < 0 {
			cool = 0
		}
		var recently bool
		_ = m.db.QueryRowContext(ctx,
			`SELECT EXISTS(SELECT 1 FROM messages
			   WHERE conversation_id=$1 AND direction='out' AND (meta->>'autoreply')='true'
			     AND created_at > now() - make_interval(hours => $2))`, convID, cool).Scan(&recently)
		if recently {
			continue
		}

		// Resolve the template body + a friendly first name for {{name}}; strip any other placeholders.
		var bodyTpl string
		if err := m.db.QueryRowContext(ctx, `SELECT body FROM canned_messages WHERE business_id=$1 AND title=$2 LIMIT 1`, businessID, f.template).Scan(&bodyTpl); err != nil || strings.TrimSpace(bodyTpl) == "" {
			continue
		}
		var contactName string
		_ = m.db.QueryRowContext(ctx, `SELECT coalesce(c.name,'') FROM conversations cv JOIN contacts c ON c.id=cv.contact_id WHERE cv.id=$1`, convID).Scan(&contactName)
		first := contactName
		if i := strings.IndexByte(first, ' '); i > 0 {
			first = first[:i]
		}
		out := strings.ReplaceAll(bodyTpl, "{{name}}", first)
		out = placeholderRe.ReplaceAllString(out, "")
		out = strings.TrimSpace(out)
		if out == "" {
			continue
		}

		m.exec(ctx, `INSERT INTO messages (business_id, conversation_id, direction, type, body, state, meta)
			VALUES ($1,$2,'out','text',$3,'queued','{"autoreply":true}'::jsonb)`, businessID, convID, encryptBody(businessID, out))
		m.exec(ctx, `UPDATE conversations SET last_message_at=now() WHERE id=$1`, convID)
		m.exec(ctx, `UPDATE automations SET runs = coalesce(runs,0)+1 WHERE id=$1`, f.id)
		m.log.Infof("auto-reply (%s) sent to conv %s", f.ttype, convID)
	}
}

// allowGroups reports whether the business has opted into group chats (default off).
func (m *Manager) allowGroups(ctx context.Context, businessID string) bool {
	allow := false
	if err := m.db.QueryRowContext(ctx, `SELECT coalesce(allow_groups, false) FROM businesses WHERE id=$1`, businessID).Scan(&allow); err != nil {
		return false
	}
	return allow
}

// groupSubject resolves a group's display name, falling back to the JID's local part.
func (m *Manager) groupSubject(ctx context.Context, client *whatsmeow.Client, jid types.JID) string {
	if gi, err := client.GetGroupInfo(ctx, jid); err == nil && gi.Name != "" {
		return gi.Name
	}
	return "Grupo " + jid.User
}

func nullIf(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// withStoryJSON mete la historia citada en un `meta` ya serializado, sin pisar lo que traía
// (una respuesta a historia puede ser a su vez una foto, con su propio w/h y miniatura).
func withStoryJSON(metaJSON string, story map[string]interface{}) string {
	m := map[string]interface{}{}
	if metaJSON != "" {
		_ = json.Unmarshal([]byte(metaJSON), &m)
	}
	m["story"] = story
	return jsonStr(m)
}

func jsonStr(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}

// getContextInfo returns the message's ContextInfo (for forwarded/quoted detection).
func getContextInfo(m *waE2E.Message) *waE2E.ContextInfo {
	switch {
	case m.GetExtendedTextMessage() != nil:
		return m.GetExtendedTextMessage().GetContextInfo()
	case m.GetImageMessage() != nil:
		return m.GetImageMessage().GetContextInfo()
	case m.GetVideoMessage() != nil:
		return m.GetVideoMessage().GetContextInfo()
	case m.GetAudioMessage() != nil:
		return m.GetAudioMessage().GetContextInfo()
	case m.GetDocumentMessage() != nil:
		return m.GetDocumentMessage().GetContextInfo()
	case m.GetStickerMessage() != nil:
		return m.GetStickerMessage().GetContextInfo()
	case m.GetLocationMessage() != nil:
		return m.GetLocationMessage().GetContextInfo()
	case m.GetContactMessage() != nil:
		return m.GetContactMessage().GetContextInfo()
	}
	return nil
}

// handleProtocol applies an inbound edit or revoke to the referenced message.
func (m *Manager) handleProtocol(ctx context.Context, s session, pm *waE2E.ProtocolMessage) {
	key := pm.GetKey()
	if key == nil || key.GetID() == "" {
		return
	}
	target := key.GetID()
	switch pm.GetType() {
	case waE2E.ProtocolMessage_REVOKE:
		m.exec(ctx, `UPDATE messages SET deleted=true, body='' WHERE business_id=$1 AND wa_id=$2`, s.BusinessID, target)
		m.log.Infof("inbound revoke %s", target)
	case waE2E.ProtocolMessage_MESSAGE_EDIT:
		em := pm.GetEditedMessage()
		txt := em.GetConversation()
		if txt == "" {
			txt = em.GetExtendedTextMessage().GetText()
		}
		m.exec(ctx, `UPDATE messages SET body=$3, edited=true WHERE business_id=$1 AND wa_id=$2`, s.BusinessID, target, encryptBody(s.BusinessID, txt))
		m.log.Infof("inbound edit %s", target)
	}
}

type outMsg struct {
	id, biz, conv, body, mtype, murl, mmime, mname, replyTo, meta string
	waID                                                          string // id propio, fijado al reclamar y reutilizado en cada reintento
	attempts                                                      int
}

// mentionJIDs extracts the participant JIDs to @mention from a message's meta JSON
// ({"mentions":[{"jid":"123@s.whatsapp.net","name":"Ana"}]}). Empty if none / unparseable.
func mentionJIDs(meta string) []string {
	if meta == "" {
		return nil
	}
	var m struct {
		Mentions []struct {
			JID string `json:"jid"`
		} `json:"mentions"`
	}
	if err := json.Unmarshal([]byte(meta), &m); err != nil {
		return nil
	}
	out := make([]string, 0, len(m.Mentions))
	for _, mn := range m.Mentions {
		if mn.JID != "" {
			out = append(out, mn.JID)
		}
	}
	return out
}

const maxSendAttempts = 6

// retryOrFail re-queues a transient send failure with exponential backoff, or marks it failed
// once it has exhausted maxSendAttempts (then only a manual retry will resend it).
func (m *Manager) retryOrFail(ctx context.Context, o outMsg, reason string) {
	next := o.attempts + 1
	if next >= maxSendAttempts {
		m.log.Errorf("send %s failed (giving up after %d): %s", o.id, next, reason)
		m.exec(ctx, `UPDATE messages SET state='failed', send_attempts=$2, fail_reason=$3 WHERE id=$1`, o.id, next, reason)
		return
	}
	backoff := 3 << uint(o.attempts) // 3,6,12,24,48s
	if backoff > 90 {
		backoff = 90
	}
	m.log.Warnf("send %s failed (attempt %d, retry in %ds): %s", o.id, next, backoff, reason)
	// claimed_at se limpia al soltar el mensaje: si no, el rescate de envíos colgados lo contaría
	// como "reclamado hace rato" y lo re-encolaría por su cuenta además del reintento.
	m.exec(ctx, `UPDATE messages SET state='queued', claimed_at=NULL, send_attempts=$2, next_retry_at=now() + ($3 || ' seconds')::interval WHERE id=$1`, o.id, next, backoff)
}

// sendOutbound returns true only if the message was actually sent (so the poll loop can drain
// the next in-order message quickly instead of waiting a full poll interval).
func (m *Manager) sendOutbound(ctx context.Context, o outMsg) bool {
	m.mu.Lock()
	client := m.byBiz[o.biz]
	m.mu.Unlock()
	if client == nil || !client.IsConnected() {
		// Not actually connected (e.g. mid-reconnect) — leave queued, don't burn a failed attempt
		// on a dead socket. pollOutbound retries once the session is back.
		return false
	}

	// Un id de mensaje propio, guardado ANTES de mandarlo y reutilizado en cada reintento. Resuelve
	// dos cosas a la vez:
	//   - WhatsApp descarta por id el reenvío de algo que ya le había llegado. Antes, si el acuse
	//     se perdía (SendMessage devuelve error aunque el mensaje sí haya salido), el reintento le
	//     llegaba al cliente como un mensaje repetido mientras la app mostraba uno solo o "falló".
	//   - El eco que WhatsApp nos devuelve de nuestro propio mensaje ya encuentra la fila por wa_id
	//     y no crea una segunda. Antes, si el eco llegaba antes de que guardáramos el wa_id, el
	//     chat mostraba el mensaje duplicado.
	waID := o.waID
	if waID == "" {
		waID = string(client.GenerateMessageID())
	}

	// Claim atomically so a restart can't double-send.
	res, err := m.db.ExecContext(ctx,
		`UPDATE messages SET state='sending', claimed_at=now(), wa_id=$2 WHERE id=$1 AND state='queued'`, o.id, waID)
	if err != nil {
		return false
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return false
	}
	m.log.Infof("→ sending %s (%s, attempt %d)", o.id, o.mtype, o.attempts)

	var phone, groupJID sql.NullString
	var isGroup bool
	if perr := m.db.QueryRowContext(ctx,
		`SELECT c.phone, cv.group_jid, cv.is_group FROM conversations cv LEFT JOIN contacts c ON c.id = cv.contact_id WHERE cv.id=$1`, o.conv).
		Scan(&phone, &groupJID, &isGroup); perr != nil {
		// Transient DB hiccup (pooler) — retry with backoff instead of silently failing.
		m.retryOrFail(ctx, o, "phone lookup: "+perr.Error())
		return false
	}
	var jid types.JID
	if isGroup {
		if !groupJID.Valid || groupJID.String == "" {
			m.exec(ctx, `UPDATE messages SET state='failed', fail_reason='group conversation missing JID' WHERE id=$1`, o.id)
			return false
		}
		parsed, jerr := types.ParseJID(groupJID.String)
		if jerr != nil {
			m.exec(ctx, `UPDATE messages SET state='failed', fail_reason='bad group JID' WHERE id=$1`, o.id)
			return false
		}
		jid = parsed
	} else {
		if !phone.Valid || digits(phone.String) == "" {
			m.log.Errorf("send %s failed: no phone on conversation %s", o.id, o.conv)
			m.exec(ctx, `UPDATE messages SET state='failed', fail_reason='no phone on conversation' WHERE id=$1`, o.id)
			return false
		}
		jid = types.NewJID(digits(phone.String), types.DefaultUserServer)
	}

	waMsg, err := m.buildOutboundMessage(ctx, client, o)
	if err != nil {
		if errors.Is(err, errMediaTooBig) {
			// Falla directo y con motivo visible: reintentar seis veces solo repetiría el pico de
			// memoria, y el usuario merece saber por qué no salió en vez de ver el relojito.
			m.log.Errorf("send %s: %v", o.id, err)
			m.exec(ctx, `UPDATE messages SET state='failed', fail_reason=$2 WHERE id=$1`, o.id, err.Error())
			return false
		}
		m.retryOrFail(ctx, o, "build: "+err.Error())
		return false
	}
	// Combine a reply context (if any) with @mentions (group chats) into one ContextInfo.
	var ci *waE2E.ContextInfo
	if o.replyTo != "" {
		ci = m.replyContext(ctx, client, jid, o.replyTo)
	}
	if mentions := mentionJIDs(o.meta); len(mentions) > 0 {
		if ci == nil {
			ci = &waE2E.ContextInfo{}
		}
		ci.MentionedJID = mentions
	}
	if ci != nil {
		attachContext(waMsg, ci)
	}

	// El plazo por defecto de whatsmeow para esperar el acuse son 75 s. Con envíos en paralelo ya no
	// bloquea a los demás, pero 45 s basta: más allá de eso el reintento (idempotente, mismo id) es
	// mejor que seguir ocupando el hueco.
	resp, err := client.SendMessage(ctx, jid, waMsg, whatsmeow.SendRequestExtra{
		ID:      types.MessageID(waID),
		Timeout: 45 * time.Second,
	})
	if err != nil {
		m.retryOrFail(ctx, o, err.Error())
		return false
	}
	m.exec(ctx, `UPDATE messages SET state='sent', wa_id=$2, send_attempts=0, next_retry_at=NULL, claimed_at=NULL WHERE id=$1`, o.id, resp.ID)
	m.log.Infof("sent %s (%s) → %s", o.id, o.mtype, jid)
	return true
}

func (m *Manager) buildOutboundMessage(ctx context.Context, client *whatsmeow.Client, o outMsg) (*waE2E.Message, error) {
	if o.mtype == "text" || o.murl == "" {
		return &waE2E.Message{Conversation: proto.String(o.body)}, nil
	}
	// El adjunto —- bajarlo de storage, cifrarlo y subirlo a WhatsApp —- va bajo el tope global de
	// memoria. El texto no pasa por aquí, así que sigue saliendo en paralelo sin esperar turno.
	var msg *waE2E.Message
	var berr error
	if !m.withMedia(ctx, fmt.Sprintf("saliente %s (%s)", o.id, o.mtype), func() { msg, berr = m.buildOutboundMedia(ctx, client, o) }) {
		return nil, ctx.Err()
	}
	return msg, berr
}

// errMediaTooBig marca un adjunto que no cabe en la instancia. Se distingue del resto de errores
// porque NO tiene sentido reintentarlo: el archivo no va a encoger, y cada reintento repite el pico
// de memoria que tumba el worker.
var errMediaTooBig = errors.New("adjunto demasiado grande para mandarlo desde esta instancia")

func (m *Manager) buildOutboundMedia(ctx context.Context, client *whatsmeow.Client, o outMsg) (*waE2E.Message, error) {
	data, ctype, err := m.fetchMedia(ctx, o.murl)
	if err != nil {
		return nil, err
	}
	if len(data) > maxMediaBytes {
		return nil, fmt.Errorf("%w (%d MB)", errMediaTooBig, len(data)/(1024*1024))
	}
	mime := firstNonEmpty(o.mmime, ctype, "application/octet-stream")
	caption := strOrNil(o.body)

	switch o.mtype {
	case "image":
		up, err := client.Upload(ctx, data, whatsmeow.MediaImage)
		if err != nil {
			return nil, err
		}
		return &waE2E.Message{ImageMessage: &waE2E.ImageMessage{
			Caption: caption, Mimetype: proto.String(mime),
			URL: &up.URL, DirectPath: &up.DirectPath, MediaKey: up.MediaKey,
			FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: &up.FileLength,
		}}, nil
	case "audio":
		up, err := client.Upload(ctx, data, whatsmeow.MediaAudio)
		if err != nil {
			return nil, err
		}
		return &waE2E.Message{AudioMessage: &waE2E.AudioMessage{
			Mimetype: proto.String(mime),
			URL:      &up.URL, DirectPath: &up.DirectPath, MediaKey: up.MediaKey,
			FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: &up.FileLength,
		}}, nil
	case "video":
		up, err := client.Upload(ctx, data, whatsmeow.MediaVideo)
		if err != nil {
			return nil, err
		}
		return &waE2E.Message{VideoMessage: &waE2E.VideoMessage{
			Caption: caption, Mimetype: proto.String(mime),
			URL: &up.URL, DirectPath: &up.DirectPath, MediaKey: up.MediaKey,
			FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: &up.FileLength,
		}}, nil
	case "sticker":
		up, err := client.Upload(ctx, data, whatsmeow.MediaImage)
		if err != nil {
			return nil, err
		}
		return &waE2E.Message{StickerMessage: &waE2E.StickerMessage{
			Mimetype: proto.String("image/webp"),
			URL:      &up.URL, DirectPath: &up.DirectPath, MediaKey: up.MediaKey,
			FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: &up.FileLength,
		}}, nil
	default: // document and anything else
		up, err := client.Upload(ctx, data, whatsmeow.MediaDocument)
		if err != nil {
			return nil, err
		}
		name := firstNonEmpty(o.mname, "archivo")
		return &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{
			FileName: proto.String(name), Title: proto.String(name), Caption: caption, Mimetype: proto.String(mime),
			URL: &up.URL, DirectPath: &up.DirectPath, MediaKey: up.MediaKey,
			FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: &up.FileLength,
		}}, nil
	}
}

func strOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// replyContext builds the quoted-message context for a reply.
func (m *Manager) replyContext(ctx context.Context, client *whatsmeow.Client, chatJID types.JID, replyToID string) *waE2E.ContextInfo {
	var waID, body, dir, biz sql.NullString
	if err := m.db.QueryRowContext(ctx,
		`SELECT wa_id, body, direction, business_id FROM messages WHERE id=$1`, replyToID).Scan(&waID, &body, &dir, &biz); err != nil || !waID.Valid || waID.String == "" {
		return nil
	}
	participant := chatJID.String()
	if dir.String == "out" && client.Store.ID != nil {
		participant = client.Store.ID.ToNonAD().String()
	}
	return &waE2E.ContextInfo{
		StanzaID:      proto.String(waID.String),
		Participant:   proto.String(participant),
		QuotedMessage: &waE2E.Message{Conversation: proto.String(decryptBody(biz.String, body.String))},
	}
}

func attachContext(msg *waE2E.Message, ci *waE2E.ContextInfo) {
	switch {
	case msg.Conversation != nil:
		txt := msg.GetConversation()
		msg.Conversation = nil
		msg.ExtendedTextMessage = &waE2E.ExtendedTextMessage{Text: proto.String(txt), ContextInfo: ci}
	case msg.ExtendedTextMessage != nil:
		msg.ExtendedTextMessage.ContextInfo = ci
	case msg.ImageMessage != nil:
		msg.ImageMessage.ContextInfo = ci
	case msg.VideoMessage != nil:
		msg.VideoMessage.ContextInfo = ci
	case msg.AudioMessage != nil:
		msg.AudioMessage.ContextInfo = ci
	case msg.DocumentMessage != nil:
		msg.DocumentMessage.ContextInfo = ci
	case msg.StickerMessage != nil:
		msg.StickerMessage.ContextInfo = ci
	}
}

// pollOps processes edit/delete requests (pending_op) from the app.
func (m *Manager) pollOps(ctx context.Context) {
	for {
		qctx, cancel := withDBTimeout(ctx)
		rows, err := m.db.QueryContext(qctx,
			`SELECT id, business_id, conversation_id, body, wa_id, pending_op, COALESCE(react_emoji,''), direction, COALESCE(media_ptr::text,'')
			   FROM messages WHERE pending_op IS NOT NULL AND wa_id IS NOT NULL LIMIT 30`)
		if err != nil {
			cancel()
			m.log.Errorf("pending ops query: %v", err)
		}
		if err == nil {
			type op struct{ id, biz, conv, body, waID, op, react, dir, ptr string }
			var ops []op
			for rows.Next() {
				var o op
				var body sql.NullString
				if rows.Scan(&o.id, &o.biz, &o.conv, &body, &o.waID, &o.op, &o.react, &o.dir, &o.ptr) == nil {
					o.body = decryptBody(o.biz, body.String) // edits re-send the body to WhatsApp → plaintext
					if o.op == "edit" && isEncryptedBody(body.String) && o.body == "" {
						m.log.Errorf("cannot decrypt edit %s — MESSAGE_SECRET_KEY missing/mismatched; dropping the op", o.id)
						m.exec(ctx, `UPDATE messages SET pending_op=NULL WHERE id=$1`, o.id)
						continue
					}
					ops = append(ops, o)
				}
			}
			rows.Close()
			cancel()
			for _, o := range ops {
				m.processOp(ctx, o.id, o.biz, o.conv, o.body, o.waID, o.op, o.react, o.dir, o.ptr)
			}
		}
		time.Sleep(2 * time.Second)
	}
}

func (m *Manager) processOp(ctx context.Context, id, biz, conv, body, waID, op, react, dir, ptr string) {
	m.mu.Lock()
	client := m.byBiz[biz]
	m.mu.Unlock()
	if client == nil {
		return // not connected — retry later
	}
	// Bajar un adjunto diferido no toca a WhatsApp como mensaje: no necesita el teléfono del
	// contacto que sí exigen editar/borrar/reaccionar, así que se atiende antes de esa validación.
	if op == "fetch_media" {
		m.fetchDeferredMedia(ctx, client, id, biz, waID, ptr)
		return
	}
	var phone sql.NullString
	if err := m.db.QueryRowContext(ctx,
		`SELECT c.phone FROM conversations cv JOIN contacts c ON c.id = cv.contact_id WHERE cv.id=$1`, conv).
		Scan(&phone); err != nil || !phone.Valid || digits(phone.String) == "" {
		m.exec(ctx, `UPDATE messages SET pending_op=NULL WHERE id=$1`, id)
		return
	}
	chatJID := types.NewJID(digits(phone.String), types.DefaultUserServer)

	switch op {
	case "edit":
		edit := client.BuildEdit(chatJID, types.MessageID(waID), &waE2E.Message{Conversation: proto.String(body)})
		if _, err := client.SendMessage(ctx, chatJID, edit); err != nil {
			m.log.Errorf("edit %s: %v", id, err)
			return
		}
		m.exec(ctx, `UPDATE messages SET pending_op=NULL, edited=true WHERE id=$1`, id)
	case "delete":
		var own types.JID
		if client.Store.ID != nil {
			own = *client.Store.ID
		}
		revoke := client.BuildRevoke(chatJID, own, types.MessageID(waID))
		if _, err := client.SendMessage(ctx, chatJID, revoke); err != nil {
			m.log.Errorf("revoke %s: %v", id, err)
			return
		}
		m.exec(ctx, `UPDATE messages SET deleted=true, body='', pending_op=NULL WHERE id=$1`, id)
	case "react":
		// The reaction targets a message; its author is us (out) or the contact (in).
		var sender types.JID
		if dir == "out" {
			if client.Store.ID != nil {
				sender = *client.Store.ID
			}
		} else {
			sender = chatJID
		}
		reaction := client.BuildReaction(chatJID, sender, types.MessageID(waID), react) // react=="" removes
		if _, err := client.SendMessage(ctx, chatJID, reaction); err != nil {
			m.log.Errorf("react %s: %v", id, err)
			return
		}
		m.log.Infof("reaction sent → %s %q", chatJID, react)
		m.exec(ctx, `UPDATE messages SET pending_op=NULL, react_emoji=NULL WHERE id=$1`, id)
	default:
		m.exec(ctx, `UPDATE messages SET pending_op=NULL WHERE id=$1`, id)
	}
}

// applyReaction sets or removes a single reaction (by 'contact' or 'agent') on the target
// message identified by its WhatsApp id.
func (m *Manager) applyReaction(ctx context.Context, biz, targetWaID, emoji, by string) {
	if targetWaID == "" {
		return
	}
	var raw []byte
	if err := m.db.QueryRowContext(ctx,
		`SELECT reactions FROM messages WHERE business_id=$1 AND wa_id=$2`, biz, targetWaID).Scan(&raw); err != nil {
		return
	}
	var arr []map[string]string
	_ = json.Unmarshal(raw, &arr)
	out := make([]map[string]string, 0, len(arr)+1)
	for _, r := range arr {
		if r["by"] != by {
			out = append(out, r)
		}
	}
	if emoji != "" {
		out = append(out, map[string]string{"emoji": emoji, "by": by})
	}
	b, _ := json.Marshal(out)
	m.exec(ctx, `UPDATE messages SET reactions=$3 WHERE business_id=$1 AND wa_id=$2`, biz, targetWaID, string(b))

	// Aviso al agente cuyo mensaje reaccionaron. Va por `events` y no por el UPDATE de messages:
	// sin replica identity full el cliente no puede ver qué cambió, y ponérsela a `messages` —la
	// tabla más grande y la que más se actualiza— haría que cada acuse de entrega escribiera la
	// fila entera al WAL. events ya está en realtime (0068) y lleva target_id.
	if emoji == "" {
		return // quitar una reacción no avisa
	}
	var convID, author sql.NullString
	if err := m.db.QueryRowContext(ctx,
		`SELECT conversation_id, author_id FROM messages WHERE business_id=$1 AND wa_id=$2`, biz, targetWaID).
		Scan(&convID, &author); err != nil || !convID.Valid {
		return
	}
	m.exec(ctx, `INSERT INTO events (business_id, parent_type, parent_id, kind, text, target_id)
		VALUES ($1,'conversation',$2,'reaction',$3,$4)`, biz, convID.String, emoji, nullIf(author.String))
}

// ---------- helpers ----------

func (m *Manager) exec(ctx context.Context, q string, args ...interface{}) {
	qctx, cancel := withDBTimeout(ctx)
	defer cancel()
	if _, err := m.db.ExecContext(qctx, q, args...); err != nil {
		// La consulta se recorta en el log para poder distinguir QUÉ escritura se perdió: un
		// INSERT de mensaje entrante que falla aquí es un mensaje que nunca aparece en el chat, y
		// antes se veía igual que cualquier otro error.
		short := strings.Join(strings.Fields(q), " ")
		if len(short) > 90 {
			short = short[:90] + "…"
		}
		m.log.Errorf("exec [%s]: %v", short, err)
	}
}

func (m *Manager) fail(ctx context.Context, s session) {
	m.exec(ctx, `UPDATE whatsapp_sessions SET status='disconnected', updated_at=now() WHERE id=$1`, s.ID)
	m.drop(s.ID, s.BusinessID)
}

func (m *Manager) drop(sessionID, businessID string) {
	m.mu.Lock()
	delete(m.clients, sessionID)
	delete(m.sessBiz, sessionID)
	// Cierra la cola de eventos de la sesión para que su consumidor termine. Se borra del mapa
	// dentro del mismo candado: drop puede llamarse dos veces (LoggedOut y luego reap) y cerrar un
	// canal ya cerrado revienta el proceso.
	if d := m.evtDone[sessionID]; d != nil {
		close(d)
		delete(m.evtDone, sessionID)
	}
	if m.byBiz[businessID] != nil {
		delete(m.byBiz, businessID)
	}
	m.mu.Unlock()
}
