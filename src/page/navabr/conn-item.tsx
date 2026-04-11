import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Config } from "../../lib/config/index"
import { DriverIcon, driverLabel } from "./driver-icon"

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ConnectionItemProps {
  conn: Config
  active: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConnectionItem({
  conn,
  active,
  onSelect,
  onEdit,
  onDelete,
}: ConnectionItemProps) {
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
