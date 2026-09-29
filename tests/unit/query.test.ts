import { describe, expect, test } from "bun:test"
import { compileSelectQuery } from "../../src/main/database/query"

describe.each([
  "postgres",
  "mysql",
] as const)("%s query compilation", (driver) => {
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
    expect(compiled.sql).toBe(
      driver === "postgres"
        ? 'SELECT *\nFROM "a""b"."c`d"\nWHERE "name" = $1\nLIMIT $2\nOFFSET $3;'
        : 'SELECT *\nFROM `a"b`.`c``d`\nWHERE `name` = ?\nLIMIT ?\nOFFSET ?;',
    )
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
    expect(compiled.sql).toContain(
      driver === "postgres"
        ? 'WHERE ("deleted" IS NULL AND ("id" IN ($1, $2) OR "name" = $3))'
        : "WHERE (`deleted` IS NULL AND (`id` IN (?, ?) OR `name` = ?))",
    )
  })
})
