-- ============================================================
-- Hiraticket — quantity-based price tiers for catalog products.
--   price_tiers: jsonb array of { min, price } — the unit price once the quantity reaches `min`
--   (highest matching min wins; below all tiers the product's base `price` applies).
-- ============================================================

alter table public.products add column if not exists price_tiers jsonb not null default '[]'::jsonb;
