import type { DbSchema, TableSource } from "@/contracts/database"

export class Catalog {
  private schemas = new Map<string, DbSchema[]>()
  private errors = new Map<string, string>()
  private generations = new Map<string, number>()

  snapshot(id: string) {
    return {
      schema: this.schemas.get(id) ?? null,
      error: this.errors.get(id) ?? null,
      generation: this.generations.get(id) ?? 0,
    }
  }

  setSchema(id: string, schema: DbSchema[]): void {
    this.schemas.set(id, schema)
    this.clearError(id)
  }

  setTable(id: string, source: TableSource, schemas: DbSchema[]): void {
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
    this.schemas.delete(id)
    this.errors.delete(id)
  }

  disconnected(id: string): void {
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1)
    this.clearError(id)
  }
}
