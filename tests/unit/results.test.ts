import { expect, test } from "bun:test"
import {
  serializeMatrixAsDelimitedText,
  serializeValuesAsDelimitedText,
} from "../../src/renderer/components/result-grid/format"

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
