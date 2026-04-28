import type { Config, CreateConfig } from "../config"
import type { DbSchema, QueryResult } from "./index"

const conn = {
  test(config: CreateConfig): Promise<void> {
    return window.main.conn.test(config)
  },
  inspect(config: Config): Promise<DbSchema[]> {
    return window.main.conn.inspect(config)
  },
  query(config: Config, sql: string): Promise<QueryResult> {
    return window.main.conn.query(config, sql)
  },
}

export default conn
