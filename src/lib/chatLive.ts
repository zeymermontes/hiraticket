"use client";
import type {
  ChatMessage, ConvDetail, ConvQuery, ConvListPage, ChatListCounts, ConvTab,
} from "@/lib/chat";
import type { ShellBadges } from "@/lib/shellBadges";

/**
 * Las lecturas en vivo del chat, contra la ruta `/chat/live` en vez de acciones de servidor.
 *
 * El porqué está en la ruta. Aquí importa lo que la ruta hace posible y una acción no: **un plazo
 * de espera**. Una acción de servidor la dispara el runtime de Next, no nosotros, así que no hay
 * `AbortSignal` que ponerle: si el POST se queda colgado —- el caso típico es un teléfono que salta
 * de wifi a datos con la petición en el aire —- se queda colgado para siempre y arrastra a todas las
 * demás. Con `fetch` propio, a los 15 s se corta y se reintenta una vez.
 *
 * Un solo reintento, no varios: si el servidor está caído, insistir solo gasta batería. Quien llama
 * ya sabe conservar lo que tiene en pantalla cuando esto falla.
 */
const TIMEOUT_MS = 15_000;

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  // AbortSignal.timeout no existe en Safari < 16, y ahí el móvil es justo el caso que se quiere
  // cubrir; el controlador a mano funciona en todos.
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return { signal: ac.signal, done: () => clearTimeout(t) };
}

async function post<T>(body: Record<string, unknown>, timeoutMs = TIMEOUT_MS): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { signal, done } = withTimeout(timeoutMs);
    try {
      const r = await fetch("/chat/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal,
      });
      if (!r.ok) throw new Error(`live ${r.status}`);
      return (await r.json()) as T;
    } catch (e) {
      lastErr = e;
    } finally { done(); }
  }
  throw lastErr;
}

/** Una ventana de la lista de chats con los filtros aplicados en el servidor. */
export function liveListPage(businessId: string, query: ConvQuery): Promise<ConvListPage> {
  // El barrido del caché de búsqueda pide 300 de una: más lento por naturaleza, plazo más largo.
  return post<ConvListPage>({ kind: "list", businessId, query }, (query.limit ?? 0) > 100 ? 30_000 : TIMEOUT_MS);
}

/** Insignias de pestaña + números de los chips (una sola RPC). */
export function liveChatCounts(businessId: string, opts: { areaId?: string; archived?: boolean; tab?: ConvTab }): Promise<ChatListCounts> {
  return post<ChatListCounts>({ kind: "counts", businessId, opts });
}

/** Mensajes firmados de la conversación abierta (se dispara con cada mensaje nuevo). */
export function liveMessages(convId: string): Promise<ChatMessage[]> {
  return post<ChatMessage[]>({ kind: "messages", convId });
}

/** Una página de historial anterior a `before`, para ir cargando al subir. */
export function loadOlderMessages(convId: string, before: string): Promise<ChatMessage[]> {
  return post<ChatMessage[]>({ kind: "messages", convId, before });
}

/** Solo el encabezado del chat abierto: 1 consulta, sin volver a traer mensajes ni notas. */
export function liveConvHeader(convId: string): Promise<Partial<ConvDetail> | null> {
  return post<Partial<ConvDetail> | null>({ kind: "header", convId });
}

/** El detalle completo de una conversación. */
export function liveDetail(convId: string): Promise<ConvDetail | null> {
  return post<ConvDetail | null>({ kind: "detail", convId });
}

/** Insignias del riel + campana + banderitas del calendario, para que el Shell siga vivo sin
 *  recargar la ruta. Devuelve exactamente lo mismo que el layout pinta al cargar. */
export function liveBadges(businessId: string): Promise<ShellBadges> {
  return post<ShellBadges>({ kind: "badges", businessId });
}
