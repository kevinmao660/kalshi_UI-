import { AppLogo } from './AppLogo'
import { SearchBar } from './SearchBar'

export function TopNavbar() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-kalshi-border bg-kalshi-surface px-4">
      <AppLogo />
      <SearchBar />
    </header>
  )
}
