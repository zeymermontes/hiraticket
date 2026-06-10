"use server";

export interface LinkMeta { url: string; title: string | null; description: string | null; image: string | null }

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

/** Fetch a URL's Open Graph / title metadata for a link preview card. http(s) only, timed out. */
export async function fetchLinkMeta(url: string): Promise<LinkMeta> {
  const empty: LinkMeta = { url, title: null, description: null, image: null };
  if (!/^https?:\/\/[^\s]+$/i.test(url)) return empty;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; HiraticketBot/1.0; +link-preview)", accept: "text/html" },
    });
    clearTimeout(t);
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
