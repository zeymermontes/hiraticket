/**
 * Desde qué etapa un pedido cuenta como TERMINADO (fuera de la agenda, las banderitas y los
 * conteos de abiertos).
 *
 * El umbral es una etapa: esa y todas las posteriores son "terminado". Vive en dos niveles —- el
 * default del negocio (Ajustes) y una sobreescritura por pedido (su detalle) —- y con NULL en ambos
 * aplica el comportamiento histórico: solo la última etapa.
 *
 * Archivo aparte y puro a propósito: lo usan igual el servidor (consultas) y el cliente (estilos de
 * vencido en tabla y kanban), y meterlo en lib/business arrastraría imports de servidor al cliente.
 */

/** Ids de las etapas que cuentan como terminado, dado el umbral (o la última si no hay). */
export function doneStageIds(stages: { id: string }[], doneFromId?: string | null): Set<string> {
  if (!stages.length) return new Set();
  let from = doneFromId ? stages.findIndex((s) => s.id === doneFromId) : -1;
  if (from < 0) from = stages.length - 1; // sin umbral (o etapa borrada) → solo la última
  return new Set(stages.slice(from).map((s) => s.id));
}

/** Igual pero por nombre, para los componentes cuyas filas solo traen el nombre de la etapa. */
export function doneStageNames(stages: { id: string; name: string }[], doneFromId?: string | null): Set<string> {
  const ids = doneStageIds(stages, doneFromId);
  return new Set(stages.filter((s) => ids.has(s.id)).map((s) => s.name));
}
