import type { MarketSnapshot } from '@/api/market'

interface Props {
  metrics: MarketSnapshot['rollingMetrics'] | null
  subtitle?: string
}

function fmtVol(n: number) {
  if (!Number.isFinite(n)) return '0'
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n))
}

/** Notional $ — keep cents visible for small flow so YES+NO reconciles with total. */
function fmtDollars(n: number) {
  if (!Number.isFinite(n) || n < 0) return '$0.00'
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  if (n < 100) return `$${n.toFixed(2)}`
  return `$${n.toFixed(0)}`
}

function splitMatchesTotal(
  y: { volume: number; notional: number },
  n: { volume: number; notional: number },
  total: { volume: number; notional: number },
): boolean {
  const dv = Math.abs(y.volume + n.volume - total.volume)
  const dn = Math.abs(y.notional + n.notional - total.notional)
  return dv < 1e-6 && dn < 1e-4
}

function fmtSignedDollarsValue(n: number) {
  if (!Number.isFinite(n)) return '$0.00'
  const sign = n >= 0 ? '+' : '-'
  return sign + fmtDollars(Math.abs(n))
}

/** Signed net rate (YES − NO) per second for contracts or $. */
function fmtSignedNetRate(r: number, kind: 'ct' | '$'): string {
  if (!Number.isFinite(r)) return kind === 'ct' ? '0 ct/s' : '$0/s'
  const sign = r >= 0 ? '+' : '-'
  const a = Math.abs(r)
  if (kind === 'ct') {
    const s = a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(2)
    return `${sign}${s} ct/s`
  }
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M/s`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K/s`
  if (a < 100) return `${sign}$${a.toFixed(2)}/s`
  return `${sign}$${a.toFixed(0)}/s`
}

function NetVelocityBlock({
  net,
  windowSec,
}: {
  net: { volume: number; notional: number }
  windowSec: number
}) {
  const netV = net.volume
  const netN = net.notional
  const cps = netV / windowSec
  const dps = netN / windowSec
  const toward = netV > 0 ? 'YES' : netV < 0 ? 'NO' : 'flat'
  const dirColor =
    netV > 0 ? 'text-emerald-400' : netV < 0 ? 'text-rose-400' : 'text-kalshi-textSecondary'
  return (
    <div
      className="mt-1 rounded-md border border-kalshi-accent/35 bg-kalshi-accent/[0.06] px-2 py-1.5"
      title="Net taker flow = YES − NO in this window. Velocity = net ÷ window length."
    >
      <div className="mb-0.5 text-[9px] font-medium uppercase tracking-wide text-kalshi-textSecondary">
        Net velocity (YES − NO)
      </div>
      <div className={`text-[11px] font-semibold ${dirColor}`}>→ {toward}</div>
      <div className="mt-0.5 text-[10px] tabular-nums leading-tight text-kalshi-text">
        {fmtSignedNetRate(cps, 'ct')}
        <span className="text-kalshi-textSecondary"> · </span>
        {fmtSignedNetRate(dps, '$')}
      </div>
      <div className="mt-0.5 text-[9px] tabular-nums text-kalshi-textSecondary/90">
        Window net: {netV >= 0 ? '+' : '-'}
        {fmtVol(Math.abs(netV))} ct · {fmtSignedDollarsValue(netN)}
      </div>
    </div>
  )
}

export function RollingMetricsPanel({ metrics, subtitle }: Props) {
  if (!metrics) {
    return (
      <div className="rounded-lg border border-kalshi-border bg-kalshi-row p-3">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-kalshi-textSecondary">
          Rolling metrics
          {subtitle && (
            <span className="mt-0.5 block font-normal normal-case text-kalshi-text">{subtitle}</span>
          )}
        </h3>
        <p className="text-[11px] text-kalshi-textSecondary">No data yet</p>
      </div>
    )
  }

  const { window2s, window10s } = metrics
  const y2 = window2s.yes ?? { volume: 0, notional: 0 }
  const n2 = window2s.no ?? { volume: 0, notional: 0 }
  const net2 = window2s.net ?? {
    volume: y2.volume - n2.volume,
    notional: y2.notional - n2.notional,
  }
  const y10 = window10s.yes ?? { volume: 0, notional: 0 }
  const n10 = window10s.no ?? { volume: 0, notional: 0 }
  const net10 = window10s.net ?? {
    volume: y10.volume - n10.volume,
    notional: y10.notional - n10.notional,
  }

  return (
    <div className="rounded-lg border border-kalshi-border bg-kalshi-row p-3">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-kalshi-textSecondary">
        Rolling metrics
        {subtitle && (
          <span className="mt-0.5 block font-normal normal-case text-kalshi-text">{subtitle}</span>
        )}
      </h3>
      <div className="grid grid-cols-2 gap-4 font-mono text-sm">
        <div>
          <div className="mb-1 text-xs text-kalshi-textSecondary">2s</div>
          <div className="space-y-1 text-kalshi-text">
            <div className="text-[10px] text-kalshi-textSecondary" title="Taker-side: YES leg + NO leg must equal total">
              Taker flow (YES + NO = total)
            </div>
            <div>Vol: {fmtVol(window2s.volume)}</div>
            <div>Notional: {fmtDollars(window2s.notional)}</div>
            <div>{window2s.tradesPerSecond.toFixed(1)} trades/s</div>
            <NetVelocityBlock net={net2} windowSec={2} />
            <div className="border-t border-kalshi-border/50 pt-1 text-[11px] leading-snug">
              <span className="text-emerald-400/90">YES</span> {fmtDollars(y2.notional)}{' '}
              <span className="text-kalshi-textSecondary">·</span> {fmtVol(y2.volume)} ct
            </div>
            <div className="text-[11px] leading-snug">
              <span className="text-rose-400/90">NO</span> {fmtDollars(n2.notional)}{' '}
              <span className="text-kalshi-textSecondary">·</span> {fmtVol(n2.volume)} ct
            </div>
            <div className="text-[9px] tabular-nums text-kalshi-textSecondary/90">
              Σ {fmtDollars(y2.notional + n2.notional)} · {fmtVol(y2.volume + n2.volume)} ct
              {splitMatchesTotal(y2, n2, window2s) ? (
                <span className="text-emerald-500/80"> · ok</span>
              ) : (
                <span className="text-amber-400" title="YES+NO should match total — check rolling bucket logic">
                  {' '}
                  (≠ total)
                </span>
              )}
            </div>
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs text-kalshi-textSecondary">10s</div>
          <div className="space-y-1 text-kalshi-text">
            <div className="text-[10px] text-kalshi-textSecondary" title="Taker-side: YES leg + NO leg must equal total">
              Taker flow (YES + NO = total)
            </div>
            <div>Vol: {fmtVol(window10s.volume)}</div>
            <div>Notional: {fmtDollars(window10s.notional)}</div>
            <div>{window10s.tradesPerSecond.toFixed(1)} trades/s</div>
            <NetVelocityBlock net={net10} windowSec={10} />
            <div className="border-t border-kalshi-border/50 pt-1 text-[11px] leading-snug">
              <span className="text-emerald-400/90">YES</span> {fmtDollars(y10.notional)}{' '}
              <span className="text-kalshi-textSecondary">·</span> {fmtVol(y10.volume)} ct
            </div>
            <div className="text-[11px] leading-snug">
              <span className="text-rose-400/90">NO</span> {fmtDollars(n10.notional)}{' '}
              <span className="text-kalshi-textSecondary">·</span> {fmtVol(n10.volume)} ct
            </div>
            <div className="text-[9px] tabular-nums text-kalshi-textSecondary/90">
              Σ {fmtDollars(y10.notional + n10.notional)} · {fmtVol(y10.volume + n10.volume)} ct
              {splitMatchesTotal(y10, n10, window10s) ? (
                <span className="text-emerald-500/80"> · ok</span>
              ) : (
                <span className="text-amber-400" title="YES+NO should match total — check rolling bucket logic">
                  {' '}
                  (≠ total)
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
