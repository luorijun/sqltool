import { useAtomValue, useSetAtom } from "jotai"
import {
  ChevronDown,
  ChevronRight,
  Database,
  FilePlus2,
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
import type { Config, Connection } from "@/lib/conn"
import {
  connectionActionAtom,
  connectConnectionAtom,
  connectionEntriesAtom,
  deleteConnectionAtom,
  disconnectConnectionAtom,
  refreshConnectionSchemaAtom,
} from "@/lib/conn/renderer"
import { createTabAtom } from "@/lib/tabs/renderer"
import { cn } from "@/lib/utils"
import { SchemaPanel } from "../schema"

export const driverLabel: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL / MariaDB",
}

export function DriverIcon({ driver }: { driver: string }) {
  if (driver === "mysql") return <Server className="size-4 shrink-0" />
  return <Database className="size-4 shrink-0" />
}

export function ConnList(props: { onEdit: (conn: Config) => void }) {
  const connections = useAtomValue(connectionEntriesAtom)
  const actions = useAtomValue(connectionActionAtom)
  const loading = connections === null

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
      {connections.map((connection) => {
        const action = actions[connection.config.id]

        return (
          <li key={connection.config.id}>
            <ConnectionItem
              connection={connection}
              action={action}
              onEdit={() => props.onEdit(connection.config)}
            />
          </li>
        )
      })}
    </ul>
  )
}

function ConnectionItem(props: {
  connection: Connection
  action?: "connect" | "disconnect" | "inspect"
  onEdit: () => void
}) {
  const name = props.connection.config.name ?? "未命名"
  const [expanded, setExpanded] = useState(false)

  const connectConnection = useSetAtom(connectConnectionAtom)
  const handleConnect = async () => {
    setExpanded(true)

    try {
      const connection = await connectConnection(props.connection.config.id)
      if (connection.connected) {
        toast.success(`"${name}" 已连接`)
      } else if (connection.error) {
        toast.error(connection.error)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "连接失败")
    }
  }

  const disconnectConnection = useSetAtom(disconnectConnectionAtom)
  const handleDisconnect = async () => {
    await disconnectConnection(props.connection.config.id)
    toast.success(`"${name}" 已断开`)
  }

  const refreshConnectionSchema = useSetAtom(refreshConnectionSchemaAtom)
  const onRefreshSchema = async () => {
    setExpanded(true)
    try {
      const connection = await refreshConnectionSchema(props.connection.config.id)
      if (!connection.error) {
        toast.success(`"${name}" 结构已刷新`)
      } else {
        toast.error(connection.error)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "刷新数据库结构失败")
    }
  }

  const deleteConnection = useSetAtom(deleteConnectionAtom)
  const onDelete = async () => {
    try {
      await deleteConnection(props.connection.config.id)
      toast.success(`"${name}" 已删除`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    }
  }

  const createTab = useSetAtom(createTabAtom)
  const onNewQuery = () => {
    createTab({ configId: props.connection.config.id })
  }

  const isConnected = props.connection.connected
  const isBusy = props.action !== undefined
  const displayError =
    props.action === "connect" || props.action === "inspect"
      ? null
      : props.connection.error

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
              <DriverIcon driver={props.connection.config.driver} />
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight">
                {props.connection.config.name ?? "未命名"}
                <ConnectionStatusBadge
                  connected={props.connection.connected}
                  error={props.connection.error}
                  action={props.action}
                />
              </p>
              <p className="truncate text-xs leading-tight text-muted-foreground">
                {props.connection.config.database}
                <span className="mx-1">·</span>
                {driverLabel[props.connection.config.driver] ??
                  props.connection.config.driver}
                {props.connection.config.ssh ? " · SSH" : ""}
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
                handleDisconnect().catch((err) => {
                  toast.error(
                    err instanceof Error ? err.message : "断开连接失败",
                  )
                })
              } else {
                handleConnect().catch((err) => {
                  toast.error(err instanceof Error ? err.message : "连接失败")
                })
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
                    handleDisconnect().catch((err) => {
                      toast.error(
                        err instanceof Error ? err.message : "断开连接失败",
                      )
                    })
                  } else {
                    handleConnect().catch((err) => {
                      toast.error(err instanceof Error ? err.message : "连接失败")
                    })
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
                  onRefreshSchema().catch((err) => {
                    toast.error(
                      err instanceof Error ? err.message : "刷新数据库结构失败",
                    )
                  })
                }}
                disabled={isBusy}
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
                  props.onEdit()
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
          {displayError ? (
            <div
              className={cn(
                "flex items-center gap-2 border-b px-3 py-2 text-xs",
                props.connection.connected
                  ? "bg-amber-500/8 text-amber-700 dark:text-amber-400"
                  : "bg-destructive/5 text-destructive",
              )}
            >
              <TriangleAlert className="size-3.5 shrink-0" />
              <span>{displayError}</span>
            </div>
          ) : null}

          <SchemaPanel
            conn={props.connection.config}
            connected={props.connection.connected}
            loading={props.action === "connect" || props.action === "inspect"}
            error={props.connection.error}
            schemas={props.connection.schema}
            onConnect={handleConnect}
            onRefresh={onRefreshSchema}
            onNewQuery={onNewQuery}
          />
        </div>
      )}
    </div>
  )
}

function ConnectionStatusBadge(props: {
  connected: boolean
  error: string | null
  action?: "connect" | "disconnect" | "inspect"
}) {
  if (props.action === "connect") {
    return <Badge variant="warning">连接中</Badge>
  }

  if (props.action === "disconnect") {
    return <Badge variant="warning">断开中</Badge>
  }

  if (props.action === "inspect") {
    return <Badge variant="warning">刷新中</Badge>
  }

  if (props.connected && props.error) {
    return <Badge variant="warning">结构异常</Badge>
  }

  if (props.connected) {
    return <Badge variant="success">已连接</Badge>
  }

  if (props.error) {
    return <Badge variant="destructive">异常</Badge>
  }

  return <Badge variant="muted">未连接</Badge>
}
