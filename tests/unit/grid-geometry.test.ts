import { expect, test } from "bun:test"
import {
  columnAt,
  dragScroll,
  type GridBounds,
  measureGrid,
  revealDelta,
  rowAt,
} from "../../src/renderer/components/result-grid/geometry"
import {
  beginSelection,
  updateSelection,
} from "../../src/renderer/components/result-grid/selection"

const bounds: GridBounds = {
  left: 100,
  right: 900,
  top: 50,
  bottom: 550,
  bodyTop: 98,
  bodyBottom: 550,
  centerLeft: 300,
  centerRight: 800,
  columns: [
    { id: "", left: 100, right: 150, pinned: "start" },
    { id: "a", left: 150, right: 300, pinned: "start" },
    { id: "b", left: 100, right: 400, pinned: undefined },
    { id: "c", left: 400, right: 650, pinned: undefined },
    { id: "d", left: 650, right: 850, pinned: undefined },
    { id: "e", left: 800, right: 900, pinned: "end" },
  ],
}

function rowRoot(offset = 0): HTMLElement {
  const edges = [98, 130, 174, 206]
  return {
    querySelector: () => ({
      rows: edges.slice(0, -1).map((top, index) => ({
        cells: [{ dataset: { gridRow: String(index) } }],
        getBoundingClientRect: () => ({
          top: top - offset,
          bottom: edges[index + 1] - offset,
        }),
      })),
    }),
  } as unknown as HTMLElement
}

test("vertical dragging resolves actual row bounds independently of horizontal hit testing", () => {
  const root = rowRoot()
  const area = { ...bounds, bodyBottom: 206 }
  expect(rowAt(root, area, 110)).toBe(0)
  expect(rowAt(root, area, 130)).toBe(1)
  expect(rowAt(root, area, 175)).toBe(2)
  expect(rowAt(root, area, 20)).toBe(0)
  expect(rowAt(root, area, 500)).toBe(2)

  const start = { row: 0, col: "a" }
  for (const mode of ["cells", "rows"] as const) {
    const gesture = beginSelection(
      null,
      start,
      mode,
      3,
      ["a", "b", "c", "d", "e"],
      { shift: false, ctrl: false },
    )
    const row = rowAt(root, area, 190)
    const col = mode === "rows" ? start.col : columnAt(area, 700)
    if (!gesture || row === null || col === null)
      throw new Error("Expected drag target")
    const selected = updateSelection(gesture, { row, col })
    expect(selected.rows).toEqual([0, 1, 2])
    expect(selected.columns).toEqual(
      mode === "rows" ? ["a", "b", "c", "d", "e"] : ["a", "b", "c", "d"],
    )
    expect(updateSelection(gesture, { row: 0, col: "a" }).rows).toEqual([0])
  }
})

test("row hit testing follows vertical scrolling and skips rows covered by the sticky header", () => {
  const area = { ...bounds, bodyBottom: 166 }
  expect(rowAt(rowRoot(40), area, 20)).toBe(1)
  expect(rowAt(rowRoot(40), area, 140)).toBe(2)
  expect(rowAt(rowRoot(40), area, 500)).toBe(2)
  expect(
    rowAt(rowRoot(), { ...area, bodyBottom: area.bodyTop }, 100),
  ).toBeNull()
})

test("frozen regions hit frozen columns, while the middle ignores covered columns", () => {
  expect(columnAt(bounds, 250)).toBe("a")
  expect(columnAt(bounds, 310)).toBe("b")
  expect(columnAt(bounds, 400)).toBe("c")
  expect(columnAt(bounds, 790)).toBe("d")
  expect(columnAt(bounds, 850)).toBe("e")
  expect(columnAt(bounds, 120)).toBe("a")
})

test("outside drags continue through scrolling columns instead of sticking to frozen edges", () => {
  expect(columnAt(bounds, 50)).toBe("b")
  expect(columnAt(bounds, 950)).toBe("d")
  const scrolled = {
    ...bounds,
    columns: bounds.columns.map((col) =>
      col.pinned
        ? col
        : { ...col, left: col.left - 100, right: col.right - 100 },
    ),
  }
  expect(columnAt(scrolled, 50)).toBe("c")
  expect(columnAt(scrolled, 250)).toBe("a")
  expect(columnAt(scrolled, 850)).toBe("e")
})

test("horizontal auto-scroll starts at middle-region edges and never under frozen columns", () => {
  expect(dragScroll(bounds, 295, 300, "cells").x).toBe(0)
  expect(dragScroll(bounds, 305, 300, "cells").x).toBeLessThan(0)
  expect(dragScroll(bounds, 795, 300, "cells").x).toBeGreaterThan(0)
  expect(dragScroll(bounds, 805, 300, "cells").x).toBe(0)
  expect(dragScroll(bounds, 950, 300, "cells").x).toBeGreaterThan(0)
  expect(dragScroll(bounds, 50, 300, "cells").x).toBeLessThan(0)
  expect(dragScroll(bounds, 500, 300, "cells")).toEqual({ x: 0, y: 0 })
})

test("row and column gestures scroll only their own axis, using measured header height", () => {
  expect(dragScroll(bounds, 305, 105, "rows")).toEqual({ x: 0, y: -8.5 })
  expect(dragScroll(bounds, 795, 540, "columns")).toEqual({ x: 9.5, y: 0 })
  expect(dragScroll(bounds, 500, 130, "cells").y).toBe(0)
})

test("keyboard reveal uses the unobscured viewport and does not oscillate for oversized cells", () => {
  expect(revealDelta(220, 400, 300, 800)).toBe(-80)
  expect(revealDelta(650, 850, 300, 800)).toBe(50)
  expect(revealDelta(400, 650, 300, 800)).toBe(0)
  expect(revealDelta(300, 1000, 300, 800)).toBe(0)
  expect(revealDelta(900, 1600, 300, 800)).toBe(600)
  expect(revealDelta(70, 110, 98, 550)).toBe(-28)
})

test("a fully covered middle region cannot scroll or reveal a hidden ordinary column", () => {
  const covered = { ...bounds, centerLeft: 800, centerRight: 800 }
  expect(dragScroll(covered, 950, 300, "cells").x).toBe(0)
  expect(revealDelta(100, 300, 800, 800)).toBe(0)
})

test("measurement excludes borders and scrollbars and follows actual frozen sizes and header height", () => {
  const headers = bounds.columns.map((column) => ({
    dataset: { gridCol: column.id, gridPin: column.pinned },
    getBoundingClientRect: () => ({
      left: column.left,
      right: column.right,
      bottom: 98,
    }),
  }))
  const root = {
    clientLeft: 2,
    clientTop: 2,
    clientWidth: 800,
    clientHeight: 500,
    getBoundingClientRect: () => ({
      left: 98,
      top: 48,
      right: 917,
      bottom: 567,
    }),
    querySelectorAll: () => headers,
    querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 400 }) }),
  } as unknown as HTMLElement
  expect(measureGrid(root)).toEqual({ ...bounds, bodyBottom: 400 })
})
