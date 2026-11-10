import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Secreto compartido con el worker de whatsmeow (`PUSH_HOOK_SECRET`). Las rutas que el worker llama
 * (push, vaciar la cola de la API oficial) no tienen usuario: hay un servicio, y se autentica con
 * esto. Se compara en tiempo constante: comparar secretos con `===` filtra su longitud y su prefijo
 * por el tiempo que tarda en fallar. Sin secreto configurado la ruta queda CERRADA, no abierta: un
 * despliegue al que se le olvidó la variable no debe convertirse en un webhook público.
 */
export function hookSecretOk(header: string | null): boolean {
  const expected = process.env.PUSH_HOOK_SECRET?.trim();
  if (!expected) return false;
  const got = (header ?? "").trim();
  if (!got || got.length !== expected.length) return false;
  try { return timingSafeEqual(Buffer.from(got), Buffer.from(expected)); } catch { return false; }
}
