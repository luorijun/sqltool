import { expect, test } from "bun:test"
import {
  getQueryColumnTypeLabel,
  serializeMatrixAsDelimitedText,
  serializeValuesAsDelimitedText,
} from "../../src/renderer/components/result-grid/format"

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
    serializeMatrixAsDelimitedText(
      ["a,b", "value"],
      [
        ['a"b', "line\r\nbreak"],
        [null, 9007199254740993n],
      ],
      ",",
    ),
  ).toBe('"a,b",value\n"a""b","line\r\nbreak"\nNULL,9007199254740993')
})

test("TSV preserves tabs and distinguishes empty text from NULL", () => {
  expect(serializeValuesAsDelimitedText(["a\tb", "", null, false])).toBe(
    '"a\tb"\t\tNULL\tfalse',
  )
})
