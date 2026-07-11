import { redirect } from "next/navigation";
import { getMyBusiness } from "@/lib/queries";
import { getReports } from "@/lib/extras";
import { createClient } from "@/lib/supabase/server";
import { ReportsScreen } from "@/components/ReportsScreen";

export const dynamic = "force-dynamic";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const business = await getMyBusiness();
  if (!business) return null;

  // Reports are admin-only — role straight from the membership row (same check as plugins).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: mem } = user
    ? await supabase.from("business_members").select("role").eq("business_id", business.id).eq("user_id", user.id).maybeSingle()
    : { data: null };
  if (mem?.role !== "admin") redirect("/chat");

  // Default range: last 7 days (today inclusive).
  const sp = await searchParams;
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 6 * 86400000);
  let from = sp.from && YMD.test(sp.from) ? sp.from : ymd(weekAgo);
  let to = sp.to && YMD.test(sp.to) ? sp.to : ymd(today);
  if (from > to) [from, to] = [to, from];

  const data = await getReports(business.id, { from, to }, business.manual_margin_pct ?? 50);
  return <ReportsScreen data={data} from={from} to={to} />;
}
