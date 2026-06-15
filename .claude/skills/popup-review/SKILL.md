---
name: popup-review
description: Review and fix popovers/menus/dropdowns/tooltips in Hiraticket so they are homogeneous and never overflow or get clipped by another section. Invoke BEFORE adding or changing any floating UI — menus, action popovers, pickers (emoji/sticker/mention), dropdowns, the notification bell, message "⋯" menus, tooltips — and when reviewing them. Catches off-screen/cut-off popups, inconsistent anchoring, wrong trigger-button placement, and mismatched icons/labels between similar menus.
---

# Popup / popover review (homogeneous + on-screen)

Floating UI in this app must be **consistent** and must **stay fully on screen**. The recurring bugs:
a popover runs off the right/bottom edge, gets clipped by a scroll container, anchors inconsistently,
or two similar menus use different icons/order. Use this checklist whenever you touch floating UI.

## The shared building blocks (use these — don't reinvent)

- **`usePopover()`** (`src/components/chat/ChatScreen.tsx`) — `{ ref, open, rect, toggle, close }`. The
  trigger button gets `ref`; `rect` is its bounding box captured on open.
- **`menuStyle(rect, opts)`** (`src/lib/popover.ts`) — returns a `position: fixed` style that clamps
  the menu inside the viewport (right/left/bottom-flip, 8px margins). **Always** position menus with
  this instead of hand-writing `top/left`, so nothing runs off-screen.
- **`.menu` / `.menu-item` / `.menu-label` / `.menu-sep`** — the standard popover container + rows.
  Use them so every popover looks the same (surface, radius, shadow, padding, hover).
- **Backdrop**: render `<div style={{ position:"fixed", inset:0, zIndex:200 }} onClick={close} />`
  behind the menu (menu at zIndex 201) so an outside click closes it.

## Checklist

1. **On-screen, always.** Position with `menuStyle(rect, …)` (or equivalent clamping). A menu opened
   near the right edge must shift left; near the bottom must flip above the trigger. Test mentally at
   each screen corner. Never let a fixed `left`/`top` push content past `window.innerWidth/Height`.
2. **Not clipped by a parent.** A popover inside a scroll/`overflow:hidden` container (chat thread,
   tablewrap, drawer) must use `position: fixed` (not absolute) so it escapes the clip. If it's
   `absolute`, the parent must not clip it.
3. **Trigger placement.** The "⋯"/action button sits where its sibling does in the matching feature.
   For message menus, mirror the chat: wrap in `<span className="msg-menu" style={{ position:"absolute",
   top:3, [out?"right":"left"]:4 }}>` so it's top-corner of the bubble on the correct side.
4. **Homogeneous icons + labels + order.** Menus for the same action set must use the SAME `Icon`
   names, labels, and order as the reference. Canonical message menu (from chat `MsgMenu`):
   React `😊` · Reply `swap` · Forward `forward` · Edit `edit` · Delete `trash` (danger). Match it.
5. **Anchor side matches origin.** Right-aligned/outbound triggers open the menu anchored to their
   right edge; left/inbound anchor left. (`menuStyle` takes an `align` for this.)
6. **z-index.** Backdrop 200, menu 201 (or higher than the local stacking context). Don't let a menu
   sit under a drawer/header.
7. **Width + scroll.** Give the menu a fixed width; if its content can be long (lists, pickers), add
   `max-height` + `overflow-y:auto` (+ the `scroll` class) so it never grows past the screen.
8. **Dismissal.** Outside click (backdrop) and selection both close it; Escape closes pickers.

## Verify
Grep the files you touched for hand-rolled positioning that should use the helper:
`grep -nE "position: ?\"fixed\"|window.innerWidth|top: rect|left: rect" <files>` — each hit should
go through `menuStyle` or justify why not. Then build (`npx tsc --noEmit` + `npm run build`) and, for
each popover changed, mentally open it at the four screen corners and confirm it stays visible.
