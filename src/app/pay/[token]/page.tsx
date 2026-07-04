import { createAdminClient } from "@/lib/supabase/admin";
import { PayCheckout } from "@/components/PayCheckout";
import type { Branch, BankAccount } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select("id, code, total, pay_status, business_id, contact:contacts(name)")
    .eq("pay_token", token)
    .maybeSingle();

  if (!order) return <NotValid />;

  const [{ data: biz }, { data: pays }, { data: proofs }] = await Promise.all([
    admin.from("businesses").select("name, branches, bank_accounts, pay_branch_enabled, pay_transfer_enabled").eq("id", order.business_id).maybeSingle(),
    admin.from("payments").select("amount").eq("order_id", order.id),
    admin.from("payment_proofs").select("id, status, created_at").eq("order_id", order.id).eq("status", "pending"),
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
      branches={((biz?.branches as Branch[]) ?? [])}
      accounts={((biz?.bank_accounts as BankAccount[]) ?? [])}
      hasPending={(proofs ?? []).length > 0}
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
