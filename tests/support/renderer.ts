import type {
  Config,
  ConnResponse,
  ConnSnapshot,
  DatabaseApi,
} from "../../src/contracts/database"

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

export function renderer(version: number) {
  const snapshot: ConnSnapshot = {
    version,
    connections: [
      {
        config,
        connected: true,
        error: null,
        schema: null,
        sessionCount: 0,
        failedCount: 0,
        generation: 0,
      },
    ],
    sessions: [],
    tasks: [],
  }
  const capture = () =>
    structuredClone({ ...snapshot, version: ++snapshot.version })
  const ok = <T>(value: T): ConnResponse<T> => ({
    ok: true,
    value,
    snapshot: capture(),
  })
  const unexpected = async (): Promise<never> => {
    throw new Error("Unexpected bridge call")
  }
  const bridge: DatabaseApi = {
    sync: async () => capture(),
    test: unexpected,
    create: unexpected,
    update: unexpected,
    remove: unexpected,
    connect: unexpected,
    disconnect: unexpected,
    inspect: unexpected,
    openSession: unexpected,
    closeTab: unexpected,
    query: unexpected,
    select: unexpected,
    cancel: unexpected,
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, "window")
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { main: { conn: bridge } },
  })
  const restore = () => {
    if (original) Object.defineProperty(globalThis, "window", original)
    else Reflect.deleteProperty(globalThis, "window")
  }
  return { snapshot, capture, ok, bridge, restore }
}
