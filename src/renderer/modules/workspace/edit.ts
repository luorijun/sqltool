import { atom, getDefaultStore } from "jotai"
import type { CellChange, QueryResult } from "@/core/database"
import database, {
  connectionsAtom,
  RequestError,
  sessionsAtom,
} from "@/renderer/modules/database"
import { createLogEntry, trimLogs } from "./logs"
import { tabStatesAtom, toTableRows, updateLog } from "./state"
import type { EditState, TabState } from "./types"

export function createEdits(result?: QueryResult): EditState {
  return {
    resultId: result?.edit?.id ?? crypto.randomUUID(),
    info: result?.edit,
    changes: [],
    history: [],
    future: [],
  }
}
export function editedRows(
  data: Record<string, unknown>[],
  changes: CellChange[],
) {
  if (!changes.length) return data
  const rows = [...data]
  const changed = new Set<number>()
  for (const change of changes) {
    if (!rows[change.row]) continue
    if (!changed.has(change.row)) {
      rows[change.row] = { ...rows[change.row] }
      changed.add(change.row)
    }
    rows[change.row][change.column] = change.value
  }
  return rows
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a instanceof Date || b instanceof Date)
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  if (
    (a instanceof ArrayBuffer || ArrayBuffer.isView(a)) &&
    (b instanceof ArrayBuffer || ArrayBuffer.isView(b))
  ) {
    const left =
      a instanceof ArrayBuffer
        ? new Uint8Array(a)
        : new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
    const right =
      b instanceof ArrayBuffer
        ? new Uint8Array(b)
        : new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
    return (
      left.length === right.length &&
      left.every((value, index) => value === right[index])
    )
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(
      (key) => Object.hasOwn(right, key) && same(left[key], right[key]),
    )
  )
}
export function changeCell(
  edit: EditState,
  data: Record<string, unknown>[],
  change: CellChange,
): EditState {
  if (edit.saving || edit.confirming || !data[change.row]) return edit
  const previous = edit.changes.find(
    (c) => c.row === change.row && c.column === change.column,
  )
  if (
    same(
      previous ? previous.value : data[change.row][change.column],
      change.value,
    )
  )
    return edit
  const changes = edit.changes.filter(
    (c) => c.row !== change.row || c.column !== change.column,
  )
  if (!same(data[change.row][change.column], change.value)) changes.push(change)
  return {
    ...edit,
    changes,
    history: [...edit.history.slice(-99), edit.changes],
    future: [],
    error: undefined,
    notice: undefined,
  }
}
function patchTable(
  tab: TabState,
  values: { data?: Record<string, unknown>[]; edits?: EditState },
): TabState {
  return tab.kind === "query"
    ? { ...tab, table: { ...tab.table, ...values } }
    : { ...tab, table: { ...tab.table, ...values } }
}
function updateEdit(
  states: Record<string, TabState>,
  tabId: string,
  change: (edit: EditState, tab: TabState) => EditState,
) {
  const tab = states[tabId]
  if (!tab) return states
  const edit = tab.table.edits ?? createEdits()
  const next = change(edit, tab)
  if (next === edit) return states
  return { ...states, [tabId]: patchTable(tab, { edits: next }) }
}
export const changeCellAtom = atom(
  null,
  (_get, set, { tabId, ...change }: CellChange & { tabId: string }) => {
    set(tabStatesAtom, (states) =>
      updateEdit(states, tabId, (edit, tab) =>
        tab.closing || !tab.table.columns.some((c) => c.id === change.column)
          ? edit
          : changeCell(edit, tab.table.data, change),
      ),
    )
  },
)
export const setCellEditingAtom = atom(
  null,
  (_get, set, { tabId, editing }: { tabId: string; editing: boolean }) => {
    set(tabStatesAtom, (states) =>
      updateEdit(states, tabId, (edit) => ({ ...edit, editing })),
    )
  },
)
export const undoEditAtom = atom(
  null,
  (_get, set, { tabId, redo = false }: { tabId: string; redo?: boolean }) => {
    set(tabStatesAtom, (states) =>
      updateEdit(states, tabId, (edit) => {
        const list = redo ? edit.future : edit.history
        const previous = list.at(-1)
        if (edit.saving || edit.confirming || edit.editing || !previous)
          return edit
        return {
          ...edit,
          changes: previous,
          history: redo
            ? [...edit.history, edit.changes]
            : edit.history.slice(0, -1),
          future: redo
            ? edit.future.slice(0, -1)
            : [...edit.future, edit.changes],
          error: undefined,
          notice: undefined,
        }
      }),
    )
  },
)
export const discardEditsAtom = atom(
  null,
  (_get, set, { tabId }: { tabId: string }) => {
    set(tabStatesAtom, (states) =>
      updateEdit(states, tabId, (edit) =>
        edit.saving || edit.editing
          ? edit
          : {
              ...edit,
              changes: [],
              history: [...edit.history.slice(-99), edit.changes],
              future: [],
              error: undefined,
              notice: undefined,
            },
      ),
    )
  },
)
export function saveReason(tab: TabState, stale: boolean) {
  const edit = tab.table.edits
  if (edit?.uncertain) return "提交结果未知，请刷新并核实数据库状态"
  if (stale) return "原会话或连接已失效，请重新查询"
  if (!edit?.info?.source) return edit?.info?.reason ?? "此结果仅支持本地修改"
  if (edit.changes.some((c) => !edit.info?.writable.includes(c.column)))
    return "包含仅本地修改的单元格，请恢复这些单元格后提交"
  return undefined
}
function isStale(
  tab: TabState,
  sessions: Array<{ id: string; status: string }>,
  connections: Array<{
    config: { id: string }
    connected: boolean
    generation: number
  }> | null,
) {
  if (tab.kind === "query") {
    const session = sessions.find((s) => s.id === tab.table.sessionId)
    return (
      !session || session.id !== tab.sessionId || session.status !== "ready"
    )
  }
  const connection = connections?.find((c) => c.config.id === tab.configId)
  return (
    !connection?.connected || connection.generation !== tab.table.generation
  )
}
export const saveEditsAtom = atom(
  null,
  async (get, set, { tabId }: { tabId: string }): Promise<boolean> => {
    const tab = get(tabStatesAtom)[tabId]
    const edit = tab?.table.edits
    if (
      !tab ||
      !edit ||
      edit.saving ||
      edit.editing ||
      tab.closing ||
      (tab.kind === "query" ? !!tab.execution : tab.table.status === "running")
    )
      return false
    const reason = saveReason(
      tab,
      isStale(tab, get(sessionsAtom), get(connectionsAtom)),
    )
    if (reason) {
      set(tabStatesAtom, (states) =>
        updateEdit(states, tabId, (current) => ({ ...current, error: reason })),
      )
      return false
    }
    if (!edit.changes.length) return true
    const requestId = crypto.randomUUID()
    const startedAt = Date.now()
    set(tabStatesAtom, (states) =>
      updateEdit(states, tabId, (current) => ({
        ...current,
        saving: requestId,
        error: undefined,
      })),
    )
    const current = () =>
      get(tabStatesAtom)[tabId]?.table.edits?.resultId === edit.resultId
    try {
      const result = await database.saveResult(
        tabId,
        requestId,
        edit.resultId,
        edit.changes,
      )
      if (!current()) return false
      set(tabStatesAtom, (states) => {
        const tab = states[tabId]
        if (!tab || tab.table.edits?.resultId !== edit.resultId) return states
        const data = [...tab.table.data]
        for (const item of result.rows)
          data[item.row] = toTableRows({
            columns: tab.table.columns,
            rows: [item.values],
          })[0]
        return {
          ...states,
          [tabId]: patchTable(tab, {
            data,
            edits: {
              ...edit,
              changes: [],
              history: [],
              future: [],
              saving: undefined,
              confirming: false,
              notice: result.transaction
                ? "已应用到当前事务，尚未 COMMIT"
                : "修改已提交到数据库",
            },
          }),
        }
      })
      set(tabStatesAtom, (states) =>
        updateLog(states, tabId, (log) => ({
          ...log,
          logs: trimLogs([
            ...log.logs,
            createLogEntry(
              "success",
              "",
              result.transaction
                ? "表格修改已应用到当前事务"
                : "表格修改已提交",
              {
                startedAt,
                finishedAt: Date.now(),
                detail: `更新 ${result.rows.length} 行`,
              },
            ),
          ]),
        })),
      )
      return true
    } catch (error) {
      if (current()) {
        const message = error instanceof Error ? error.message : "提交失败"
        set(tabStatesAtom, (states) =>
          updateEdit(states, tabId, (current) => ({
            ...current,
            saving: undefined,
            error: message,
            uncertain:
              error instanceof RequestError && error.kind === "unknown",
          })),
        )
        set(tabStatesAtom, (states) =>
          updateLog(states, tabId, (log) => ({
            ...log,
            logs: trimLogs([
              ...log.logs,
              createLogEntry(
                error instanceof RequestError ? error.kind : "error",
                "",
                message,
                { startedAt, finishedAt: Date.now() },
              ),
            ]),
          })),
        )
      }
      return false
    }
  },
)
export const guardEditsAtom = atom(
  null,
  async (get, set, tabId: string): Promise<boolean> => {
    const tab = get(tabStatesAtom)[tabId]
    const edit = tab?.table.edits
    if (!edit) return true
    if (edit.saving || edit.confirming || edit.editing) return false
    if (!edit.changes.length) return true
    const reason = saveReason(
      tab,
      isStale(tab, get(sessionsAtom), get(connectionsAtom)),
    )
    set(tabStatesAtom, (states) =>
      updateEdit(states, tabId, (current) => ({
        ...current,
        confirming: true,
      })),
    )
    try {
      const choice = await window.main.system.confirmChanges(!reason)
      if (get(tabStatesAtom)[tabId]?.table.edits?.resultId !== edit.resultId)
        return false
      if (choice === "discard") {
        set(discardEditsAtom, { tabId })
        return true
      }
      if (choice === "submit") return await set(saveEditsAtom, { tabId })
      return false
    } finally {
      set(tabStatesAtom, (states) =>
        updateEdit(states, tabId, (current) => ({
          ...current,
          confirming: false,
        })),
      )
    }
  },
)
export function watchResultChanges() {
  const store = getDefaultStore()
  let dirty = false
  const sync = () => {
    const next = Object.values(store.get(tabStatesAtom)).some(
      (tab) => !!tab.table.edits?.changes.length || !!tab.table.edits?.editing,
    )
    if (next !== dirty) {
      dirty = next
      void window.main.system.setDirty(next)
    }
  }
  sync()
  return store.sub(tabStatesAtom, sync)
}
