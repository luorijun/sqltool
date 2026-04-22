import { ipcRenderer } from "electron"
import type { CreateConfig, UpdateConfig } from "."
import { CREATE, GET, LIST, REMOVE, UPDATE } from "."

export const bridge = {
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
}
