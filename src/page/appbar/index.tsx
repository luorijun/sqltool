import { Database } from "lucide-react"

export function AppBar() {
  return (
    <header className="relative z-60 bg-sidebar h-10 text-sm flex items-center px-3 gap-2 border-b box-content select-none [-webkit-app-region:drag]">
      <Database size={18} />
      <h1>SqlTool</h1>
    </header>
  )
}
