import { useAtomValue, useSetAtom } from "jotai"
import {
  activeTabConnectionAtom,
  activeTabEditorStateAtom,
  activeTabIdAtom,
  activeTabLogsAtom,
  activeTabLogUiAtom,
  activeTabResultAtom,
  activeTabSqlAtom,
  activeTabTableUiAtom,
  addTabAtom,
  clearActiveTabLogsAtom,
  closeTabAtom,
  resetActiveTabTableUiAtom,
  runActiveTabSqlAtom,
  tabsAtom,
  updateActiveSqlAtom,
  updateActiveTabEditorStateAtom,
  updateActiveTabLogUiAtom,
  updateActiveTabTableUiAtom,
} from "./renderer"

export function useHasTabs() {
  return useAtomValue(tabsAtom).length > 0
}

export function useCreateTab() {
  return useSetAtom(addTabAtom)
}

export function useTabBar() {
  const tabs = useAtomValue(tabsAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const selectTab = useSetAtom(activeTabIdAtom)
  const addTab = useSetAtom(addTabAtom)
  const closeTab = useSetAtom(closeTabAtom)

  return {
    tabs,
    activeTabId,
    selectTab,
    addTab,
    closeTab,
  }
}

export function useActiveTabEditor() {
  const activeTabId = useAtomValue(activeTabIdAtom)
  const connection = useAtomValue(activeTabConnectionAtom)
  const editorState = useAtomValue(activeTabEditorStateAtom)
  const result = useAtomValue(activeTabResultAtom)
  const sql = useAtomValue(activeTabSqlAtom)
  const updateSql = useSetAtom(updateActiveSqlAtom)
  const runSql = useSetAtom(runActiveTabSqlAtom)
  const updateEditorState = useSetAtom(updateActiveTabEditorStateAtom)

  return {
    activeTabId,
    connection,
    editorState,
    result,
    sql,
    updateSql,
    runSql,
    updateEditorState,
  }
}

export function useActiveTabLogs() {
  const entries = useAtomValue(activeTabLogsAtom)
  const logUi = useAtomValue(activeTabLogUiAtom)
  const clearLogs = useSetAtom(clearActiveTabLogsAtom)
  const updateLogUi = useSetAtom(updateActiveTabLogUiAtom)

  return {
    entries,
    logUi,
    clearLogs,
    updateLogUi,
  }
}

export function useActiveTabTableState() {
  const result = useAtomValue(activeTabResultAtom)
  const tableUi = useAtomValue(activeTabTableUiAtom)

  return {
    result,
    tableUi,
  }
}

export function useActiveTabTableActions() {
  const updateTableUi = useSetAtom(updateActiveTabTableUiAtom)
  const resetTableUi = useSetAtom(resetActiveTabTableUiAtom)

  return {
    updateTableUi,
    resetTableUi,
  }
}
