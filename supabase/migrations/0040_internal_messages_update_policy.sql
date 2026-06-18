-- ============================================================
-- Hiraticket — internal_messages was missing an UPDATE RLS policy, so edit / delete
-- (soft-delete) / reactions silently did nothing (RLS made the row invisible to UPDATE).
-- Allow channel members to update; edit & delete stay author-only via the app's WHERE clause,
-- while reactions can be toggled by anyone in the channel.
-- ============================================================

drop policy if exists "update internal_messages" on public.internal_messages;
create policy "update internal_messages" on public.internal_messages
  for update using (public.is_business_member(business_id)
    and (channel = 'team' or channel like '%' || auth.uid()::text || '%'))
  with check (public.is_business_member(business_id)
    and (channel = 'team' or channel like '%' || auth.uid()::text || '%'));
