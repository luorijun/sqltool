import {
  LoaderCircle,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
} from "lucide-react"
import { Button } from "@/renderer/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/renderer/components/ui/dropdown-menu"
import { type NodeActions, NodeMenu } from "./menu"
import { canRefresh, type TreeNode } from "./tree"

export function SidebarHeader({
  onCreate,
  selected,
  action,
  actions,
}: {
  onCreate: () => void
  selected?: TreeNode
  action?: "connect" | "disconnect" | "inspect"
  actions: NodeActions
}) {
  const connected = selected?.connection.connected ?? false
  const busy = !!action
  const connectLabel = connected ? "断开连接" : "连接"
  return (
    <header className="flex-none basis-10 overflow-hidden border-b px-2 py-2 flex items-center justify-between shrink-0">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        连接
      </span>
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onCreate}
          title="新建连接"
          aria-label="新建连接"
        >
          <Plus />
        </Button>
        <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={!selected || busy}
          aria-pressed={connected}
          aria-label={connectLabel}
          title={
            selected
              ? `${connectLabel}：${selected.connection.config.name ?? "未命名"}`
              : "请先选择条目"
          }
          onClick={() => selected && actions.connect(selected)}
        >
          {action === "connect" || action === "disconnect" ? (
            <LoaderCircle className="animate-spin" />
          ) : connected ? (
            <Pause />
          ) : (
            <Play />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={!selected || busy || !canRefresh(selected)}
          aria-label="刷新选中项结构"
          title={
            selected && canRefresh(selected)
              ? `刷新结构：${selected.label}`
              : "请选择已连接的库或表"
          }
          onClick={() => selected && actions.refresh(selected)}
        >
          <RefreshCw
            className={action === "inspect" ? "animate-spin" : undefined}
          />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-xs" />}
            disabled={!selected || busy}
            aria-label="选中项菜单"
            title="选中项菜单"
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {selected ? (
              <NodeMenu node={selected} busy={busy} actions={actions} />
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
