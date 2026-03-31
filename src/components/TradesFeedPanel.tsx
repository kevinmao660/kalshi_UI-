import type { MarketSnapshot } from '@/api/market'

/** Dollar notional at or above this value gets a distinct row style */
const HIGH_VOLUME_NOTIONAL_USD = 5000

interface Props {
  trades: MarketSnapshot['trades']
  /** Expand to fill parent height with internal scroll (sidebar layout). */
  fillHeight?: boolean
  /** e.g. team / outcome name */
  subtitle?: string
}

function fmtTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Trade leg cost in USD (count × price); same as engine `notional`. */
function fmtUsd(notional: number) {
  return `$${notional.toFixed(2)}`
}

export function TradesFeedPanel({ trades, fillHeight, subtitle }: Props) {
  return (
    <div
      className={`rounded-lg border border-kalshi-border bg-kalshi-row p-3 ${
        fillHeight ? 'flex h-full min-h-0 flex-1 flex-col' : ''
      }`}
    >
      <h3 className="mb-2 shrink-0 text-xs font-medium uppercase tracking-wide text-kalshi-textSecondary">
        Recent Trades
        {subtitle && (
          <span className="mt-0.5 block font-normal normal-case text-kalshi-text">{subtitle}</span>
        )}
      </h3>
      <div
        className={`font-mono text-sm ${
          fillHeight ? 'min-h-0 flex-1 overflow-y-auto' : 'max-h-48 overflow-y-auto'
        }`}
      >
        <div className="mb-1 flex justify-between border-b border-kalshi-border pb-1 text-xs text-kalshi-textSecondary">
          <span>Time</span>
          <span>Price</span>
          <span>Size</span>
          <span>Cost</span>
        </div>
        {trades.map((t) => {
          const highVolume = t.notional >= HIGH_VOLUME_NOTIONAL_USD
          return (
          <div
            key={t.tradeId}
            className={`flex justify-between py-0.5 ${
              t.takerSide === 'yes' ? 'text-green-400' : 'text-red-400'
            } ${highVolume ? 'rounded bg-amber-500/15 px-1 ring-1 ring-amber-500/40' : ''}`}
          >
            <span>{fmtTime(t.ts)}</span>
            <span>{(t.takerSide === 'yes' ? t.yesPrice : t.noPrice).toFixed(2)}</span>
            <span>{t.count}</span>
            <span title={t.takerSide === 'yes' ? 'Taker YES' : 'Taker NO'}>{fmtUsd(t.notional)}</span>
          </div>
          )
        })}
        {trades.length === 0 && (
          <div className="py-4 text-center text-kalshi-textSecondary">No trades yet</div>
        )}
      </div>
    </div>
  )
}
