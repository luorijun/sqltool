import { ipcRenderer } from "electron"
import type { Config } from "../config"
import { INSPECT, QUERY, TEST } from "."

export const bridge = {
  test: (conn: Config) => {
    return ipcRenderer.invoke(TEST, conn)
  },
  inspect: (conn: Config) => {
    return ipcRenderer.invoke(INSPECT, conn)
  },
  query: (conn: Config, sql: string) => {
    return ipcRenderer.invoke(QUERY, conn, sql)
  },
}
