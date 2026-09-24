// ZIP mínimo (browser-side, sin dependencias): entradas guardadas sin comprimir. Lo comparten el
// .xlsx (que es un ZIP de XML) y la exportación de chats (transcripción + carpeta media/).
// Sin compresión a propósito: fotos, videos y PDF ya vienen comprimidos, y el XML del xlsx es chico.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (buf: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Empaqueta `files` en un ZIP (método STORE). `mime` es el tipo del Blob resultante. */
export function zip(files: { name: string; data: Uint8Array }[], mime = "application/zip"): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // Fecha DOS fija (las entradas necesitan una; el valor no importa para nuestro uso).
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    // Bit 11 de las banderas: el nombre va en UTF-8 (acentos y ñ en los nombres de archivo).
    const head = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(dosDate),
      ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0),
    ]);
    chunks.push(head, name, f.data);
    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(dosDate),
      ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length),
      ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
    ]), name);
    offset += head.length + name.length + f.data.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  chunks.push(...central, new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(cdSize), ...u32(offset), ...u16(0),
  ]));
  return new Blob(chunks as BlobPart[], { type: mime });
}

/** Dispara la descarga de un Blob con `name`. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
