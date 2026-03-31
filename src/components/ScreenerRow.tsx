import { Link } from 'react-router-dom'
import type { MarketSnapshot } from '@/types/market'
import { useScreenerStore } from '@/store/screener'

function fmtPrice(n: number) {
  return n.toFixed(2)
}

function fmtVol(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n)
}

function timeRemaining(closeTime: string): string {
  const end = new Date(closeTime).getTime()
  const now = Date.now()
  const ms = end - now
  if (ms <= 0) return 'Closed'
  const d = Math.floor(ms / 864e5)
  const h = Math.floor((ms % 864e5) / 36e5)
  const m = Math.floor((ms % 36e5) / 6e4)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

interface Props {
  market: MarketSnapshot
}

export function ScreenerRow({ market }: Props) {
  const flashMarketIds = useScreenerStore((s) => s.flashMarketIds)
  const isFlashing = flashMarketIds.has(market.ticker)

  const displayName = market.eventTicker
    ? `${market.eventTicker} • ${market.title.length > 50 ? market.title.slice(0, 50) + '…' : market.title}`
    : market.title

  return (
    <tr className="border-b border-kalshi-border bg-kalshi-row transition-colors duration-75 hover:bg-kalshi-rowAlt">
      <td className="px-4 py-2.5 text-sm text-kalshi-text" title={market.title}>
        {displayName}
      </td>
      <td className="px-4 py-2.5 font-mono text-right text-sm tabular-nums text-kalshi-text">
        {fmtPrice(market.yesAsk)}
      </td>
      <td className="px-4 py-2.5 font-mono text-right text-sm tabular-nums text-kalshi-text">
        {fmtPrice(market.noAsk)}
      </td>
      <td
        className={`px-4 py-2.5 font-mono text-right text-sm tabular-nums text-kalshi-text ${
          isFlashing ? 'animate-volume-flash' : ''
        }`}
      >
        ${fmtVol(market.volume5m)}
      </td>
      <td className="px-4 py-2.5 font-mono text-right text-sm tabular-nums text-kalshi-text">
        ${fmtVol(market.volume)}
      </td>
      <td className="px-4 py-2.5 font-mono text-right text-sm tabular-nums text-kalshi-textSecondary">
        {timeRemaining(market.closeTime)}
      </td>
      <td className="px-4 py-2.5 text-right">
        <Link
          to={`/market/${encodeURIComponent(market.ticker)}`}
          className="inline-block rounded bg-kalshi-accent px-3 py-1 text-xs font-medium text-white hover:opacity-90"
        >
          Trade
        </Link>
      </td>
    </tr>
  )
}
