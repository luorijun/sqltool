export interface ColumnBounds {
  id: string
  left: number
  right: number
  pinned: "start" | "end" | undefined
}

export interface GridBounds {
  left: number
  right: number
  top: number
  bottom: number
  bodyTop: number
  bodyBottom: number
  centerLeft: number
  centerRight: number
  columns: ColumnBounds[]
}

export function measureGrid(root: HTMLElement): GridBounds {
  const rect = root.getBoundingClientRect()
  const left = rect.left + root.clientLeft
  const top = rect.top + root.clientTop
  const right = left + root.clientWidth
  const bottom = top + root.clientHeight
  const headers = Array.from(
    root.querySelectorAll<HTMLElement>("thead [data-grid-col]"),
  )
  const columns = headers.map((header): ColumnBounds => {
    const box = header.getBoundingClientRect()
    const pinned = header.dataset.gridPin
    return {
      id: header.dataset.gridCol ?? "",
      left: box.left,
      right: box.right,
      pinned: pinned === "start" || pinned === "end" ? pinned : undefined,
    }
  })
  const centerLeft = Math.min(
    right,
    columns
      .filter((column) => column.pinned === "start")
      .reduce((edge, column) => Math.max(edge, column.right), left),
  )
  const centerRight = Math.max(
    centerLeft,
    columns
      .filter((column) => column.pinned === "end")
      .reduce((edge, column) => Math.min(edge, column.left), right),
  )
  const bodyTop = Math.min(
    bottom,
    headers.reduce(
      (edge, header) => Math.max(edge, header.getBoundingClientRect().bottom),
      top,
    ),
  )
  const bodyBottom = Math.max(
    bodyTop,
    Math.min(
      bottom,
      root.querySelector("tbody")?.getBoundingClientRect().bottom ?? bottom,
    ),
  )
  return {
    left,
    right,
    top,
    bottom,
    bodyTop,
    bodyBottom,
    centerLeft,
    centerRight,
    columns,
  }
}

function speed(position: number, start: number, end: number): number {
  const margin = Math.min(24, (end - start) / 2)
  if (position < start + margin)
    return -Math.min(18, (start + margin - position) / 2)
  if (position > end - margin)
    return Math.min(18, (position - end + margin) / 2)
  return 0
}

export function dragScroll(
  bounds: GridBounds,
  x: number,
  y: number,
  mode: "cells" | "rows" | "columns" | "all",
) {
  const center = bounds.centerRight > bounds.centerLeft
  const inCenter = x >= bounds.centerLeft && x < bounds.centerRight
  const outside = x < bounds.left || x >= bounds.right
  return {
    x:
      mode !== "rows" && center && (inCenter || outside)
        ? speed(x, bounds.centerLeft, bounds.centerRight)
        : 0,
    y:
      mode !== "columns" && bounds.bottom > bounds.bodyTop
        ? speed(y, bounds.bodyTop, bounds.bottom)
        : 0,
  }
}

export function columnAt(bounds: GridBounds, x: number): string | null {
  const center = bounds.centerRight > bounds.centerLeft
  // Outside the viewport, continue through the scrolling region instead of
  // repeatedly hitting the frozen column covering that viewport edge.
  const outside = x < bounds.left || x >= bounds.right
  const inCenter =
    center && (outside || (x >= bounds.centerLeft && x < bounds.centerRight))
  const start = inCenter ? bounds.centerLeft : bounds.left
  const end = inCenter ? bounds.centerRight : bounds.right
  if (end <= start) return null
  const point = Math.max(start, Math.min(x, end - 0.5))
  const candidates = bounds.columns.filter((column) =>
    inCenter ? !column.pinned : Boolean(column.pinned),
  )
  const hit = candidates.find(
    (column) => column.left <= point && column.right > point,
  )
  if (hit?.id) return hit.id
  if (hit?.id === "")
    return bounds.columns.find((column) => column.id)?.id ?? null
  return null
}

export function rowAt(
  root: HTMLElement,
  bounds: GridBounds,
  y: number,
): number | null {
  const rows = root.querySelector<HTMLTableSectionElement>("tbody")?.rows
  if (!rows?.length || bounds.bodyBottom <= bounds.bodyTop) return null
  const point = Math.max(
    bounds.bodyTop + 0.5,
    Math.min(y, bounds.bodyBottom - 0.5),
  )
  let first = 0
  let last = rows.length - 1
  while (first <= last) {
    const index = Math.floor((first + last) / 2)
    const row = rows[index]
    const rect = row.getBoundingClientRect()
    if (point < rect.top) {
      last = index - 1
    } else if (point >= rect.bottom) {
      first = index + 1
    } else {
      const value = row.cells[0]?.dataset.gridRow
      return value === undefined ? null : Number(value)
    }
  }
  return null
}

export function revealDelta(
  start: number,
  end: number,
  visibleStart: number,
  visibleEnd: number,
): number {
  if (visibleEnd <= visibleStart) return 0
  if (start < visibleStart) return start - visibleStart
  if (end > visibleEnd && end - start <= visibleEnd - visibleStart)
    return end - visibleEnd
  if (start >= visibleEnd) return start - visibleStart
  return 0
}
