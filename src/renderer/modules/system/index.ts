import type { SaveTextFileOptions } from "@/contracts/system"

const serialize = {
  writeClipboardText(text: string): Promise<void> {
    return window.main.serialize.writeClipboardText(text)
  },
  saveTextFile(options: SaveTextFileOptions): Promise<string | null> {
    return window.main.serialize.saveTextFile(options)
  },
}

export default serialize
