import { createAdminClient } from "@/lib/supabase/admin";
import { getPluginRuntimeConfig } from "@/lib/plugins";
import { PayCheckout, type PayItem } from "@/components/PayCheckout";
import type { Branch, BankAccount, PayPromo, PayPromoPlacement } from "@/lib/types";
import { resolvePayToken } from "@/lib/payments";
import { chargeTitle, isLive } from "@/lib/charges";
import type { PayCharge } from "@/components/PayCheckout";

export const dynamic = "force-dynamic";

export default async function PayPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ mp?: string }> }) {
  const { token } = await params;
  const { mp } = await searchParams;
  const admin = createAdminClient();

  // El token puede ser el del PEDIDO (cobra lo que falte, 0048) o el de una ORDEN DE COBRO (cobra
  // este monto, 0089). La página sirve los dos y solo cambia qué pide y cómo lo encabeza.
  const ref = await resolvePayToken(admin, token);
  if (!ref) return <NotValid />;

  const ORDER_BASE = "id, code, total, pay_status, business_id, contact:contacts(name)";
  // discount (0058) / requires_invoice + tax_rate (0050) alimentan el desglose. Pueden no existir
  // todavía en una instancia sin migrar, así que se piden aparte y se cae al set mínimo.
  let { data: order } = await admin
    .from("orders")
    .select(`${ORDER_BASE}, discount, discount_pct, discount_note, requires_invoice, tax_rate`)
    .eq("id", ref.orderId)
    .maybeSingle();
  if (!order) ({ data: order } = await admin.from("orders").select(ORDER_BASE).eq("id", ref.orderId).maybeSingle());

  if (!order) return <NotValid />;
  // Un cobro anulado deja de pedir dinero: su link no puede seguir cobrando algo que el negocio
  // ya retiró. Se trata como link inválido, que es lo que es.
  if (ref.charge && ref.charge.status === "void") return <NotValid />;

  const BIZ_BASE = "name, branches, bank_accounts, pay_branch_enabled, pay_transfer_enabled";
  const [bizRes, { data: pays }, { data: proofs }, { data: items }, mpCfg, chargeRes] = await Promise.all([
    admin.from("businesses").select(`${BIZ_BASE}, pay_promo_images, pay_promo_placement`).eq("id", order.business_id).maybeSingle(),
    admin.from("payments").select("amount, charge_id").eq("order_id", order.id),
    admin.from("payment_proofs").select("id, status, created_at").eq("order_id", order.id).eq("status", "pending"),
    // Solo lo que el cliente puede ver: nombre, cantidad y precio. Las mermas (0074) viven en
    // `order_waste`, otra tabla —- ni se rozan aquí; la nota interna del renglón tampoco sale.
    admin.from("order_items").select("id, name, qty, unit_price, subtotal").eq("order_id", order.id),
    getPluginRuntimeConfig(order.business_id as string, "mercadopago"),
    // 0089 puede no estar aplicada: sin cobros, la página se comporta exactamente como antes.
    admin.from("charges").select("id, seq, kind, label, amount, due_at, status").eq("order_id", order.id).order("seq", { ascending: true }),
  ]);
  // pay_promo_* (0080/0081) puede no estar aplicada — sin ellas, simplemente no hay anuncios.
  const biz = (bizRes.data ?? (await admin.from("businesses").select(BIZ_BASE).eq("id", order.business_id).maybeSingle()).data) as Record<string, unknown> | null;

  const paid = (pays ?? []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const total = Number(order.total) || 0;
  const balance = Math.max(0, total - paid);

  /**
   * El estado de cuenta que ve el cliente.
   *
   * Sin esto, quien ya dio anticipo abría su link de la parcialidad y veía un número suelto: ni
   * cuánto llevaba pagado ni cuánto faltaba después. Los cobros anulados no salen —- el cliente no
   * tiene por qué enterarse de algo que el negocio retiró—, y lo pagado de cada uno se suma de los
   * abonos que lo señalan.
   */
  const paidByCharge = new Map<string, number>();
  for (const p of pays ?? []) {
    const cid = (p as { charge_id?: string | null }).charge_id;
    if (cid) paidByCharge.set(cid, (paidByCharge.get(cid) ?? 0) + (Number(p.amount) || 0));
  }
  const payCharges: PayCharge[] = (chargeRes.error ? [] : (chargeRes.data ?? []))
    .map((c) => c as Record<string, unknown>)
    .filter((c) => isLive({ status: c.status as string }))
    .map((c) => ({
      id: c.id as string,
      seq: Number(c.seq) || 1,
      title: chargeTitle({ kind: c.kind as string, label: (c.label as string | null) ?? null }),
      amount: Number(c.amount) || 0,
      paid: paidByCharge.get(c.id as string) ?? 0,
      status: (c.status as string) ?? "draft",
      dueAt: (c.due_at as string | null) ?? null,
      current: c.id === ref.charge?.id,
    }));

  // Lo que ESTA página pide. Con un cobro, su monto —- pero nunca más de lo que el pedido debe: si
  // mientras tanto abonaron por otro lado, cobrar el monto entero sería cobrar de más.
  const chargeAmount = ref.charge ? Math.max(0, Number(ref.charge.amount) || 0) : null;
  const due = chargeAmount != null ? Math.min(chargeAmount, balance) : balance;
  const contactName = ((order.contact as unknown as { name?: string } | null)?.name) ?? null;
  const o = order as Record<string, unknown>;
  const payItems: PayItem[] = (items ?? []).map((it) => ({
    id: it.id as string,
    name: (it.name as string) || "",
    qty: Number(it.qty) || 0,
    unitPrice: Number(it.unit_price) || 0,
    subtotal: Number(it.subtotal) || 0,
  }));
  // Un anuncio al azar por visita. El sorteo va aquí, en el servidor: la página es force-dynamic,
  // así que cada apertura (y cada recarga) vuelve a rendirla y toca otro. Hacerlo en el cliente
  // habría chocado con el HTML del servidor en la hidratación.
  const promoPool = (Array.isArray(biz?.pay_promo_images) ? (biz.pay_promo_images as PayPromo[]) : [])
    .filter((p) => p && typeof p.url === "string" && p.url.trim());
  const promoUrl = promoPool.length ? promoPool[Math.floor(Math.random() * promoPool.length)].url : null;
  const promoPlacementRaw = biz?.pay_promo_placement as string | undefined;

  return (
    <PayCheckout
      token={token}
      businessName={(biz?.name as string) ?? "Hiraticket"}
      contactName={contactName}
      code={order.code as string}
      total={total}
      balance={due}
      orderBalance={balance}
      paid={paid}
      charges={payCharges}
      chargeTitle={ref.charge ? chargeTitle({ kind: ref.charge.kind as string, label: (ref.charge.label as string | null) ?? null }) : null}
      chargeSeq={ref.charge ? Number(ref.charge.seq) || 1 : null}
      chargeCount={payCharges.length}
      chargeSettled={!!ref.charge && (ref.charge.status === "paid" || due <= 0)}
      payStatus={order.pay_status as string}
      branchEnabled={(biz?.pay_branch_enabled as boolean) ?? false}
      transferEnabled={(biz?.pay_transfer_enabled as boolean) ?? false}
      cardEnabled={!!mpCfg?.access_token?.trim()}
      branches={((biz?.branches as Branch[]) ?? [])}
      accounts={((biz?.bank_accounts as BankAccount[]) ?? [])}
      hasPending={(proofs ?? []).length > 0}
      mpResult={mp === "success" || mp === "pending" || mp === "failure" ? mp : null}
      items={payItems}
      discount={Number(o.discount ?? 0)}
      discountPct={o.discount_pct != null ? Number(o.discount_pct) : null}
      discountNote={(o.discount_note as string | null) ?? null}
      taxRate={o.requires_invoice ? Number(o.tax_rate ?? 0) : 0}
      promoUrl={promoUrl}
      promoPlacement={(promoPlacementRaw === "below" || promoPlacementRaw === "popup" ? promoPlacementRaw : "off") as PayPromoPlacement}
    />
  );
}

function NotValid() {
  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "var(--bg)", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 380 }}>
        <div style={{ fontSize: 40 }}>🔗</div>
        <h1 style={{ fontSize: 20, margin: "12px 0 6px" }}>Link de pago no válido</h1>
        <p className="muted">Este link expiró o no existe. Pídele a la empresa que te envíe uno nuevo.</p>
      </div>
    </div>
  );
}
