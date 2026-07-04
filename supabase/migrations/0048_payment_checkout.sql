-- ============================================================
-- Hiraticket — customer payment checkout.
--   Business config: physical branches (pay in person) + bank accounts (transfer) + which
--   methods are enabled. Each order gets an unguessable pay_token for a public checkout page
--   (/pay/<token>). Customers who transfer upload a receipt → a payment_proof row that stays
--   'pending' until an agent approves it (approval records a real payment).
-- ============================================================

-- Payment config on the business (jsonb lists, mirroring custom_fields).
--   branches:      [{ id, name, address, maps_url, phone, hours }]
--   bank_accounts: [{ id, bank, holder, clabe, card, note }]
alter table public.businesses add column if not exists branches            jsonb   not null default '[]'::jsonb;
alter table public.businesses add column if not exists bank_accounts        jsonb   not null default '[]'::jsonb;
alter table public.businesses add column if not exists pay_branch_enabled   boolean not null default false;
alter table public.businesses add column if not exists pay_transfer_enabled boolean not null default false;

-- Unguessable token for the public checkout page (so orders aren't enumerable by code).
alter table public.orders add column if not exists pay_token text unique;

-- Customer-uploaded transfer receipts, pending agent review.
create table if not exists public.payment_proofs (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  order_id    uuid not null references public.orders (id) on delete cascade,
  method      text not null default 'transfer',
  account_ref text,                        -- label of the bank account the customer used
  image_url   text not null,
  image_mime  text,
  amount      numeric(12,2),
  payer_note  text,
  status      text not null default 'pending',   -- pending | approved | rejected
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists payment_proofs_order_idx     on public.payment_proofs (order_id);
create index if not exists payment_proofs_biz_status_idx on public.payment_proofs (business_id, status);

alter table public.payment_proofs enable row level security;
drop policy if exists "members proofs" on public.payment_proofs;
create policy "members proofs" on public.payment_proofs
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));
-- Inserts from the public checkout use the service-role client (bypasses RLS) validated by pay_token.
