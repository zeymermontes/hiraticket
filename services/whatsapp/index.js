/**
 * Hiraticket — WhatsApp Web worker.
 *
 * Bridges the unofficial WhatsApp Web (whatsapp-web.js) to Supabase:
 *  - watches `whatsapp_sessions` for rows the app asks to connect,
 *  - writes the QR + status back so the app can render it,
 *  - stores inbound messages as conversations/messages,
 *  - sends outbound messages the app queues (direction='out', state='queued').
 *
 * Runs as a long-lived worker (Render "worker" service). Uses the Supabase
 * SERVICE ROLE key, so it bypasses RLS — keep this key server-side only.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WA_DATA_PATH (session storage).
 */
const { createClient } = require("@supabase/supabase-js");
const { Client, LocalAuth } = require("whatsapp-web.js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_PATH = process.env.WA_DATA_PATH || "./.wwebjs_auth";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const clients = new Map();        // sessionId -> wweb Client
const businessClient = new Map();  // businessId -> wweb Client

const nowIso = () => new Date().toISOString();

async function setSession(id, patch) {
  await supabase.from("whatsapp_sessions").update({ ...patch, updated_at: nowIso() }).eq("id", id);
}

function startSession(session) {
  if (clients.has(session.id)) return;
  console.log(`[wa] starting session ${session.id} (business ${session.business_id})`);

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: session.id, dataPath: DATA_PATH }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });
  clients.set(session.id, client);

  client.on("qr", async (qr) => {
    console.log(`[wa] qr for ${session.id}`);
    await setSession(session.id, { status: "qr", qr });
  });

  client.on("ready", async () => {
    const phone = client.info && client.info.wid ? "+" + client.info.wid.user : null;
    console.log(`[wa] ready ${session.id} as ${phone}`);
    businessClient.set(session.business_id, client);
    await setSession(session.id, { status: "connected", qr: null, phone, last_seen: nowIso() });
  });

  client.on("disconnected", async () => {
    console.log(`[wa] disconnected ${session.id}`);
    clients.delete(session.id);
    businessClient.delete(session.business_id);
    await setSession(session.id, { status: "disconnected", qr: null });
  });

  client.on("message", async (msg) => {
    try { await handleIncoming(session, msg); } catch (e) { console.error("[wa] incoming error", e); }
  });

  client.initialize().catch(async (e) => {
    console.error(`[wa] init failed ${session.id}`, e);
    clients.delete(session.id);
    await setSession(session.id, { status: "disconnected" });
  });
}

async function handleIncoming(session, msg) {
  if (msg.fromMe) return;
  const businessId = session.business_id;
  const phone = "+" + String(msg.from || "").replace("@c.us", "");

  let { data: contact } = await supabase
    .from("contacts").select("id").eq("business_id", businessId).eq("phone", phone).maybeSingle();
  if (!contact) {
    const ins = await supabase.from("contacts")
      .insert({ business_id: businessId, name: phone, phone }).select("id").single();
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
    direction: "in", type: "text", body: msg.body || "", state: "delivered",
  });
  await supabase.from("conversations")
    .update({ unread: (conv.unread || 0) + 1, last_message_at: nowIso() })
    .eq("id", conv.id);
}

async function sendOutbound(message) {
  if (message.direction !== "out" || message.state !== "queued") return;
  const client = businessClient.get(message.business_id);
  if (!client) return;

  const { data: conv } = await supabase
    .from("conversations").select("contact:contacts(phone)").eq("id", message.conversation_id).maybeSingle();
  const raw = conv && conv.contact ? conv.contact.phone : null;
  const phone = raw ? String(raw).replace(/[^0-9]/g, "") : null;
  if (!phone) return;

  try {
    await client.sendMessage(`${phone}@c.us`, message.body || "");
    await supabase.from("messages").update({ state: "sent" }).eq("id", message.id);
  } catch (e) {
    console.error("[wa] send error", e);
  }
}

async function syncSessions() {
  const { data } = await supabase
    .from("whatsapp_sessions").select("id, business_id, status")
    .in("status", ["connecting", "qr", "connected"]);
  for (const s of data || []) startSession(s);
}

function subscribe() {
  supabase
    .channel("wa-worker")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "whatsapp_sessions" }, (p) => {
      const s = p.new;
      if (s.status === "connecting" && !clients.has(s.id)) startSession(s);
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => {
      sendOutbound(p.new).catch((e) => console.error(e));
    })
    .subscribe((status) => console.log(`[wa] realtime: ${status}`));
}

async function main() {
  console.log("[wa] worker booting");
  await syncSessions();
  subscribe();
  setInterval(syncSessions, 20000); // safety net if a realtime event is missed
}

main().catch((e) => { console.error(e); process.exit(1); });
