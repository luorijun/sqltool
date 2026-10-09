import { createServices } from "@/main/app/services"
import { createDatabaseApi } from "@/main/ipc/database"

export type DatabaseOptions = Parameters<typeof createServices>[0]
export function createDatabase(options: DatabaseOptions) {
  const services = createServices(options)
  const owners = new Set<number>()
  return {
    closeOwner: (owner: number, force = false) =>
      services.sessions.closeOwner(owner, force),
    close: async () => {
      await Promise.all(
        [...owners].map((owner) => services.sessions.closeOwner(owner, true)),
      )
      owners.clear()
    },
    forOwner: (owner: number) => {
      owners.add(owner)
      return createDatabaseApi(
        owner,
        services.connections,
        services.sessions,
        options.connect,
      )
    },
  }
}
