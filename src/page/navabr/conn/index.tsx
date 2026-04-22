import { useSetAtom } from "jotai"
import { useState } from "react"
import type { Config } from "@/lib/config"
import { addTabAtom } from "@/lib/tabs"
import { ConnDialog } from "../config/conn-dialog"
import { ConnExplorer } from "./explorer"
import { ConnHeader } from "./header"

export interface ConnViewProps {
  conn: Config
  onBack: () => void
  onConnChange: (conn: Config) => void
}

export default function ConnView({
  conn,
  onBack,
  onConnChange,
}: ConnViewProps) {
  const addTab = useSetAtom(addTabAtom)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isEditing, setIsEditing] = useState(false)

  return (
    <>
      <ConnHeader
        conn={conn}
        onBack={onBack}
        onNewQuery={() => addTab({ connection: conn })}
        onRefresh={() => setRefreshKey((prev) => prev + 1)}
        onDisconnect={onBack}
        onEditConn={() => setIsEditing(true)}
      />
      <ConnExplorer conn={conn} refreshKey={refreshKey} />

      <ConnDialog
        mode={isEditing ? "edit" : null}
        conn={conn}
        onClose={() => setIsEditing(false)}
        onSaved={(savedConn) => {
          setIsEditing(false)
          setRefreshKey((prev) => prev + 1)
          onConnChange(savedConn)
        }}
      />
    </>
  )
}
