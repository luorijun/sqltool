import { expect, test } from "bun:test"
import { getQueryColumnTypeLabel } from "../../src/renderer/components/result-grid/format"

import { serializeTable } from "../../src/renderer/components/result-grid/serialize"

test("type labels preserve database names and make missing metadata explicit", () => {
  expect(getQueryColumnTypeLabel({ dbType: 'public."Mixed Case"[]' })).toBe(
    'public."Mixed Case"[]',
  )
  expect(getQueryColumnTypeLabel({ dbType: "numeric(3,-1)" })).toBe(
    "numeric(3,-1)",
  )
  expect(getQueryColumnTypeLabel({ driver: "postgres", typeCode: 12345 })).toBe(
    "未知类型 (postgres:12345)",
  )
})

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
