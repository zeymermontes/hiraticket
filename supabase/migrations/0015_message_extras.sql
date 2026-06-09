-- ============================================================
-- Hiraticket — message extras: forwarded/edited flags + structured meta
-- (location coords, contact vCard, etc.) for richer rendering.
-- ============================================================

alter table public.messages add column if not exists forwarded boolean not null default false;
alter table public.messages add column if not exists edited boolean not null default false;
alter table public.messages add column if not exists meta jsonb;
