import { ipcMain } from "electron"
import type { Config } from "../config"
import { INSPECT, QUERY } from "."
import { inspectPostgres, queryPostgres } from "./postgres"

async function inspect(conn: Config) {
  if (conn.driver !== "postgres") {
    throw new Error("当前仅支持 PostgreSQL 结构浏览")
  }

  return inspectPostgres(conn)
}

async function query(conn: Config, sql: string) {
  if (conn.driver !== "postgres") {
    throw new Error("当前仅支持 PostgreSQL 查询执行")
  }

  return queryPostgres(conn, sql)
}

export function registerHandlers(): void {
  ipcMain.handle(INSPECT, (_e, conn: Config) => inspect(conn))
  ipcMain.handle(QUERY, (_e, conn: Config, sql: string) => query(conn, sql))
}
