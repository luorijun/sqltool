export const LIST = "config:list"
export const GET = "config:get"
export const CREATE = "config:create"
export const UPDATE = "config:update"
export const REMOVE = "config:remove"

export type DbDriver = "postgres" | "mysql"

export type SshPasswordAuth = {
  type: "password"
  password: string
}

export type SshPrivateKeyAuth = {
  type: "privateKey"
  passphrase?: string
}

export type SshAuth = SshPasswordAuth | SshPrivateKeyAuth

export type SshConfig = {
  host: string
  port: string
  username: string
  auth: SshAuth
}

export type ConfigProfile = {
  driver: DbDriver
  host: string
  port: string
  username: string
  password: string
  database: string
  ssh?: SshConfig
}

export type Config = ConfigProfile & {
  id: string
  name?: string
  createdAt: number
  updatedAt: number
}

export type CreateConfig = ConfigProfile & {
  name?: string
}

export type UpdateConfig = Partial<CreateConfig>
