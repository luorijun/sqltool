import { atom, getDefaultStore } from "jotai"
import type { Setter } from "jotai/vanilla"
import type {
  ConfigProfile,
  ConnResponse,
  ConnSnapshot,
  CreateConfig,
  FailureKind,
  SelectQuery,
  UpdateConfig,
} from "."

type ConnectionAction = "connect" | "disconnect" | "inspect"
export const connSnapshotAtom = atom<ConnSnapshot | null>(
  null as ConnSnapshot | null,
)
export const connectionEntriesAtom = atom(
  (get) => get(connSnapshotAtom)?.connections ?? null,
)
export const sessionEntriesAtom = atom(
  (get) => get(connSnapshotAtom)?.sessions ?? [],
)
export const connectionActionAtom = atom<
  Record<string, ConnectionAction | undefined>
>({})

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
  async list() {
    return (await connApi.sync()).connections
  },
  async get(id: string) {
    return (await connApi.list()).find((c) => c.config.id === id)
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
  async inspect(id: string) {
    await unwrap(window.main.conn.inspect(id))
    return currentConnection(id)
  },
  openSession(id: string, tabId: string) {
    return unwrap(window.main.conn.openSession(id, tabId))
  },
  closeSession(id: string) {
    return unwrap(window.main.conn.closeSession(id))
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

export const refreshConnectionsAtom = atom(null, () => connApi.list())
export const ensureConnectionsLoadedAtom = atom(
  null,
  async (get, set) => get(connectionEntriesAtom) ?? set(refreshConnectionsAtom),
)

async function runAction(set: Setter, id: string, action: ConnectionAction) {
  set(connectionActionAtom, (current) => ({ ...current, [id]: action }))
  try {
    return await connApi[action](id)
  } finally {
    set(connectionActionAtom, (current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }
}
export const connectConnectionAtom = atom(null, (_get, set, id: string) =>
  runAction(set, id, "connect"),
)
export const disconnectConnectionAtom = atom(null, (_get, set, id: string) =>
  runAction(set, id, "disconnect"),
)
export const refreshConnectionSchemaAtom = atom(null, (_get, set, id: string) =>
  runAction(set, id, "inspect"),
)
export const deleteConnectionAtom = atom(null, (_get, _set, id: string) =>
  connApi.remove(id),
)
