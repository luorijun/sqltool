import { config } from "@tests/support/config"
import type { ConnSnapshot } from "@/core/database"
import type { ConnResponse, DatabaseApi, WorkspaceApi } from "@/preload/bridge"

export { config } from "@tests/support/config"

export function renderer(version: number) {
  const snapshot: ConnSnapshot = {
    version,
    connections: [
      {
        config: structuredClone(config),
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
    disconnect: unexpected,
    inspect: unexpected,
    openSession: unexpected,
    closeTab: unexpected,
    query: unexpected,
    select: unexpected,
    cancel: unexpected,
  }
  const workspace: WorkspaceApi = {
    load: async () => null,
    save: async () => {},
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, "window")
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { main: { conn: bridge, workspace } },
  })
  const restore = () => {
    if (original) Object.defineProperty(globalThis, "window", original)
    else Reflect.deleteProperty(globalThis, "window")
  }
  return { snapshot, capture, ok, bridge, workspace, restore }
}
