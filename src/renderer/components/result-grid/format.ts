import type { DbDriver, QueryResultColumn } from "@/contracts/database"

export function getColumnTypeLabel(type: string, driver?: DbDriver): string {
  const label = type.trim()
  if (driver !== "postgres") return label
  return label.replace(
    /^timestamp(\(\d+\))? with time zone((?:\[\])*)$/,
    "timestamptz$1$2",
  )
}

export function getQueryColumnTypeLabel(
  column?: Pick<QueryResultColumn, "dbType" | "driver" | "typeCode">,
): string | undefined {
  const dbType = column?.dbType?.trim()
  if (dbType) {
    return getColumnTypeLabel(dbType, column?.driver)
  }

  if (column?.typeCode !== undefined) {
    return column.driver
      ? `未知类型 (${column.driver}:${column.typeCode})`
      : `未知类型 (${column.typeCode})`
  }

  return undefined
}

export function getQueryColumnSourceLabel(
  column?: Pick<
    QueryResultColumn,
    "schema" | "table" | "sourceColumn" | "name"
  >,
): string | undefined {
  if (!column) {
    return undefined
  }

  const parts = [column.schema, column.table, column.sourceColumn].filter(
    Boolean,
  )
  if (parts.length === 0) {
    return undefined
  }

  const source = parts.join(".")
  return source === column.name ? undefined : source
}

export function getQueryColumnHeaderTitle(column: QueryResultColumn): string {
  const lines = [column.name]
  const typeLabel = getQueryColumnTypeLabel(column)
  const sourceLabel = getQueryColumnSourceLabel(column)
  const flags = getQueryColumnFlagLabels(column)

  if (typeLabel) {
    lines.push(`类型: ${typeLabel}`)
  }

  if (sourceLabel) {
    lines.push(`来源: ${sourceLabel}`)
  }

  if (column.nullable !== undefined) {
    lines.push(column.nullable ? "允许 NULL" : "NOT NULL")
  }

  if (flags.length > 0) {
    lines.push(flags.join(" · "))
  }

  return lines.join("\n")
}

export function getQueryColumnFlagLabels(
  column?: Pick<QueryResultColumn, "primaryKey" | "autoIncrement" | "unsigned">,
): string[] {
  const labels: string[] = []

  if (column?.primaryKey) {
    labels.push("PK")
  }

  if (column?.autoIncrement) {
    labels.push("AUTO")
  }

  if (column?.unsigned) {
    labels.push("UNSIGNED")
  }

  return labels
}

export function isQueryColumnRightAligned(column?: QueryResultColumn): boolean {
  const family = column?.typeFamily
  return family === "number" || family === "decimal"
}

export interface QueryValueDisplay {
  kind:
    | "null"
    | "boolean"
    | "number"
    | "date"
    | "json"
    | "binary"
    | "string"
    | "empty"
  text: string
}

function stringifyJsonValue(value: unknown): string {
  try {
    const text = JSON.stringify(value)
    return text ?? String(value)
  } catch {
    return String(value)
  }
}

function isBinaryValue(value: unknown): value is ArrayBuffer | ArrayBufferView {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value)
}

function getBinaryLength(value: ArrayBuffer | ArrayBufferView): number {
  return value instanceof ArrayBuffer ? value.byteLength : value.byteLength
}

function serializeBinaryValue(value: ArrayBuffer | ArrayBufferView): string {
  return `<binary ${getBinaryLength(value)} bytes>`
}

function normalizeBooleanText(value: unknown): string | undefined {
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }

  if (typeof value === "number") {
    if (value === 1) return "true"
    if (value === 0) return "false"
  }

  if (typeof value === "bigint") {
    if (value === 1n) return "true"
    if (value === 0n) return "false"
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (["true", "t", "yes", "y", "1"].includes(normalized)) {
      return "true"
    }
    if (["false", "f", "no", "n", "0"].includes(normalized)) {
      return "false"
    }
  }

  return undefined
}

function formatTemporalValue(
  value: unknown,
  column?: QueryResultColumn,
): string {
  const family = column?.typeFamily

  if (value instanceof Date) {
    const iso = value.toISOString()
    if (family === "date") {
      return iso.slice(0, 10)
    }
    if (family === "time") {
      return iso.slice(11, 23)
    }
    return iso
  }

  return serializeQueryValue(value)
}

export function serializeQueryValue(
  value: unknown,
  column?: QueryResultColumn,
): string {
  if (value === null) {
    return "NULL"
  }

  if (value === undefined) {
    return ""
  }

  const family = column?.typeFamily
  if (family === "binary" && isBinaryValue(value)) {
    return serializeBinaryValue(value)
  }

  if (isBinaryValue(value)) {
    return serializeBinaryValue(value)
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value)
  }

  return stringifyJsonValue(value)
}

export function getQueryValueDisplay(
  value: unknown,
  column?: QueryResultColumn,
): QueryValueDisplay {
  if (value === null) {
    return { kind: "null", text: "NULL" }
  }

  if (value === undefined) {
    return { kind: "empty", text: "" }
  }

  const family = column?.typeFamily

  if (family === "binary" && isBinaryValue(value)) {
    return { kind: "binary", text: serializeBinaryValue(value) }
  }

  if (isBinaryValue(value)) {
    return { kind: "binary", text: serializeBinaryValue(value) }
  }

  if (family === "boolean") {
    return {
      kind: "boolean",
      text: normalizeBooleanText(value) ?? serializeQueryValue(value, column),
    }
  }

  if (typeof value === "boolean") {
    return { kind: "boolean", text: value ? "true" : "false" }
  }

  if (family === "number" || family === "decimal") {
    return { kind: "number", text: serializeQueryValue(value, column) }
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return { kind: "number", text: String(value) }
  }

  if (family === "date" || family === "time" || family === "datetime") {
    return { kind: "date", text: formatTemporalValue(value, column) }
  }

  if (family === "json" || family === "array") {
    return {
      kind: "json",
      text: typeof value === "string" ? value : stringifyJsonValue(value),
    }
  }

  if (typeof value === "string") {
    return { kind: "string", text: value }
  }

  if (value instanceof Date) {
    return { kind: "date", text: value.toISOString() }
  }

  return {
    kind: "json",
    text: stringifyJsonValue(value),
  }
}

function escapeDelimitedCell(text: string, delimiter: string): string {
  if (
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r") ||
    text.includes(delimiter)
  ) {
    return `"${text.replaceAll('"', '""')}"`
  }

  return text
}

export function serializeValuesAsDelimitedText(
  values: unknown[],
  delimiter = "\t",
): string {
  return values
    .map((value) => escapeDelimitedCell(serializeQueryValue(value), delimiter))
    .join(delimiter)
}

export function serializeMatrixAsDelimitedText(
  headers: string[],
  rows: unknown[][],
  delimiter: string,
  lineBreak = "\n",
): string {
  const lines = [
    headers
      .map((header) => escapeDelimitedCell(header, delimiter))
      .join(delimiter),
    ...rows.map((row) => serializeValuesAsDelimitedText(row, delimiter)),
  ]

  return lines.join(lineBreak)
}
