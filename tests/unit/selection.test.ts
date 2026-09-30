import { expect, test } from "bun:test"
import {
  beginSelection,
  type CellPosition,
  type GridSelection,
  movePosition,
  type SelectionMode,
  updateSelection,
} from "../../src/renderer/components/result-grid/selection"
import {
  selectionPayload,
  serializeTable,
} from "../../src/renderer/components/result-grid/serialize"

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

test("Ctrl adds shared rows or columns, and removes both axes only when the target is fully selected", () => {
  const initial = choose(null, first)
  const sameRow = choose(initial, { row: 0, col: "c" }, ctrl)
  expect(sameRow).toMatchObject({ rows: [0], columns: ["a", "c"] })
  const sameColumn = choose(initial, { row: 2, col: "a" }, ctrl)
  expect(sameColumn).toMatchObject({ rows: [0, 2], columns: ["a"] })
  const added = choose(initial, middle, ctrl)
  expect(added).toMatchObject({
    rows: [0, 2],
    columns: ["a", "c"],
    anchor: middle,
  })
  const removed = choose(added, first, ctrl)
  expect(removed).toMatchObject({
    rows: [2],
    columns: ["c"],
    anchor: first,
    active: first,
  })
  expect(
    selectionPayload(
      [
        { a: 1, b: 2, c: 3 },
        { a: 4, b: 5, c: 6 },
        { a: 7, b: 8, c: 9 },
      ],
      [
        { id: "c", name: "C" },
        { id: "b", name: "B" },
        { id: "a", name: "A" },
      ],
      added,
    ),
  ).toEqual({
    headers: ["C", "A"],
    rows: [
      [3, 1],
      [9, 7],
    ],
  })
})

test("empty areas retain anchor and focus, and Shift can select from the removed position", () => {
  const selected = choose(null, middle)
  const empty = choose(selected, middle, ctrl)
  expect(empty).toMatchObject({
    rows: [],
    columns: [],
    anchor: middle,
    active: middle,
  })
  expect(choose(empty, first, shift)).toMatchObject({
    rows: [0, 1, 2],
    columns: ["a", "b", "c"],
    anchor: middle,
    active: first,
  })
})

test("plain cell clicks replace whole-row and whole-column selections and establish a new anchor", () => {
  for (const mode of ["rows", "columns", "all"] as const) {
    expect(choose(choose(null, last, plain, mode), middle)).toMatchObject({
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
  expect(selected).toMatchObject({
    rows: [0, 1, 2, 3, 4],
    columns: ["e", "c", "a"],
    anchor: last,
    active: first,
  })
  expect(choose(selected, middle, shift).anchor).toEqual(last)
})

test("Ctrl+Shift recomputes additions from a fixed snapshot and does not leave residue when shrinking", () => {
  const base = choose(choose(null, first), middle, ctrl)
  const gesture = beginSelection(base, last, "cells", 5, columns, both)
  if (!gesture) throw new Error("Expected gesture")
  expect(gesture.operation).toBe("add")
  expect(updateSelection(gesture, last)).toMatchObject({
    rows: [0, 2, 3, 4],
    columns: ["a", "c", "d", "e"],
    anchor: middle,
  })
  expect(updateSelection(gesture, { row: 3, col: "d" })).toMatchObject({
    rows: [0, 2, 3],
    columns: ["a", "c", "d"],
  })
  expect(updateSelection(gesture, middle)).toEqual(base)
  expect(base.rows).toEqual([0, 2])
})

test("a removal gesture retains its direction and restores cells when the range shrinks", () => {
  const base = choose(null, first, plain, "all")
  const gesture = beginSelection(base, middle, "cells", 5, columns, both)
  if (!gesture) throw new Error("Expected gesture")
  expect(gesture.operation).toBe("remove")
  expect(updateSelection(gesture, middle)).toMatchObject({
    rows: [3, 4],
    columns: ["d", "e"],
    anchor: first,
    active: middle,
  })
  expect(updateSelection(gesture, { row: 1, col: "b" })).toMatchObject({
    rows: [2, 3, 4],
    columns: ["c", "d", "e"],
  })
  expect(updateSelection(gesture, last)).toMatchObject({
    rows: [],
    columns: [],
    anchor: first,
  })
  expect(updateSelection(gesture, middle)).toMatchObject({
    rows: [3, 4],
    columns: ["d", "e"],
  })
})

test("partially selected header ranges add uniformly; modifier header operations preserve the other axis", () => {
  const base = choose(choose(null, first), middle, ctrl)
  expect(choose(base, { row: 4, col: "c" }, shift, "rows")).toMatchObject({
    rows: [2, 3, 4],
    columns: ["a", "c"],
    anchor: middle,
  })
  expect(choose(base, { row: 2, col: "e" }, shift, "columns")).toMatchObject({
    rows: [0, 2],
    columns: ["c", "d", "e"],
    anchor: middle,
  })
  expect(choose(base, { row: 1, col: "c" }, both, "rows")).toMatchObject({
    rows: [0, 2, 1],
    columns: ["a", "c"],
    anchor: middle,
  })
  const removed = choose(base, first, ctrl, "rows")
  expect(removed).toMatchObject({
    rows: [2],
    columns: ["a", "c"],
    anchor: first,
    active: first,
  })
  expect(choose(base, first, ctrl, "columns")).toMatchObject({
    rows: [0, 2],
    columns: ["c"],
  })
})

test("Ctrl drags lock the initial add/remove decision even after crossing selected boundaries", () => {
  const base = choose(choose(null, first), middle, ctrl)
  const gesture = beginSelection(base, first, "rows", 5, columns, ctrl)
  if (!gesture) throw new Error("Expected gesture")
  expect(gesture.operation).toBe("remove")
  expect(updateSelection(gesture, middle)).toMatchObject({
    rows: [],
    columns: [],
    anchor: first,
  })
  expect(updateSelection(gesture, first)).toMatchObject({
    rows: [2],
    columns: ["a", "c"],
  })
})

test("empty results cannot create a gesture, but a missing anchor falls back to the clicked point", () => {
  expect(beginSelection(null, first, "all", 0, columns, plain)).toBeNull()
  expect(beginSelection(null, first, "all", 5, [], plain)).toBeNull()
  expect(choose(null, middle, both)).toMatchObject({
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
  expect(removed.toggle).toEqual({
    rows: [0, 1, 2, 3, 4],
    columns,
    mode: "cells",
    operation: "remove",
  })
  const expanded = choose(removed, last, both)
  expect(expanded).toMatchObject({
    rows: [0, 1],
    columns: ["a", "b"],
    anchor: middle,
  })
  const shrunk = choose(expanded, { row: 3, col: "d" }, both)
  expect(shrunk).toMatchObject({
    rows: [0, 1, 4],
    columns: ["a", "b", "e"],
    anchor: middle,
  })
  expect(choose(shrunk, middle, both)).toEqual(removed)
  expect(expanded.toggle).toEqual(removed.toggle)
  expect(initial.rows).toEqual([0, 1, 2, 3, 4])
})

test("separate Ctrl+Shift gestures continue additions even when the new range is already selected", () => {
  const added = choose(choose(null, first), middle, ctrl)
  expect(added.toggle).toEqual({
    rows: [0],
    columns: ["a"],
    mode: "cells",
    operation: "add",
  })
  const expanded = choose(added, last, both)
  const shrunk = choose(expanded, { row: 3, col: "d" }, both)
  expect(shrunk).toMatchObject({
    rows: [0, 2, 3],
    columns: ["a", "c", "d"],
    anchor: middle,
  })
  expect(choose(shrunk, middle, both)).toEqual(added)
})

test.each(["rows", "columns"] as const)(
  "Ctrl+Shift continues a %s removal without changing the other axis",
  (mode) => {
    const initial = choose(null, first, plain, "all")
    const removed = choose(initial, middle, ctrl, mode)
    const expanded = choose(removed, last, both, mode)
    expect(expanded.rows).toEqual(mode === "rows" ? [0, 1] : initial.rows)
    expect(expanded.columns).toEqual(mode === "columns" ? ["a", "b"] : columns)
    expect(choose(expanded, middle, both, mode)).toEqual(removed)
  },
)

test("an empty result of removal retains its original snapshot across later extensions", () => {
  const removed = choose(choose(null, middle), middle, ctrl)
  const expanded = choose(removed, last, both)
  expect(expanded).toMatchObject({ rows: [], columns: [], anchor: middle })
  expect(expanded.toggle).toEqual(removed.toggle)
  expect(choose(expanded, middle, both)).toEqual(removed)
})

test("new selections terminate or replace toggle history, and changing axes starts a new operation", () => {
  const removed = choose(choose(null, first, plain, "all"), middle, ctrl)
  expect(choose(removed, last).toggle).toBeNull()
  expect(choose(removed, last, shift).toggle).toBeNull()
  const restarted = choose(removed, middle, ctrl)
  expect(restarted.toggle).toMatchObject({
    operation: "add",
    rows: [0, 1, 3, 4],
    columns: ["a", "b", "d", "e"],
  })
  const rows = choose(removed, last, both, "rows")
  expect(rows.toggle).toMatchObject({
    mode: "rows",
    operation: "add",
    rows: [0, 1, 3, 4],
  })
})

test("JSON preserves duplicate column labels and serializes actual values without precision loss", () => {
  const bytes = new Uint8Array([0, 10, 255, 99]).subarray(1, 3)
  const text = serializeTable(
    {
      headers: ["value", "value", "json", "date", "null"],
      rows: [
        [
          9007199254740993n,
          bytes,
          { amount: 9007199254740993n, ok: true },
          new Date("2026-09-30T00:00:00Z"),
          null,
        ],
      ],
    },
    { format: "json", headers: false },
  )
  expect(JSON.parse(text)).toEqual({
    columns: ["value", "value", "json", "date", "null"],
    rows: [
      [
        "9007199254740993",
        "0x0aff",
        { amount: "9007199254740993", ok: true },
        "2026-09-30T00:00:00.000Z",
        null,
      ],
    ],
  })
})

test("delimited copy respects header preferences and distinguishes NULL from literal text", () => {
  const payload = {
    headers: ["a", "b", "c"],
    rows: [[null, "NULL", new Uint8Array([0, 255])]],
  }
  expect(serializeTable(payload, { format: "csv", headers: false })).toBe(
    'NULL,"NULL",0x00ff',
  )
  expect(serializeTable(payload, { format: "tsv", headers: true })).toBe(
    'a\tb\tc\nNULL\t"NULL"\t0x00ff',
  )
})
