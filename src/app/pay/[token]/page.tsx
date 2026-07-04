import { createAdminClient } from "@/lib/supabase/admin";
import { getPluginRuntimeConfig } from "@/lib/plugins";
import { PayCheckout } from "@/components/PayCheckout";
import type { Branch, BankAccount } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PayPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ mp?: string }> }) {
  const { token } = await params;
  const { mp } = await searchParams;
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select("id, code, total, pay_status, business_id, contact:contacts(name)")
    .eq("pay_token", token)
    .maybeSingle();

  if (!order) return <NotValid />;

  const [{ data: biz }, { data: pays }, { data: proofs }, mpCfg] = await Promise.all([
    admin.from("businesses").select("name, branches, bank_accounts, pay_branch_enabled, pay_transfer_enabled").eq("id", order.business_id).maybeSingle(),
    admin.from("payments").select("amount").eq("order_id", order.id),
    admin.from("payment_proofs").select("id, status, created_at").eq("order_id", order.id).eq("status", "pending"),
    getPluginRuntimeConfig(order.business_id as string, "mercadopago"),
  ]);

  const paid = (pays ?? []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const total = Number(order.total) || 0;
  const contactName = ((order.contact as unknown as { name?: string } | null)?.name) ?? null;

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
