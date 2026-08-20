import { createAdminClient } from "@/lib/supabase/admin";
import { getPluginRuntimeConfig } from "@/lib/plugins";
import { PayCheckout, type PayItem } from "@/components/PayCheckout";
import type { Branch, BankAccount, PayPromo, PayPromoPlacement } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PayPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ mp?: string }> }) {
  const { token } = await params;
  const { mp } = await searchParams;
  const admin = createAdminClient();

  const ORDER_BASE = "id, code, total, pay_status, business_id, contact:contacts(name)";
  // discount (0058) / requires_invoice + tax_rate (0050) alimentan el desglose. Pueden no existir
  // todavía en una instancia sin migrar, así que se piden aparte y se cae al set mínimo.
  let { data: order } = await admin
    .from("orders")
    .select(`${ORDER_BASE}, discount, discount_pct, discount_note, requires_invoice, tax_rate`)
    .eq("pay_token", token)
    .maybeSingle();
  if (!order) ({ data: order } = await admin.from("orders").select(ORDER_BASE).eq("pay_token", token).maybeSingle());

  if (!order) return <NotValid />;

  const BIZ_BASE = "name, branches, bank_accounts, pay_branch_enabled, pay_transfer_enabled";
  const [bizRes, { data: pays }, { data: proofs }, { data: items }, mpCfg] = await Promise.all([
    admin.from("businesses").select(`${BIZ_BASE}, pay_promo_images, pay_promo_placement`).eq("id", order.business_id).maybeSingle(),
    admin.from("payments").select("amount").eq("order_id", order.id),
    admin.from("payment_proofs").select("id, status, created_at").eq("order_id", order.id).eq("status", "pending"),
    // Solo lo que el cliente puede ver: nombre, cantidad y precio. Las mermas (0074) viven en
    // `order_waste`, otra tabla —- ni se rozan aquí; la nota interna del renglón tampoco sale.
    admin.from("order_items").select("id, name, qty, unit_price, subtotal").eq("order_id", order.id),
    getPluginRuntimeConfig(order.business_id as string, "mercadopago"),
  ]);
  // pay_promo_* (0080/0081) puede no estar aplicada — sin ellas, simplemente no hay anuncios.
  const biz = (bizRes.data ?? (await admin.from("businesses").select(BIZ_BASE).eq("id", order.business_id).maybeSingle()).data) as Record<string, unknown> | null;

  const paid = (pays ?? []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const total = Number(order.total) || 0;
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
      balance={Math.max(0, total - paid)}
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
