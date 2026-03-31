import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  fetchAllMarketsForEvent,
  fetchMarkets,
  yesOutcomeLabel,
} from '@/api/kalshi'

/**
 * Homepage control: enter a Kalshi `event_ticker` and jump to that event’s trading view
 * (same first-market ordering as the trading page for paired events).
 */
export function EventOpenBar() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const tag = value.trim()
    if (!tag) return
    setError(null)
    setPending(true)
    try {
      let markets = await fetchAllMarketsForEvent(tag)
      if (markets.length === 0) {
        const { markets: anyStatus } = await fetchMarkets({
          eventTicker: tag,
          limit: 50,
        })
        markets = anyStatus
      }
      if (markets.length === 0) {
        setError('No markets found for that event ticker.')
        return
      }
      const sorted = [...markets].sort((a, b) =>
        yesOutcomeLabel(a).localeCompare(yesOutcomeLabel(b), undefined, {
          sensitivity: 'base',
        }),
      )
      navigate(`/market/${encodeURIComponent(sorted[0].ticker)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load event.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-2 rounded-lg border border-kalshi-border bg-kalshi-surface px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3"
    >
      <label className="flex min-w-[min(100%,280px)] flex-1 flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-kalshi-textSecondary">
          Event ticker
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. KXNBAGAME-25FEB03ATLCHI"
          autoComplete="off"
          spellCheck={false}
          className="rounded border border-kalshi-border bg-kalshi-bg px-2.5 py-1.5 font-mono text-sm text-kalshi-text placeholder:text-kalshi-textSecondary/60"
        />
      </label>
      <button
        type="submit"
        disabled={pending || !value.trim()}
        className="shrink-0 rounded border border-kalshi-accent/60 bg-kalshi-accent/15 px-4 py-1.5 text-sm font-medium text-kalshi-accent hover:bg-kalshi-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? '…' : 'Open event'}
      </button>
      {error && (
        <p className="w-full text-xs text-red-400 sm:order-last" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
