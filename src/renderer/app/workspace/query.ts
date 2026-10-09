import { useAtomValue, useSetAtom } from "jotai"
import { useCallback, useEffect } from "react"
import type { CodeAreaProps } from "@/renderer/components/code-area"
import type { TableAreaProps } from "@/renderer/components/table-area"
import database, { connectionsAtom } from "@/renderer/modules/database"
import {
  activeQueryConfigAtom,
  activeQueryEditorAtom,
  activeQueryRunningAtom,
  activeQueryTabAtom,
  activeQueryTableAtom,
  activeResultStaleAtom,
  activeSessionAtom,
  activeTabIdAtom,
  bindQueryConfigAtom,
  cancelQueryAtom,
  copyOptionsAtom,
  rebuildSessionAtom,
  resetQueryLayoutAtom,
  runQueryAtom,
  setCopyOptionsAtom,
  setTableSelectionAtom,
  updateQueryEditorAtom,
  updateQueryLayoutAtom,
} from "@/renderer/modules/workspace"
import { useTableEditing } from "./edit"
import { saveText, showError } from "./feedback"

export function useQueryCode(): Extract<CodeAreaProps, { mode: "query" }> {
  const id = useAtomValue(activeTabIdAtom)
  const tab = useAtomValue(activeQueryTabAtom)
  const config = useAtomValue(activeQueryConfigAtom)
  const connections = useAtomValue(connectionsAtom)
  const connection = connections?.find(
    (entry) => entry.config.id === config?.id,
  )
  const session = useAtomValue(activeSessionAtom)
  const running = useAtomValue(activeQueryRunningAtom)
  const state = useAtomValue(activeQueryEditorAtom)
  const cancel = useSetAtom(cancelQueryAtom)
  const rebuild = useSetAtom(rebuildSessionAtom)
  const bind = useSetAtom(bindQueryConfigAtom)
  const run = useSetAtom(runQueryAtom)
  const updateCode = useSetAtom(updateQueryEditorAtom)
  const configId = config?.id
  const loadSchema = useCallback(async () => {
    if (!configId) return []
    return (await database.loadSchema(configId)).schema ?? []
  }, [configId])
  useEffect(() => {
    if (!configId) return
    let active = true
    void database.loadSchema(configId).catch((error) => {
      if (active)
        showError(
          `无法加载 SQL 提示所需的数据库结构：${error instanceof Error ? error.message : "加载失败"}`,
        )
    })
    return () => {
      active = false
    }
  }, [configId])
  const failed =
    !!tab?.sessionId &&
    (!session || session.status === "failed" || session.status === "closed")
  const canRun = !!config && !running && !tab?.closing && !failed
  const act = (run: () => Promise<unknown>) => {
    void run().catch((error) =>
      showError(error instanceof Error ? error.message : "操作失败"),
    )
  }
  const status = tab?.closing
    ? "正在关闭会话"
    : tab?.execution?.cancelRequested
      ? "取消请求处理中，等待查询最终结果"
      : running
        ? "正在执行查询"
        : failed
          ? "会话已失效，请重建会话"
          : session
            ? "已连接"
            : config
              ? "首次执行时连接"
              : "未绑定配置"
  return {
    mode: "query",
    id,
    state,
    driver: config?.driver,
    configId: tab?.configId,
    connections: connections?.map((entry) => entry.config) ?? null,
    schema: connection?.schema ?? undefined,
    loadSchema: configId ? loadSchema : undefined,
    running,
    failed,
    closing: tab?.closing ?? false,
    cancelling: tab?.execution?.cancelRequested ?? false,
    canRun,
    status,
    onStateChange: (change) => {
      if (id !== null) updateCode({ tabId: id, update: change })
    },
    onRun: () => {
      if (canRun && tab) void run({ tabId: tab.id })
    },
    onCancel: () => {
      if (tab) act(() => cancel({ tabId: tab.id }))
    },
    onRebuild: () => {
      if (tab) act(() => rebuild({ tabId: tab.id }))
    },
    onConfigChange: (configId) => {
      if (tab) act(() => bind({ tabId: tab.id, configId }))
    },
    onError: showError,
  }
}

export function useQueryTable(): Extract<TableAreaProps, { mode: "query" }> {
  const id = useAtomValue(activeTabIdAtom)
  const running = useAtomValue(activeQueryRunningAtom)
  const tableState = useAtomValue(activeQueryTableAtom)
  const stale = useAtomValue(activeResultStaleAtom)
  const copyOptions = useAtomValue(copyOptionsAtom)
  const updateTable = useSetAtom(updateQueryLayoutAtom)
  const resetTable = useSetAtom(resetQueryLayoutAtom)
  const tab = useAtomValue(activeQueryTabAtom)
  const { data, editing } = useTableEditing(tab, stale)
  const setCopyOptions = useSetAtom(setCopyOptionsAtom)
  const setSelection = useSetAtom(setTableSelectionAtom)
  return {
    mode: "query",
    id,
    tableState: { ...tableState, data },
    editing,
    stale,
    running,
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
    onExport: saveText,
    onError: showError,
  }
}
