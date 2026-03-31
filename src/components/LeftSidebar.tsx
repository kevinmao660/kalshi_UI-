import { CategoryFilters } from './CategoryFilters'

export function LeftSidebar() {
  return (
    <aside className="flex w-[180px] shrink-0 flex-col border-r border-kalshi-border bg-kalshi-surface p-3">
      <CategoryFilters />
      <p className="mt-4 border-t border-kalshi-border pt-3 text-[10px] text-kalshi-textMuted">
        Markets: no API key. Balance: requires key in .env
      </p>
    </aside>
  )
}
