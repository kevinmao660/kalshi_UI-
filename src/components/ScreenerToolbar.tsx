import { useScreenerStore } from '@/store/screener'

const SORT_LABELS: Record<string, string> = {
  eventTicker: 'Event',
  yesAsk: 'YES Ask',
  noAsk: 'NO Ask',
  volume5m: '5m Vol',
  volume: 'Daily Vol',
  closeTime: 'Event In',
}

export function ScreenerToolbar() {
  const lastRefreshAt = useScreenerStore((s) => s.lastRefreshAt)
  const sortKey = useScreenerStore((s) => s.sortKey)
  const sortDir = useScreenerStore((s) => s.sortDir)

  const lastStr =
    lastRefreshAt != null
      ? new Date(lastRefreshAt).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      : '—'

  return (
    <div className="flex items-center gap-4 text-xs text-kalshi-textSecondary">
      <span>
        Sort: {SORT_LABELS[sortKey] || sortKey} {sortDir === 'asc' ? '▲' : '▼'}
      </span>
      <span>Refreshes every 10s</span>
      <span>Last: {lastStr}</span>
    </div>
  )
}
