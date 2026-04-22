export const LIST = "config:list"
export const GET = "config:get"
export const CREATE = "config:create"
export const UPDATE = "config:update"
export const REMOVE = "config:remove"

export type DbDriver = "postgres" | "mysql" | "sqlite"

export type Config = {
  id: string
  name?: string
  driver: DbDriver
  host: string
  port: string
  username: string
  password: string
  database: string
  createdAt: number
  updatedAt: number
}

export type CreateConfig = Omit<Config, "id" | "createdAt" | "updatedAt">
export type UpdateConfig = Partial<CreateConfig>
