import { describe, expect, test } from "bun:test"
import {
  needsMySqlCharset,
  resolveMySqlType,
} from "../../src/main/database/drivers/mysql-types"
import type { MySqlTypeRef } from "../../src/main/database/ports"

const field = (input: Partial<MySqlTypeRef>): MySqlTypeRef => ({
  driver: "mysql",
  code: 253,
  charset: 224,
  length: 80,
  decimals: 0,
  flags: 0,
  ...input,
})

describe("MySQL result types", () => {
  test("binary collations do not turn text into binary data", () => {
    expect(resolveMySqlType(field({ flags: 128 }), 4)).toEqual({
      dbType: "varchar(20)",
      typeFamily: "string",
    })
    expect(
      resolveMySqlType(field({ flags: 128, charset: 63, length: 20 })),
    ).toEqual({ dbType: "varbinary(20)", typeFamily: "binary" })
    expect(
      resolveMySqlType(field({ code: 254, charset: 63, length: 20 })),
    ).toEqual({ dbType: "binary(20)", typeFamily: "binary" })
  })

  test("enum and set flags take precedence over string codes and lengths", () => {
    for (const [flags, name] of [
      [256, "enum"],
      [2048, "set"],
    ] as const) {
      const ref = field({ code: 254, flags: flags | 128 })
      expect(resolveMySqlType(ref)).toEqual({
        dbType: name,
        typeFamily: "string",
      })
      expect(needsMySqlCharset(ref)).toBe(false)
    }
  })

  test.each([
    [{ code: 246, length: 10, decimals: 2 }, "decimal(8,2)"],
    [{ code: 246, flags: 32, length: 9, decimals: 2 }, "decimal(8,2) unsigned"],
    [{ code: 246, length: 9, decimals: 0 }, "decimal(8,0)"],
    [{ code: 246, length: 3, decimals: 2 }, "decimal"],
    [{ code: 246, length: 10, decimals: 31 }, "decimal"],
    [{ code: 12, decimals: 3 }, "datetime(3)"],
    [{ code: 7, decimals: 6 }, "timestamp(6)"],
    [{ code: 11, decimals: 0 }, "time"],
    [{ code: 11, decimals: 31 }, "time"],
    [{ code: 16, length: 7, flags: 32 }, "bit(7)"],
    [{ code: 1, length: 1 }, "tinyint"],
    [{ code: 3, flags: 32 }, "int unsigned"],
    [{ code: 5, decimals: 31 }, "double"],
  ] as const)("uses protocol modifiers for %j", (input, expected) => {
    expect(resolveMySqlType(field(input)).dbType).toBe(expected)
  })

  test.each([
    [255, "tiny"],
    [65535, ""],
    [16777215, "medium"],
    [4294967295, "long"],
  ] as const)("distinguishes blob/text capacity %i", (size, prefix) => {
    expect(
      resolveMySqlType(field({ code: 252, length: size, charset: 63 })).dbType,
    ).toBe(`${prefix}blob`)
    expect(
      resolveMySqlType(
        field({ code: 252, length: Math.min(size * 4, 0xffffffff) }),
        4,
      ).dbType,
    ).toBe(`${prefix}text`)
  })

  test("unknown metadata never produces guessed names or character lengths", () => {
    expect(resolveMySqlType(field({ code: 999 }))).toEqual({
      typeFamily: "unknown",
    })
    expect(resolveMySqlType(field({ code: undefined }))).toEqual({
      typeFamily: "unknown",
    })
    expect(resolveMySqlType(field({})).dbType).toBe("varchar")
    expect(resolveMySqlType(field({ length: 79 }), 4).dbType).toBe("varchar")
    expect(resolveMySqlType(field({ length: 0 }), 4).dbType).toBe("varchar(0)")
  })

  test("MariaDB extended metadata supplies the actual type without source-column lookup", () => {
    expect(resolveMySqlType(field({ extendedType: "uuid" }))).toEqual({
      dbType: "uuid",
      typeFamily: "uuid",
    })
    expect(resolveMySqlType(field({ extendedType: "inet6" }))).toEqual({
      dbType: "inet6",
      typeFamily: "string",
    })
    expect(resolveMySqlType(field({ extendedFormat: "json" }))).toEqual({
      dbType: "json",
      typeFamily: "json",
    })
    expect(resolveMySqlType(field({ extendedType: "point" }))).toEqual({
      dbType: "point",
      typeFamily: "unknown",
    })
    expect(needsMySqlCharset(field({ extendedType: "uuid" }))).toBe(false)
  })
})
