import { ipcMain } from "electron"
import type { Config } from "../config"
import { INSPECT } from "."
import { inspectPostgres } from "./postgres"

async function inspect(conn: Config) {
  if (conn.driver !== "postgres") {
    throw new Error("当前仅支持 PostgreSQL 结构浏览")
  }

  return inspectPostgres(conn)
}

export function registerHandlers(): void {
  ipcMain.handle(INSPECT, (_e, conn: Config) => inspect(conn))
}
