import type { ConnectionSession, DriverColumn } from "../ports"
import { ConnError, withTimeout } from "../tasks"

export type QueryColumnInput = Omit<DriverColumn, "id">

interface CreateConnectionSessionOptions {
  prepareMetadata?: ConnectionSession["prepareMetadata"]
  inspect: ConnectionSession["inspect"]
  types?: ConnectionSession["types"]
  charsets?: ConnectionSession["charsets"]
  query: ConnectionSession["query"]
  select: ConnectionSession["select"]
  close: () => Promise<void>
  destroy: () => void
  cancel: (active: () => boolean) => Promise<void>
  watch: (fail: (error: Error) => void) => void
}

export function createConnectionSession(
  options: CreateConnectionSessionOptions,
): ConnectionSession {
  let closePromise: Promise<void> | null = null
  let closed = false
  let active = false
  let failure: Error | null = null
  const listeners = new Set<(error: Error) => void>()
  const fail = (error: Error) => {
    if (closed || failure) return
    failure = error
    for (const listener of listeners) listener(error)
  }
  const getFailure = () => failure
  options.watch(fail)

  const execute = async <T>(run: () => Promise<T>): Promise<T> => {
    if (closed || failure) throw new ConnError(failure?.message ?? "会话已关闭")
    active = true
    try {
      return await run()
    } catch (error) {
      // mysql2 can deliver fatal connection errors only through a query callback.
      const fault = error as { fatal?: boolean; severity?: string }
      if (
        fault.fatal ||
        fault.severity === "FATAL" ||
        fault.severity === "PANIC"
      )
        fail(error as Error)
      const currentFailure = getFailure()
      if (currentFailure || closed)
        throw new ConnError(
          `结果未知：${currentFailure?.message ?? "连接已断开"}，请核实数据库状态`,
          "unknown",
        )
      const code = error as { code?: string; errno?: number }
      if (code.code === "57014" || code.errno === 1317)
        throw new ConnError("查询已取消；事务可能仍需回滚", "cancelled")
      throw error
    } finally {
      active = false
    }
  }

  const close = async () => {
    if (closePromise) {
      return closePromise
    }

    closed = true
    closePromise = (async () => {
      try {
        await withTimeout(options.close())
      } catch {
        options.destroy()
      }
    })()

    await closePromise
  }

  const types = options.types
  const charsets = options.charsets
  return {
    prepareMetadata: options.prepareMetadata,
    inspect: (source) => execute(() => options.inspect(source)),
    types: types ? (refs) => execute(() => types(refs)) : undefined,
    charsets: charsets ? () => execute(charsets) : undefined,
    query: (sql) => execute(() => options.query(sql)),
    select: (query) => execute(() => options.select(query)),
    cancel: () => options.cancel(() => active && !closed && !failure),
    destroy: () => {
      closed = true
      options.destroy()
    },
    onFailure: (listener) => {
      listeners.add(listener)
      if (failure) listener(failure)
      return () => {
        listeners.delete(listener)
      }
    },
    close,
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

export function createQueryColumns(fields: QueryColumnInput[]): DriverColumn[] {
  return fields.map((column, index) => {
    return {
      ...column,
      id: `${column.name || "column"}_${index}`,
      name: column.name,
    }
  })
}
