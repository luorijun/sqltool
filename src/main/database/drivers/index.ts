import type { ConfigProfile } from "@/contracts/database"
import type { ConnectionSession } from "../ports"
import { connectMySql } from "./mysql"
import { connectPostgres } from "./postgres"
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
