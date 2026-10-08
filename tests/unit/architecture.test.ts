import { expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

const root = resolve(import.meta.dirname, "../../src")
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = join(dir, entry.name)
    return entry.isDirectory()
      ? files(name)
      : /\.tsx?$/.test(name)
        ? [name]
        : []
  })
}
const sourceFiles = files(root)
const name = (file: string) => relative(root, file).replaceAll("\\", "/")
const imports = (file: string) => {
  const source = readFileSync(file, "utf8")
  const declarations =
    /^(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*\s*(?:as\s+\w+)?|[\w$]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+["']([^"']+)["']/gm
  const sideEffects = /^import\s+["']([^"']+)["']/gm
  const expressions = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  return [declarations, sideEffects, expressions].flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => match[1]),
  )
}
const resolveImport = (file: string, spec: string) => {
  if (!spec.startsWith("@/") && !spec.startsWith(".")) return null
  if (/\.(css|json)$/.test(spec)) return null
  const base = spec.startsWith("@/")
    ? resolve(root, spec.slice(2))
    : resolve(dirname(file), spec)
  const target = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ].find(
    (candidate) => existsSync(candidate) && sourceFiles.includes(candidate),
  )
  if (!target) throw new Error(`${name(file)} imports missing source: ${spec}`)
  return target
}
const graph = new Map(
  sourceFiles.map((file) => [
    file,
    imports(file).flatMap((spec) => {
      const target = resolveImport(file, spec)
      return target ? [target] : []
    }),
  ]),
)
const moduleName = (file: string) => {
  const parts = name(file).split("/")
  if (parts[0] === "core") return "core"
  if (parts[0] === "preload") return "preload"
  if (parts[0] === "renderer" && ["modules", "components"].includes(parts[1]))
    return parts.slice(0, 3).join("/")
  return parts.slice(0, 2).join("/")
}

test("production dependencies are acyclic, including type imports", () => {
  const done = new Set<string>()
  const active: string[] = []
  const visit = (file: string) => {
    if (done.has(file)) return
    const index = active.indexOf(file)
    if (index !== -1)
      throw new Error(
        "Dependency cycle: " +
          [...active.slice(index), file].map(name).join(" -> "),
      )
    active.push(file)
    for (const target of graph.get(file) ?? []) visit(target)
    active.pop()
    done.add(file)
  }
  for (const file of sourceFiles) visit(file)
  expect(done.size).toBe(sourceFiles.length)
})

test("modules use public entries and preserve process boundaries", () => {
  const allowed: Record<string, string[]> = {
    "main/connections": ["main/sessions", "core"],
    "main/sessions": ["main/metadata", "main/drivers", "core"],
    "main/metadata": ["main/drivers", "core"],
    "main/drivers": ["core"],
    "main/workspace": ["core"],
    "main/system": [],
    "main/updater": [],
    preload: ["core"],
    core: [],
  }
  for (const [file, targets] of graph) {
    const from = moduleName(file)
    for (const target of targets) {
      const to = moduleName(target)
      if (from === to) continue
      const label = `${name(file)} -> ${name(target)}`
      if (allowed[from]) expect(allowed[from], label).toContain(to)
      if (from.startsWith("main/")) {
        expect(to.startsWith("renderer/"), label).toBe(false)
        if (to === "preload") expect(from, label).toBe("main/ipc")
      }
      if (from.startsWith("renderer/"))
        expect(to.startsWith("main/"), label).toBe(false)
      const publicEntry =
        /\/index\.tsx?$/.test(name(target)) ||
        name(target).startsWith("core/") ||
        name(target) === "preload/bridge.ts" ||
        name(target).startsWith("renderer/components/ui/")
      expect(publicEntry, `${label} must use a public entry`).toBe(true)
      const spec = imports(file).find(
        (entry) => resolveImport(file, entry) === target,
      )
      expect(spec?.startsWith("@/"), `${label} must use the source alias`).toBe(
        true,
      )
      if (from.startsWith("renderer/") && to === "preload") {
        const declarations = readFileSync(file, "utf8").matchAll(
          /^import\s+(type\s+)?(?:\{[^}]*\}|\*\s*(?:as\s+\w+)?|[\w$]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+["']@\/preload\/bridge["']/gm,
        )
        for (const declaration of declarations)
          expect(Boolean(declaration[1]), `${label} must be type-only`).toBe(
            true,
          )
      }
    }
    if (
      from === "core" ||
      (from === "preload" && name(file) !== "preload/index.ts")
    ) {
      for (const spec of imports(file))
        expect(
          spec.startsWith("@/core/") || spec.startsWith("."),
          `${name(file)} must stay independent of runtime libraries`,
        ).toBe(true)
    }
  }
})
