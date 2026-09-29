import {
  Braces,
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  Key,
  Layers,
  Link,
  LoaderCircle,
  Minus,
  Table2,
  TriangleAlert,
} from "lucide-react"
import { type KeyboardEvent, useRef } from "react"
import { cn } from "tailwind-variants"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/renderer/components/ui/context-menu"
import { ScrollArea } from "@/renderer/components/ui/scroll-area"
import { ConnectionLabel, DriverIcon } from "../conn"
import { type NodeActions, NodeMenu } from "../menu"
import type { TreeNode } from "../tree"

export function SchemaTree({
  nodes,
  selected,
  expanded,
  pending,
  actions,
  onSelect,
  onExpand,
  onActivate,
}: {
  nodes: TreeNode[]
  selected?: TreeNode
  expanded: ReadonlySet<string>
  pending: Record<string, "connect" | "disconnect" | "inspect" | undefined>
  actions: NodeActions
  onSelect: (node: TreeNode) => void
  onExpand: (node: TreeNode, expanded: boolean) => void
  onActivate: (node: TreeNode) => void
}) {
  const tree = useRef<HTMLDivElement>(null)
  const focus = (index: number) => {
    const node = nodes[index]
    if (!node) return
    onSelect(node)
    tree.current
      ?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')
      [index]?.focus()
  }
  const handleKey = (event: KeyboardEvent, node: TreeNode, index: number) => {
    switch (event.key) {
      case "ArrowDown":
        focus(Math.min(index + 1, nodes.length - 1))
        break
      case "ArrowUp":
        focus(Math.max(index - 1, 0))
        break
      case "Home":
        focus(0)
        break
      case "End":
        focus(nodes.length - 1)
        break
      case "ArrowRight":
        if (node.expandable && !expanded.has(node.key)) onExpand(node, true)
        else if (nodes[index + 1]?.parent === node.key) focus(index + 1)
        break
      case "ArrowLeft":
        if (node.expandable && expanded.has(node.key)) onExpand(node, false)
        else focus(nodes.findIndex((item) => item.key === node.parent))
        break
      case "Enter":
        onActivate(node)
        break
      case " ":
        onSelect(node)
        if (node.expandable) onExpand(node, !expanded.has(node.key))
        break
      default:
        return
    }
    event.preventDefault()
  }

  const renderRow = (node: TreeNode, index: number) => {
    const action = pending[node.connection.config.id]
    const isExpanded = expanded.has(node.key)
    const isConnection = node.kind === "connection"
    return (
      <ContextMenu
        key={node.key}
        onOpenChange={(open) => {
          if (open) onSelect(node)
        }}
      >
        <ContextMenuTrigger
          render={<button type="button" />}
          role="treeitem"
          aria-level={node.depth + 1}
          aria-selected={selected?.key === node.key}
          aria-expanded={node.expandable ? isExpanded : undefined}
          tabIndex={
            selected?.key === node.key || (!selected && index === 0) ? 0 : -1
          }
          className={cn(
            "flex w-full min-w-0 items-center text-left select-none outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
            isConnection
              ? "flex-1 p-2 gap-2 rounded-lg hover:bg-primary/5 duration-150 ease-in-out"
              : "h-7 rounded-md pr-2 text-xs hover:bg-accent/60",
            selected?.key === node.key && "bg-accent text-accent-foreground",
          )}
          style={
            isConnection
              ? undefined
              : { paddingLeft: (node.depth - 1) * 10 + 4 }
          }
          title={
            isConnection
              ? (node.connection.error ?? node.label)
              : node.meta
                ? `${node.label} · ${node.meta}`
                : node.label
          }
          onClick={(event) => {
            onSelect(node)
            if (event.detail <= 1 && node.expandable)
              onExpand(node, !isExpanded)
          }}
          onDoubleClick={() => onActivate(node)}
          onContextMenu={() => onSelect(node)}
          onKeyDown={(event) => handleKey(event, node, index)}
        >
          <span
            className={cn(
              "flex w-4 shrink-0 items-center justify-center",
              isConnection
                ? "text-muted-foreground/60"
                : "text-muted-foreground/50",
            )}
          >
            {node.expandable ? (
              isExpanded ? (
                <ChevronDown className={isConnection ? "size-4" : "size-3"} />
              ) : (
                <ChevronRight className={isConnection ? "size-4" : "size-3"} />
              )
            ) : null}
          </span>
          <span
            className={cn(
              "flex shrink-0 items-center text-muted-foreground",
              isConnection ? "group-hover:text-foreground" : "mr-1.5",
            )}
          >
            <NodeIcon node={node} />
          </span>
          {isConnection ? (
            <ConnectionLabel connection={node.connection} action={action} />
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate">{node.label}</span>
              {node.meta ? (
                <span className="shrink-0 pl-2 font-mono text-[10.5px] text-muted-foreground/55">
                  {node.kind === "section" ? `(${node.meta})` : node.meta}
                </span>
              ) : null}
            </>
          )}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <NodeMenu node={node} busy={!!action} actions={actions} />
        </ContextMenuContent>
      </ContextMenu>
    )
  }
  const groups: {
    node: TreeNode
    index: number
    children: { node: TreeNode; index: number }[]
  }[] = []
  nodes.forEach((node, index) => {
    if (node.kind === "connection") groups.push({ node, index, children: [] })
    else groups.at(-1)?.children.push({ node, index })
  })

  return (
    <div
      ref={tree}
      role="tree"
      aria-label="数据库结构"
      className="flex flex-col py-2 gap-2"
    >
      {groups.map(({ node, index, children }) => {
        const { connection } = node
        const action = pending[connection.config.id]
        const loading = action === "connect" || action === "inspect"
        const error = loading ? null : connection.error
        return (
          <div key={node.key} className="flex flex-col pl-2 pr-3.5 gap-1">
            <div className="sticky top-0 z-10 flex-none bg-sidebar group flex items-stretch">
              {renderRow(node, index)}
            </div>
            {expanded.has(node.key) ? (
              <div className="overflow-hidden rounded-xl border bg-background/60">
                {error ? (
                  <div
                    role="status"
                    className={cn(
                      "flex items-center gap-2 border-b px-3 py-2 text-xs",
                      connection.connected
                        ? "bg-amber-500/8 text-amber-700 dark:text-amber-400"
                        : "bg-destructive/5 text-destructive",
                    )}
                  >
                    <TriangleAlert className="size-3.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                ) : null}
                <div
                  data-slot="schema-panel"
                  className="flex-1 flex flex-col overflow-hidden min-h-0"
                >
                  <div className="flex-none flex items-center gap-2 px-3 h-8 border-b bg-muted/20 shrink-0">
                    <Database className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground font-medium truncate">
                      {connection.config.database}
                    </span>
                  </div>
                  <ScrollArea className="flex-1 overflow-auto">
                    <div className="p-1.5 space-y-px">
                      {loading ? (
                        <p
                          role="status"
                          className="flex items-center justify-center gap-2 px-3 py-8 text-center text-xs text-muted-foreground"
                        >
                          <LoaderCircle className="size-3 animate-spin" />
                          正在加载数据库结构…
                        </p>
                      ) : !connection.connected ? (
                        <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                          双击连接以加载数据库结构
                        </p>
                      ) : !connection.schema ? (
                        <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                          点击刷新以加载数据库结构
                        </p>
                      ) : connection.schema.length === 0 ? (
                        <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                          当前数据库没有可显示的结构
                        </p>
                      ) : null}
                      {children.map(({ node, index }) =>
                        renderRow(node, index),
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function NodeIcon({ node }: { node: TreeNode }) {
  if (node.kind === "connection")
    return <DriverIcon driver={node.connection.config.driver} />
  if (node.kind === "schema") return <Layers className="size-3.5" />
  if (node.kind === "view" || node.section === "views")
    return <Eye className="size-3.5" />
  if (node.kind === "function" || node.section === "functions")
    return <Braces className="size-3.5" />
  if (node.kind === "column") {
    if (node.column?.pk)
      return <Key className="size-3 text-amber-500 dark:text-amber-400" />
    if (node.column?.fk)
      return <Link className="size-3 text-blue-500 dark:text-blue-400" />
    return <Minus className="size-3 text-muted-foreground/40" />
  }
  return <Table2 className="size-3.5" />
}
