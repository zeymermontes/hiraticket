import { cache } from "react";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Business, OrderRow } from "@/lib/types";

/** The caller's business (tenant), or null if they genuinely don't belong to one yet.
 *
 *  Returning null makes the app layout offer first-run onboarding, which CREATES a business — so
 *  null must mean "no membership", never "the read failed". A swallowed error here shows an
 *  existing user the "create your workspace" screen and they end up with a duplicate tenant.
 *  Every failure below therefore throws instead of degrading to null. */
async function _getMyBusiness(): Promise<Business | null> {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return null;
  // Scope to the business the user is a MEMBER of. A platform admin can read every business via RLS,
  // so "the first readable business" would return someone else's tenant — we must filter by membership.
  // Ordered by created_at: with more than one membership the pick has to be STABLE, otherwise the
  // app hops between workspaces from one request to the next.
  const { data: mem, error: memErr } = await supabase
    .from("business_members").select("business_id")
    .eq("user_id", user.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (memErr) throw new Error(`No se pudo leer tu membresía: ${memErr.message}`);
  if (!mem?.business_id) return null;
  const bizId = mem.business_id as string;

  const BASE = "id, name, vertical, object_singular, onboarded, custom_fields";
  // Try with the optional columns (migrations 0019/0027/0028). Fall back gracefully if not there yet.
  let { data, error } = await supabase
    .from("businesses").select(`${BASE}, product_stages, show_typing, mode, allow_groups, timezone, branches, bank_accounts, pay_branch_enabled, pay_transfer_enabled, invoice_add_tax, invoice_tax_rate, manual_margin_pct, done_from_stage_id, confirm_payment_stage_id, confirm_payment_enabled`)
    .eq("id", bizId).maybeSingle();
  if (error) {
    // confirm_payment_enabled (0076) puede no existir aún — el resto de la cascada sigue sin él.
    let rA = await supabase.from("businesses").select(`${BASE}, product_stages, show_typing, mode, allow_groups, timezone, branches, bank_accounts, pay_branch_enabled, pay_transfer_enabled, invoice_add_tax, invoice_tax_rate, manual_margin_pct, done_from_stage_id, confirm_payment_stage_id`).eq("id", bizId).maybeSingle();
    if (!rA.error) { data = rA.data as typeof data; error = null; }
  }
  if (error) {
    // confirm_payment_stage_id (0075) puede no existir aún tampoco.
    let r0 = await supabase.from("businesses").select(`${BASE}, product_stages, show_typing, mode, allow_groups, timezone, branches, bank_accounts, pay_branch_enabled, pay_transfer_enabled, invoice_add_tax, invoice_tax_rate, manual_margin_pct, done_from_stage_id`).eq("id", bizId).maybeSingle();
    if (!r0.error) { data = r0.data as typeof data; error = null; }
  }
  if (error) {
    // manual_margin_pct (0057) / invoice (0050) / payment columns (0048) / timezone (0043) / allow_groups (0032) may not be applied yet — cascade the fallbacks.
    let r = await supabase.from("businesses").select(`${BASE}, product_stages, show_typing, mode, allow_groups, timezone, branches, bank_accounts, pay_branch_enabled, pay_transfer_enabled, invoice_add_tax, invoice_tax_rate`).eq("id", bizId).maybeSingle();
    if (r.error) r = await supabase.from("businesses").select(`${BASE}, product_stages, show_typing, mode, allow_groups, timezone, branches, bank_accounts, pay_branch_enabled, pay_transfer_enabled`).eq("id", bizId).maybeSingle();
    if (r.error) r = await supabase.from("businesses").select(`${BASE}, product_stages, show_typing, mode, allow_groups, timezone`).eq("id", bizId).maybeSingle();
    if (r.error) r = await supabase.from("businesses").select(`${BASE}, product_stages, show_typing, mode, allow_groups`).eq("id", bizId).maybeSingle();
    if (r.error) r = await supabase.from("businesses").select(`${BASE}, product_stages, show_typing, mode`).eq("id", bizId).maybeSingle();
    if (r.error) r = await supabase.from("businesses").select(BASE).eq("id", bizId).maybeSingle();
    // Even the minimal column set failed: that's a broken read (permissions, network), not a
    // missing workspace — the membership above proves one exists.
    if (r.error) throw new Error(`No se pudo leer tu negocio: ${r.error.message}`);
    data = r.data as typeof data;
  }
  // Membership points at a business that isn't readable/doesn't exist — a broken tenant, not a
  // new user. Onboarding here would create a second one on top of the orphaned membership.
  if (!data) throw new Error(`Tu membresía apunta al negocio ${bizId}, que no se pudo leer.`);
  const d = data as Record<string, unknown>;
  return {
    ...d,
    product_stages: (d.product_stages as boolean) ?? false,
    show_typing: (d.show_typing as boolean) ?? true,
    mode: ((d.mode as string) === "personal" ? "personal" : "business"),
    allow_groups: (d.allow_groups as boolean) ?? false,
    timezone: (d.timezone as string) || "America/Mexico_City",
    branches: (d.branches as Business["branches"]) ?? [],
    bank_accounts: (d.bank_accounts as Business["bank_accounts"]) ?? [],
    pay_branch_enabled: (d.pay_branch_enabled as boolean) ?? false,
    pay_transfer_enabled: (d.pay_transfer_enabled as boolean) ?? false,
    invoice_add_tax: (d.invoice_add_tax as boolean) ?? true,
    invoice_tax_rate: Number(d.invoice_tax_rate ?? 16),
    manual_margin_pct: Number(d.manual_margin_pct ?? 50),
    confirm_payment_enabled: (d.confirm_payment_enabled as boolean) ?? true,
  } as Business;
}

/** Envuelto en React cache(): dentro de UNA petición, varias llamadas con los mismos argumentos
 *  se resuelven con un solo viaje a Supabase. Importa porque el layout y la página se renderizan en
 *  la misma petición y ambos piden esto — antes eran dos viajes idénticos, y a ~68 ms cada uno
 *  (Render en Oregon, Supabase en us-east-1) eso se nota en cada clic.
 *  NO es caché entre peticiones: cada request vuelve a leer datos frescos. */
export const getMyBusiness = cache(_getMyBusiness);

export type OrderSortKey = "code" | "total" | "updated_at" | "created_at" | "due_at";

/** Search / filter / sort / page for the orders table — all of it resolved in SQL. */
export interface OrderQuery {
  q?: string;
  stageId?: string;
  areaId?: string;
  assigneeId?: string;
  priority?: string;
  sort?: OrderSortKey;
  dir?: "asc" | "desc";
  page?: number;
  per?: number;
  trash?: boolean; // soft-deleted orders instead of live ones
}

export interface OrdersPage {
  rows: OrderRow[];
  total: number;     // matching rows across every page (drives the count pill + pager)
  capped: boolean;   // the name search hit CONTACT_MATCH_CAP, so `total` may undercount
}

/** A typed search matching more contacts than this can't widen the order filter any further.
 *  Surfaced as `capped` rather than silently truncating the result. */
const CONTACT_MATCH_CAP = 500;

const ORDER_COLS = (opt: string) =>
  `id, code, priority, pay_status, total, updated_at, created_at, stage_id, area_id, ${opt}assignee_id, ` +
  `stage:stages!stage_id(name,color), area:areas(name,color), contact:contacts(name), items:order_items(name)`;

const SORT_COL: Record<OrderSortKey, string> = {
  code: "code_num",       // 0061 — numeric part, so HIR-999 sorts before HIR-1144
  total: "total",
  updated_at: "updated_at",
  created_at: "created_at",
  due_at: "due_at",
};

/** Search matches the order code OR the customer's name. The name lives on another table and
 *  PostgREST can't OR across an embed, so the contacts are resolved first (same shape as
 *  globalSearch). Stripping brackets keeps a typed "(" from breaking the .or() grammar. */
function searchNeedle(q?: string): string {
  return (q ?? "").trim().replace(/[(),]/g, " ").trim();
}

/** Every filter in an OrderQuery, applied to a PostgREST builder. `withDeleted` is false on the
 *  fallback paths that run before 0039 added the soft-delete column. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyOrderFilters<T extends Record<string, any>>(
  b: T, f: OrderQuery, needle: string, contactIds: string[], withDeleted = true,
): T {
  let x = b;
  if (withDeleted) x = f.trash ? x.not("deleted_at", "is", null) : x.is("deleted_at", null);
  if (f.stageId) x = x.eq("stage_id", f.stageId);
  if (f.areaId) x = x.eq("area_id", f.areaId);
  if (f.assigneeId) x = x.eq("assignee_id", f.assigneeId);
  if (f.priority) x = x.eq("priority", f.priority);
  if (needle) {
    const ors = [`code.ilike.%${needle}%`];
    if (contactIds.length) ors.push(`contact_id.in.(${contactIds.join(",")})`);
    x = x.or(ors.join(","));
  }
  return x;
}

/** One page of orders for the table. Filtering, search, ordering and the total count all run in
 *  Postgres — the table used to receive every order the business had ever created and do this in
 *  the browser, which got slower with every order. */
export async function getOrdersPage(businessId: string, f: OrderQuery = {}): Promise<OrdersPage> {
  const supabase = await createClient();
  // The table pages 25 at a time; the ceiling is generous because the CSV export reuses this
  // with a big `per` to pull the whole filtered set in one go.
  const per = Math.min(Math.max(f.per ?? 25, 1), 5000);
  const page = Math.max(f.page ?? 0, 0);
  const sortKey = f.sort ?? "updated_at";
  const ascending = f.dir === "asc";

  const needle = searchNeedle(f.q);
  let contactIds: string[] = [];
  let capped = false;
  if (needle) {
    const { data } = await supabase
      .from("contacts").select("id").eq("business_id", businessId)
      .ilike("name", `%${needle}%`).limit(CONTACT_MATCH_CAP);
    contactIds = (data ?? []).map((c) => c.id as string);
    capped = contactIds.length === CONTACT_MATCH_CAP;
  }

  const build = (cols: string, withDeleted: boolean) =>
    applyOrderFilters(
      supabase.from("orders").select(cols, { count: "exact" }).eq("business_id", businessId),
      f, needle, contactIds, withDeleted,
    );
  // nullsFirst:false keeps "no deadline" at the bottom in both directions, matching the old
  // client-side sort (which forced nulls to "9999").
  const ordered = (b: ReturnType<typeof build>, col: string) =>
    b.order(col, { ascending, nullsFirst: false }).range(page * per, page * per + per - 1);

  // code_num (0061) / due_at (0029) / deleted_at (0039) may not be applied yet — cascade.
  let { data, error, count } = await ordered(build(ORDER_COLS("due_at, deleted_at, cancelled_at, "), true), SORT_COL[sortKey]);
  // Without 0061 there's no code_num: fall back to the lexical code (HIR-999 lands after HIR-1144,
  // the one ordering difference; every other sort key is unaffected).
  if (error && sortKey === "code") ({ data, error, count } = await ordered(build(ORDER_COLS("due_at, deleted_at, cancelled_at, "), true), "code"));
  if (error) ({ data, error, count } = await ordered(build(ORDER_COLS("due_at, "), false), sortKey === "code" ? "code" : SORT_COL[sortKey]));
  if (error) ({ data, error, count } = await ordered(build(ORDER_COLS(""), false), sortKey === "due_at" ? "updated_at" : sortKey === "code" ? "code" : SORT_COL[sortKey]));
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  // Transfer receipts awaiting review (0048) — only for the page's rows, not the whole business.
  let pendingSet = new Set<string>();
  if (rows.length) {
    const pr = await supabase.from("payment_proofs").select("order_id")
      .eq("business_id", businessId).eq("status", "pending")
      .in("order_id", rows.map((o) => o.id as string));
    if (!pr.error) pendingSet = new Set((pr.data ?? []).map((r) => r.order_id as string));
  }

  return {
    rows: rows.map((o) => ({ ...o, due_at: (o.due_at as string | null) ?? null, pending_proof: pendingSet.has(o.id as string) })) as unknown as OrderRow[],
    total: count ?? rows.length,
    capped,
  };
}

/** Every order id matching the filters, ignoring the page window — backs "select all filtered"
 *  and the CSV export, which both act on the whole result set, not just the visible page. */
export async function getOrderIds(businessId: string, f: OrderQuery = {}, cap = 5000): Promise<string[]> {
  const supabase = await createClient();
  const needle = searchNeedle(f.q);
  let contactIds: string[] = [];
  if (needle) {
    const { data } = await supabase.from("contacts").select("id").eq("business_id", businessId).ilike("name", `%${needle}%`).limit(CONTACT_MATCH_CAP);
    contactIds = (data ?? []).map((c) => c.id as string);
  }
  const q = (withDeleted: boolean) =>
    applyOrderFilters(supabase.from("orders").select("id").eq("business_id", businessId).limit(cap), f, needle, contactIds, withDeleted);
  let { data, error } = await q(true);
  if (error) ({ data, error } = await q(false)); // deleted_at (0039) not applied
  if (error) return [];
  return ((data ?? []) as { id: string }[]).map((o) => o.id);
}

export interface ContactRow {
  id: string;
  name: string;
  phone: string | null;
  tags: string[];
  avatar_url: string | null;
  created_at: string;
  conv_id: string | null;      // latest conversation, to open the chat
  last_active: string | null;  // its last_message_at
  muted: boolean;              // latest conversation muted ("stop listening")
  orders_count: number;        // pedidos/tareas linked to this contact
}

/** All contacts for a business + their latest conversation and order/task count (for the Contacts page). */
/**
 * Una VENTANA de contactos, con la búsqueda en el servidor.
 *
 * `getContacts` traía el directorio completo con conversaciones y conteo de pedidos embebidos por
 * contacto —- sin límite. Con cientos de clientes eso era gran parte del "Clientes tarda en abrir".
 * La página siembra la primera ventana y el resto llega con scroll infinito.
 *
 * La búsqueda: nombre y teléfono por subcadena; etiquetas por coincidencia exacta (los arrays de
 * Postgres no tienen ilike razonable vía PostgREST). Es el mismo alcance práctico que tenía la
 * búsqueda local, ahora sobre TODOS los contactos y no solo los cargados.
 */
export async function getContactsPage(
  businessId: string,
  opts?: { q?: string; limit?: number; offset?: number },
): Promise<{ rows: ContactRow[]; total: number }> {
  const supabase = await createClient();
  const limit = opts?.limit ?? 60;
  const offset = opts?.offset ?? 0;
  const full = "id, name, phone, tags, avatar_url, created_at, conversations(id, last_message_at, muted), orders(count)";
  const build = (cols: string) => {
    let q = supabase.from("contacts").select(cols, { count: "exact" }).eq("business_id", businessId);
    const s0 = opts?.q?.trim();
    if (s0) {
      const term = s0.replace(/[%,()]/g, " ").trim();
      if (term) q = q.or(`name.ilike.%${term}%,phone.ilike.%${term}%,tags.cs.{${term}}`);
    }
    return q.order("name").range(offset, offset + limit - 1);
  };
  let { data, count, error } = await build(full);
  if (error) ({ data, count } = await build("id, name, phone, tags, avatar_url, created_at"));
  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map(mapContactRow);
  return { rows, total: count ?? rows.length };
}

function mapContactRow(c: Record<string, unknown>): ContactRow {
  const convs = (c.conversations as { id: string; last_message_at: string | null; muted?: boolean }[] | undefined) ?? [];
  const latest = convs.reduce<{ id: string; last_message_at: string | null; muted?: boolean } | null>((a, x) => (!a || (x.last_message_at ?? "") > (a.last_message_at ?? "") ? x : a), null);
  const oc = c.orders as { count?: number }[] | undefined;
  return {
    id: c.id as string,
    name: c.name as string,
    phone: (c.phone as string | null) ?? null,
    tags: (c.tags as string[]) ?? [],
    avatar_url: (c.avatar_url as string | null) ?? null,
    created_at: c.created_at as string,
    conv_id: latest?.id ?? null,
    last_active: latest?.last_message_at ?? null,
    muted: latest?.muted ?? false,
    orders_count: Array.isArray(oc) ? (oc[0]?.count ?? 0) : 0,
  };
}

export async function getContacts(businessId: string): Promise<ContactRow[]> {
  const supabase = await createClient();
  const full = "id, name, phone, tags, avatar_url, created_at, conversations(id, last_message_at, muted), orders(count)";
  const { data: full0, error } = await supabase.from("contacts").select(full).eq("business_id", businessId).order("name");
  let data = full0 as unknown as Record<string, unknown>[] | null;
  if (error) {
    const r = await supabase.from("contacts").select("id, name, phone, tags, avatar_url, created_at").eq("business_id", businessId).order("name");
    data = r.data as unknown as Record<string, unknown>[] | null;
  }
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((c) => {
    const convs = (c.conversations as { id: string; last_message_at: string | null; muted?: boolean }[] | undefined) ?? [];
    const latest = convs.reduce<{ id: string; last_message_at: string | null; muted?: boolean } | null>((a, x) => (!a || (x.last_message_at ?? "") > (a.last_message_at ?? "") ? x : a), null);
    const oc = c.orders as { count?: number }[] | undefined;
    return {
      id: c.id as string,
      name: c.name as string,
      phone: (c.phone as string | null) ?? null,
      tags: (c.tags as string[]) ?? [],
      avatar_url: (c.avatar_url as string | null) ?? null,
      created_at: c.created_at as string,
      conv_id: latest?.id ?? null,
      last_active: latest?.last_message_at ?? null,
      muted: latest?.muted ?? false,
      orders_count: Array.isArray(oc) ? (oc[0]?.count ?? 0) : 0,
    };
  });
}
