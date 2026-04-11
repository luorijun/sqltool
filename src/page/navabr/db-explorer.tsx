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
import { type ReactNode, useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { addTabAtom } from "@/lib/tabs"
import { cn } from "@/lib/utils"
import type { Config } from "../../lib/config/index"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Column {
  name: string
  type: string
  pk?: boolean
  fk?: boolean
}

interface Table {
  name: string
  rowCount?: number
  columns: Column[]
}

interface DbView {
  name: string
}

interface DbFunction {
  name: string
}

interface Schema {
  name: string
  tables: Table[]
  views: DbView[]
  functions: DbFunction[]
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_SCHEMAS: Schema[] = [
  {
    name: "public",
    tables: [
      {
        name: "users",
        rowCount: 1247,
        columns: [
          { name: "id", type: "bigint", pk: true },
          { name: "username", type: "varchar(100)" },
          { name: "email", type: "varchar(255)" },
          { name: "role", type: "varchar(50)" },
          { name: "status", type: "varchar(20)" },
          { name: "created_at", type: "timestamptz" },
          { name: "updated_at", type: "timestamptz" },
        ],
      },
      {
        name: "orders",
        rowCount: 8493,
        columns: [
          { name: "id", type: "bigint", pk: true },
          { name: "user_id", type: "bigint", fk: true },
          { name: "total", type: "numeric(10,2)" },
          { name: "status", type: "varchar(20)" },
          { name: "created_at", type: "timestamptz" },
        ],
      },
      {
        name: "products",
        rowCount: 432,
        columns: [
          { name: "id", type: "bigint", pk: true },
          { name: "name", type: "varchar(255)" },
          { name: "price", type: "numeric(10,2)" },
          { name: "stock", type: "integer" },
          { name: "category_id", type: "bigint", fk: true },
        ],
      },
      {
        name: "categories",
        rowCount: 18,
        columns: [
          { name: "id", type: "bigint", pk: true },
          { name: "name", type: "varchar(100)" },
          { name: "slug", type: "varchar(100)" },
        ],
      },
      {
        name: "order_items",
        rowCount: 24891,
        columns: [
          { name: "id", type: "bigint", pk: true },
          { name: "order_id", type: "bigint", fk: true },
          { name: "product_id", type: "bigint", fk: true },
          { name: "quantity", type: "integer" },
          { name: "price", type: "numeric(10,2)" },
        ],
      },
    ],
    views: [{ name: "active_users" }, { name: "order_summary" }],
    functions: [
      { name: "get_total_revenue()" },
      { name: "update_timestamps()" },
    ],
  },
]

// ─── Tree Row ─────────────────────────────────────────────────────────────────

/** Horizontal indent per depth level in pixels */
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
      {/* Chevron slot — always takes space to keep icons aligned */}
      <span className="w-4 shrink-0 flex items-center justify-center text-muted-foreground/50">
        {expandable &&
          (expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          ))}
      </span>

      {/* Node icon */}
      <span className="shrink-0 mr-1.5 flex items-center">{icon}</span>

      {/* Label */}
      <span className="flex-1 min-w-0 truncate">{label}</span>

      {/* Right-side meta (row count, type, section count…) */}
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

// ─── Column Icon ──────────────────────────────────────────────────────────────

function ColumnIcon({ col }: { col: Column }) {
  if (col.pk)
    return (
      <Key className="size-3 text-amber-500 dark:text-amber-400 shrink-0" />
    )
  if (col.fk)
    return <Link className="size-3 text-blue-500 dark:text-blue-400 shrink-0" />
  return <Minus className="size-3 text-muted-foreground/40 shrink-0" />
}

// ─── Table Node ───────────────────────────────────────────────────────────────

function TableNode({
  table,
  schemaName,
  expanded,
  onToggle,
}: {
  table: Table
  schemaName: string
  expanded: boolean
  onToggle: () => void
}) {
  const addTab = useSetAtom(addTabAtom)

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    addTab({
      label: table.name,
      sql: `SELECT *\nFROM ${schemaName}.${table.name}\nLIMIT 100;`,
      columns: table.columns.map((c) => c.name),
    })
  }

  return (
    <>
      {/* Table row — plain div so we can nest an action button */}
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
        {/* Chevron */}
        <span className="w-4 shrink-0 flex items-center justify-center text-muted-foreground/50">
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
        </span>

        {/* Table icon */}
        <span className="shrink-0 mr-1.5 flex items-center">
          <Table2 className="size-3.5 text-muted-foreground shrink-0" />
        </span>

        {/* Label */}
        <span className="flex-1 min-w-0 truncate">{table.name}</span>

        {/* Row count — visible normally, hidden on hover */}
        {table.rowCount !== undefined && (
          <span className="font-mono text-[10.5px] text-muted-foreground/55 pl-2 shrink-0 group-hover/row:hidden">
            {table.rowCount.toLocaleString()}
          </span>
        )}

        {/* Open-in-tab button — shown on hover */}
        <button
          type="button"
          title={`查询 ${table.name}`}
          className="hidden group-hover/row:flex items-center justify-center size-5 rounded shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
          onClick={handleOpen}
        >
          <Play className="size-3" />
        </button>
      </div>

      {/* Column rows (unchanged) */}
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

// ─── Section Node ─────────────────────────────────────────────────────────────

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

// ─── Schema Section ───────────────────────────────────────────────────────────

function SchemaSection({
  schema,
  expanded,
  onToggle,
  expandedNodes,
  toggleNode,
}: {
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
      {/* Schema row */}
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
          {/* Tables */}
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
                  table={table}
                  schemaName={schema.name}
                  expanded={expandedNodes.has(tableKey)}
                  onToggle={() => toggleNode(tableKey)}
                />
              )
            })}
          </SectionNode>

          {/* Views */}
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

          {/* Functions */}
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

// ─── DbExplorer ───────────────────────────────────────────────────────────────

export interface DbExplorerProps {
  conn: Config
}

export function DbExplorer({ conn }: DbExplorerProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    () =>
      new Set(["schema:public", "section:public:tables", "table:public:users"]),
  )

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
      {/* Database context header */}
      <div className="flex-none flex items-center gap-2 px-3 h-8 border-b bg-muted/20 shrink-0">
        <Database className="size-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground font-medium truncate">
          {conn.database}
        </span>
      </div>

      {/* Schema tree */}
      <ScrollArea className="flex-1">
        <div className="p-1.5 space-y-px">
          {MOCK_SCHEMAS.map((schema) => {
            const schemaKey = `schema:${schema.name}`
            return (
              <SchemaSection
                key={schemaKey}
                schema={schema}
                expanded={expandedNodes.has(schemaKey)}
                onToggle={() => toggleNode(schemaKey)}
                expandedNodes={expandedNodes}
                toggleNode={toggleNode}
              />
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
