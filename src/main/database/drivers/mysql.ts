import type { RowDataPacket } from "mysql2"
import mysql, {
  type FieldPacket,
  type Connection as MySqlConnection,
  type ResultSetHeader,
} from "mysql2/promise"
import type {
  ConfigProfile,
  DbSchema,
  DbTable,
  SelectQuery,
  TableSource,
} from "@/contracts/database"
import type { ConnectionSession, DriverResult } from "../ports"
import { compileSelectQuery } from "../query"
import { withTimeout } from "../tasks"
import type { QueryColumnInput } from "./shared"
import {
  createConnectionSession,
  createQueryColumns,
  parsePort,
  toQueryRowCount,
  toRowCount,
} from "./shared"
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
  closeTransport?: () => void
}

function destroyMySqlClient(client: MySqlConnection): void {
  client.destroy()
  // mysql2's public destroy() only ends the socket; force cleanup must close it.
  const core = client as MySqlConnection & {
    connection: { stream: { destroy(): void } }
  }
  core.connection.stream.destroy()
}

async function connectDirectMySql(
  profile: ConfigProfile,
): Promise<ConnectedMySqlClient> {
  const port = parsePort(profile.port, "数据库端口")
  const client = await mysql.createConnection({
    host: profile.host,
    port,
    user: profile.username,
    password: profile.password,
    database: profile.database,
    connectTimeout: 20_000,
  })

  return { client }
}

async function connectMySqlViaSsh(
  profile: ConfigProfile,
): Promise<ConnectedMySqlClient> {
  if (!profile.ssh) {
    throw new Error("缺少 SSH 配置")
  }

  const ssh = await connectSshClient(profile.ssh)
  const port = parsePort(profile.port, "数据库端口")

  try {
    const client = await mysql.createConnection({
      host: profile.host,
      port,
      user: profile.username,
      password: profile.password,
      database: profile.database,
      connectTimeout: 20_000,
      stream: () => new SshTunnelStream(ssh).connect(port, profile.host),
    })

    return {
      client,
      closeTransport: () => {
        destroyMySqlClient(client)
        ssh.destroy()
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
  source?: TableSource,
): Promise<DbSchema[]> {
  const [schemaRow] = await queryRows<RowDataPacket & { schema_name: string }>(
    client,
    "SELECT DATABASE() AS schema_name",
  )
  const schemaName = schemaRow?.schema_name

  if (!schemaName) {
    return []
  }
  if (source && source.schema !== schemaName) {
    throw new Error("目标表不属于当前数据库")
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
        ${source ? "AND TABLE_NAME = ?" : ""}
      ORDER BY TABLE_NAME
    `,
    source ? [schemaName, source.table] : [schemaName],
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
        ${source ? "AND c.TABLE_NAME = ?" : ""}
      ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
    `,
    source
      ? [schemaName, schemaName, schemaName, source.table]
      : [schemaName, schemaName, schemaName],
  )

  const views = source
    ? []
    : await queryRows<ViewRow>(
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

  const functions = source
    ? []
    : await queryRows<FunctionRow>(
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

function createMySqlQueryColumn(field: FieldPacket): QueryColumnInput {
  if (typeof field.flags !== "number") throw new Error("无效的 MySQL 列标志")
  const flags = field.flags
  return {
    name: field.name,
    driver: "mysql",
    typeCode: field.columnType,
    typeFamily: "unknown",
    typeRef: {
      driver: "mysql",
      code: field.columnType,
      flags,
      charset: field.characterSet,
      length: field.columnLength,
      decimals: field.decimals,
      extendedType: field.extendedTypeName,
      extendedFormat: field.extendedFormat,
    },
    schema: field.schema || undefined,
    table: field.orgTable || undefined,
    sourceColumn: field.orgName || undefined,
    nullable: (flags & 1) === 0,
    unsigned: (flags & 32) !== 0 || undefined,
    primaryKey: (flags & 2) !== 0 || undefined,
    autoIncrement: (flags & 512) !== 0 || undefined,
  }
}

async function queryMySqlClient(
  client: MySqlConnection,
  sql: string,
  values: unknown[] = [],
): Promise<DriverResult> {
  const [rows, fields] = await client.query({
    sql,
    values,
    rowsAsArray: true,
  })

  if (Array.isArray(rows)) {
    const queryFields = Array.isArray(fields) ? (fields as FieldPacket[]) : []

    return {
      columns: createQueryColumns(queryFields.map(createMySqlQueryColumn)),
      rows: rows as unknown[][],
      rowCount: rows.length,
    }
  }

  return {
    columns: [],
    rows: [],
    rowCount: toQueryRowCount((rows as ResultSetHeader).affectedRows),
  }
}

export async function connectMySql(
  profile: ConfigProfile,
): Promise<ConnectionSession> {
  const { client, closeTransport } = await createMySqlClient(profile)

  return createConnectionSession({
    async charsets() {
      const rows = await queryRows<
        RowDataPacket & { id: number; width: number }
      >(
        client,
        `SELECT c.ID AS id, s.MAXLEN AS width
         FROM information_schema.COLLATIONS c
         JOIN information_schema.CHARACTER_SETS s
           ON s.CHARACTER_SET_NAME = c.CHARACTER_SET_NAME`,
      )
      return new Map(rows.map((row) => [Number(row.id), Number(row.width)]))
    },
    watch(fail) {
      client.on("error", fail)
      client.on("end", () => fail(new Error("数据库连接已断开")))
    },
    destroy() {
      destroyMySqlClient(client)
      closeTransport?.()
    },
    async cancel(active) {
      const control = await createMySqlClient(profile)
      try {
        if (active())
          await withTimeout(
            control.client.query(`KILL QUERY ${Number(client.threadId)}`),
          )
      } finally {
        destroyMySqlClient(control.client)
        control.closeTransport?.()
      }
    },
    inspect(source) {
      return inspectMySqlClient(client, source)
    },
    query(sql) {
      return queryMySqlClient(client, sql)
    },
    async select(query: SelectQuery) {
      const compiled = compileSelectQuery("mysql", query)
      return {
        result: await queryMySqlClient(client, compiled.sql, compiled.params),
        executedSql: compiled.sql,
      }
    },
    close: async () => {
      try {
        await client.end()
      } catch {
        destroyMySqlClient(client)
      } finally {
        closeTransport?.()
      }
    },
  })
}
