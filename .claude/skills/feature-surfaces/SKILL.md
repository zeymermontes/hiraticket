---
name: feature-surfaces
description: Before implementing or changing ANY feature in Hiraticket, enumerate EVERY surface (button, menu, modal, list vs detail, single vs bulk, chat vs team chat, worker, flows) where the same action or concept appears, and apply the change to all of them — or ask. Invoke at the START of any feature/bugfix that touches a user action, a data field, or a workflow. This prevents the recurring miss where a change lands in one place but the same action exists in 2-3 others (e.g. the catalog picker that worked in the orders table but not in the chat's new-order modal; a "transfer" that's confirmed in one menu but not the bulk one).
---

# Feature surfaces (apply a change everywhere the action lives)

The recurring failure: a feature or fix is implemented in the **one** place the user pointed at,
but the same action/concept exists in **other** places that silently drift or stay broken. Examples
that already bit us:

- "Add from catalog" worked in the orders table's new-order modal but was passed `products={[]}`
  in the **chat's** new-order modal → the picker was missing there.
- A conversation can be reassigned from **three** surfaces (header `TransferControl`, workspace
  `TransferModal`, chat-list **bulk assign**) — a rule about transferring (e.g. the "mantener
  conmigo" lock confirm) must hit all three, plus the **flow** auto-assign and the **worker**.

So: before writing code, map the surfaces. After writing, verify each one.

## Step 1 — Identify the action/concept

Name the verb or field the feature is about: *create order*, *assign/transfer conversation*,
*resolve*, *delete*, *send message*, *add tag*, *a new column on conversations/orders*, etc.

## Step 2 — Enumerate every surface (grep, don't guess)

For that action, search the codebase and list **all** call sites. Common multipliers in this app —
check each that applies:

- **Single vs bulk.** Many list actions have a one-row version **and** a multi-select bulk version
  (chat list long-press → `bulkSetStatus` / `bulkAssign` / `bulkDeleteConvs`). Find the bulk twin.
- **Header vs detail vs menu.** The same action often sits in a header button, a workspace panel,
  **and** an "Acciones" popover (`actionsRect` grid). Check `ChatScreen` Thread header,
  `Workspace`, `StatusControl`/`SnoozeControl`/`TransferControl`.
- **Clients chat vs team chat.** If it's a chat feature, see the `chat-parity` skill — mirror it in
  `InternalChat`.
- **Modal reuse.** A shared modal (`NewOrderModal`, `TransferModal`, `OrderDrawer`) is rendered from
  multiple parents with **different props**. Grep every render site and check the props match (the
  catalog bug was an empty-array prop at one site).
- **List query vs detail query vs live refetch.** A new column on a table usually needs adding to
  `getConversationList`, `getConversationDetail`, **and** `liveConvHeader`/`liveList` (plus the
  `ConvListItem`/`ConvDetail` types and `skeletonDetail`). Miss one → it's stale or undefined on
  that path.
- **App vs server actions vs Go worker.** Inbound-message and assignment effects may also be driven
  by the **worker** (`services/whatsapp/main.go`, e.g. reopen, auto-reply, lock-preserve) and by
  **flows/automations** (`runConvStatusAutomations`, `runStageAutomations`). A rule enforced only in
  the UI is bypassable by the worker/flow path — enforce it there too.
- **Orders side vs conversations side.** Orders and conversations both have `assignee_id`, stages,
  soft-delete, etc. A change to one may have a mirror on the other — check both before assuming.

Write the list out (even just inline) so coverage is explicit.

## Step 3 — Apply to all, or ask

Implement the change at **every** surface from Step 2. If a surface should be intentionally excluded
(e.g. a rule that only makes sense for single, not bulk), say so and **ask** rather than silently
skipping. Use `confirm()` consistently for the same kind of guard across surfaces (don't add a popup
to one transfer path and leave another silent).

## Step 4 — Verify coverage

- Re-grep the action name and the modal/component name; confirm each call site was handled.
- For a new field: grep the field name across `src/lib` (types + queries + live-actions),
  `skeletonDetail`, and the worker — every read path returns it.
- `npx tsc --noEmit` + `npm run build` green; if the worker changed, `go build ./...` in
  `services/whatsapp`.
- State in the summary which surfaces you touched, so the user can spot a missing one.

## Related skills
- `chat-parity` — the specific clients-chat ⇄ team-chat case of this rule.
- `popup-review` — keep the popovers/confirms you add consistent and on-screen.
- `dual-mode` — every user-facing surface you touch must also respect business/personal wording.
