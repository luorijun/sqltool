import { useAtomValue, useSetAtom } from "jotai"
import { LoaderCircle } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Config } from "@/contracts/database"
import { ScrollArea } from "@/renderer/components/ui/scroll-area"
import { cn } from "@/renderer/components/ui/utils"
import {
  connectConnectionAtom,
  connectionActionAtom,
  connectionEntriesAtom,
  deleteConnectionAtom,
  disconnectConnectionAtom,
  refreshConnectionSchemaAtom,
} from "@/renderer/modules/database"
import { openQueryTabAtom, openViewTabAtom } from "@/renderer/modules/workspace"
import { ConnDialog } from "./dialog"
import { SidebarHeader } from "./header"
import type { NodeActions } from "./menu"
import { SchemaTree } from "./schema"
import {
  buildTree,
  canRefresh,
  nodeKey,
  selectedNode,
  type TreeNode,
  visibleNodes,
} from "./tree"

export default function Sidebar(props: { className?: string }) {
  const connections = useAtomValue(connectionEntriesAtom)
  const pending = useAtomValue(connectionActionAtom)
  const connect = useSetAtom(connectConnectionAtom)
  const disconnect = useSetAtom(disconnectConnectionAtom)
  const refresh = useSetAtom(refreshConnectionSchemaAtom)
  const remove = useSetAtom(deleteConnectionAtom)
  const openQuery = useSetAtom(openQueryTabAtom)
  const openView = useSetAtom(openViewTabAtom)
  const [dialog, setDialog] = useState<{
    mode: "create" | "edit"
    target?: Config
  } | null>(null)
  const [selection, setSelection] = useState<string | null>(null)
  const [expansion, setExpansion] = useState<Map<string, boolean>>(
    () => new Map(),
  )
  const nodes = useMemo(() => buildTree(connections ?? []), [connections])
  const expanded = useMemo(
    () =>
      new Set(
        nodes
          .filter(
            (node) => expansion.get(node.key) ?? node.defaultExpanded ?? false,
          )
          .map((node) => node.key),
      ),
    [nodes, expansion],
  )
  const visible = useMemo(
    () => visibleNodes(nodes, expanded),
    [nodes, expanded],
  )
  const selected = selectedNode(visible, selection)

  const setExpanded = (key: string, value: boolean) => {
    setExpansion((current) => new Map(current).set(key, value))
  }
  const run = (node: TreeNode, operation: () => Promise<unknown>) => {
    if (pending[node.connection.config.id]) return
    void operation().catch((error) =>
      toast.error(error instanceof Error ? error.message : "操作失败"),
    )
  }
  const actions: NodeActions = {
    disconnect: (node) =>
      run(node, () => disconnect(node.connection.config.id)),
    connect: (node) => {
      run(node, async () => {
        const id = node.connection.config.id
        if (node.connection.connected) {
          await disconnect(id)
        } else {
          setExpanded(nodeKey(id), true)
          await connect(id)
        }
      })
    },
    refresh: (node) => {
      if (!canRefresh(node)) return
      run(node, () =>
        refresh(
          node.kind === "table" && node.source
            ? { id: node.connection.config.id, source: node.source }
            : node.connection.config.id,
        ),
      )
    },
    query: (node) => {
      openQuery({ configId: node.connection.config.id })
    },
    browse: (node) => {
      if (node.kind !== "table" || !node.source || !node.connection.connected)
        return
      const source = node.source
      run(node, () => openView({ configId: node.connection.config.id, source }))
    },
    edit: (node) => {
      setDialog({ mode: "edit", target: node.connection.config })
    },
    remove: (node) => run(node, () => remove(node.connection.config.id)),
  }
  const expand = (node: TreeNode, value: boolean) => {
    setExpanded(node.key, value)
    if (
      value &&
      node.kind === "connection" &&
      node.connection.connected &&
      !node.connection.schema &&
      !node.connection.error
    ) {
      actions.refresh(node)
    }
  }
  const activate = (node: TreeNode) => {
    setSelection(node.key)
    if (node.kind === "connection") {
      expand(node, true)
      if (!node.connection.connected) actions.connect(node)
    } else if (node.kind === "table") {
      setExpanded(node.key, true)
      actions.browse(node)
    }
  }

  return (
    <nav
      aria-label="连接与数据库结构"
      className={cn(
        "bg-sidebar text-sidebar-foreground flex flex-col overflow-hidden",
        props.className,
      )}
    >
      <SidebarHeader
        onCreate={() => setDialog({ mode: "create" })}
        selected={selected}
        action={selected ? pending[selected.connection.config.id] : undefined}
        actions={actions}
      />
      <ScrollArea className="min-h-0 flex-1">
        {connections === null ? (
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            正在加载连接列表…
          </div>
        ) : connections.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            暂无连接
          </p>
        ) : (
          <SchemaTree
            nodes={visible}
            selected={selected}
            expanded={expanded}
            pending={pending}
            actions={actions}
            onSelect={(node) => setSelection(node.key)}
            onExpand={expand}
            onActivate={activate}
          />
        )}
      </ScrollArea>
      <ConnDialog
        mode={dialog?.mode ?? null}
        conn={dialog?.target ?? null}
        onClose={() => setDialog(null)}
      />
    </nav>
  )
}
