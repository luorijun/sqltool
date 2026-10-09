import { useAtomValue, useSetAtom } from "jotai"
import type { CodeAreaProps } from "@/renderer/components/code-area"
import type { TableAreaProps } from "@/renderer/components/table-area"
import { connectionsAtom } from "@/renderer/modules/database"
import {
  activeResultStaleAtom,
  activeTabIdAtom,
  activeViewTabAtom,
  activeViewTableAtom,
  cancelViewAtom,
  copyOptionsAtom,
  getPagination,
  refreshViewAtom,
  resetViewLayoutAtom,
  setCopyOptionsAtom,
  setTableSelectionAtom,
  setViewPageAtom,
  setViewPageSizeAtom,
  setViewRangeAtom,
  setViewSortAtom,
  updateViewCodeAtom,
  updateViewLayoutAtom,
} from "@/renderer/modules/workspace"
import { useTableEditing } from "./edit"
import { saveText, showError } from "./feedback"

export function useViewCode(): Extract<CodeAreaProps, { mode: "view" }> | null {
  const tab = useAtomValue(activeViewTabAtom)
  const tableState = useAtomValue(activeViewTableAtom)
  const connections = useAtomValue(connectionsAtom)
  const stale = useAtomValue(activeResultStaleAtom)
  const updateCode = useSetAtom(updateViewCodeAtom)
  if (!tab) return null
  const config = connections?.find(
    (entry) => entry.config.id === tab.configId,
  )?.config
  const state = { ...tab.code, text: tableState.sql }
  const status =
    tableState.dataAt === null
      ? tableState.status === "error"
        ? "数据加载未成功，暂无可展示的 SQL"
        : "等待数据加载完成后展示 SQL"
      : tableState.status === "running"
        ? "正在加载，显示此前结果的 SQL"
        : stale || tableState.status === "error"
          ? "此前结果的 SQL"
          : "当前结果的 SQL"
  return {
    mode: "view",
    id: tab.id,
    state,
    driver: config?.driver,
    configId: tab.configId,
    connections: connections?.map((entry) => entry.config) ?? null,
    status,
    notice:
      tableState.status !== "success" || stale
        ? tableState.dataAt === null
          ? "暂无 SQL"
          : "此前结果"
        : undefined,
    onStateChange: (change) =>
      updateCode({ tabId: tab.id, view: change(state) }),
    onError: showError,
  }
}

export function useViewTable(): Extract<
  TableAreaProps,
  { mode: "view" }
> | null {
  const id = useAtomValue(activeTabIdAtom)
  const tab = useAtomValue(activeViewTabAtom)
  const tableState = useAtomValue(activeViewTableAtom)
  const stale = useAtomValue(activeResultStaleAtom)
  const copyOptions = useAtomValue(copyOptionsAtom)
  const cancel = useSetAtom(cancelViewAtom)
  const refresh = useSetAtom(refreshViewAtom)
  const resetTable = useSetAtom(resetViewLayoutAtom)
  const updateTable = useSetAtom(updateViewLayoutAtom)
  const setCopyOptions = useSetAtom(setCopyOptionsAtom)
  const setSelection = useSetAtom(setTableSelectionAtom)
  const setPage = useSetAtom(setViewPageAtom)
  const setSize = useSetAtom(setViewPageSizeAtom)
  const setRange = useSetAtom(setViewRangeAtom)
  const setSort = useSetAtom(setViewSortAtom)
  const { data, editing } = useTableEditing(tab, stale)
  if (!tab) return null
  const busy = tableState.status === "running"
  const running = busy || tableState.countStatus === "running"
  const total =
    busy || tableState.countStatus !== "success" ? null : tableState.totalCount
  const { page, totalPages } = getPagination(
    tableState.offset,
    tableState.limit,
    total,
  )
  const hasNext =
    total === null
      ? tableState.data.length === tableState.limit
      : tableState.offset + tableState.limit < total
  const sorting = tableState.sort.flatMap((order) => {
    const column = tableState.columns.find(
      (column) => (column.sourceColumn ?? column.name) === order.column,
    )
    return column ? [{ id: column.id, desc: order.direction === "desc" }] : []
  })
  return {
    mode: "view",
    id,
    tableState: { ...tableState, data },
    editing,
    stale,
    busy,
    running,
    cancelling: tab.cancelling ?? false,
    sorting,
    sortOrder: tableState.sortOrder,
    exportNamePrefix: `${tab.source.table}-data`,
    countError: tableState.countError,
    pagination: {
      offset: tableState.offset,
      limit: tableState.limit,
      page,
      totalPages,
      total,
      hasNext,
    },
    copyOptions,
    onCopyOptionsChange: setCopyOptions,
    onSelectionChange: (selection) => {
      if (id !== null) setSelection({ tabId: id, selection })
    },
    onLayoutChange: (change) => {
      if (id !== null) updateTable({ tabId: id, update: change })
    },
    onReset: () => {
      if (id !== null) resetTable({ tabId: id })
    },
    onCancel: () => {
      if (id !== null)
        void cancel({ tabId: id }).catch((error) =>
          showError(error instanceof Error ? error.message : "取消失败"),
        )
    },
    onRefresh: () => {
      if (id !== null) void refresh({ tabId: id })
    },
    onSortingChange: (sorting, order) => {
      if (id === null) return
      const sort = sorting.flatMap((order) => {
        const column = tableState.columns.find(
          (column) => column.id === order.id,
        )
        return column
          ? [
              {
                column: column.sourceColumn ?? column.name,
                direction: order.desc ? ("desc" as const) : ("asc" as const),
              },
            ]
          : []
      })
      if (sort.length === sorting.length)
        void setSort({ tabId: id, sort, order })
    },
    onPage: (page) => {
      if (id !== null) void setPage({ tabId: id, page })
    },
    onSize: (limit) => {
      if (id !== null) void setSize({ tabId: id, limit })
    },
    onRange: (range) => {
      if (id !== null) void setRange({ tabId: id, ...range })
    },
    onExport: saveText,
    onError: showError,
  }
}
