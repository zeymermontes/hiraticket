-- ============================================================
-- Hiraticket — initial schema (multi-tenant, RLS-protected)
-- A "business" is a tenant. Auth users join businesses as members
-- (admin / agent / viewer). All operational data is scoped by business.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- profiles (mirror of auth.users) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  avatar_color text default '#0E8C82',
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- businesses (tenants) ----------
create table if not exists public.businesses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  vertical    text not null default 'imprenta',
  object_singular text not null default 'Pedido',
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);

create table if not exists public.business_members (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null default 'agent' check (role in ('admin', 'agent', 'viewer')),
  area_id     uuid,
  presence    text not null default 'online',
  created_at  timestamptz not null default now(),
  primary key (business_id, user_id)
);

-- ---------- config: areas + stages ----------
create table if not exists public.areas (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name        text not null,
  color       text not null default 'slate',
  route_to    uuid references auth.users (id),
  position    int  not null default 0
);

create table if not exists public.stages (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name        text not null,
  color       text not null default 'slate',
  position    int  not null default 0
);

-- ---------- contacts ----------
create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name        text not null,
  phone       text,
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now()
);

-- ---------- conversations + messages ----------
create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  contact_id  uuid references public.contacts (id) on delete set null,
  channel     text not null default 'whatsapp',
  status      text not null default 'open' check (status in ('open', 'pending', 'resolved')),
  assignee_id uuid references auth.users (id),
  area_id     uuid references public.areas (id),
  unread      int  not null default 0,
  last_message_at timestamptz default now(),
  created_at  timestamptz not null default now()
);

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  direction   text not null check (direction in ('in', 'out')),
  type        text not null default 'text',
  body        text,
  media_url   text,
  author_id   uuid references auth.users (id),
  state       text default 'sent',
  created_at  timestamptz not null default now()
);

-- ---------- orders + items ----------
create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  code        text not null,
  contact_id  uuid references public.contacts (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  stage_id    uuid references public.stages (id),
  area_id     uuid references public.areas (id),
  assignee_id uuid references auth.users (id),
  priority    text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  pay_status  text not null default 'pending' check (pay_status in ('pending', 'partial', 'paid')),
  total       numeric(12,2) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  name       text not null,
  qty        int  not null default 1,
  unit_price numeric(12,2) not null default 0,
  subtotal   numeric(12,2) not null default 0
);

-- ---------- notes + events (audit log) ----------
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  parent_type text not null check (parent_type in ('conversation', 'order')),
  parent_id   uuid not null,
  author_id   uuid references auth.users (id),
  body        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  parent_type text not null check (parent_type in ('conversation', 'order')),
  parent_id   uuid not null,
  actor_id    uuid references auth.users (id),
  kind        text not null,
  text        text,
  created_at  timestamptz not null default now()
);

-- ---------- canned messages + automations ----------
create table if not exists public.canned_messages (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title       text not null,
  body        text not null,
  category    text,
  shortcut    text
);

create table if not exists public.automations (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  name          text not null,
  trigger_type  text not null,
  trigger_value text,
  action_type   text not null,
  action_payload jsonb not null default '{}',
  enabled       boolean not null default true,
  runs          int not null default 0
);

create index if not exists idx_orders_business on public.orders (business_id);
create index if not exists idx_conversations_business on public.conversations (business_id);
create index if not exists idx_messages_conversation on public.messages (conversation_id);

-- ============================================================
-- Row Level Security
-- ============================================================
create or replace function public.is_business_member(b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = b and m.user_id = auth.uid()
  );
$$;

-- profiles: a user sees/edits their own profile
alter table public.profiles enable row level security;
create policy "own profile read"  on public.profiles for select using (id = auth.uid());
create policy "own profile write" on public.profiles for update using (id = auth.uid());

-- businesses: members can read; creator can insert
alter table public.businesses enable row level security;
create policy "members read business" on public.businesses
  for select using (public.is_business_member(id));
create policy "create business" on public.businesses
  for insert with check (created_by = auth.uid());

-- business_members: a user sees rows for businesses they belong to
alter table public.business_members enable row level security;
create policy "read own memberships" on public.business_members
  for select using (user_id = auth.uid() or public.is_business_member(business_id));

-- Generic member-scoped policy for all operational tables.
do $$
declare t text;
begin
  foreach t in array array[
    'areas','stages','contacts','conversations','messages','orders',
    'notes','events','canned_messages','automations'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$create policy "members all" on public.%I
      for all using (public.is_business_member(business_id))
      with check (public.is_business_member(business_id));$f$, t);
  end loop;
end$$;

-- order_items inherit access from their parent order
alter table public.order_items enable row level security;
create policy "members order_items" on public.order_items
  for all using (
    exists (select 1 from public.orders o
            where o.id = order_items.order_id and public.is_business_member(o.business_id))
  )
  with check (
    exists (select 1 from public.orders o
            where o.id = order_items.order_id and public.is_business_member(o.business_id))
  );

-- ============================================================
-- Onboarding RPCs
-- ============================================================

-- Create a business and make the caller its admin.
create or replace function public.create_business(p_name text, p_vertical text default 'imprenta')
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  insert into public.businesses (name, vertical, created_by)
  values (p_name, coalesce(p_vertical, 'imprenta'), auth.uid())
  returning id into new_id;

  insert into public.business_members (business_id, user_id, role)
  values (new_id, auth.uid(), 'admin');

  return new_id;
end;
$$;
