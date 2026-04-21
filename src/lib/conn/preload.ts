import { ipcRenderer } from "electron"
import type { Config } from "../config"
import { INSPECT } from "."

export const bridge = {
  inspect: (conn: Config) => {
    return ipcRenderer.invoke(INSPECT, conn)
  },
}
