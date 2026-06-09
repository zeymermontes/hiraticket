-- ============================================================
-- Hiraticket — SaaS layer: plans, subscriptions, WhatsApp sessions,
-- and platform (super-admin) access.
-- ============================================================

-- ---------- plans (global catalog) ----------
create table if not exists public.plans (
  id            text primary key,            -- 'inicio' | 'pro' | 'negocio'
  name          text not null,
  price_monthly numeric(10,2) not null default 0,
  price_annual  numeric(10,2) not null default 0,
  currency      text not null default 'MXN',
  popular       boolean not null default false,
  limits        jsonb not null default '{}', -- { agents, whatsapp, automations, ... }
  features      jsonb not null default '[]',
  position      int not null default 0
);

insert into public.plans (id, name, price_monthly, price_annual, popular, limits, features, position) values
  ('inicio',  'Inicio',   499,  4990, false,
   '{"agents":3,"whatsapp":1,"automations":3}',
   '["Chat + Pedidos","1 número de WhatsApp","3 agentes","Tablero Kanban"]', 0),
  ('pro',     'Pro',      999,  9990, true,
   '{"agents":10,"whatsapp":2,"automations":20}',
   '["Todo en Inicio","10 agentes","2 números","Automatizaciones","Reportes"]', 1),
  ('negocio', 'Negocio',  1999, 19990, false,
   '{"agents":-1,"whatsapp":5,"automations":-1}',
   '["Todo en Pro","Agentes ilimitados","5 números","Campañas","API"]', 2)
on conflict (id) do nothing;

alter table public.plans enable row level security;
create policy "plans readable" on public.plans for select using (auth.uid() is not null);

-- ---------- subscriptions (one per business) ----------
create table if not exists public.subscriptions (
  business_id   uuid primary key references public.businesses (id) on delete cascade,
  plan_id       text not null references public.plans (id) default 'pro',
  status        text not null default 'trialing' check (status in ('trialing','active','past_due','canceled')),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly','annual')),
  mrr           numeric(10,2) not null default 0,
  trial_ends_at timestamptz default (now() + interval '14 days'),
  current_period_end timestamptz default (now() + interval '30 days'),
  created_at    timestamptz not null default now()
);

alter table public.subscriptions enable row level security;
create policy "members read subscription" on public.subscriptions
  for select using (public.is_business_member(business_id));

-- ---------- whatsapp sessions ----------
create table if not exists public.whatsapp_sessions (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  label       text not null default 'Principal',
  phone       text,
  status      text not null default 'disconnected'
              check (status in ('disconnected','qr','connecting','connected','reconnecting')),
  qr          text,
  last_seen   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_wa_business on public.whatsapp_sessions (business_id);

alter table public.whatsapp_sessions enable row level security;
create policy "members manage wa" on public.whatsapp_sessions
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- ---------- platform (super-admin) ----------
create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_platform_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

alter table public.platform_admins enable row level security;
create policy "admins read platform_admins" on public.platform_admins
  for select using (public.is_platform_admin() or user_id = auth.uid());

-- Bootstrap: the first caller can claim platform-admin (only while none exist).
create or replace function public.bootstrap_platform_admin()
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.platform_admins) then
    raise exception 'platform already has an admin';
  end if;
  insert into public.platform_admins (user_id) values (auth.uid());
end;
$$;

-- Members of a shared business can read each other's profiles (names/avatars).
create policy "read co-member profiles" on public.profiles for select using (
  public.is_platform_admin() or exists (
    select 1 from public.business_members m1
    join public.business_members m2 on m1.business_id = m2.business_id
    where m1.user_id = auth.uid() and m2.user_id = profiles.id
  )
);

-- Platform admins can read across all tenants (subscriptions, businesses, wa health).
create policy "platform read subscriptions" on public.subscriptions
  for select using (public.is_platform_admin());
create policy "platform read businesses" on public.businesses
  for select using (public.is_platform_admin());
create policy "platform read wa" on public.whatsapp_sessions
  for select using (public.is_platform_admin());

-- Give every new business a default trialing subscription.
create or replace function public.create_business(p_name text, p_vertical text default 'imprenta')
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  insert into public.businesses (name, vertical, created_by)
  values (p_name, coalesce(p_vertical, 'imprenta'), auth.uid())
  returning id into new_id;

  insert into public.business_members (business_id, user_id, role)
  values (new_id, auth.uid(), 'admin');

  insert into public.subscriptions (business_id, plan_id, status, mrr)
  values (new_id, 'pro', 'trialing', 999)
  on conflict (business_id) do nothing;

  insert into public.whatsapp_sessions (business_id, label, status)
  values (new_id, 'Principal', 'disconnected');

  return new_id;
end;
$$;
