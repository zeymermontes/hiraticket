"use client";
import type { StickerItem } from "@/lib/chat";

/** Una celda de la bandeja de stickers: el sticker (enviar) más la estrella (favorito).
 *  Compartida por el chat de WhatsApp y el interno — la biblioteca es la misma en los dos. */
export function StickerCell({ s, onSend, onFav, lang }: { s: StickerItem; onSend: () => void; onFav: () => void; lang: "es" | "en" }) {
  return (
    <div className="sticker-cell">
      <button className="sticker-pick" onClick={onSend} title={[s.name, (s.tags ?? []).map((t) => "#" + t).join(" ")].filter(Boolean).join(" · ") || (lang === "es" ? "Enviar sticker" : "Send sticker")}><img src={s.url} alt="" loading="lazy" /></button>
      <button className={"sticker-fav" + (s.fav ? " on" : "")} onClick={(e) => { e.stopPropagation(); onFav(); }} title={s.fav ? (lang === "es" ? "Editar favorito / tags" : "Edit favorite / tags") : (lang === "es" ? "Agregar a favoritos" : "Add to favorites")}>{s.fav ? "★" : "☆"}</button>
      {s.name && <div className="sticker-name" title={s.name}>{s.name}</div>}
    </div>
  );
}
