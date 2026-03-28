import { randomUUID } from "node:crypto"
import Store from "electron-store"

export type DbDriver = "postgres" | "mysql" | "sqlite"

export type Connection = {
  id: string
  name?: string
  driver: DbDriver
  host: string
  port: string
  username: string
  password: string
  database: string
  createdAt: number
  updatedAt: number
}

export type CreateConnection = Omit<
  Connection,
  "id" | "createdAt" | "updatedAt"
>
export type UpdateConnection = Partial<CreateConnection>

const store = new Store<{ connections: Record<string, Connection> }>({
  name: "connections",
  defaults: { connections: {} },
})

export function listConnections(): Connection[] {
  const connections = store.get("connections")
  return Object.values(connections)
}

export function getConnection(id: string): Connection | undefined {
  const connections = store.get("connections")
  return connections[id]
}

export function createConnection(input: CreateConnection): Connection {
  const now = Date.now()
  const connection: Connection = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  }
  store.set(`connections.${connection.id}`, connection)
  return connection
}

export function updateConnection(
  id: string,
  input: UpdateConnection,
): Connection {
  const connections = store.get("connections")
  const existing = connections[id]
  if (!existing) {
    throw new Error(`Connection not found: ${id}`)
  }
  const updated: Connection = {
    ...existing,
    ...input,
    id,
    updatedAt: Date.now(),
  }
  store.set(`connections.${id}`, updated)
  return updated
}

export function deleteConnection(id: string): void {
  const connections = store.get("connections")
  delete connections[id]
  store.set("connections", connections)
}
