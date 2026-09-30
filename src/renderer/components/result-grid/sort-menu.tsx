import { ArrowDownAZ, ArrowUpAZ, GripVertical } from "lucide-react"
import { useId, useRef, useState } from "react"
import { Button } from "@/renderer/components/ui/button"
import {
  Popover,
  PopoverActions,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/renderer/components/ui/popover"
import { createSortDraft, moveSort, type SortItem, toggleSort } from "./sorting"
import type { ResultTableInstance } from "./types"

export function SortMenu({
  table,
  busy,
  draft,
  focusColumn,
  order,
  onEdit,
  onClose,
}: {
  table: ResultTableInstance
  busy: boolean
  order: string[]
  draft: SortItem[] | null
  focusColumn: string | null
  onEdit: (draft: SortItem[]) => void
  onClose: (commit: boolean) => void
}) {
  const id = useId()
  const dragged = useRef<string | null>(null)
  const [target, setTarget] = useState<{ id: string; after: boolean } | null>(
    null,
  )
  const columns = table
    .getAllLeafColumns()
    .filter((column) => column.getCanSort())
  const items = draft ?? []
  const ordered = items.flatMap((item) =>
    columns.filter((column) => column.id === item.id),
  )
  const resetDrag = () => {
    dragged.current = null
    setTarget(null)
  }
  return (
    <Popover
      triggerId={id}
      open={draft !== null}
      onOpenChange={(open, details) => {
        resetDrag()
        if (open)
          onEdit(
            createSortDraft(
              columns.map((column) => column.id),
              table.state.sorting,
              order,
            ),
          )
        else onClose(details.reason !== "escape-key")
      }}
    >
      <PopoverTrigger
        id={id}
        render={
          <Button
            variant="ghost"
            size="xs"
            disabled={busy || !columns.length}
            className="gap-1.5 text-muted-foreground"
          />
        }
      >
        <ArrowDownAZ className="size-3" />
        排序
      </PopoverTrigger>
      <PopoverContent
        className="w-80"
        aria-label="排序"
        initialFocus={() => {
          if (!focusColumn) return true
          return document.getElementById(`${id}-${focusColumn}`) ?? true
        }}
      >
        <ul
          className="max-h-72 overflow-auto"
          aria-label="排序字段"
          onDragLeave={(event) => {
            if (
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            )
              setTarget(null)
          }}
        >
          {ordered.map((column, index) => {
            const order = items.find((item) => item.id === column.id)
            const name = String(column.columnDef.header ?? column.id)
            return (
              <li
                key={column.id}
                className="relative flex items-center gap-1 rounded-lg px-1 py-1"
                onDragOver={(event) => {
                  if (!dragged.current) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = "move"
                  const rect = event.currentTarget.getBoundingClientRect()
                  setTarget({
                    id: column.id,
                    after: event.clientY > rect.top + rect.height / 2,
                  })
                }}
                onDrop={(event) => {
                  if (!dragged.current) return
                  event.preventDefault()
                  const from = items.findIndex(
                    (item) => item.id === dragged.current,
                  )
                  const rect = event.currentTarget.getBoundingClientRect()
                  const slot =
                    index + (event.clientY > rect.top + rect.height / 2 ? 1 : 0)
                  const to = slot - (from < slot ? 1 : 0)
                  onEdit(moveSort(items, dragged.current, to))
                  resetDrag()
                }}
              >
                {target?.id === column.id && (
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-x-0 h-0.5 bg-primary ${target.after ? "bottom-0" : "top-0"}`}
                  />
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  draggable
                  aria-label={`调整 ${name} 的排序优先级`}
                  title="拖动调整优先级；方向键上移或下移"
                  className="cursor-grab text-muted-foreground active:cursor-grabbing"
                  onDragStart={(event) => {
                    dragged.current = column.id
                    event.dataTransfer.effectAllowed = "move"
                    event.dataTransfer.setData("text/plain", column.id)
                  }}
                  onDragEnd={resetDrag}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                      return
                    event.preventDefault()
                    onEdit(
                      moveSort(
                        items,
                        column.id,
                        index + (event.key === "ArrowUp" ? -1 : 1),
                      ),
                    )
                  }}
                >
                  <GripVertical className="size-3" />
                </Button>
                <span className="min-w-0 flex-1 truncate text-sm" title={name}>
                  {name}
                </span>
                <Button
                  id={`${id}-${column.id}`}
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${name} 升序`}
                  aria-pressed={order?.desc === false}
                  className={
                    order?.desc === false
                      ? "bg-accent text-primary"
                      : "text-muted-foreground"
                  }
                  onClick={() => onEdit(toggleSort(items, column.id, false))}
                >
                  <ArrowUpAZ className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${name} 降序`}
                  aria-pressed={order?.desc === true}
                  className={
                    order?.desc === true
                      ? "bg-accent text-primary"
                      : "text-muted-foreground"
                  }
                  onClick={() => onEdit(toggleSort(items, column.id, true))}
                >
                  <ArrowDownAZ className="size-3.5" />
                </Button>
              </li>
            )
          })}
        </ul>
        <PopoverActions>
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto"
            onClick={() =>
              onEdit(
                createSortDraft(
                  columns.map((column) => column.id),
                  [],
                  [],
                ),
              )
            }
          >
            清除排序
          </Button>
          <PopoverClose render={<Button size="sm" />}>应用</PopoverClose>
        </PopoverActions>
      </PopoverContent>
    </Popover>
  )
}
