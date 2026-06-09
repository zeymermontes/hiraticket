# Hiraticket — design prototype (running build)

This is the **pixel-perfect prototype** exported from Claude Design, vendored here so it runs
in the repo. It's the approved design for Hiraticket — a WhatsApp + orders SaaS (multi-vertical).
It is a self-contained React app transpiled in the browser via Babel standalone (no build step).

## How to run

The app loads its `.jsx`/`.js` modules over HTTP (Babel fetches them), so you must serve the
folder — opening `Hiraticket.html` directly with `file://` will **not** work.

```bash
cd prototype
python3 -m http.server 5173
# then open http://localhost:5173/Hiraticket.html
```

(Any static server works: `npx serve`, `php -S localhost:5173`, etc.) Needs internet — React,
ReactDOM, Babel, and Google Fonts load from CDNs.

## The pages

| File | What it is |
|------|------------|
| **Hiraticket.html** | The business app — Chat, Pedidos, Tablero (Kanban), Agenda, Catálogo, Campañas, Reportes, Flujos, Agentes, Plantillas, Negocio, Ajustes |
| **Landing.html** | Public marketing + pricing + FAQ |
| **Login.html** | Sign-in (also links to the platform/super-admin entry) |
| **Platform.html** | Multi-tenant super-admin console (tenants, billing, plans, usage, audit) |

Everything is cross-linked (Landing ↔ Login ↔ App ↔ Platform), bilingual **ES/EN** (toggle
top-right), with a working **light/dark** toggle and a configurable brand color.

## Things to try in Hiraticket.html
- **Chat** (default view): pick a conversation → center column shows that customer's orders,
  notes, actions, activity; right column is the WhatsApp thread. The ⤢ button expands the
  **Customer 360** takeover; the columns icon toggles the center panel.
- **Pedidos**: sort/filter the table, open an order drawer, click "Abrir conversación" to dock
  a phone-style chat beside it.
- **Tablero**: drag cards between status/area columns.
- **Flujos**: automations — e.g. move an order to "Listo" and a template auto-sends to the chat.
- **Negocio**: switch vertical (Imprenta / Restaurante / Estética / Veterinaria / Retail /
  Taller) to rename objects, stages, and areas across the whole app.

## Architecture (for the production port)
- **CSS (framework-agnostic, port verbatim):** `tokens.css` (brand/colors/radii/shadows),
  `ui.css` (primitives), `views.css` (per-view), `platform.css`.
- **Data/i18n (plain JS → port to TS modules):** `i18n.js`, `data.js` (`window.HT`),
  `verticals.js`, plus `plans.js`/`platform_data.js`/`strings_ext.js` for the platform.
- **React (Babel JSX → port to .tsx):** `components.jsx` (Icon/Avatar/Pill/Popover/Drawer/Toast),
  `shell.jsx` (NavRail/TopBar), `chat.jsx`, `orders.jsx`, `kanban.jsx`, `automations.jsx`,
  `newviews.jsx`, `admin.jsx`, `modals.jsx`, `login.jsx`, `app.jsx` (reducer + root).

The eventual target stack is **Next.js + TypeScript + Postgres** with a real WhatsApp-Web
integration; this prototype is the visual + interaction source of truth for that build.
