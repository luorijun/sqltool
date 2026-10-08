import { type IpcMainInvokeEvent, ipcMain } from "electron"
import { z } from "zod"
import type { Connections } from "@/main/connections"
import type { Connect } from "@/main/drivers"
import type { Sessions } from "@/main/sessions"
import { saveTextFile, writeClipboardText } from "@/main/system"
import type { Workspace } from "@/main/workspace"
import * as bridge from "@/preload/bridge"
import { createDatabaseApi } from "./database"
import {
  config,
  file,
  id,
  profile,
  query,
  tableSource,
  text,
  updateConfig,
  workspaceSnapshot,
} from "./validation"

function owner(event: IpcMainInvokeEvent): number {
  if (
    event.sender.isDestroyed() ||
    event.senderFrame !== event.sender.mainFrame
  )
    throw new Error("无效的调用窗口")
  return event.sender.id
}

function handle<A extends unknown[]>(
  channel: string,
  schema: z.ZodType<A>,
  run: (owner: number, ...args: A) => unknown,
) {
  ipcMain.handle(channel, (event, ...args: unknown[]) =>
    run(owner(event), ...schema.parse(args)),
  )
}

export function registerIpc(services: {
  connections: Connections
  sessions: Sessions
  connect: Connect
  workspace: Workspace
}): void {
  const { connections, sessions, connect, workspace: workspaceApi } = services
  const api = (owner: number) =>
    createDatabaseApi(owner, connections, sessions, connect)
  handle(bridge.TEST, z.tuple([profile]), (owner, input) =>
    api(owner).test(input),
  )
  handle(bridge.SYNC, z.tuple([]), (owner) => api(owner).sync())
  handle(bridge.CREATE, z.tuple([config]), (owner, input) =>
    api(owner).create(input),
  )
  handle(bridge.UPDATE, z.tuple([id, updateConfig]), (owner, id, input) =>
    api(owner).update(id, input),
  )
  handle(bridge.REMOVE, z.tuple([id]), (owner, id) => api(owner).remove(id))
  handle(bridge.DISCONNECT, z.tuple([id]), (owner, id) =>
    api(owner).disconnect(id),
  )
  handle(
    bridge.INSPECT,
    z.tuple([id, tableSource.optional(), z.boolean().optional()]),
    (owner, id, source = undefined, refresh = false) =>
      api(owner).inspect(id, source, refresh),
  )
  handle(bridge.OPEN_SESSION, z.tuple([id, id]), (owner, id, tabId) =>
    api(owner).openSession(id, tabId),
  )
  handle(bridge.CLOSE_TAB, z.tuple([id]), (owner, tabId) =>
    api(owner).closeTab(tabId),
  )
  handle(bridge.QUERY, z.tuple([id, id, text]), (owner, id, requestId, sql) =>
    api(owner).query(id, requestId, sql),
  )
  handle(
    bridge.SELECT,
    z.tuple([id, id, id, query]),
    (owner, id, tabId, requestId, query) =>
      api(owner).select(id, tabId, requestId, query),
  )
  handle(bridge.CANCEL, z.tuple([id]), (owner, id) => api(owner).cancel(id))
  handle(bridge.WRITE_CLIPBOARD_TEXT, z.tuple([text]), (_owner, text) =>
    writeClipboardText(text),
  )
  handle(bridge.SAVE_TEXT_FILE, z.tuple([file]), saveTextFile)
  handle(bridge.LOAD_WORKSPACE, z.tuple([]), async () => {
    const snapshot = await workspaceApi.load()
    return snapshot ? workspaceSnapshot.parse(snapshot) : null
  })
  handle(
    bridge.SAVE_WORKSPACE,
    z.tuple([workspaceSnapshot]),
    (_owner, snapshot) => workspaceApi.save(snapshot),
  )
}
