import {
  ChevronLeft,
  FilePlus2,
  LogOut,
  MoreHorizontal,
  Pencil,
  RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Connection } from "@/lib/connection/index"
import { DriverIcon } from "./driver-icon"

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DbHeaderProps {
  conn: Connection
  onBack: () => void
  onNewQuery: () => void
  onRefresh: () => void
  onDisconnect: () => void
  onEditConn: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DbHeader({
  conn,
  onBack,
  onNewQuery,
  onRefresh,
  onDisconnect,
  onEditConn,
}: DbHeaderProps) {
  return (
    <div className="flex-none basis-10 border-b flex items-center gap-0.5 px-1 shrink-0">
      {/* Back to connection list */}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onBack}
        title="返回连接列表"
      >
        <ChevronLeft />
      </Button>

      {/* Connection identity */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0 px-0.5">
        <span className="text-muted-foreground shrink-0">
          <DriverIcon driver={conn.driver} />
        </span>
        <span className="truncate text-sm font-medium">
          {conn.name ?? "未命名"}
        </span>
      </div>

      {/* New query tab */}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onNewQuery}
        title="新建查询"
      >
        <FilePlus2 />
      </Button>

      {/* Refresh schema tree */}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onRefresh}
        title="刷新结构"
      >
        <RefreshCw />
      </Button>

      {/* More actions */}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>

        <DropdownMenuContent side="bottom" align="end">
          <DropdownMenuItem onClick={onEditConn}>
            <Pencil />
            编辑连接
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDisconnect}>
            <LogOut />
            断开连接
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
