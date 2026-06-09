-- Per-vertical custom fields shown on orders (e.g. Plate, Pet, Paper type).
alter table public.businesses add column if not exists custom_fields jsonb not null default '[]';
