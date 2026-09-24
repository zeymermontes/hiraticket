/**
 * Tarjetas de contacto compartidas en el chat, en un solo formato para pintar y exportar.
 *
 * Llegan de dos formas según la conexión: el worker de WhatsApp Web guarda `meta.name` + la
 * vCard cruda (`meta.vcard`), y la API oficial guarda `meta.contacts` con la forma de Meta
 * (`name.formatted_name`, `phones[].phone`…). Una burbuja que solo entendía la primera dejaba la
 * segunda como un "Contacto" vacío que no se podía leer ni copiar.
 */
export interface ContactCard { name: string; phones: string[]; emails: string[]; org: string | null }

type CloudContact = {
  name?: { formatted_name?: string; first_name?: string; last_name?: string } | null;
  phones?: { phone?: string; wa_id?: string }[] | null;
  emails?: { email?: string }[] | null;
  org?: { company?: string } | null;
};

const clean = (s: string | null | undefined) => (s ?? "").trim();

export function contactCardsOf(meta: Record<string, unknown> | null | undefined, body?: string | null): ContactCard[] {
  const m = (meta ?? {}) as { name?: string; vcard?: string; contacts?: CloudContact[] };
  if (Array.isArray(m.contacts) && m.contacts.length) {
    return m.contacts.map((c) => ({
      name: clean(c.name?.formatted_name) || [clean(c.name?.first_name), clean(c.name?.last_name)].filter(Boolean).join(" ") || "Contacto",
      phones: [...new Set((c.phones ?? []).map((p) => clean(p.phone) || (p.wa_id ? "+" + clean(p.wa_id) : "")).filter(Boolean))],
      emails: (c.emails ?? []).map((e) => clean(e.email)).filter(Boolean),
      org: clean(c.org?.company) || null,
    }));
  }
  const vcard = clean(m.vcard);
  const phones = vcard ? [...new Set(Array.from(vcard.matchAll(/^TEL[^:]*:(.+)$/gim)).map((x) => clean(x[1])).filter(Boolean))] : [];
  const emails = vcard ? Array.from(vcard.matchAll(/^EMAIL[^:]*:(.+)$/gim)).map((x) => clean(x[1])).filter(Boolean) : [];
  const org = vcard ? clean(vcard.match(/^ORG[^:]*:(.+)$/im)?.[1]) || null : null;
  const name = clean(m.name) || clean(vcard.match(/^FN[^:]*:(.+)$/im)?.[1]) || clean(body) || "Contacto";
  if (!clean(m.name) && !vcard && !clean(body)) return [];
  return [{ name, phones, emails, org }];
}

/** Texto plano de la tarjeta: "Nombre · +52 … · correo" — para copiar y para la exportación. */
export function contactCardText(c: ContactCard): string {
  return [c.name, c.org, ...c.phones, ...c.emails].filter(Boolean).join(" · ");
}
