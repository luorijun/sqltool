import { ipcRenderer } from "electron"
import type { ConfigProfile } from "../config"
import { CONNECT, DISCONNECT, INSPECT, LIST, QUERY, TEST } from "."

export const bridge = {
  test: (profile: ConfigProfile) => {
    return ipcRenderer.invoke(TEST, profile)
  },
  list: () => {
    return ipcRenderer.invoke(LIST)
  },
  connect: (configId: string) => {
    return ipcRenderer.invoke(CONNECT, configId)
  },
  disconnect: (configId: string) => {
    return ipcRenderer.invoke(DISCONNECT, configId)
  },
  inspect: (configId: string) => {
    return ipcRenderer.invoke(INSPECT, configId)
  },
  query: (configId: string, sql: string) => {
    return ipcRenderer.invoke(QUERY, configId, sql)
  },
}
