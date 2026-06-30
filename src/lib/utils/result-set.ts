import type { QueryColumnTypeFamily, QueryResultColumn } from "@/lib/conn"

const NUMBER_TYPE_PATTERN =
  /^(?:smallint|int|integer|bigint|tinyint|mediumint|serial|bigserial|float|double|real|year|bit)(?:\b|\()/i
const DECIMAL_TYPE_PATTERN = /^(?:numeric|decimal|dec|money)(?:\b|\()/i
const STRING_TYPE_PATTERN =
  /^(?:char|bpchar|varchar|character|text|citext|name|enum|set|xml)(?:\b|\()/i
const BINARY_TYPE_PATTERN =
  /^(?:bytea|blob|tinyblob|mediumblob|longblob|binary|varbinary)(?:\b|\()/i

export function inferQueryColumnTypeFamily(
  column?: Pick<QueryResultColumn, "dbType" | "typeFamily">,
): QueryColumnTypeFamily {
  if (column?.typeFamily) {
    return column.typeFamily
  }

  const dbType = column?.dbType?.trim().toLowerCase()
  if (!dbType) {
    return "unknown"
  }

  if (dbType.endsWith("[]")) {
    return "array"
  }

  if (dbType === "bool" || dbType === "boolean") {
    return "boolean"
  }

  if (dbType === "uuid") {
    return "uuid"
  }

  if (dbType === "json" || dbType === "jsonb") {
    return "json"
  }

  if (BINARY_TYPE_PATTERN.test(dbType)) {
    return "binary"
  }

  if (DECIMAL_TYPE_PATTERN.test(dbType)) {
    return "decimal"
  }

  if (NUMBER_TYPE_PATTERN.test(dbType)) {
    return "number"
  }

  if (dbType.startsWith("timestamp") || dbType === "datetime") {
    return "datetime"
  }

  if (dbType === "date") {
    return "date"
  }

  if (dbType.startsWith("time") || dbType === "interval") {
    return "time"
  }

  if (STRING_TYPE_PATTERN.test(dbType)) {
    return "string"
  }

  return "unknown"
}

export function getQueryColumnTypeLabel(
  column?: Pick<QueryResultColumn, "dbType" | "driver" | "typeCode">,
): string | undefined {
  const dbType = column?.dbType?.trim()
  if (dbType) {
    return formatDbTypeLabel(dbType)
  }

  if (column?.typeCode !== undefined) {
    return column.driver
      ? `${column.driver}:${column.typeCode}`
      : String(column.typeCode)
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
  const family = inferQueryColumnTypeFamily(column)
  return family === "number" || family === "decimal"
}

export function formatDbTypeLabel(type: string): string {
  const normalized = type.trim().replace(/\s+/g, " ").toLowerCase()
  const withoutPostgresNoise = normalized
    .replace(/^timestamp with time zone$/, "timestamptz")
    .replace(/^timestamp without time zone$/, "timestamp")
    .replace(/^time with time zone$/, "timetz")
    .replace(/^time without time zone$/, "time")
    .replace(/^character varying/, "varchar")
    .replace(/^character\b/, "char")
    .replace(/^double precision$/, "double")
    .replace(/^boolean$/, "bool")
    .replace(/^integer$/, "int")

  return withoutPostgresNoise
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

function getTypeRank(value: unknown, column?: QueryResultColumn): number {
  if (value === undefined || value === null) {
    return 7
  }

  const family = inferQueryColumnTypeFamily(column)
  switch (family) {
    case "boolean":
      return 0
    case "number":
    case "decimal":
      return 1
    case "date":
    case "time":
    case "datetime":
      return 2
    case "uuid":
    case "string":
      return 3
    case "json":
    case "array":
      return 4
    case "binary":
      return 5
    case "unknown":
      break
  }

  if (typeof value === "boolean") {
    return 0
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return 1
  }

  if (value instanceof Date) {
    return 2
  }

  if (typeof value === "string") {
    return 3
  }

  return 4
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
  const family = inferQueryColumnTypeFamily(column)

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

function toComparableNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined
  }

  if (typeof value === "bigint") {
    return Number(value)
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function toComparableTime(value: unknown): number | undefined {
  if (value instanceof Date) {
    return value.getTime()
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function compareNullableValues(
  left: unknown,
  right: unknown,
): number | undefined {
  const leftNullish = left === undefined || left === null
  const rightNullish = right === undefined || right === null

  if (!leftNullish && !rightNullish) {
    return undefined
  }

  if (leftNullish && rightNullish) {
    return 0
  }

  return leftNullish ? 1 : -1
}

function compareNumbers(left: unknown, right: unknown): number | undefined {
  const leftNumber = toComparableNumber(left)
  const rightNumber = toComparableNumber(right)

  if (leftNumber === undefined || rightNumber === undefined) {
    return undefined
  }

  if (leftNumber === rightNumber) {
    return 0
  }

  return leftNumber < rightNumber ? -1 : 1
}

function compareBooleans(left: unknown, right: unknown): number | undefined {
  const leftBoolean = normalizeBooleanText(left)
  const rightBoolean = normalizeBooleanText(right)

  if (leftBoolean === undefined || rightBoolean === undefined) {
    return undefined
  }

  return Number(leftBoolean === "true") - Number(rightBoolean === "true")
}

function compareTemporalValues(
  left: unknown,
  right: unknown,
): number | undefined {
  const leftTime = toComparableTime(left)
  const rightTime = toComparableTime(right)

  if (leftTime === undefined || rightTime === undefined) {
    return undefined
  }

  return leftTime - rightTime
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

  const family = inferQueryColumnTypeFamily(column)
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

  const family = inferQueryColumnTypeFamily(column)

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

export function compareQueryValues(
  left: unknown,
  right: unknown,
  column?: QueryResultColumn,
): number {
  if (left === right) {
    return 0
  }

  const nullableCompare = compareNullableValues(left, right)
  if (nullableCompare !== undefined) {
    return nullableCompare
  }

  const family = inferQueryColumnTypeFamily(column)
  const familyCompare =
    family === "boolean"
      ? compareBooleans(left, right)
      : family === "number" || family === "decimal"
        ? compareNumbers(left, right)
        : family === "date" || family === "time" || family === "datetime"
          ? compareTemporalValues(left, right)
          : undefined

  if (familyCompare !== undefined) {
    return familyCompare
  }

  const leftRank = getTypeRank(left, column)
  const rightRank = getTypeRank(right, column)
  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }

  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right)
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right
  }

  if (typeof left === "bigint" && typeof right === "bigint") {
    return left < right ? -1 : 1
  }

  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime()
  }

  return serializeQueryValue(left, column).localeCompare(
    serializeQueryValue(right, column),
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    },
  )
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
