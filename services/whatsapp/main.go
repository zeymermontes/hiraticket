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
	"context"
	"database/sql"
	"os"
	"regexp"
	"sync"
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
	db.SetMaxOpenConns(8)

	container, err := sqlstore.New(ctx, "postgres", dsn, waLog.Stdout("DB", "WARN", true))
	if err != nil {
		panic(err)
	}
	if err := container.Upgrade(ctx); err != nil {
		panic(err)
	}

	m := &Manager{
		db: db, container: container, log: logger,
		clients: map[string]*whatsmeow.Client{},
		byBiz:   map[string]*whatsmeow.Client{},
		sessBiz: map[string]string{},
	}

	logger.Infof("worker booting")
	go m.pollSessions(ctx)
	go m.pollOutbound(ctx)
	go m.pollContacts(ctx)
	select {} // run forever
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
					m.mu.Unlock()
					if !running {
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
		rows, err := m.db.QueryContext(ctx,
			`SELECT id, business_id, conversation_id, body
			   FROM messages
			  WHERE direction='out' AND state='queued'
			  ORDER BY created_at LIMIT 50`)
		if err == nil {
			type out struct{ id, biz, conv, body string }
			var pending []out
			for rows.Next() {
				var o out
				var body sql.NullString
				if rows.Scan(&o.id, &o.biz, &o.conv, &body) == nil {
					o.body = body.String
					pending = append(pending, o)
				}
			}
			rows.Close()
			for _, o := range pending {
				m.sendOutbound(ctx, o.id, o.biz, o.conv, o.body)
			}
		}
		time.Sleep(2 * time.Second)
	}
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
			m.mu.Unlock()
			m.exec(ctx, `UPDATE whatsapp_sessions
				SET status='connected', qr=NULL, pairing_code=NULL, phone=$1, device_jid=$2, last_seen=now(), updated_at=now()
				WHERE id=$3`, phone, jid, s.ID)
			m.log.Infof("connected %s as %s", s.ID, phone)
		}
	case *events.LoggedOut:
		m.exec(ctx, `UPDATE whatsapp_sessions SET status='disconnected', qr=NULL, pairing_code=NULL, phone=NULL, device_jid=NULL, updated_at=now() WHERE id=$1`, s.ID)
		m.drop(s.ID, s.BusinessID)
		client.Disconnect()
	case *events.Disconnected:
		m.exec(ctx, `UPDATE whatsapp_sessions SET status='reconnecting', updated_at=now() WHERE id=$1 AND status='connected'`, s.ID)
	case *events.Message:
		m.handleIncoming(ctx, s, v)
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

func (m *Manager) handleIncoming(ctx context.Context, s session, v *events.Message) {
	// Only 1:1 chats (skip groups, status@broadcast, newsletters).
	if v.Info.IsGroup || v.Info.Chat.Server == "broadcast" || v.Info.Chat.Server == "newsletter" {
		return
	}
	text := v.Message.GetConversation()
	if text == "" {
		text = v.Message.GetExtendedTextMessage().GetText()
	}
	if text == "" {
		return
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

	m.exec(ctx, `INSERT INTO messages (business_id, conversation_id, direction, type, body, state, wa_id)
		VALUES ($1,$2,$3,'text',$4,$5,$6)`, s.BusinessID, convID, dir, text, state, waID)
	if dir == "in" {
		// A new customer message resurfaces the chat: clear snooze/hidden.
		m.exec(ctx, `UPDATE conversations SET unread=$1, last_message_at=now(), snoozed_until=NULL, hidden=false WHERE id=$2`, unread+1, convID)
	} else {
		m.exec(ctx, `UPDATE conversations SET last_message_at=now() WHERE id=$1`, convID)
	}
	m.log.Infof("saved %s msg from/to %s", dir, partner)
}

func (m *Manager) sendOutbound(ctx context.Context, id, biz, conv, body string) {
	m.mu.Lock()
	client := m.byBiz[biz]
	m.mu.Unlock()
	if client == nil {
		return // not connected yet — leave queued for the next poll
	}

	// Claim atomically so a restart can't double-send.
	res, err := m.db.ExecContext(ctx,
		`UPDATE messages SET state='sending' WHERE id=$1 AND state='queued'`, id)
	if err != nil {
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return
	}

	var phone sql.NullString
	if err := m.db.QueryRowContext(ctx,
		`SELECT c.phone FROM conversations cv JOIN contacts c ON c.id = cv.contact_id WHERE cv.id=$1`, conv).
		Scan(&phone); err != nil || !phone.Valid || digits(phone.String) == "" {
		m.exec(ctx, `UPDATE messages SET state='failed' WHERE id=$1`, id)
		return
	}

	jid := types.NewJID(digits(phone.String), types.DefaultUserServer)
	resp, err := client.SendMessage(ctx, jid, &waE2E.Message{Conversation: proto.String(body)})
	if err != nil {
		m.log.Errorf("send %s: %v", id, err)
		m.exec(ctx, `UPDATE messages SET state='failed' WHERE id=$1`, id)
		return
	}
	// Record the WA id so the fromMe echo of this message is deduped.
	m.exec(ctx, `UPDATE messages SET state='sent', wa_id=$2 WHERE id=$1`, id, resp.ID)
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
