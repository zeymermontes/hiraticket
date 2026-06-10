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
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	_ "github.com/lib/pq"
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
	replaced  map[string]time.Time         // sessionID -> don't reconnect until (after StreamReplaced)
	supaURL   string                       // Supabase URL (for media storage REST)
	supaKey   string                       // service-role key
}

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		panic("DATABASE_URL is required")
	}
	ctx := context.Background()
	logger := waLog.Stdout("WA", "INFO", true)

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		panic(err)
	}
	// One small SHARED pool for the worker AND whatsmeow's sqlstore. The Supabase Session pooler
	// caps total clients (~15) and a deploy briefly doubles instances, so stay lean and recycle
	// idle connections. (Previously sqlstore.New opened a second, uncapped pool → pool exhaustion.)
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
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

	// Recover messages a previous instance claimed (state='sending') but never finished, so they
	// get retried instead of being stuck under the clock icon forever.
	if _, err := db.ExecContext(ctx, `UPDATE messages SET state='queued' WHERE direction='out' AND state='sending'`); err != nil {
		logger.Warnf("requeue stale sending: %v", err)
	}

	m := &Manager{
		db: db, container: container, log: logger,
		clients:  map[string]*whatsmeow.Client{},
		byBiz:    map[string]*whatsmeow.Client{},
		sessBiz:  map[string]string{},
		replaced: map[string]time.Time{},
		supaURL:  strings.TrimRight(os.Getenv("SUPABASE_URL"), "/"),
		supaKey:  os.Getenv("SUPABASE_SERVICE_ROLE_KEY"),
	}
	if m.supaURL == "" || m.supaKey == "" {
		logger.Warnf("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — media will be skipped")
	}

	logger.Infof("worker booting (build: pool5+phone-retry+heartbeat)")
	go m.pollSessions(ctx)
	go m.pollOutbound(ctx)
	go m.pollContacts(ctx)
	go m.pollOps(ctx)
	go m.pollHeartbeat(ctx)

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

func (m *Manager) pollSessions(ctx context.Context) {
	for {
		alive := map[string]bool{}
		rows, err := m.db.QueryContext(ctx,
			`SELECT id, business_id, status, connect_method, phone, device_jid
			   FROM whatsapp_sessions
			  WHERE status IN ('connecting','qr','connected','reconnecting')`)
		if err == nil {
			for rows.Next() {
				var s session
				if rows.Scan(&s.ID, &s.BusinessID, &s.Status, &s.Method, &s.Phone, &s.DeviceJID) == nil {
					alive[s.ID] = true
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
			m.reap(ctx, alive)
		}
		time.Sleep(4 * time.Second)
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

func (m *Manager) pollOutbound(ctx context.Context) {
	for {
		// Self-heal: requeue any 'sending' claim that hung (e.g. a send that never returned).
		m.exec(ctx, `UPDATE messages SET state='queued' WHERE direction='out' AND state='sending' AND created_at < now() - interval '2 minutes'`)
		// In-order delivery: only send a message once every EARLIER outbound message in the same
		// conversation has left the queue (sent), so a retry/backoff on one can't let a later one
		// jump ahead. A message that permanently 'failed' (gave up) no longer blocks the rest.
		rows, err := m.db.QueryContext(ctx,
			`SELECT m.id, m.business_id, m.conversation_id, m.body, m.type, m.media_url, m.media_mime, m.media_name, m.reply_to, m.send_attempts
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
				var body, murl, mmime, mname, replyTo sql.NullString
				if rows.Scan(&o.id, &o.biz, &o.conv, &body, &o.mtype, &murl, &mmime, &mname, &replyTo, &o.attempts) == nil {
					o.body = body.String
					o.murl = murl.String
					o.mmime = mmime.String
					o.mname = mname.String
					o.replyTo = replyTo.String
					pending = append(pending, o)
				}
			}
			rows.Close()
			sent := 0
			for _, o := range pending {
				if m.sendOutbound(ctx, o) {
					sent++
				}
			}
			// If we delivered something, loop again right away to send the next in-order
			// message per conversation instead of waiting a full interval.
			if sent > 0 {
				continue
			}
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
					if res, err := m.db.ExecContext(ctx, `UPDATE messages SET state='queued', next_retry_at=NULL
						WHERE direction='out' AND state='failed' AND send_attempts=0 AND created_at > now() - interval '10 minutes'`); err == nil {
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
	data, err := io.ReadAll(resp.Body)
	return data, resp.Header.Get("Content-Type"), err
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
	data, err := io.ReadAll(resp.Body)
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
		rows, err := m.db.QueryContext(ctx,
			`SELECT id, business_id, phone FROM contacts WHERE fetch_requested IS NOT NULL LIMIT 20`)
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
			for _, x := range list {
				m.fetchContactInfo(ctx, x.id, x.biz, x.phone)
			}
		}
		time.Sleep(3 * time.Second)
	}
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
	m.mu.Lock()
	m.clients[s.ID] = client
	m.sessBiz[s.ID] = s.BusinessID
	m.mu.Unlock()

	client.AddEventHandler(func(evt interface{}) { m.handleEvent(ctx, s, client, evt) })

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
	case *events.Receipt:
		m.handleReceipt(ctx, v)
	}
}

// handleReceipt advances outbound message ticks to delivered/read.
func (m *Manager) handleReceipt(ctx context.Context, v *events.Receipt) {
	var state string
	switch v.Type {
	case types.ReceiptTypeRead, types.ReceiptTypeReadSelf:
		state = "read"
	case types.ReceiptTypeDelivered:
		state = "delivered"
	default:
		return
	}
	for _, id := range v.MessageIDs {
		if state == "read" {
			m.exec(ctx, `UPDATE messages SET state='read' WHERE wa_id=$1 AND direction='out'`, string(id))
		} else {
			m.exec(ctx, `UPDATE messages SET state='delivered' WHERE wa_id=$1 AND direction='out' AND state <> 'read'`, string(id))
		}
	}
}

// ---------- inbound / outbound ----------

// partnerPhone returns the conversation partner's real phone (+digits). WhatsApp
// now uses @lid addressing, so the phone lives in the alternate JID — prefer the
// s.whatsapp.net address; fall back to whatever Chat carries.
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

func (m *Manager) handleIncoming(ctx context.Context, s session, client *whatsmeow.Client, v *events.Message) {
	// Only 1:1 chats (skip groups, status@broadcast, newsletters).
	if v.Info.IsGroup || v.Info.Chat.Server == "broadcast" || v.Info.Chat.Server == "newsletter" {
		return
	}

	msg := v.Message

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
		meta = jsonStr(map[string]interface{}{"w": im.GetWidth(), "h": im.GetHeight()})
	case msg.GetStickerMessage() != nil:
		st := msg.GetStickerMessage()
		mtype, mmime = "sticker", st.GetMimetype()
		meta = jsonStr(map[string]interface{}{"w": st.GetWidth(), "h": st.GetHeight()})
	case msg.GetAudioMessage() != nil:
		mtype, mmime = "audio", msg.GetAudioMessage().GetMimetype()
	case msg.GetVideoMessage() != nil:
		vm := msg.GetVideoMessage()
		mtype, mmime, text = "video", vm.GetMimetype(), firstNonEmpty(vm.GetCaption(), text)
		meta = jsonStr(map[string]interface{}{"w": vm.GetWidth(), "h": vm.GetHeight()})
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

	// The conversation partner is the other side of the chat (Info.Chat),
	// whether the message is inbound or one you sent from your phone.
	partner := partnerPhone(v.Info)
	dir, state := "in", "delivered"
	if v.Info.IsFromMe {
		dir, state = "out", "sent"
	}
	name := partner
	if !v.Info.IsFromMe && v.Info.PushName != "" {
		name = v.Info.PushName
	}

	var contactID string
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

	var convID string
	var unread int
	err = m.db.QueryRowContext(ctx,
		`SELECT id, unread FROM conversations
		  WHERE business_id=$1 AND contact_id=$2 AND status<>'resolved'
		  ORDER BY last_message_at DESC LIMIT 1`, s.BusinessID, contactID).Scan(&convID, &unread)
	if err == sql.ErrNoRows {
		if err = m.db.QueryRowContext(ctx,
			`INSERT INTO conversations (business_id, contact_id, status, unread)
			 VALUES ($1,$2,'open',0) RETURNING id`, s.BusinessID, contactID).Scan(&convID); err != nil {
			m.log.Errorf("conv insert: %v", err)
			return
		}
		unread = 0
	} else if err != nil {
		return
	}

	// Download + store media (if any).
	mediaURL := ""
	if mtype != "text" {
		if data, derr := client.DownloadAny(ctx, msg); derr == nil && len(data) > 0 {
			path := fmt.Sprintf("%s/in/%s.%s", s.BusinessID, waID, extFromMime(mmime))
			if u, uerr := m.uploadMedia(ctx, path, data, firstNonEmpty(mmime, "application/octet-stream")); uerr == nil {
				mediaURL = u
			} else {
				m.log.Errorf("media upload: %v", uerr)
			}
		} else if derr != nil {
			m.log.Errorf("media download: %v", derr)
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

	m.exec(ctx, `INSERT INTO messages (business_id, conversation_id, direction, type, body, state, wa_id, media_url, media_mime, media_name, forwarded, meta, reply_to)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		s.BusinessID, convID, dir, mtype, body, state, waID, nullIf(mediaURL), nullIf(mmime), nullIf(mname), forwarded, nullIf(meta), replyTo)
	if dir == "in" {
		// A new customer message resurfaces the chat: clear snooze/hidden.
		m.exec(ctx, `UPDATE conversations SET unread=$1, last_message_at=now(), snoozed_until=NULL, hidden=false WHERE id=$2`, unread+1, convID)
	} else {
		m.exec(ctx, `UPDATE conversations SET last_message_at=now() WHERE id=$1`, convID)
	}
	m.log.Infof("saved %s %s from/to %s", dir, mtype, partner)
}

func nullIf(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
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
		m.exec(ctx, `UPDATE messages SET body=$3, edited=true WHERE business_id=$1 AND wa_id=$2`, s.BusinessID, target, txt)
		m.log.Infof("inbound edit %s", target)
	}
}

type outMsg struct {
	id, biz, conv, body, mtype, murl, mmime, mname, replyTo string
	attempts                                                int
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
	m.exec(ctx, `UPDATE messages SET state='queued', send_attempts=$2, next_retry_at=now() + ($3 || ' seconds')::interval WHERE id=$1`, o.id, next, backoff)
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

	// Claim atomically so a restart can't double-send.
	res, err := m.db.ExecContext(ctx,
		`UPDATE messages SET state='sending' WHERE id=$1 AND state='queued'`, o.id)
	if err != nil {
		return false
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return false
	}
	m.log.Infof("→ sending %s (%s, attempt %d)", o.id, o.mtype, o.attempts)

	var phone sql.NullString
	if perr := m.db.QueryRowContext(ctx,
		`SELECT c.phone FROM conversations cv JOIN contacts c ON c.id = cv.contact_id WHERE cv.id=$1`, o.conv).
		Scan(&phone); perr != nil {
		// Transient DB hiccup (pooler) — retry with backoff instead of silently failing.
		m.retryOrFail(ctx, o, "phone lookup: "+perr.Error())
		return false
	}
	if !phone.Valid || digits(phone.String) == "" {
		m.log.Errorf("send %s failed: no phone on conversation %s", o.id, o.conv)
		m.exec(ctx, `UPDATE messages SET state='failed', fail_reason='no phone on conversation' WHERE id=$1`, o.id)
		return false
	}
	jid := types.NewJID(digits(phone.String), types.DefaultUserServer)

	waMsg, err := m.buildOutboundMessage(ctx, client, o)
	if err != nil {
		m.retryOrFail(ctx, o, "build: "+err.Error())
		return false
	}
	if o.replyTo != "" {
		if ci := m.replyContext(ctx, client, jid, o.replyTo); ci != nil {
			attachContext(waMsg, ci)
		}
	}

	resp, err := client.SendMessage(ctx, jid, waMsg)
	if err != nil {
		m.retryOrFail(ctx, o, err.Error())
		return false
	}
	m.exec(ctx, `UPDATE messages SET state='sent', wa_id=$2, send_attempts=0, next_retry_at=NULL WHERE id=$1`, o.id, resp.ID)
	m.log.Infof("sent %s (%s) → %s", o.id, o.mtype, jid)
	return true
}

func (m *Manager) buildOutboundMessage(ctx context.Context, client *whatsmeow.Client, o outMsg) (*waE2E.Message, error) {
	if o.mtype == "text" || o.murl == "" {
		return &waE2E.Message{Conversation: proto.String(o.body)}, nil
	}
	data, ctype, err := m.fetchMedia(ctx, o.murl)
	if err != nil {
		return nil, err
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
	var waID, body, dir sql.NullString
	if err := m.db.QueryRowContext(ctx,
		`SELECT wa_id, body, direction FROM messages WHERE id=$1`, replyToID).Scan(&waID, &body, &dir); err != nil || !waID.Valid || waID.String == "" {
		return nil
	}
	participant := chatJID.String()
	if dir.String == "out" && client.Store.ID != nil {
		participant = client.Store.ID.ToNonAD().String()
	}
	return &waE2E.ContextInfo{
		StanzaID:      proto.String(waID.String),
		Participant:   proto.String(participant),
		QuotedMessage: &waE2E.Message{Conversation: proto.String(body.String)},
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
	}
}

// pollOps processes edit/delete requests (pending_op) from the app.
func (m *Manager) pollOps(ctx context.Context) {
	for {
		rows, err := m.db.QueryContext(ctx,
			`SELECT id, business_id, conversation_id, body, wa_id, pending_op, COALESCE(react_emoji,''), direction
			   FROM messages WHERE pending_op IS NOT NULL AND wa_id IS NOT NULL LIMIT 30`)
		if err == nil {
			type op struct{ id, biz, conv, body, waID, op, react, dir string }
			var ops []op
			for rows.Next() {
				var o op
				var body sql.NullString
				if rows.Scan(&o.id, &o.biz, &o.conv, &body, &o.waID, &o.op, &o.react, &o.dir) == nil {
					o.body = body.String
					ops = append(ops, o)
				}
			}
			rows.Close()
			for _, o := range ops {
				m.processOp(ctx, o.id, o.biz, o.conv, o.body, o.waID, o.op, o.react, o.dir)
			}
		}
		time.Sleep(2 * time.Second)
	}
}

func (m *Manager) processOp(ctx context.Context, id, biz, conv, body, waID, op, react, dir string) {
	m.mu.Lock()
	client := m.byBiz[biz]
	m.mu.Unlock()
	if client == nil {
		return // not connected — retry later
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
}

// ---------- helpers ----------

func (m *Manager) exec(ctx context.Context, q string, args ...interface{}) {
	if _, err := m.db.ExecContext(ctx, q, args...); err != nil {
		m.log.Errorf("exec: %v", err)
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
	if m.byBiz[businessID] != nil {
		delete(m.byBiz, businessID)
	}
	m.mu.Unlock()
}
