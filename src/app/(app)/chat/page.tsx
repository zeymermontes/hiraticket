import { getMyBusiness } from "@/lib/queries";
import { getSessionUser } from "@/lib/auth";
import { getConversationListPage, getConversationDetail, getAgents, getChatListCounts } from "@/lib/chat";
import { getAreas, getStages } from "@/lib/business";
import { getProducts } from "@/lib/extras";
import { getSessions, isConnected } from "@/lib/whatsapp";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getActiveIntegrations } from "@/lib/plugins";
import { ChatScreen } from "@/components/chat/ChatScreen";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const business = await getMyBusiness();
  if (!business) return null;

  const sp = await searchParams;
  const supabase = await createClient();
  // With an explicit ?c (search, Clientes, notifications) the detail is fetched in parallel with
  // everything else — it doesn't depend on the list, and serializing it made deep links slow.
  const user = await getSessionUser();
  // Seed the list with the window the UI opens on (tab "Míos", chip "Activos") — ChatScreen owns
  // it from there and refetches as filters change, so this is one page, not every conversation.
  const [firstPage, initialCounts, agents, areas, stages, sessions, products, integrations, urlDetail] = await Promise.all([
    getConversationListPage(business.id, { tab: "mine", meId: user!.id, status: "active", limit: 40 }),
    // Sembrados aquí para que los chips salgan con su número en el primer pintado. Antes arrancaban
    // en cero y solo aparecían cuando llegaba el fetch del cliente — eso era el "tarda en aparecer".
    getChatListCounts(business.id, user!.id, { tab: "mine" }),
    getAgents(business.id),
    getAreas(business.id),
    getStages(business.id),
    getSessions(business.id),
    getProducts(business.id),
    getActiveIntegrations(business.id),
    sp.c ? getConversationDetail(sp.c) : Promise.resolve(null),
  ]);
  const list = firstPage.rows;

  /**
   * Sin `?c=` explícito se reabre el último chat que se miró (cookie), y si no, el más reciente.
   * Se resuelven directo en vez de buscarlos en la lista, que ahora es solo una ventana.
   *
   * PERO en un teléfono no: ahí la lista y el hilo no caben a la vez, así que abrir un chat solo
   * significa TAPAR la lista. Entras a Chats y aterrizas dentro de una conversación que no pediste,
   * con el botón de atrás como única salida. En escritorio es lo contrario —- la columna del hilo
   * existe siempre y dejarla vacía es desperdiciar media pantalla.
   *
   * La decisión es del servidor porque el pintado también: si se corrigiera en el cliente, el
   * teléfono ya habría pintado el hilo antes de hidratar y se vería el parpadeo. El servidor no
   * puede medir la ventana, así que mira el user-agent —- impreciso por naturaleza, pero aquí lo
   * peor que pasa al equivocarse es abrir o no abrir un chat, y el gesto para corregirlo es uno.
   */
  const ua = (await headers()).get("user-agent") ?? "";
  const phone = /Mobi/i.test(ua) && !/iPad/i.test(ua);
  let detail = urlDetail;
  if (!detail && !sp.c && !phone) {
    // La cookie lleva el id del negocio: con varias organizaciones, un "último chat" sin dueño
    // apunta a una conversación ajena al cambiar. Hoy eso NO filtra nada —- getConversationDetail
    // usa el cliente con RLS y devuelve null—, pero es una consulta tirada y un comportamiento
    // raro: entras a otra organización y no abre nada por un id que no era de ahí.
    const lastChat = (await cookies()).get(`ht_lastChat_${business.id}`)?.value;
    detail = lastChat ? await getConversationDetail(lastChat) : null;
    if (!detail) {
      const { rows: newest } = await getConversationListPage(business.id, { scope: "all", limit: 1 });
      detail = newest[0] ? await getConversationDetail(newest[0].id) : null;
    }
  }

  return (
    <ChatScreen
      list={list}
      initialCounts={initialCounts}
      detail={detail}
      selectedId={detail?.id ?? null}
      agents={agents}
      areas={areas}
      stages={stages}
      products={products}
      meId={user!.id}
      businessId={business.id}
      connected={isConnected(sessions)}
      invoice={{ add: business.invoice_add_tax ?? true, rate: business.invoice_tax_rate ?? 16 }}
      doneFromStageId={business.done_from_stage_id ?? null}
      manualMarginPct={business.manual_margin_pct ?? 50}
      shipping={integrations.shipping}
      invoicing={integrations.invoicing}
    />
  );
}
