import type { Config } from "@/core/database"

export const config: Config = {
  id: "db",
  driver: "postgres",
  host: "localhost",
  port: "5432",
  username: "u",
  password: "p",
  database: "db",
  createdAt: 0,
  updatedAt: 0,
}
