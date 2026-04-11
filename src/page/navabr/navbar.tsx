import { zodResolver } from "@hookform/resolvers/zod"
import {
  Database,
  HardDrive,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FieldGroup } from "@/components/ui/field"
import { FormField } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Connection } from "@/lib/connection/index"
import connection from "@/lib/connection/renderer"
import z from "@/lib/zod"

// ─── Schema ──────────────────────────────────────────────────────────────────

const schema = z.object({
  name: z.string().nonempty(),
  driver: z.enum(["postgres", "mysql", "sqlite"]),
  host: z.string().nonempty(),
  port: z.string().nonempty(),
  username: z.string().nonempty(),
  password: z.string().nonempty(),
  database: z.string().nonempty(),
})

type Schema = z.infer<typeof schema>

// ─── Helpers ─────────────────────────────────────────────────────────────────

function DriverIcon({ driver }: { driver: string }) {
  if (driver === "sqlite") return <HardDrive className="size-4 shrink-0" />
  if (driver === "mysql") return <Server className="size-4 shrink-0" />
  return <Database className="size-4 shrink-0" />
}

const driverLabel: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
}

// ─── Edit Dialog ─────────────────────────────────────────────────────────────

function EditConnDialog({
  conn,
  onClose,
  onSaved,
}: {
  conn: Connection | null
  onClose: () => void
  onSaved: () => void
}) {
  const form = useForm<Schema>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (conn) {
      form.reset({
        name: conn.name ?? "",
        driver: conn.driver,
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password: conn.password,
        database: conn.database,
      })
    }
  }, [conn, form])

  const save = async (data: Schema) => {
    if (!conn) return
    try {
      await connection.update(conn.id, data)
      toast.success("连接已更新")
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失败")
    }
  }

  const formId = "edit-conn-form"

  return (
    <Dialog open={conn !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑连接</DialogTitle>
          <DialogDescription>修改数据库连接配置</DialogDescription>
        </DialogHeader>

        <form id={formId} onSubmit={form.handleSubmit(save)}>
          <FieldGroup>
            <FormField control={form.control} name="name" label="连接名称">
              {(fProps) => <Input {...fProps.field} />}
            </FormField>

            <FormField control={form.control} name="driver" label="数据库">
              {(fProps) => <Input {...fProps.field} />}
            </FormField>

            <FieldGroup className="flex-row">
              <FormField control={form.control} name="host" label="主机">
                {(fProps) => <Input {...fProps.field} />}
              </FormField>
              <FormField control={form.control} name="port" label="端口">
                {(fProps) => <Input {...fProps.field} />}
              </FormField>
            </FieldGroup>

            <FieldGroup className="flex-row">
              <FormField control={form.control} name="username" label="账号">
                {(fProps) => <Input {...fProps.field} />}
              </FormField>
              <FormField control={form.control} name="password" label="密码">
                {(fProps) => <Input {...fProps.field} type="password" />}
              </FormField>
            </FieldGroup>

            <FormField control={form.control} name="database" label="库名">
              {(fProps) => <Input {...fProps.field} />}
            </FormField>
          </FieldGroup>
        </form>

        <DialogFooter className="flex justify-between">
          <DialogClose render={<Button variant="outline">取消</Button>} />
          <Button type="submit" form={formId}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Connection Item ──────────────────────────────────────────────────────────

function ConnectionItem({
  conn,
  active,
  onSelect,
  onEdit,
  onDelete,
}: {
  conn: Connection
  active: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <button
      type="button"
      data-active={active}
      className="group relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent data-[active=true]:bg-accent"
      onClick={onSelect}
    >
      <span className="text-muted-foreground group-data-[active=true]:text-foreground">
        <DriverIcon driver={conn.driver} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight">
          {conn.name ?? "未命名"}
        </p>
        <p className="text-xs leading-tight text-muted-foreground">
          {driverLabel[conn.driver] ?? conn.driver}
        </p>
      </div>

      <DropdownMenu>
        {/* stopPropagation prevents the parent button's onClick from firing */}
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 opacity-0 group-hover:opacity-100 data-popup-open:opacity-100"
            />
          }
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>

        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
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
    </button>
  )
}

// ─── Nav ─────────────────────────────────────────────────────────────────────

export interface NavProps {
  /** Increment this value from the parent to trigger a connection list refresh */
  refreshKey?: number
  /** Called after a successful mutation so the parent can react if needed */
  onChanged?: () => void
}

export default function Nav({ refreshKey, onChanged }: NavProps) {
  const [connections, setConnections] = useState<Connection[]>([])
  const [editTarget, setEditTarget] = useState<Connection | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  // Accepts an ignored `_trigger` so callers can pass `refreshKey` as an
  // argument, making it visible to Biome's exhaustive-deps rule in useEffect.
  const load = useCallback(async (_trigger?: unknown) => {
    try {
      const list = await connection.list()
      setConnections(list)
    } catch {
      toast.error("加载连接列表失败")
    }
  }, [])

  // Re-fetch on mount and whenever the parent bumps refreshKey.
  // Passing refreshKey as an argument satisfies the exhaustive-deps rule
  // while keeping `load` itself stable.
  useEffect(() => {
    load(refreshKey)
  }, [load, refreshKey])

  const handleDelete = async (conn: Connection) => {
    try {
      await connection.delete(conn.id)
      setConnections((prev) => prev.filter((c) => c.id !== conn.id))
      if (activeId === conn.id) setActiveId(null)
      toast.success(`"${conn.name ?? "连接"}" 已删除`)
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    }
  }

  return (
    <nav className="bg-sidebar border-r text-sidebar-foreground flex flex-col">
      {/* Header */}
      <div className="flex-none basis-10 overflow-hidden border-b px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          连接
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => load()}
          title="刷新连接列表"
        >
          <RefreshCw />
        </Button>
      </div>

      {/* Connection list */}
      <ScrollArea className="flex-auto">
        {connections.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            暂无连接
          </p>
        ) : (
          <ul className="space-y-0.5 p-2">
            {connections.map((conn) => (
              <li key={conn.id}>
                <ConnectionItem
                  conn={conn}
                  active={activeId === conn.id}
                  onSelect={() => setActiveId(conn.id)}
                  onEdit={() => setEditTarget(conn)}
                  onDelete={() => handleDelete(conn)}
                />
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>

      {/* Edit dialog — rendered outside the list so it isn't clipped */}
      <EditConnDialog
        conn={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          setEditTarget(null)
          load()
          onChanged?.()
        }}
      />
    </nav>
  )
}
