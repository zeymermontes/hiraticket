# Research Report: Whaticket & Order-Management Software (for the `hiraticket` project)

## Context

The `hiraticket` directory is empty — this is the research phase before building an
order/ticket management tool for a shop or business. Per your answers, the eventual system
would have **manual/internal order intake** (staff create orders, not WhatsApp-driven), and
**status tracking, comments, and transfer-between-areas all matter equally**. This document
is a research deliverable only — no code. When you're ready to build, the domain model and
capability checklist below become the starting spec.

---

## Part 1 — What Whaticket is and how it works

**Whaticket** is an open-source **WhatsApp shared-inbox / ticketing system**. A WhatsApp
number is normally tied to one phone and one person; a business needs a whole team answering
it. Whaticket turns one WhatsApp number into a multi-agent helpdesk, where each customer
conversation becomes a **ticket** that can be assigned, worked, transferred, and resolved.

Origin: [`canove/whaticket-community`](https://github.com/canove/whaticket-community). It has
many forks — [dlimars](https://github.com/dlimars/whaticket),
[whatsninja](https://github.com/whatsninja/whatsninja-community),
[WhaticketPlus](https://github.com/DEV7Kadu/WhaticketPlus), and the modern, easier-to-install
[Ticketz](https://github.com/ticketz-oss/ticketz).

### Architecture
- **Backend:** Node.js + `whatsapp-web.js` (browser-automation of WhatsApp Web; you scan a QR
  to bind a number). Handles messages, media, audio, documents; persists to **MySQL/MariaDB**.
- **Frontend:** React + Material UI chat app; talks to backend over **REST + WebSockets** for
  live updates.
- **Flow:** WhatsApp session → backend ticket/queue logic → agent web UI.

### Ticket lifecycle (the core model)
1. Customer messages the number → ticket auto-created, status `pending`.
2. Ticket appears in a **queue (Fila)** on the Tickets page.
3. An agent **accepts** it → status `open`, assigned to that agent → replies in a chat thread
   → **resolves** it → status `closed`.
4. **Smart re-open:** same contact writing within ~2h with no open ticket re-opens the last
   closed ticket instead of creating a duplicate.
5. **Queues / departments + transfer:** tickets organize into queues (Sales, Support,
   Billing…) and can be **transferred between queues/agents** — the "move to another area"
   capability.

### What the richer forks add (e.g. WhaticketPlus)
Sectors & queues, agent management, contact wallet (CRM), **tags**, tasks, **internal chat /
private notes**, quick replies w/ attachments, scheduled & recurring messages, campaigns, a
**chatbot flow builder**, integrations (ChatGPT, Dialogflow, N8N, Typebot, webhooks),
multichannel (WhatsApp/Instagram/Facebook via Meta's official API), dashboards & statistics,
and a REST API. ([WhaticketPlus](https://github.com/DEV7Kadu/WhaticketPlus))

### Critical caveat — official vs unofficial WhatsApp
- `whatsapp-web.js` is **unofficial** browser automation and violates WhatsApp ToS. Real users
  report bans after as few as 10–200 proactive messages. As of **Oct 23, 2025**, Meta's
  **Cloud API is the only path for new official integrations**.
- The **official WhatsApp Business Cloud API** is hosted by Meta, near-zero ban risk if you
  follow policy (opt-in, approved templates, good quality rating). 2026 pricing is **per
  delivered message** by category (marketing / utility / authentication / service; service
  messages largely free). A single ban can cost far more than API fees.
- **Implication for hiraticket:** since you chose *manual/internal* intake, you sidestep this
  entirely for now. If WhatsApp is ever added, go straight to the official Cloud API.
- Sources: [ban risk](https://blog.kraya-ai.com/whatsapp-automation-ban-risk),
  [2026 pricing](https://blueticks.co/blog/whatsapp-business-api-pricing-2026),
  [respond.io guide](https://respond.io/blog/whatsapp-business-api-pricing).

---

## Part 2 — Monday.com & similar (orders, status, comments, transfer)

This is the *generic-workflow* version of the same pattern: a work item moving through stages,
owned by someone, discussed in a thread, and moved between areas.

**Monday.com** building blocks:
- **Status column** — colored labels (Pending / In progress / Done / custom) per order.
  ([status column](https://support.monday.com/hc/en-us/articles/360001269685-The-Status-Column))
- **Owners** — assign each order to a person/team for accountability.
- **Updates / comments + @mentions** — per-item discussion thread + file attachments.
- **Cross-board automations** — "when status → X, move item to another board / notify team" =
  automated **transfer between areas**.
  ([cross-board automations](https://support.monday.com/hc/en-us/articles/360011393900-Cross-board-automations))

**Comparable tools:**
- [Teamhood](https://teamhood.com/knowledge-base/examples/order-management/) — Kanban with
  swimlanes & hierarchies, explicitly used for order management.
- [KanbanBOX](https://www.kanbanbox.com/kanban-software-for-production/) — production/supply-chain
  Kanban; cards flow **between departments**, Notes section for per-card comments.
- [Kanban Tool](https://kanbantool.com/), [Businessmap](https://businessmap.io/kanban-resources/kanban-software),
  [Wrike](https://www.wrike.com/kanban-guide/kanban-tools-software/),
  [ProofHub](https://monday.com/blog/project-management/kanban-software-tools/) — general team
  Kanban: real-time status, comments, transfers between columns/boards.

---

## Part 3 — How they map (and what it means for hiraticket)

Both categories are the **same underlying pattern** — a *work item* with **status**, an
**owner/area**, a **comment thread**, and **movement between areas**:

| Dimension | Whaticket | Monday / Kanban |
|---|---|---|
| Entry point | Incoming WhatsApp message | Manual / form / integration |
| Item = | Conversation / ticket | Order / card |
| Stages | pending → open → closed | Custom status columns |
| Transfer | Between queues / agents | Between groups / boards |
| Comments | Customer chat + internal notes | Updates thread + internal |
| Best for | Customer messaging at scale | Internal order/process tracking |

**hiraticket sits closest to the Monday/Kanban side** (manual intake, internal orders) but
should borrow Whaticket's strongest ideas: explicit **queues = areas/departments**, an
**accept/assign step**, **transfer with history**, and **internal notes vs customer-facing**
distinction.

### Suggested domain model (for the future build)
- **Order** — id, title/customer, current `status`, current `area`, assignee, priority,
  timestamps.
- **Area / Department** — Sales, Workshop/Kitchen, Delivery, etc. (the "queues").
- **Status** — configurable pipeline per area or global (e.g. New → In progress → Ready → Done).
- **Comment** — order_id, author, body, `internal?` flag, attachments, timestamp.
- **Transfer / Event log** — immutable **audit trail**: who moved what, from→to area, status
  changes, when. Order-management best practice is an immutable, timestamped event log of every
  status change and transfer.
  ([order-management audit trail](https://www.hyperbots.com/glossary/order-management-audit-trail),
  [audit trail best practices](https://trullion.com/blog/audit-trail-guide/))
- **User / Role** — tiered permissions (who creates, who approves, who can transfer, who only
  views) — recommended by enterprise order-management guidance.
  ([order management best practices](https://business.amazon.com/en/blog/order-management))

### Capability checklist (all three weighted equally, per your answer)
- **Status tracking:** configurable stages, board/Kanban view grouped by status or area.
- **Comments/collaboration:** per-order thread, @mentions, internal-vs-customer notes, files.
- **Transfer between areas:** one action that reassigns area + (optionally) status, logged to
  the audit trail, with notification to the receiving area.

---

## Sources
- Whaticket: [canove/whaticket-community](https://github.com/canove/whaticket-community),
  [Ticketz](https://github.com/ticketz-oss/ticketz),
  [WhaticketPlus](https://github.com/DEV7Kadu/WhaticketPlus)
- WhatsApp API: [ban risk](https://blog.kraya-ai.com/whatsapp-automation-ban-risk),
  [2026 pricing](https://blueticks.co/blog/whatsapp-business-api-pricing-2026),
  [respond.io](https://respond.io/blog/whatsapp-business-api-pricing)
- Monday/Kanban: [status column](https://support.monday.com/hc/en-us/articles/360001269685-The-Status-Column),
  [cross-board automations](https://support.monday.com/hc/en-us/articles/360011393900-Cross-board-automations),
  [Teamhood](https://teamhood.com/knowledge-base/examples/order-management/),
  [KanbanBOX](https://www.kanbanbox.com/kanban-software-for-production/)
- Audit/order best practices: [audit trail](https://www.hyperbots.com/glossary/order-management-audit-trail),
  [order management](https://business.amazon.com/en/blog/order-management)
