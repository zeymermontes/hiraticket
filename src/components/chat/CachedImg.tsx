"use client";
import type { ImgHTMLAttributes } from "react";
import { useCachedMedia } from "@/lib/mediaCache";

/**
 * `<img>` que pinta desde el caché del navegador cuando los bytes ya están guardados, y desde la
 * URL firmada la primera vez. Existe como componente porque los sitios donde hace falta están
 * dentro de `.map()`, y ahí no se pueden llamar hooks.
 *
 * `path` es la ruta en storage (estable). Ver `@/lib/mediaCache`.
 */
export function CachedImg({ path, url, ...rest }: { path?: string | null; url?: string | null } & Omit<ImgHTMLAttributes<HTMLImageElement>, "src">) {
  const src = useCachedMedia(path, url);
  return <img {...rest} src={src} />;
}
