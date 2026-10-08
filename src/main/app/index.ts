import { app, BrowserWindow } from "electron"
import Store from "electron-store"
import type { Config } from "@/core/database"
import type { WorkspaceSnapshot } from "@/core/workspace"
import { createConfigStore } from "@/main/connections"
import { connectDriver } from "@/main/drivers"
import { registerIpc } from "@/main/ipc"
import { initUpdater } from "@/main/updater"
import { createWorkspace } from "@/main/workspace"
import { createServices } from "./services"
import { confirmClose, createWindow } from "./window"

const configStore = new Store<{ configs: Record<string, Config> }>({
  name: "configs",
})
const workspaceStore = new Store<{ snapshot: WorkspaceSnapshot }>({
  name: "workspace",
})
const services = createServices({
  store: createConfigStore(
    () => configStore.get("configs", {}),
    (configs) => configStore.set("configs", configs),
  ),
  connect: connectDriver,
  confirm: confirmClose,
})
const workspace = createWorkspace(
  () => workspaceStore.get("snapshot") ?? null,
  (snapshot) => workspaceStore.set("snapshot", snapshot),
)

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0)
    createWindow(services.sessions)
})
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
app.whenReady().then(() => {
  registerIpc({ ...services, connect: connectDriver, workspace })
  initUpdater()
  createWindow(services.sessions)
})
