import { z } from "zod"
import type {
  ConfigProfile,
  CreateConfig,
  SelectCondition,
  SelectQuery,
  TableSource,
  UpdateConfig,
} from "@/contracts/database"
import type { WorkspaceSnapshot } from "@/contracts/workspace"

export const id = z.string().min(1)
export const text = z.string()
export const tableSource = z.strictObject({
  schema: id,
  table: id,
}) satisfies z.ZodType<TableSource>
export const profile = z.object({
  driver: z.enum(["postgres", "mysql"]),
  host: text,
  port: text,
  username: text,
  password: text,
  database: text,
  ssh: z
    .object({
      host: text,
      port: text,
      username: text,
      auth: z.discriminatedUnion("type", [
        z.object({ type: z.literal("password"), password: text }),
        z.object({
          type: z.literal("privateKey"),
          passphrase: text.optional(),
        }),
      ]),
    })
    .optional(),
}) satisfies z.ZodType<ConfigProfile>
export const config = profile.extend({
  name: text.optional(),
}) satisfies z.ZodType<CreateConfig>
export const updateConfig = config.partial() satisfies z.ZodType<UpdateConfig>
const condition: z.ZodType<SelectCondition> = z.object({
  column: text.optional(),
  operator: z.enum([
    "eq",
    "ne",
    "gt",
    "gte",
    "lt",
    "lte",
    "like",
    "notLike",
    "in",
    "notIn",
    "isNull",
    "isNotNull",
    "and",
    "or",
  ]),
  value: z.unknown().optional(),
  get conditions() {
    return z.array(condition).optional()
  },
})
export const query = z.object({
  from: z.object({ schema: text, table: text }),
  select: z
    .array(
      z.union([
        text,
        z.object({
          aggregate: z.literal("count"),
          column: text.optional(),
          alias: text.optional(),
        }),
      ]),
    )
    .optional(),
  where: condition.optional(),
  orderBy: z
    .array(
      z.object({ column: text, direction: z.enum(["asc", "desc"]).optional() }),
    )
    .optional(),
  limit: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
}) satisfies z.ZodType<SelectQuery>
export const file = z.object({
  defaultPath: text.optional(),
  content: text,
  filters: z
    .array(z.object({ name: text, extensions: z.array(text) }))
    .optional(),
})

const position = z.number().int().nonnegative()
const editor = z.object({
  text,
  cursor: z.object({
    line: z.number().int().positive(),
    col: z.number().int().positive(),
  }),
  selections: z.array(z.object({ anchor: position, head: position })).min(1),
  mainSelectionIndex: position,
  scroll: z.object({
    top: z.number().nonnegative(),
    left: z.number().nonnegative(),
  }),
  search: z.object({
    query: text,
    replace: text,
    caseSensitive: z.boolean(),
    wholeWord: z.boolean(),
    regexp: z.boolean(),
    open: z.boolean(),
  }),
})
const meta = { id, label: text }

export const workspaceSnapshot: z.ZodType<WorkspaceSnapshot> = z
  .object({
    version: z.literal(1),
    activeTabId: id.nullable(),
    tabs: z.array(
      z.discriminatedUnion("kind", [
        z.object({
          ...meta,
          kind: z.literal("query"),
          configId: id.optional(),
          editor,
        }),
        z.object({
          ...meta,
          kind: z.literal("view"),
          configId: id,
          source: tableSource,
          sort: z.array(
            z.object({
              column: id,
              direction: z.enum(["asc", "desc"]).optional(),
            }),
          ),
          sortOrder: z.array(id),
          offset: position,
          limit: z.number().int().positive(),
        }),
      ]),
    ),
  })
  .refine(
    (snapshot) =>
      new Set(snapshot.tabs.map((tab) => tab.id)).size === snapshot.tabs.length,
    { message: "标签页标识重复" },
  )
