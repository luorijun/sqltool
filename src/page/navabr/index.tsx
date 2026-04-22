import { useSetAtom } from "jotai"
import { RefreshCw } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { addTabAtom } from "@/lib/tabs"
import type { Config } from "../../lib/config/index"
import config from "../../lib/config/renderer"
import { ConnectionItem } from "./conn-item"
import { DbExplorer } from "./db-explorer"
import { DbHeader } from "./db-header"
import { EditConnDialog } from "./edit-conn-dialog"

// ─── Props ────────────────────────────────────────────────────────────────────

export interface NavProps {
  /** Increment this value from the parent to trigger a connection list refresh */
  refreshKey?: number
  /** Called after a successful mutation so the parent can react if needed */
  onChanged?: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Nav({ refreshKey, onChanged }: NavProps) {
  const addTab = useSetAtom(addTabAtom)
  const [connections, setConnections] = useState<Config[]>([])
  const [activeConn, setActiveConn] = useState<Config | null>(null)
  const [editTarget, setEditTarget] = useState<Config | null>(null)
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0)

  // Accepts an ignored `_trigger` so callers can pass `refreshKey` as an
  // argument, making it visible to Biome's exhaustive-deps rule in useEffect.
  const load = useCallback(async (_trigger?: unknown) => {
    try {
      const list = await config.list()
      setConnections(list)
    } catch {
      toast.error("加载连接列表失败")
    }
  }, [])

  // Re-fetch on mount and whenever the parent bumps refreshKey.
  useEffect(() => {
    load(refreshKey)
  }, [load, refreshKey])

  const handleDelete = async (conn: Config) => {
    try {
      await config.delete(conn.id)
      setConnections((prev) => prev.filter((c) => c.id !== conn.id))
      if (activeConn?.id === conn.id) setActiveConn(null)
      toast.success(`"${conn.name ?? "连接"}" 已删除`)
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    }
  }

  return (
    <nav className="bg-sidebar border-r text-sidebar-foreground flex flex-col overflow-hidden">
      {activeConn ? (
        // ── Connected: show db explorer ──────────────────────────────────────
        <>
          <DbHeader
            conn={activeConn}
            onBack={() => setActiveConn(null)}
            onNewQuery={() => addTab({ connection: activeConn })}
            onRefresh={() => setExplorerRefreshKey((prev) => prev + 1)}
            onDisconnect={() => setActiveConn(null)}
            onEditConn={() => setEditTarget(activeConn)}
          />
          <DbExplorer
            key={activeConn.id}
            conn={activeConn}
            refreshKey={explorerRefreshKey}
          />
        </>
      ) : (
        // ── Disconnected: show connection list ───────────────────────────────
        <>
          {/* Header */}
          <div className="flex-none basis-10 overflow-hidden border-b px-3 py-2 flex items-center justify-between shrink-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              连接
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => load()}
              title="刷新连接列表"
            >
              <RefreshCw />
            </Button>
          </div>

          {/* Connection list */}
          <ScrollArea className="flex-auto">
            {connections.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                暂无连接
              </p>
            ) : (
              <ul className="space-y-0.5 p-2">
                {connections.map((conn) => (
                  <li key={conn.id}>
                    <ConnectionItem
                      conn={conn}
                      active={activeConn === conn}
                      onSelect={() => setActiveConn(conn)}
                      onEdit={() => setEditTarget(conn)}
                      onDelete={() => handleDelete(conn)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </>
      )}

      {/* Edit dialog — always mounted, can be triggered from either view */}
      <EditConnDialog
        conn={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={(savedConn) => {
          setEditTarget(null)
          setActiveConn((prev) => (prev?.id === savedConn.id ? savedConn : prev))
          load()
          onChanged?.()
        }}
      />
    </nav>
  )
}
