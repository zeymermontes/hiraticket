/**
 * Genera los iconos de la PWA desde public/hiraticket-icon-1024.png.
 *
 * Se corre a mano (`node scripts/make-icons.mjs`), no en el build: la fuente cambia una vez cada
 * nunca y no vale la pena meter sharp en la cadena de despliegue.
 *
 * El "maskable" lleva 20% de margen a propósito. Android recorta el icono con la forma que tenga
 * el launcher —- círculo, rombo, cuadrado redondeado —- y sin ese aire se come los bordes del
 * dibujo. Es la diferencia entre un icono que se ve bien en todos los teléfonos y uno mochado.
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const SRC = "public/hiraticket-icon-1024.png";
const OUT = "public/icons";
const BG = { r: 0xf5, g: 0xc5, b: 0x18, alpha: 1 }; // amarillo Hirata, para el relleno del maskable

await mkdir(OUT, { recursive: true });

for (const size of [192, 512]) {
  await sharp(SRC).resize(size, size).png().toFile(`${OUT}/icon-${size}.png`);
}

// Maskable: el dibujo al 60% centrado sobre el fondo de marca, así el recorte del launcher nunca
// muerde contenido.
const inner = await sharp(SRC).resize(307, 307).png().toBuffer(); // 60% de 512
await sharp({ create: { width: 512, height: 512, channels: 4, background: BG } })
  .composite([{ input: inner, gravity: "center" }])
  .png().toFile(`${OUT}/icon-maskable-512.png`);

// iOS no soporta transparencia en el icono de la pantalla de inicio: la pinta de negro.
await sharp(SRC).resize(180, 180).flatten({ background: BG }).png().toFile(`${OUT}/apple-touch-icon.png`);

console.log("iconos listos en", OUT);
