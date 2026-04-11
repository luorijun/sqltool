import NewConn from "./conn"

export interface HeaderProps {
  onSaved?: () => void
}

export default function Header({ onSaved }: HeaderProps) {
  return (
    <header className="col-start-1 col-span-2 flex items-center border-b bg-sidebar px-1">
      <NewConn onSaved={onSaved} />
    </header>
  )
}
