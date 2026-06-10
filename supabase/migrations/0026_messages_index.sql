-- ============================================================
-- Hiraticket — index for fast paginated message loads.
--   The chat loads the newest N messages of a conversation, then older pages by created_at.
--   This composite index makes that ORDER BY created_at DESC LIMIT N a quick index scan.
-- ============================================================

create index if not exists messages_conv_created_idx
  on public.messages (conversation_id, created_at desc);
