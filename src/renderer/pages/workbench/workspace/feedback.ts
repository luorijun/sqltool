import { toast } from "sonner"
import type { SaveTextFileOptions } from "@/contracts/system"
import system from "@/renderer/modules/system"

export async function copyText(text: string, message: string): Promise<void> {
  try {
    await system.writeClipboardText(text)
    toast.success(message)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "复制失败")
  }
}
export async function saveText(options: SaveTextFileOptions): Promise<void> {
  try {
    const path = await system.saveTextFile(options)
    if (path) toast.success(`已导出到 ${path}`)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "导出失败")
  }
}
export function showError(message: string): void {
  toast.error(message)
}
