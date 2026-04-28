import { Duplex, type Duplex as DuplexStream } from "node:stream"
import { Client as PgClient } from "pg"
import { Client as SshClient } from "ssh2"
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

interface ConnectedPostgresClient {
  client: PgClient
  close: () => Promise<void>
}

class SshTunnelStream extends Duplex {
  #ssh: SshClient
  #channel: DuplexStream | null = null
  #connected = false
  #connecting = false

  constructor(ssh: SshClient) {
    super()
    this.#ssh = ssh
  }

  connect(port: number, host: string): this {
    if (this.#connected || this.#connecting) {
      throw new Error("数据库连接已初始化")
    }

    this.#connecting = true

    this.#ssh.forwardOut("127.0.0.1", 0, host, port, (error, channel) => {
      if (error) {
        this.#connecting = false
        this.destroy(error)
        return
      }

      if (!channel) {
        this.#connecting = false
        this.destroy(new Error("SSH 隧道创建失败"))
        return
      }

      this.#channel = channel
      this.#connecting = false
      this.#connected = true

      channel.on("data", (chunk) => {
        if (!this.push(chunk)) {
          channel.pause()
        }
      })

      channel.on("end", () => {
        this.push(null)
      })

      channel.on("close", () => {
        this.push(null)
      })

      channel.on("error", (channelError) => {
        this.destroy(channelError)
      })

      this.emit("connect")
    })

    return this
  }

  _read(): void {
    this.#channel?.resume()
  }

  _write(
    chunk: string | Buffer,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const channel = this.#channel
    if (!channel) {
      callback(new Error("SSH 隧道尚未建立"))
      return
    }

    const drain = () => {
      channel.off("error", onError)
      callback()
    }

    const onError = (error: Error) => {
      channel.off("drain", drain)
      callback(error)
    }

    channel.once("error", onError)
    const writable = channel.write(chunk, encoding)

    if (writable) {
      drain()
      return
    }

    channel.once("drain", drain)
  }

  _final(callback: (error?: Error | null) => void): void {
    const channel = this.#channel
    if (!channel || channel.destroyed || channel.writableEnded) {
      callback()
      return
    }

    channel.once("close", () => {
      callback()
    })
    channel.end()
  }

  _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ): void {
    const channel = this.#channel
    this.#channel = null

    if (channel && !channel.destroyed) {
      channel.destroy(error ?? undefined)
    }

    callback(error)
  }

  setNoDelay(): this {
    return this
  }

  setKeepAlive(): this {
    return this
  }

  ref(): this {
    return this
  }

  unref(): this {
    return this
  }
}

function excludeSystemSchemas(column: string): string {
  return `${column} NOT IN ('pg_catalog', 'information_schema') AND ${column} NOT LIKE 'pg_toast%' AND ${column} NOT LIKE 'pg_temp_%'`
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

function parsePort(value: string, label: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`无效的${label}: ${value}`)
  }

  return port
}

async function connectDirectPostgres(
  conn: Config,
): Promise<ConnectedPostgresClient> {
  const client = new PgClient({
    host: conn.host,
    port: parsePort(conn.port, "数据库端口"),
    user: conn.username,
    password: conn.password,
    database: conn.database,
  })

  await client.connect()

  return {
    client,
    close: async () => {
      await client.end()
    },
  }
}

function connectSsh(conn: Config): Promise<SshClient> {
  const sshConfig = conn.ssh
  if (!sshConfig) {
    throw new Error("缺少 SSH 配置")
  }

  return new Promise((resolve, reject) => {
    const ssh = new SshClient()
    let settled = false

    const cleanup = () => {
      ssh.removeAllListeners("ready")
      ssh.removeAllListeners("error")
    }

    ssh.once("ready", () => {
      settled = true
      cleanup()
      resolve(ssh)
    })

    ssh.once("error", (error) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      reject(error)
    })

    ssh.connect({
      host: sshConfig.host,
      port: parsePort(sshConfig.port, "SSH 端口"),
      username: sshConfig.username,
      password: sshConfig.password,
      keepaliveInterval: 10_000,
      keepaliveCountMax: 3,
      readyTimeout: 20_000,
    })
  })
}

async function connectPostgresViaSsh(
  conn: Config,
): Promise<ConnectedPostgresClient> {
  const ssh = await connectSsh(conn)
  const stream = new SshTunnelStream(ssh)

  const client = new PgClient({
    host: conn.host,
    port: parsePort(conn.port, "数据库端口"),
    user: conn.username,
    password: conn.password,
    database: conn.database,
    stream: () => stream,
  })

  try {
    await client.connect()

    return {
      client,
      close: async () => {
        await client.end().catch(() => undefined)
        ssh.end()
      },
    }
  } catch (error) {
    stream.destroy(error instanceof Error ? error : undefined)
    ssh.end()
    throw error
  }
}

async function connectPostgres(conn: Config): Promise<ConnectedPostgresClient> {
  if (!conn.ssh) {
    return connectDirectPostgres(conn)
  }

  return connectPostgresViaSsh(conn)
}

export async function testPostgres(conn: Config): Promise<void> {
  const connected = await connectPostgres(conn)

  await connected.close()
}

async function queryRows<T>(client: PgClient, sql: string): Promise<T[]> {
  const result = await client.query<T>(sql)
  return Array.isArray(result.rows) ? result.rows : []
}

export async function inspectPostgres(conn: Config): Promise<DbSchema[]> {
  const connected = await connectPostgres(conn)
  const schemaFilter = excludeSystemSchemas("n.nspname")
  const viewSchemaFilter = excludeSystemSchemas("table_schema")

  try {
    const schemas = await queryRows<SchemaRow>(
      connected.client,
      `
        SELECT n.nspname AS schema_name
        FROM pg_namespace n
        WHERE ${schemaFilter}
        ORDER BY n.nspname
      `,
    )

    const tables = await queryRows<TableRow>(
      connected.client,
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
      connected.client,
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
      connected.client,
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
      connected.client,
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
    await connected.close()
  }
}

export async function queryPostgres(
  conn: Config,
  sql: string,
): Promise<QueryResult> {
  const connected = await connectPostgres(conn)

  try {
    const result = (await connected.client.query({
      text: sql,
      rowMode: "array",
    })) as PostgresQueryResult

    const rows = Array.isArray(result.rows) ? result.rows : []
    const columns: QueryResultColumn[] = Array.isArray(result.fields)
      ? result.fields.map((field, index) => ({
          id: `${field.name || "column"}_${index}`,
          name: field.name,
        }))
      : []

    return {
      columns,
      rows,
      rowCount: toQueryRowCount(result.rowCount),
    }
  } finally {
    await connected.close()
  }
}
