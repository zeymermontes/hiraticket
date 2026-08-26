"use client";
import { useMemo } from "react";
import qrcode from "qrcode-generator";

/**
 * El QR de vinculación, dibujado AQUÍ.
 *
 * Antes la imagen se pedía a `api.qrserver.com`: un tercero en el camino crítico de lo primero
 * que hace un negocio nuevo. Medido, tardaba entre 0.8 y 1.1 s desde una conexión de escritorio
 * —- bastante más en datos móviles —- y encima:
 *   · el código de emparejamiento, que es un secreto de un solo uso, viajaba en la URL de un
 *     servicio ajeno, o sea a sus registros;
 *   · si ese servicio falla, está lento o el operador lo bloquea, el QR simplemente no aparece
 *     y nada explica por qué.
 * Generarlo en el navegador cuesta ~1 ms y ninguna petición.
 *
 * Va en SVG y no en canvas: escala sin pixelarse, sale nítido en pantallas de mucha densidad y no
 * necesita esperar a un `ref` para pintarse.
 */

/** Corrección de errores L: es la que menos módulos gasta, y aquí importa. Un QR en pantalla no
 *  se arruga ni se mancha —- que es para lo que sirve subir el nivel—, y cada nivel de más
 *  aprieta la cuadrícula: con esta carga, L da 49×49 y Q daría 65×65. Menos módulos = módulos más
 *  grandes = la cámara lo agarra desde más lejos. Es también lo que usaba el servicio de antes. */
const EC_LEVEL = "L" as const;

/** El margen en blanco del estándar. No es decoración: sin él, muchos lectores no encuentran el
 *  código porque no distinguen dónde termina. Viaja en el viewBox, así que no ocupa maquetación. */
const QUIET = 4;

export function QrCode({ value, size = 220, title }: { value: string; size?: number; title?: string }) {
  const shape = useMemo(() => {
    try {
      const qr = qrcode(0, EC_LEVEL); // 0 = versión automática, la más chica que quepa
      qr.addData(value);
      qr.make();
      const n = qr.getModuleCount();
      // Un solo <path> con todos los módulos: miles de <rect> harían sudar al navegador cada vez
      // que el QR se refresca, y esto se refresca solo hasta que alguien escanea.
      let d = "";
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      }
      return { d, n };
    } catch {
      // La carga no cupo en ninguna versión (no debería: la de WhatsApp ronda los 180 caracteres).
      return null;
    }
  }, [value]);

  if (!shape) return null;
  const span = shape.n + QUIET * 2;

  return (
    <svg
      width={size} height={size}
      viewBox={`${-QUIET} ${-QUIET} ${span} ${span}`}
      role="img" aria-label={title ?? "Código QR"}
      // crispEdges apaga el suavizado: sin esto los módulos salen con el borde lavado y a la
      // cámara le cuesta decidir si un cuadro es claro u oscuro.
      shapeRendering="crispEdges"
      style={{ borderRadius: 10, border: "1px solid var(--border)", background: "#fff", padding: 6, display: "block" }}
    >
      {/* Negro sobre blanco SIEMPRE, sin tokens de tema. Un QR que se adapta al modo oscuro se ve
          precioso y no lo lee nadie: los lectores esperan módulos oscuros sobre fondo claro. */}
      <rect x={-QUIET} y={-QUIET} width={span} height={span} fill="#fff" />
      <path d={shape.d} fill="#000" />
    </svg>
  );
}
