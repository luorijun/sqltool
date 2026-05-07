import type { ConfigProfile } from "../config"
import type { DbSchema, QueryResult, QueryResultColumn } from "."

export interface ConnectionSession {
  inspect(): Promise<DbSchema[]>
  query(sql: string): Promise<QueryResult>
  close(): Promise<void>
  onDidClose(listener: () => void): () => void
}

export type DriverConnect = (
  profile: ConfigProfile,
) => Promise<ConnectionSession>

export function createCloseNotifier() {
  const listeners = new Set<() => void>()

  return {
    notify() {
      for (const listener of Array.from(listeners)) {
        listener()
      }
    },
    onDidClose(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function parsePort(value: string, label: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`无效的${label}: ${value}`)
  }

  return port
}

export function toQueryRowCount(
  value: number | null | undefined,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined
  }

  return Math.max(0, Math.trunc(value))
}

export function toRowCount(value: number | string | null): number | undefined {
  if (value === null) {
    return undefined
  }

  const count = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(count)) {
    return undefined
  }

  return Math.max(0, Math.trunc(count))
}

export function createQueryColumns(names: string[]): QueryResultColumn[] {
  return names.map((name, index) => ({
    id: `${name || "column"}_${index}`,
    name,
  }))
}
