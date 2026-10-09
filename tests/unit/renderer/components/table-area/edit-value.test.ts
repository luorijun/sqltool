import { expect, test } from "bun:test"
import type { QueryResultColumn } from "@/core/database"
import {
  editText,
  parseEdit,
} from "@/renderer/components/table-area/edit-value"

const column = (
  typeFamily: QueryResultColumn["typeFamily"],
): QueryResultColumn => ({ id: "c", name: "c", typeFamily })
test("edits preserve NULL text, integer and decimal precision, JSON null, arrays and binary slices", () => {
  expect(parseEdit("NULL", column("string"), null)).toBe("NULL")
  expect(parseEdit("", column("string"), "old")).toBe("")
  expect(parseEdit("9007199254740993", column("number"), 1)).toBe(
    "9007199254740993",
  )
  expect(
    parseEdit("9007199254740995", column("number"), "9007199254740993"),
  ).toBe("9007199254740995")
  expect(parseEdit("12345678901234567890.1234", column("decimal"), "0")).toBe(
    "12345678901234567890.1234",
  )
  expect(parseEdit("false", column("boolean"), true)).toBe(false)
  expect(parseEdit("null", column("json"), {})).toBe("null")
  expect(parseEdit('[1,null,{"x":2}]', column("array"), [])).toEqual([
    1,
    null,
    { x: 2 },
  ])
  const bytes = new Uint8Array([10, 20, 30]).subarray(1, 2)
  expect(editText(bytes)).toBe("14")
  expect(parseEdit("00 ff", column("binary"), bytes)).toEqual(
    new Uint8Array([0, 255]),
  )
  expect(parseEdit("0001-01-01", column("date"), "2025-01-01")).toBe(
    "0001-01-01",
  )
})
test("unchanged values retain their raw representation and invalid conversions cannot be applied", () => {
  const date = new Date("2025-01-02T03:04:05Z")
  expect(parseEdit(editText(date), column("datetime"), date)).toBe(date)
  expect(parseEdit("1", column("boolean"), 1)).toBe(1)
  expect(() => parseEdit("", column("number"), 1)).toThrow("有效数字")
  expect(() => parseEdit("{}", column("array"), [])).toThrow("数组")
  expect(() => parseEdit("{", column("json"), {})).toThrow("JSON")
  expect(() => parseEdit("f", column("binary"), new Uint8Array())).toThrow(
    "十六进制",
  )
})

test("JSON drafts reopen as JSON text while database JSON strings retain their quotes", () => {
  const json = column("json")
  const text = '{"id":9007199254740993,"name":"edited"}'
  const draft = parseEdit(text, json, {})
  expect(editText(draft, json, true)).toBe(text)
  expect(parseEdit(text, json, draft, true)).toBe(draft)
  expect(editText("hello", json)).toBe('"hello"')
  expect(editText(parseEdit("null", json, {}), json, true)).toBe("null")
  expect(parseEdit('"hello"', json, "hello")).toBe("hello")
})

test("PostgreSQL temporal arrays preserve database text and microsecond precision", () => {
  const array = { ...column("array"), driver: "postgres" as const }
  const before = '{"2026-10-09 12:34:56.123456+08",NULL}'
  const after = '{"2026-10-09 12:34:56.654321+08",NULL}'
  expect(editText(before, array)).toBe(before)
  expect(parseEdit(after, array, before)).toBe(after)
  expect(
    parseEdit("2026-10-09 12:34:56.654321+08", column("datetime"), "before"),
  ).toBe("2026-10-09 12:34:56.654321+08")
})
