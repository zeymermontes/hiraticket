"use client";
import { LegalDoc } from "@/components/LegalDoc";


export function PrivacyContent() {
  return (
    <LegalDoc title={{ es: "Aviso de Privacidad", en: "Privacy Policy" }}>
      {(t) => (
        <>
          <h2>{t("1. Responsable del tratamiento", "1. Data controller")}</h2>
          <p>
            {t(
              'Hiraticket ("nosotros") es una plataforma de gestión de conversaciones y pedidos para negocios que atienden a sus clientes por WhatsApp. Este aviso describe cómo recopilamos, usamos y protegemos los datos personales de nuestros usuarios y de los clientes finales de los negocios que usan la plataforma, conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (México).',
              'Hiraticket ("we") is a conversation and order management platform for businesses that serve their customers over WhatsApp. This policy describes how we collect, use and protect the personal data of our users and of the end customers of the businesses that use the platform, in accordance with Mexico\'s Federal Law on the Protection of Personal Data Held by Private Parties.',
            )}
          </p>

          <h2>{t("2. Datos que recopilamos", "2. Data we collect")}</h2>
          <ul>
            <li>
              <strong>{t("Datos de cuenta:", "Account data:")}</strong>{" "}
              {t(
                "nombre, correo electrónico, teléfono y datos del negocio que registras al crear tu cuenta.",
                "name, email, phone and business details you enter when creating your account.",
              )}
            </li>
            <li>
              <strong>{t("Datos de conversaciones:", "Conversation data:")}</strong>{" "}
              {t(
                "mensajes, archivos y números de teléfono de los clientes que escriben al WhatsApp del negocio, procesados a través de la API oficial de WhatsApp Business de Meta (WhatsApp Business Platform).",
                "messages, files and phone numbers of the customers who write to the business's WhatsApp, processed through Meta's official WhatsApp Business API (WhatsApp Business Platform).",
              )}
            </li>
            <li>
              <strong>{t("Datos de pedidos:", "Order data:")}</strong>{" "}
              {t(
                "productos, montos, estados y notas que el negocio registra en la plataforma.",
                "products, amounts, statuses and notes the business records on the platform.",
              )}
            </li>
            <li>
              <strong>{t("Datos técnicos:", "Technical data:")}</strong>{" "}
              {t(
                "registros de acceso y uso necesarios para operar y proteger el servicio.",
                "access and usage logs needed to operate and protect the service.",
              )}
            </li>
          </ul>

          <h2>{t("3. Uso de la API de WhatsApp Business (Meta)", "3. Use of the WhatsApp Business API (Meta)")}</h2>
          <p>
            {t(
              "Hiraticket se integra con la WhatsApp Business Platform de Meta para enviar y recibir mensajes en nombre de los negocios que conectan su número. El uso de esta integración se rige además por los ",
              "Hiraticket integrates with Meta's WhatsApp Business Platform to send and receive messages on behalf of the businesses that connect their number. Use of this integration is further governed by the ",
            )}
            <a href="https://www.whatsapp.com/legal/business-terms" target="_blank" rel="noopener">
              {t("Términos de WhatsApp Business", "WhatsApp Business Terms")}
            </a>
            {t(" y la ", " and the ")}
            <a href="https://business.whatsapp.com/policy" target="_blank" rel="noopener">
              {t("Política de Mensajería de WhatsApp Business", "WhatsApp Business Messaging Policy")}
            </a>
            {t(
              ". Los negocios se comprometen a obtener el consentimiento de sus clientes para contactarlos por WhatsApp.",
              ". Businesses undertake to obtain their customers' consent to contact them over WhatsApp.",
            )}
          </p>

          <h2>{t("4. Finalidades del tratamiento", "4. Purposes of processing")}</h2>
          <ul>
            <li>
              {t(
                "Prestar el servicio: mostrar conversaciones, vincular pedidos, asignar chats al equipo del negocio.",
                "Provide the service: display conversations, link orders, assign chats to the business's team.",
              )}
            </li>
            <li>
              {t(
                "Operación y soporte: facturación, atención a incidencias y mejoras del producto.",
                "Operations and support: billing, incident handling and product improvements.",
              )}
            </li>
            <li>
              {t(
                "Seguridad: prevención de fraude, abuso y accesos no autorizados.",
                "Security: preventing fraud, abuse and unauthorized access.",
              )}
            </li>
          </ul>
          <p>{t("No vendemos datos personales ni los usamos para publicidad de terceros.", "We do not sell personal data nor use it for third-party advertising.")}</p>

          <h2>{t("5. Protección y almacenamiento", "5. Protection and storage")}</h2>
          <p>
            {t(
              "El contenido de los mensajes se almacena cifrado en reposo. El acceso a los datos de cada negocio está restringido a los usuarios autorizados de esa cuenta mediante roles y permisos, y los cambios relevantes quedan registrados en una bitácora de auditoría.",
              "Message content is stored encrypted at rest. Access to each business's data is restricted to that account's authorized users through roles and permissions, and relevant changes are recorded in an audit log.",
            )}
          </p>

          <h2>{t("6. Compartición de datos", "6. Data sharing")}</h2>
          <p>
            {t(
              "Solo compartimos datos con proveedores necesarios para operar el servicio (infraestructura de nube, procesamiento de pagos y Meta Platforms, Inc. como proveedor de la WhatsApp Business Platform), bajo obligaciones de confidencialidad. No compartimos datos con terceros para fines comerciales.",
              "We only share data with providers necessary to operate the service (cloud infrastructure, payment processing and Meta Platforms, Inc. as the WhatsApp Business Platform provider), under confidentiality obligations. We do not share data with third parties for commercial purposes.",
            )}
          </p>

          <h2>{t("7. Conservación", "7. Retention")}</h2>
          <p>
            {t(
              "Conservamos los datos mientras la cuenta del negocio esté activa. Al cerrar la cuenta, los datos se eliminan conforme a la sección de eliminación de datos de este aviso, salvo los que debamos conservar por obligación legal.",
              "We keep data while the business account is active. When the account is closed, data is deleted per the data-deletion section of this policy, except what we must retain by legal obligation.",
            )}
          </p>

          <h2>{t("8. Derechos ARCO", "8. Data subject rights (ARCO)")}</h2>
          <p>
            {t(
              "Puedes ejercer tus derechos de Acceso, Rectificación, Cancelación y Oposición, así como revocar tu consentimiento, escribiendo a ",
              "You may exercise your rights of Access, Rectification, Cancellation and Opposition, and revoke your consent, by writing to ",
            )}
            <a href="mailto:support@hiraticket.com">support@hiraticket.com</a>
            {t(". Responderemos en un plazo máximo de 20 días hábiles.", ". We will respond within a maximum of 20 business days.")}
          </p>

          <h2 id="eliminar-datos">{t("9. Eliminación de datos", "9. Data deletion")}</h2>
          <p>
            {t(
              "Para solicitar la eliminación de tu cuenta y de todos los datos asociados (conversaciones, pedidos, clientes):",
              "To request deletion of your account and all associated data (conversations, orders, customers):",
            )}
          </p>
          <ul>
            <li>
              {t("Desde la plataforma: ", "From the platform: ")}
              <strong>{t("Ajustes → Cuenta → Eliminar cuenta", "Settings → Account → Delete account")}</strong>
              {t("; o", "; or")}
            </li>
            <li>
              {t("Por correo: escribe a ", "By email: write to ")}
              <a href="mailto:support@hiraticket.com">support@hiraticket.com</a>
              {t(
                ' desde el correo registrado en tu cuenta, con el asunto "Eliminación de datos".',
                ' from the email registered to your account, with the subject "Data deletion".',
              )}
            </li>
          </ul>
          <p>
            {t(
              "La eliminación se completa en un plazo máximo de 30 días naturales y te confirmaremos por correo cuando concluya. Si eres cliente final de un negocio que usa Hiraticket, también puedes solicitar la eliminación de tus datos al mismo correo indicando el número de WhatsApp desde el que escribiste.",
              "Deletion is completed within a maximum of 30 calendar days and we will confirm by email when done. If you are an end customer of a business that uses Hiraticket, you can also request deletion of your data at the same email, indicating the WhatsApp number you wrote from.",
            )}
          </p>

          <h2>{t("10. Cambios a este aviso", "10. Changes to this policy")}</h2>
          <p>
            {t(
              "Podemos actualizar este aviso; publicaremos la versión vigente en esta página con su fecha de actualización.",
              "We may update this policy; the current version will be posted on this page with its update date.",
            )}
          </p>

          <h2>{t("11. Contacto", "11. Contact")}</h2>
          <p>
            {t("Dudas sobre privacidad: ", "Privacy questions: ")}
            <a href="mailto:support@hiraticket.com">support@hiraticket.com</a>.
          </p>
        </>
      )}
    </LegalDoc>
  );
}
