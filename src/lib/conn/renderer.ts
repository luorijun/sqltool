import type { Config } from "../config/index"
import type { DbSchema } from "./index"

const conn = {
  inspect(config: Config): Promise<DbSchema[]> {
    return window.main.conn.inspect(config)
  },
}

export default conn
