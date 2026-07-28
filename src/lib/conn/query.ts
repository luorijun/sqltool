import type { DbDriver, SelectCondition, SelectField, SelectQuery } from "."

export interface CompiledSelectQuery {
  sql: string
  params: unknown[]
}

const COMPARISON_OPERATORS = {
  eq: "=",
  ne: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "LIKE",
  notLike: "NOT LIKE",
} as const

function assertIdentifier(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`${label}不能为空`)
  }
}

function quoteIdentifier(driver: DbDriver, value: string): string {
  assertIdentifier(value, "标识符")
  return driver === "postgres"
    ? `"${value.replaceAll('"', '""')}"`
    : `\`${value.replaceAll("`", "``")}\``
}

function compileField(driver: DbDriver, field: SelectField): string {
  if (typeof field === "string") {
    return quoteIdentifier(driver, field)
  }

  const column = field.column ?? "*"
  const expression =
    column === "*" ? "COUNT(*)" : `COUNT(${quoteIdentifier(driver, column)})`

  return field.alias
    ? `${expression} AS ${quoteIdentifier(driver, field.alias)}`
    : expression
}

function compileCondition(
  driver: DbDriver,
  condition: SelectCondition,
  params: unknown[],
): string {
  if (condition.operator === "and" || condition.operator === "or") {
    const conditions = condition.conditions ?? []
    if (conditions.length === 0) {
      throw new Error(`${condition.operator.toUpperCase()} 条件不能为空`)
    }

    const operator = condition.operator === "and" ? " AND " : " OR "
    return `(${conditions
      .map((item) => compileCondition(driver, item, params))
      .join(operator)})`
  }

  if (!condition.column) {
    throw new Error("查询条件缺少列名")
  }

  const column = quoteIdentifier(driver, condition.column)
  if (condition.operator === "isNull") {
    return `${column} IS NULL`
  }
  if (condition.operator === "isNotNull") {
    return `${column} IS NOT NULL`
  }
  if (condition.operator === "eq" && condition.value === null) {
    return `${column} IS NULL`
  }
  if (condition.operator === "ne" && condition.value === null) {
    return `${column} IS NOT NULL`
  }

  if (condition.operator === "in" || condition.operator === "notIn") {
    if (!Array.isArray(condition.value) || condition.value.length === 0) {
      throw new Error(`${condition.operator.toUpperCase()} 条件值不能为空`)
    }

    const placeholders = condition.value.map((value) => {
      params.push(value)
      return driver === "postgres" ? `$${params.length}` : "?"
    })
    const operator = condition.operator === "in" ? "IN" : "NOT IN"
    return `${column} ${operator} (${placeholders.join(", ")})`
  }

  const operator = COMPARISON_OPERATORS[condition.operator]
  params.push(condition.value)
  const placeholder = driver === "postgres" ? `$${params.length}` : "?"
  return `${column} ${operator} ${placeholder}`
}

function assertPagingValue(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label}必须是非负整数`)
  }
}

export function compileSelectQuery(
  driver: DbDriver,
  query: SelectQuery,
): CompiledSelectQuery {
  assertIdentifier(query.from.schema, "模式名")
  assertIdentifier(query.from.table, "数据表名")

  const params: unknown[] = []
  const fields = query.select?.length
    ? query.select.map((field) => compileField(driver, field)).join(", ")
    : "*"
  const source = `${quoteIdentifier(driver, query.from.schema)}.${quoteIdentifier(driver, query.from.table)}`
  const lines = [`SELECT ${fields}`, `FROM ${source}`]

  if (query.where) {
    lines.push(`WHERE ${compileCondition(driver, query.where, params)}`)
  }

  if (query.orderBy?.length) {
    const orderBy = query.orderBy
      .map(({ column, direction = "asc" }) => {
        return `${quoteIdentifier(driver, column)} ${direction.toUpperCase()}`
      })
      .join(", ")
    lines.push(`ORDER BY ${orderBy}`)
  }

  if (query.limit !== undefined) {
    assertPagingValue(query.limit, "LIMIT")
    params.push(query.limit)
    lines.push(`LIMIT ${driver === "postgres" ? `$${params.length}` : "?"}`)
  }

  if (query.offset !== undefined) {
    assertPagingValue(query.offset, "OFFSET")
    params.push(query.offset)
    lines.push(`OFFSET ${driver === "postgres" ? `$${params.length}` : "?"}`)
  }

  return {
    sql: `${lines.join("\n")};`,
    params,
  }
}
