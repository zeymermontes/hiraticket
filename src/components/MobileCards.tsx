"use client";
import React from "react";

/**
 * Tarjetas para las listas en móvil.
 *
 * Una tabla de doce columnas no cabe en 390px, y la salida fácil —- dejarla con scroll horizontal —-
 * obliga a barrer de lado para leer UNA fila. Así que en móvil las mismas filas se pintan como
 * tarjetas: lo importante arriba, lo secundario debajo, y todo el ancho para el nombre.
 *
 * Tabla y tarjetas conviven en el DOM y decide el CSS cuál se ve (`.tablewrap` / `.cardlist`), no
 * `useIsMobile`: así el servidor pinta la correcta desde el primer HTML, sin parpadeo. El precio es
 * que la fila se escribe dos veces —- se asume a cambio de que no haya dos verdades sobre QUÉ se
 * ve: los datos y los manejadores son los mismos, solo cambia el acomodo.
 *
 * No intenta ser genérica al punto de recibir columnas y adivinar: cada pantalla decide qué tres o
 * cuatro cosas importan en un teléfono. Esto solo pone el marco para que todas se vean iguales.
 */
export function CardList({ children, empty, onScroll }: {
  children: React.ReactNode;
  empty?: React.ReactNode;
  /** Para las listas con scroll infinito: en móvil quien scrollea es ESTA lista, no `.tablewrap`,
   *  así que el manejador tiene que colgarse aquí también o se deja de pedir la siguiente página. */
  onScroll?: React.UIEventHandler<HTMLDivElement>;
}) {
  const items = React.Children.toArray(children);
  return (
    <div className="cardlist scroll" onScroll={onScroll}>
      {items.length > 0 ? items : <div className="cardlist-empty muted">{empty}</div>}
    </div>
  );
}

/**
 * Una fila.
 *
 * Con `onClick` NO es un `<button>`, aunque se comporte como uno: la fila lleva dentro sus propias
 * acciones (abrir chat, silenciar, eliminar), y un `<button>` dentro de otro `<button>` es HTML
 * inválido —- React lo detecta y tira la hidratación entera del árbol. Costó una pantalla en blanco
 * intermitente antes de que apareciera en la consola.
 *
 * Así que es un `div` con el papel de botón puesto a mano: `role`, foco por teclado y Enter/Espacio.
 * Eso conserva lo que un `<button>` daba —- se puede tabular y el lector de pantalla lo anuncia como
 * activable —- sin el anidamiento prohibido.
 */
export function Card({ onClick, selected, dim, children }: { onClick?: () => void; selected?: boolean; dim?: boolean; children: React.ReactNode }) {
  const cls = "card-row" + (selected ? " sel" : "") + (dim ? " dim" : "");
  if (!onClick) return <div className={cls}>{children}</div>;
  return (
    <div className={cls} role="button" tabIndex={0} onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}>
      {children}
    </div>
  );
}

/** Renglón de arriba: lo que identifica la fila (nombre, código) y a la derecha lo que se compara
 *  de un vistazo (total, hora, estado). */
export function CardTop({ children }: { children: React.ReactNode }) {
  return <div className="card-top">{children}</div>;
}

/** Renglón de abajo: etiquetas, fechas, cualquier cosa secundaria. Se envuelve si no cabe. */
export function CardMeta({ children }: { children: React.ReactNode }) {
  return <div className="card-meta">{children}</div>;
}
