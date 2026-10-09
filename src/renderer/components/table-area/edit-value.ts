import type { QueryResultColumn } from "@/core/database"

export function editText(
  value: unknown,
  column?: QueryResultColumn,
  draft = false,
): string {
  if (value === null || value === undefined) return ""
  if (column?.typeFamily === "json")
    return draft && typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2)
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes =
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "object") return JSON.stringify(value, null, 2)
  return String(value)
}
export function parseEdit(
  text: string,
  column: QueryResultColumn,
  original: unknown,
  draft = false,
): unknown {
  if (text === editText(original, column, draft)) return original
  switch (column.typeFamily) {
    case "boolean":
      if (text === "true" || text === "1")
        return typeof original === "number"
          ? 1
          : typeof original === "string"
            ? text
            : true
      if (text === "false" || text === "0")
        return typeof original === "number"
          ? 0
          : typeof original === "string"
            ? text
            : false
      throw new Error("请输入 true 或 false")
    case "number":
    case "decimal": {
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text))
        throw new Error("请输入有效数字")
      if (
        column.typeFamily === "decimal" ||
        typeof original === "string" ||
        typeof original === "bigint"
      )
        return text
      const value = Number(text)
      if (!Number.isFinite(value)) throw new Error("数字超出范围")
      return Number.isInteger(value) && !Number.isSafeInteger(value)
        ? text
        : value
    }
    case "json":
      try {
        JSON.parse(text)
        return text
      } catch {
        throw new Error("请输入有效 JSON")
      }
    case "array": {
      if (column.driver === "postgres" && typeof original === "string")
        return text
      let value: unknown
      try {
        value = JSON.parse(text)
      } catch {
        throw new Error("请使用 JSON 数组格式")
      }
      if (!Array.isArray(value)) throw new Error("请输入数组")
      return value
    }
    case "binary": {
      const hex = text.replace(/\s/g, "")
      if (!/^(?:[0-9a-f]{2})*$/i.test(hex))
        throw new Error("请使用完整的十六进制字节，例如 00ff")
      return Uint8Array.from(hex.match(/../g) ?? [], (byte) =>
        Number.parseInt(byte, 16),
      )
    }
    case "unknown":
      if (original !== null && typeof original === "object") {
        try {
          return JSON.parse(text)
        } catch {
          throw new Error("请输入有效 JSON")
        }
      }
      return text
    default:
      return text
  }
}
