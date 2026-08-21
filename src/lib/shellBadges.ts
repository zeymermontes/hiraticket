import { createClient } from "@/lib/supabase/server";
import { getChatBadges, getNotifications, type Notif } from "@/lib/notifications";
import { getInternalUnread } from "@/lib/internal";
import { getStages } from "@/lib/business";
import { getDueOrders } from "@/lib/extras";
import { doneStageIds } from "@/lib/doneStage";

export interface ShellBadges {
  /** Chats míos sin leer. */
  mine: number;
  /** Chats sin dueño (la insignia secundaria del riel). */
  unassigned: number;
  /** Mensajes del equipo sin leer. */
  internal: number;
  /** Pedidos que no han llegado a la etapa final. */
  orders: number;
  /** Lo que cuelga de la campana. */
  notifications: Notif[];
  /** Fechas (ISO) de pedidos con fecha límite y citas —- las banderitas del calendario. Los cubos
   *  (hoy/mañana/vencido) se arman en el CLIENTE: "hoy" depende del huso del navegador. */
  dueDates: string[];
}

/**
 * Todos los números de la barra superior y del riel, en una sola función.
 *
 * Existe porque tenía DOS dueños que se fueron separando: el layout los calculaba al renderizar la
 * ruta, y `liveBadges` refrescaba solo una parte —- ni los pedidos abiertos ni las banderitas del
 * calendario. Resultado: mover un pedido de etapa dejaba el contador de arriba en el número viejo
 * hasta recargar, porque lo que se refrescaba en vivo no incluía ese número.
 *
 * Ahora los dos llaman aquí. Si mañana se añade una insignia, aparece en los dos sitios o en
 * ninguno.
 */
export async function getShellBadges(
  businessId: string, userId: string, myName: string, doneFromStageId: string | null,
): Promise<ShellBadges> {
  const supabase = await createClient();
  const stages = await getStages(businessId);
  const doneIds = [...doneStageIds(stages, doneFromStageId)];

  // Cuenta por cabecera (`head: true`): no trae filas, solo el número.
  let openQ = supabase.from("orders").select("id", { count: "exact", head: true })
    .eq("business_id", businessId).is("deleted_at", null);
  if (doneIds.length) openQ = openQ.not("stage_id", "in", `(${doneIds.join(",")})`);

  const [chat, internal, notifications, { count: orders }, dueOrders, { data: dueAppts }] = await Promise.all([
    getChatBadges(businessId, userId),
    getInternalUnread(businessId, userId),
    getNotifications(businessId, userId, myName),
    openQ,
    getDueOrders(businessId, stages, doneFromStageId),
    supabase.from("appointments").select("starts_at").eq("business_id", businessId).eq("status", "scheduled")
      .gte("starts_at", new Date(Date.now() - 60 * 86400000).toISOString())
      .lte("starts_at", new Date(Date.now() + 7 * 86400000).toISOString()),
  ]);

  return {
    mine: chat.mine,
    unassigned: chat.unassigned,
    internal,
    orders: orders ?? 0,
    notifications,
    dueDates: [
      ...dueOrders.map((o) => o.due_at),
      ...((dueAppts ?? []) as { starts_at: string }[]).map((a) => a.starts_at),
    ],
  };
}
