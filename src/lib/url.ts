/** The app's public origin for server-side redirects (logout, auth callback).
 *  Behind a proxy (Render/Vercel) `new URL(request.url).origin` is the internal http://localhost:PORT,
 *  so we prefer, in order: an explicit NEXT_PUBLIC_SITE_URL, the forwarded host, the Host header, and
 *  only then the request origin. Set NEXT_PUBLIC_SITE_URL on the host to remove all ambiguity. */
export function publicOrigin(request: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/\/+$/, "");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host && !host.startsWith("localhost") && !host.startsWith("127.0.0.1")) return `${proto}://${host}`;
  return new URL(request.url).origin;
}
