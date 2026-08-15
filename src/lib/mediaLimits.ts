/**
 * Límites de adjuntos compartidos entre el chat (navegador) y el worker de WhatsApp (Go).
 *
 * Este archivo NO importa nada, y eso es deliberado. Vivía en `lib/chat.ts`, que arrastra
 * `server-only` y `next/headers`: importar de ahí un VALOR (no un tipo) desde un componente de
 * cliente mete todo el módulo servidor en el bundle del navegador y rompe el build. `import type`
 * no lo hace porque se borra al compilar, y por eso el error no aparece hasta `next build` —-
 * `tsc --noEmit` lo da por bueno.
 *
 * Un módulo de constantes sueltas, sin importaciones, no puede caer en eso.
 */

/**
 * Tope de lo que el worker puede bajar de WhatsApp: carga el archivo entero en memoria y la
 * instancia tiene 512 MB.
 *
 * DEBE COINCIDIR con `maxMediaBytes` de services/whatsapp/main.go.
 *
 * El chat lo usa para decir "ábrelo en tu teléfono" mirando el tamaño que ya viene guardado, en vez
 * de ofrecer un botón, esperar el intento y enseñar un error: para un archivo de 238 MB el
 * resultado se sabe de antemano.
 */
export const MAX_MEDIA_FETCH_BYTES = 48 * 1024 * 1024;
