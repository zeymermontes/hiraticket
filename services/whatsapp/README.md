# WhatsApp worker (whatsmeow, Go)

Multi-tenant worker that connects each business's own WhatsApp number and bridges it
to the app's Postgres. Built on **[whatsmeow](https://github.com/tulir/whatsmeow)** — a Go
WebSocket client for WhatsApp Web multi-device (no browser), known for being very stable
(it powers the mautrix-whatsapp bridge in production).

> ⚠️ Unofficial (WhatsApp Web linked device) — same ban risk as any linked device.

## Why whatsmeow
- **Stable & efficient** (Go), low memory per number.
- **Sessions live in Postgres** (whatsmeow's `sqlstore`, in `whatsmeow_*` tables) — **no
  disk**. The worker is stateless, so it restarts/scales cleanly and reconnects numbers
  automatically.

## What it does
- Polls `whatsapp_sessions`. When the app sets a session to `connecting`, it opens a
  whatsmeow client:
  - **QR** → publishes the QR string to `whatsapp_sessions.qr`.
  - **Pairing** (`connect_method='pairing'` + `phone`) → publishes an 8-char code to
    `whatsapp_sessions.pairing_code`.
- On connect → status `connected`, stores the number and the device JID (`device_jid`).
- **Inbound** messages → upserts the contact, finds/creates an open conversation, inserts
  the message, bumps unread (scoped by `business_id`).
- **Outbound**: polls `messages` with `direction='out'` + `state='queued'`, claims each
  (`state='sending'`), sends it, then flips to `sent` (or `failed`).

## Env
| var | value |
|-----|-------|
| `DATABASE_URL` | Supabase **direct** Postgres connection string (port 5432), `sslmode=require` |

The worker connects directly to Postgres (trusted, bypasses RLS) and shares that DB with
whatsmeow's session store. Use the **direct connection** (not the transaction pooler).

## Run locally (Go 1.25+)
```bash
cd services/whatsapp
go mod download
DATABASE_URL='postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres?sslmode=require' go run .
```
Then in the app → **Settings → WhatsApp → Connect** (QR or pairing code).

## Deploy (Render)
Defined in the root `render.yaml` as a `worker` (Docker, distroless static image, **no
disk**). Set `DATABASE_URL` in the dashboard. whatsmeow creates its own tables on first run.

## Scaling
One worker handles many numbers. To run multiple workers, **shard sessions** (e.g. only
start a session if `hash(session.id) % N == WORKER_INDEX`) so each number is owned by
exactly one worker.
