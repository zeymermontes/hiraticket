import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getTokenInvite } from "@/app/(app)/invites/actions";
import { InvitePopup, JoinNotice } from "@/components/InvitePopup";

export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getSessionUser();
  // Not signed in → sign in / sign up first, then come back here to join.
  if (!user) redirect(`/login?next=/join/${token}`);

  const info = await getTokenInvite(token);

  /**
   * Si ya estás dentro, no hay nada que aceptar: adentro.
   *
   * Antes se pintaba igual la tarjeta de "te invitaron a un equipo", y al darle Unirme el servidor
   * contestaba `already-in-team` —- o sea, un error rojo por hacer lo único que la pantalla ofrecía,
   * y sin salida más que el enlace de cerrar sesión. Lo que quiere quien abre ese enlace es entrar a
   * esa organización, así que se le manda ahí directo.
   *
   * Por /chat/open y no por /chat a secas: esa ruta CAMBIA de organización antes de entrar (escribe
   * la cookie y redirige). Sin eso aterrizarías en los chats de la organización que tuvieras puesta,
   * que es justo lo que el enlace no quería.
   */
  if (info.alreadyMember && info.businessId) redirect(`/chat/open?org=${info.businessId}`);
  if (!info.ok) return <JoinNotice reason={info.error} />;

  return <InvitePopup businessName={info.businessName!} inviterName={info.inviterName} role={info.role!} token={token} businessId={info.businessId} />;
}
