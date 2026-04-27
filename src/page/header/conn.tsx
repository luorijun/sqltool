import { useState } from "react"
import { buttonVariants } from "@/components/ui/button"
import { ConnDialog } from "@/page/navabr/config/conn-dialog"

export default function NewConn({ onSaved }: { onSaved?: () => void } = {}) {
  const [mode, setMode] = useState<"create" | null>(null)

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
        onSaved={() => {
          setMode(null)
          onSaved?.()
        }}
      />
    </>
  )
}
