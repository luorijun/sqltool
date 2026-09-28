import { useState } from "react"
import type { Config } from "@/contracts/database"
import { ScrollArea } from "@/renderer/components/ui/scroll-area"
import { cn } from "@/renderer/components/ui/utils"
import { ConnList } from "./conn"
import { ConnDialog } from "./dialog"
import { SidebarHeader } from "./header"

type DialogMode = "create" | "edit" | null

export default function Sidebar(props: { className?: string }) {
  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
  const [dialogTarget, setDialogTarget] = useState<Config | null>(null)

  const openCreateDialog = () => {
    setDialogTarget(null)
    setDialogMode("create")
  }

  const openEditDialog = (conn: Config) => {
    setDialogTarget(conn)
    setDialogMode("edit")
  }

  const closeDialog = () => {
    setDialogMode(null)
    setDialogTarget(null)
  }

  return (
    <nav
      className={cn(
        "bg-sidebar text-sidebar-foreground flex flex-col overflow-hidden",
        props.className,
      )}
    >
      <SidebarHeader onCreate={openCreateDialog} />

      <ScrollArea>
        <ConnList onEdit={openEditDialog} />
      </ScrollArea>

      <ConnDialog mode={dialogMode} conn={dialogTarget} onClose={closeDialog} />
    </nav>
  )
}
