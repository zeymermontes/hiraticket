-- "Mantener conmigo" — pin a conversation to a specific agent. When locked_to is set, the chat
-- always stays assigned to that agent regardless of status (resolved/reopened) and is never stolen
-- by auto-assign / area-routing flows. Cleared by "Soltar cliente".
alter table public.conversations
  add column if not exists locked_to uuid references auth.users (id);
