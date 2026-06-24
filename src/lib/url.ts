/** The configured public origin from env, or "" if unset.
 *  Use APP_URL (a RUNTIME server env var) — NEXT_PUBLIC_* vars are inlined at build time, so if you
 *  set them after building they read as undefined on the server. APP_URL is read at runtime. */
export function configuredOrigin(): string {
  const env = process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  return env ? env.replace(/\/+$/, "") : "";
}

/** The app's public origin for server-side redirects (logout, auth callback).
 *  Behind a proxy (Render/Vercel) `new URL(request.url).origin` is the internal http://localhost:PORT,
 *  so we prefer, in order: APP_URL/NEXT_PUBLIC_SITE_URL, the forwarded host, the Host header (ignoring
 *  localhost), and only then the request origin. Set APP_URL on the host to remove all ambiguity. */
export function publicOrigin(request: Request): string {
  const env = configuredOrigin();
  if (env) return env;
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host && !host.startsWith("localhost") && !host.startsWith("127.0.0.1")) return `${proto}://${host}`;
  return new URL(request.url).origin;
}
