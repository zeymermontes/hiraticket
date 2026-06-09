# WhatsApp worker (Baileys)

Multi-tenant worker that connects each business's own WhatsApp number and bridges it
to Supabase. Uses **[Baileys](https://github.com/whiskeysockets/Baileys)** — a WebSocket
client for WhatsApp Web multi-device, **no browser/Chromium** — the same engine the
Whaticket SaaS forks use. ~30–50 MB RAM per number, so one worker holds many tenants.

> ⚠️ Unofficial (WhatsApp Web linked-device). Same ban risk as any linked device. For
> very large scale, the official WhatsApp Cloud API is the alternative.

## What it does
- Watches `whatsapp_sessions` (Realtime + 20s poll). When the app sets a session to
  `connecting`, it opens a Baileys socket with **per-session auth state** on disk
  (`useMultiFileAuthState` under `WA_DATA_PATH/<sessionId>`).
- **QR method** → publishes the QR string to `whatsapp_sessions.qr`.
- **Pairing-code method** → requests an 8-char code → `whatsapp_sessions.pairing_code`
  (set `connect_method='pairing'` and a `phone`).
- On connect → status `connected`, stores the number. Auto-reconnects unless logged out.
- **Inbound** messages → upserts the contact, finds/creates an open conversation, inserts
  the message, bumps unread. **Outbound**: when the app inserts `direction='out'`,
  `state='queued'`, the worker sends it and flips it to `sent`.

Each business gets its own socket + auth folder, all data scoped by `business_id` (RLS).

## Env
| var | value |
|-----|-------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key (bypasses RLS — worker only) |
| `WA_DATA_PATH` | per-session auth dir (a mounted disk, e.g. `/data/baileys`) |

## Run locally
```bash
cd services/whatsapp
npm install
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... WA_DATA_PATH=./.baileys node index.js
```
Then in the app → **Settings → WhatsApp → Connect** (QR or pairing code).

## Deploy (Render)
Defined in the root `render.yaml` as a `worker` (Docker, slim Node image, 1 GB disk).
Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, and enable **Realtime** on the
`whatsapp_sessions` and `messages` tables (Supabase → Database → Replication).

## Scaling to many tenants
One worker handles dozens of numbers. To go further, run multiple worker instances and
**shard sessions** (e.g. only start a session if `hash(session.id) % N === WORKER_INDEX`)
so each number is owned by exactly one worker.
