-- ============================================================
-- Hiraticket — allow members to UPDATE their own business.
--   The businesses table had SELECT + INSERT policies but no UPDATE policy, so every
--   updateBusinessProfile() (vertical, object name, custom fields, product_stages) silently
--   affected 0 rows under RLS. This adds the missing UPDATE policy.
-- ============================================================

drop policy if exists "members update business" on public.businesses;
create policy "members update business" on public.businesses
  for update using (public.is_business_member(id))
  with check (public.is_business_member(id));
