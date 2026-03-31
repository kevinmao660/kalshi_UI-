import { useScreenerStore } from '@/store/screener'

const PAGE_SIZES = [25, 50, 100] as const

export function ScreenerPagination() {
  const sortedMarkets = useScreenerStore((s) => s.sortedMarkets)
  const page = useScreenerStore((s) => s.page)
  const pageSize = useScreenerStore((s) => s.pageSize)
  const setPage = useScreenerStore((s) => s.setPage)
  const setPageSize = useScreenerStore((s) => s.setPageSize)

  const totalPages = Math.max(1, Math.ceil(sortedMarkets.length / pageSize))
  const canPrev = page > 1
  const canNext = page < totalPages

  const pageNumbers = usePageNumbers(page, totalPages)

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-kalshi-border bg-kalshi-surface px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-kalshi-textSecondary">
        <span>
          Page {page} of {totalPages}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPage(page - 1)}
          disabled={!canPrev}
          className="rounded px-2 py-1 text-sm text-kalshi-text disabled:opacity-40"
        >
          ◀ Prev
        </button>
        <div className="flex gap-1">
          {pageNumbers.map((n, i) =>
            n === '…' ? (
              <span key={`ellipsis-${i}`} className="px-2 py-1 text-kalshi-textMuted">
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                onClick={() => setPage(n)}
                className={`rounded px-2 py-1 text-sm ${
                  n === page ? 'bg-kalshi-accent text-white' : 'text-kalshi-text hover:bg-kalshi-row'
                }`}
              >
                {n}
              </button>
            ),
          )}
        </div>
        <button
          type="button"
          onClick={() => setPage(page + 1)}
          disabled={!canNext}
          className="rounded px-2 py-1 text-sm text-kalshi-text disabled:opacity-40"
        >
          Next ▶
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-kalshi-textSecondary">Show:</span>
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="rounded border border-kalshi-border bg-kalshi-bg px-2 py-1 text-sm text-kalshi-text"
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="text-sm text-kalshi-textSecondary">per page</span>
      </div>
    </div>
  )
}

function usePageNumbers(page: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const result: (number | '…')[] = []
  if (page <= 3) {
    result.push(1, 2, 3, 4, '…', totalPages)
  } else if (page >= totalPages - 2) {
    result.push(1, '…', totalPages - 3, totalPages - 2, totalPages - 1, totalPages)
  } else {
    result.push(1, '…', page - 1, page, page + 1, '…', totalPages)
  }
  return result
}
