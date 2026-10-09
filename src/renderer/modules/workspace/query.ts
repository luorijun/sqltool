import { atom } from "jotai"
import connApi, {
  RequestError,
  sessionsAtom,
} from "@/renderer/modules/database"
import { createEdits, guardEditsAtom } from "./edit"
import { createLogEntry, trimLogs, upsertLogEntry } from "./logs"
import {
  createQueryTable,
  tabStatesAtom,
  toTableRows,
  updateLog,
  updateQueryTable,
} from "./state"
import type { LogStatus, QueryTabState } from "./types"

export const openings = new Map<string, Promise<string>>()

export const runQueryAtom = atom(
  null,
  async (get, set, { tabId }: { tabId: string }) => {
    let tab = get(tabStatesAtom)[tabId]
    if (!tab || tab.closing || tab.kind !== "query") {
      return
    }

    const editor = tab.editor
    if (tab.execution) return
    const sql = editor.text
    const trimmedSql = sql.trim()

    if (!trimmedSql) {
      const finishedAt = Date.now()

      set(tabStatesAtom, (states) =>
        updateQueryTable(states, tabId, (current) => ({
          ...current,
          status: "error",
          error: "SQL 不能为空",
        })),
      )
      set(tabStatesAtom, (states) =>
        updateLog(states, tabId, (current) => ({
          ...current,
          logs: trimLogs([
            ...current.logs,
            createLogEntry("error", sql, "SQL 不能为空", {
              detail: "请输入要执行的 SQL 语句",
              finishedAt,
            }),
          ]),
        })),
      )
      return
    }

    if (!tab.configId) {
      const finishedAt = Date.now()

      set(tabStatesAtom, (states) =>
        updateQueryTable(states, tabId, (current) => ({
          ...current,
          status: "error",
          error: "该标签页未绑定数据库连接",
        })),
      )
      set(tabStatesAtom, (states) =>
        updateLog(states, tabId, (current) => ({
          ...current,
          logs: trimLogs([
            ...current.logs,
            createLogEntry("error", sql, "该标签页未绑定数据库连接", {
              detail: "请先为当前标签页选择数据库连接",
              finishedAt,
            }),
          ]),
        })),
      )
      return
    }

    if (
      tab.table.edits &&
      (tab.table.edits.changes.length ||
        tab.table.edits.saving ||
        tab.table.edits.confirming ||
        tab.table.edits.editing)
    ) {
      if (!(await set(guardEditsAtom, tabId))) return
      tab = get(tabStatesAtom)[tabId]
      if (
        tab?.kind !== "query" ||
        !tab.configId ||
        tab.closing ||
        tab.execution
      )
        return
    }
    const requestId = crypto.randomUUID()
    let sessionId = tab.sessionId
    const isCurrent = () => {
      const current = get(tabStatesAtom)[tabId]
      return (
        current?.kind === "query" &&
        current.execution?.requestId === requestId &&
        (!sessionId || current.sessionId === sessionId)
      )
    }
    set(tabStatesAtom, (states) => ({
      ...states,
      [tabId]: {
        ...tab,
        execution: { requestId, cancelRequested: false },
      },
    }))
    const startedAt = Date.now()
    const runningLog = createLogEntry("running", sql, "正在执行 SQL", {
      detail: "正在等待数据库返回结果",
      startedAt,
    })
    const recordLate = (status: LogStatus, summary: string) => {
      set(tabStatesAtom, (states) =>
        updateLog(states, tabId, (current) => ({
          ...current,
          logs: current.logs.map((entry) =>
            entry.id === runningLog.id
              ? {
                  ...entry,
                  status,
                  summary,
                  detail: "来自此前会话，未更新当前结果",
                  finishedAt: Date.now(),
                  durationMs: Math.max(1, Date.now() - startedAt),
                }
              : entry,
          ),
        })),
      )
    }

    set(tabStatesAtom, (states) =>
      updateLog(states, tabId, (current) => ({
        ...current,
        logs: trimLogs([...current.logs, runningLog]),
      })),
    )

    try {
      if (!sessionId) {
        const opening = connApi.openSession(tab.configId, tabId)
        openings.set(tabId, opening)
        try {
          sessionId = await opening
        } finally {
          openings.delete(tabId)
        }
        set(tabStatesAtom, (states) => {
          const current = states[tabId]
          return current?.kind === "query" &&
            current.execution?.requestId === requestId
            ? { ...states, [tabId]: { ...current, sessionId } }
            : states
        })
      }
      const current = get(tabStatesAtom)[tabId]
      if (
        !isCurrent() ||
        current.closing ||
        (current.kind === "query" && current.execution?.cancelRequested)
      )
        throw new RequestError("请求已取消，未执行 SQL", "cancelled")
      const session = get(sessionsAtom).find((s) => s.id === sessionId)
      if (
        !session ||
        session.status === "closed" ||
        session.status === "failed"
      )
        throw new Error(
          "会话已失效，请重建会话；原事务、临时表及会话设置不会恢复",
        )
      const result = await connApi.query(sessionId, requestId, sql)
      if (!isCurrent()) {
        recordLate(
          "success",
          `原会话返回 ${result.rowCount ?? result.rows.length} 行`,
        )
        return
      }
      const rowCount =
        typeof result.rowCount === "number"
          ? result.rowCount
          : result.rows.length
      const durationMs = Math.max(1, Date.now() - startedAt)
      const finishedAt = Date.now()

      set(tabStatesAtom, (states) =>
        updateQueryTable(states, tabId, {
          ...createQueryTable(),
          status: "success",
          error: null,
          dataAt: finishedAt,
          sessionId,
          edits: createEdits(result),
          columns: result.columns,
          data: toTableRows(result),
        }),
      )
      set(tabStatesAtom, (states) =>
        updateLog(states, tabId, (current) => ({
          ...current,
          logs: trimLogs(
            upsertLogEntry(current.logs, runningLog.id, (currentLog) => ({
              ...(currentLog ?? runningLog),
              status: "success",
              summary: `返回 ${rowCount} 行`,
              detail: undefined,
              finishedAt,
              durationMs,
            })),
          ),
        })),
      )
    } catch (error) {
      if (!isCurrent()) {
        recordLate(
          error instanceof RequestError ? error.kind : "error",
          error instanceof Error ? error.message : "原会话执行失败",
        )
        return
      }
      const durationMs = Math.max(1, Date.now() - startedAt)
      const finishedAt = Date.now()
      const message = error instanceof Error ? error.message : "查询执行失败"

      set(tabStatesAtom, (states) =>
        updateQueryTable(states, tabId, (current) => ({
          ...current,
          status: "error",
          error: message,
        })),
      )
      set(tabStatesAtom, (states) =>
        updateLog(states, tabId, (current) => ({
          ...current,
          logs: trimLogs(
            upsertLogEntry(current.logs, runningLog.id, (currentLog) => ({
              ...(currentLog ?? runningLog),
              status: error instanceof RequestError ? error.kind : "error",
              summary: message,
              detail: message,
              finishedAt,
              durationMs,
            })),
          ),
        })),
      )
    } finally {
      if (isCurrent())
        set(tabStatesAtom, (states) => ({
          ...states,
          [tabId]: {
            ...(states[tabId] as QueryTabState),
            execution: undefined,
          },
        }))
    }
  },
)

export const cancelQueryAtom = atom(
  null,
  async (get, set, { tabId }: { tabId: string }) => {
    const tab = get(tabStatesAtom)[tabId]
    if (
      tab?.kind !== "query" ||
      !tab.execution ||
      tab.closing ||
      tab.execution?.cancelRequested
    )
      return
    const requestId = tab.execution.requestId
    set(tabStatesAtom, (states) => ({
      ...states,
      [tab.id]: { ...tab, execution: { requestId, cancelRequested: true } },
    }))
    try {
      await connApi.cancel(requestId)
    } catch (error) {
      set(tabStatesAtom, (states) => {
        const current = states[tab.id]
        return current?.kind === "query" &&
          current.execution?.requestId === requestId
          ? {
              ...states,
              [tab.id]: {
                ...current,
                execution: { requestId, cancelRequested: false },
              },
            }
          : states
      })
      throw error
    }
  },
)

export const rebuildSessionAtom = atom(
  null,
  async (get, set, { tabId }: { tabId: string }) => {
    let tab = get(tabStatesAtom)[tabId]
    if (tab?.kind !== "query" || !tab.configId || tab.closing) return
    if (!(await set(guardEditsAtom, tabId))) return
    tab = get(tabStatesAtom)[tabId]
    if (tab?.kind !== "query" || !tab.configId || tab.closing) return
    set(tabStatesAtom, (states) => ({
      ...states,
      [tab.id]: { ...tab, closing: true },
    }))
    try {
      await openings.get(tab.id)?.catch(() => {})
      // closeTab also handles a session whose open response has not yet reached the tab.
      if (!(await connApi.closeTab(tab.id))) return
      const sessionId = await connApi.openSession(tab.configId, tab.id)
      set(tabStatesAtom, (states) => {
        const current = states[tab.id]
        if (current?.kind !== "query") return states
        return {
          ...states,
          [tab.id]: {
            ...current,
            sessionId,
            execution: undefined,
          },
        }
      })
    } finally {
      set(tabStatesAtom, (states) =>
        states[tab.id]
          ? { ...states, [tab.id]: { ...states[tab.id], closing: false } }
          : states,
      )
    }
  },
)
