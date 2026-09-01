/**
 * La ruta con la que un adjunto se guarda en Storage.
 *
 * Parece un detalle y era una fuente de envíos muertos. La extensión salía de
 * `file.name.split(".").pop()`, que cuando el nombre NO trae extensión devuelve el nombre ENTERO —-
 * y Android entrega nombres sin extensión más a menudo de lo que parece (un PDF abierto desde
 * Drive, desde Descargas o compartido por otra app). La ruta terminaba siendo
 * `…/1756-x9k.Formulario de lanzamiento` y Storage la rechazaba con un "Invalid key" a secas:
 * el envío fallaba y en pantalla solo se leía "No se pudo enviar 1 de 1".
 *
 * Así que la extensión solo se toma del nombre cuando de verdad lo parece (un sufijo corto y
 * alfanumérico); si no, se deduce del tipo MIME —- que para un PDF es exactamente lo que hace
 * falta —- y como último recurso queda `bin`. El nombre real del archivo no se pierde: viaja en
 * `media_name` y es lo que se muestra en la burbuja.
 */

/** Sufijo del nombre, solo si es corto y alfanumérico ("informe.pdf" → pdf, "Acta 2026" → nada). */
const NAME_EXT = /\.([a-z0-9]{1,8})$/i;
/** Subtipo MIME utilizable tal cual ("application/pdf" → pdf). Los largos con vendor no sirven. */
const MIME_EXT = /^[a-z0-9]+\/(?:x-)?([a-z0-9]{1,8})$/i;

/** La extensión con la que guardar el archivo. Siempre segura para una clave de Storage. */
export function uploadExt(file: File): string {
  const fromName = NAME_EXT.exec(file.name)?.[1];
  if (fromName) return fromName.toLowerCase();
  const fromMime = MIME_EXT.exec(file.type || "")?.[1];
  return (fromMime || "bin").toLowerCase();
}

/** Ruta única dentro del bucket `media`. `folder` separa lo del chat de clientes de lo del equipo. */
export function uploadPath(businessId: string, folder: "out" | "internal", file: File): string {
  return `${businessId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${uploadExt(file)}`;
}
