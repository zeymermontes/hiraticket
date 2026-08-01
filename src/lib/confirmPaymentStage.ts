/**
 * A qué etapa, sin importar cómo se llega ahí, se le pregunta si el pedido ya se debe marcar
 * pagado (0075). A diferencia de done_from_stage_id (umbral: esa etapa Y las posteriores), esto es
 * una sola etapa exacta — no tiene sentido "confirmar pago" en un rango.
 *
 * Puro a propósito, mismo motivo que doneStage.ts: lo usan el servidor (moveOrderStage) y
 * eventualmente el cliente (Flujos, para resaltar la etapa elegida), sin arrastrar imports de
 * servidor. Requiere `stages` ya ordenado por `position` (igual que doneStage.ts).
 */

/** La etapa que hoy actúa como "confirmar pago": la elegida en Ajustes, o la última si no hay
 *  ninguna (o la guardada ya no existe). null solo si el negocio no tiene ninguna etapa. */
export function resolveConfirmPaymentStageId(stages: { id: string }[], confirmStageId?: string | null): string | null {
  if (!stages.length) return null;
  if (confirmStageId && stages.some((s) => s.id === confirmStageId)) return confirmStageId;
  return stages[stages.length - 1].id;
}
