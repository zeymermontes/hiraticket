// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

/**
 * Núcleo de "marcar pagado": registra el saldo restante como un pago y pone pay_status='paid'.
 *
 * Vive aparte de orders/actions.ts (donde está el server action `markPaid` que el cliente llama)
 * porque también lo necesita app/(app)/actions.ts al resolver la etapa de confirmar pago (0075)
 * — y actions.ts ya es importado POR orders/actions.ts, así que importar en la otra dirección
 * crearía un ciclo. Este archivo no importa de ninguno de los dos.
 */
export async function markOrderPaid(supabase: AnySupabase, orderId: string, userId: string | null): Promise<void> {
  const { data: order } = await supabase.from("orders").select("business_id, total").eq("id", orderId).maybeSingle();
  if (!order) return;
  const { data: pays } = await supabase.from("payments").select("amount").eq("order_id", orderId);
  const paid = (pays ?? []).reduce((s: number, p: { amount: number }) => s + (Number(p.amount) || 0), 0);
  const remaining = (Number(order.total) || 0) - paid;
  if (remaining > 0) {
    await supabase.from("payments").insert({ business_id: order.business_id, order_id: orderId, amount: remaining, method: "manual", note: "Pago completo", created_by: userId });
  }
  await supabase.from("orders").update({ pay_status: "paid" }).eq("id", orderId);
  // Los cobros pendientes se cierran con el pedido (0089). Si no, quedarían "por cobrar" sobre un
  // pedido saldado: el cajón diría pagado y la lista de cobros diría que falta dinero, y sus links
  // seguirían pidiéndole al cliente algo que ya no debe. Se ignora `void`: anulado es anulado.
  await supabase.from("charges").update({ status: "paid" }).eq("order_id", orderId).in("status", ["draft", "sent"]);
}

/**
 * El estado de UN cobro, recalculado desde los pagos que lo señalan.
 *
 * Mismo criterio que `pay_status` del pedido y por la misma razón: el estado se DERIVA del dinero,
 * nunca se escribe a mano. Así borrar un pago devuelve el cobro a pendiente solo, sin que nadie
 * tenga que acordarse.
 *
 * Un cobro anulado no se toca: `void` es una decisión de una persona, no un cálculo.
 */
export async function recomputeChargeStatus(supabase: AnySupabase, chargeId: string): Promise<void> {
  if (!chargeId) return;
  const { data: charge } = await supabase.from("charges").select("amount, status, sent_at").eq("id", chargeId).maybeSingle();
  if (!charge || charge.status === "void") return;
  const { data: pays } = await supabase.from("payments").select("amount").eq("charge_id", chargeId);
  const paid = (pays ?? []).reduce((s: number, p: { amount: number }) => s + (Number(p.amount) || 0), 0);
  // Un centavo de tolerancia: repartir un total en tercios deja colas de redondeo, y dejar un cobro
  // "pendiente" por tres centavos obligaría a cerrarlo a mano cada vez.
  const covered = paid >= (Number(charge.amount) || 0) - 0.01;
  if (covered) {
    if (charge.status !== "paid") await supabase.from("charges").update({ status: "paid" }).eq("id", chargeId);
  } else if (charge.status === "paid") {
    // Se borró o se corrigió un pago: vuelve a donde estaba, no a "sent" siempre —- un cobro que
    // nunca se envió no puede acabar marcado como enviado por haber devuelto un abono.
    await supabase.from("charges").update({ status: charge.sent_at ? "sent" : "draft" }).eq("id", chargeId);
  }
}

/**
 * A qué apunta un token de /pay/<token>.
 *
 * Hay dos clases de token y la página pública tiene que servir las dos:
 *   · el del PEDIDO (`orders.pay_token`, 0048) — "cobra lo que falte". Es el de siempre y los links
 *     que ya andan por ahí siguen siendo de este tipo.
 *   · el de un COBRO (`charges.pay_token`, 0089) — "cobra este monto".
 *
 * Se busca primero el cobro porque es el caso nuevo y el más específico; si no, el pedido. No se
 * decide por el prefijo del token aunque se generen distintos ("c…" / "p…"): un prefijo es una
 * pista para leer registros, no algo de lo que dependa la corrección.
 *
 * Devuelve el cobro entero para que quien llame no tenga que volver a pedirlo.
 */
export async function resolvePayToken(admin: AnySupabase, token: string): Promise<{
  orderId: string; businessId: string; charge: Record<string, unknown> | null;
} | null> {
  if (!token) return null;
  // La tabla puede no existir todavía (0089 sin aplicar): entonces solo hay tokens de pedido.
  const { data: charge, error } = await admin
    .from("charges").select("id, order_id, business_id, seq, kind, label, amount, due_at, status")
    .eq("pay_token", token).maybeSingle();
  if (!error && charge) {
    return { orderId: charge.order_id as string, businessId: charge.business_id as string, charge };
  }
  const { data: order } = await admin.from("orders").select("id, business_id").eq("pay_token", token).maybeSingle();
  if (!order) return null;
  return { orderId: order.id as string, businessId: order.business_id as string, charge: null };
}
