import type { DbSchema, QueryResult, TableSource } from "@/contracts/database"
import type {
  ColumnType,
  ConnectionSession,
  DriverResult,
  TypeRef,
} from "./ports"

type Read = <T>(
  id: string,
  run: (client: ConnectionSession) => Promise<T>,
) => Promise<T>
interface TypeCache {
  values: Map<string, { value: ColumnType; expires: number }>
  pending: Map<string, Promise<ColumnType | null>>
}
const TYPE_TTL = 5 * 60_000
const TYPE_LIMIT = 2048
const typeKey = (ref: TypeRef) => `${ref.oid}:${ref.modifier}`

export class Metadata {
  private schemas = new Map<string, DbSchema[]>()
  private errors = new Map<string, string>()
  private generations = new Map<string, number>()
  private epochs = new Map<string, object>()
  private types = new Map<string, TypeCache>()
  private inspections = new Map<string, Map<string, Promise<void>>>()

  constructor(
    private read: Read,
    private now = Date.now,
  ) {}

  private epoch(id: string): object {
    let epoch = this.epochs.get(id)
    if (!epoch) {
      epoch = {}
      this.epochs.set(id, epoch)
    }
    return epoch
  }

  invalidate(id: string): void {
    this.epochs.set(id, {})
    this.types.delete(id)
    this.inspections.delete(id)
  }

  inspect(id: string, source?: TableSource): Promise<void> {
    let pending = this.inspections.get(id)
    if (!pending) {
      pending = new Map()
      this.inspections.set(id, pending)
    }
    const key = JSON.stringify(source ?? null)
    const existing = pending.get(key)
    if (existing) return existing
    const epoch = this.epoch(id)
    this.types.delete(id)
    const request = this.read(id, (client) => client.inspect(source))
      .then((schemas) => {
        if (this.epoch(id) !== epoch) return
        if (source) this.setTable(id, source, schemas)
        else this.setSchema(id, schemas)
        this.clearError(id)
      })
      .catch((error) => {
        if (this.epoch(id) === epoch)
          this.setError(
            id,
            error instanceof Error ? error.message : String(error),
          )
        throw error
      })
      .finally(() => {
        if (pending.get(key) === request) pending.delete(key)
      })
    pending.set(key, request)
    return request
  }

  async complete(
    id: string,
    result: DriverResult,
    signal?: AbortSignal,
  ): Promise<QueryResult> {
    const refs = result.columns.flatMap((column) =>
      column.typeRef ? [column.typeRef] : [],
    )
    let types = new Map<string, ColumnType | null>()
    if (refs.length && !signal?.aborted) {
      const cancelled = Promise.withResolvers<Map<string, ColumnType | null>>()
      const abort = () => cancelled.resolve(new Map())
      signal?.addEventListener("abort", abort, { once: true })
      try {
        types = await Promise.race([this.resolve(id, refs), cancelled.promise])
      } finally {
        signal?.removeEventListener("abort", abort)
      }
    }
    return {
      ...result,
      columns: result.columns.map(({ typeRef, ...column }) => ({
        ...column,
        ...(typeRef ? types.get(typeKey(typeRef)) : undefined),
      })),
    }
  }

  private async resolve(
    id: string,
    refs: TypeRef[],
  ): Promise<Map<string, ColumnType | null>> {
    let cache = this.types.get(id)
    if (!cache) {
      cache = { values: new Map(), pending: new Map() }
      this.types.set(id, cache)
    }
    const current = cache
    const unique = new Map(refs.map((ref) => [typeKey(ref), ref]))
    const missing = [...unique].filter(([key]) => {
      const hit = current.values.get(key)
      if (hit && hit.expires > this.now()) return false
      current.values.delete(key)
      return !current.pending.has(key)
    })
    if (missing.length) {
      const batch = this.read(id, (client) => {
        if (!client.types) throw new Error("驱动不支持类型元数据查询")
        return client.types(missing.map(([, ref]) => ref))
      })
        .then((values) => {
          if (this.types.get(id) !== current) return []
          this.clearError(id)
          for (const [index, [key]] of missing.entries()) {
            const value = values[index]
            if (value)
              current.values.set(key, { value, expires: this.now() + TYPE_TTL })
          }
          while (current.values.size > TYPE_LIMIT) {
            const oldest = current.values.keys().next().value
            if (oldest !== undefined) current.values.delete(oldest)
          }
          return values
        })
        .catch((error) => {
          if (this.types.get(id) === current)
            this.setError(
              id,
              error instanceof Error ? error.message : String(error),
            )
          return []
        })
      missing.forEach(([key], index) => {
        const request = batch
          .then((values) => values[index] ?? null)
          .finally(() => current.pending.delete(key))
        current.pending.set(key, request)
      })
    }
    const values = await Promise.all(
      [...unique.keys()].map(
        async (key) =>
          [
            key,
            current.values.get(key)?.value ??
              (await current.pending.get(key)) ??
              null,
          ] as const,
      ),
    )
    return this.types.get(id) === current ? new Map(values) : new Map()
  }

  snapshot(id: string) {
    return {
      schema: this.schemas.get(id) ?? null,
      error: this.errors.get(id) ?? null,
      generation: this.generations.get(id) ?? 0,
    }
  }

  private setSchema(id: string, schema: DbSchema[]): void {
    this.schemas.set(id, schema)
    this.clearError(id)
  }

  private setTable(id: string, source: TableSource, schemas: DbSchema[]): void {
    const table = schemas
      .find((schema) => schema.name === source.schema)
      ?.tables.find((table) => table.name === source.table)
    const current = this.schemas.get(id)
    if (!current) return
    this.schemas.set(
      id,
      current.map((schema) => {
        if (schema.name !== source.schema) return schema
        const tables = schema.tables.flatMap((item) =>
          item.name === source.table ? (table ? [table] : []) : [item],
        )
        if (table && !schema.tables.some((item) => item.name === source.table))
          tables.push(table)
        return { ...schema, tables }
      }),
    )
  }

  setError(id: string, message: string): void {
    this.errors.set(id, message)
  }
  clearError(id: string): void {
    this.errors.delete(id)
  }

  forget(id: string): void {
    this.invalidate(id)
    this.schemas.delete(id)
    this.errors.delete(id)
  }

  disconnected(id: string): void {
    this.invalidate(id)
    this.schemas.delete(id)
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1)
    this.clearError(id)
  }
}
