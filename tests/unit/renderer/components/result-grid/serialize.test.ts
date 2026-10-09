import { expect, test } from "bun:test"
import {
  selectionPayload,
  serializeTable,
} from "@/renderer/components/result-grid/serialize"

test("CSV escapes headers, delimiters, quotes and line breaks without losing values", () => {
  expect(
    serializeTable(
      {
        headers: ["a,b", "value"],
        rows: [
          ['a"b', "line\r\nbreak"],
          [null, 9007199254740993n],
        ],
      },
      { format: "csv", headers: true },
    ),
  ).toBe('"a,b",value\n"a""b","line\r\nbreak"\nNULL,9007199254740993')
})

test("TSV preserves tabs and distinguishes empty text from NULL", () => {
  expect(
    serializeTable(
      { headers: [], rows: [["a\tb", "", null, false]] },
      { format: "tsv", headers: false },
    ),
  ).toBe('"a\tb"\t\tNULL\tfalse')
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

test("selection copy uses displayed column and server row order", () => {
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
      {
        rows: [0, 2],
        columns: ["a", "c"],
        anchor: { row: 2, col: "c" },
        active: { row: 2, col: "c" },
        toggle: null,
      },
    ),
  ).toEqual({
    headers: ["C", "A"],
    rows: [
      [3, 1],
      [9, 7],
    ],
  })
})
