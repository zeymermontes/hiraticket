"use client";
import { LegalDoc } from "@/components/LegalDoc";


export function TermsContent() {
  return (
    <LegalDoc title={{ es: "Términos de Servicio", en: "Terms of Service" }}>
      {(t) => (
        <>
          <h2>{t("1. El servicio", "1. The service")}</h2>
          <p>
            {t(
              "Hiraticket es una plataforma que permite a los negocios gestionar sus conversaciones de WhatsApp y sus pedidos en un solo lugar: bandeja de entrada compartida, asignación a agentes, pedidos vinculados al chat, tablero por etapas y reportes. La mensajería de WhatsApp se procesa mediante la API oficial de WhatsApp Business de Meta (WhatsApp Business Platform).",
              "Hiraticket is a platform that lets businesses manage their WhatsApp conversations and orders in one place: shared inbox, agent assignment, orders linked to the chat, a stage board and reports. WhatsApp messaging is processed through Meta's official WhatsApp Business API (WhatsApp Business Platform).",
            )}
          </p>

          <h2>{t("2. Cuenta", "2. Account")}</h2>
          <p>
            {t(
              "Para usar el servicio necesitas crear una cuenta con información veraz y mantener la confidencialidad de tus credenciales. Eres responsable de la actividad realizada desde tu cuenta y de los usuarios (agentes) que invites a ella.",
              "To use the service you must create an account with accurate information and keep your credentials confidential. You are responsible for activity from your account and for the users (agents) you invite to it.",
            )}
          </p>

          <h2>{t("3. Uso aceptable y políticas de WhatsApp", "3. Acceptable use and WhatsApp policies")}</h2>
          <p>
            {t("Al conectar un número de WhatsApp aceptas cumplir los ", "By connecting a WhatsApp number you agree to comply with the ")}
            <a href="https://www.whatsapp.com/legal/business-terms" target="_blank" rel="noopener">
              {t("Términos de WhatsApp Business", "WhatsApp Business Terms")}
            </a>
            {t(", la ", ", the ")}
            <a href="https://business.whatsapp.com/policy" target="_blank" rel="noopener">
              {t("Política de Mensajería de WhatsApp Business", "WhatsApp Business Messaging Policy")}
            </a>
            {t(" y las políticas de la plataforma de Meta. En particular:", " and Meta's platform policies. In particular:")}
          </p>
          <ul>
            <li>
              {t(
                "No enviar mensajes no solicitados (spam) ni comprar/usar listas de contactos de terceros.",
                "Do not send unsolicited messages (spam) or buy/use third-party contact lists.",
              )}
            </li>
            <li>
              {t(
                "Contactar únicamente a clientes que hayan dado su consentimiento para recibir mensajes del negocio.",
                "Only contact customers who have consented to receive messages from the business.",
              )}
            </li>
            <li>
              {t(
                "No usar el servicio para contenido ilegal, engañoso o prohibido por las políticas de Meta.",
                "Do not use the service for illegal, deceptive or content prohibited by Meta's policies.",
              )}
            </li>
          </ul>
          <p>
            {t(
              "Podemos suspender cuentas que incumplan estas políticas o que pongan en riesgo la integración con la plataforma de Meta.",
              "We may suspend accounts that breach these policies or that put the integration with Meta's platform at risk.",
            )}
          </p>

          <h2>{t("4. Planes, pagos y cancelación", "4. Plans, payments and cancellation")}</h2>
          <p>
            {t(
              "El servicio se ofrece mediante planes de suscripción mensual o anual, con un periodo de prueba gratuito de 14 días sin tarjeta. Puedes cambiar o cancelar tu plan en cualquier momento desde Ajustes; los cambios aplican en tu siguiente ciclo de facturación. Los precios se muestran en pesos mexicanos.",
              "The service is offered through monthly or annual subscription plans, with a 14-day free trial and no card required. You can change or cancel your plan anytime from Settings; changes apply on your next billing cycle. Prices are shown in Mexican pesos.",
            )}
          </p>

          <h2>{t("5. Datos y privacidad", "5. Data and privacy")}</h2>
          <p>
            {t("El tratamiento de datos personales se describe en nuestro ", "Processing of personal data is described in our ")}
            <a href="/privacy">{t("Aviso de Privacidad", "Privacy Policy")}</a>
            {t(", incluyendo las ", ", including the ")}
            <a href="/privacy#eliminar-datos">{t("instrucciones de eliminación de datos", "data deletion instructions")}</a>
            {t(
              ". Los datos de tus clientes y pedidos te pertenecen; nosotros los procesamos únicamente para prestarte el servicio.",
              ". Your customer and order data belong to you; we process them solely to provide you the service.",
            )}
          </p>

          <h2>{t("6. Propiedad intelectual", "6. Intellectual property")}</h2>
          <p>
            {t(
              "Hiraticket y su software, marca y diseño son propiedad de sus titulares. Te otorgamos una licencia limitada, no exclusiva e intransferible para usar la plataforma mientras tu suscripción esté activa. WhatsApp y Meta son marcas de Meta Platforms, Inc.; Hiraticket es un producto independiente y no está afiliado a Meta.",
              "Hiraticket and its software, brand and design are the property of their owners. We grant you a limited, non-exclusive and non-transferable license to use the platform while your subscription is active. WhatsApp and Meta are trademarks of Meta Platforms, Inc.; Hiraticket is an independent product and is not affiliated with Meta.",
            )}
          </p>

          <h2>{t("7. Disponibilidad y cambios del servicio", "7. Availability and service changes")}</h2>
          <p>
            {t(
              "Trabajamos para mantener el servicio disponible de forma continua, pero no garantizamos disponibilidad ininterrumpida. Podemos actualizar funcionalidades y estos términos; si el cambio es relevante, te lo notificaremos con anticipación razonable.",
              "We work to keep the service continuously available, but do not guarantee uninterrupted availability. We may update features and these terms; if a change is material, we will notify you with reasonable advance notice.",
            )}
          </p>

          <h2>{t("8. Limitación de responsabilidad", "8. Limitation of liability")}</h2>
          <p>
            {t(
              'El servicio se ofrece "tal cual". En la medida permitida por la ley, nuestra responsabilidad total frente a ti se limita al monto pagado por el servicio en los 12 meses anteriores al evento que origine la reclamación. No somos responsables de decisiones de Meta sobre tu número o cuenta de WhatsApp Business, ni del contenido de los mensajes que tu negocio envía.',
              'The service is provided "as is". To the extent permitted by law, our total liability to you is limited to the amount paid for the service in the 12 months before the event giving rise to the claim. We are not responsible for Meta\'s decisions about your WhatsApp Business number or account, nor for the content of the messages your business sends.',
            )}
          </p>

          <h2>{t("9. Ley aplicable", "9. Governing law")}</h2>
          <p>
            {t(
              "Estos términos se rigen por las leyes de los Estados Unidos Mexicanos. Cualquier controversia se someterá a los tribunales competentes de México.",
              "These terms are governed by the laws of the United Mexican States. Any dispute will be submitted to the competent courts of Mexico.",
            )}
          </p>

          <h2>{t("10. Contacto", "10. Contact")}</h2>
          <p>
            {t("Preguntas sobre estos términos: ", "Questions about these terms: ")}
            <a href="mailto:support@hiraticket.com">support@hiraticket.com</a>.
          </p>
        </>
      )}
    </LegalDoc>
  );
}
