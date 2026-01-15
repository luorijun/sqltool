export default function Root() {
  return (
    <div className="w-screen h-screen grid grid-cols-[256px_1fr] grid-rows-[64px_1fr]">
      <header className="col-start-1 col-span-2">header</header>
      <nav>nav</nav>
      <main className="col-start-2 col-span-1">main</main>
    </div>
  )
}
