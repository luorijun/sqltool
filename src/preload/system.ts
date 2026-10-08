import type { Invoke } from "./invoke"
export const WRITE_CLIPBOARD_TEXT = "system:write-clipboard-text"
export const SAVE_TEXT_FILE = "system:save-text-file"

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface SaveTextFileOptions {
  defaultPath?: string
  filters?: FileFilter[]
  content: string
}

export function createSystemBridge(invoke: Invoke) {
  return {
    writeClipboardText: (text: string) =>
      invoke<void>(WRITE_CLIPBOARD_TEXT, text),
    saveTextFile: (options: SaveTextFileOptions) =>
      invoke<string | null>(SAVE_TEXT_FILE, options),
  }
}
