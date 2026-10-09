import {
  Client as PgClient,
  type FieldDef as PgField,
  type QueryResultRow as PgRow,
  types as pgTypes,
} from "pg"
import type {
  ConfigProfile,
  DbSchema,
  DbTable,
  QueryColumnTypeFamily,
  QueryResultRow,
  TableSource,
} from "@/core/database"
import type { QueryColumnInput } from "./shared"
import {
  createConnectionSession,
  createQueryColumns,
  parsePort,
  toQueryRowCount,
  toRowCount,
  withTimeout,
} from "./shared"
import { connectSshClient, SshTunnelStream } from "./ssh"
import type {
  ColumnType,
  ConnectionSession,
  DriverResult,
  PostgresTypeRef,
} from "./types"

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

interface ConnectedClient {
  client: PgClient
  closeTransport?: () => void
}

const CONNECTION_TIMEOUT_MS = 20_000

function excludeSystemSchemas(column: string): string {
  return `${column} NOT IN ('pg_catalog', 'information_schema') AND ${column} NOT LIKE 'pg_toast%' AND ${column} NOT LIKE 'pg_temp_%'`
}

async function connectDirect(profile: ConfigProfile): Promise<ConnectedClient> {
  const port = parsePort(profile.port, "数据库端口")
  const client = new PgClient({
    host: profile.host,
    port,
    user: profile.username,
    password: profile.password,
    database: profile.database,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  })

  client.on("error", () => {})
  try {
    await client.connect()
  } catch (error) {
    client.connection.stream.destroy()
    throw error
  }

  return { client }
}

async function connectSsh(profile: ConfigProfile): Promise<ConnectedClient> {
  if (!profile.ssh) {
    throw new Error("缺少 SSH 配置")
  }

  const ssh = await connectSshClient(profile.ssh)
  const port = parsePort(profile.port, "数据库端口")
  const stream = new SshTunnelStream(ssh)

  const client = new PgClient({
    host: profile.host,
    port,
    user: profile.username,
    password: profile.password,
    database: profile.database,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    stream: () => stream,
  })
  client.on("error", () => {})

  try {
    await client.connect()

    return {
      client,
      closeTransport: () => {
        stream.destroy()
        ssh.destroy()
      },
    }
  } catch (error) {
    stream.destroy(error instanceof Error ? error : undefined)
    ssh.end()
    throw error
  }
}

async function connectClient(profile: ConfigProfile): Promise<ConnectedClient> {
  if (!profile.ssh) {
    return connectDirect(profile)
  }

  return connectSsh(profile)
}

async function queryRows<T extends PgRow>(
  client: PgClient,
  sql: string,
  values?: unknown[],
): Promise<T[]> {
  const result = await client.query<T>(sql, values)
  return Array.isArray(result.rows) ? result.rows : []
}

async function inspectClient(
  client: PgClient,
  source?: TableSource,
): Promise<DbSchema[]> {
  const schemaFilter = excludeSystemSchemas("n.nspname")
  const viewSchemaFilter = excludeSystemSchemas("table_schema")

  const schemas = source
    ? []
    : await queryRows<SchemaRow>(
        client,
        `
      SELECT n.nspname AS schema_name
      FROM pg_namespace n
      WHERE ${schemaFilter}
      ORDER BY n.nspname
    `,
      )

  const tables = await queryRows<TableRow>(
    client,
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
        ${source ? "AND n.nspname = $1 AND c.relname = $2" : ""}
      ORDER BY n.nspname, c.relname
    `,
    source ? [source.schema, source.table] : undefined,
  )

  const columns = await queryRows<ColumnRow>(
    client,
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
        ${source ? "AND n.nspname = $1 AND c.relname = $2" : ""}
      ORDER BY n.nspname, c.relname, a.attnum
    `,
    source ? [source.schema, source.table] : undefined,
  )

  const views = source
    ? []
    : await queryRows<ViewRow>(
        client,
        `
      SELECT
        table_schema AS schema_name,
        table_name AS view_name
      FROM information_schema.views
      WHERE ${viewSchemaFilter}
      ORDER BY table_schema, table_name
    `,
      )

  const functions = source
    ? []
    : await queryRows<FunctionRow>(
        client,
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
}

interface TypeRow {
  name: string | null
  category: string | null
  namespace: string | null
  label: string | null
}

function typeFamily(type: TypeRow): QueryColumnTypeFamily {
  if (type.category === "A") return "array"
  if (type.category === "B") return "boolean"
  if (type.namespace === "pg_catalog") {
    switch (type.name) {
      case "numeric":
      case "money":
        return "decimal"
      case "json":
      case "jsonb":
        return "json"
      case "bytea":
        return "binary"
      case "uuid":
        return "uuid"
      case "date":
        return "date"
      case "time":
      case "timetz":
      case "interval":
        return "time"
    }
  }
  if (type.category === "N") return "number"
  if (type.category === "D") return "datetime"
  if (type.category && ["S", "E", "I", "G", "R", "V"].includes(type.category))
    return "string"
  return "unknown"
}

async function readTypes(
  client: PgClient,
  refs: PostgresTypeRef[],
): Promise<Array<ColumnType | null>> {
  if (!refs.length) return []
  const rows = await queryRows<TypeRow>(
    client,
    `
    SELECT t.typname AS name, t.typcategory AS category, n.nspname AS namespace,
           CASE WHEN t.oid IS NOT NULL THEN pg_catalog.format_type(t.oid, r.modifier) END AS label
    FROM unnest($1::oid[], $2::int[]) WITH ORDINALITY AS r(oid, modifier, position)
    LEFT JOIN pg_catalog.pg_type t ON t.oid = r.oid
    LEFT JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    ORDER BY r.position
  `,
    [refs.map((ref) => ref.oid), refs.map((ref) => ref.modifier)],
  )
  return rows.map((row) =>
    row.label ? { dbType: row.label, typeFamily: typeFamily(row) } : null,
  )
}

function getPositiveNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && value > 0 ? value : undefined
}

function createColumn(field: PgField): QueryColumnInput {
  return {
    name: field.name,
    driver: "postgres",
    typeRef: {
      driver: "postgres",
      oid: field.dataTypeID,
      modifier: field.dataTypeModifier,
    },
    typeCode: field.dataTypeID,
    typeFamily: "unknown",
    sourceTableId: getPositiveNumber(field.tableID),
    sourceColumnId: getPositiveNumber(field.columnID),
    format: field.format,
  }
}

async function queryClient(
  client: PgClient,
  sql: string,
  params: unknown[] = [],
): Promise<DriverResult> {
  const result = await client.query<QueryResultRow>({
    text: sql,
    values: params,
    rowMode: "array",
    types: {
      getTypeParser(oid, format) {
        // Preserve temporal precision and timezone text for row identity and edits.
        if (
          format !== "binary" &&
          [1082, 1114, 1184, 1182, 1115, 1185].includes(oid)
        )
          return (value: string) => value
        return pgTypes.getTypeParser(oid, format)
      },
    },
  })

  const rows = Array.isArray(result.rows) ? result.rows : []
  const columns = Array.isArray(result.fields)
    ? createQueryColumns(result.fields.map(createColumn))
    : []

  return {
    columns,
    rows,
    rowCount: toQueryRowCount(result.rowCount),
  }
}

export async function connectPostgres(
  profile: ConfigProfile,
): Promise<ConnectionSession> {
  const { client, closeTransport } = await connectClient(profile)

  // pg supplies the backend PID at connection time but omits it from its public types.
  const pid = "processID" in client ? client.processID : undefined
  if (typeof pid !== "number") {
    client.connection.stream.destroy()
    closeTransport?.()
    throw new Error("无法获取 PostgreSQL 后端进程标识")
  }

  return createConnectionSession({
    async describe(columns, source) {
      const ids = new Set(
        columns.flatMap((c) => (c.sourceTableId ? [c.sourceTableId] : [])),
      )
      if (ids.size !== 1) return null
      const { rows } = await client.query<{
        schema: string
        table: string
        name: string
        id: number
        key: boolean
        generated: boolean
      }>(
        `SELECT n.nspname AS schema, c.relname AS table, a.attname AS name,
          a.attnum AS id, a.attgenerated <> '' AS generated,
          EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indrelid = c.oid
            AND i.indisprimary AND a.attnum = ANY((i.indkey::smallint[])[0:i.indnkeyatts-1])) AS key
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
        WHERE c.oid = $1 AND c.relkind IN ('r', 'p')
          AND a.attnum > 0 AND NOT a.attisdropped
          AND ($2::text IS NULL OR c.oid = pg_catalog.to_regclass($2)) ORDER BY a.attnum`,
        [
          [...ids][0],
          source
            ? [source.schema, source.table]
                .filter(Boolean)
                .map((s) => `"${s.replaceAll('"', '""')}"`)
                .join(".")
            : null,
        ],
      )
      if (!rows.length) return null
      for (const column of columns) {
        const field = rows.find((r) => r.id === column.sourceColumnId)
        if (field)
          Object.assign(column, {
            schema: field.schema,
            table: field.table,
            sourceColumn: field.name,
            primaryKey: field.key || undefined,
          })
      }
      return {
        source: { schema: rows[0].schema, table: rows[0].table },
        columns: rows,
      }
    },
    async transaction() {
      // pg rejects a failed query before ReadyForQuery updates its transaction status.
      if (!("readyForQuery" in client)) return "unknown"
      if (!client.readyForQuery) {
        await new Promise<void>((resolve, reject) => {
          const clear = () => {
            client.connection.off("readyForQuery", ready)
            client.off("error", error)
            client.off("end", end)
          }
          const ready = () => {
            clear()
            resolve()
          }
          const error = (cause: Error) => {
            clear()
            reject(cause)
          }
          const end = () => error(new Error("数据库连接已断开"))
          client.connection.once("readyForQuery", ready)
          client.once("error", error)
          client.once("end", end)
        })
      }
      switch (client.getTransactionStatus()) {
        case "I":
          return "idle"
        case "T":
          return "active"
        case "E":
          return "failed"
        default:
          return "unknown"
      }
    },
    async prepareMetadata() {
      await client.query("SET search_path TO pg_catalog")
    },
    types(refs) {
      return readTypes(client, refs)
    },
    watch(fail) {
      client.on("error", fail)
      client.on("end", () => fail(new Error("数据库连接已断开")))
    },
    destroy() {
      client.connection.stream.destroy()
      closeTransport?.()
    },
    async cancel(active) {
      const control = await connectClient(profile)
      try {
        if (active())
          await withTimeout(
            control.client.query("SELECT pg_cancel_backend($1)", [pid]),
          )
      } finally {
        control.client.connection.stream.destroy()
        control.closeTransport?.()
      }
    },
    inspect(source) {
      return inspectClient(client, source)
    },
    query(sql, params) {
      return queryClient(client, sql, params)
    },
    close: async () => {
      try {
        await client.end()
      } catch {
        client.connection.stream.destroy()
      } finally {
        closeTransport?.()
      }
    },
  })
}
