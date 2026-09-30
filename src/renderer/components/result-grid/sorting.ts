import type { SortingState } from "@tanstack/react-table"

export interface SortItem {
  id: string
  desc: boolean | null
}

export function createSortDraft(
  columns: string[],
  sorting: SortingState,
  order: string[],
): SortItem[] {
  const ids = [
    ...order.filter((id) => columns.includes(id)),
    ...columns.filter((id) => !order.includes(id)),
  ]
  return ids.map((id) => ({
    id,
    desc: sorting.find((item) => item.id === id)?.desc ?? null,
  }))
}

export function activeSorting(draft: SortItem[]): SortingState {
  return draft.flatMap((item) =>
    item.desc === null ? [] : [{ id: item.id, desc: item.desc }],
  )
}

export function toggleSort(
  sorting: SortItem[],
  id: string,
  desc: boolean,
): SortItem[] {
  return sorting.map((item) =>
    item.id === id ? { id, desc: item.desc === desc ? null : desc } : item,
  )
}

export function moveSort(
  sorting: SortItem[],
  id: string,
  index: number,
): SortItem[] {
  const from = sorting.findIndex((order) => order.id === id)
  if (from < 0 || index < 0 || index >= sorting.length || from === index)
    return sorting
  const next = [...sorting]
  next.splice(index, 0, ...next.splice(from, 1))
  return next
}

export function sameSorting(left: SortingState, right: SortingState) {
  return (
    left.length === right.length &&
    left.every(
      (order, i) => order.id === right[i].id && order.desc === right[i].desc,
    )
  )
}
