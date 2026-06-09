# Hiraticket

WhatsApp + orders workspace for shops/businesses — manage customer **chats** and
**orders**, route work between **agents** and **areas**, with status, comments, and a full
audit trail. Multi-tenant SaaS.

- **Stack:** Next.js 16 (App Router) · React 19 · TypeScript · **Supabase** (Postgres + Auth) · plain CSS
  design system · deploys to **Render** via `render.yaml`.
- **Design source of truth:** the approved prototype in [`prototype/`](prototype/) (see its
  README). The design's CSS (`tokens.css` / `ui.css` / `views.css`) is reused verbatim in
  `src/styles/`.
- **Background:** [`RESEARCH.md`](RESEARCH.md) · [`DESIGN_PROMPT.md`](DESIGN_PROMPT.md)

The app is a **native Next.js + Supabase** build (the original design prototype lives in
[`prototype/`](prototype/) as reference only — it is no longer served).

## Features (all Supabase-backed)

| Area | What works |
|------|-----------|
| **Auth** | Supabase email/password + sign-up, session middleware, route gating, `/logout` |
| **Multi-tenant** | Businesses + members (admin/agent/viewer), RLS scoping every table; onboarding creates a business + seeds demo data |
| **Chat** | 3-column workspace on live data — send (queued for the WhatsApp worker), accept, status, resolve, internal notes, transfer to agent/area, activity log |
| **Orders** | Table with search + sort, live data |
| **Kanban** | Drag cards to change stage or area (persisted) |
| **Business** | Areas + stages CRUD (rename, color, delete) and default-agent routing per area |
| **Agents** | List, role changes, email invite (Supabase admin invite) |
| **Templates** | Canned messages CRUD with `{{variables}}` |
| **Flows** | Automations list, enable/pause, create (trigger → send template) |
| **Catalog / Agenda / Campaigns / Reports** | Products & services, appointments, broadcast campaigns, and live order analytics |
| **Settings** | WhatsApp connection (QR + live status), appearance, account |
| **Platform** (super-admin) | Gated console at `/platform`: tenants, plans, MRR; bootstrap-claim the first admin |
| **WhatsApp worker** | `services/whatsapp` — whatsapp-web.js bridge (QR, inbound→DB, outbound←DB); deployed as a Render worker |

## 1. Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Run the migrations (SQL editor, **in order**) — paste each `supabase/migrations/*.sql`
   file (`0001` … `0006`), or use the CLI: `supabase db push`.
   Then enable **Realtime** on `whatsapp_sessions` and `messages` (Database → Replication)
   so the WhatsApp worker reacts live.
   *(`0002`/`0004` define optional demo-data seeders that are **not** run automatically — the
   app starts with no sample data; call `seed_demo_data(business_id)` manually if you want a
   demo tenant.)*

## 1. Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Run the migrations (SQL editor, in order) — paste each file:
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_seed_demo.sql`
   (Or with the CLI: `supabase db push`.)
3. **Auth → Providers → Email**: for the fastest local testing, turn **off** "Confirm email"
   so sign-up logs you straight in. (Leave it on for production.)
4. Grab your keys from **Project Settings → API**.

## 2. Run locally

```bash
cp .env.example .env.local      # fill in the three values from step 1.4
npm install
npm run dev                     # http://localhost:3000
```

Sign up → a **one-time onboarding wizard**: name your business + pick an industry (this sets
up a working pipeline — stages & areas — with **no sample data**), then a short, **skippable**
welcome. After that you land in an empty, ready-to-use workspace.

## 3. Deploy to Render

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → select the repo (it reads [`render.yaml`](render.yaml)).
3. Set the three env vars in the Render dashboard (they're marked `sync:false`):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
4. In **Supabase → Auth → URL Configuration**, add your Render URL to the redirect allow-list
   (`https://<your-app>.onrender.com/auth/callback`).

## Project layout

```
src/
  app/
    login/                 # auth screen (Supabase email/password)
    auth/callback|signout/ # auth route handlers
    (app)/                 # authed area — layout renders the shell
      orders/  chat/  kanban/  …  # views (orders is live; rest scaffolded)
      actions.ts           # server actions (create business + seed)
  components/              # Icon, ui (Avatar/Pill), Shell, OrdersTable, Login, …
  lib/
    supabase/{client,server,middleware}.ts
    i18n.ts  queries.ts  types.ts
supabase/migrations/        # schema + RLS + demo seeder
prototype/                  # original Claude Design prototype (reference)
render.yaml                 # Render blueprint
```

## Roadmap (next ports from the prototype)

- Chat 3-column workspace (conversation list · customer context · WhatsApp thread)
- Kanban with drag-to-change status/area
- Order detail drawer, transfer dialog, canned messages, automations, agents admin
- Real **WhatsApp Web** integration (the prototype simulates it)
- Super-admin **Platform** console (multi-tenant billing/plans) — `prototype/Platform.html`
