-- ============================================================
-- Hiraticket — suscripciones de Web Push (una por navegador/dispositivo).
--
--   Hasta ahora avisar dependía de tener la pestaña abierta: RealtimeNotifier escucha Supabase y
--   pinta un toast. Con la app cerrada no llegaba nada, y en Android ni siquiera con la app
--   abierta —- `new Notification()` lanza excepción ahí y exige un service worker.
--
--   Web Push cambia quién avisa: ya no es el navegador reaccionando, es el SERVIDOR empujando. Para
--   eso hace falta guardar a dónde empujar, y eso es esta tabla.
--
--   endpoint es la identidad: lo da el navegador, es único por dispositivo+navegador, y cambia solo
--   si la suscripción se renueva. Por eso es la llave del upsert —- reinstalar la app no debe
--   dejar filas huérfanas acumulándose.
--
--   Las PREFERENCIAS de qué avisar NO viven aquí: son de la persona, no del aparato, y ya están en
--   profiles.notif_prefs (0068). Aquí solo vive el "por dónde".
-- ============================================================

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  ua          text,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- El envío pregunta siempre "dame los endpoints de estos usuarios de este negocio".
create index if not exists push_subs_user_idx on public.push_subscriptions (business_id, user_id);

alter table public.push_subscriptions enable row level security;

-- Cada quien administra las suyas y nada más. El ENVÍO no pasa por aquí: corre del lado del
-- servidor con la llave de servicio, que se salta RLS —- si no, un agente tendría que poder leer
-- los endpoints de sus compañeros para poder avisarles, y eso es justo lo que no queremos.
drop policy if exists "push own select" on public.push_subscriptions;
create policy "push own select" on public.push_subscriptions
  for select using (user_id = auth.uid());
drop policy if exists "push own insert" on public.push_subscriptions;
create policy "push own insert" on public.push_subscriptions
  for insert with check (user_id = auth.uid() and public.is_business_member(business_id));
drop policy if exists "push own update" on public.push_subscriptions;
create policy "push own update" on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "push own delete" on public.push_subscriptions;
create policy "push own delete" on public.push_subscriptions
  for delete using (user_id = auth.uid());
