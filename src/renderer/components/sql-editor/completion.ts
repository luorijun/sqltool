import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete"
import {
  keywordCompletionSource,
  MySQL,
  PostgreSQL,
  StandardSQL,
} from "@codemirror/lang-sql"
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language"
import type { EditorState, Extension } from "@codemirror/state"
import type { SyntaxNode } from "@lezer/common"
import type { DbColumn, DbDriver, DbSchema } from "@/contracts/database"

interface Name {
  text: string
  quoted: boolean
}

interface Relation {
  schema: string
  name: string
  columns: readonly DbColumn[]
  kind: "表" | "视图"
}

interface Reference {
  path: Name[]
  alias?: Name
  relation?: Relation
}

function children(node: SyntaxNode): SyntaxNode[] {
  const nodes: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (!/Comment$/.test(child.name)) nodes.push(child)
  }
  return nodes
}

function nameOf(state: EditorState, node: SyntaxNode): Name {
  const text = state.sliceDoc(node.from, node.to)
  const quoted = node.name === "QuotedIdentifier"
  const quote = text[0]
  return {
    text: quoted
      ? text
          .slice(1, text.endsWith(quote) ? -1 : undefined)
          .replaceAll(quote + quote, quote)
      : text,
    quoted,
  }
}

function pathOf(state: EditorState, node: SyntaxNode): Name[] {
  if (node.name === "CompositeIdentifier") {
    return children(node)
      .filter((child) => /Identifier$/.test(child.name))
      .map((child) => nameOf(state, child))
  }
  return /Identifier$/.test(node.name) ? [nameOf(state, node)] : []
}

const clauses = new Set([
  "select",
  "from",
  "join",
  "on",
  "where",
  "group",
  "order",
  "having",
  "limit",
  "offset",
  "returning",
  "set",
  "values",
  "update",
  "into",
])
const expressions = new Set([
  "select",
  "on",
  "where",
  "group",
  "order",
  "having",
  "returning",
  "set",
])
const unions = new Set(["union", "except", "intersect"])

function createCompletion(
  driver?: DbDriver,
  schemas: readonly DbSchema[] = [],
): CompletionSource {
  const dialect =
    driver === "mysql"
      ? MySQL
      : driver === "postgres"
        ? PostgreSQL
        : StandardSQL
  const keywords = keywordCompletionSource(dialect, true)
  const reserved = new Set((dialect.spec.keywords ?? "").split(/\s+/))
  const quote = driver === "mysql" ? "`" : '"'
  const identifier = (name: string, force = false) =>
    !force && /^[a-z_][a-z0-9_$]*$/.test(name) && !reserved.has(name)
      ? name
      : quote + name.replaceAll(quote, quote + quote) + quote
  const relations: Relation[] = schemas.flatMap((schema) => [
    ...schema.tables.map((table) => ({
      ...table,
      schema: schema.name,
      kind: "表" as const,
    })),
    ...schema.views.map((view) => ({
      ...view,
      schema: schema.name,
      columns: [],
      kind: "视图" as const,
    })),
  ])
  const matches = (name: Name, value: string) =>
    name.quoted || driver !== "mysql"
      ? (name.quoted ? name.text : name.text.toLowerCase()) === value
      : name.text.toLowerCase() === value.toLowerCase()
  const spelling = (name: Name) =>
    name.quoted || driver === "mysql" ? name.text : name.text.toLowerCase()
  const resolve = (path: Name[]) => {
    if (!path.length || path.length > 2) return undefined
    const found = relations.filter(
      (relation) =>
        matches(path[path.length - 1], relation.name) &&
        (path.length === 1 || matches(path[0], relation.schema)),
    )
    // Without the query session's search_path, a duplicate name is ambiguous.
    return found.length === 1 ? found[0] : undefined
  }

  function complete(context: CompletionContext): CompletionResult | null {
    const { state, pos } = context
    if (state.readOnly) return null
    const tree =
      ensureSyntaxTree(state, state.doc.length, 25) ?? syntaxTree(state)
    const at = tree.resolveInner(pos, -1)
    if (/^(String|.*Comment|DollarQuotedString)$/.test(at.name)) return null

    const word = context.matchBefore(/[\p{L}\p{N}_$]*$/u)
    const quoted = at.name === "QuotedIdentifier"
    const from = quoted ? at.from : (word?.from ?? pos)
    const to = /^(Identifier|QuotedIdentifier|Keyword)$/.test(at.name)
      ? at.to
      : pos
    let composite: SyntaxNode | null = at
    while (composite && composite.name !== "CompositeIdentifier")
      composite = composite.parent
    const parents = composite
      ? children(composite)
          .filter((node) => /Identifier$/.test(node.name) && node.to < from)
          .map((node) => nameOf(state, node))
      : []

    let scope: SyntaxNode | null = at
    while (scope && scope.name !== "Statement") {
      if (
        scope.name === "Parens" &&
        children(scope).some(
          (node) =>
            node.name === "Keyword" &&
            state.sliceDoc(node.from, node.to).toLowerCase() === "select",
        )
      )
        break
      scope = scope.parent
    }
    // Whitespace at the end of a statement may resolve to the script node.
    if (!scope) {
      const previous = tree.topNode.childBefore(pos)
      if (
        previous?.name === "Statement" &&
        !state.sliceDoc(previous.from, pos).trimEnd().endsWith(";")
      )
        scope = previous
    }
    const keyword = (node: SyntaxNode) =>
      node.name === "Keyword"
        ? state.sliceDoc(node.from, node.to).toLowerCase()
        : ""
    // CTE output columns are not inferred yet. Do not resolve a CTE with the
    // same name as a physical table to that table's unrelated columns.
    const ctes: Name[] = []
    let statement = scope
    while (statement && statement.name !== "Statement")
      statement = statement.parent
    const outer = statement ? children(statement) : []
    if (outer[0] && keyword(outer[0]) === "with") {
      for (let index = 1; index < outer.length; index++) {
        if (keyword(outer[index]) === "select") break
        if (!/Identifier$/.test(outer[index].name)) continue
        let next = index + 1
        if (outer[next]?.name === "Parens") next++
        if (outer[next] && keyword(outer[next]) === "as")
          ctes.push(nameOf(state, outer[index]))
      }
    }
    let nodes = scope ? children(scope) : []
    // Each side of UNION has its own table aliases and columns.
    for (let index = nodes.length - 1; index >= 0; index--) {
      if (!unions.has(keyword(nodes[index]))) continue
      if (nodes[index].to <= pos) {
        nodes = nodes.slice(index + 1)
        break
      }
      nodes = nodes.slice(0, index)
    }
    if (nodes.some((node) => node.name === ";" && node.to <= pos)) nodes = []

    const refs: Reference[] = []
    let clause = ""
    let expectTable = false
    let tablePosition = false
    let inFrom = false
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index]
      const kw = keyword(node)
      const wasTable = expectTable
      if (node.from < from && clauses.has(kw)) clause = kw
      if (["from", "join", "update", "into"].includes(kw)) {
        expectTable = true
        inFrom = true
      } else if (clauses.has(kw)) {
        expectTable = false
        inFrom = false
      } else if (
        node.name === "Punctuation" &&
        state.sliceDoc(node.from, node.to) === "," &&
        inFrom
      ) {
        expectTable = true
      } else if (expectTable) {
        const path = pathOf(state, node)
        if (path.length || node.name === "Parens") {
          let next = nodes[index + 1]
          if (next && keyword(next) === "as") next = nodes[index + 2]
          const alias =
            next && /^(Identifier|QuotedIdentifier)$/.test(next.name)
              ? nameOf(state, next)
              : undefined
          const shadowed =
            path.length === 1 &&
            ctes.some((name) => matches(path[0], spelling(name)))
          refs.push({
            path,
            alias,
            relation: shadowed ? undefined : resolve(path),
          })
          expectTable = false
        }
      }
      if (
        node.from <= from &&
        node.to >= pos &&
        (pathOf(state, node).length || node.name === "CompositeIdentifier")
      ) {
        // The partially typed relation occupies the slot following FROM/JOIN.
        tablePosition = wasTable
      } else if (node.to <= from) tablePosition = expectTable
    }

    const options: Completion[] = []
    const finish = (): CompletionResult | null =>
      options.length
        ? {
            from,
            to,
            options: quoted
              ? options.map((option) => ({
                  ...option,
                  // CodeMirror filters against the replacement range, including its
                  // opening quote. Keep that spelling in the match label as well.
                  label: identifier(option.label, true),
                  displayLabel: option.label,
                }))
              : options,
          }
        : null
    const addColumns = (relation: Relation, prefix?: string) => {
      for (const column of relation.columns)
        options.push({
          label: column.name,
          type: "property",
          detail: `${column.type} · ${relation.schema}.${relation.name}`,
          info: `${relation.schema}.${relation.name}.${column.name}${column.pk ? " · 主键" : ""}${column.fk ? " · 外键" : ""}`,
          apply: (prefix ? `${prefix}.` : "") + identifier(column.name, quoted),
          boost: 2,
        })
    }
    const addRelations = (schema?: string) => {
      for (const relation of relations) {
        if (schema && relation.schema !== schema) continue
        options.push({
          label: relation.name,
          type: "class",
          detail: `${relation.schema} · ${relation.kind}`,
          apply:
            (schema || driver === "mysql"
              ? ""
              : `${identifier(relation.schema)}.`) +
            identifier(relation.name, quoted),
          boost: 1,
        })
      }
    }

    if (parents.length) {
      const ref =
        !tablePosition && parents.length === 1
          ? refs.find((ref) =>
              ref.alias
                ? matches(parents[0], spelling(ref.alias))
                : ref.path.length &&
                  matches(parents[0], spelling(ref.path[ref.path.length - 1])),
            )
          : undefined
      const relation = ref ? ref.relation : resolve(parents)
      if (!tablePosition && relation) addColumns(relation)
      else if (!ref && parents.length === 1) {
        const schema = schemas.find((schema) =>
          matches(parents[0], schema.name),
        )
        if (schema) addRelations(schema.name)
      }
      return finish()
    }

    if (
      !context.explicit &&
      from === pos &&
      !tablePosition &&
      !expressions.has(clause)
    )
      return null
    if (tablePosition || (!clause && context.explicit)) {
      addRelations()
      for (const schema of schemas)
        options.push({
          label: schema.name,
          type: "namespace",
          detail: "Schema",
          apply: identifier(schema.name, quoted),
        })
    } else if (expressions.has(clause)) {
      for (const ref of refs) {
        if (ref.relation) {
          const prefix =
            refs.length > 1
              ? ref.alias
                ? identifier(spelling(ref.alias))
                : ref.path.map((name) => identifier(spelling(name))).join(".")
              : undefined
          addColumns(ref.relation, prefix)
        }
        if (ref.alias)
          options.push({
            label: spelling(ref.alias),
            type: "variable",
            detail: "表别名",
            apply: identifier(spelling(ref.alias), quoted),
          })
      }
    }
    if (!tablePosition && !quoted) {
      const result = keywords(context)
      if (result && "options" in result)
        options.push(
          ...result.options.map((option) => ({ ...option, boost: -2 })),
        )
    }
    return finish()
  }

  return complete
}

export function createSqlLanguage(
  driver?: DbDriver,
  schema?: readonly DbSchema[],
  loadSchema?: () => Promise<readonly DbSchema[]>,
): Extension {
  const dialect =
    driver === "mysql"
      ? MySQL
      : driver === "postgres"
        ? PostgreSQL
        : StandardSQL
  const complete = createCompletion(driver, schema)
  const source: CompletionSource = (context) => {
    const fallback = complete(context)
    if (schema !== undefined || !loadSchema || context.state.readOnly)
      return fallback
    const node = syntaxTree(context.state).resolveInner(context.pos, -1)
    if (/^(String|.*Comment|DollarQuotedString)$/.test(node.name))
      return fallback
    // Structure requests share the database queue; abandoning this completion
    // only discards its suggestions, not the shared metadata load.
    context.addEventListener("abort", () => {}, { onDocChange: true })
    return loadSchema()
      .then((schema) =>
        context.aborted ? null : createCompletion(driver, schema)(context),
      )
      .catch(() => fallback)
  }
  return [dialect.extension, dialect.language.data.of({ autocomplete: source })]
}
