import { BrowserWindow, dialog } from "electron"
import Store from "electron-store"
import type { Config } from "@/contracts/database"
import { connectDriver, createDatabase } from "@/main/database"

const store = new Store<{ configs: Record<string, Config> }>({
  name: "configs",
})
export const database = createDatabase({
  connect: connectDriver,
  store: {
    list: () => Object.values(store.get("configs", {})),
    get: (id) => store.get(`configs.${id}`),
    set: (config) => store.set(`configs.${config.id}`, config),
    remove: (id) => store.delete(`configs.${id}`),
  },
  async confirm(owner, message, detail, force) {
    const window = BrowserWindow.getAllWindows().find(
      (w) => w.webContents.id === owner,
    )
    if (!window || window.isDestroyed()) return false
    const result = await dialog.showMessageBox(window, {
      type: "warning",
      message,
      detail,
      buttons: ["返回", force ? "强制断开" : "回滚并关闭"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    return result.response === 1
  },
})
