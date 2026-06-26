-- ============================================================
-- Hiraticket — make each agent's avatar color deterministic from their email, so the same person
-- always gets the same color everywhere (avatars, sender-name colors in chats). All agent colors in
-- the app flow from profiles.avatar_color, so deriving it here updates every consumer at once.
-- ============================================================

create or replace function public.color_from_email(p_email text)
returns text language sql immutable as $$
  select (array[
    '#0E8C82','#2563EB','#7C3AED','#DB2777','#DC2626','#EA580C',
    '#CA8A04','#16A34A','#0891B2','#4F46E5','#9333EA','#0D9488'
  ])[ (((('x' || substr(md5(lower(coalesce(p_email, ''))), 1, 8))::bit(32)::int) % 12 + 12) % 12) + 1 ];
$$;

-- New signups: set a deterministic color (keep the full_name behavior).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, avatar_color)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    public.color_from_email(new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Backfill existing profiles from their account email.
update public.profiles p
   set avatar_color = public.color_from_email(u.email)
  from auth.users u
 where u.id = p.id;
