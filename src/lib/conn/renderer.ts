import type { Config } from "../config/index"
import type { DbSchema, QueryResult } from "./index"

const conn = {
  inspect(config: Config): Promise<DbSchema[]> {
    return window.main.conn.inspect(config)
  },
  query(config: Config, sql: string): Promise<QueryResult> {
    return window.main.conn.query(config, sql)
  },
}

export default conn
