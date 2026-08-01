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
}
