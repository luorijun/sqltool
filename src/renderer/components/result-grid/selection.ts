export interface CellPosition {
  row: number
  col: string
}

export interface GridSelection {
  rows: number[]
  columns: string[]
  anchor: CellPosition
  active: CellPosition
  toggle: {
    rows: number[]
    columns: string[]
    mode: SelectionMode
    operation: "add" | "remove"
  } | null
}

export type SelectionMode = "cells" | "rows" | "columns" | "all"

export interface SelectionGesture {
  base: Pick<GridSelection, "rows" | "columns">
  anchor: CellPosition
  mode: SelectionMode
  operation: "replace" | "add" | "remove"
  keepAxis: boolean
  rowCount: number
  columns: string[]
}

function range(start: number, end: number): number[] {
  return Array.from(
    { length: Math.abs(end - start) + 1 },
    (_, i) => Math.min(start, end) + i,
  )
}

function target(gesture: SelectionGesture, point: CellPosition) {
  const { anchor, mode, rowCount, columns, base, keepAxis } = gesture
  return {
    rows:
      mode === "columns" || mode === "all"
        ? mode === "columns" && keepAxis
          ? base.rows
          : range(0, rowCount - 1)
        : range(anchor.row, point.row),
    columns:
      mode === "rows" || mode === "all"
        ? mode === "rows" && keepAxis
          ? base.columns
          : columns
        : range(columns.indexOf(anchor.col), columns.indexOf(point.col)).map(
            (i) => columns[i],
          ),
  }
}

export function beginSelection(
  current: GridSelection | null,
  point: CellPosition,
  mode: SelectionMode,
  rowCount: number,
  columns: string[],
  modifiers: { shift: boolean; ctrl: boolean },
): SelectionGesture | null {
  if (!rowCount || !columns.length) return null
  const previous =
    modifiers.shift && modifiers.ctrl && current?.toggle?.mode === mode
      ? current.toggle
      : null
  const source = previous ?? current
  const base = {
    rows: [...(source?.rows ?? [])],
    columns: [...(source?.columns ?? [])],
  }
  const gesture: SelectionGesture = {
    base,
    anchor: modifiers.shift && current ? current.anchor : point,
    mode,
    operation: previous?.operation ?? "replace",
    keepAxis:
      (modifiers.shift || modifiers.ctrl) &&
      base.rows.length > 0 &&
      base.columns.length > 0,
    rowCount,
    columns,
  }
  if (modifiers.ctrl && !previous) {
    const area = target(gesture, point)
    const rows = new Set(base.rows)
    const cols = new Set(base.columns)
    const covered =
      rows.size > 0 &&
      cols.size > 0 &&
      (mode === "columns" || area.rows.every((row) => rows.has(row))) &&
      (mode === "rows" || area.columns.every((col) => cols.has(col)))
    gesture.operation = covered ? "remove" : "add"
  }
  return gesture
}

export function updateSelection(
  gesture: SelectionGesture,
  point: CellPosition,
): GridSelection {
  const { base, mode, operation } = gesture
  const area = target(gesture, point)
  let rows = area.rows
  let columns = area.columns
  if (operation === "add") {
    rows = [...new Set([...base.rows, ...area.rows])]
    columns = [...new Set([...base.columns, ...area.columns])]
  } else if (operation === "remove") {
    const removedRows = new Set(area.rows)
    const removedCols = new Set(area.columns)
    rows =
      mode === "columns"
        ? base.rows
        : base.rows.filter((row) => !removedRows.has(row))
    columns =
      mode === "rows"
        ? base.columns
        : base.columns.filter((col) => !removedCols.has(col))
  }
  // An empty area retains its anchor and focus so Shift can select from it again.
  if (!rows.length || !columns.length) {
    rows = []
    columns = []
  }
  return {
    rows,
    columns,
    anchor: gesture.anchor,
    active: point,
    toggle: operation === "replace" ? null : { ...base, mode, operation },
  }
}

export function movePosition(
  current: CellPosition | undefined,
  direction: { row: number; col: number },
  rowCount: number,
  columns: string[],
  edge: boolean,
): CellPosition | null {
  if (!rowCount || !columns.length) return null
  const active = current ?? { row: 0, col: columns[0] }
  const move = (index: number, delta: number, count: number) => {
    if (edge && delta) return delta < 0 ? 0 : count - 1
    return Math.max(0, Math.min(count - 1, index + (current ? delta : 0)))
  }
  return {
    row: move(active.row, direction.row, rowCount),
    col: columns[
      move(columns.indexOf(active.col), direction.col, columns.length)
    ],
  }
}
