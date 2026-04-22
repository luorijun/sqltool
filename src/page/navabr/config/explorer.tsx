import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Config } from "@/lib/config"

import { Database, HardDrive, Server } from "lucide-react"

export const driverLabel: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
}

export function DriverIcon({ driver }: { driver: string }) {
  if (driver === "sqlite") return <HardDrive className="size-4 shrink-0" />
  if (driver === "mysql") return <Server className="size-4 shrink-0" />
  return <Database className="size-4 shrink-0" />
}

interface ConnectionItemProps {
  conn: Config
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}

function ConnectionItem({
  conn,
  onSelect,
  onEdit,
  onDelete,
}: ConnectionItemProps) {
  return (
    <div className="w-full flex items-stretch group">
      <button
        type="button"
        className="flex-auto relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent"
        onClick={onSelect}
      >
        <span className="text-muted-foreground group-hover:text-foreground">
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
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="flex-none h-auto self-stretch opacity-0 group-hover:opacity-100 data-popup-open:opacity-100"
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
    </div>
  )
}

export interface ConfigExplorerProps {
  connections: Config[]
  onSelect: (conn: Config) => void
  onEdit: (conn: Config) => void
  onDelete: (conn: Config) => void
}

export function ConfigExplorer({
  connections,
  onSelect,
  onEdit,
  onDelete,
}: ConfigExplorerProps) {
  return (
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
                onSelect={() => onSelect(conn)}
                onEdit={() => onEdit(conn)}
                onDelete={() => onDelete(conn)}
              />
            </li>
          ))}
        </ul>
      )}
    </ScrollArea>
  )
}
