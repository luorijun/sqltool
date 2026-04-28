import { ipcMain } from "electron"
import type { Config, CreateConfig } from "../config"
import { INSPECT, QUERY, TEST } from "."
import { inspectPostgres, queryPostgres, testPostgres } from "./postgres"

async function test(conn: CreateConfig) {
  if (conn.driver !== "postgres") {
    throw new Error("当前仅支持 PostgreSQL 连接测试")
  }

  await testPostgres({
    ...conn,
    id: "",
    createdAt: 0,
    updatedAt: 0,
  })
}

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
  ipcMain.handle(TEST, (_e, conn: Config) => test(conn))
  ipcMain.handle(INSPECT, (_e, conn: Config) => inspect(conn))
  ipcMain.handle(QUERY, (_e, conn: Config, sql: string) => query(conn, sql))
}
