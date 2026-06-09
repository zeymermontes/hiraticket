# Hiraticket — Claude Design Prompt

Copy everything in the blockquote below into Claude to generate the UI/UX design for Hiraticket.
Context for the build (not part of the design prompt): **Next.js + TypeScript + Postgres**, with
WhatsApp connected via a **WhatsApp Web** integration (whatsapp-web.js style — the business binds
its own number by scanning a QR; this is unofficial, so the UI must surface connection status).
See `RESEARCH.md` for the Whaticket / Monday background that informs this design.

---

> You are a senior product designer. Design the complete UI for a web SaaS called **Hiraticket**.
> Produce clean, modern, data-dense screens (reference: Linear, Monday.com, Intercom). Deliver
> high-fidelity layouts for every screen and state listed. Default to a **light theme with a
> dark-mode variant**, an 8px spacing grid, rounded corners, subtle shadows, and a configurable
> primary brand color (default: indigo/teal). Use clear status colors and thoughtful empty,
> loading, and error states.
>
> ### Product in one line
> Hiraticket lets a shop/business team manage customer **orders** and **WhatsApp conversations**
> together, routing work between **agents** and **areas/departments**, with full history.
>
> ### Who uses it
> - **Agents** — handle chats and orders assigned to them or their area.
> - **Admins** — manage agents, areas, canned messages, and the WhatsApp connection.
> - **Viewers** — read-only (e.g. managers).
>
> ### Tech/context to reflect in the design
> Modern responsive web app (Next.js). Real-time updates (new messages, status changes appear
> live). WhatsApp is connected by the business scanning a **QR code** to bind their own number;
> show connection status (Connected / Disconnected / Needs QR) prominently.
>
> ---
> ### Global app shell
> - **Left nav rail** (icons + labels): **Chat**, **Orders**, **Kanban**, then **Agents**,
>   **Canned Messages**, **Settings**. Bottom: current agent avatar + online status.
> - **Top bar:** global search, WhatsApp connection indicator (with QR re-connect), notifications
>   bell, new-order button.
> - Show unread/assigned counts as badges on Chat and Orders nav items.
>
> ---
> ### View 1 — CHAT (three-column workspace)
> The flagship screen. Three columns:
>
> **Left column — Conversation list**
> - Search box + filters: status (Open / Pending / Resolved), assigned agent, area/queue, tags,
>   unread-only.
> - Each row: contact name + avatar, last-message preview, timestamp, unread badge, a colored
>   status/area tag, and the assigned agent's mini-avatar.
> - Tabs or segmented control at top: "Mine", "Unassigned", "All".
>
> **Center column — Conversation context ("everything about this customer")**
> When a chat is open, the center shows the *workspace* for that contact:
> - **Contact header:** name, phone, tags, lifetime value, first-seen.
> - **Orders block:** all orders for this contact as compact cards (order #, status pill,
>   area, total, updated) with a "＋ New order" button. Click → opens order detail.
> - **Notes block:** internal agent notes timeline (author, timestamp, body) with an add-note
>   composer. Notes are internal-only, visually distinct from customer messages.
> - **Actions block:** the relevant actions for this customer/conversation — Transfer (to agent
>   or area), Change status, Add tag, Create order, Resolve/Close, Schedule follow-up.
> - **Activity/audit:** collapsible timeline of status changes & transfers.
>
> **Right column — The WhatsApp conversation**
> - Message thread: inbound/outbound bubbles, media (images, audio with player, documents),
>   delivery/read ticks, day separators.
> - Header: contact name + WhatsApp badge, and quick buttons: Accept, Resolve, Transfer.
> - **Composer:** text input, attachment, emoji, and a **Canned Messages** picker (insert a
>   predefined template; templates can contain variables like {{name}} that auto-fill).
>
> Design the empty state (no chat selected) and the "WhatsApp not connected → scan QR" state.
>
> ---
> ### View 2 — ORDERS (table)
> A powerful data table for everything order-related.
> - **Toolbar:** global search, filters (status, area/department, assigned agent, date range,
>   tags, priority), sort, column chooser, saved views, bulk actions, Export, "＋ New order".
> - **Columns:** Order #, Customer, Status (colored pill), Area/Department, Assigned agent,
>   Priority, Items summary, Total, Created, Last updated, Tags.
> - **Row interactions:** select (bulk), click to open an **Order detail panel** (drawer):
>   customer + linked WhatsApp conversation link, status pipeline (clickable stages), line
>   items, internal notes/comments, **Transfer** (agent/area), and an immutable **activity log**
>   (who changed status, who transferred, when).
> - Show density toggle (comfortable/compact) and pagination.
>
> ---
> ### View 3 — KANBAN
> - Board of columns. A **Group-by toggle**: by **Status** (New → In progress → Ready → Done)
>   or by **Area/Department** (Sales → Workshop → Delivery).
> - **Cards** (draggable between columns): customer, order title, area tag, priority flag,
>   assignee avatar, note count, age. Dragging a card changes its status (or area).
> - Top filters: area, agent, priority, search. Column headers show count + WIP.
> - Quick card menu: Open, Transfer, Add note.
>
> ---
> ### Supporting screens
> - **Agents/Accounts admin:** list of agents (avatar, name, role, area, online status, # open
>   chats/orders), invite agent, edit role/permissions (Admin / Agent / Viewer), deactivate.
> - **Canned Messages manager:** list of predefined messages grouped by category; each has a
>   title, body (with variable chips like {{name}}, {{order_number}}), and shortcut. Create/edit
>   modal.
> - **Transfer dialog (reused everywhere):** choose destination = Agent or Area, optional note,
>   confirm. Show it transferring a chat and an order.
> - **WhatsApp connection / Settings:** QR scan screen, connection status, ability to connect
>   multiple numbers, and area/department configuration (create areas, set default routing).
> - **Login / agent auth** screen.
>
> ---
> ### Cross-cutting UX requirements
> - **Transfers, statuses, and notes are first-class** and consistent across all three views.
> - Everything assignable shows **who owns it** (agent avatar) and **what area** it's in (tag).
> - **Real-time feel:** badges, toasts for new messages/transfers.
> - Color-code statuses and areas consistently across Chat, Orders, and Kanban.
> - Responsive: graceful collapse of the 3-column chat on smaller screens.
>
> ### Deliver
> For each view and supporting screen: the full layout, key components, and at least the empty +
> populated states. Provide a small component/style guide (colors, status pills, buttons, table
> rows, cards, avatars). Keep it cohesive as one design system.

---

## Domain model (reference for the prompt and the future build)
- **Order** — id, customer, status, area, assignee, priority, items, total, timestamps.
- **Conversation/Chat** — contact, channel (WhatsApp), status, assignee, area, unread, messages[].
- **Message** — conversation_id, direction, type (text/image/audio/doc), body/media, timestamps,
  delivery state.
- **Contact/Customer** — name, phone, tags, value, orders[], conversations[].
- **Area/Department** — Sales, Workshop, Delivery… (routing target for transfers).
- **Agent/User** — name, avatar, role (Admin/Agent/Viewer), area, online status.
- **Note** — parent (order or conversation), author, body, internal, timestamp.
- **CannedMessage** — title, body (with variables), category, shortcut.
- **Transfer/Event** — immutable audit log: actor, from→to (agent/area), status change, when.
