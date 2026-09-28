import { existsSync, readdirSync, readFileSync } from "node:fs"
import { builtinModules } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const normalize = (file: string) => file.replaceAll("\\", "/")
const builtin = new Set(
  builtinModules.map((name) => name.replace(/^node:/, "")),
)

function list(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    return entry.isDirectory() ? list(file) : /\.tsx?$/.test(file) ? [file] : []
  })
}

function packageOf(file: string): string | undefined {
  if (file === "contracts/bridge.ts") return "contracts/bridge"
  if (file.startsWith("preload/")) return "preload"
  if (file.startsWith("renderer/app/")) return "renderer/app"
  return /^(contracts\/[^/]+|main\/[^/]+|renderer\/(?:pages|modules|components)\/[^/]+)\//.exec(
    file,
  )?.[1]
}

function allowed(from: string, to: string): boolean {
  if (from === to) return true
  if (from === "contracts/bridge")
    return ["contracts/database", "contracts/system"].includes(to)
  if (from === "main/app")
    return [
      "main/ipc",
      "main/database",
      "main/system",
      "main/updater",
      "contracts/database",
      "contracts/system",
    ].includes(to)
  if (from === "main/ipc")
    return [
      "main/database",
      "main/system",
      "contracts/database",
      "contracts/system",
    ].includes(to)
  if (from === "main/database") return to === "contracts/database"
  if (from === "main/system") return to === "contracts/system"
  if (from === "preload") return to.startsWith("contracts/")
  // The renderer's ambient bridge declaration is part of application assembly.
  if (from === "renderer/app")
    return /^renderer\/(pages|modules)\//.test(to) || to === "contracts/bridge"
  if (from.startsWith("renderer/pages/"))
    return (
      /^renderer\/(modules|components)\//.test(to) ||
      to.startsWith("contracts/")
    )
  if (from === "renderer/modules/workspace")
    return to === "renderer/modules/database" || to === "contracts/database"
  if (from === "renderer/modules/database") return to === "contracts/database"
  if (from === "renderer/modules/system") return to === "contracts/system"
  if (
    from.startsWith("renderer/components/") &&
    from !== "renderer/components/ui"
  )
    return to === "renderer/components/ui" || to.startsWith("contracts/")
  return false
}

function cycles(graph: Map<string, Set<string>>): string[] {
  const done = new Set<string>()
  const stack: string[] = []
  const errors: string[] = []
  function visit(node: string) {
    const index = stack.indexOf(node)
    if (index !== -1) {
      errors.push(`循环依赖: ${[...stack.slice(index), node].join(" → ")}`)
      return
    }
    if (done.has(node)) return
    stack.push(node)
    for (const next of graph.get(node) ?? []) visit(next)
    stack.pop()
    done.add(node)
  }
  for (const node of graph.keys()) visit(node)
  return errors
}

/** Tests are allowed to inspect internals; production source must obey package boundaries. */
export function checkArchitecture(root: string): string[] {
  const src = path.join(root, "src")
  const errors: string[] = []
  const graph = new Map<string, Set<string>>()
  const packages = new Map<string, Set<string>>()
  const config = ts.readConfigFile(
    path.join(root, "tsconfig.paths.json"),
    ts.sys.readFile,
  )
  if (config.error)
    return [ts.flattenDiagnosticMessageText(config.error.messageText, "\n")]
  const parsed = ts.convertCompilerOptionsFromJson(
    config.config.compilerOptions,
    root,
  )
  if (parsed.errors.length)
    return parsed.errors.map((error) =>
      ts.flattenDiagnosticMessageText(error.messageText, "\n"),
    )
  const options: ts.CompilerOptions = {
    ...parsed.options,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  }
  for (const file of list(src)) {
    const name = normalize(path.relative(src, file))
    const pkg = packageOf(name)
    if (!pkg) {
      errors.push(`未归属包: ${name}`)
      continue
    }
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    )
    const refs: string[] = []
    function visit(node: ts.Node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        refs.push(node.moduleSpecifier.text)
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      )
        refs.push(node.argument.literal.text)
      if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteral(node.moduleReference.expression)
      )
        refs.push(node.moduleReference.expression.text)
      if (
        pkg.startsWith("renderer/modules/") &&
        (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))
      )
        errors.push(`业务模块不能包含 JSX: ${name}`)
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      ) {
        const arg = node.arguments[0]
        if (arg && ts.isStringLiteral(arg)) refs.push(arg.text)
        else errors.push(`不可静态检查的导入: ${name}`)
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        node.expression.getText(source) === "window" &&
        node.name.text === "main" &&
        !["renderer/modules/database", "renderer/modules/system"].includes(pkg)
      )
        errors.push(`桥接只能由客户端模块访问: ${name}`)
      ts.forEachChild(node, visit)
    }
    visit(source)
    const edges = new Set<string>()
    graph.set(name, edges)
    if (!packages.has(pkg)) packages.set(pkg, new Set())
    for (const ref of refs) {
      if (!ref.startsWith(".") && !ref.startsWith("@/")) {
        const nodeOnly =
          ref.startsWith("node:") ||
          builtin.has(ref) ||
          /^(electron|electron-store|electron-updater|pg|mysql2|ssh2|ssh-config)(\/|$)/.test(
            ref,
          )
        if (
          pkg.startsWith("contracts/") ||
          (pkg === "preload" && ref !== "electron") ||
          (pkg.startsWith("renderer/") && nodeOnly) ||
          (pkg === "main/database" && /^electron/.test(ref)) ||
          (pkg.startsWith("renderer/modules/") &&
            /^(react|react-dom|sonner)(\/|$)/.test(ref))
        )
          errors.push(`非法外部依赖: ${name} → ${ref}`)
        continue
      }
      const resolved = ts.resolveModuleName(ref, file, options, ts.sys)
        .resolvedModule?.resolvedFileName
      if (!resolved) {
        if (
          !ref.endsWith(".css") ||
          !existsSync(path.resolve(path.dirname(file), ref))
        )
          errors.push(`无法解析导入: ${name} → ${ref}`)
        continue
      }
      const target = normalize(path.relative(src, resolved))
      const targetPkg = packageOf(target)
      if (!targetPkg) {
        errors.push(`导入包外文件: ${name} → ${target}`)
        continue
      }
      edges.add(target)
      if (!allowed(pkg, targetPkg))
        errors.push(`非法跨包依赖: ${name} → ${target}`)
      if (pkg === targetPkg) {
        if (!ref.startsWith("."))
          errors.push(`包内引用必须使用相对路径: ${name} → ${ref}`)
        if (target === `${pkg}/index.ts` || target === `${pkg}/index.tsx`)
          errors.push(`包内反向导入公共入口: ${name} → ${target}`)
      } else {
        if (!ref.startsWith("@/"))
          errors.push(`跨包引用必须使用 alias: ${name} → ${ref}`)
        packages.get(pkg)?.add(targetPkg)
        if (
          targetPkg !== "contracts/bridge" &&
          targetPkg !== "renderer/components/ui" &&
          target !== `${targetPkg}/index.ts` &&
          target !== `${targetPkg}/index.tsx`
        )
          errors.push(`跨包访问内部实现: ${name} → ${target}`)
      }
    }
  }
  return [...errors, ...cycles(graph), ...cycles(packages)]
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const errors = checkArchitecture(process.cwd())
  if (errors.length) {
    console.error(errors.join("\n"))
    process.exitCode = 1
  } else
    console.log(
      "架构检查通过：进程隔离、公共入口、alias、依赖方向及类型/运行时循环。",
    )
}
