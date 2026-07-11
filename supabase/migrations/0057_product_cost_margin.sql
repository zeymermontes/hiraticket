-- ============================================================
-- Hiraticket — product cost + default margin for manual items (reports profit).
--   products.cost: what the product costs the business (null = unknown → the default
--   margin below applies). Profit per sold item = subtotal - cost*qty when the item's
--   name matches a catalog product with a cost; otherwise subtotal * manual_margin_pct.
--   businesses.manual_margin_pct: % of the sale that is profit for manually-typed
--   items (not from the catalog). Default 50%.
-- ============================================================

alter table public.products  add column if not exists cost numeric(12,2);
alter table public.businesses add column if not exists manual_margin_pct numeric(5,2) not null default 50;
