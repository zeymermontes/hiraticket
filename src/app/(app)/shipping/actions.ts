"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getPluginRuntimeConfig } from "@/lib/plugins";
import { skydropxQuote, skydropxCreate, type ShipAddress, type ShipParcel, type ShipRate } from "@/lib/shipping";
import { encryptBody } from "@/lib/msgcrypto";

export interface SavedAddress extends ShipAddress { id: string; is_default: boolean }

/** The business's active shipping plugin id, or null (drives ALL shipping UI visibility). */
export async function getActiveShippingProvider(businessId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("business_plugins").select("plugin_id, status")
    .eq("business_id", businessId).eq("status", "active").in("plugin_id", ["skydropx", "enviosperros"]).limit(1).maybeSingle();
  if (error || !data) return null;
  return data.plugin_id as string;
}

/** Saved addresses for a contact (recurring customers), default first. */
export async function listContactAddresses(contactId: string): Promise<SavedAddress[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contact_addresses")
    .select("id, receiver, phone, street, colonia, city, state, zip, reference, is_default")
    .eq("contact_id", contactId)
    .order("is_default", { ascending: false }).order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []).map((a) => ({
    id: a.id as string, is_default: !!a.is_default,
    receiver: (a.receiver as string) ?? "", phone: (a.phone as string) ?? "",
    street: a.street as string, colonia: (a.colonia as string) ?? "", city: a.city as string,
    state: a.state as string, zip: a.zip as string, reference: (a.reference as string) ?? "",
  }));
}

export async function deleteContactAddress(addressId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("contact_addresses").delete().eq("id", addressId);
}

async function saveAddress(businessId: string, contactId: string, addr: ShipAddress): Promise<void> {
  const supabase = await createClient();
  // Dedup: same street+zip for the contact → refresh instead of piling duplicates.
  const { data: dup } = await supabase.from("contact_addresses").select("id").eq("contact_id", contactId).eq("street", addr.street).eq("zip", addr.zip).maybeSingle();
  const row = { business_id: businessId, contact_id: contactId, receiver: addr.receiver || null, phone: addr.phone || null, street: addr.street, colonia: addr.colonia || null, city: addr.city, state: addr.state, zip: addr.zip, reference: addr.reference || null };
  if (dup) await supabase.from("contact_addresses").update(row).eq("id", dup.id);
  else await supabase.from("contact_addresses").insert(row);
}

/** Quote rates for an order's shipment. Optionally saves the destination for the contact. */
export async function quoteOrderShipment(
  orderId: string, dest: ShipAddress, parcel: ShipParcel, saveForContact: boolean,
): Promise<{ ok: boolean; rates: ShipRate[]; error?: string }> {
  const supabase = await createClient();
  const { data: order } = await supabase.from("orders").select("business_id, contact_id").eq("id", orderId).maybeSingle();
  if (!order) return { ok: false, rates: [], error: "order" };
  const provider = await getActiveShippingProvider(order.business_id as string);
  if (provider !== "skydropx") return { ok: false, rates: [], error: "no-plugin" };
  const cfg = await getPluginRuntimeConfig(order.business_id as string, "skydropx");
  if (!cfg?.client_id || !cfg?.client_secret || !cfg?.origin_zip) return { ok: false, rates: [], error: "not-configured" };

  if (saveForContact && order.contact_id) await saveAddress(order.business_id as string, order.contact_id as string, dest);
  return skydropxQuote(cfg, dest, parcel);
}

/** Create the label for the chosen rate; records the shipment + an activity event + usage. */
export async function createOrderShipment(
  orderId: string, quotationId: string, rateId: string, dest: ShipAddress, parcel: ShipParcel,
): Promise<{ ok: boolean; shipmentId?: string; tracking?: string; labelUrl?: string | null; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: order } = await supabase.from("orders").select("business_id, code").eq("id", orderId).maybeSingle();
  if (!order) return { ok: false, error: "order" };
  const businessId = order.business_id as string;
  const cfg = await getPluginRuntimeConfig(businessId, "skydropx");
  if (!cfg) return { ok: false, error: "not-configured" };

  const r = await skydropxCreate(cfg, quotationId, rateId, dest, parcel);
  if (!r.ok || !r.label) return { ok: false, error: r.error ?? "create" };

  const { data: shipRow } = await supabase.from("shipments").insert({
    business_id: businessId, order_id: orderId, provider: "skydropx",
    carrier: r.label.carrier || null, service: r.label.service || null,
    tracking_number: r.label.tracking, label_url: r.label.labelUrl, cost: r.label.cost || null,
    address: dest as unknown as Record<string, unknown>, parcel: parcel as unknown as Record<string, unknown>,
    created_by: user?.id ?? null,
  }).select("id").single();
  await supabase.from("events").insert({
    business_id: businessId, parent_type: "order", parent_id: orderId, actor_id: user?.id ?? null,
    kind: "send", text: `Guía generada${r.label.carrier ? ` (${r.label.carrier})` : ""} · ${r.label.tracking}`,
  });
  await supabase.from("plugin_usage").insert({ business_id: businessId, plugin_id: "skydropx", unit: "guía", qty: 1, meta: { tracking: r.label.tracking, cost: r.label.cost } });
  revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat");
  return { ok: true, shipmentId: (shipRow?.id as string) ?? undefined, tracking: r.label.tracking, labelUrl: r.label.labelUrl };
}

/** WhatsApp the tracking number to the order's conversation (queued; worker sends). */
export async function notifyTracking(orderId: string, shipmentId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [{ data: order }, { data: ship }] = await Promise.all([
    supabase.from("orders").select("business_id, code, conversation_id, contact_id").eq("id", orderId).maybeSingle(),
    supabase.from("shipments").select("carrier, tracking_number").eq("id", shipmentId).maybeSingle(),
  ]);
  if (!order?.conversation_id) return { ok: false, error: "no-conversation" };
  if (!ship?.tracking_number) return { ok: false, error: "no-tracking" };
  const { data: contact } = await supabase.from("contacts").select("name").eq("id", order.contact_id).maybeSingle();
  const first = ((contact?.name as string) ?? "").split(" ")[0];
  const businessId = order.business_id as string;
  const body = `¡Hola ${first}! 📦 Tu pedido ${order.code} ya va en camino${ship.carrier ? ` por ${ship.carrier}` : ""}. Tu número de rastreo es: ${ship.tracking_number}`;
  await supabase.from("messages").insert({
    business_id: businessId, conversation_id: order.conversation_id,
    direction: "out", type: "text", body: encryptBody(businessId, body), author_id: user?.id ?? null, state: "queued",
  });
  await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", order.conversation_id);
  revalidatePath("/chat");
  return { ok: true };
}
