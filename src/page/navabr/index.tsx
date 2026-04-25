import { useState } from "react"
import type { Config } from "@/lib/config"
import { cn } from "@/lib/utils"
import ConfigView from "./config"
import ConnView from "./conn"

export default function Nav(props: { className?: string }) {
  const [activeConn, setActiveConn] = useState<Config | null>(null)

  return (
    <nav
      className={cn(
        "bg-sidebar text-sidebar-foreground flex flex-col overflow-hidden",
        props.className,
      )}
    >
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
