import { ipcRenderer } from "electron"
import {
  SAVE_TEXT_FILE,
  type SaveTextFileOptions,
  WRITE_CLIPBOARD_TEXT,
} from "."

export const bridge = {
  writeClipboardText: (text: string) => {
    return ipcRenderer.invoke(WRITE_CLIPBOARD_TEXT, text)
  },
  saveTextFile: (options: SaveTextFileOptions) => {
    return ipcRenderer.invoke(SAVE_TEXT_FILE, options) as Promise<string | null>
  },
}
