---
name: chat-parity
description: Keep the team/agents chat (InternalChat) and the clients/WhatsApp chat (ChatScreen Thread) behaving IDENTICALLY. Invoke BEFORE adding or changing ANY feature in either chat — composer, message bubbles, menus, media/attachments, stickers, reactions, replies, mentions, link previews, paste, popovers, etc. The two chats must be the same: reuse the same component when possible, otherwise make an exact feature copy. If a feature might be intentionally one-sided, ASK first.
---

# Chat parity (clients chat ⇄ team chat)

Hiraticket has two chats and they must feel **exactly the same**:

- **Clients / WhatsApp chat** — `src/components/chat/ChatScreen.tsx` (the `Thread` component).
  Talks to `messages` / `conversations`. This is the **reference / source of truth** for chat UX.
- **Team / agents chat** — `src/components/InternalChat.tsx`. Talks to `internal_messages` /
  `internal_reads`. It must mirror the clients chat.

The recurring bug: a feature gets added/changed in one chat and the other drifts. Don't let that
happen.

## Rules (in order)

1. **Reference first.** Before touching either chat, open `ChatScreen.tsx` and find how the clients
   chat does this feature. That implementation is the spec.
2. **Reuse the same component/helper.** If the clients chat already has the piece, **export it from
   `ChatScreen.tsx` and import it into `InternalChat`** rather than rewriting. Already shared this
   way: `linkify`, `firstUrl`, `LinkPreview`, `MediaThumb`, `EmojiPicker`, `menuStyle`. Prefer adding
   to this list over duplicating.
3. **Exact copy when reuse isn't possible.** The data layer differs (`messages` vs
   `internal_messages`), so some logic can't be literally shared. Then copy the behavior **exactly** —
   same UX, same markup/classes, same icons/labels/order, same keyboard shortcuts, same popovers
   (via `menuStyle`), same modals (e.g. the staged-files caption modal), same optimistic flow.
4. **Apply to BOTH.** If the request says "add X to the team chat" (or the clients chat) and X is a
   generic chat feature, implement it in **both** so they stay identical — unless told otherwise.
5. **If unsure about scope, ASK.** Some features are legitimately one-sided (WhatsApp-only: delivery
   ticks, view-once, "ya respondido", forward-to-WhatsApp, business/orders panel, typing presence;
   team-only: @teammate mentions, DM vs team channel). When it's not obvious whether a feature should
   be **clients-only**, **team-only**, or **both**, ask before building — but the default expectation
   is that the two chats are the same.

## Feature parity checklist (keep these in sync)

Composer: text + Enter-to-send (Shift+Enter newline) · emoji picker · attach (button) ·
**paste image/file** · **staged-files modal with caption** · reply banner · edit banner ·
stickers tray · @mention autocomplete (team) / canned `/` (clients). Bubbles: reply quote +
**click-to-jump + flash** · forwarded label · edited/deleted states · reactions (quick picker) ·
media (image inline / file card) · link preview + linkify · per-message menu (React 😊 · Reply
`swap` · Forward `forward` · Edit `edit` · Delete `trash`) anchored with `.msg-menu` + `menuStyle`.

When you add anything here to one chat, add it to the other (or ask).

## Verify
- Diff the two composers + bubble renderers mentally: any capability in one missing from the other?
- Popovers go through `menuStyle` (see the `popup-review` skill); icons match the canonical menu.
- `npx tsc --noEmit` + `npm run build` green.
