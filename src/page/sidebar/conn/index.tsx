import { useAtomValue, useSetAtom } from "jotai"
import {
  ChevronDown,
  ChevronRight,
  Database,
  FilePlus2,
  HardDrive,
  LoaderCircle,
  LogIn,
  LogOut,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Server,
  Trash2,
  TriangleAlert,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Config } from "@/lib/config"
import {
  type ConnectionState,
  connectConnectionAtom,
  connectionEntriesAtom,
  deleteConnectionConfigAtom,
  disconnectConnectionAtom,
  hasLoadedConnectionsAtom,
  refreshConnectionSchemaAtom,
} from "@/lib/conn/state"
import { createTabAtom } from "@/lib/tabs/renderer"
import { cn } from "@/lib/utils"
import { SchemaPanel } from "../schema"

export const driverLabel: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
}

function toggleSetValue(current: Set<string>, value: string): Set<string> {
  const next = new Set(current)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }

  return next
}

function ensureExpanded(current: Set<string>, value: string): Set<string> {
  if (current.has(value)) {
    return current
  }

  const next = new Set(current)
  next.add(value)
  return next
}

function getConnName(conn: Config): string {
  return conn.name ?? "连接"
}

export function DriverIcon({ driver }: { driver: string }) {
  if (driver === "sqlite") return <HardDrive className="size-4 shrink-0" />
  if (driver === "mysql") return <Server className="size-4 shrink-0" />
  return <Database className="size-4 shrink-0" />
}

interface ConnectionItemProps {
  conn: Config
  state: ConnectionState
  expanded: boolean
  onToggleExpand: () => void
  onConnect: () => void
  onDisconnect: () => void
  onRefreshSchema: () => void
  onNewQuery: () => void
  onEdit: () => void
  onDelete: () => void
}

function ConnectionStatusBadge({ state }: { state: ConnectionState }) {
  if (state.status === "connecting") {
    return <Badge variant="warning">连接中</Badge>
  }

  if (state.status === "connected" && state.schemaStatus === "loading") {
    return <Badge variant="warning">刷新中</Badge>
  }

  if (state.status === "connected" && state.schemaStatus === "error") {
    return <Badge variant="warning">结构异常</Badge>
  }

  if (state.status === "connected") {
    return <Badge variant="success">已连接</Badge>
  }

  if (state.status === "error") {
    return <Badge variant="destructive">异常</Badge>
  }

  return <Badge variant="muted">未连接</Badge>
}

function ConnectionItem({
  conn,
  state,
  expanded,
  onToggleExpand,
  onConnect,
  onDisconnect,
  onRefreshSchema,
  onNewQuery,
  onEdit,
  onDelete,
}: ConnectionItemProps) {
  const isConnected = state.status === "connected"
  const isBusy =
    state.status === "connecting" || state.schemaStatus === "loading"

  return (
    <div className="flex flex-col pl-2 pr-3.5 gap-1">
      <div className={cn("sticky top-0 bg-sidebar z-10 flex-none")}>
        <div className="size-full rounded-md hover:bg-primary/10 transition-colors duration-250 ease-in-out group flex items-stretch p-1.5 gap-1">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left"
            onClick={onToggleExpand}
          >
            <span className="text-muted-foreground/60">
              {expanded ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </span>

            <span className="text-muted-foreground group-hover:text-foreground">
              <DriverIcon driver={conn.driver} />
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight">
                {conn.name ?? "未命名"}
                <ConnectionStatusBadge state={state} />
              </p>
              <p className="truncate text-xs leading-tight text-muted-foreground">
                {conn.database}
                <span className="mx-1">·</span>
                {driverLabel[conn.driver] ?? conn.driver}
                {conn.ssh ? " · SSH" : ""}
              </p>
            </div>
          </button>

          <Button
            variant={isConnected ? "ghost" : "secondary"}
            size="icon-xs"
            className="shrink-0"
            disabled={isBusy}
            onClick={(e) => {
              e.stopPropagation()
              if (isConnected) {
                onDisconnect()
              } else {
                onConnect()
              }
            }}
          >
            {isBusy ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : isConnected ? (
              <LogOut className="size-3" />
            ) : (
              <LogIn className="size-3" />
            )}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-xs" className="shrink-0" />
              }
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>

            <DropdownMenuContent side="right" align="start">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  if (isConnected) {
                    onDisconnect()
                  } else {
                    onConnect()
                  }
                }}
                disabled={isBusy}
              >
                {isConnected ? <LogOut /> : <LogIn />}
                {isConnected ? "断开连接" : "连接"}
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  onRefreshSchema()
                }}
                disabled={state.status === "connecting"}
              >
                <RefreshCw />
                刷新结构
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  onNewQuery()
                }}
              >
                <FilePlus2 />
                新建查询
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  onEdit()
                }}
              >
                <Pencil />
                编辑
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
              >
                <Trash2 />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {expanded && (
        <div className="overflow-hidden rounded-xl border bg-background/60">
          {state.error ? (
            <div
              className={cn(
                "flex items-center gap-2 border-b px-3 py-2 text-xs",
                state.status === "error"
                  ? "bg-destructive/5 text-destructive"
                  : "bg-amber-500/8 text-amber-700 dark:text-amber-400",
              )}
            >
              <TriangleAlert className="size-3.5 shrink-0" />
              <span className="truncate">{state.error}</span>
            </div>
          ) : null}

          <SchemaPanel
            conn={conn}
            status={state.status}
            schemaStatus={state.schemaStatus}
            error={state.error}
            schemas={state.schema}
            onConnect={onConnect}
            onRefresh={onRefreshSchema}
            onNewQuery={onNewQuery}
          />
        </div>
      )}
    </div>
  )
}

export function ConnList(props: { onEdit: (conn: Config) => void }) {
  const connections = useAtomValue(connectionEntriesAtom)
  const hasLoadedConnections = useAtomValue(hasLoadedConnectionsAtom)
  const loading = !hasLoadedConnections && connections.length === 0

  const connectConnection = useSetAtom(connectConnectionAtom)
  const disconnectConnection = useSetAtom(disconnectConnectionAtom)
  const refreshConnectionSchema = useSetAtom(refreshConnectionSchemaAtom)
  const deleteConnectionConfig = useSetAtom(deleteConnectionConfigAtom)
  const createTab = useSetAtom(createTabAtom)

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())

  const handleConnect = async (conn: Config) => {
    setExpandedIds((current) => ensureExpanded(current, conn.id))

    try {
      await connectConnection(conn.id)
      toast.success(`"${getConnName(conn)}" 已连接`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "连接失败")
    }
  }

  const handleDisconnect = (conn: Config) => {
    disconnectConnection(conn.id)
    toast.success(`"${getConnName(conn)}" 已断开`)
  }

  const handleRefreshSchema = async (conn: Config) => {
    setExpandedIds((current) => ensureExpanded(current, conn.id))

    try {
      await refreshConnectionSchema(conn.id)
      toast.success(`"${getConnName(conn)}" 结构已刷新`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "刷新数据库结构失败")
    }
  }

  const handleNewQuery = (conn: Config) => {
    createTab({ configId: conn.id })
  }

  const handleDelete = async (conn: Config) => {
    try {
      await deleteConnectionConfig(conn.id)
      setExpandedIds((current) => {
        if (!current.has(conn.id)) {
          return current
        }

        const next = new Set(current)
        next.delete(conn.id)
        return next
      })
      toast.success(`"${getConnName(conn)}" 已删除`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    }
  }

  const handleToggleExpand = (configId: string) => {
    setExpandedIds((current) => toggleSetValue(current, configId))
  }

  return (
    <ScrollArea className="flex-auto">
      {loading ? (
        <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          正在加载连接列表...
        </div>
      ) : connections.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          暂无连接
        </p>
      ) : (
        <ul className="flex flex-col py-2 gap-2">
          {connections.map(({ config, state }) => (
            <li key={config.id}>
              <ConnectionItem
                conn={config}
                state={state}
                expanded={expandedIds.has(config.id)}
                onToggleExpand={() => handleToggleExpand(config.id)}
                onConnect={() => handleConnect(config)}
                onDisconnect={() => handleDisconnect(config)}
                onRefreshSchema={() => handleRefreshSchema(config)}
                onNewQuery={() => handleNewQuery(config)}
                onEdit={() => props.onEdit(config)}
                onDelete={() => handleDelete(config)}
              />
            </li>
          ))}
        </ul>
      )}
    </ScrollArea>
  )
}
