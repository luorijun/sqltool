import type { Connection, CreateConnection, UpdateConnection } from "./index"

const connection = {
  list(): Promise<Connection[]> {
    return window.main.connection.list()
  },
  get(id: string): Promise<Connection | undefined> {
    return window.main.connection.get(id)
  },
  create(input: CreateConnection): Promise<Connection> {
    return window.main.connection.create(input)
  },
  update(id: string, input: UpdateConnection): Promise<Connection> {
    return window.main.connection.update(id, input)
  },
  delete(id: string): Promise<void> {
    return window.main.connection.delete(id)
  },
}

export default connection
