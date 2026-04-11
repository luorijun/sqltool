import { Database, HardDrive, Server } from "lucide-react"

export const driverLabel: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
}

export function DriverIcon({ driver }: { driver: string }) {
  if (driver === "sqlite") return <HardDrive className="size-4 shrink-0" />
  if (driver === "mysql") return <Server className="size-4 shrink-0" />
  return <Database className="size-4 shrink-0" />
}
