import {
  FilePlus2,
  LogIn,
  LogOut,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react"
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/renderer/components/ui/dropdown-menu"
import { canRefresh, type TreeNode } from "./tree"

export interface NodeActions {
  connect: (node: TreeNode) => void
  disconnect: (node: TreeNode) => void
  refresh: (node: TreeNode) => void
  query: (node: TreeNode) => void
  browse: (node: TreeNode) => void
  edit: (node: TreeNode) => void
  remove: (node: TreeNode) => void
}

export function NodeMenu({
  node,
  busy,
  actions,
}: {
  node: TreeNode
  busy: boolean
  actions: NodeActions
}) {
  const { connection } = node
  const hasResources =
    connection.connected ||
    connection.sessionCount > 0 ||
    connection.failedCount > 0
  return (
    <>
      <DropdownMenuItem disabled={busy} onClick={() => actions.connect(node)}>
        {connection.connected ? <LogOut /> : <LogIn />}
        {connection.connected ? "断开连接" : "连接"}
      </DropdownMenuItem>
      {!connection.connected && hasResources ? (
        <DropdownMenuItem
          disabled={busy}
          onClick={() => actions.disconnect(node)}
        >
          <LogOut />
          断开残留会话
        </DropdownMenuItem>
      ) : null}
      {node.kind === "connection" || node.kind === "table" ? (
        <DropdownMenuItem
          disabled={busy || !canRefresh(node)}
          onClick={() => actions.refresh(node)}
        >
          <RefreshCw />
          刷新结构
        </DropdownMenuItem>
      ) : null}
      {node.kind === "table" ? (
        <DropdownMenuItem
          disabled={busy || !connection.connected}
          onClick={() => actions.browse(node)}
        >
          <Play />
          查看数据
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem disabled={busy} onClick={() => actions.query(node)}>
        <FilePlus2 />
        新建查询
      </DropdownMenuItem>
      {node.kind === "connection" ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={busy || hasResources}
            title={hasResources ? "请先断开连接" : undefined}
            onClick={() => actions.edit(node)}
          >
            <Pencil />
            编辑连接
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={busy || hasResources}
            title={hasResources ? "请先断开连接" : undefined}
            variant="destructive"
            onClick={() => actions.remove(node)}
          >
            <Trash2 />
            删除连接
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  )
}
