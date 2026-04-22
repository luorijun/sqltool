import knex, { type Knex } from "knex"
import type { Config } from "../config"
import type {
  DbSchema,
  DbTable,
  QueryResult,
  QueryResultColumn,
  QueryResultRow,
} from "."

interface PostgresField {
  name: string
}

interface PostgresQueryResult<T = QueryResultRow> {
  rows?: T[]
  fields?: PostgresField[]
  rowCount?: number | null
}

interface SchemaRow {
  schema_name: string
}

interface TableRow {
  schema_name: string
  table_name: string
  row_count: number | string | null
}

interface ColumnRow {
  schema_name: string
  table_name: string
  ordinal_position: number
  column_name: string
  data_type: string
  is_primary_key: boolean
  is_foreign_key: boolean
}

interface ViewRow {
  schema_name: string
  view_name: string
}

interface FunctionRow {
  schema_name: string
  function_name: string
}

function excludeSystemSchemas(column: string): string {
  return `${column} NOT IN ('pg_catalog', 'information_schema') AND ${column} NOT LIKE 'pg_toast%' AND ${column} NOT LIKE 'pg_temp_%'`
}

async function queryRows<T>(db: Knex, sql: string): Promise<T[]> {
  const result = (await db.raw(sql)) as { rows?: T[] }
  return Array.isArray(result.rows) ? result.rows : []
}

function toQueryRowCount(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined
  }

  return Math.max(0, Math.trunc(value))
}

function toRowCount(value: number | string | null): number | undefined {
  if (value === null) {
    return undefined
  }

  const count = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(count)) {
    return undefined
  }

  return Math.max(0, Math.trunc(count))
}

function createClient(conn: Config): Knex {
  const port = Number(conn.port)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`无效的端口: ${conn.port}`)
  }

  return knex({
    client: "pg",
    connection: {
      host: conn.host,
      port,
      user: conn.username,
      password: conn.password,
      database: conn.database,
    },
    pool: {
      min: 0,
      max: 1,
    },
  })
}

export async function inspectPostgres(conn: Config): Promise<DbSchema[]> {
  const db = createClient(conn)
  const schemaFilter = excludeSystemSchemas("n.nspname")
  const viewSchemaFilter = excludeSystemSchemas("table_schema")

  try {
    const schemas = await queryRows<SchemaRow>(
      db,
      `
        SELECT n.nspname AS schema_name
        FROM pg_namespace n
        WHERE ${schemaFilter}
        ORDER BY n.nspname
      `,
    )

    const tables = await queryRows<TableRow>(
      db,
      `
        SELECT
          n.nspname AS schema_name,
          c.relname AS table_name,
          GREATEST(COALESCE(s.n_live_tup, c.reltuples, 0), 0)::bigint AS row_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
        WHERE c.relkind IN ('r', 'p')
          AND ${schemaFilter}
        ORDER BY n.nspname, c.relname
      `,
    )

    const columns = await queryRows<ColumnRow>(
      db,
      `
        SELECT
          n.nspname AS schema_name,
          c.relname AS table_name,
          a.attnum AS ordinal_position,
          a.attname AS column_name,
          pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
          EXISTS (
            SELECT 1
            FROM pg_index i
            WHERE i.indrelid = c.oid
              AND i.indisprimary
              AND a.attnum = ANY(i.indkey)
          ) AS is_primary_key,
          EXISTS (
            SELECT 1
            FROM pg_constraint con
            WHERE con.conrelid = c.oid
              AND con.contype = 'f'
              AND a.attnum = ANY(con.conkey)
          ) AS is_foreign_key
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p')
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND ${schemaFilter}
        ORDER BY n.nspname, c.relname, a.attnum
      `,
    )

    const views = await queryRows<ViewRow>(
      db,
      `
        SELECT
          table_schema AS schema_name,
          table_name AS view_name
        FROM information_schema.views
        WHERE ${viewSchemaFilter}
        ORDER BY table_schema, table_name
      `,
    )

    const functions = await queryRows<FunctionRow>(
      db,
      `
        SELECT
          n.nspname AS schema_name,
          p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS function_name
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prokind = 'f'
          AND ${schemaFilter}
        ORDER BY n.nspname, p.proname, function_name
      `,
    )

    const schemaMap = new Map<string, DbSchema>()
    const tableMap = new Map<string, DbTable>()

    const ensureSchema = (name: string): DbSchema => {
      const existing = schemaMap.get(name)
      if (existing) {
        return existing
      }

      const schema: DbSchema = {
        name,
        tables: [],
        views: [],
        functions: [],
      }
      schemaMap.set(name, schema)
      return schema
    }

    for (const schemaRow of schemas) {
      ensureSchema(schemaRow.schema_name)
    }

    for (const tableRow of tables) {
      const schema = ensureSchema(tableRow.schema_name)
      const table: DbTable = {
        name: tableRow.table_name,
        rowCount: toRowCount(tableRow.row_count),
        columns: [],
      }
      schema.tables.push(table)
      tableMap.set(`${tableRow.schema_name}.${tableRow.table_name}`, table)
    }

    for (const columnRow of columns) {
      const table = tableMap.get(
        `${columnRow.schema_name}.${columnRow.table_name}`,
      )
      if (!table) {
        continue
      }

      table.columns.push({
        name: columnRow.column_name,
        type: columnRow.data_type,
        pk: columnRow.is_primary_key || undefined,
        fk: columnRow.is_foreign_key || undefined,
      })
    }

    for (const viewRow of views) {
      const schema = ensureSchema(viewRow.schema_name)
      schema.views.push({ name: viewRow.view_name })
    }

    for (const functionRow of functions) {
      const schema = ensureSchema(functionRow.schema_name)
      schema.functions.push({ name: functionRow.function_name })
    }

    return Array.from(schemaMap.values())
  } finally {
    await db.destroy()
  }
}

export async function queryPostgres(
  conn: Config,
  sql: string,
): Promise<QueryResult> {
  const db = createClient(conn)

  try {
    const result = (await db
      .raw(sql)
      .options({ rowMode: "array" })) as PostgresQueryResult

    const rows = Array.isArray(result.rows) ? result.rows : []
    const columns: QueryResultColumn[] = Array.isArray(result.fields)
      ? result.fields.map((field, index) => ({
          id: `col_${index}`,
          name: field.name,
        }))
      : []

    return {
      columns,
      rows,
      rowCount: toQueryRowCount(result.rowCount),
    }
  } finally {
    await db.destroy()
  }
}
