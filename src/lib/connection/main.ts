import { ipcMain } from "electron"
import type { CreateConnection, UpdateConnection } from "./index"
import {
  createConnection,
  deleteConnection,
  getConnection,
  listConnections,
  updateConnection,
} from "./index"

export function registerHandlers(): void {
  ipcMain.handle("connection:list", () => listConnections())
  ipcMain.handle("connection:get", (_e, id: string) => getConnection(id))
  ipcMain.handle("connection:create", (_e, input: CreateConnection) =>
    createConnection(input),
  )
  ipcMain.handle(
    "connection:update",
    (_e, id: string, input: UpdateConnection) => updateConnection(id, input),
  )
  ipcMain.handle("connection:delete", (_e, id: string) => deleteConnection(id))
}
