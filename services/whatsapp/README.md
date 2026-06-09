# WhatsApp Web worker

Long-running worker that connects a business's own WhatsApp number (via the
unofficial **whatsapp-web.js**) and bridges it to Supabase.

> ⚠️ whatsapp-web.js is **unofficial** and against WhatsApp's ToS — numbers can be
> banned. For production at scale, migrate to the official WhatsApp Cloud API. This
> worker is the path the project chose (bind your own number by scanning a QR).

## What it does
- Watches `whatsapp_sessions` (Realtime + 20s poll). When the app sets a session to
  `connecting`, it boots a WhatsApp client.
- Emits the **QR** into `whatsapp_sessions.qr` (status `qr`) so the app renders it.
- On ready → status `connected`, stores the phone number.
- **Inbound** WhatsApp messages → upserts the contact, finds/creates an open
  conversation, inserts the message, bumps unread.
- **Outbound**: when the app inserts a message (`direction='out'`, `state='queued'`),
  the worker sends it over WhatsApp and flips it to `sent`.

Sessions persist on a disk (`WA_DATA_PATH`) via `LocalAuth`, so a restart reconnects
without a new QR.

## Env
| var | value |
|-----|-------|
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key (bypasses RLS — worker only) |
| `WA_DATA_PATH` | session storage dir (a mounted disk, e.g. `/data/wwebjs`) |
| `PUPPETEER_EXECUTABLE_PATH` | Chrome path (set in the Dockerfile) |

## Run locally
```bash
cd services/whatsapp
npm install
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... WA_DATA_PATH=./.wwebjs node index.js
```
Then in the app → **Settings → WhatsApp → Connect**; a QR appears, scan it from your
phone (WhatsApp → Linked devices).

## Deploy (Render)
Defined in the root `render.yaml` as a `worker` service with a Docker build and a 1GB
disk for the session. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the
Render dashboard. Also enable **Realtime** on the `whatsapp_sessions` and `messages`
tables in Supabase (Database → Replication).
