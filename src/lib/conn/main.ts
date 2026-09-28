import { randomUUID } from "node:crypto"
import { BrowserWindow, dialog, ipcMain } from "electron"
import Store from "electron-store"
import {
  CANCEL,
  CLOSE_SESSION,
  CLOSE_TAB,
  CONNECT,
  type Config,
  type ConfigProfile,
  CREATE,
  type CreateConfig,
  DISCONNECT,
  GET,
  INSPECT,
  LIST,
  OPEN_SESSION,
  QUERY,
  REMOVE,
  SELECT,
  type SelectQuery,
  SYNC,
  TEST,
  UPDATE,
  type UpdateConfig,
} from "."
import { connectDriver } from "./driver"
import { Sessions } from "./sessions"

const store = new Store<{ configs: Record<string, Config> }>({
  name: "configs",
})

export const sessions = new Sessions({
  configs: () => Object.values(store.get("configs", {})),
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

function create(input: CreateConfig): Config {
  const now = Date.now()
  const config: Config = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  }
  store.set(`configs.${config.id}`, config)
  return config
}

function update(id: string, input: UpdateConfig): Config {
  const current = store.get(`configs.${id}`)
  if (!current) throw new Error("连接不存在或已删除")
  if (sessions.hasResources(id)) throw new Error("连接尚未关闭，请先断开连接")
  const config = { ...current, ...input, id, updatedAt: Date.now() }
  sessions.forget(id)
  store.set(`configs.${id}`, config)
  return config
}

export function initConn(): void {
  ipcMain.handle(TEST, async (_e, profile: ConfigProfile) => {
    const client = await connectDriver(profile)
    await client.close()
  })
  ipcMain.handle(LIST, (e) => sessions.snapshot(e.sender.id))
  ipcMain.handle(SYNC, (e) => sessions.snapshot(e.sender.id))
  ipcMain.handle(GET, (e) => sessions.snapshot(e.sender.id))
  ipcMain.handle(CREATE, (e, input: CreateConfig) =>
    sessions.respond(e.sender.id, () => create(input)),
  )
  ipcMain.handle(UPDATE, (e, id: string, input: UpdateConfig) =>
    sessions.respond(e.sender.id, () => update(id, input)),
  )
  ipcMain.handle(REMOVE, (e, id: string) =>
    sessions.respond(e.sender.id, () => {
      if (sessions.hasResources(id))
        throw new Error("连接尚未关闭，请先断开连接")
      sessions.forget(id)
      store.delete(`configs.${id}`)
    }),
  )
  ipcMain.handle(CONNECT, (e, id: string) =>
    sessions.respond(e.sender.id, () => sessions.connect(id, e.sender.id)),
  )
  ipcMain.handle(DISCONNECT, (e, id: string) =>
    sessions.respond(e.sender.id, () => sessions.disconnect(id, e.sender.id)),
  )
  ipcMain.handle(INSPECT, (e, id: string) =>
    sessions.respond(e.sender.id, () => sessions.inspect(id, e.sender.id)),
  )
  ipcMain.handle(OPEN_SESSION, (e, id: string, tabId: string) =>
    sessions.respond(e.sender.id, () => sessions.open(id, e.sender.id, tabId)),
  )
  ipcMain.handle(CLOSE_SESSION, (e, id: string) =>
    sessions.respond(e.sender.id, () => sessions.closeSession(id, e.sender.id)),
  )
  ipcMain.handle(CLOSE_TAB, (e, tabId: string) =>
    sessions.respond(e.sender.id, () => sessions.closeTab(e.sender.id, tabId)),
  )
  ipcMain.handle(QUERY, (e, id: string, requestId: string, sql: string) =>
    sessions.respond(e.sender.id, () =>
      sessions.query(id, e.sender.id, requestId, sql),
    ),
  )
  ipcMain.handle(
    SELECT,
    (e, id: string, tabId: string, requestId: string, query: SelectQuery) =>
      sessions.respond(e.sender.id, () =>
        sessions.select(id, e.sender.id, tabId, requestId, query),
      ),
  )
  ipcMain.handle(CANCEL, (e, id: string) =>
    sessions.respond(e.sender.id, () => sessions.cancel(id, e.sender.id)),
  )
}
