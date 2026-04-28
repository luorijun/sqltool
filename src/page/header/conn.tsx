import { useSetAtom } from "jotai"
import { useState } from "react"
import { buttonVariants } from "@/components/ui/button"
import { upsertConnectionConfigAtom } from "@/lib/conn/state"
import { ConnDialog } from "@/page/sidebar/dialog"

export default function NewConn({ onSaved }: { onSaved?: () => void } = {}) {
  const [mode, setMode] = useState<"create" | null>(null)
  const upsertConnectionConfig = useSetAtom(upsertConnectionConfigAtom)

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
        onSaved={(conn) => {
          upsertConnectionConfig(conn)
          setMode(null)
          onSaved?.()
        }}
      />
    </>
  )
}
