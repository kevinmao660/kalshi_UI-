import { useMemo } from 'react'
import { useScreenerStore, type SortKey } from '@/store/screener'
import { ScreenerRow } from './ScreenerRow'

const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'eventTicker', label: 'Event', align: 'left' },
  { key: 'yesAsk', label: 'YES Ask', align: 'right' },
  { key: 'noAsk', label: 'NO Ask', align: 'right' },
  { key: 'volume5m', label: '5m Vol', align: 'right' },
  { key: 'volume', label: 'Daily Vol', align: 'right' },
  { key: 'closeTime', label: 'Event In', align: 'right' },
]

export function ScreenerTable() {
  const sortedMarkets = useScreenerStore((s) => s.sortedMarkets)
  const page = useScreenerStore((s) => s.page)
  const pageSize = useScreenerStore((s) => s.pageSize)
  const sortKey = useScreenerStore((s) => s.sortKey)
  const sortDir = useScreenerStore((s) => s.sortDir)
  const setSort = useScreenerStore((s) => s.setSort)

  const currentPageRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return sortedMarkets.slice(start, start + pageSize)
  }, [sortedMarkets, page, pageSize])

  if (currentPageRows.length === 0) return null

  return (
    <div className="overflow-auto rounded-lg border border-kalshi-border bg-kalshi-surface">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 border-b border-kalshi-border bg-kalshi-surface">
          <tr>
            {COLUMNS.map(({ key, label, align }) => (
              <th
                key={key}
                className={`px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-kalshi-textSecondary ${
                  align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSort(key)}
                  className="flex w-full items-center gap-1 hover:text-kalshi-text focus:outline-none focus:ring-0"
                  style={{ justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}
                >
                  {label}
                  {sortKey === key && (
                    <span className="text-kalshi-text">{sortDir === 'asc' ? '▲' : '▼'}</span>
                  )}
                </button>
              </th>
            ))}
            <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-kalshi-textSecondary">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {currentPageRows.map((row) => (
            <ScreenerRow key={row.id} market={row} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
