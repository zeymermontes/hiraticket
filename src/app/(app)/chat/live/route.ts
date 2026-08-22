import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getConversationMessages, getConversationListPage, getChatListCounts,
  getConversationDetail, getConversationHeader,
  type ConvQuery, type ConvTab,
} from "@/lib/chat";
import { getShellBadges } from "@/lib/shellBadges";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /chat/live — las lecturas EN VIVO del chat (lista, contadores, mensajes, encabezado…).
 *
 * Antes eran acciones de servidor. El problema no era la consulta sino la fila en la que se
 * formaban: **React serializa las acciones de servidor por cliente** —- una a la vez, en orden. Es
 * lo correcto para escrituras (que un "resolver" y un "transferir" no se pisen), pero estas son
 * LECTURAS, y bastaba con que una se quedara colgada —- un POST que el teléfono nunca resuelve al
 * saltar de wifi a datos, o una consulta lenta —- para que todo lo que venía detrás esperara para
 * siempre. Ese es el "algo dejó de cargar de fondo y cambiar de pestaña ya no cambia la lista,
 * hasta que recargo": ningún error, solo una fila detenida. Y no hacía falta que se colgara del
 * todo: el barrido del caché de búsqueda pedía 300 conversaciones por acción 10 s después de cada
 * entrada al chat, y mientras corría, cualquier cambio de pestaña se quedaba encolado detrás.
 *
 * Una ruta normal no entra en esa fila: cada lectura sale en paralelo, y desde el cliente se le
 * puede poner un plazo (ver `src/lib/chatLive.ts`) —- algo que a una acción de servidor no se le
 * puede poner, porque quien dispara el `fetch` es el runtime, no nosotros.
 *
 * Mismo modelo de confianza que las acciones que reemplaza: se usa el cliente con RLS y con las
 * cookies de la sesión, así que el `businessId` que manda el cliente no abre nada que no fuera ya
 * suyo. Precedente en la casa: `/chat/backfill`, que nació de este mismo problema.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad-json" }, { status: 400 }); }

  const kind = String(body.kind ?? "");
  const businessId = typeof body.businessId === "string" ? body.businessId : "";
  const convId = typeof body.convId === "string" ? body.convId : "";

  switch (kind) {
    case "list": {
      if (!businessId) return NextResponse.json({ rows: [], total: 0 });
      return NextResponse.json(await getConversationListPage(businessId, (body.query ?? {}) as ConvQuery));
    }
    case "counts": {
      const user = await getSessionUser();
      if (!user || !businessId) return NextResponse.json(EMPTY_COUNTS);
      const o = (body.opts ?? {}) as { areaId?: string; archived?: boolean; tab?: ConvTab };
      return NextResponse.json(await getChatListCounts(businessId, user.id, o));
    }
    case "messages": {
      if (!convId) return NextResponse.json([]);
      const before = typeof body.before === "string" ? body.before : undefined;
      return NextResponse.json(await getConversationMessages(convId, before ? { before } : undefined));
    }
    case "header":
      return NextResponse.json(convId ? await getConversationHeader(convId) : null);
    case "detail":
      return NextResponse.json(convId ? await getConversationDetail(convId) : null);
    case "badges": {
      const user = await getSessionUser();
      if (!user || !businessId) return NextResponse.json(EMPTY_BADGES);
      const supabase = await createClient();
      const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
      const myName = (prof?.full_name as string) || (user.user_metadata?.full_name as string) || (user.email ? user.email.split("@")[0] : "Agente");
      // La etapa final es del negocio, no del usuario: hace falta para saber qué pedidos siguen
      // abiertos y cuáles ya no cuentan para las banderitas.
      const { data: biz } = await supabase.from("businesses").select("done_from_stage_id").eq("id", businessId).maybeSingle();
      return NextResponse.json(await getShellBadges(businessId, user.id, myName, (biz?.done_from_stage_id as string | null) ?? null));
    }
    default:
      return NextResponse.json({ error: "bad-kind" }, { status: 400 });
  }
}

const EMPTY_BADGES = { mine: 0, unassigned: 0, internal: 0, orders: 0, proofs: 0, notifications: [], dueDates: [] };
const EMPTY_COUNTS = { all: 0, active: 0, open: 0, pending: 0, resolved: 0, unread: 0, trash: 0, archived: 0, mine: 0, unassigned: 0 };
