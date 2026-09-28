import { randomUUID } from "node:crypto"
import type { Config, CreateConfig, UpdateConfig } from "@/contracts/database"
import type { ConfigStore } from "./ports"

export class Configs {
  constructor(private store: ConfigStore) {}
  list = () => this.store.list()
  create(input: CreateConfig): Config {
    const now = Date.now()
    const config = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(config)
    return config
  }
  update(id: string, input: UpdateConfig): Config {
    const current = this.store.get(id)
    if (!current) throw new Error("连接不存在或已删除")
    const config = { ...current, ...input, id, updatedAt: Date.now() }
    this.store.set(config)
    return config
  }
  remove(id: string): void {
    this.store.remove(id)
  }
}
