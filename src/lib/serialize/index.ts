export const WRITE_CLIPBOARD_TEXT = "serialize:write-clipboard-text"
export const SAVE_TEXT_FILE = "serialize:save-text-file"

export interface SerializeSaveFilter {
  name: string
  extensions: string[]
}

export interface SaveTextFileOptions {
  defaultPath?: string
  filters?: SerializeSaveFilter[]
  content: string
}
