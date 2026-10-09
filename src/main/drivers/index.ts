import type { ConfigProfile } from "@/core/database"
import { connectMySql } from "./mysql"
import { connectPostgres } from "./postgres"
import type { ConnectionSession } from "./types"
export function connectDriver(
  profile: ConfigProfile,
): Promise<ConnectionSession> {
  switch (profile.driver) {
    case "mysql":
      return connectMySql(profile)
    case "postgres":
      return connectPostgres(profile)
  }
}

export { needsMySqlCharset, resolveMySqlType } from "./mysql-types"
export type {
  ColumnType,
  Connect,
  ConnectionSession,
  DriverColumn,
  DriverResult,
  MySqlTypeRef,
  PostgresTypeRef,
  TableDefinition,
  Transaction,
  TypeRef,
} from "./types"
