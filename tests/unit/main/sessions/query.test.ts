import { describe, expect, test } from "bun:test"
import { compileSelectQuery } from "@/main/sessions/query"

describe.each(["postgres", "mysql"] as const)(
  "%s query compilation",
  (driver) => {
    test("quotes identifiers and binds values and paging instead of interpolating them", () => {
      const compiled = compileSelectQuery(driver, {
        from: { schema: 'a"b', table: "c`d" },
        where: {
          column: "name",
          operator: "eq",
          value: "'; DROP TABLE items; --",
        },
        limit: 10,
        offset: 20,
      })
      expect(compiled.params).toEqual(["'; DROP TABLE items; --", 10, 20])
      const sql = compiled.sql.replace(/\s+/g, " ").replace(/;\s*$/, "").trim()
      expect(sql).toBe(
        driver === "postgres"
          ? 'SELECT * FROM "a""b"."c`d" WHERE "name" = $1 LIMIT $2 OFFSET $3'
          : 'SELECT * FROM `a"b`.`c``d` WHERE `name` = ? LIMIT ? OFFSET ?',
      )
    })

    test("multi-column sorting preserves priority and direction in each dialect", () => {
      const compiled = compileSelectQuery(driver, {
        from: { schema: "public", table: "items" },
        orderBy: [
          { column: "b", direction: "desc" },
          { column: "a", direction: "asc" },
        ],
        limit: 50,
        offset: 125,
      })
      expect(compiled.sql.replace(/\s+/g, " ")).toContain(
        driver === "postgres"
          ? 'ORDER BY "b" DESC, "a" ASC'
          : "ORDER BY `b` DESC, `a` ASC",
      )
      expect(compiled.params).toEqual([50, 125])
    })
    test("nested conditions preserve grouping and NULL does not consume a parameter", () => {
      const compiled = compileSelectQuery(driver, {
        from: { schema: "public", table: "items" },
        where: {
          operator: "and",
          conditions: [
            { column: "deleted", operator: "eq", value: null },
            {
              operator: "or",
              conditions: [
                { column: "id", operator: "in", value: [1, 2] },
                { column: "name", operator: "eq", value: "x" },
              ],
            },
          ],
        },
      })
      expect(compiled.params).toEqual([1, 2, "x"])
      expect(compiled.sql.replace(/\s+/g, " ")).toContain(
        driver === "postgres"
          ? 'WHERE ("deleted" IS NULL AND ("id" IN ($1, $2) OR "name" = $3))'
          : "WHERE (`deleted` IS NULL AND (`id` IN (?, ?) OR `name` = ?))",
      )
    })
  },
)
