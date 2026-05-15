import type { ConfigProfile } from "../../config"
import type { DbSchema, QueryResult, QueryResultColumn } from ".."
import { connectMySql } from "./mysql"
import { connectPostgres } from "./postgres"

export interface ConnectionSession {
  inspect(): Promise<DbSchema[]>
  query(sql: string): Promise<QueryResult>
  close(): Promise<void>
}

interface CreateConnectionSessionOptions {
  inspect: () => Promise<DbSchema[]>
  query: (sql: string) => Promise<QueryResult>
  close: () => Promise<void>
}

export function connectDriver(
  profile: ConfigProfile,
): Promise<ConnectionSession> {
  switch (profile.driver) {
    case "mysql":
      return connectMySql(profile)
    case "postgres":
      return connectPostgres(profile)
  }
}

export function createConnectionSession(
  options: CreateConnectionSessionOptions,
): ConnectionSession {
  let closePromise: Promise<void> | null = null

  const close = async () => {
    if (closePromise) {
      return closePromise
    }

    closePromise = options.close().catch(() => undefined)

    await closePromise
  }

  return {
    inspect: options.inspect,
    query: options.query,
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

export function createQueryColumns(names: string[]): QueryResultColumn[] {
  return names.map((name, index) => ({
    id: `${name || "column"}_${index}`,
    name,
  }))
}
