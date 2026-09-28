import { writeFile } from "node:fs/promises"
import { BrowserWindow, clipboard, dialog } from "electron"
import type { SaveTextFileOptions } from "@/contracts/system"

export function writeClipboardText(text: string): void {
  clipboard.writeText(text)
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
