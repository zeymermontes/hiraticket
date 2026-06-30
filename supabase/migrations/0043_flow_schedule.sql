-- Time/date-based flows: off-hours auto-reply + holiday auto-reply.
-- These triggers fire on inbound WhatsApp messages (evaluated by the Go worker), so they need:
--   1. a per-business timezone to know when "after 5pm / before 10am" actually is, and
--   2. a place to store the schedule config (open hours, or the holiday date) for each flow.

alter table public.businesses
  add column if not exists timezone text not null default 'America/Mexico_City';

-- Schedule config for the new trigger types:
--   message_hours: {"open_from":"10:00","open_to":"17:00","cooldown_hours":6}
--                  → reply when the local time is OUTSIDE [open_from, open_to)
--   message_date:  {"date":"2026-12-25","recurring":true,"cooldown_hours":6}
--                  → reply when today matches (recurring = month+day only)
alter table public.automations
  add column if not exists trigger_config jsonb not null default '{}'::jsonb;
