-- ============================================================
-- Hiraticket — órdenes de cobro: anticipo, parcialidades y finiquito.
--
--   Hasta ahora había dos tablas de dinero y faltaba la de en medio:
--     · `payments`       (0025) — lo que YA entró.
--     · `payment_proofs` (0048) — el comprobante que el cliente subió, a la espera de revisión.
--   Ninguna dice lo que el negocio PIDIÓ cobrar. Sin eso, "50% de anticipo y el resto al entregar"
--   no se puede representar: solo se puede registrar el abono después de que ocurra, y el link de
--   pago —- uno por pedido, `orders.pay_token` —- siempre cobra el saldo completo. El cliente podía
--   escribir un monto menor al transferir, pero eso es el cliente decidiendo, no el asesor cobrando.
--
--   Un `charge` es una petición de cobro con su propio monto y su propio link. El movimiento clave
--   es que el token BAJA de `orders` a `charges`: el de `orders` significa "cobra lo que falte" y
--   se queda como está —- los links ya enviados siguen sirviendo—, mientras que el de un cobro
--   significa "cobra ESTO".
--
--   `payments.charge_id` une el dinero con la petición que lo provocó. Es NULLABLE a propósito: un
--   abono registrado a mano en el mostrador no tiene cobro detrás y eso es legítimo, no un hueco.
--
--   Lo que NO está aquí, y es deliberado: el "plan" de N pagos. Tres cobros seguidos ya expresan
--   50/30/20, y un asistente de planes antes de ver cómo se usa de verdad es adivinar.
-- ============================================================

create table if not exists public.charges (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  order_id    uuid not null references public.orders (id) on delete cascade,

  -- Posición dentro del pedido: es lo que deja escribir "Pago 2 de 3" en el ticket del cliente.
  -- Se calcula al crear y no se recalcula al anular: renumerar cambiaría el nombre de un cobro que
  -- el cliente ya tiene en su WhatsApp.
  seq         int  not null default 1,

  -- anticipo | parcialidad | finiquito. Es el concepto, no el monto: dos negocios llaman distinto
  -- a lo mismo y el nombre es lo que el cliente lee. `label` lo pisa cuando el asesor escribió otro.
  kind        text not null default 'parcialidad',
  label       text,

  amount      numeric(12,2) not null,
  due_at      timestamptz,

  -- draft  = creado, sin mandar (el asesor copió el link, o lo dejó listo para después)
  -- sent   = el cliente ya lo tiene
  -- paid   = los pagos ligados cubren el monto
  -- void   = anulado por el asesor; deja de contar para todo
  status      text not null default 'draft',

  -- Su propio link público: /pay/<token>. Único a nivel global porque es la llave con la que la
  -- página pública se autentica, igual que `orders.pay_token`.
  pay_token   text unique,

  sent_at     timestamptz,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- El detalle del pedido pide siempre "los cobros de este pedido, en orden".
create index if not exists charges_order_idx on public.charges (order_id, seq);
-- Para "qué está por cobrar / vencido" en reportes y avisos.
create index if not exists charges_biz_status_idx on public.charges (business_id, status);

alter table public.charges enable row level security;
drop policy if exists "members charges" on public.charges;
create policy "members charges" on public.charges
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));
-- La página pública (/pay) NO pasa por aquí: usa la llave de servicio y se autentica con pay_token.

-- Qué cobro pagó cada abono. NULL = abono suelto, sin cobro detrás.
-- on delete set null: anular un cobro nunca puede borrar dinero que sí entró.
alter table public.payments add column if not exists charge_id uuid references public.charges (id) on delete set null;
create index if not exists payments_charge_idx on public.payments (charge_id);

-- El comprobante también tiene que recordar CONTRA QUÉ COBRO lo subió el cliente. Sin esto, al
-- aprobarlo no habría forma de saberlo: la página pública se autentica con un token y ese token
-- es justo el dato que se perdería. NULL = subido desde el link del pedido, sin cobro concreto.
alter table public.payment_proofs add column if not exists charge_id uuid references public.charges (id) on delete set null;
create index if not exists payment_proofs_charge_idx on public.payment_proofs (charge_id);
