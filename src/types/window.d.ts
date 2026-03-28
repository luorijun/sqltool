import type {
  Connection,
  CreateConnection,
  UpdateConnection,
} from "../lib/connection"

declare global {
  interface Window {
    main: {
      connection: {
        list(): Promise<Connection[]>
        get(id: string): Promise<Connection | undefined>
        create(input: CreateConnection): Promise<Connection>
        update(id: string, input: UpdateConnection): Promise<Connection>
        delete(id: string): Promise<void>
      }
    }
  }
}
