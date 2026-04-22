import { useState } from "react"
import type { Config } from "@/lib/config"
import ConfigView from "./config"
import ConnView from "./conn"

export default function Nav() {
  const [activeConn, setActiveConn] = useState<Config | null>(null)

  return (
    <nav className="bg-sidebar border-r text-sidebar-foreground flex flex-col overflow-hidden">
      {activeConn ? (
        <ConnView
          conn={activeConn}
          onBack={() => setActiveConn(null)}
          onConnChange={setActiveConn}
        />
      ) : (
        <ConfigView onConnect={setActiveConn} />
      )}
    </nav>
  )
}
