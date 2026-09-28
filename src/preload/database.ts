import { ipcRenderer } from "electron"
import type {
  ConfigProfile,
  CreateConfig,
  DatabaseApi,
  SelectQuery,
  UpdateConfig,
} from "@/contracts/database"
import {
  CANCEL,
  CLOSE_TAB,
  CONNECT,
  CREATE,
  DISCONNECT,
  INSPECT,
  OPEN_SESSION,
  QUERY,
  REMOVE,
  SELECT,
  SYNC,
  TEST,
  UPDATE,
} from "@/contracts/database"

const conn: DatabaseApi = {
  test: (profile: ConfigProfile) => {
    return ipcRenderer.invoke(TEST, profile)
  },
  create: (input: CreateConfig) => {
    return ipcRenderer.invoke(CREATE, input)
  },
  update: (id: string, input: UpdateConfig) => {
    return ipcRenderer.invoke(UPDATE, id, input)
  },
  remove: (id: string) => {
    return ipcRenderer.invoke(REMOVE, id)
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
  sync: () => ipcRenderer.invoke(SYNC),
  openSession: (configId: string, tabId: string) =>
    ipcRenderer.invoke(OPEN_SESSION, configId, tabId),
  closeTab: (tabId: string) => ipcRenderer.invoke(CLOSE_TAB, tabId),
  cancel: (requestId: string) => ipcRenderer.invoke(CANCEL, requestId),
  query: (sessionId: string, requestId: string, sql: string) => {
    return ipcRenderer.invoke(QUERY, sessionId, requestId, sql)
  },
  select: (
    configId: string,
    tabId: string,
    requestId: string,
    query: SelectQuery,
  ) => {
    return ipcRenderer.invoke(SELECT, configId, tabId, requestId, query)
  },
}

export default conn
