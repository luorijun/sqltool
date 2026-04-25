import { useSetAtom } from "jotai"
import {
  Braces,
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  Key,
  Layers,
  Link,
  Minus,
  Play,
  Table2,
} from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Config } from "@/lib/config"
import type {
  DbColumn as Column,
  DbSchema as Schema,
  DbTable as Table,
} from "@/lib/conn"
import connApi from "@/lib/conn/renderer"
import { createTabAtom } from "@/lib/tabs/renderer"
import { cn } from "@/lib/utils"

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function createDefaultExpandedNodes(schemas: Schema[]): Set<string> {
  const next = new Set<string>()
  const initialSchema =
    schemas.find((schema) => schema.name === "public") ?? schemas[0]
  if (!initialSchema) {
    return next
  }

  next.add(`schema:${initialSchema.name}`)
  next.add(`section:${initialSchema.name}:tables`)

  if (initialSchema.tables[0]) {
    next.add(`table:${initialSchema.name}:${initialSchema.tables[0].name}`)
  }

  return next
}

const INDENT = 10

interface TreeRowProps {
  depth: number
  icon: ReactNode
  label: string
  meta?: string
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
}

function TreeRow({
  depth,
  icon,
  label,
  meta,
  expandable = false,
  expanded = false,
  onToggle,
}: TreeRowProps) {
  const sharedClass = cn(
    "flex items-center h-7 rounded-md text-xs select-none pr-2",
    "transition-colors",
    onToggle ? "cursor-pointer hover:bg-accent/60" : "cursor-default",
  )
  const sharedStyle = { paddingLeft: depth * INDENT + 4 }

  const content = (
    <>
      <span className="w-4 shrink-0 flex items-center justify-center text-muted-foreground/50">
        {expandable &&
          (expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          ))}
      </span>

      <span className="shrink-0 mr-1.5 flex items-center">{icon}</span>
      <span className="flex-1 min-w-0 truncate">{label}</span>

      {meta && (
        <span className="font-mono text-[10.5px] text-muted-foreground/55 pl-2 shrink-0">
          {meta}
        </span>
      )}
    </>
  )

  if (onToggle) {
    return (
      <button
        type="button"
        className={sharedClass}
        style={sharedStyle}
        onClick={onToggle}
      >
        {content}
      </button>
    )
  }

  return (
    <div className={sharedClass} style={sharedStyle}>
      {content}
    </div>
  )
}

function ColumnIcon({ col }: { col: Column }) {
  if (col.pk) {
    return (
      <Key className="size-3 text-amber-500 dark:text-amber-400 shrink-0" />
    )
  }
  if (col.fk) {
    return <Link className="size-3 text-blue-500 dark:text-blue-400 shrink-0" />
  }

  return <Minus className="size-3 text-muted-foreground/40 shrink-0" />
}

function TableNode({
  conn,
  table,
  schemaName,
  expanded,
  onToggle,
}: {
  conn: Config
  table: Table
  schemaName: string
  expanded: boolean
  onToggle: () => void
}) {
  const createTab = useSetAtom(createTabAtom)

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    createTab({
      label: table.name,
      sql: `SELECT *\nFROM ${quoteIdent(schemaName)}.${quoteIdent(table.name)}\nLIMIT 100;`,
      connection: conn,
      autoRun: true,
    })
  }

  return (
    <>
      <div
        className="group/row flex items-center h-7 rounded-md text-xs select-none pr-1 cursor-pointer transition-colors hover:bg-accent/60"
        style={{ paddingLeft: 2 * INDENT + 4 }}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onToggle()
        }}
        role="button"
        tabIndex={0}
      >
        <span className="w-4 shrink-0 flex items-center justify-center text-muted-foreground/50">
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
        </span>

        <span className="shrink-0 mr-1.5 flex items-center">
          <Table2 className="size-3.5 text-muted-foreground shrink-0" />
        </span>

        <span className="flex-1 min-w-0 truncate">{table.name}</span>

        {table.rowCount !== undefined && (
          <span className="font-mono text-[10.5px] text-muted-foreground/55 pl-2 shrink-0 group-hover/row:hidden">
            {table.rowCount.toLocaleString()}
          </span>
        )}

        <button
          type="button"
          title={`查询 ${table.name}`}
          className="hidden group-hover/row:flex items-center justify-center size-5 rounded shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
          onClick={handleOpen}
        >
          <Play className="size-3" />
        </button>
      </div>

      {expanded &&
        table.columns.map((col) => (
          <TreeRow
            key={col.name}
            depth={3}
            icon={<ColumnIcon col={col} />}
            label={col.name}
            meta={col.type}
          />
        ))}
    </>
  )
}

function SectionNode({
  icon,
  label,
  count,
  expanded,
  onToggle,
  children,
}: {
  icon: ReactNode
  label: string
  count: number
  expanded: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <>
      <TreeRow
        depth={1}
        icon={icon}
        label={label}
        meta={`(${count})`}
        expandable
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && children}
    </>
  )
}

function SchemaSection({
  conn,
  schema,
  expanded,
  onToggle,
  expandedNodes,
  toggleNode,
}: {
  conn: Config
  schema: Schema
  expanded: boolean
  onToggle: () => void
  expandedNodes: Set<string>
  toggleNode: (key: string) => void
}) {
  const tablesKey = `section:${schema.name}:tables`
  const viewsKey = `section:${schema.name}:views`
  const funcsKey = `section:${schema.name}:functions`

  return (
    <>
      <TreeRow
        depth={0}
        icon={<Layers className="size-3.5 text-muted-foreground shrink-0" />}
        label={schema.name}
        expandable
        expanded={expanded}
        onToggle={onToggle}
      />

      {expanded && (
        <>
          <SectionNode
            icon={
              <Table2 className="size-3.5 text-muted-foreground/70 shrink-0" />
            }
            label="Tables"
            count={schema.tables.length}
            expanded={expandedNodes.has(tablesKey)}
            onToggle={() => toggleNode(tablesKey)}
          >
            {schema.tables.map((table) => {
              const tableKey = `table:${schema.name}:${table.name}`
              return (
                <TableNode
                  key={tableKey}
                  conn={conn}
                  table={table}
                  schemaName={schema.name}
                  expanded={expandedNodes.has(tableKey)}
                  onToggle={() => toggleNode(tableKey)}
                />
              )
            })}
          </SectionNode>

          <SectionNode
            icon={
              <Eye className="size-3.5 text-muted-foreground/70 shrink-0" />
            }
            label="Views"
            count={schema.views.length}
            expanded={expandedNodes.has(viewsKey)}
            onToggle={() => toggleNode(viewsKey)}
          >
            {schema.views.map((view) => (
              <TreeRow
                key={view.name}
                depth={2}
                icon={
                  <Eye className="size-3.5 text-muted-foreground shrink-0" />
                }
                label={view.name}
              />
            ))}
          </SectionNode>

          <SectionNode
            icon={
              <Braces className="size-3.5 text-muted-foreground/70 shrink-0" />
            }
            label="Functions"
            count={schema.functions.length}
            expanded={expandedNodes.has(funcsKey)}
            onToggle={() => toggleNode(funcsKey)}
          >
            {schema.functions.map((fn) => (
              <TreeRow
                key={fn.name}
                depth={2}
                icon={
                  <Braces className="size-3.5 text-muted-foreground shrink-0" />
                }
                label={fn.name}
              />
            ))}
          </SectionNode>
        </>
      )}
    </>
  )
}

export interface ConnExplorerProps {
  conn: Config
  refreshKey?: number
}

export function ConnExplorer({ conn, refreshKey }: ConnExplorerProps) {
  const [schemas, setSchemas] = useState<Schema[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    () => new Set(),
  )
  const [hasInitializedExpansion, setHasInitializedExpansion] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadSchemas(connection: Config, _refreshTrigger?: unknown) {
      setLoading(true)
      setError(null)
      setSchemas([])

      try {
        const nextSchemas = await connApi.inspect(connection)
        if (cancelled) {
          return
        }
        setSchemas(nextSchemas)
      } catch (err) {
        if (cancelled) {
          return
        }
        setError(err instanceof Error ? err.message : "加载数据库结构失败")
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadSchemas(conn, refreshKey)

    return () => {
      cancelled = true
    }
  }, [conn, refreshKey])

  useEffect(() => {
    if (hasInitializedExpansion || schemas.length === 0) {
      return
    }

    setExpandedNodes(createDefaultExpandedNodes(schemas))
    setHasInitializedExpansion(true)
  }, [hasInitializedExpansion, schemas])

  const toggleNode = (key: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      <div className="flex-none flex items-center gap-2 px-3 h-8 border-b bg-muted/20 shrink-0">
        <Database className="size-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground font-medium truncate">
          {conn.database}
        </span>
      </div>

      <ScrollArea className="flex-1 overflow-auto">
        <div className="p-1.5 space-y-px">
          {loading ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              正在加载数据库结构...
            </div>
          ) : error ? (
            <div className="px-3 py-8 text-center text-xs text-destructive">
              {error}
            </div>
          ) : schemas.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              当前数据库没有可显示的结构
            </div>
          ) : (
            schemas.map((schema) => {
              const schemaKey = `schema:${schema.name}`
              return (
                <SchemaSection
                  key={schemaKey}
                  conn={conn}
                  schema={schema}
                  expanded={expandedNodes.has(schemaKey)}
                  onToggle={() => toggleNode(schemaKey)}
                  expandedNodes={expandedNodes}
                  toggleNode={toggleNode}
                />
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
