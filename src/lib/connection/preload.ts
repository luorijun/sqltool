import { ipcRenderer } from "electron"
import type { CreateConnection, UpdateConnection } from "./index"

export const bridge = {
  list: () => ipcRenderer.invoke("connection:list"),
  get: (id: string) => ipcRenderer.invoke("connection:get", id),
  create: (input: CreateConnection) =>
    ipcRenderer.invoke("connection:create", input),
  update: (id: string, input: UpdateConnection) =>
    ipcRenderer.invoke("connection:update", id, input),
  delete: (id: string) => ipcRenderer.invoke("connection:delete", id),
}
