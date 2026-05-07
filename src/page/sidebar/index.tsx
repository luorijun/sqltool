import { useSetAtom } from "jotai"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Config } from "@/lib/config"
import {
  ensureConnectionsLoadedAtom,
  refreshConnectionsAtom,
} from "@/lib/conn/renderer"
import { cn } from "@/lib/utils"
import { ConnList } from "./conn"
import { ConnDialog } from "./dialog"
import { SidebarHeader } from "./header"

type DialogMode = "create" | "edit" | null

export default function Sidebar(props: { className?: string }) {
  const ensureConnectionsLoaded = useSetAtom(ensureConnectionsLoadedAtom)
  const refreshConnections = useSetAtom(refreshConnectionsAtom)

  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
  const [dialogTarget, setDialogTarget] = useState<Config | null>(null)

  useEffect(() => {
    ensureConnectionsLoaded().catch(() => {
      toast.error("加载连接列表失败")
    })
  }, [ensureConnectionsLoaded])

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

  const handleSaved = async (_conn: Config) => {
    await refreshConnections()
    closeDialog()
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

      <ConnDialog
        mode={dialogMode}
        conn={dialogTarget}
        onClose={closeDialog}
        onSaved={(conn) => {
          handleSaved(conn).catch(() => {
            toast.error("刷新连接列表失败")
          })
        }}
      />
    </nav>
  )
}
