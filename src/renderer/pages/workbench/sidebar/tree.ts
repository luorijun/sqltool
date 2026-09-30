import type { Connection, DbColumn, TableSource } from "@/contracts/database"
import { getColumnTypeLabel } from "@/renderer/components/result-grid"

export interface TreeNode {
  key: string
  kind:
    | "connection"
    | "schema"
    | "section"
    | "table"
    | "column"
    | "view"
    | "function"
  label: string
  connection: Connection
  parent?: string
  depth: number
  expandable: boolean
  defaultExpanded?: boolean
  source?: TableSource
  column?: DbColumn
  meta?: string
  section?: "tables" | "views" | "functions"
}

export function nodeKey(...parts: string[]): string {
  return JSON.stringify(parts)
}

export function buildTree(connections: Connection[]): TreeNode[] {
  const nodes: TreeNode[] = []
  for (const connection of connections) {
    const id = connection.config.id
    const root = nodeKey(id)
    const initial =
      connection.schema?.find((schema) => schema.name === "public") ??
      connection.schema?.[0]
    nodes.push({
      key: root,
      kind: "connection",
      label: connection.config.name ?? "未命名",
      connection,
      depth: 0,
      expandable: true,
    })
    for (const schema of connection.schema ?? []) {
      const key = nodeKey(id, schema.name)
      nodes.push({
        key,
        kind: "schema",
        label: schema.name,
        connection,
        parent: root,
        depth: 1,
        expandable: true,
        defaultExpanded: schema === initial,
      })
      for (const section of ["tables", "views", "functions"] as const) {
        const group = nodeKey(id, schema.name, section)
        nodes.push({
          key: group,
          kind: "section",
          label: { tables: "Tables", views: "Views", functions: "Functions" }[
            section
          ],
          connection,
          parent: key,
          depth: 2,
          expandable: true,
          defaultExpanded: schema === initial && section === "tables",
          meta: String(schema[section].length),
          section,
        })
        for (const item of schema[section]) {
          const key = nodeKey(id, schema.name, section, item.name)
          const source = { schema: schema.name, table: item.name }
          const columns = "columns" in item ? item.columns : []
          nodes.push({
            key,
            kind:
              section === "tables"
                ? "table"
                : section === "views"
                  ? "view"
                  : "function",
            label: item.name,
            connection,
            parent: group,
            depth: 3,
            expandable: columns.length > 0,
            source,
            meta:
              "rowCount" in item && item.rowCount !== undefined
                ? item.rowCount.toLocaleString()
                : undefined,
          })
          for (const column of columns) {
            nodes.push({
              key: nodeKey(id, schema.name, section, item.name, column.name),
              kind: "column",
              label: column.name,
              connection,
              parent: key,
              depth: 4,
              expandable: false,
              source,
              column,
              meta: getColumnTypeLabel(column.type, connection.config.driver),
            })
          }
        }
      }
    }
  }
  return nodes
}

export function visibleNodes(
  nodes: TreeNode[],
  expanded: ReadonlySet<string>,
): TreeNode[] {
  const visible = new Set<string>()
  return nodes.filter((node) => {
    if (
      node.parent &&
      (!visible.has(node.parent) || !expanded.has(node.parent))
    )
      return false
    visible.add(node.key)
    return true
  })
}

export function canRefresh(node: TreeNode): boolean {
  return (
    node.connection.connected &&
    (node.kind === "connection" || node.kind === "table")
  )
}

export function selectedNode(
  nodes: TreeNode[],
  key: string | null,
): TreeNode | undefined {
  if (!key) return undefined
  const parts: string[] = JSON.parse(key)
  while (parts.length) {
    const node = nodes.find((node) => node.key === nodeKey(...parts))
    if (node) return node
    parts.pop()
  }
  return undefined
}
