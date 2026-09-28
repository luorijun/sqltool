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
  QueryResult,
  SelectQuery,
} from "@/contracts/database"
import type { ConnectionSession } from "../ports"
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

const MYSQL_FIELD_FLAGS = {
  NOT_NULL: 1,
  PRI_KEY: 2,
  BLOB: 16,
  UNSIGNED: 32,
  BINARY: 128,
  AUTO_INCREMENT: 512,
} as const

const MYSQL_TYPE_NAMES: Record<number, string> = {
  0: "decimal",
  1: "tinyint",
  2: "smallint",
  3: "int",
  4: "float",
  5: "double",
  6: "null",
  7: "timestamp",
  8: "bigint",
  9: "mediumint",
  10: "date",
  11: "time",
  12: "datetime",
  13: "year",
  15: "varchar",
  16: "bit",
  242: "vector",
  245: "json",
  246: "decimal",
  247: "enum",
  248: "set",
  249: "tinyblob",
  250: "mediumblob",
  251: "longblob",
  252: "blob",
  253: "varchar",
  254: "char",
  255: "geometry",
}

function getMySqlFieldTypeCode(field: FieldPacket): number | undefined {
  return field.columnType ?? field.type
}

function hasMySqlFlag(
  flags: FieldPacket["flags"],
  bit: number,
  name: string,
): boolean {
  if (Array.isArray(flags)) {
    return flags.includes(name)
  }

  return typeof flags === "number" && (flags & bit) !== 0
}

function getOptionalNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function getMySqlFieldDbType(field: FieldPacket): string | undefined {
  const code = getMySqlFieldTypeCode(field)
  if (code === undefined) {
    return field.typeName?.toLowerCase()
  }

  const binary = hasMySqlFlag(field.flags, MYSQL_FIELD_FLAGS.BINARY, "BINARY")
  const unsigned = hasMySqlFlag(
    field.flags,
    MYSQL_FIELD_FLAGS.UNSIGNED,
    "UNSIGNED",
  )
  const typeName = MYSQL_TYPE_NAMES[code]
  if (!typeName) {
    return field.typeName?.toLowerCase()
  }

  if (code === 0xfd) {
    return binary ? "varbinary" : "varchar"
  }

  if (code === 0xfe) {
    return binary ? "binary" : "char"
  }

  if (code >= 0xf9 && code <= 0xfc) {
    return binary ? typeName : typeName.replace("blob", "text")
  }

  if (
    unsigned &&
    [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x08, 0x09, 0xf6].includes(code)
  ) {
    return `${typeName} unsigned`
  }

  return typeName
}

function getMySqlFieldTypeFamily(
  field: FieldPacket,
): QueryColumnInput["typeFamily"] {
  const code = getMySqlFieldTypeCode(field)
  const binary = hasMySqlFlag(field.flags, MYSQL_FIELD_FLAGS.BINARY, "BINARY")

  switch (code) {
    case 0x00:
    case 0xf6:
      return "decimal"
    case 0x01:
    case 0x02:
    case 0x03:
    case 0x04:
    case 0x05:
    case 0x08:
    case 0x09:
    case 0x0d:
    case 0x10:
      return "number"
    case 0x07:
    case 0x0c:
      return "datetime"
    case 0x0a:
      return "date"
    case 0x0b:
      return "time"
    case 0xf5:
      return "json"
    case 0xf9:
    case 0xfa:
    case 0xfb:
      return binary ? "binary" : "string"
    case 0xfc:
      return binary ? "binary" : "string"
    case 0xfd:
    case 0xfe:
      return binary ? "binary" : "string"
    default:
      return "unknown"
  }
}

function createMySqlQueryColumn(field: FieldPacket): QueryColumnInput {
  const typeCode = getMySqlFieldTypeCode(field)
  const sourceColumn = field.orgName || undefined

  return {
    name: field.name,
    driver: "mysql",
    dbType: getMySqlFieldDbType(field),
    typeCode,
    typeFamily: getMySqlFieldTypeFamily(field),
    schema: field.schema || field.db || undefined,
    table: field.orgTable || field.table || undefined,
    sourceColumn,
    length: getOptionalNumber(field.columnLength ?? field.length),
    scale: getOptionalNumber(field.decimals),
    nullable: !hasMySqlFlag(
      field.flags,
      MYSQL_FIELD_FLAGS.NOT_NULL,
      "NOT_NULL",
    ),
    unsigned:
      hasMySqlFlag(field.flags, MYSQL_FIELD_FLAGS.UNSIGNED, "UNSIGNED") ||
      undefined,
    primaryKey:
      hasMySqlFlag(field.flags, MYSQL_FIELD_FLAGS.PRI_KEY, "PRI_KEY") ||
      undefined,
    autoIncrement:
      hasMySqlFlag(
        field.flags,
        MYSQL_FIELD_FLAGS.AUTO_INCREMENT,
        "AUTO_INCREMENT",
      ) || undefined,
  }
}

async function queryMySqlClient(
  client: MySqlConnection,
  sql: string,
  values: unknown[] = [],
): Promise<QueryResult> {
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
    inspect() {
      return inspectMySqlClient(client)
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
