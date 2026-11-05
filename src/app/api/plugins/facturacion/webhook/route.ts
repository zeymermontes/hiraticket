import { NextRequest, NextResponse, after } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { PLUGIN_ID } from "@/lib/facturacion";
import { loadFxConfig, settleLinkInvoice, onRemoteProductSaved, onRemoteProductDeleted, syncProducts } from "@/lib/facturacionOps";
import type { FxCfdi, FxProduct } from "@/lib/facturacion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Avisos de Hiraticket Facturación (uno por negocio; ?biz=<businessId> va en la URL que
// registramos al guardar la llave del plugin).
//
// SEGURIDAD: cada aviso viene firmado con HMAC-SHA256 del cuerpo TAL CUAL, con el secreto que
// Facturación nos entregó una sola vez al registrar el webhook y que guardamos cifrado. Sin firma
// válida no se procesa nada y se responde 401: una firma mala no es un reintento legítimo. La
// firma se verifica sobre el texto crudo, antes de interpretar el JSON.
//
// Con firma válida se responde siempre 200, aunque el evento no nos sirva: Facturación reintenta
// los que no son 2xx y un evento que no reconocemos no va a reconocerse al tercer intento.
//
// Idempotencia: cada evento trae un `id`; se anota en `plugin_webhook_events` y uno repetido se
// ignora. Además, registrar la factura es en sí idempotente (ver recordIssuedInvoice).

function validSignature(secret: string, raw: string, header: string | null): boolean {
  if (!secret || !header) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(header.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LinkEvent { codigo?: string; referencia?: string; total?: number; cfdi?: Partial<FxCfdi> & { id?: string } }
interface CancelEvent { id?: string; uuid?: string; estatus?: string; motivo?: string }

export async function POST(req: NextRequest) {
  const biz = req.nextUrl.searchParams.get("biz") || "";
  const raw = await req.text();
  if (!UUID.test(biz)) return NextResponse.json({ error: "biz" }, { status: 401 });
  const cfg = await loadFxConfig(biz);
  if (!cfg || !validSignature(cfg.webhookSecret, raw, req.headers.get("x-hf-signature"))) {
    return NextResponse.json({ error: "firma" }, { status: 401 });
  }

  let evt: { id?: string; event?: string; data?: unknown };
  try { evt = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }
  if (!evt?.id || !evt.event) return NextResponse.json({ ok: true });
  const admin = createAdminClient();
  const evtId = String(evt.id).slice(0, 80);

  // Evento repetido (reintento de Facturación): ya se procesó.
  const seen = await admin.from("plugin_webhook_events").insert({ id: evtId, business_id: biz, plugin_id: PLUGIN_ID });
  if (seen.error?.code === "23505") return NextResponse.json({ ok: true, repetido: true });

  try {

    if (evt.event === "link.facturado") {
      const d = (evt.data ?? {}) as LinkEvent;
      const cfdi = d.cfdi;
      if (!d.codigo || !cfdi?.id) return NextResponse.json({ ok: true });
      let { data: inv } = await admin.from("invoices").select("id, business_id, order_id")
        .eq("business_id", biz).eq("link_code", d.codigo).maybeSingle();
      // El link no salió de Hiraticket (se creó en el panel de Facturación) pero su referencia es el
      // código de un pedido de este negocio: se le anota la factura a ese pedido.
      if (!inv && d.referencia) {
        const { data: orders } = await admin.from("orders").select("id").eq("business_id", biz).eq("code", d.referencia).limit(2);
        if (orders?.length === 1) {
          const { data: ins } = await admin.from("invoices").insert({
            business_id: biz, order_id: orders[0].id, provider: PLUGIN_ID, status: "link_enviado", link_code: d.codigo, total: d.total ?? cfdi.total ?? null,
          }).select("id, business_id, order_id").maybeSingle();
          inv = ins ?? null;
        }
      }
      if (inv) {
        await settleLinkInvoice(admin, cfg, { id: inv.id as string, business_id: biz, order_id: inv.order_id as string }, {
          id: cfdi.id, uuid: cfdi.uuid ?? null, serie: cfdi.serie ?? null, folio: cfdi.folio ?? null, total: Number(cfdi.total ?? d.total ?? 0),
          estatus: "vigente", xml: cfdi.xml ?? null, pdf: cfdi.pdf ?? null, liga_publica: cfdi.liga_publica ?? null,
          simulado: !!cfdi.simulado, sandbox: !!cfdi.sandbox,
        }, null);
      }
    } else if (evt.event === "cfdi.cancelado") {
      const d = (evt.data ?? {}) as CancelEvent;
      // Solo una cancelación consumada: `cancelacion_pendiente` todavía puede ser rechazada por el receptor.
      if (d.id && d.estatus === "cancelada") {
        const { data: rows } = await admin.from("invoices").update({ status: "cancelada" })
          .eq("business_id", biz).eq("provider", PLUGIN_ID).eq("external_id", d.id).eq("status", "issued").select("id, order_id");
        for (const r of rows ?? []) {
          await admin.from("events").insert({
            business_id: biz, parent_type: "order", parent_id: r.order_id, actor_id: null,
            kind: "file", text: `Factura cancelada · ${d.uuid || d.id}`,
          });
        }
      }
    }
    else if (evt.event === "producto.creado" || evt.event === "producto.actualizado") {
      // El catálogo de Facturación cambió (panel, importación o API): se refleja aquí en el momento.
      // Quien decide si aplica es la fecha `actualizado`, no el origen: ver facturacionOps.
      await onRemoteProductSaved(biz, cfg, (evt.data ?? {}) as FxProduct);
    } else if (evt.event === "producto.eliminado") {
      await onRemoteProductDeleted(biz, cfg, (evt.data ?? {}) as { id?: string; sku?: string | null; eliminado?: string });
    } else if (evt.event === "productos.importados") {
      // Una sola operación tocó más de 100 productos: en vez de 100 avisos llega este, y se traen
      // por lista. Va después de responder: puede tardar más que el tiempo de espera del aviso.
      if (cfg.sync === "pull" || cfg.sync === "ambos") after(() => syncProducts(admin, biz, false).then(() => undefined, () => undefined));
    }
    // `cfdi.timbrado` y `prueba`: nada que hacer. Lo que se timbra desde aquí se registra en el
    // momento, y adivinar a qué pedido pertenece una factura hecha en otro lado es arriesgado.
  } catch {
    // Falló algo nuestro a medio camino (base de datos, almacenamiento). Se borra la marca de
    // "ya visto" y se responde 500 para que Facturación reintente: registrar la factura es
    // idempotente, así que repetirlo no duplica nada.
    await admin.from("plugin_webhook_events").delete().eq("business_id", biz).eq("plugin_id", PLUGIN_ID).eq("id", evtId);
    return NextResponse.json({ error: "interno" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
