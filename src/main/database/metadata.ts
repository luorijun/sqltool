import type { DbSchema, QueryResult, TableSource } from "@/contracts/database"
import { needsMySqlCharset, resolveMySqlType } from "./drivers/mysql-types"
import type {
  ColumnType,
  ConnectionSession,
  DriverResult,
  PostgresTypeRef,
} from "./ports"

type Read = <T>(
  id: string,
  run: (client: ConnectionSession) => Promise<T>,
) => Promise<T>
interface TypeCache {
  values: Map<string, { value: ColumnType; expires: number }>
  pending: Map<string, Promise<ColumnType | null>>
}
interface CharsetCache {
  expires: number
  value: Promise<Map<number, number>>
}
const TYPE_TTL = 5 * 60_000
const TYPE_LIMIT = 2048
const typeKey = (ref: PostgresTypeRef) => `${ref.oid}:${ref.modifier}`

export class Metadata {
  private schemas = new Map<string, DbSchema[]>()
  private errors = new Map<string, string>()
  private generations = new Map<string, number>()
  private epochs = new Map<string, object>()
  private types = new Map<string, TypeCache>()
  private charsets = new Map<string, CharsetCache>()

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
    this.charsets.delete(id)
  }

  inspect(id: string, source?: TableSource, refresh = false): Promise<void> {
    const epoch = this.epoch(id)
    // The metadata session serializes reads. Check and commit inside that lane
    // so the next request sees the completed cache, including an empty schema.
    return this.read(id, async (client) => {
      if (this.epoch(id) !== epoch) return
      const cached = this.schemas.has(id)
      if (cached && !refresh) return
      this.types.delete(id)
      this.charsets.delete(id)
      const target = cached ? source : undefined
      const schemas = await client.inspect(target)
      if (this.epoch(id) !== epoch) return
      if (target) this.setTable(id, target, schemas)
      else this.setSchema(id, schemas)
      this.clearError(id)
    }).catch((error) => {
      if (this.epoch(id) === epoch)
        this.setError(
          id,
          error instanceof Error ? error.message : String(error),
        )
      throw error
    })
  }

  async complete(
    id: string,
    result: DriverResult,
    signal?: AbortSignal,
  ): Promise<QueryResult> {
    const refs = result.columns.flatMap(({ typeRef }) =>
      typeRef ? [typeRef] : [],
    )
    const postgres = refs.filter((ref) => ref.driver === "postgres")
    const needsCharsets = refs.some(
      (ref) => ref.driver === "mysql" && needsMySqlCharset(ref),
    )
    const defaults = result.columns.map(({ typeRef }) =>
      typeRef?.driver === "mysql" ? resolveMySqlType(typeRef) : undefined,
    )
    let types = defaults
    if ((postgres.length || needsCharsets) && !signal?.aborted) {
      const cancelled = Promise.withResolvers<typeof defaults>()
      const abort = () => cancelled.resolve(defaults)
      signal?.addEventListener("abort", abort, { once: true })
      try {
        const resolved = Promise.all([
          postgres.length
            ? this.resolve(id, postgres)
            : new Map<string, ColumnType | null>(),
          needsCharsets ? this.readCharsets(id) : new Map<number, number>(),
        ]).then(([catalog, charsets]) =>
          result.columns.map(({ typeRef }) => {
            if (!typeRef) return undefined
            if (typeRef.driver === "postgres")
              return catalog.get(typeKey(typeRef)) ?? undefined
            return resolveMySqlType(
              typeRef,
              typeRef.charset === undefined
                ? undefined
                : charsets.get(typeRef.charset),
            )
          }),
        )
        types = await Promise.race([resolved, cancelled.promise])
      } finally {
        signal?.removeEventListener("abort", abort)
      }
    }
    return {
      ...result,
      columns: result.columns.map(({ typeRef: _ref, ...column }, index) => ({
        ...column,
        ...types[index],
      })),
    }
  }

  private readCharsets(id: string): Promise<Map<number, number>> {
    const cached = this.charsets.get(id)
    if (cached && cached.expires > this.now()) return cached.value
    const entry: CharsetCache = {
      expires: Infinity,
      value: this.read(id, (client) => {
        if (!client.charsets) throw new Error("驱动不支持字符集元数据查询")
        return client.charsets()
      })
        .then((value) => {
          if (this.charsets.get(id) !== entry) return new Map<number, number>()
          entry.expires = this.now() + TYPE_TTL
          this.clearError(id)
          return value
        })
        .catch((error) => {
          if (this.charsets.get(id) === entry) {
            this.charsets.delete(id)
            this.setError(
              id,
              error instanceof Error ? error.message : String(error),
            )
          }
          return new Map<number, number>()
        }),
    }
    this.charsets.set(id, entry)
    return entry.value
  }

  private async resolve(
    id: string,
    refs: PostgresTypeRef[],
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
