"use client";
import type { StickerItem } from "@/lib/chat";
import { CachedImg } from "@/components/chat/CachedImg";

/** Una celda de la bandeja de stickers: el sticker (enviar) más la estrella (favorito).
 *  Compartida por el chat de WhatsApp y el interno — la biblioteca es la misma en los dos. */
export function StickerCell({ s, onSend, onFav, lang }: { s: StickerItem; onSend: () => void; onFav: () => void; lang: "es" | "en" }) {
  return (
    <div className="sticker-cell">
      {/* Del caché: la bandeja se vuelve a abrir muchas veces y las firmas cambian en cada carga. */}
      <button className="sticker-pick" onClick={onSend} title={[s.name, (s.tags ?? []).map((t) => "#" + t).join(" ")].filter(Boolean).join(" · ") || (lang === "es" ? "Enviar sticker" : "Send sticker")}><CachedImg path={s.path} url={s.url} alt="" loading="lazy" /></button>
      <button className={"sticker-fav" + (s.fav ? " on" : "")} onClick={(e) => { e.stopPropagation(); onFav(); }} title={s.fav ? (lang === "es" ? "Editar favorito / tags" : "Edit favorite / tags") : (lang === "es" ? "Agregar a favoritos" : "Add to favorites")}>{s.fav ? "★" : "☆"}</button>
      {s.name && <div className="sticker-name" title={s.name}>{s.name}</div>}
    </div>
  );
}
