import { useCallback, useState } from "react"
import Header from "./header/header"
import Main from "./main"
import Nav from "./navabr"

export default function Root() {
  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  return (
    <div className="w-screen h-screen grid grid-cols-[256px_1fr] grid-rows-[40px_1fr]">
      <Header onSaved={refresh} />
      <Nav refreshKey={refreshKey} onChanged={refresh} />
      <Main />
    </div>
  )
}
