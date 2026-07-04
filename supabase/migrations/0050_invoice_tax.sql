-- ============================================================
-- Hiraticket — "Requiere factura" + IVA on orders.
--   Business config: whether checking "Requiere factura" adds tax to the total, and the rate
--   (default 16% — Mexican IVA), editable per business.
--   Orders: the checkbox state + the rate applied AT CREATION (so changing the business rate
--   later never rewrites old orders' totals).
-- ============================================================

alter table public.businesses add column if not exists invoice_add_tax  boolean      not null default true;
alter table public.businesses add column if not exists invoice_tax_rate numeric(5,2) not null default 16;

alter table public.orders add column if not exists requires_invoice boolean not null default false;
alter table public.orders add column if not exists tax_rate numeric(5,2); -- rate applied to THIS order (null = none)
