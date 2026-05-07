import { useSetAtom } from "jotai"
import { useState } from "react"
import { buttonVariants } from "@/components/ui/button"
import type { Config } from "@/lib/config"
import { refreshConnectionsAtom } from "@/lib/conn/renderer"
import { ConnDialog } from "@/page/sidebar/dialog"

export default function NewConn({ onSaved }: { onSaved?: () => void } = {}) {
  const [mode, setMode] = useState<"create" | null>(null)
  const refreshConnections = useSetAtom(refreshConnectionsAtom)

  const handleSaved = async (_conn: Config) => {
    await refreshConnections()
    setMode(null)
    onSaved?.()
  }

  return (
    <>
      <button
        type="button"
        className={buttonVariants()}
        onClick={() => setMode("create")}
      >
        新连接
      </button>

      <ConnDialog
        mode={mode}
        onClose={() => setMode(null)}
        onSaved={(conn: Config) => {
          handleSaved(conn)
        }}
      />
    </>
  )
}
