import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  ChevronLeft,
  ChevronRight,
  CircleX,
  Loader2,
  RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  activeViewTabAtom,
  activeViewTabTableStateAtom,
  refreshActiveViewTabAtom,
  resetActiveViewTabTableStateAtom,
  setActiveViewTabPageAtom,
  setActiveViewTabPageSizeAtom,
} from "@/lib/tabs/renderer"
import { EmptyState } from "./empty"
import { ResultTable } from "./table"

const PAGE_SIZES = [50, 100, 200]

export default function ViewTableArea() {
  const [tableState, setTableState] = useAtom(activeViewTabTableStateAtom)
  const viewTab = useAtomValue(activeViewTabAtom)
  const resetTableState = useSetAtom(resetActiveViewTabTableStateAtom)
  const refresh = useSetAtom(refreshActiveViewTabAtom)
  const setPage = useSetAtom(setActiveViewTabPageAtom)
  const setPageSize = useSetAtom(setActiveViewTabPageSizeAtom)

  const initialLoading =
    tableState.status === "running" && tableState.dataAt === null
  if (tableState.status === "idle" || initialLoading) {
    return (
      <EmptyState
        icon={<Loader2 className="size-8 animate-spin text-primary/40" />}
        message="正在加载数据表..."
      />
    )
  }

  if (tableState.status === "error" && tableState.dataAt === null) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-3 px-4 text-center">
        <CircleX className="size-8 stroke-[1.25] text-destructive/40" />
        <p className="text-xs text-muted-foreground">
          {tableState.error ?? "数据表加载失败"}
        </p>
        <Button variant="outline" size="sm" onClick={() => refresh()}>
          <RefreshCw className="size-3.5" />
          重试
        </Button>
      </div>
    )
  }

  const totalPages =
    tableState.totalCount === null
      ? null
      : Math.max(1, Math.ceil(tableState.totalCount / tableState.pageSize))
  const hasPrevious = tableState.pageIndex > 0
  const hasNext =
    totalPages === null
      ? tableState.data.length === tableState.pageSize
      : tableState.pageIndex + 1 < totalPages
  const busy = tableState.status === "running"
  const countText =
    tableState.countStatus === "running"
      ? "正在统计总行数..."
      : tableState.totalCount === null
        ? "总行数未知"
        : `共 ${tableState.totalCount.toLocaleString()} 行`

  return (
    <ResultTable
      tableState={tableState}
      setTableState={setTableState}
      onReset={resetTableState}
      enableSorting={false}
      emptyMessage="数据表暂无数据"
      exportNamePrefix={viewTab ? `${viewTab.source.table}-data` : "table-data"}
      toolbarEnd={
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            className="gap-1.5 text-muted-foreground"
            disabled={busy || tableState.countStatus === "running"}
            onClick={() => refresh()}
            title="刷新数据和总行数"
          >
            <RefreshCw className={busy ? "size-3 animate-spin" : "size-3"} />
            刷新
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  disabled={busy}
                />
              }
            >
              每页 {tableState.pageSize} 行
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {PAGE_SIZES.map((pageSize) => (
                <DropdownMenuItem
                  key={pageSize}
                  onClick={() => setPageSize(pageSize)}
                >
                  每页 {pageSize} 行
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="px-1 text-[11px] text-muted-foreground">
            第 {tableState.pageIndex + 1}
            {totalPages === null ? "" : ` / ${totalPages}`} 页
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={busy || !hasPrevious}
            onClick={() => setPage(tableState.pageIndex - 1)}
            title="上一页"
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={busy || !hasNext}
            onClick={() => setPage(tableState.pageIndex + 1)}
            title="下一页"
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      }
      statusBarEnd={
        <>
          <span title={tableState.countError ?? undefined}>{countText}</span>
          {tableState.error && (
            <span className="text-destructive">{tableState.error}</span>
          )}
        </>
      }
    />
  )
}
