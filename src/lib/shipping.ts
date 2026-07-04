import "server-only";

// Shipping provider adapters (Phase 3) — provider-agnostic interface, two live providers.
//
// Skydropx PRO flow (https://pro.skydropx.com/es-MX/api-docs):
//   OAuth2 client_credentials → POST /api/v1/quotations (zips + parcel) → poll GET /api/v1/quotations/:id
//   until is_completed → pick a rate → POST /api/v1/shipments → tracking_number + label_url.
//
// Envíos Perros V3 flow (https://enviosperrosv3.docs.apiary.io — verified against their Insomnia kit):
//   Bearer api key → POST /v3/rates ({package, originZipCode, destinationZipCode}) →
//   GET /v3/locations?zipCode= to resolve the Sepomex colonia name → POST /v3/labels →
//   GET /v3/labels/{tracking}/download?documentSize=letter (base64 PDF). Labels are paid from the
//   account's prepaid balance.

export interface ShipAddress {
  receiver: string;
  phone: string;
  street: string;
  colonia: string;
  city: string;
  state: string;
  zip: string;
  reference?: string;
}
export interface ShipParcel { weight: number; length: number; width: number; height: number }
export interface ShipRate { id: string; quotationId: string; carrier: string; service: string; total: number; days: number | null; eta?: string | null }
export interface ShipLabel { tracking: string; labelUrl: string | null; pdfBase64?: string | null; carrier: string; service: string; cost: number }

const SKYDROPX_BASE = "https://app.skydropx.com";

type SkydropxCfg = Record<string, string>;

async function skydropxToken(cfg: SkydropxCfg): Promise<string | null> {
  try {
    const res = await fetch(`${SKYDROPX_BASE}/api/v1/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", client_id: cfg.client_id, client_secret: cfg.client_secret }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { access_token?: string };
    return j.access_token ?? null;
  } catch { return null; }
}

const originOf = (cfg: SkydropxCfg): ShipAddress => ({
  receiver: cfg.origin_name ?? "", phone: cfg.origin_phone ?? "", street: cfg.origin_street ?? "",
  colonia: cfg.origin_colonia ?? "", city: cfg.origin_city ?? "", state: cfg.origin_state ?? "", zip: cfg.origin_zip ?? "",
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Quote a shipment: returns available carrier rates (cheapest first) + the quotation id. */
export async function skydropxQuote(cfg: SkydropxCfg, dest: ShipAddress, parcel: ShipParcel): Promise<{ ok: boolean; rates: ShipRate[]; error?: string }> {
  const token = await skydropxToken(cfg);
  if (!token) return { ok: false, rates: [], error: "auth" };
  const origin = originOf(cfg);
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  try {
    const create = await fetch(`${SKYDROPX_BASE}/api/v1/quotations`, {
      method: "POST", headers: auth,
      body: JSON.stringify({
        quotation: {
          address_from: { country_code: "MX", postal_code: origin.zip, area_level1: origin.state, area_level2: origin.city, area_level3: origin.colonia },
          address_to: { country_code: "MX", postal_code: dest.zip, area_level1: dest.state, area_level2: dest.city, area_level3: dest.colonia },
          parcel: { weight: parcel.weight, length: parcel.length, width: parcel.width, height: parcel.height },
          requested_carriers: [],
        },
      }),
    });
    if (!create.ok) return { ok: false, rates: [], error: `quote-${create.status}` };
    const created = (await create.json()) as { id?: string; data?: { id?: string } };
    const qid = created.id ?? created.data?.id;
    if (!qid) return { ok: false, rates: [], error: "quote-no-id" };

    // Rates arrive asynchronously — poll until completed (cap ~12s).
    type RawRate = { id?: string; success?: boolean; provider_name?: string; provider_service_name?: string; carrier?: string; service?: string; total?: number | string; amount?: number | string; days?: number; estimated_delivery?: number };
    for (let i = 0; i < 12; i++) {
      await sleep(1000);
      const res = await fetch(`${SKYDROPX_BASE}/api/v1/quotations/${qid}`, { headers: auth });
      if (!res.ok) continue;
      const j = (await res.json()) as { is_completed?: boolean; data?: { is_completed?: boolean; rates?: RawRate[] }; rates?: RawRate[] };
      const done = j.is_completed ?? j.data?.is_completed;
      const raw = j.rates ?? j.data?.rates ?? [];
      if (done || (i >= 5 && raw.length > 0)) {
        const rates = raw
          .filter((r) => r.success !== false && r.id)
          .map((r) => ({
            id: String(r.id), quotationId: String(qid),
            carrier: r.provider_name ?? r.carrier ?? "—",
            service: r.provider_service_name ?? r.service ?? "",
            total: Number(r.total ?? r.amount ?? 0),
            days: r.days ?? r.estimated_delivery ?? null,
          }))
          .filter((r) => r.total > 0)
          .sort((a, b) => a.total - b.total);
        return { ok: true, rates };
      }
    }
    return { ok: false, rates: [], error: "quote-timeout" };
  } catch { return { ok: false, rates: [], error: "network" }; }
}

/** Create the shipment for a chosen rate — returns tracking + label PDF. */
export async function skydropxCreate(cfg: SkydropxCfg, quotationId: string, rateId: string, dest: ShipAddress, parcel: ShipParcel): Promise<{ ok: boolean; label?: ShipLabel; error?: string }> {
  const token = await skydropxToken(cfg);
  if (!token) return { ok: false, error: "auth" };
  const origin = originOf(cfg);

  try {
    const res = await fetch(`${SKYDROPX_BASE}/api/v1/shipments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        shipment: {
          quotation_id: quotationId,
          rate_id: rateId,
          address_from: {
            country_code: "MX", postal_code: origin.zip, area_level1: origin.state, area_level2: origin.city, area_level3: origin.colonia,
            street1: origin.street, name: origin.receiver, phone: origin.phone, email: "",
          },
          address_to: {
            country_code: "MX", postal_code: dest.zip, area_level1: dest.state, area_level2: dest.city, area_level3: dest.colonia,
            street1: dest.street, name: dest.receiver, phone: dest.phone, email: "", reference: dest.reference ?? "",
          },
          parcel: { weight: parcel.weight, length: parcel.length, width: parcel.width, height: parcel.height },
          // SAT (carta porte) defaults for generic merchandise — adjust later if a business needs specifics.
          consignment_note: "53102400",
          package_type: "4G",
        },
      }),
    });
    if (!res.ok) return { ok: false, error: `ship-${res.status}` };
    const j = (await res.json()) as {
      data?: { id?: string; attributes?: Record<string, unknown> };
      included?: { attributes?: { tracking_number?: string; label_url?: string; provider_name?: string; total?: number | string } }[];
    };
    const inc = (j.included ?? []).find((x) => x.attributes?.tracking_number) ?? j.included?.[0];
    const at = (inc?.attributes ?? {}) as { tracking_number?: string; label_url?: string; provider_name?: string; total?: number | string };
    const topAt = (j.data?.attributes ?? {}) as { tracking_number?: string; label_url?: string };
    const tracking = at.tracking_number ?? topAt.tracking_number;
    if (!tracking) return { ok: false, error: "ship-no-tracking" };
    return { ok: true, label: { tracking, labelUrl: at.label_url ?? topAt.label_url ?? null, carrier: at.provider_name ?? "", service: "", cost: Number(at.total ?? 0) } };
  } catch { return { ok: false, error: "network" }; }
}

// ───────────────────────────── Envíos Perros (V3) ─────────────────────────────

type EpCfg = Record<string, string>;

const epBase = (cfg: EpCfg) =>
  cfg.staging === "true" ? "https://staging-app.enviosperros.com/api/v3" : "https://app.enviosperros.com/api/v3";

const epHeaders = (cfg: EpCfg) => ({
  Authorization: `Bearer ${cfg.api_key}`,
  "Content-Type": "application/json",
  Accept: "application/json",
});

const digits10 = (s: string) => s.replace(/\D/g, "").slice(-10);
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Resolve a colonia to its exact Sepomex name (required by /labels). Falls back gracefully:
 *  matched colony → first colony of the zip → the caller's raw text. */
async function epColonia(cfg: EpCfg, zip: string, wanted: string): Promise<string> {
  try {
    const res = await fetch(`${epBase(cfg)}/locations?zipCode=${encodeURIComponent(zip)}`, { headers: epHeaders(cfg) });
    if (!res.ok) return wanted;
    const list = (await res.json()) as { zipCode?: string; colony?: string }[];
    const inZip = (Array.isArray(list) ? list : []).filter((l) => l.zipCode === zip && l.colony);
    if (!inZip.length) return wanted;
    const w = fold(wanted);
    const hit = w ? inZip.find((l) => fold(l.colony!) === w) ?? inZip.find((l) => fold(l.colony!).includes(w) || w.includes(fold(l.colony!))) : null;
    return (hit ?? inZip[0]).colony!;
  } catch { return wanted; }
}

/** Quote a shipment with Envíos Perros — returns available rates (cheapest first). */
export async function enviosperrosQuote(cfg: EpCfg, dest: ShipAddress, parcel: ShipParcel): Promise<{ ok: boolean; rates: ShipRate[]; error?: string }> {
  if (!cfg.api_key) return { ok: false, rates: [], error: "auth" };
  try {
    const res = await fetch(`${epBase(cfg)}/rates`, {
      method: "POST", headers: epHeaders(cfg),
      body: JSON.stringify({
        package: { type: "Box", depth: parcel.length, width: parcel.width, height: parcel.height, weight: parcel.weight },
        originZipCode: cfg.origin_zip,
        destinationZipCode: dest.zip,
      }),
    });
    if (res.status === 401) return { ok: false, rates: [], error: "auth" };
    if (!res.ok) return { ok: false, rates: [], error: `quote-${res.status}` };
    const list = (await res.json()) as { courier?: string; serviceType?: string; total?: number; deliveryCommitment?: string }[];
    const rates = (Array.isArray(list) ? list : [])
      .filter((r) => r.courier && r.serviceType && Number(r.total) > 0)
      .map((r) => ({
        id: `${r.courier}::${r.serviceType}`, // /labels wants courier + service verbatim from the quote
        quotationId: "",
        carrier: r.courier!, service: r.serviceType!,
        total: Number(r.total), days: null, eta: r.deliveryCommitment ?? null,
      }))
      .sort((a, b) => a.total - b.total);
    return { ok: true, rates };
  } catch { return { ok: false, rates: [], error: "network" }; }
}

/** Create the label for a chosen rate — returns tracking + the PDF (base64) for re-hosting. */
export async function enviosperrosCreate(cfg: EpCfg, rateId: string, dest: ShipAddress, parcel: ShipParcel, description: string): Promise<{ ok: boolean; label?: ShipLabel; error?: string }> {
  if (!cfg.api_key) return { ok: false, error: "auth" };
  const [courier, service] = rateId.split("::");
  if (!courier || !service) return { ok: false, error: "bad-rate" };
  try {
    // Colonia names must be the exact Sepomex text — resolve both ends.
    const [originColonia, destColonia] = await Promise.all([
      epColonia(cfg, cfg.origin_zip ?? "", cfg.origin_colonia ?? ""),
      epColonia(cfg, dest.zip, dest.colonia),
    ]);
    const res = await fetch(`${epBase(cfg)}/labels`, {
      method: "POST", headers: epHeaders(cfg),
      body: JSON.stringify({
        courier, service,
        package: {
          type: "Box", description: description.slice(0, 100) || "Mercancía",
          depth: parcel.length, width: parcel.width, height: parcel.height, weight: parcel.weight,
        },
        origin: {
          company: "Particular",
          name: (cfg.origin_name ?? "").slice(0, 100),
          phone: digits10(cfg.origin_phone ?? ""),
          street: (cfg.origin_street ?? "").slice(0, 100),
          neighborhood: originColonia.slice(0, 100),
          zipCode: cfg.origin_zip ?? "",
        },
        destination: {
          company: "Particular",
          name: dest.receiver.slice(0, 100),
          phone: digits10(dest.phone),
          street: dest.street.slice(0, 100),
          neighborhood: destColonia.slice(0, 100),
          zipCode: dest.zip,
          ...(dest.reference?.trim() ? { references: dest.reference.trim().slice(0, 25) } : {}),
        },
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { trackingNumber?: string; total?: number; message?: string };
    if (!res.ok || !j.trackingNumber) return { ok: false, error: j.message || `ship-${res.status}` };

    // Fetch the label PDF (base64) so the caller can host a stable copy.
    let pdfBase64: string | null = null;
    try {
      const dl = await fetch(`${epBase(cfg)}/labels/${encodeURIComponent(j.trackingNumber)}/download?documentSize=letter`, { headers: epHeaders(cfg) });
      if (dl.ok) pdfBase64 = ((await dl.json()) as { document?: string }).document ?? null;
    } catch { /* label still created — PDF can be fetched later from their panel */ }

    return { ok: true, label: { tracking: j.trackingNumber, labelUrl: null, pdfBase64, carrier: courier, service, cost: Number(j.total ?? 0) } };
  } catch { return { ok: false, error: "network" }; }
}
