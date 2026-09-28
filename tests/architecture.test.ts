import { describe, expect, test } from "bun:test"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { checkArchitecture } from "../scripts/check-architecture"

function check(files: Record<string, string>): string[] {
  const root = mkdtempSync(path.join(tmpdir(), "sqltool-architecture-"))
  try {
    copyFileSync(
      path.resolve("tsconfig.paths.json"),
      path.join(root, "tsconfig.paths.json"),
    )
    for (const [name, source] of Object.entries(files)) {
      const file = path.join(root, "src", name)
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, source)
    }
    return checkArchitecture(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe("architecture boundaries", () => {
  test("application assembly can import contract types directly", () => {
    expect(
      check({
        "main/app/database.ts":
          'import type { Config } from "@/contracts/database"',
        "contracts/database/index.ts": "export interface Config { id: string }",
      }),
    ).toEqual([])
  })

  test("production source obeys the architecture", () => {
    expect(checkArchitecture(process.cwd())).toEqual([])
  })

  test("rejects type-only cross-process imports and private paths", () => {
    const errors = check({
      "renderer/modules/database/index.ts":
        'import type { Secret } from "@/main/database/ports"',
      "main/database/ports.ts": "export type Secret = string",
    })
    expect(errors.some((error) => error.includes("非法跨包依赖"))).toBe(true)
    expect(errors.some((error) => error.includes("跨包访问内部实现"))).toBe(
      true,
    )
  })

  test("checks dynamic imports, re-exports and import types", () => {
    const errors = check({
      "renderer/components/result-grid/index.ts":
        'export * from "@/renderer/modules/workspace"; type X = import("@/renderer/modules/workspace/state").X; import("@/main/database")',
      "renderer/modules/workspace/index.ts": "export {}",
      "renderer/modules/workspace/state.ts": "export type X = string",
      "main/database/index.ts": "export {}",
    })
    expect(errors.some((error) => error.includes("非法跨包依赖"))).toBe(true)
    expect(errors.some((error) => error.includes("跨包访问内部实现"))).toBe(
      true,
    )
  })

  test("detects cycles including type dependencies", () => {
    const errors = check({
      "main/database/a.ts": 'import type { B } from "./b"; export type A = B',
      "main/database/b.ts": 'import type { A } from "./a"; export type B = A',
    })
    expect(errors.some((error) => error.includes("循环依赖"))).toBe(true)
  })

  test("rejects Node in renderer and UI dependencies in modules", () => {
    expect(
      check({
        "renderer/modules/workspace/index.ts":
          'import "node:fs"; import "sonner"',
      }).filter((error) => error.includes("非法外部依赖")),
    ).toHaveLength(2)
  })

  test("allows public UI subentries and internal direct imports", () => {
    expect(
      check({
        "renderer/components/result-grid/index.ts":
          'export { Grid } from "./grid"',
        "renderer/components/result-grid/grid.ts":
          'import "@/renderer/components/ui/button"; export const Grid = 1',
        "renderer/components/ui/button.ts": "export {}",
      }),
    ).toEqual([])
  })

  test("rejects relative cross-package references in every import form", () => {
    const errors = check({
      "main/app/index.ts": [
        'import type { Config } from "../../contracts/database"',
        'export { Config } from "../../contracts/database"',
        'type C = import("../../contracts/database").Config',
        'import("../../contracts/database")',
        'require("../../contracts/database")',
      ].join(";"),
      "contracts/database/index.ts": "export type Config = string",
    })
    expect(
      errors.filter((error) => error.includes("跨包引用必须使用 alias")),
    ).toHaveLength(5)
  })

  test("rejects aliases inside a package and reverse imports of its entry", () => {
    const errors = check({
      "main/database/index.ts": 'export { Configs } from "./configs"',
      "main/database/configs.ts":
        'import "@/main/database"; import "@/main/database/ports"; export class Configs {}',
      "main/database/ports.ts": "export {}",
    })
    expect(
      errors.filter((error) => error.includes("包内引用必须使用相对路径")),
    ).toHaveLength(2)
    expect(errors.some((error) => error.includes("包内反向导入公共入口"))).toBe(
      true,
    )
    expect(errors.some((error) => error.includes("循环依赖"))).toBe(true)
  })

  test("aliases cannot conceal unresolved targets or package cycles", () => {
    const errors = check({
      "contracts/database/index.ts":
        'import type { S } from "@/contracts/system"; export type C = S',
      "contracts/system/index.ts":
        'import type { C } from "@/contracts/database"; import "@/contracts/missing"; export type S = C',
    })
    expect(errors.some((error) => error.includes("无法解析导入"))).toBe(true)
    expect(errors.some((error) => error.includes("循环依赖"))).toBe(true)
  })
})
