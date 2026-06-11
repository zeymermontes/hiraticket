-- ============================================================
-- Hiraticket — WhatsApp group chat support (opt-in per business, chat-only).
--   Groups never create or link orders; they exist purely to read/reply in the chat.
--   The worker also applies these idempotently at boot, so this migration is a no-op if it ran first.
-- ============================================================

-- A conversation can represent a group. group_jid (e.g. '12036…-…@g.us') routes outbound sends;
-- group_subject caches the group's display name. is_group gates order affordances in the UI.
alter table public.conversations
  add column if not exists is_group      boolean not null default false,
  add column if not exists group_jid     text,
  add column if not exists group_subject text;

-- In a group, each message has a distinct sender. sender_name is shown (color-coded) above the
-- bubble; sender_jid is the stable key the UI hashes to pick a per-participant color.
alter table public.messages
  add column if not exists sender_name text,
  add column if not exists sender_jid  text;

-- A synthetic contact backs each group conversation (holds the group's name). Flag it so the rest
-- of the app can exclude groups from contact/order pickers.
alter table public.contacts
  add column if not exists is_group boolean not null default false;

-- Per-business opt-in. Default off — group chats only appear once the owner enables them.
alter table public.businesses
  add column if not exists allow_groups boolean not null default false;

-- One conversation per group per business.
create unique index if not exists conversations_group_jid_uniq
  on public.conversations (business_id, group_jid) where group_jid is not null;
