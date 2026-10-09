import type { Invoke } from "./invoke"
export const WRITE_CLIPBOARD_TEXT = "system:write-clipboard-text"
export const CONFIRM_CHANGES = "system:confirm-changes"
export const SET_DIRTY = "system:set-dirty"
export type ChangeChoice = "submit" | "discard" | "cancel"
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
    confirmChanges: (canSubmit: boolean) =>
      invoke<ChangeChoice>(CONFIRM_CHANGES, canSubmit),
    setDirty: (dirty: boolean) => invoke<void>(SET_DIRTY, dirty),
    writeClipboardText: (text: string) =>
      invoke<void>(WRITE_CLIPBOARD_TEXT, text),
    saveTextFile: (options: SaveTextFileOptions) =>
      invoke<string | null>(SAVE_TEXT_FILE, options),
  }
}
