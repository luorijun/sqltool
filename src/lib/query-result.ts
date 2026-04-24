export interface QueryValueDisplay {
  kind: "null" | "boolean" | "number" | "json" | "string" | "empty"
  text: string
}

function getTypeRank(value: unknown): number {
  if (value === undefined || value === null) {
    return 5
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

export function serializeQueryValue(value: unknown): string {
  if (value === null) {
    return "NULL"
  }

  if (value === undefined) {
    return ""
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

export function getQueryValueDisplay(value: unknown): QueryValueDisplay {
  if (value === null) {
    return { kind: "null", text: "NULL" }
  }

  if (value === undefined) {
    return { kind: "empty", text: "" }
  }

  if (typeof value === "boolean") {
    return { kind: "boolean", text: value ? "true" : "false" }
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return { kind: "number", text: String(value) }
  }

  if (typeof value === "string") {
    return { kind: "string", text: value }
  }

  if (value instanceof Date) {
    return { kind: "string", text: value.toISOString() }
  }

  return {
    kind: "json",
    text: stringifyJsonValue(value),
  }
}

export function compareQueryValues(left: unknown, right: unknown): number {
  if (left === right) {
    return 0
  }

  const leftRank = getTypeRank(left)
  const rightRank = getTypeRank(right)
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

  return serializeQueryValue(left).localeCompare(
    serializeQueryValue(right),
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
