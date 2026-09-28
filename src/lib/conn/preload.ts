import { ipcRenderer } from "electron"
import type { ConfigProfile, CreateConfig, SelectQuery, UpdateConfig } from "."
import {
  CANCEL,
  CLOSE_SESSION,
  CLOSE_TAB,
  CONNECT,
  CREATE,
  DISCONNECT,
  GET,
  INSPECT,
  LIST,
  OPEN_SESSION,
  QUERY,
  REMOVE,
  SELECT,
  SYNC,
  TEST,
  UPDATE,
} from "."

const conn = {
  test: (profile: ConfigProfile) => {
    return ipcRenderer.invoke(TEST, profile)
  },
  list: () => {
    return ipcRenderer.invoke(LIST)
  },
  get: (id: string) => {
    return ipcRenderer.invoke(GET, id)
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
  closeSession: (sessionId: string) =>
    ipcRenderer.invoke(CLOSE_SESSION, sessionId),
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
