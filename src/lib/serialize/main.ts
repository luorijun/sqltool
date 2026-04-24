import { writeFile } from "node:fs/promises"
import type { IpcMainInvokeEvent } from "electron"
import { BrowserWindow, clipboard, dialog, ipcMain } from "electron"
import {
  SAVE_TEXT_FILE,
  type SaveTextFileOptions,
  WRITE_CLIPBOARD_TEXT,
} from "."

async function saveTextFile(
  event: IpcMainInvokeEvent,
  options: SaveTextFileOptions,
): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    defaultPath: options.defaultPath,
    filters: options.filters,
  })

  if (canceled || !filePath) {
    return null
  }

  await writeFile(filePath, options.content, "utf8")
  return filePath
}

export function registerHandlers(): void {
  ipcMain.handle(WRITE_CLIPBOARD_TEXT, (_event, text: string) => {
    clipboard.writeText(text)
  })
  ipcMain.handle(SAVE_TEXT_FILE, (event, options: SaveTextFileOptions) =>
    saveTextFile(event, options),
  )
}
