import type { RowDataPacket } from "mysql2"
import mysql, {
  type FieldPacket,
  type Connection as MySqlConnection,
  type ResultSetHeader,
} from "mysql2/promise"
import type { ConfigProfile } from "../config"
import type { ConnectionSession } from "./driver"
import {
  createCloseNotifier,
  createQueryColumns,
  parsePort,
  toQueryRowCount,
  toRowCount,
} from "./driver"
import type { DbSchema, DbTable, QueryResult } from "./index"
import { connectSshClient, SshTunnelStream } from "./ssh"

interface TableRow extends RowDataPacket {
  schema_name: string
  table_name: string
  row_count: number | string | null
}

interface ColumnRow extends RowDataPacket {
  schema_name: string
  table_name: string
  ordinal_position: number
  column_name: string
  data_type: string
  is_primary_key: number
  is_foreign_key: number
}

interface ViewRow extends RowDataPacket {
  schema_name: string
  view_name: string
}

interface FunctionRow extends RowDataPacket {
  schema_name: string
  function_name: string
}

interface ConnectedMySqlClient {
  client: MySqlConnection
  closeTransport: () => Promise<void>
}

async function connectDirectMySql(
  profile: ConfigProfile,
): Promise<ConnectedMySqlClient> {
  const client = await mysql.createConnection({
    host: profile.host,
    port: parsePort(profile.port, "数据库端口"),
    user: profile.username,
    password: profile.password,
    database: profile.database,
  })

  return {
    client,
    closeTransport: async () => undefined,
  }
}

async function connectMySqlViaSsh(
  profile: ConfigProfile,
): Promise<ConnectedMySqlClient> {
  if (!profile.ssh) {
    throw new Error("缺少 SSH 配置")
  }

  const ssh = await connectSshClient(profile.ssh)

  try {
    const client = await mysql.createConnection({
      host: profile.host,
      port: parsePort(profile.port, "数据库端口"),
      user: profile.username,
      password: profile.password,
      database: profile.database,
      stream: () =>
        new SshTunnelStream(ssh).connect(
          parsePort(profile.port, "数据库端口"),
          profile.host,
        ),
    })

    return {
      client,
      closeTransport: async () => {
        ssh.end()
      },
    }
  } catch (error) {
    ssh.end()
    throw error
  }
}

async function createMySqlClient(
  profile: ConfigProfile,
): Promise<ConnectedMySqlClient> {
  if (!profile.ssh) {
    return connectDirectMySql(profile)
  }

  return connectMySqlViaSsh(profile)
}

async function queryRows<T extends RowDataPacket>(
  client: MySqlConnection,
  sql: string,
  values?: unknown[],
): Promise<T[]> {
  const [rows] = await client.query<T[]>(sql, values)
  return Array.isArray(rows) ? rows : []
}

async function inspectMySqlClient(
  client: MySqlConnection,
): Promise<DbSchema[]> {
  const [schemaRow] = await queryRows<RowDataPacket & { schema_name: string }>(
    client,
    "SELECT DATABASE() AS schema_name",
  )
  const schemaName = schemaRow?.schema_name

  if (!schemaName) {
    return []
  }

  const tables = await queryRows<TableRow>(
    client,
    `
      SELECT
        TABLE_SCHEMA AS schema_name,
        TABLE_NAME AS table_name,
        TABLE_ROWS AS row_count
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `,
    [schemaName],
  )

  const columns = await queryRows<ColumnRow>(
    client,
    `
      SELECT
        c.TABLE_SCHEMA AS schema_name,
        c.TABLE_NAME AS table_name,
        c.ORDINAL_POSITION AS ordinal_position,
        c.COLUMN_NAME AS column_name,
        c.COLUMN_TYPE AS data_type,
        CASE WHEN pk.COLUMN_NAME IS NULL THEN 0 ELSE 1 END AS is_primary_key,
        CASE WHEN fk.COLUMN_NAME IS NULL THEN 0 ELSE 1 END AS is_foreign_key
      FROM information_schema.COLUMNS c
      LEFT JOIN (
        SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ?
          AND CONSTRAINT_NAME = 'PRIMARY'
      ) pk
        ON pk.TABLE_SCHEMA = c.TABLE_SCHEMA
       AND pk.TABLE_NAME = c.TABLE_NAME
       AND pk.COLUMN_NAME = c.COLUMN_NAME
      LEFT JOIN (
        SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ?
          AND REFERENCED_TABLE_NAME IS NOT NULL
      ) fk
        ON fk.TABLE_SCHEMA = c.TABLE_SCHEMA
       AND fk.TABLE_NAME = c.TABLE_NAME
       AND fk.COLUMN_NAME = c.COLUMN_NAME
      WHERE c.TABLE_SCHEMA = ?
      ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
    `,
    [schemaName, schemaName, schemaName],
  )

  const views = await queryRows<ViewRow>(
    client,
    `
      SELECT
        TABLE_SCHEMA AS schema_name,
        TABLE_NAME AS view_name
      FROM information_schema.VIEWS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME
    `,
    [schemaName],
  )

  const functions = await queryRows<FunctionRow>(
    client,
    `
      SELECT
        ROUTINE_SCHEMA AS schema_name,
        ROUTINE_NAME AS function_name
      FROM information_schema.ROUTINES
      WHERE ROUTINE_SCHEMA = ?
      ORDER BY ROUTINE_TYPE, ROUTINE_NAME
    `,
    [schemaName],
  )

  const schema: DbSchema = {
    name: schemaName,
    tables: [],
    views: [],
    functions: [],
  }
  const tableMap = new Map<string, DbTable>()

  for (const tableRow of tables) {
    const table: DbTable = {
      name: tableRow.table_name,
      rowCount: toRowCount(tableRow.row_count),
      columns: [],
    }
    schema.tables.push(table)
    tableMap.set(tableRow.table_name, table)
  }

  for (const columnRow of columns) {
    const table = tableMap.get(columnRow.table_name)
    if (!table) {
      continue
    }

    table.columns.push({
      name: columnRow.column_name,
      type: columnRow.data_type,
      pk: columnRow.is_primary_key === 1 || undefined,
      fk: columnRow.is_foreign_key === 1 || undefined,
    })
  }

  for (const viewRow of views) {
    schema.views.push({ name: viewRow.view_name })
  }

  for (const functionRow of functions) {
    schema.functions.push({ name: functionRow.function_name })
  }

  return [schema]
}

function toMySqlRowCount(result: ResultSetHeader): number | undefined {
  return toQueryRowCount(result.affectedRows)
}

async function queryMySqlClient(
  client: MySqlConnection,
  sql: string,
): Promise<QueryResult> {
  const [rows, fields] = await client.query({
    sql,
    rowsAsArray: true,
  })

  if (Array.isArray(rows)) {
    const queryFields = Array.isArray(fields) ? (fields as FieldPacket[]) : []

    return {
      columns: createQueryColumns(queryFields.map((field) => field.name)),
      rows: rows as unknown[][],
      rowCount: toQueryRowCount(rows.length),
    }
  }

  return {
    columns: [],
    rows: [],
    rowCount: toMySqlRowCount(rows as ResultSetHeader),
  }
}

export async function connectMySql(
  profile: ConfigProfile,
): Promise<ConnectionSession> {
  const { client, closeTransport } = await createMySqlClient(profile)
  const notifier = createCloseNotifier()
  let closed = false
  let closePromise: Promise<void> | null = null

  const close = async () => {
    if (closePromise) {
      return closePromise
    }

    closePromise = (async () => {
      if (closed) {
        return
      }

      closed = true
      client.off("error", handleDidClose)
      client.off("end", handleDidClose)
      client.off("close", handleDidClose)

      await client.end().catch(() => {
        client.destroy()
      })
      await closeTransport().catch(() => undefined)
      notifier.notify()
    })()

    await closePromise
  }

  const handleDidClose = () => {
    void close()
  }

  client.on("error", handleDidClose)
  client.on("end", handleDidClose)
  client.on("close", handleDidClose)

  return {
    inspect() {
      return inspectMySqlClient(client)
    },
    query(sql) {
      return queryMySqlClient(client, sql)
    },
    close,
    onDidClose(listener) {
      return notifier.onDidClose(listener)
    },
  }
}
