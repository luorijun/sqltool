import { ipcMain } from "electron"
import type { CreateConfig, UpdateConfig } from "./index"
import {
  createConfig,
  deleteConfig,
  getConfig,
  listConfigs,
  updateConfig,
} from "./index"

export function registerHandlers(): void {
  ipcMain.handle("config:list", () => listConfigs())
  ipcMain.handle("config:get", (_e, id: string) => getConfig(id))
  ipcMain.handle("config:create", (_e, input: CreateConfig) =>
    createConfig(input),
  )
  ipcMain.handle("config:update", (_e, id: string, input: UpdateConfig) =>
    updateConfig(id, input),
  )
  ipcMain.handle("config:delete", (_e, id: string) => deleteConfig(id))
}
