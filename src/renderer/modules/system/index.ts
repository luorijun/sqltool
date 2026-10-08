import type { SaveTextFileOptions } from "@/preload/bridge"

const system = {
  writeClipboardText(text: string): Promise<void> {
    return window.main.system.writeClipboardText(text)
  },
  saveTextFile(options: SaveTextFileOptions): Promise<string | null> {
    return window.main.system.saveTextFile(options)
  },
}

export default system
