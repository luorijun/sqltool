import { Client as PgClient } from "pg"
import type {
  ConfigProfile,
  DbSchema,
  DbTable,
  QueryResult,
  QueryResultRow,
  SelectQuery,
} from ".."
import { compileSelectQuery } from "../query"
import { connectSshClient, SshTunnelStream } from "../ssh"
import type { ConnectionSession, QueryColumnInput } from "."
import {
  createConnectionSession,
  createQueryColumns,
  parsePort,
  toQueryRowCount,
  toRowCount,
} from "."

interface PostgresField {
  name: string
  tableID?: number
  columnID?: number
  dataTypeID?: number
  dataTypeSize?: number
  dataTypeModifier?: number
  format?: string
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

interface ConnectedPostgresClient {
  client: PgClient
  closeTransport?: () => void
}

const POSTGRES_CONNECTION_TIMEOUT_MS = 20_000

function excludeSystemSchemas(column: string): string {
  return `${column} NOT IN ('pg_catalog', 'information_schema') AND ${column} NOT LIKE 'pg_toast%' AND ${column} NOT LIKE 'pg_temp_%'`
}

async function connectDirectPostgres(
  profile: ConfigProfile,
): Promise<ConnectedPostgresClient> {
  const port = parsePort(profile.port, "数据库端口")
  const client = new PgClient({
    host: profile.host,
    port,
    user: profile.username,
    password: profile.password,
    database: profile.database,
    connectionTimeoutMillis: POSTGRES_CONNECTION_TIMEOUT_MS,
  })

  await client.connect()

  return { client }
}

async function connectPostgresViaSsh(
  profile: ConfigProfile,
): Promise<ConnectedPostgresClient> {
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
    connectionTimeoutMillis: POSTGRES_CONNECTION_TIMEOUT_MS,
    stream,
  })

  try {
    await client.connect()

    return {
      client,
      closeTransport: () => {
        ssh.end()
      },
    }
  } catch (error) {
    stream.destroy(error instanceof Error ? error : undefined)
    ssh.end()
    throw error
  }
}

async function createPostgresClient(
  profile: ConfigProfile,
): Promise<ConnectedPostgresClient> {
  if (!profile.ssh) {
    return connectDirectPostgres(profile)
  }

  return connectPostgresViaSsh(profile)
}

async function queryRows<T>(client: PgClient, sql: string): Promise<T[]> {
  const result = await client.query<T>(sql)
  return Array.isArray(result.rows) ? result.rows : []
}

async function inspectPostgresClient(client: PgClient): Promise<DbSchema[]> {
  const schemaFilter = excludeSystemSchemas("n.nspname")
  const viewSchemaFilter = excludeSystemSchemas("table_schema")

  const schemas = await queryRows<SchemaRow>(
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
      ORDER BY n.nspname, c.relname
    `,
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
      ORDER BY n.nspname, c.relname, a.attnum
    `,
  )

  const views = await queryRows<ViewRow>(
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

  const functions = await queryRows<FunctionRow>(
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

const POSTGRES_TYPE_INFO: Record<
  number,
  { name: string; family: QueryColumnInput["typeFamily"] }
> = {
  16: { name: "bool", family: "boolean" },
  17: { name: "bytea", family: "binary" },
  18: { name: "char", family: "string" },
  19: { name: "name", family: "string" },
  20: { name: "bigint", family: "number" },
  21: { name: "smallint", family: "number" },
  23: { name: "int", family: "number" },
  25: { name: "text", family: "string" },
  26: { name: "oid", family: "number" },
  114: { name: "json", family: "json" },
  142: { name: "xml", family: "string" },
  700: { name: "real", family: "number" },
  701: { name: "double", family: "number" },
  790: { name: "money", family: "decimal" },
  1000: { name: "bool[]", family: "array" },
  1005: { name: "smallint[]", family: "array" },
  1007: { name: "int[]", family: "array" },
  1009: { name: "text[]", family: "array" },
  1015: { name: "varchar[]", family: "array" },
  1016: { name: "bigint[]", family: "array" },
  1021: { name: "real[]", family: "array" },
  1022: { name: "double[]", family: "array" },
  1042: { name: "char", family: "string" },
  1043: { name: "varchar", family: "string" },
  1082: { name: "date", family: "date" },
  1083: { name: "time", family: "time" },
  1114: { name: "timestamp", family: "datetime" },
  1115: { name: "timestamp[]", family: "array" },
  1182: { name: "date[]", family: "array" },
  1184: { name: "timestamptz", family: "datetime" },
  1185: { name: "timestamptz[]", family: "array" },
  1186: { name: "interval", family: "time" },
  1266: { name: "timetz", family: "time" },
  1560: { name: "bit", family: "string" },
  1562: { name: "varbit", family: "string" },
  1700: { name: "numeric", family: "decimal" },
  199: { name: "json[]", family: "array" },
  1231: { name: "numeric[]", family: "array" },
  2950: { name: "uuid", family: "uuid" },
  2951: { name: "uuid[]", family: "array" },
  3802: { name: "jsonb", family: "json" },
  3807: { name: "jsonb[]", family: "array" },
}

function getPostgresModifier(field: PostgresField): number | undefined {
  return typeof field.dataTypeModifier === "number" &&
    field.dataTypeModifier >= 0
    ? field.dataTypeModifier
    : undefined
}

function getPostgresLength(field: PostgresField): number | undefined {
  const modifier = getPostgresModifier(field)
  if (modifier === undefined) {
    return undefined
  }

  if (field.dataTypeID === 1042 || field.dataTypeID === 1043) {
    return Math.max(0, modifier - 4)
  }

  return undefined
}

function getPostgresNumericPrecision(field: PostgresField): number | undefined {
  if (field.dataTypeID !== 1700) {
    return undefined
  }

  const modifier = getPostgresModifier(field)
  if (modifier === undefined) {
    return undefined
  }

  return ((modifier - 4) >> 16) & 0xffff
}

function getPostgresNumericScale(field: PostgresField): number | undefined {
  if (field.dataTypeID !== 1700) {
    return undefined
  }

  const modifier = getPostgresModifier(field)
  if (modifier === undefined) {
    return undefined
  }

  return (modifier - 4) & 0xffff
}

function getPostgresTemporalPrecision(
  field: PostgresField,
): number | undefined {
  if (![1083, 1114, 1184, 1266].includes(field.dataTypeID ?? 0)) {
    return undefined
  }

  return getPostgresModifier(field)
}

function getPostgresDbType(field: PostgresField): string | undefined {
  const typeCode = field.dataTypeID
  if (typeCode === undefined) {
    return undefined
  }

  const info = POSTGRES_TYPE_INFO[typeCode]
  if (!info) {
    return undefined
  }

  const length = getPostgresLength(field)
  if (length !== undefined) {
    return `${info.name}(${length})`
  }

  const precision = getPostgresNumericPrecision(field)
  if (precision !== undefined) {
    const scale = getPostgresNumericScale(field)
    return scale !== undefined
      ? `${info.name}(${precision},${scale})`
      : `${info.name}(${precision})`
  }

  const temporalPrecision = getPostgresTemporalPrecision(field)
  if (temporalPrecision !== undefined) {
    return `${info.name}(${temporalPrecision})`
  }

  return info.name
}

function getPositivePostgresNumber(
  value: number | undefined,
): number | undefined {
  return typeof value === "number" && value > 0 ? value : undefined
}

function createPostgresQueryColumn(field: PostgresField): QueryColumnInput {
  const typeCode = field.dataTypeID
  const typeInfo =
    typeCode === undefined ? undefined : POSTGRES_TYPE_INFO[typeCode]
  const precision =
    getPostgresNumericPrecision(field) ?? getPostgresTemporalPrecision(field)

  return {
    name: field.name,
    driver: "postgres",
    dbType: getPostgresDbType(field),
    typeCode,
    typeFamily: typeInfo?.family ?? "unknown",
    sourceTableId: getPositivePostgresNumber(field.tableID),
    sourceColumnId: getPositivePostgresNumber(field.columnID),
    length: getPostgresLength(field),
    precision,
    scale: getPostgresNumericScale(field),
    format: field.format,
  }
}

async function queryPostgresClient(
  client: PgClient,
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult> {
  const result = (await client.query({
    text: sql,
    values: params,
    rowMode: "array",
  })) as PostgresQueryResult

  const rows = Array.isArray(result.rows) ? result.rows : []
  const columns = Array.isArray(result.fields)
    ? createQueryColumns(result.fields.map(createPostgresQueryColumn))
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
  const { client, closeTransport } = await createPostgresClient(profile)

  return createConnectionSession({
    inspect() {
      return inspectPostgresClient(client)
    },
    query(sql) {
      return queryPostgresClient(client, sql)
    },
    async select(query: SelectQuery) {
      const compiled = compileSelectQuery("postgres", query)
      return {
        result: await queryPostgresClient(
          client,
          compiled.sql,
          compiled.params,
        ),
        executedSql: compiled.sql,
      }
    },
    close: async () => {
      try {
        await client.end()
      } catch {
        // ignore close failure and always release SSH transport
      } finally {
        closeTransport?.()
      }
    },
  })
}
