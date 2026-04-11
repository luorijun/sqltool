import { ipcRenderer } from "electron"
import type { CreateConfig, UpdateConfig } from "./index"

export const bridge = {
  list: () => ipcRenderer.invoke("config:list"),
  get: (id: string) => ipcRenderer.invoke("config:get", id),
  create: (input: CreateConfig) => ipcRenderer.invoke("config:create", input),
  update: (id: string, input: UpdateConfig) =>
    ipcRenderer.invoke("config:update", id, input),
  delete: (id: string) => ipcRenderer.invoke("config:delete", id),
}
