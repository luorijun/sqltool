import { expect, test } from "bun:test"
import {
  beginSelection,
  type CellPosition,
  type GridSelection,
  movePosition,
  type SelectionMode,
  updateSelection,
} from "@/renderer/components/table-area/selection"

const columns = ["a", "b", "c", "d", "e"]
const first = { row: 0, col: "a" }
const middle = { row: 2, col: "c" }
const last = { row: 4, col: "e" }
const plain = { shift: false, ctrl: false }
const ctrl = { shift: false, ctrl: true }
const shift = { shift: true, ctrl: false }
const both = { shift: true, ctrl: true }
function choose(
  current: GridSelection | null,
  point: CellPosition,
  modifiers = plain,
  mode: SelectionMode = "cells",
) {
  const gesture = beginSelection(current, point, mode, 5, columns, modifiers)
  if (!gesture) throw new Error("Expected gesture")
  return updateSelection(gesture, point)
}

function expectArea(
  actual: GridSelection,
  expected: Partial<
    Pick<GridSelection, "rows" | "columns" | "anchor" | "active">
  >,
) {
  if (expected.rows)
    expect(new Set(actual.rows)).toEqual(new Set(expected.rows))
  if (expected.columns)
    expect(new Set(actual.columns)).toEqual(new Set(expected.columns))
  if (expected.anchor) expect(actual.anchor).toEqual(expected.anchor)
  if (expected.active) expect(actual.active).toEqual(expected.active)
}

test("Ctrl adds shared rows or columns, and removes both axes only when the target is fully selected", () => {
  const initial = choose(null, first)
  const sameRow = choose(initial, { row: 0, col: "c" }, ctrl)
  expectArea(sameRow, { rows: [0], columns: ["a", "c"] })
  const sameColumn = choose(initial, { row: 2, col: "a" }, ctrl)
  expectArea(sameColumn, { rows: [0, 2], columns: ["a"] })
  const added = choose(initial, middle, ctrl)
  expectArea(added, {
    rows: [0, 2],
    columns: ["a", "c"],
    anchor: middle,
  })
  const removed = choose(added, first, ctrl)
  expectArea(removed, {
    rows: [2],
    columns: ["c"],
    anchor: first,
    active: first,
  })
})

test("empty areas retain anchor and focus, and Shift can select from the removed position", () => {
  const selected = choose(null, middle)
  const empty = choose(selected, middle, ctrl)
  expectArea(empty, {
    rows: [],
    columns: [],
    anchor: middle,
    active: middle,
  })
  expectArea(choose(empty, first, shift), {
    rows: [0, 1, 2],
    columns: ["a", "b", "c"],
    anchor: middle,
    active: first,
  })
})

test("plain cell clicks replace whole-row and whole-column selections and establish a new anchor", () => {
  for (const mode of ["rows", "columns", "all"] as const) {
    expectArea(choose(choose(null, last, plain, mode), middle), {
      rows: [2],
      columns: ["c"],
      anchor: middle,
      active: middle,
    })
  }
})

test("Shift keeps the anchor; reverse drags follow the displayed column order", () => {
  const gesture = beginSelection(
    null,
    last,
    "cells",
    5,
    ["e", "c", "a", "b", "d"],
    plain,
  )
  if (!gesture) throw new Error("Expected gesture")
  const selected = updateSelection(gesture, first)
  expectArea(selected, {
    rows: [0, 1, 2, 3, 4],
    columns: ["e", "c", "a"],
    anchor: last,
    active: first,
  })
  expect(choose(selected, middle, shift).anchor).toEqual(last)
})

test("Ctrl+Shift extends additions and does not leave residue when shrinking", () => {
  const base = choose(choose(null, first), middle, ctrl)
  const gesture = beginSelection(base, last, "cells", 5, columns, both)
  if (!gesture) throw new Error("Expected gesture")
  expectArea(updateSelection(gesture, last), {
    rows: [0, 2, 3, 4],
    columns: ["a", "c", "d", "e"],
    anchor: middle,
  })
  expectArea(updateSelection(gesture, { row: 3, col: "d" }), {
    rows: [0, 2, 3],
    columns: ["a", "c", "d"],
  })
  expectArea(updateSelection(gesture, middle), base)
})

test("a removal gesture retains its direction and restores cells when the range shrinks", () => {
  const base = choose(null, first, plain, "all")
  const gesture = beginSelection(base, middle, "cells", 5, columns, both)
  if (!gesture) throw new Error("Expected gesture")
  expectArea(updateSelection(gesture, middle), {
    rows: [3, 4],
    columns: ["d", "e"],
    anchor: first,
    active: middle,
  })
  expectArea(updateSelection(gesture, { row: 1, col: "b" }), {
    rows: [2, 3, 4],
    columns: ["c", "d", "e"],
  })
  expectArea(updateSelection(gesture, last), {
    rows: [],
    columns: [],
    anchor: first,
  })
  expectArea(updateSelection(gesture, middle), {
    rows: [3, 4],
    columns: ["d", "e"],
  })
})

test("partially selected header ranges add uniformly; modifier header operations preserve the other axis", () => {
  const base = choose(choose(null, first), middle, ctrl)
  expectArea(choose(base, { row: 4, col: "c" }, shift, "rows"), {
    rows: [2, 3, 4],
    columns: ["a", "c"],
    anchor: middle,
  })
  expectArea(choose(base, { row: 2, col: "e" }, shift, "columns"), {
    rows: [0, 2],
    columns: ["c", "d", "e"],
    anchor: middle,
  })
  expectArea(choose(base, { row: 1, col: "c" }, both, "rows"), {
    rows: [0, 2, 1],
    columns: ["a", "c"],
    anchor: middle,
  })
  const removed = choose(base, first, ctrl, "rows")
  expectArea(removed, {
    rows: [2],
    columns: ["a", "c"],
    anchor: first,
    active: first,
  })
  expectArea(choose(base, first, ctrl, "columns"), {
    rows: [0, 2],
    columns: ["c"],
  })
})

test("Ctrl drags lock the initial add/remove decision even after crossing selected boundaries", () => {
  const base = choose(choose(null, first), middle, ctrl)
  const gesture = beginSelection(base, first, "rows", 5, columns, ctrl)
  if (!gesture) throw new Error("Expected gesture")
  expectArea(updateSelection(gesture, middle), {
    rows: [],
    columns: [],
    anchor: first,
  })
  expectArea(updateSelection(gesture, first), {
    rows: [2],
    columns: ["a", "c"],
  })
})

test("empty results cannot create a gesture, but a missing anchor falls back to the clicked point", () => {
  expect(beginSelection(null, first, "all", 0, columns, plain)).toBeNull()
  expect(beginSelection(null, first, "all", 5, [], plain)).toBeNull()
  expectArea(choose(null, middle, both), {
    rows: [2],
    columns: ["c"],
    anchor: middle,
    active: middle,
  })
})

test("keyboard positions respect visible ordering and Ctrl jumps to loaded boundaries", () => {
  expect(
    movePosition(undefined, { row: 1, col: 0 }, 5, columns, false),
  ).toEqual(first)
  expect(movePosition(first, { row: -1, col: -1 }, 5, columns, false)).toEqual(
    first,
  )
  expect(movePosition(middle, { row: 0, col: 1 }, 5, columns, true)).toEqual({
    row: 2,
    col: "e",
  })
  expect(movePosition(middle, { row: -1, col: 0 }, 5, columns, true)).toEqual({
    row: 0,
    col: "c",
  })
  expect(
    movePosition(
      { row: 0, col: "e" },
      { row: 0, col: 1 },
      5,
      ["e", "a", "c"],
      false,
    ),
  ).toEqual(first)
})

test("separate Ctrl+Shift gestures continue a Ctrl removal and restore the original selection when shrinking", () => {
  const initial = choose(null, first, plain, "all")
  const removed = choose(initial, middle, ctrl)
  const expanded = choose(removed, last, both)
  expectArea(expanded, {
    rows: [0, 1],
    columns: ["a", "b"],
    anchor: middle,
  })
  const shrunk = choose(expanded, { row: 3, col: "d" }, both)
  expectArea(shrunk, {
    rows: [0, 1, 4],
    columns: ["a", "b", "e"],
    anchor: middle,
  })
  expectArea(choose(shrunk, middle, both), removed)
})

test("separate Ctrl+Shift gestures continue additions even when the new range is already selected", () => {
  const added = choose(choose(null, first), middle, ctrl)
  const expanded = choose(added, last, both)
  const shrunk = choose(expanded, { row: 3, col: "d" }, both)
  expectArea(shrunk, {
    rows: [0, 2, 3],
    columns: ["a", "c", "d"],
    anchor: middle,
  })
  expectArea(choose(shrunk, middle, both), added)
})

test.each(["rows", "columns"] as const)(
  "Ctrl+Shift continues a %s removal without changing the other axis",
  (mode) => {
    const initial = choose(null, first, plain, "all")
    const removed = choose(initial, middle, ctrl, mode)
    const expanded = choose(removed, last, both, mode)
    expect(new Set(expanded.rows)).toEqual(
      new Set(mode === "rows" ? [0, 1] : initial.rows),
    )
    expect(new Set(expanded.columns)).toEqual(
      new Set(mode === "columns" ? ["a", "b"] : columns),
    )
    expectArea(choose(expanded, middle, both, mode), removed)
  },
)

test("an empty result of removal stays empty across later extensions", () => {
  const removed = choose(choose(null, middle), middle, ctrl)
  const expanded = choose(removed, last, both)
  expectArea(expanded, { rows: [], columns: [], anchor: middle })
  expectArea(choose(expanded, middle, both), removed)
})

test("new selections replace previous ranges, and changing axes starts a new operation", () => {
  const removed = choose(choose(null, first, plain, "all"), middle, ctrl)
  expectArea(choose(removed, last), {
    rows: [4],
    columns: ["e"],
    anchor: last,
    active: last,
  })
  expectArea(choose(removed, last, shift), {
    rows: [2, 3, 4],
    columns: ["c", "d", "e"],
    anchor: middle,
    active: last,
  })
  expectArea(choose(removed, middle, ctrl), {
    rows: [0, 1, 2, 3, 4],
    columns,
    anchor: middle,
    active: middle,
  })
  expectArea(choose(removed, last, both, "rows"), {
    rows: [0, 1, 2, 3, 4],
    columns: ["a", "b", "d", "e"],
    anchor: middle,
    active: last,
  })
})
