"use client";
import React, { useMemo, useState } from "react";

// Curated emoji set with keywords (es/en) for search.
const DATA: { c: string; items: [string, string][] }[] = [
  { c: "Caritas", items: [
    ["😀", "sonrisa feliz smile grin"], ["😃", "feliz sonrisa happy"], ["😄", "feliz risa happy"], ["😁", "risa grin sonrisa"], ["😆", "risa carcajada laugh"], ["😅", "risa sudor sweat nervioso"], ["😂", "lagrimas risa lol joy"], ["🤣", "carcajada rofl risa"], ["🙂", "sonrisa leve slight"], ["🙃", "alreves upside"], ["😉", "guino wink"], ["😊", "sonrojo feliz blush"], ["😇", "angel inocente halo"], ["🥰", "amor corazones love"], ["😍", "amor ojos corazon love heart eyes"], ["🤩", "estrellas wow star struck"], ["😘", "beso kiss"], ["😗", "beso kiss"], ["😋", "rico yum delicioso"], ["😛", "lengua tongue"], ["😜", "guino lengua wink tongue"], ["🤪", "loco zany"], ["😎", "lentes cool genial"], ["🤓", "nerd lentes"], ["🥳", "fiesta party celebracion"], ["🤔", "pensando thinking duda"], ["🤨", "ceja raised eyebrow duda"], ["😐", "neutral serio"], ["😶", "sin boca silencio"], ["🙄", "ojos rolling fastidio"], ["😏", "picaro smirk"], ["😴", "dormido sleep zzz"], ["😪", "sueno cansado"], ["😌", "aliviado relieved"], ["😔", "triste pensativo sad"], ["😢", "llorar triste cry sad"], ["😭", "llorar mucho cry sob"], ["😤", "enojo vapor"], ["😠", "enojado angry"], ["😡", "furioso rage rojo"], ["🥺", "suplica pleading ojos"], ["😳", "sonrojo flushed sorpresa"], ["😱", "grito scream miedo"], ["😨", "miedo fear"], ["😰", "ansioso sudor"], ["🤯", "explota mind blown"], ["😬", "nervioso grimace"], ["🤥", "mentira lie pinocho"], ["🤫", "silencio shush"], ["🤭", "risa tapa boca"], ["🥱", "bostezo yawn cansado"], ["😷", "cubrebocas mask enfermo"], ["🤒", "enfermo termometro sick"], ["🤕", "herido lastimado"], ["🤮", "vomito sick"], ["🥴", "mareado woozy"],
  ] },
  { c: "Gestos", items: [
    ["👍", "bien like pulgar arriba thumbs up"], ["👎", "mal dislike pulgar abajo"], ["👌", "ok perfecto"], ["🙏", "gracias rezo por favor pray thanks"], ["🙌", "celebra manos arriba raise"], ["👏", "aplauso clap bravo"], ["🤝", "trato acuerdo handshake mano"], ["💪", "fuerza musculo strong"], ["✋", "alto hand mano"], ["🤚", "mano back"], ["👋", "hola adios wave saludo"], ["✌️", "paz victoria peace"], ["🤞", "suerte cruzados fingers crossed"], ["🤟", "te amo love you"], ["🤙", "llamame call me"], ["👈", "izquierda left"], ["👉", "derecha right"], ["👆", "arriba up"], ["👇", "abajo down"], ["☝️", "uno arriba point"], ["✍️", "escribir write firma"], ["🙇", "reverencia bow disculpa"], ["🤷", "no se shrug"], ["🤦", "facepalm vergüenza"],
  ] },
  { c: "Corazones", items: [
    ["❤️", "amor corazon rojo love heart"], ["🧡", "naranja corazon"], ["💛", "amarillo corazon"], ["💚", "verde corazon"], ["💙", "azul corazon"], ["💜", "morado corazon"], ["🖤", "negro corazon"], ["🤍", "blanco corazon"], ["💔", "roto corazon broken"], ["❣️", "exclamacion corazon"], ["💕", "dos corazones"], ["💞", "corazones girando"], ["💓", "latido corazon"], ["💗", "creciendo corazon"], ["💖", "brillante corazon sparkle"], ["💘", "flecha corazon cupido"], ["💝", "regalo corazon"], ["💋", "beso labios kiss"],
  ] },
  { c: "Objetos y negocio", items: [
    ["✅", "listo check ok hecho done"], ["✔️", "check palomita"], ["❌", "error no equis x"], ["⭐", "estrella star favorito"], ["🌟", "brillo estrella glow"], ["🔥", "fuego fire genial"], ["✨", "brillos sparkles magia"], ["🎉", "fiesta confetti celebra party"], ["🎊", "fiesta confetti"], ["👀", "ojos mirando look"], ["💯", "cien 100 perfecto"], ["💰", "dinero money bolsa"], ["💵", "dinero billete dolar money"], ["💳", "tarjeta pago card pay"], ["🧾", "recibo factura receipt"], ["📦", "paquete caja envio box"], ["🚚", "camion envio entrega truck"], ["🛒", "carrito compra cart"], ["🛍️", "bolsas compra shopping"], ["📱", "celular telefono phone"], ["💬", "mensaje chat burbuja"], ["📞", "telefono llamada call"], ["📍", "ubicacion pin location"], ["⏰", "reloj alarma hora time"], ["🕐", "reloj hora time"], ["📅", "calendario fecha date"], ["📆", "calendario"], ["⚡", "rayo energia bolt"], ["🎁", "regalo gift"], ["🏷️", "etiqueta precio tag"], ["✉️", "correo email mensaje"], ["📷", "camara foto photo"], ["🔔", "campana notificacion bell"], ["⚙️", "ajustes config gear"], ["🔒", "candado seguro lock"],
  ] },
  { c: "Comida", items: [
    ["🍕", "pizza"], ["🍔", "hamburguesa burger"], ["🌮", "taco"], ["🌯", "burrito"], ["🍟", "papas fritas fries"], ["🌭", "hotdog"], ["🍗", "pollo chicken"], ["🥗", "ensalada salad"], ["🍣", "sushi"], ["🍰", "pastel cake"], ["🎂", "pastel cumple cake"], ["🍩", "dona donut"], ["🍪", "galleta cookie"], ["☕", "cafe coffee"], ["🍺", "cerveza beer"], ["🍷", "vino wine"], ["🥤", "refresco bebida drink"], ["🧁", "cupcake panque"], ["🍫", "chocolate"], ["🍦", "helado ice cream"],
  ] },
];

const ALL = DATA.flatMap((g) => g.items);

export function EmojiPicker({ rect, onPick }: { rect: DOMRect; onPick: (e: string) => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return DATA;
    const items = ALL.filter(([, k]) => k.includes(needle));
    return [{ c: "Resultados", items }];
  }, [q]);

  return (
    <div className="menu" style={{ position: "fixed", bottom: window.innerHeight - rect.top + 6, left: rect.left, width: 320, maxHeight: 360, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden", zIndex: 201 }}>
      <div style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
        <div className="field field-sm field-filled"><input autoFocus placeholder="Buscar emoji…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <div className="scroll" style={{ overflowY: "auto", padding: 8 }}>
        {groups.map((g) => (
          <div key={g.c}>
            <div className="t-xs muted" style={{ padding: "4px 2px", fontWeight: 600 }}>{g.c}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2 }}>
              {g.items.map(([e]) => (
                <button key={e} onClick={() => onPick(e)} title={e} style={{ height: 32, border: "none", background: "transparent", borderRadius: 7, cursor: "pointer", fontSize: 20, padding: 0 }}
                  onMouseEnter={(ev) => { (ev.currentTarget as HTMLButtonElement).style.background = "var(--surface-2)"; }}
                  onMouseLeave={(ev) => { (ev.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>{e}</button>
              ))}
            </div>
            {g.items.length === 0 && <div className="muted t-sm" style={{ padding: 8 }}>Sin resultados.</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
