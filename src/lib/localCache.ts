"use client";

// Per-device message cache (IndexedDB) — the "WhatsApp Web" model. Message bodies are encrypted
// at rest in Postgres, so server-side ILIKE can't search them; instead, every message that flows
// through the UI (plus a background backfill) is persisted here in plaintext and searched locally.
// Like WhatsApp Web: you can only search what this device has synced, and the cache is cleared on
// logout. Never synced anywhere; scoped per business.

export interface CachedMsg {
  businessId: string;
  kind: "wa" | "internal";
  threadId: string; // conversation id | internal channel
  msgId: string;
  body: string;
  senderName: string | null;
  dir: "in" | "out";
  ts: string; // ISO created_at
}

const DB_NAME = "ht-cache-v1";
const MSGS = "msgs";
const META = "meta";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MSGS)) {
        const st = db.createObjectStore(MSGS, { keyPath: ["businessId", "kind", "threadId", "msgId"] });
        st.createIndex("byBizTs", ["businessId", "ts"]);
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null); // private mode / quota → cache silently off
  });
  return dbPromise;
}

/** Upsert a batch of messages (fire-and-forget; failures are silent — the cache is best-effort). */
export async function putMessages(batch: CachedMsg[]): Promise<void> {
  if (!batch.length) return;
  const db = await openDB();
  if (!db) return;
  try {
    const tx = db.transaction(MSGS, "readwrite");
    const st = tx.objectStore(MSGS);
    for (const m of batch) {
      if (!m.msgId || !m.threadId || !m.body) continue; // only text worth searching
      st.put(m);
    }
  } catch { /* quota/closed — ignore */ }
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface LocalHit extends CachedMsg { snippet: string }

/** Substring search (case/accents-insensitive) over this device's cached messages, newest first. */
export async function searchLocal(businessId: string, q: string, limit = 8): Promise<LocalHit[]> {
  const needle = fold(q.trim());
  if (!needle) return [];
  const db = await openDB();
  if (!db) return [];
  return new Promise((resolve) => {
    const hits: LocalHit[] = [];
    try {
      const idx = db.transaction(MSGS, "readonly").objectStore(MSGS).index("byBizTs");
      // Walk newest → oldest so the first matches are the most recent.
      const range = IDBKeyRange.bound([businessId, ""], [businessId, "￿"]);
      const cur = idx.openCursor(range, "prev");
      let scanned = 0;
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || hits.length >= limit || scanned > 20000) { resolve(hits); return; }
        scanned++;
        const m = c.value as CachedMsg;
        const at = fold(m.body).indexOf(needle);
        if (at >= 0) {
          const start = Math.max(0, at - 24);
          hits.push({ ...m, snippet: (start > 0 ? "…" : "") + m.body.slice(start, start + 90) });
        }
        c.continue();
      };
      cur.onerror = () => resolve(hits);
    } catch { resolve(hits); }
  });
}

/** Read/write small metadata values (backfill cursors etc.). */
export async function getMeta(key: string): Promise<unknown> {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(META, "readonly").objectStore(META).get(key);
      req.onsuccess = () => resolve((req.result as { value?: unknown } | undefined)?.value ?? null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  if (!db) return;
  try { db.transaction(META, "readwrite").objectStore(META).put({ key, value }); } catch { /* ignore */ }
}

/** Wipe the whole device cache (called on logout — it holds plaintext message text). */
export async function clearCache(): Promise<void> {
  try {
    if (dbPromise) { const db = await dbPromise; db?.close(); dbPromise = null; }
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  } catch { /* ignore */ }
}
