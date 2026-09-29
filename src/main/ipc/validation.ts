import { z } from "zod"

export const id = z.string().min(1)
export const text = z.string()
export const tableSource = z.strictObject({ schema: id, table: id })
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
})
export const config = profile.extend({ name: text.optional() })
const condition = z.object({
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
})
export const file = z.object({
  defaultPath: text.optional(),
  content: text,
  filters: z
    .array(z.object({ name: text, extensions: z.array(text) }))
    .optional(),
})
