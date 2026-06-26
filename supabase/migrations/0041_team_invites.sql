-- ============================================================
-- Hiraticket — team invitations (invite existing accounts + shareable join links).
--   We never create accounts on someone's behalf. Inviting checks the account exists and creates a
--   PENDING invite the user accepts via a popup. Share links carry a token with optional expiry /
--   one-time use. For now each account can belong to only ONE team (enforced in the accept action).
-- ============================================================

create table if not exists public.team_invites (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  role        text not null default 'agent' check (role in ('admin', 'agent', 'viewer')),
  area_id     uuid,
  email       text,            -- direct invite to this email (NULL for share links)
  token       text unique,     -- share-link secret (NULL for direct email invites)
  created_by  uuid references auth.users (id) on delete set null,
  expires_at  timestamptz,     -- NULL = never
  max_uses    int,             -- NULL = unlimited; 1 = one-time
  used_count  int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists team_invites_email_idx on public.team_invites (lower(email));
create index if not exists team_invites_token_idx on public.team_invites (token);

alter table public.team_invites enable row level security;

-- Admins of a business manage its invites (direct-client reads in the agents page). The invited
-- user's lookup/accept flows run through service-role server actions (they aren't members yet).
create or replace function public.is_business_admin(b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = b and m.user_id = auth.uid() and m.role = 'admin'
  );
$$;

drop policy if exists "admins manage team_invites" on public.team_invites;
create policy "admins manage team_invites" on public.team_invites
  for all using (public.is_business_admin(business_id)) with check (public.is_business_admin(business_id));

-- Look up a user id by email (to check an account exists / match a direct invite). Security definer
-- so it can read auth.users; restricted to the service role (used only by server actions) to avoid
-- email enumeration from the client.
create or replace function public.user_id_by_email(p_email text)
returns uuid language sql security definer stable set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;
revoke all on function public.user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.user_id_by_email(text) to service_role;
