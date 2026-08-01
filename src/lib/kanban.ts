import { createClient } from "@/lib/supabase/server";

export interface KanbanOrder {
  id: string;
  code: string;
  total: number;
  pay_status: string;
  priority: string;
  due_at: string | null;
  stage_id: string | null;
  area_id: string | null;
  assignee_id: string | null;
  contact: { name: string } | null;
  stage: { name: string; color: string } | null;
  area: { name: string; color: string } | null;
  items: { name: string }[];
  pending_proof?: boolean; // a customer transfer receipt is awaiting review
  cancelled_at?: string | null; // 0065
}

export interface KanbanItem {
  id: string;        // order_items.id
  name: string;
  qty: number;
  stage_id: string | null;
  order_id: string;
  order_code: string;
  priority: string;
  assignee_id: string | null;
  contact: { name: string } | null;
  stage: { name: string; color: string } | null;
}

/** What the board's toolbar filters by. A board can't be windowed as a whole — its contract is
 *  "this column holds N" — so every column is paged on its own and the totals come from
 *  kanban_counts (0063). */
export interface KanbanFilters {
  q?: string;
  areaId?: string;
  assigneeId?: string;
  group?: "status" | "area";      // group orders by stage or by area
  products?: boolean;             // "Productos" view: one card per line item
  sortCode?: "" | "asc" | "desc"; // orders view only (the sort chip is hidden for products)
}

/** Cards fetched per column, per page. */
export const KANBAN_PAGE = 25;

const CONTACT_MATCH_CAP = 500;

/** Column id → total cards matching the filters, ignoring the page window. */
export async function getKanbanCounts(businessId: string, f: KanbanFilters = {}): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kanban_counts", {
    p_business: businessId,
    p_group: f.group === "area" ? "area" : "status",
    p_products: !!f.products,
    p_q: f.q?.trim() || null,
    p_area: f.areaId || null,
    p_assignee: f.assigneeId || null,
  });
  if (error || !data) return {}; // 0063 sin aplicar → los badges muestran lo cargado, no rompen el tablero
  return data as Record<string, number>;
}

/** Contacts whose name matches the typed search — the orders search ORs code + customer name and
 *  PostgREST can't OR across an embed. */
async function matchingContactIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, businessId: string, needle: string,
): Promise<string[]> {
  const { data } = await supabase.from("contacts").select("id").eq("business_id", businessId)
    .ilike("name", `%${needle}%`).limit(CONTACT_MATCH_CAP);
  return ((data ?? []) as { id: string }[]).map((c) => c.id);
}

/** One page of order cards for a single column. */
export async function getKanbanOrderColumn(
  businessId: string, colId: string, f: KanbanFilters = {},
  opts: { offset?: number; limit?: number } = {},
): Promise<KanbanOrder[]> {
  const supabase = await createClient();
  const offset = Math.max(opts.offset ?? 0, 0);
  const limit = Math.min(Math.max(opts.limit ?? KANBAN_PAGE, 1), 200);
  const needle = (f.q ?? "").trim().replace(/[(),]/g, " ").trim();
  const contactIds = needle ? await matchingContactIds(supabase, businessId, needle) : [];

  const COLS = (cancel: string) => `id, code, total, pay_status, priority, due_at, stage_id, area_id, assignee_id, ${cancel}` +
    "contact:contacts(name), stage:stages!stage_id(name,color), area:areas(name,color), items:order_items(name)";

  const build = (cancel: string) => {
    let b = supabase.from("orders").select(COLS(cancel))
      .eq("business_id", businessId).is("deleted_at", null)
      .eq(f.group === "area" ? "area_id" : "stage_id", colId);
    if (f.areaId) b = b.eq("area_id", f.areaId);
    if (f.assigneeId) b = b.eq("assignee_id", f.assigneeId);
    if (needle) {
      const ors = [`code.ilike.%${needle}%`];
      if (contactIds.length) ors.push(`contact_id.in.(${contactIds.join(",")})`);
      b = b.or(ors.join(","));
    }
    // The "By ID" chip sorts on code_num (0061) so HIR-999 lands before HIR-1144; otherwise the
    // board keeps its most-recently-touched-first order.
    return f.sortCode
      ? b.order("code_num", { ascending: f.sortCode === "asc" })
      : b.order("updated_at", { ascending: false });
  };

  // cancelled_at (0065) puede no estar aplicada: sin este fallback la columna entera se vaciaría,
  // así que el orden de despliegue (migración antes o después del código) dejaría de importar.
  let { data, error } = await build("cancelled_at, ").range(offset, offset + limit - 1);
  if (error) ({ data, error } = await build("").range(offset, offset + limit - 1));
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];

  // Pending transfer receipts, only for this page's rows.
  let pendingSet = new Set<string>();
  if (rows.length) {
    const pr = await supabase.from("payment_proofs").select("order_id")
      .eq("business_id", businessId).eq("status", "pending")
      .in("order_id", rows.map((o) => o.id as string));
    if (!pr.error) pendingSet = new Set((pr.data ?? []).map((r: { order_id: string }) => r.order_id));
  }
  return rows.map((o) => ({
    ...o,
    due_at: (o.due_at as string | null) ?? null,
    pending_proof: pendingSet.has(o.id as string),
  })) as unknown as KanbanOrder[];
}

/** One page of line-item cards for a single column ("Productos" view).
 *  Goes through the kanban_items_page RPC (0063) — see the migration for why. */
export async function getKanbanItemColumn(
  businessId: string, colId: string, f: KanbanFilters = {},
  opts: { offset?: number; limit?: number } = {},
): Promise<KanbanItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kanban_items_page", {
    p_business: businessId,
    p_stage: colId,
    p_q: f.q?.trim() || null,
    p_assignee: f.assigneeId || null,
    p_limit: Math.min(Math.max(opts.limit ?? KANBAN_PAGE, 1), 200),
    p_offset: Math.max(opts.offset ?? 0, 0),
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as KanbanItem[]);
}

/** A board holds orders OR line items, never both at once — but the container is typed on the
 *  union so the client can move/append cards without narrowing on every write. */
export type KanbanCard = KanbanOrder | KanbanItem;

export interface KanbanBoardData {
  counts: Record<string, number>;
  /** column id → its first page of cards */
  columns: Record<string, KanbanCard[]>;
}

/** Counts + the first page of every column, in a single call from the browser.
 *  Server-side it's one RPC plus one query per column, all in parallel. */
export async function getKanbanBoard(
  businessId: string, colIds: string[], f: KanbanFilters = {}, per = KANBAN_PAGE,
): Promise<KanbanBoardData> {
  const [counts, pages] = await Promise.all([
    getKanbanCounts(businessId, f),
    Promise.all(colIds.map((id) =>
      (f.products
        ? getKanbanItemColumn(businessId, id, f, { limit: per })
        : getKanbanOrderColumn(businessId, id, f, { limit: per })
      ).catch(() => [] as KanbanCard[])),
    ),
  ]);
  const columns: KanbanBoardData["columns"] = {};
  colIds.forEach((id, i) => { columns[id] = pages[i]; });
  return { counts, columns };
}
