import { renderer } from "@tests/support/renderer"
import { getDefaultStore } from "jotai"
import client, { snapshotAtom } from "@/renderer/modules/database/client"
import {
  closeTabAtom,
  setCopyOptionsAtom,
  tabsAtom,
} from "@/renderer/modules/workspace"

export async function setupWorkspace() {
  const store = getDefaultStore()
  const env = renderer(store.get(snapshotAtom)?.version ?? 0)
  env.bridge.openSession = async (configId, tabId) => {
    const id = crypto.randomUUID()
    env.snapshot.sessions.push({
      id,
      configId,
      tabId,
      kind: "sql",
      status: "ready",
      used: false,
      error: null,
    })
    return env.ok(id)
  }
  const close = async (tabId: string) => {
    env.snapshot.sessions = env.snapshot.sessions.filter(
      (session) => session.tabId !== tabId,
    )
    return env.ok(true)
  }
  env.bridge.closeTab = close
  const closeTabs = async () => {
    env.bridge.closeTab = close
    for (const tab of store.get(tabsAtom)) await store.set(closeTabAtom, tab.id)
  }
  try {
    await client.sync()
  } catch (error) {
    env.restore()
    throw error
  }
  return {
    ...env,
    closeTabs,
    async dispose() {
      try {
        await closeTabs()
        store.set(setCopyOptionsAtom, { format: "tsv", headers: false })
      } finally {
        env.restore()
      }
    },
  }
}
