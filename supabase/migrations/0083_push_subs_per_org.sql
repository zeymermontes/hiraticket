-- ============================================================
-- Hiraticket — la suscripción de push pasa a ser por (organización, dispositivo).
--
--   Un fallo que solo existe con multiempresa, y silencioso, que es lo peor de él.
--
--   0082 declaró `endpoint text not null unique`: único a nivel GLOBAL. Un navegador tiene UN
--   endpoint, así que si la misma persona activa las notificaciones en la organización A y luego
--   en la B, el upsert por endpoint REESCRIBE la fila —- cambia business_id— y deja de llegarle
--   nada de A. Sin error, sin aviso: el botón de Ajustes seguiría diciendo "activado" en las dos.
--
--   Con la restricción sobre (business_id, endpoint), el mismo aparato puede tener una fila por
--   organización y recibir de todas. Es lo correcto: la persona es la misma y el teléfono también,
--   pero lo que le avisan son negocios distintos.
--
--   Nada que migrar en los datos: las filas existentes ya cumplen la restricción nueva (eran
--   únicas por endpoint, así que lo son por (business_id, endpoint) con más razón).
-- ============================================================

alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_key;

-- Idempotente: si ya existe con este nombre, no se toca.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'push_subscriptions_business_endpoint_key'
      and conrelid = 'public.push_subscriptions'::regclass
  ) then
    alter table public.push_subscriptions
      add constraint push_subscriptions_business_endpoint_key unique (business_id, endpoint);
  end if;
end $$;
