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

/**
 * Icono de la barra de estado de Android ("badge"), y es un formato distinto, no un tamaño.
 *
 * Dos cosas que lo hacen especial y que aquí se pagaron una detrás de otra:
 *
 * 1. Android NO lo pinta a color: toma solo el CANAL ALFA y rellena de blanco lo opaco. Un PNG a
 *    color, opaco de borde a borde, se convierte por tanto en un cuadrado blanco.
 * 2. Se dibuja a 24dp, del tamaño de la hora. A ese tamaño una silueta RELLENA —- el bocadillo
 *    entero— sigue leyéndose como un cuadrado blanco, aunque técnicamente ya sea una silueta.
 *
 * Así que el badge es solo la **H**, que es lo único que se reconoce ahí arriba. Se saca del propio
 * icono en vez de redibujarla: la H es la zona oscura que queda ENCERRADA por el amarillo, así que
 * se marca lo oscuro que se alcanza desde el borde (el fondo) y lo que sobra es la letra.
 */
const BADGE = 96, INNER = 72, W = 256, THRESH = 110;
const g = await sharp(SRC).resize(W, W).greyscale().raw().toBuffer();
const dark = new Uint8Array(W * W);
for (let i = 0; i < W * W; i++) dark[i] = g[i] < THRESH ? 1 : 0;

// Lo oscuro que se toca desde el borde es fondo, no dibujo.
const outer = new Uint8Array(W * W);
const queue = [];
for (let x = 0; x < W; x++) for (const y of [0, W - 1]) { const i = y * W + x; if (dark[i] && !outer[i]) { outer[i] = 1; queue.push(i); } }
for (let y = 0; y < W; y++) for (const x of [0, W - 1]) { const i = y * W + x; if (dark[i] && !outer[i]) { outer[i] = 1; queue.push(i); } }
for (let q = 0; q < queue.length; q++) {
  const i = queue[q], x = i % W, y = (i / W) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
    const j = ny * W + nx;
    if (dark[j] && !outer[j]) { outer[j] = 1; queue.push(j); }
  }
}

let x0 = W, y0 = W, x1 = -1, y1 = -1;
const letter = Buffer.alloc(W * W * 4);
for (let i = 0; i < W * W; i++) {
  const on = dark[i] && !outer[i];
  letter[i * 4] = 255; letter[i * 4 + 1] = 255; letter[i * 4 + 2] = 255;
  letter[i * 4 + 3] = on ? 255 : 0;
  if (on) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
}
if (x1 < 0) throw new Error("no se encontró la H dentro del bocadillo — ¿cambió el icono de origen?");

const cropped = await sharp(letter, { raw: { width: W, height: W, channels: 4 } })
  .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
  .resize(INNER, INNER, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
  .png().toBuffer();
await sharp({ create: { width: BADGE, height: BADGE, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
  .composite([{ input: cropped, gravity: "center" }])
  .png().toFile(`${OUT}/badge-96.png`);

console.log("iconos listos en", OUT);
