import type { GridSelection } from "./selection"

export interface CopyOptions {
  format: "tsv" | "csv" | "json"
  headers: boolean
}

export interface TablePayload {
  headers: string[]
  rows: unknown[][]
}

export function selectionPayload(
  data: Record<string, unknown>[],
  columns: { id: string; name: string }[],
  selection: GridSelection,
): TablePayload {
  const rowSet = new Set(selection.rows)
  const colSet = new Set(selection.columns)
  const selected = columns.filter((column) => colSet.has(column.id))
  return {
    headers: selected.map((column) => column.name),
    rows: data
      .filter((_, i) => rowSet.has(i))
      .map((row) => selected.map((column) => row[column.id])),
  }
}

function normalize(value: unknown): unknown {
  if (value === undefined) return null
  if (typeof value === "bigint") return String(value)
  if (typeof value === "number" && !Number.isFinite(value)) return String(value)
  if (value instanceof Date) return value.toISOString()
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes =
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`
  }
  if (Array.isArray(value)) return value.map(normalize)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalize(entry)]),
    )
  }
  return value
}

export function serializeTable(
  payload: TablePayload,
  options: CopyOptions,
): string {
  const rows = payload.rows.map((row) => row.map(normalize))
  if (options.format === "json") {
    return JSON.stringify({ columns: payload.headers, rows }, null, 2)
  }
  const delimiter = options.format === "csv" ? "," : "\t"
  const matrix = options.headers ? [payload.headers, ...rows] : rows
  return matrix
    .map((row) =>
      row
        .map((value) => {
          if (value === null) return "NULL"
          const text =
            typeof value === "object" ? JSON.stringify(value) : String(value)
          const quote =
            text === "NULL" || text.includes(delimiter) || /["\r\n]/.test(text)
          return quote ? `"${text.replaceAll('"', '""')}"` : text
        })
        .join(delimiter),
    )
    .join("\n")
}
