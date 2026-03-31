import { EventOpenBar } from './EventOpenBar'
import { ScreenerToolbar } from './ScreenerToolbar'
import { ScreenerTable } from './ScreenerTable'
import { ScreenerPagination } from './ScreenerPagination'
import { useScreenerStore } from '@/store/screener'

export function HotVolumeScreener() {
  const sortedMarkets = useScreenerStore((s) => s.sortedMarkets)
  const isLoading = useScreenerStore((s) => s.isLoading)
  const error = useScreenerStore((s) => s.error)
  const usingRelaxedFilters = useScreenerStore((s) => s.usingRelaxedFilters)

  if (error) {
    return (
      <div className="rounded-lg border border-kalshi-negative/50 bg-kalshi-surface p-4 text-kalshi-negative">
        {error}
      </div>
    )
  }

  if (isLoading && sortedMarkets.length === 0) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-kalshi-border border-t-kalshi-accent" />
        <p className="mt-3 text-sm text-kalshi-textSecondary">Loading markets…</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <EventOpenBar />
      {usingRelaxedFilters && (
        <div className="rounded border border-kalshi-border bg-kalshi-surface px-3 py-2 text-xs text-kalshi-textSecondary">
          No markets with 10k+ vol &lt;24h left. Showing relaxed: 1k+ vol, &lt;7d.
        </div>
      )}
      <ScreenerToolbar />
      <ScreenerTable />
      {sortedMarkets.length > 0 && <ScreenerPagination />}
    </div>
  )
}
