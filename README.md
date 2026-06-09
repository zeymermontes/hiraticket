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

## Two surfaces

1. **The full app — every prototype feature, live** at `/app/Hiraticket.html`, served behind
   the Supabase login. This is where users land after signing in: Chat (3-column workspace +
   Customer 360), Orders table + drawer, Kanban drag board, Flujos automations, Catálogo,
   Agenda, Campañas, Reportes, Negocio (vertical switching), Agentes, Plantillas, Settings —
   all bilingual ES/EN with light/dark. (Currently the design prototype, served as static
   assets; sign-out breaks out to Supabase `/logout`.)
2. **The native Next + Supabase port** (`/orders`, `/chat`, …) — the production rebuild that
   replaces the prototype view-by-view with real Postgres-backed data.

## Native port — what's built so far

| Area | Status |
|------|--------|
| Supabase auth (email/password + sign-up), session middleware, route gating | ✅ |
| Multi-tenant Postgres schema + RLS (businesses, members, orders, chats, areas, stages, notes, events, automations…) | ✅ |
| Onboarding (create business + seed demo sticker-shop data) | ✅ |
| App shell (nav rail + top bar, ES/EN, light/dark) | ✅ |
| **Orders** view — live data from Supabase, search + sort | ✅ |
| Chat (3-column workspace), Kanban (drag), and admin views | ⏳ porting from the live prototype |

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

Sign up → you'll land on **Orders** with a "Create your business" card → create one and it
seeds demo orders you can search and sort.

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
