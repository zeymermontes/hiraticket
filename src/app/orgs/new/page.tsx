import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { AppProvider } from "@/components/AppContext";
import { OnboardingWizard } from "@/components/OnboardingWizard";

export const dynamic = "force-dynamic";

/**
 * Crear una organización más.
 *
 * Vive FUERA del grupo `(app)` a propósito: es una pantalla de una sola cosa, como el alta inicial,
 * y meterla dentro del shell la dejaría con riel, barra y contadores de la organización que estás a
 * punto de dejar. Reutiliza el asistente de siempre en modo `extra` —- mismo formulario, mismos dos
 * modos, misma alta —- para que no existan dos maneras de crear un espacio que se van separando.
 */
export default async function NewOrgPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/orgs/new");
  return (
    <AppProvider>
      <OnboardingWizard business={null} extra />
    </AppProvider>
  );
}
