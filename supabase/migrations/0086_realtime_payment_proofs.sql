-- ============================================================
-- Hiraticket — publicar payment_proofs en realtime.
--
--   0048 creó la tabla y RealtimeNotifier lleva desde entonces escuchando sus INSERT para avisar
--   "comprobante por revisar". Solo que esa tabla nunca se agregó a la publicación de realtime, así
--   que Supabase no emite nada por ella: la suscripción existía, el código estaba bien escrito, y
--   el aviso no salía NUNCA. Un fallo mudo de manual —- no hay error que ver, simplemente no pasa
--   nada— y por eso el único rastro de un pago por aprobar era entrar al pedido a mano.
--
--   Lo que viaja por realtime es la fila, y sus políticas de RLS siguen aplicando: solo la ve quien
--   ya podía leerla, o sea el equipo de ese negocio.
-- ============================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payment_proofs'
    ) then
      alter publication supabase_realtime add table public.payment_proofs;
    end if;
  end if;
end $$;
