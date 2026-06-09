/**
 * Hiraticket — WhatsApp worker (Baileys, multi-tenant).
 *
 * Uses Baileys (WebSocket, no browser) — the same engine the Whaticket SaaS
 * forks use. Each business connects its OWN number; the worker runs one socket
 * per `whatsapp_sessions` row, with auth state persisted per session on disk.
 *
 * Flow:
 *  - App sets a session to `connecting` → worker opens a socket.
 *  - QR method: publishes the QR string to `whatsapp_sessions.qr`.
 *  - Pairing method: requests an 8-char code → `whatsapp_sessions.pairing_code`.
 *  - On open → status `connected`, stores phone.
 *  - Inbound messages → contact/conversation/message rows (scoped by business).
 *  - Outbound: app inserts a message (direction='out', state='queued') →
 *    worker sends it and flips it to `sent`.
 *
 * Unofficial (WhatsApp Web multi-device) — same ban risk as any linked device.
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WA_DATA_PATH.
 */
const fs = require("fs/promises");
const path = require("path");
const pino = require("pino");
const { createClient } = require("@supabase/supabase-js");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
} = require("@whiskeysockets/baileys");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_PATH = process.env.WA_DATA_PATH || "./.wwebjs_auth";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const logger = pino({ level: process.env.LOG_LEVEL || "warn" });
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sockets = new Map();       // sessionId -> Baileys socket
const businessSock = new Map();  // businessId -> Baileys socket
const starting = new Set();      // sessionIds currently booting

const nowIso = () => new Date().toISOString();
const setSession = (id, patch) =>
  supabase.from("whatsapp_sessions").update({ ...patch, updated_at: nowIso() }).eq("id", id);

async function startSession(session) {
  if (sockets.has(session.id) || starting.has(session.id)) return;
  starting.add(session.id);
  console.log(`[wa] start ${session.id} (business ${session.business_id}, method ${session.connect_method})`);

  const folder = path.join(DATA_PATH, session.id);
  const { state, saveCreds } = await useMultiFileAuthState(folder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    browser: ["Hiraticket", "Chrome", "1.0.0"],
  });
  sockets.set(session.id, sock);
  starting.delete(session.id);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr && session.connect_method !== "pairing") {
      await setSession(session.id, { status: "qr", qr });
    }

    if (connection === "open") {
      const phone = sock.user?.id ? "+" + sock.user.id.split(":")[0].split("@")[0] : null;
      businessSock.set(session.business_id, sock);
      await setSession(session.id, { status: "connected", qr: null, pairing_code: null, phone, last_seen: nowIso() });
      console.log(`[wa] connected ${session.id} as ${phone}`);
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      sockets.delete(session.id);
      businessSock.delete(session.business_id);

      if (code === DisconnectReason.loggedOut) {
        await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
        await setSession(session.id, { status: "disconnected", qr: null, pairing_code: null, phone: null });
        console.log(`[wa] logged out ${session.id}`);
      } else {
        await setSession(session.id, { status: "reconnecting" });
        console.log(`[wa] reconnecting ${session.id} (code ${code})`);
        setTimeout(() => startSession(session), 3000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      if (m.key.fromMe) continue;
      try { await handleIncoming(session, m); } catch (e) { console.error("[wa] incoming", e); }
    }
  });

  // Pairing-code flow: request a code once, if not already registered.
  if (session.connect_method === "pairing" && !state.creds.registered) {
    const phone = String(session.phone || "").replace(/[^0-9]/g, "");
    if (phone) {
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(phone);
          await setSession(session.id, { status: "qr", pairing_code: code });
          console.log(`[wa] pairing code ${session.id}: ${code}`);
        } catch (e) { console.error("[wa] pairing", e); }
      }, 2500);
    }
  }
}

function textOf(m) {
  const msg = m.message || {};
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    ""
  );
}

async function handleIncoming(session, m) {
  const jid = m.key.remoteJid || "";
  if (jid.endsWith("@g.us") || jid === "status@broadcast") return; // skip groups/status
  const body = textOf(m);
  if (!body) return; // text only for now

  const businessId = session.business_id;
  const phone = "+" + jid.split("@")[0];

  let { data: contact } = await supabase
    .from("contacts").select("id").eq("business_id", businessId).eq("phone", phone).maybeSingle();
  if (!contact) {
    const name = m.pushName || phone;
    const ins = await supabase.from("contacts").insert({ business_id: businessId, name, phone }).select("id").single();
    contact = ins.data;
  }

  let { data: conv } = await supabase
    .from("conversations").select("id, unread")
    .eq("business_id", businessId).eq("contact_id", contact.id).neq("status", "resolved")
    .order("last_message_at", { ascending: false }).limit(1).maybeSingle();
  if (!conv) {
    const ins = await supabase.from("conversations")
      .insert({ business_id: businessId, contact_id: contact.id, status: "open", unread: 0 })
      .select("id, unread").single();
    conv = ins.data;
  }

  await supabase.from("messages").insert({
    business_id: businessId, conversation_id: conv.id,
    direction: "in", type: "text", body, state: "delivered",
  });
  await supabase.from("conversations")
    .update({ unread: (conv.unread || 0) + 1, last_message_at: nowIso() })
    .eq("id", conv.id);
}

async function sendOutbound(message) {
  if (message.direction !== "out" || message.state !== "queued") return;
  const sock = businessSock.get(message.business_id);
  if (!sock) return;

  const { data: conv } = await supabase
    .from("conversations").select("contact:contacts(phone)").eq("id", message.conversation_id).maybeSingle();
  const raw = conv?.contact?.phone;
  const phone = raw ? String(raw).replace(/[^0-9]/g, "") : null;
  if (!phone) return;

  try {
    await sock.sendMessage(`${phone}@s.whatsapp.net`, { text: message.body || "" });
    await supabase.from("messages").update({ state: "sent" }).eq("id", message.id);
  } catch (e) {
    console.error("[wa] send", e);
  }
}

async function syncSessions() {
  const { data } = await supabase
    .from("whatsapp_sessions")
    .select("id, business_id, status, connect_method, phone")
    .in("status", ["connecting", "qr", "connected", "reconnecting"]);
  for (const s of data || []) startSession(s);
}

function subscribe() {
  supabase
    .channel("wa-worker")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "whatsapp_sessions" }, (p) => {
      const s = p.new;
      if (s.status === "connecting" && !sockets.has(s.id)) startSession(s);
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => {
      sendOutbound(p.new).catch((e) => console.error(e));
    })
    .subscribe((st) => console.log(`[wa] realtime: ${st}`));
}

async function main() {
  console.log("[wa] Baileys worker booting");
  await syncSessions();
  subscribe();
  setInterval(syncSessions, 20000);
}

main().catch((e) => { console.error(e); process.exit(1); });
