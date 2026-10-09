import { writeFile } from "node:fs/promises"
import { BrowserWindow, clipboard, dialog } from "electron"

type SaveTextFileOptions = {
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
  content: string
}

const dirtyWindows = new Map<number, boolean>()
export function hasResultChanges(owner: number) {
  return dirtyWindows.get(owner) ?? false
}
export function setResultChanges(owner: number, dirty: boolean) {
  const window = BrowserWindow.getAllWindows().find(
    (w) => w.webContents.id === owner,
  )
  if (!window) return
  if (!dirtyWindows.has(owner))
    window.once("closed", () => dirtyWindows.delete(owner))
  dirtyWindows.set(owner, dirty)
}

export async function confirmChanges(
  owner: number,
  canSubmit: boolean,
): Promise<"submit" | "discard" | "cancel"> {
  const window = BrowserWindow.getAllWindows().find(
    (w) => w.webContents.id === owner,
  )
  if (!window || window.isDestroyed()) return "cancel"
  const result = await dialog.showMessageBox(window, {
    type: "question",
    message: "当前结果有未提交的修改",
    detail: canSubmit
      ? "提交修改、放弃修改，或返回当前结果继续编辑。"
      : "包含仅本地修改或暂时无法提交的结果。可返回表格复制或导出修改后的数据。",
    buttons: canSubmit
      ? ["返回", "放弃修改", "提交修改"]
      : ["返回", "放弃修改"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  return result.response === 2 && canSubmit
    ? "submit"
    : result.response === 1
      ? "discard"
      : "cancel"
}

export function writeClipboardText(text: string): Promise<void> {
  return clipboard.writeText(text)
}
export async function saveTextFile(
  owner: number,
  options: SaveTextFileOptions,
): Promise<string | null> {
  const window = BrowserWindow.getAllWindows().find(
    (w) => w.webContents.id === owner,
  )
  if (!window || window.isDestroyed()) throw new Error("窗口已关闭")
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    defaultPath: options.defaultPath,
    filters: options.filters,
  })
  if (canceled || !filePath) return null
  await writeFile(filePath, options.content, "utf8")
  return filePath
}
