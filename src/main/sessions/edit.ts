import { randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import {
  type CellChange,
  ConnError,
  type DbDriver,
  type QueryResult,
  type ResultEdit,
  type SaveResult,
  type TableSource,
} from "@/core/database"
import type {
  ConnectionSession,
  DriverResult,
  TableDefinition,
} from "@/main/drivers"

// Conservative single-table SELECT recognition. Quoted names never become keywords.
export function selectSource(
  sql: string,
  driver: DbDriver,
): TableSource | null {
  if (/\/\*[!+]/.test(sql) || /\$[a-z_]*\$/i.test(sql)) return null
  const tokens: Array<{ text: string; quoted?: boolean }> = []
  const pattern =
    /\s+|--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|\\.|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|[\w$]+|[^\s]/gy
  for (const match of sql.matchAll(pattern)) {
    const text = match[0]
    if (/^\s|^--|^\/\*/.test(text)) continue
    if (text[0] === "'") {
      tokens.push({ text: "literal", quoted: true })
      continue
    }
    const quoted = text[0] === '"' || text[0] === "`"
    tokens.push({
      text: quoted
        ? text.slice(1, -1).replaceAll(text[0] + text[0], text[0])
        : text,
      quoted,
    })
  }
  const keyword = (t: { text: string; quoted?: boolean }, value: string) =>
    !t.quoted && t.text.toUpperCase() === value
  if (!tokens.length || !keyword(tokens[0], "SELECT")) return null
  if (
    tokens.some(
      (t) =>
        !t.quoted &&
        [
          "JOIN",
          "UNION",
          "INTERSECT",
          "EXCEPT",
          "DISTINCT",
          "GROUP",
          "HAVING",
          "OVER",
          "WITH",
          "INTO",
          "$",
        ].includes(t.text.toUpperCase()),
    )
  )
    return null
  if (
    tokens.filter((t) => keyword(t, "SELECT")).length !== 1 ||
    tokens.filter((t) => keyword(t, "FROM")).length !== 1
  )
    return null
  if (tokens.some((t, i) => t.text === ";" && i !== tokens.length - 1))
    return null
  let i = tokens.findIndex((t) => keyword(t, "FROM")) + 1
  const name = () => {
    const token = tokens[i++]
    return token && (token.quoted || /^[a-z_][\w$]*$/i.test(token.text))
      ? token.quoted || driver === "mysql"
        ? token.text
        : token.text.toLowerCase()
      : null
  }
  const first = name()
  if (!first) return null
  let schema = ""
  let table = first
  if (tokens[i]?.text === ".") {
    i++
    schema = first
    const second = name()
    if (!second) return null
    table = second
  }
  const clause = (index: number) =>
    !tokens[index] ||
    (!tokens[index].quoted &&
      ["WHERE", "ORDER", "LIMIT", "OFFSET", "FETCH", "FOR", ";"].includes(
        tokens[index].text.toUpperCase(),
      ))
  if (tokens[i] && keyword(tokens[i], "AS")) {
    i++
    if (!name()) return null
  } else if (!clause(i)) {
    if (!name()) return null
  }
  if (!clause(i)) return null
  return { schema, table }
}

export function quote(driver: DbDriver, name: string): string {
  const mark = driver === "postgres" ? '"' : "`"
  return mark + name.replaceAll(mark, mark + mark) + mark
}
const local = (id: string, reason: string): ResultEdit => ({
  id,
  keys: [],
  writable: [],
  reason,
})
interface Entry {
  sessionId: string
  owner: number
  tabId: string
  driver: DbDriver
  result: DriverResult
  definition: TableDefinition
  edit: ResultEdit
  uncertain: boolean
}
export class Results {
  private entries = new Map<string, Entry>()
  complete(result: QueryResult): QueryResult {
    const entry = result.edit && this.entries.get(result.edit.id)
    if (entry) entry.result.columns = result.columns
    return result
  }
  clear(owner: number, tabId?: string) {
    for (const [id, entry] of this.entries)
      if (entry.owner === owner && (!tabId || entry.tabId === tabId))
        this.entries.delete(id)
  }
  forget(sessionId: string) {
    for (const [id, entry] of this.entries)
      if (entry.sessionId === sessionId) this.entries.delete(id)
  }
  session(id: string, owner: number, tabId: string) {
    const entry = this.entries.get(id)
    if (!entry || entry.owner !== owner || entry.tabId !== tabId)
      throw new Error("结果已失效，请重新查询后提交")
    if (entry.uncertain)
      throw new Error("上次提交结果未知，请刷新并核实数据库状态，不能直接重试")
    return entry.sessionId
  }
  async capture(
    client: ConnectionSession,
    sessionId: string,
    owner: number,
    tabId: string,
    driver: DbDriver,
    sql: string,
    result: DriverResult,
  ) {
    this.clear(owner, tabId)
    if (!result.columns.length) return result
    const id = randomUUID()
    const from = selectSource(sql, driver)
    let edit = local(id, "此结果无法安全写回，仅支持本地修改")
    if (from && client.describe) {
      let savepoint: string | undefined
      try {
        if ((await client.transaction()) === "active") {
          savepoint = `sqltool_meta_${randomUUID().replaceAll("-", "")}`
          await client.query(`SAVEPOINT ${savepoint}`)
        }
        const definition = await client.describe(result.columns, from)
        if (
          definition &&
          definition.source.table === from.table &&
          (!from.schema || definition.source.schema === from.schema)
        ) {
          const keys = definition.columns
            .filter((c) => c.key)
            .map((c) => c.name)
          const mapped = result.columns.filter(
            (c) =>
              c.sourceColumn &&
              c.schema === definition.source.schema &&
              c.table === definition.source.table,
          )
          const complete =
            keys.length > 0 &&
            keys.every(
              (key) =>
                mapped.filter((c) => c.sourceColumn === key).length === 1,
            )
          if (complete) {
            const writable = mapped
              .filter(
                (c) =>
                  !definition.columns.find((f) => f.name === c.sourceColumn)
                    ?.generated &&
                  mapped.filter((f) => f.sourceColumn === c.sourceColumn)
                    .length === 1,
              )
              .map((c) => c.id)
            edit = { id, source: definition.source, keys, writable }
            this.entries.set(id, {
              sessionId,
              owner,
              tabId,
              driver,
              result,
              definition,
              edit,
              uncertain: false,
            })
          } else edit = local(id, "结果未包含完整主键，仅支持本地修改")
        }
        if (savepoint) await client.query(`RELEASE SAVEPOINT ${savepoint}`)
      } catch (error) {
        if (savepoint) {
          try {
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
            await client.query(`RELEASE SAVEPOINT ${savepoint}`)
          } catch {
            this.entries.delete(id)
          }
        }
        this.entries.delete(id)
        edit = local(id, "无法读取写回所需的表结构，仅支持本地修改")
        if (error instanceof ConnError && error.kind === "unknown") throw error
      }
    }
    return { ...result, edit }
  }
  async save(
    client: ConnectionSession,
    id: string,
    owner: number,
    tabId: string,
    changes: CellChange[],
  ): Promise<SaveResult> {
    this.session(id, owner, tabId)
    const entry = this.entries.get(id)
    if (!entry) throw new Error("结果已失效，请重新查询后提交")
    const { driver, result, edit, definition } = entry
    if (!changes.length) throw new Error("没有需要提交的修改")
    const rows = new Map<number, Map<string, unknown>>()
    for (const change of changes) {
      if (
        !Number.isSafeInteger(change.row) ||
        !result.rows[change.row] ||
        !edit.writable.includes(change.column)
      )
        throw new Error("修改包含无法写回的单元格")
      let values = rows.get(change.row)
      if (!values) {
        values = new Map()
        rows.set(change.row, values)
      }
      if (values.has(change.column)) throw new Error("重复的单元格修改")
      values.set(change.column, change.value)
    }
    const state = await client.transaction()
    if (state !== "idle" && state !== "active")
      throw new Error("当前事务状态不允许提交，请先回滚或重建会话")
    const transaction = state === "active"
    const savepoint = `sqltool_edit_${randomUUID().replaceAll("-", "")}`
    const table = [definition.source.schema, definition.source.table]
      .map((s) => quote(driver, s))
      .join(".")
    const columns = result.columns.flatMap((c, index) =>
      c.sourceColumn &&
      c.schema === definition.source.schema &&
      c.table === definition.source.table
        ? [{ ...c, sourceColumn: c.sourceColumn, index }]
        : [],
    )
    const fields = columns.map((c) => quote(driver, c.sourceColumn)).join(", ")
    const param = (params: unknown[], value: unknown) => {
      params.push(value)
      return driver === "postgres" ? `$${params.length}` : "?"
    }
    const encode = (value: unknown, family?: string, input = false) => {
      if (value instanceof ArrayBuffer) return Buffer.from(value)
      if (ArrayBuffer.isView(value))
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      if (
        family === "json" &&
        value !== null &&
        (!input || typeof value !== "string")
      )
        return JSON.stringify(value)
      return value
    }
    const keyWhere = (
      values: unknown[],
      params: unknown[],
      changes?: Map<string, unknown>,
    ) =>
      edit.keys
        .map((key) => {
          const column = columns.find((c) => c.sourceColumn === key)
          if (!column) throw new Error("主键映射已失效，请重新查询")
          const value = values[column.index]
          if (value === null || value === undefined)
            throw new Error("主键为空，无法定位记录")
          return (
            quote(driver, key) +
            " = " +
            param(
              params,
              encode(value, column.typeFamily, changes?.has(column.id)),
            )
          )
        })
        .join(" AND ")
    const updated: SaveResult["rows"] = []
    let finished = false
    await client.query(transaction ? `SAVEPOINT ${savepoint}` : "BEGIN")
    try {
      const current = await client.describe?.(result.columns, definition.source)
      if (!current || !isDeepStrictEqual(current, definition))
        throw new Error("表结构已变化，请刷新后重新编辑")
      for (const [row, values] of [...rows].sort(([a], [b]) => a - b)) {
        const before = result.rows[row]
        const params: unknown[] = []
        const locked = await client.query(
          `SELECT ${fields} FROM ${table} WHERE ${keyWhere(before, params)} FOR UPDATE`,
          params,
        )
        if (locked.rows.length !== 1)
          throw new Error(`第 ${row + 1} 行已删除或无法唯一定位，未提交修改`)
        const lockedRow = locked.rows[0]
        for (const column of columns)
          if (
            values.has(column.id) &&
            !isDeepStrictEqual(
              lockedRow[columns.indexOf(column)],
              before[column.index],
            )
          )
            throw new Error(
              `第 ${row + 1} 行的 ${column.name} 已被修改，请刷新后重试`,
            )
        const next = [...before]
        const updateParams: unknown[] = []
        const assignments = [...values].map(([id, value]) => {
          const column = columns.find((c) => c.id === id)
          if (!column) throw new Error("字段映射已失效，请重新查询")
          next[column.index] = value
          return (
            quote(driver, column.sourceColumn) +
            " = " +
            param(updateParams, encode(value, column.typeFamily, true))
          )
        })
        const updatedRow = await client.query(
          `UPDATE ${table} SET ${assignments.join(", ")} WHERE ${keyWhere(before, updateParams)}`,
          updateParams,
        )
        // MySQL can report zero changed rows after database-side normalization.
        if (
          updatedRow.rowCount !== 1 &&
          !(driver === "mysql" && updatedRow.rowCount === 0)
        )
          throw new Error("更新未唯一命中记录，已撤销本次提交")
        const readParams: unknown[] = []
        const readback = await client.query(
          `SELECT ${fields} FROM ${table} WHERE ${keyWhere(next, readParams, values)}`,
          readParams,
        )
        if (readback.rows.length !== 1)
          throw new Error("无法确认更新后的记录，已撤销本次提交")
        for (const [index, column] of columns.entries())
          next[column.index] = readback.rows[0][index]
        updated.push({ row, values: next })
      }
      await client.query(
        transaction ? `RELEASE SAVEPOINT ${savepoint}` : "COMMIT",
      )
      finished = true
      for (const item of updated) result.rows[item.row] = item.values
      return { rows: updated, transaction }
    } catch (error) {
      if (!finished) {
        try {
          await client.query(
            transaction ? `ROLLBACK TO SAVEPOINT ${savepoint}` : "ROLLBACK",
          )
          if (transaction) await client.query(`RELEASE SAVEPOINT ${savepoint}`)
        } catch {
          entry.uncertain = true
          throw new ConnError(
            "提交结果未知，请核实数据库状态后重新查询",
            "unknown",
          )
        }
      }
      if (error instanceof ConnError && error.kind === "unknown")
        entry.uncertain = true
      throw error
    }
  }
}
