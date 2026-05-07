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

export function DriverIcon({ driver }: { driver: string }) {
  if (driver === "sqlite") return <HardDrive className="size-4 shrink-0" />
  if (driver === "mysql") return <Server className="size-4 shrink-0" />
  return <Database className="size-4 shrink-0" />
}

export function ConnList(props: { onEdit: (conn: Config) => void }) {
  const connections = useAtomValue(connectionEntriesAtom)
  const hasLoadedConnections = useAtomValue(hasLoadedConnectionsAtom)
  const loading = !hasLoadedConnections && connections.length === 0

  return loading ? (
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
            onEdit={() => props.onEdit(config)}
          />
        </li>
      ))}
    </ul>
  )
}

function ConnectionItem(props: {
  conn: Config
  state: ConnectionState
  onRefreshSchema: () => void
  onNewQuery: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const name = props.conn.name ?? "未命名"
  const [expanded, setExpanded] = useState(false)

  const connectConnection = useSetAtom(connectConnectionAtom)
  const handleConnect = async () => {
    setExpanded(true)

    try {
      await connectConnection(props.conn.id)
      toast.success(`"${name}" 已连接`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "连接失败")
    }
  }

  const disconnectConnection = useSetAtom(disconnectConnectionAtom)
  const handleDisconnect = () => {
    disconnectConnection(props.conn.id)
    toast.success(`"${name}" 已断开`)
  }

  const refreshConnectionSchema = useSetAtom(refreshConnectionSchemaAtom)
  const onRefreshSchema = async () => {
    setExpanded(true)
    try {
      await refreshConnectionSchema(props.conn.id)
      toast.success(`"${name}" 结构已刷新`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "刷新数据库结构失败")
    }
  }

  const deleteConnectionConfig = useSetAtom(deleteConnectionConfigAtom)
  const onDelete = async () => {
    try {
      await deleteConnectionConfig(props.conn.id)
      toast.success(`"${name}" 已删除`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    }
  }

  const createTab = useSetAtom(createTabAtom)
  const onNewQuery = () => {
    createTab({ configId: props.conn.id })
  }

  const isConnected = props.state.status === "connected"
  const isBusy =
    props.state.status === "connecting" ||
    props.state.schemaStatus === "loading"

  return (
    <div className="flex flex-col pl-2 pr-3.5 gap-1">
      <div className={cn("sticky top-0 bg-sidebar z-10 flex-none")}>
        <div className="size-full rounded-md hover:bg-primary/10 transition-colors duration-250 ease-in-out group flex items-stretch p-1.5 gap-1">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left"
            onClick={() => setExpanded((v) => !v)}
          >
            <span className="text-muted-foreground/60">
              {expanded ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </span>

            <span className="text-muted-foreground group-hover:text-foreground">
              <DriverIcon driver={props.conn.driver} />
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight">
                {props.conn.name ?? "未命名"}
                <ConnectionStatusBadge state={props.state} />
              </p>
              <p className="truncate text-xs leading-tight text-muted-foreground">
                {props.conn.database}
                <span className="mx-1">·</span>
                {driverLabel[props.conn.driver] ?? props.conn.driver}
                {props.conn.ssh ? " · SSH" : ""}
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
                handleDisconnect()
              } else {
                handleConnect()
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
                    handleDisconnect()
                  } else {
                    handleConnect()
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
                disabled={props.state.status === "connecting"}
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
          {props.state.error ? (
            <div
              className={cn(
                "flex items-center gap-2 border-b px-3 py-2 text-xs",
                props.state.status === "error"
                  ? "bg-destructive/5 text-destructive"
                  : "bg-amber-500/8 text-amber-700 dark:text-amber-400",
              )}
            >
              <TriangleAlert className="size-3.5 shrink-0" />
              <span>{props.state.error}</span>
            </div>
          ) : null}

          <SchemaPanel
            conn={props.conn}
            status={props.state.status}
            schemaStatus={props.state.schemaStatus}
            error={props.state.error}
            schemas={props.state.schema}
            onConnect={handleConnect}
            onRefresh={onRefreshSchema}
            onNewQuery={onNewQuery}
          />
        </div>
      )}
    </div>
  )
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
