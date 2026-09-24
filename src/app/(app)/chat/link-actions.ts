"use server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface LinkMeta { url: string; title: string | null; description: string | null; image: string | null }

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

/** ¿Es una dirección privada, de loopback o de enlace local? La vista previa corre en el servidor
 *  y la URL la escribe el usuario: sin esta comprobación, cualquier miembro podía hacer que el
 *  servidor leyera páginas de la red interna (metadata del proveedor, otros servicios). */
function isPrivateAddress(ip: string): boolean {
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("ff");
}

/** Solo http(s) público en puertos estándar y con un host que resuelva a una IP pública. */
async function isSafeTarget(raw: string): Promise<boolean> {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "80" && u.port !== "443") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
  if (isIP(host)) return !isPrivateAddress(host);
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a.address));
  } catch { return false; }
}

/** Fetch a URL's Open Graph / title metadata for a link preview card. http(s) only, timed out. */
export async function fetchLinkMeta(url: string): Promise<LinkMeta> {
  const empty: LinkMeta = { url, title: null, description: null, image: null };
  if (!/^https?:\/\/[^\s]+$/i.test(url)) return empty;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    // Las redirecciones se siguen a mano para volver a comprobar cada salto: un dominio público
    // que redirige a 10.x.x.x sería la forma fácil de saltarse la comprobación de arriba.
    let target = url;
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      if (!(await isSafeTarget(target))) { clearTimeout(t); return empty; }
      res = await fetch(target, {
        signal: ctrl.signal,
        redirect: "manual",
        headers: { "user-agent": "Mozilla/5.0 (compatible; HiraticketBot/1.0; +link-preview)", accept: "text/html" },
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) { target = new URL(loc, target).href; continue; }
      break;
    }
    clearTimeout(t);
    if (!res || res.status >= 300) return empty;
    if (!(res.headers.get("content-type") ?? "").includes("text/html")) return empty;
    const html = (await res.text()).slice(0, 250_000);

    const meta = (prop: string) => {
      const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1];
      const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i"))?.[1];
      return a ?? b ?? null;
    };
    const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null;
    const title = meta("og:title") ?? titleTag;
    const description = meta("og:description") ?? meta("description");
    let image = meta("og:image") ?? meta("twitter:image");
    if (image && !/^https?:\/\//i.test(image)) { try { image = new URL(image, url).href; } catch { image = null; } }
    return {
      url,
      title: title ? decodeEntities(title.trim()).slice(0, 140) : null,
      description: description ? decodeEntities(description.trim()).slice(0, 200) : null,
      image: image ?? null,
    };
  } catch {
    return empty;
  }
}
