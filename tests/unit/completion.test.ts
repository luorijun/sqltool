import { describe, expect, mock, test } from "bun:test"
import {
  CompletionContext,
  type CompletionSource,
} from "@codemirror/autocomplete"
import { Compartment, EditorState } from "@codemirror/state"
import type { DbDriver, DbSchema } from "../../src/contracts/database"
import { createSqlLanguage } from "../../src/renderer/components/sql-editor/completion"

const schemas: DbSchema[] = [
  {
    name: "app",
    tables: [
      {
        name: "users",
        columns: [
          { name: "user_id", type: "integer", pk: true },
          { name: "email", type: "text" },
          { name: "Full Name", type: "text" },
          { name: 'a"b', type: "text" },
          { name: "select", type: "text" },
        ],
      },
      {
        name: "orders",
        columns: [
          { name: "order_id", type: "integer" },
          { name: "user_id", type: "integer", fk: true },
        ],
      },
    ],
    views: [{ name: "active_users" }],
    functions: [],
  },
]

async function complete(
  text: string,
  driver: DbDriver | undefined = "postgres",
  catalog = schemas,
  explicit = true,
) {
  const pos = text.indexOf("|")
  const state = EditorState.create({
    doc: text.replace("|", ""),
    extensions: [createSqlLanguage(driver, catalog)],
  })
  const [source] = state.languageDataAt<CompletionSource>("autocomplete", pos)
  return source(new CompletionContext(state, pos, explicit))
}

async function columns(text: string) {
  return (
    (await complete(text))?.options.filter(
      (option) => option.type === "property",
    ) ?? []
  )
}

describe("SQL completion", () => {
  test.each([
    "SELECT * FROM |",
    "SELECT * FROM us|",
    "SELECT * FROM app.|",
    "SELECT * FROM app.us|",
    "SELECT * FROM users JOIN |",
    "SELECT * FROM users, |",
  ])("offers relations at %s", async (sql) => {
    const result = await complete(sql)
    expect(result?.options.map((option) => option.label)).toContain("users")
    expect(result?.options.map((option) => option.label)).toContain(
      "active_users",
    )
    expect(
      result?.options.some(
        (option) => option.type === "property" || option.type === "keyword",
      ),
    ).toBe(false)
  })

  test("qualifies PostgreSQL tables and avoids duplicating a typed schema", async () => {
    expect(
      (await complete("SELECT * FROM |"))?.options.find(
        (option) => option.label === "users",
      )?.apply,
    ).toBe("app.users")
    expect(
      (await complete("SELECT * FROM app.|"))?.options.find(
        (option) => option.label === "users",
      )?.apply,
    ).toBe("users")
    expect(
      (await complete("SELECT * FROM |", "mysql"))?.options.find(
        (option) => option.label === "users",
      )?.apply,
    ).toBe("users")
  })

  test.each([
    "SELECT u.| FROM app.users AS u",
    "SELECT u.em| FROM users u",
    "SELECT USERS.| FROM users",
    "SELECT U.| FROM users U",
    "SELECT * FROM users u JOIN orders o ON u.|",
    "SELECT (coalesce(u.|, '')) FROM users u",
  ])("resolves fields at %s", async (sql) => {
    const options = await columns(sql)
    expect(options.map((option) => option.label)).toContain("email")
    expect(options.map((option) => option.label)).not.toContain("order_id")
    expect(options.find((option) => option.label === "user_id")).toMatchObject({
      detail: "integer · app.users",
      info: "app.users.user_id · 主键",
    })
  })

  test.each([
    "SELECT | FROM users",
    "SELECT * FROM users WHERE |",
    "SELECT * FROM users ORDER BY |",
  ])("suggests unqualified fields at %s", async (sql) => {
    expect((await columns(sql)).map((option) => option.label)).toContain(
      "email",
    )
  })

  test("qualifies columns from multiple relations and preserves quoted aliases", async () => {
    const options = await columns(
      'SELECT | FROM users "U" JOIN orders o ON "U".user_id=o.user_id',
    )
    expect(
      options
        .filter((option) => option.label === "user_id")
        .map((option) => option.apply),
    ).toEqual(['"U".user_id', "o.user_id"])
    expect(
      (await columns('SELECT "U".| FROM users "U"')).map(
        (option) => option.label,
      ),
    ).toContain("email")
    expect(await columns('SELECT u.| FROM users "U"')).toEqual([])
  })

  test("quotes special and reserved names and replaces an entire quoted token", async () => {
    const result = await complete('SELECT "Fu|" FROM users')
    const option = result?.options.find(
      (option) => option.displayLabel === "Full Name",
    )
    expect(option?.apply).toBe('"Full Name"')
    expect(option?.label).toBe('"Full Name"')
    expect(result).toMatchObject({ from: 7, to: 11 })
    expect(
      (await columns("SELECT | FROM users")).find(
        (option) => option.label === 'a"b',
      )?.apply,
    ).toBe('"a""b"')
    expect(
      (await columns("SELECT | FROM users")).find(
        (option) => option.label === "select",
      )?.apply,
    ).toBe('"select"')
    expect(
      (await complete("SELECT u.| FROM users u", "mysql"))?.options.find(
        (option) => option.label === "Full Name",
      )?.apply,
    ).toBe("`Full Name`")
  })

  test.each([
    "SELECT 'users|",
    "SELECT 1 -- users|",
    "SELECT /* users| */ 1",
    "SELECT $$users|$$",
  ])("suppresses completions in literals and comments: %s", async (sql) => {
    expect(await complete(sql)).toBeNull()
  })

  test("isolates statements, UNION branches and nested query scopes", async () => {
    expect(
      await columns("SELECT * FROM users; SELECT | FROM orders"),
    ).toHaveLength(2)
    expect(
      (await columns("SELECT | FROM orders UNION SELECT * FROM users")).map(
        (option) => option.label,
      ),
    ).not.toContain("email")
    expect(
      (await columns("SELECT * FROM users UNION SELECT | FROM orders")).map(
        (option) => option.label,
      ),
    ).not.toContain("email")
    expect(
      (
        await columns(
          "SELECT * FROM users u WHERE EXISTS (SELECT | FROM orders o)",
        )
      ).map((option) => option.label),
    ).not.toContain("email")
    expect(await columns("SELECT x.| FROM (SELECT * FROM users) x")).toEqual([])
    expect(
      await columns(
        "WITH users AS (SELECT order_id FROM orders) SELECT u.| FROM users u",
      ),
    ).toEqual([])
  })

  test("does not guess which schema an ambiguous unqualified table belongs to", async () => {
    const catalog = [...schemas, { ...schemas[0], name: "other" }]
    expect(
      (await complete("SELECT u.| FROM users u", "postgres", catalog))
        ?.options ?? [],
    ).toEqual([])
    expect(
      (
        await complete("SELECT u.| FROM app.users u", "postgres", catalog)
      )?.options.map((option) => option.label),
    ).toContain("email")
  })

  test("offers standard SQL without a connection and respects read-only mode", async () => {
    const editable = EditorState.create({
      doc: "SEL",
      extensions: [createSqlLanguage()],
    })
    const [standard] = editable.languageDataAt<CompletionSource>(
      "autocomplete",
      3,
    )
    expect(
      (await standard(new CompletionContext(editable, 3, true)))?.options.map(
        (option) => option.label,
      ),
    ).toContain("SELECT")
    const state = EditorState.create({
      doc: "SEL",
      extensions: [createSqlLanguage(), EditorState.readOnly.of(true)],
    })
    const [source] = state.languageDataAt<CompletionSource>("autocomplete", 3)
    expect(await source(new CompletionContext(state, 3, true))).toBeNull()
  })

  test("missing structure is acquired on demand; cached empty structure and comments do not load", async () => {
    const load = mock(async () => schemas)
    for (const schema of [undefined, []]) {
      const state = EditorState.create({
        doc: "SELECT * FROM ",
        extensions: [createSqlLanguage("postgres", schema, load)],
      })
      const [source] = state.languageDataAt<CompletionSource>(
        "autocomplete",
        14,
      )
      const result = await source(new CompletionContext(state, 14, true))
      expect(
        result?.options.some((option) => option.label === "users") ?? false,
      ).toBe(schema === undefined)
    }
    const comment = EditorState.create({
      doc: "-- users",
      extensions: [createSqlLanguage("postgres", undefined, load)],
    })
    const [source] = comment.languageDataAt<CompletionSource>("autocomplete", 8)
    expect(await source(new CompletionContext(comment, 8, true))).toBeNull()
    expect(load).toHaveBeenCalledTimes(1)
  })

  test("failed structure acquisition keeps keyword completion and permits retry", async () => {
    let failed = true
    const state = EditorState.create({
      doc: "SELECT * FROM ",
      extensions: [
        createSqlLanguage("postgres", undefined, async () => {
          if (failed) throw new Error("offline")
          return schemas
        }),
      ],
    })
    const [source] = state.languageDataAt<CompletionSource>("autocomplete", 14)
    expect(await source(new CompletionContext(state, 14, true))).toBeNull()
    failed = false
    expect(
      (await source(new CompletionContext(state, 14, true)))?.options.map(
        (option) => option.label,
      ),
    ).toContain("users")
    const keywords = EditorState.create({
      doc: "SEL",
      extensions: [
        createSqlLanguage("postgres", undefined, async () => {
          throw new Error("offline")
        }),
      ],
    })
    const [fallback] = keywords.languageDataAt<CompletionSource>(
      "autocomplete",
      3,
    )
    expect(
      (await fallback(new CompletionContext(keywords, 3, true)))?.options.map(
        (option) => option.label,
      ),
    ).toContain("SELECT")
  })

  test("reconfiguration changes candidates without replacing the document or selection", async () => {
    const language = new Compartment()
    let state = EditorState.create({
      doc: "SELECT * FROM ",
      selection: { anchor: 14 },
      extensions: [language.of(createSqlLanguage("postgres", schemas))],
    })
    state = state.update({
      effects: language.reconfigure(
        createSqlLanguage("mysql", [
          {
            name: "next",
            tables: [{ name: "products", columns: [] }],
            views: [],
            functions: [],
          },
        ]),
      ),
    }).state
    expect(state.doc.toString()).toBe("SELECT * FROM ")
    expect(state.selection.main.head).toBe(14)
    const [source] = state.languageDataAt<CompletionSource>("autocomplete", 14)
    const result = await source(new CompletionContext(state, 14, true))
    expect(result?.options.map((option) => option.label)).toContain("products")
    expect(result?.options.map((option) => option.label)).not.toContain("users")
  })
})
