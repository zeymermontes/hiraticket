import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getMyBusiness } from "@/lib/queries";
import { getReports } from "@/lib/extras";
import { createClient } from "@/lib/supabase/server";
import { ReportsScreen } from "@/components/ReportsScreen";
import { DEFAULT_TZ } from "@/lib/timezones";
import { ymdInTz } from "@/lib/dayInTz";

export const dynamic = "force-dynamic";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const business = await getMyBusiness();
  if (!business) return null;

  // Reports are admin-only — role straight from the membership row (same check as plugins).
  const supabase = await createClient();
  const user = await getSessionUser();
  const { data: mem } = user
    ? await supabase.from("business_members").select("role").eq("business_id", business.id).eq("user_id", user.id).maybeSingle()
    : { data: null };
  if (mem?.role !== "admin") redirect("/chat");

  // Sin fechas en la URL se abre con hoy: lo primero que se quiere ver es cómo va el día. "Hoy"
  // es el del negocio (su zona horaria), no el del servidor, que corre en UTC.
  const sp = await searchParams;
  const tz = business.timezone || DEFAULT_TZ;
  const today = ymdInTz(new Date(), tz);
  let from = sp.from && YMD.test(sp.from) ? sp.from : today;
  let to = sp.to && YMD.test(sp.to) ? sp.to : today;
  if (from > to) [from, to] = [to, from];

  const data = await getReports(business.id, { from, to, tz }, business.manual_margin_pct ?? 50, business.done_from_stage_id ?? null);
  return <ReportsScreen data={data} from={from} to={to} />;
}
