import { atom, getDefaultStore } from "jotai"
import type { Setter } from "jotai/vanilla"
import type {
  ConfigProfile,
  ConnResponse,
  ConnSnapshot,
  CreateConfig,
  FailureKind,
  SelectQuery,
  TableSource,
  UpdateConfig,
} from "@/contracts/database"

type ConnectionAction = "connect" | "disconnect" | "inspect"
const connSnapshotAtom = atom<ConnSnapshot | null>(null as ConnSnapshot | null)
export const connectionEntriesAtom = atom(
  (get) => get(connSnapshotAtom)?.connections ?? null,
)
export const sessionEntriesAtom = atom(
  (get) => get(connSnapshotAtom)?.sessions ?? [],
)
const actionsAtom = atom<Record<string, ConnectionAction | undefined>>({})

export function applySnapshot(snapshot: ConnSnapshot): void {
  const store = getDefaultStore()
  const current = store.get(connSnapshotAtom)
  if (!current || snapshot.version > current.version)
    store.set(connSnapshotAtom, snapshot)
}

export class RequestError extends Error {
  readonly kind: FailureKind
  constructor(message: string, kind: FailureKind) {
    super(message)
    this.kind = kind
  }
}

async function unwrap<T>(request: Promise<ConnResponse<T>>): Promise<T> {
  const response = await request
  applySnapshot(response.snapshot)
  if (response.ok === false)
    throw new RequestError(response.error, response.kind)
  return response.value
}

function currentConnection(id: string) {
  const connection = getDefaultStore()
    .get(connSnapshotAtom)
    ?.connections.find((c) => c.config.id === id)
  if (!connection) throw new Error("连接不存在或已删除")
  return connection
}

const connApi = {
  test(profile: ConfigProfile) {
    return window.main.conn.test(profile)
  },
  async sync() {
    const snapshot = await window.main.conn.sync()
    applySnapshot(snapshot)
    return getDefaultStore().get(connSnapshotAtom) ?? snapshot
  },
  create(input: CreateConfig) {
    return unwrap(window.main.conn.create(input))
  },
  update(id: string, input: UpdateConfig) {
    return unwrap(window.main.conn.update(id, input))
  },
  remove(id: string) {
    return unwrap(window.main.conn.remove(id))
  },
  async connect(id: string) {
    await unwrap(window.main.conn.connect(id))
    return currentConnection(id)
  },
  async disconnect(id: string) {
    if (!(await unwrap(window.main.conn.disconnect(id)))) return undefined
    return currentConnection(id)
  },
  async inspect(id: string, source?: TableSource, refresh = false) {
    await unwrap(window.main.conn.inspect(id, source, refresh))
    return currentConnection(id)
  },
  openSession(id: string, tabId: string) {
    return unwrap(window.main.conn.openSession(id, tabId))
  },
  closeTab(tabId: string) {
    return unwrap(window.main.conn.closeTab(tabId))
  },
  cancel(id: string) {
    return unwrap(window.main.conn.cancel(id))
  },
  query(id: string, requestId: string, sql: string) {
    return unwrap(window.main.conn.query(id, requestId, sql))
  },
  select(id: string, tabId: string, requestId: string, query: SelectQuery) {
    return unwrap(window.main.conn.select(id, tabId, requestId, query))
  },
}
export default connApi

export const refreshConnectionsAtom = atom(null, () => connApi.sync())

const pending = new Map<
  string,
  { key: string; promise: ReturnType<typeof connApi.disconnect> }
>()

function runAction(
  set: Setter,
  id: string,
  action: ConnectionAction,
  source?: TableSource,
) {
  const key = JSON.stringify([action, source])
  const current = pending.get(id)
  if (current) {
    if (current.key === key) return current.promise
    return Promise.reject(new Error("连接正在处理中，请稍后重试"))
  }
  set(actionsAtom, (current) => ({ ...current, [id]: action }))
  const promise = Promise.resolve()
    .then(async () => {
      if (action === "connect") return connApi.inspect(id)
      if (action === "inspect") return connApi.inspect(id, source, true)
      return connApi.disconnect(id)
    })
    .finally(() => {
      pending.delete(id)
      set(actionsAtom, (current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
    })
  pending.set(id, { key, promise })
  return promise
}
export const connectConnectionAtom = atom(null, (_get, set, id: string) =>
  runAction(set, id, "connect"),
)
export const disconnectConnectionAtom = atom(null, (_get, set, id: string) =>
  runAction(set, id, "disconnect"),
)
export const refreshConnectionSchemaAtom = atom(
  null,
  (_get, set, target: string | { id: string; source: TableSource }) =>
    typeof target === "string"
      ? runAction(set, target, "inspect")
      : runAction(set, target.id, "inspect", target.source),
)
export const deleteConnectionAtom = atom(null, (_get, _set, id: string) =>
  connApi.remove(id),
)

export const connectionActionAtom = atom((get) => get(actionsAtom))
export const snapshotAtom = atom((get) => get(connSnapshotAtom))
