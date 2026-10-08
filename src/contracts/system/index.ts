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

export interface SystemApi {
  writeClipboardText(text: string): Promise<void>
  saveTextFile(options: SaveTextFileOptions): Promise<string | null>
}
