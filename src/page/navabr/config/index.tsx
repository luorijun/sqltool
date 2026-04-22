import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import type { Config } from "@/lib/config"
import configApi from "@/lib/config/renderer"
import { ConnDialog } from "./conn-dialog"
import { ConfigExplorer } from "./explorer"
import { ConfigHeader } from "./header"

export interface ConfigViewProps {
  onConnect: (conn: Config) => void
}

type DialogMode = "create" | "edit" | null

export default function ConfigView({ onConnect }: ConfigViewProps) {
  const [connections, setConnections] = useState<Config[]>([])
  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
  const [dialogTarget, setDialogTarget] = useState<Config | null>(null)

  const load = useCallback(async () => {
    try {
      const list = await configApi.list()
      setConnections(list)
    } catch {
      toast.error("加载连接列表失败")
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

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

  const handleDelete = async (conn: Config) => {
    try {
      await configApi.remove(conn.id)
      load()
      toast.success(`"${conn.name ?? "连接"}" 已删除`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    }
  }

  const handleSaved = () => {
    closeDialog()
    load()
  }

  return (
    <>
      <ConfigHeader onCreate={openCreateDialog} onRefresh={load} />
      <ConfigExplorer
        connections={connections}
        onSelect={onConnect}
        onEdit={openEditDialog}
        onDelete={handleDelete}
      />

      <ConnDialog
        mode={dialogMode}
        conn={dialogTarget}
        onClose={closeDialog}
        onSaved={handleSaved}
      />
    </>
  )
}
