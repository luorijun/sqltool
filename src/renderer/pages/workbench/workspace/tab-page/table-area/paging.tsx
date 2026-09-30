import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "@/renderer/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/renderer/components/ui/dropdown-menu"
import { Input } from "@/renderer/components/ui/input"
import {
  Popover,
  PopoverActions,
  PopoverContent,
  PopoverTrigger,
} from "@/renderer/components/ui/popover"

export function Paging({
  offset,
  limit,
  page,
  totalPages,
  total,
  hasNext,
  busy,
  onPage,
  onSize,
  onRange,
}: {
  offset: number
  limit: number
  page: number
  totalPages: number | null
  total: number | null
  hasNext: boolean
  busy: boolean
  onPage: (page: number) => void
  onSize: (size: number) => void
  onRange: (range: { offset: number; limit: number }) => void
}) {
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState(String(offset + 1))
  const [size, setSize] = useState(String(limit))
  const [jump, setJump] = useState<string | null>(null)
  const dirty = useRef(false)
  const skipJump = useRef(false)
  return (
    <div
      className="flex items-center gap-1"
      onPointerDownCapture={(event) => {
        skipJump.current =
          event.target instanceof Element &&
          !!event.target.closest("[data-page-action]")
      }}
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) {
            setStart(String(offset + 1))
            setSize(String(limit))
          }
          setOpen(next)
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              className="text-muted-foreground"
            />
          }
        >
          范围
        </PopoverTrigger>
        <PopoverContent aria-label="展示范围">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const n = Number(start),
                m = Number(size)
              if (
                !Number.isSafeInteger(n) ||
                n < 1 ||
                !Number.isSafeInteger(m) ||
                m < 1 ||
                !Number.isSafeInteger(n - 1 + m)
              )
                return
              setOpen(false)
              onRange({ offset: n - 1, limit: m })
            }}
          >
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm">
                从第
                <Input
                  aria-label="起始行"
                  type="number"
                  required
                  min={1}
                  max={
                    total === null
                      ? Number.MAX_SAFE_INTEGER
                      : Math.max(1, total)
                  }
                  step={1}
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                  className="h-8 w-28 text-sm"
                />
                行开始
              </label>
              <label className="flex items-center gap-2 text-sm">
                展示
                <Input
                  aria-label="展示行数"
                  type="number"
                  required
                  min={1}
                  max={Number.MAX_SAFE_INTEGER - Math.max(0, Number(start) - 1)}
                  step={1}
                  value={size}
                  onChange={(event) => setSize(event.target.value)}
                  className="h-8 w-28 text-sm"
                />
                行
              </label>
            </div>
            <PopoverActions>
              <Button type="submit" size="sm" disabled={busy}>
                应用
              </Button>
            </PopoverActions>
          </form>
        </PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              className="text-muted-foreground"
            />
          }
        >
          每页 {limit} 行
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {[...new Set([50, 100, 200, limit])]
            .sort((a, b) => a - b)
            .map((size) => (
              <DropdownMenuItem key={size} onClick={() => onSize(size)}>
                每页 {size} 行
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon-xs"
        data-page-action
        title="首页"
        aria-label="首页"
        disabled={busy || offset === 0}
        onClick={() => onPage(1)}
      >
        <ChevronFirst className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        data-page-action
        title="上一页"
        aria-label="上一页"
        disabled={busy || offset === 0}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        data-page-action
        title="下一页"
        aria-label="下一页"
        disabled={busy || !hasNext}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        data-page-action
        title="末页"
        aria-label="末页"
        disabled={busy || totalPages === null || page >= totalPages}
        onClick={() => {
          if (totalPages !== null) onPage(totalPages)
        }}
      >
        <ChevronLast className="size-3.5" />
      </Button>
      <div className="ml-1 flex items-center gap-1 text-xs text-muted-foreground">
        <span>跳至</span>
        <Input
          aria-label="跳转页码"
          type="number"
          required
          min={1}
          max={totalPages ?? Number.MAX_SAFE_INTEGER}
          step={1}
          disabled={busy}
          value={jump ?? String(page)}
          onFocus={() => {
            skipJump.current = false
          }}
          onChange={(event) => {
            dirty.current = true
            setJump(event.target.value)
          }}
          onBlur={(event) => {
            const skip = skipJump.current
            skipJump.current = false
            const changed = dirty.current
            dirty.current = false
            setJump(null)
            if (busy || skip || !changed) return
            const value = Number(event.currentTarget.value)
            if (!Number.isSafeInteger(value) || value < 1) return
            const next =
              totalPages === null ? value : Math.min(value, totalPages)
            if (next !== page) onPage(next)
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== "Escape") return
            event.preventDefault()
            if (event.key === "Escape") {
              dirty.current = false
              setJump(null)
            }
            event.currentTarget.blur()
          }}
          className="h-6 w-16 px-1 text-xs"
        />
        <span>页</span>
      </div>
    </div>
  )
}
