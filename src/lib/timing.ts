/**
 * Cronómetro para las acciones del chat, temporal y a propósito.
 *
 * Existe para contestar UNA pregunta: aceptar, resolver y transferir tardan segundos, pero el cambio
 * aparece en pantalla al instante. ¿Dónde se va el tiempo?
 *
 * Por eso mide en los dos lados. Un log solo en el servidor no distingue los dos casos que hay que
 * separar:
 *
 *   - La acción responde en ~5 s  → el tiempo está en el servidor, o en el re-render de la ruta que
 *     Next mete en la respuesta de toda server action.
 *   - La acción responde en ~200 ms y la transición igual dura 5 s → el tiempo está en React, del
 *     lado del cliente, y la base no tiene nada que ver.
 *
 * Sin directiva de módulo a propósito: `console.log` y `performance.now()` existen en los dos lados,
 * así que el mismo archivo sirve para las acciones del servidor y para los clics del navegador.
 *
 * Quitar cuando esté contestada.
 */

const TAG = "[t]";
const ms = (t0: number) => Math.round(performance.now() - t0);

/** Envuelve el cuerpo de una server action. Loguea inicio y fin en los logs de Render. */
export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  console.log(`${TAG} ${label}: inicio`);
  try {
    return await fn();
  } finally {
    console.log(`${TAG} ${label}: fin, ${ms(t0)}ms`);
  }
}

/**
 * Envuelve el clic. Devuelve una función para marcar el final de la transición, así el tiempo queda
 * partido en dos: lo que tardó la acción en contestar, y lo que tardó React en terminar de aplicar
 * el resultado. Es ese corte el que dice de qué lado buscar.
 */
export function timedClick(label: string): { done: () => void; settled: () => void } {
  const t0 = performance.now();
  console.log(`${TAG} ${label}: clic`);
  let answered = 0;
  return {
    done: () => {
      answered = ms(t0);
      console.log(`${TAG} ${label}: la acción respondió en ${answered}ms`);
    },
    settled: () => {
      const total = ms(t0);
      console.log(`${TAG} ${label}: transición terminada en ${total}ms (React se quedó ${total - answered}ms después de la respuesta)`);
    },
  };
}
