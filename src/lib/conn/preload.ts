import { ipcRenderer } from "electron"
import type { ConfigProfile, CreateConfig, UpdateConfig } from "."
import {
  CONNECT,
  CREATE,
  DISCONNECT,
  GET,
  INSPECT,
  LIST,
  QUERY,
  REMOVE,
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
  query: (configId: string, sql: string) => {
    return ipcRenderer.invoke(QUERY, configId, sql)
  },
}

export default conn
