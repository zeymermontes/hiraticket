"use server";
import { getMyBusiness } from "@/lib/queries";
import {
  getKanbanBoard, getKanbanOrderColumn, getKanbanItemColumn,
  type KanbanFilters, type KanbanBoardData, type KanbanCard,
} from "@/lib/kanban";

/** Counts + first page of every column, for the current filters. One round trip from the board. */
export async function loadKanbanBoard(colIds: string[], f: KanbanFilters): Promise<KanbanBoardData> {
  const biz = await getMyBusiness();
  if (!biz) return { counts: {}, columns: {} };
  return getKanbanBoard(biz.id, colIds, f);
}

/** The next page of ONE column — the board pages each column on its own, never globally. */
export async function loadKanbanColumn(
  colId: string, f: KanbanFilters, offset: number,
): Promise<KanbanCard[]> {
  const biz = await getMyBusiness();
  if (!biz) return [];
  return f.products
    ? getKanbanItemColumn(biz.id, colId, f, { offset })
    : getKanbanOrderColumn(biz.id, colId, f, { offset });
}
