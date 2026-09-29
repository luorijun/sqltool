import { type IpcMainInvokeEvent, ipcMain } from "electron"
import { z } from "zod"
import * as db from "@/contracts/database"
import * as system from "@/contracts/system"
import type { Database } from "@/main/database"
import { saveTextFile, writeClipboardText } from "@/main/system"
import {
  config,
  file,
  id,
  profile,
  query,
  tableSource,
  text,
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

export function registerIpc(database: Database): void {
  const api = (owner: number) => database.forOwner(owner)
  handle(db.TEST, z.tuple([profile]), (owner, input) => api(owner).test(input))
  handle(db.SYNC, z.tuple([]), (owner) => api(owner).sync())
  handle(db.CREATE, z.tuple([config]), (owner, input) =>
    api(owner).create(input),
  )
  handle(db.UPDATE, z.tuple([id, config.partial()]), (owner, id, input) =>
    api(owner).update(id, input),
  )
  handle(db.REMOVE, z.tuple([id]), (owner, id) => api(owner).remove(id))
  handle(db.CONNECT, z.tuple([id]), (owner, id) => api(owner).connect(id))
  handle(db.DISCONNECT, z.tuple([id]), (owner, id) => api(owner).disconnect(id))
  handle(
    db.INSPECT,
    z.tuple([id, tableSource.optional()]),
    (owner, id, source) => api(owner).inspect(id, source),
  )
  handle(db.OPEN_SESSION, z.tuple([id, id]), (owner, id, tabId) =>
    api(owner).openSession(id, tabId),
  )
  handle(db.CLOSE_TAB, z.tuple([id]), (owner, tabId) =>
    api(owner).closeTab(tabId),
  )
  handle(db.QUERY, z.tuple([id, id, text]), (owner, id, requestId, sql) =>
    api(owner).query(id, requestId, sql),
  )
  handle(
    db.SELECT,
    z.tuple([id, id, id, query]),
    (owner, id, tabId, requestId, query) =>
      api(owner).select(id, tabId, requestId, query),
  )
  handle(db.CANCEL, z.tuple([id]), (owner, id) => api(owner).cancel(id))
  handle(system.WRITE_CLIPBOARD_TEXT, z.tuple([text]), (_owner, text) =>
    writeClipboardText(text),
  )
  handle(system.SAVE_TEXT_FILE, z.tuple([file]), saveTextFile)
}
