import { Database, Server } from "lucide-react"
import type { Connection } from "@/contracts/database"
import { Badge } from "@/renderer/components/ui/badge"

export function DriverIcon({ driver }: { driver: string }) {
  return driver === "mysql" ? (
    <Server className="size-4 shrink-0" />
  ) : (
    <Database className="size-4 shrink-0" />
  )
}

export function ConnectionLabel({
  connection,
  action,
}: {
  connection: Connection
  action?: "connect" | "disconnect" | "inspect"
}) {
  const { config } = connection
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium leading-tight">
        {config.name ?? "未命名"}
        <ConnectionStatusBadge connection={connection} action={action} />
      </span>
      <span className="block truncate text-xs leading-tight text-muted-foreground">
        {config.database}
        <span className="mx-1">·</span>
        {config.driver === "mysql" ? "MySQL / MariaDB" : "PostgreSQL"}
        {config.ssh ? " · SSH" : ""}
      </span>
    </span>
  )
}

function ConnectionStatusBadge({
  connection,
  action,
}: {
  connection: Connection
  action?: "connect" | "disconnect" | "inspect"
}) {
  if (action)
    return (
      <Badge variant="warning">
        {{ connect: "连接中", disconnect: "断开中", inspect: "刷新中" }[action]}
      </Badge>
    )
  if (connection.connected && connection.error)
    return <Badge variant="warning">结构异常</Badge>
  if (connection.failedCount > 0)
    return (
      <Badge variant="warning">
        {connection.connected ? "部分会话异常" : "会话异常"}
      </Badge>
    )
  if (!connection.connected && connection.sessionCount > 0)
    return <Badge variant="muted">会话待连接</Badge>
  if (connection.connected) return <Badge variant="success">已连接</Badge>
  if (connection.error) return <Badge variant="destructive">异常</Badge>
  return <Badge variant="muted">未连接</Badge>
}
