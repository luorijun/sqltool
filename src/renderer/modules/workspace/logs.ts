import { atom } from "jotai"
import { tabStatesAtom, updateTabLoggerState } from "./state"
import type { LogView, TabLogEntry, TabLogStatus } from "./types"

let nextLogId = 1

const MAX_TAB_LOG_ENTRIES = 300

export function trimLogs(entries: TabLogEntry[]): TabLogEntry[] {
  return entries.length <= MAX_TAB_LOG_ENTRIES
    ? entries
    : entries.slice(entries.length - MAX_TAB_LOG_ENTRIES)
}

export function createLogEntry(
  status: TabLogStatus,
  sql: string,
  summary: string,
  options?: {
    detail?: string
    startedAt?: number
    finishedAt?: number
    durationMs?: number
  },
): TabLogEntry {
  return {
    id: String(nextLogId++),
    status,
    sql,
    summary,
    detail: options?.detail,
    startedAt: options?.startedAt ?? Date.now(),
    finishedAt: options?.finishedAt,
    durationMs: options?.durationMs,
  }
}

export function upsertLogEntry(
  entries: TabLogEntry[],
  entryId: string,
  getNextEntry: (current?: TabLogEntry) => TabLogEntry,
): TabLogEntry[] {
  const index = entries.findIndex((entry) => entry.id === entryId)
  if (index === -1) {
    return [...entries, getNextEntry()]
  }

  const nextEntries = [...entries]
  nextEntries[index] = getNextEntry(nextEntries[index])
  return nextEntries
}

export const updateLogViewAtom = atom(
  null,
  (
    _get,
    set,
    { tabId, update }: { tabId: string; update: (current: LogView) => LogView },
  ) => {
    set(tabStatesAtom, (states) => {
      const tab = states[tabId]
      if (!tab) return states
      const next = update(tab.logger)
      if (next === tab.logger) return states
      const { query, statuses, followTail } = next
      return {
        ...states,
        [tabId]: {
          ...tab,
          logger: { ...tab.logger, query, statuses, followTail },
        },
      }
    })
  },
)

export const clearLogsAtom = atom(null, (_get, set, tabId: string) => {
  set(tabStatesAtom, (states) =>
    updateTabLoggerState(states, tabId, (current) => ({
      ...current,
      logs: [],
    })),
  )
})
