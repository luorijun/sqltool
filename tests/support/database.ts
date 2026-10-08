import { createServices } from "../../src/main/app/services"
import { createDatabaseApi } from "../../src/main/ipc/database"

export type DatabaseOptions = Parameters<typeof createServices>[0]
export function createDatabase(options: DatabaseOptions) {
  const services = createServices(options)
  return {
    closeOwner: (owner: number, force = false) =>
      services.sessions.closeOwner(owner, force),
    forOwner: (owner: number) =>
      createDatabaseApi(
        owner,
        services.connections,
        services.sessions,
        options.connect,
      ),
  }
}
