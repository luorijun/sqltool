import { Toaster } from "@/components/ui/sonner"
import Main from "./main"
import Nav from "./navabr"

export default function Root() {
  return (
    <>
      <div className="w-screen h-screen grid grid-cols-[256px_1fr]">
        <Nav />
        <Main />
      </div>
      <Toaster />
    </>
  )
}
