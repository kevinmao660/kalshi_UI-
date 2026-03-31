/**
 * Trading Page — Four columns: team1 metrics+trades | OB team1 | OB team2 | team2 metrics+trades
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchAllMarketsForEvent, fetchMarketByTicker, yesOutcomeLabel } from '@/api/kalshi'
import {
  averageCostPerContractUsd,
  fetchPortfolioPositions,
  formatAvgCostPerContract,
  formatNetLeftTeamExposure,
  formatYesNoPositionLine,
} from '@/api/portfolio'
import type { KalshiMarket } from '@/types/market'
import { useMarketStream } from '@/hooks/useMarketStream'
import { OrderbookPanel } from '@/components/OrderbookPanel'
import { TradesFeedPanel } from '@/components/TradesFeedPanel'
import { RollingMetricsPanel } from '@/components/RollingMetricsPanel'

export function TradingPage() {
  const { ticker: tickerParam } = useParams<{ ticker: string }>()
  const ticker = tickerParam ? decodeURIComponent(tickerParam) : ''

  const [eventMarkets, setEventMarkets] = useState<KalshiMarket[]>([])
  const [metaLoading, setMetaLoading] = useState(true)
  const [positionByTicker, setPositionByTicker] = useState<Record<string, number>>({})
  const [exposureByTicker, setExposureByTicker] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!ticker) return
    let cancelled = false
    ;(async () => {
      setMetaLoading(true)
      const m = await fetchMarketByTicker(ticker)
      if (cancelled) return
      if (!m?.event_ticker) {
        setEventMarkets(m ? [m] : [])
        setMetaLoading(false)
        return
      }
      const list = await fetchAllMarketsForEvent(m.event_ticker)
      if (cancelled) return
      const sorted = [...list].sort((a, b) =>
        yesOutcomeLabel(a).localeCompare(yesOutcomeLabel(b), undefined, { sensitivity: 'base' })
      )
      if (sorted.length === 0) setEventMarkets([m])
      else {
        const has = sorted.some((x) => x.ticker === ticker)
        setEventMarkets(has ? sorted : [...sorted, m])
      }
      setMetaLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [ticker])

  const team1 = eventMarkets[0]
  const team2 = eventMarkets[1]
  const hasPair = team1 && team2

  const ticker1 = team1?.ticker ?? ''
  const ticker2 = hasPair ? team2.ticker : ''

  const stream1 = useMarketStream(ticker1)
  const stream2 = useMarketStream(ticker2)

  const label1 = team1 ? yesOutcomeLabel(team1) : ''
  const label2 = team2 ? yesOutcomeLabel(team2) : ''

  const yesNoFor = (m: KalshiMarket | undefined, other: KalshiMarket | undefined) => {
    if (!m) return { yes: undefined as string | undefined, no: undefined as string | undefined }
    const y = yesOutcomeLabel(m)
    if (other) return { yes: y, no: yesOutcomeLabel(other) }
    return { yes: y, no: undefined }
  }

  const ob1 = yesNoFor(team1, team2)
  const ob2 = yesNoFor(team2, team1)

  const loading =
    metaLoading || (ticker1 && stream1.loading) || (hasPair && stream2.loading && !!ticker2)
  const error = stream1.error || stream2.error
  const stale = stream1.stale || stream2.stale

  const eventTitle = useMemo(() => {
    if (team1?.title && team2?.title && team1.title === team2.title) return team1.title
    return team1?.title ?? team2?.title ?? ''
  }, [team1, team2])

  /** Net for the team on the left: fp(left market) − fp(right). Single market: that market’s fp. */
  const leftTeamNetContracts = useMemo(() => {
    const p1 = positionByTicker[ticker1]
    const v1 = typeof p1 === 'number' && Number.isFinite(p1) ? p1 : 0
    if (!hasPair) return v1
    const p2 = positionByTicker[ticker2]
    const v2 = typeof p2 === 'number' && Number.isFinite(p2) ? p2 : 0
    return v1 - v2
  }, [hasPair, positionByTicker, ticker1, ticker2])

  const loadPortfolio = useCallback(async () => {
    if (!ticker1) return
    try {
      const data = team1?.event_ticker
        ? await fetchPortfolioPositions({ event_ticker: team1.event_ticker })
        : await fetchPortfolioPositions({ ticker: ticker1 })
      const map: Record<string, number> = {}
      const exp: Record<string, number> = {}
      for (const mp of data.market_positions ?? []) {
        if (!mp.ticker) continue
        const n = parseFloat(mp.position_fp || '0')
        map[mp.ticker] = Number.isFinite(n) ? n : 0
        const ex = parseFloat(mp.market_exposure_dollars ?? '0')
        exp[mp.ticker] = Number.isFinite(ex) ? ex : 0
      }
      setPositionByTicker(map)
      setExposureByTicker(exp)
    } catch {
      /* no keys / network */
    }
  }, [team1?.event_ticker, ticker1])

  const portfolioHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onPortfolioRefreshHint = useCallback(() => {
    if (portfolioHintTimerRef.current) clearTimeout(portfolioHintTimerRef.current)
    portfolioHintTimerRef.current = setTimeout(() => {
      portfolioHintTimerRef.current = null
      void loadPortfolio()
    }, 250)
  }, [loadPortfolio])

  useEffect(() => {
    if (!ticker1) return
    void loadPortfolio()
    const id = setInterval(() => void loadPortfolio(), 2500)
    return () => clearInterval(id)
  }, [ticker1, loadPortfolio])

  if (!ticker) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-kalshi-bg">
        <p className="text-kalshi-text">Invalid market</p>
        <Link to="/" className="ml-4 text-kalshi-accent hover:underline">
          Back to Screener
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col bg-kalshi-bg">
      <header className="shrink-0 border-b border-kalshi-border bg-kalshi-row px-4 py-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
          <div className="flex flex-wrap items-center gap-3 justify-self-start">
            <Link to="/" className="shrink-0 text-sm text-kalshi-accent hover:underline">
              ← Back
            </Link>
            {stale && (
              <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-400">
                Stale
              </span>
            )}
          </div>
          {eventMarkets.length > 0 && (
            <div
              className="flex max-w-[min(100%,22rem)] flex-col items-center justify-center gap-0.5 justify-self-center rounded-xl border border-kalshi-accent/25 bg-kalshi-bg px-4 py-2 text-center"
              title={
                hasPair
                  ? `Net vs left column: position_fp(${label1}) − position_fp(${label2}). Avg cost = market_exposure_dollars / |contracts| per market.`
                  : `Contracts: Kalshi position_fp (+ = YES, − = NO). Avg cost from market_exposure_dollars.`
              }
            >
              <span className="text-[9px] font-medium uppercase tracking-widest text-kalshi-textSecondary">
                {hasPair ? `Net vs ${label1 || 'left'}` : 'Contracts'}
              </span>
              <span className="text-3xl font-bold tabular-nums leading-tight text-kalshi-text">
                {formatNetLeftTeamExposure(leftTeamNetContracts)}
              </span>
              <div className="mt-0.5 flex w-full min-w-0 flex-col gap-0.5 font-mono text-[10px] leading-tight tabular-nums text-kalshi-textSecondary">
                <div className="min-w-0">
                  <p
                    className="truncate"
                    title={
                      positionByTicker[ticker1] === undefined
                        ? label1
                        : `${label1}: ${formatYesNoPositionLine(positionByTicker[ticker1]!)}`
                    }
                  >
                    <span className="text-kalshi-textSecondary/90">{label1 || 'Market'}: </span>
                    <span className="text-kalshi-text">
                      {positionByTicker[ticker1] === undefined
                        ? '…'
                        : formatYesNoPositionLine(positionByTicker[ticker1]!)}
                    </span>
                  </p>
                  <p className="text-[9px] text-kalshi-textSecondary/90">
                    Avg{' '}
                    {formatAvgCostPerContract(
                      averageCostPerContractUsd(positionByTicker[ticker1], exposureByTicker[ticker1]),
                    )}
                  </p>
                </div>
                {hasPair && (
                  <div className="min-w-0">
                    <p
                      className="truncate"
                      title={
                        positionByTicker[ticker2] === undefined
                          ? label2
                          : `${label2}: ${formatYesNoPositionLine(positionByTicker[ticker2]!)}`
                      }
                    >
                      <span className="text-kalshi-textSecondary/90">{label2}: </span>
                      <span className="text-kalshi-text">
                        {positionByTicker[ticker2] === undefined
                          ? '…'
                          : formatYesNoPositionLine(positionByTicker[ticker2]!)}
                      </span>
                    </p>
                    <p className="text-[9px] text-kalshi-textSecondary/90">
                      Avg{' '}
                      {formatAvgCostPerContract(
                        averageCostPerContractUsd(positionByTicker[ticker2], exposureByTicker[ticker2]),
                      )}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="min-w-0 justify-self-end text-right">
            {eventTitle && (
              <p className="truncate text-xs text-kalshi-text" title={eventTitle}>
                {eventTitle}
              </p>
            )}
            <p className="truncate font-mono text-[10px] text-kalshi-textSecondary" title={ticker}>
              {hasPair ? `${label1} · ${label2}` : ticker}
            </p>
          </div>
        </div>
      </header>

      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-kalshi-accent border-t-transparent" />
        </div>
      )}
      {error && (
        <div className="m-4 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-hidden">
          <div className="grid min-h-0 min-w-[1080px] flex-1 grid-cols-4 grid-rows-[minmax(0,1fr)] gap-2 px-2 pb-2 pt-2">
            {/* 1 — Team 1: metrics + trades */}
            <section className="flex h-full min-h-0 min-w-0 flex-col gap-2">
              <div className="shrink-0">
                <RollingMetricsPanel metrics={stream1.metrics} subtitle={label1 || undefined} />
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <TradesFeedPanel
                  trades={stream1.trades}
                  fillHeight
                  subtitle={label1 || undefined}
                />
              </div>
            </section>

            {/* 2 — Orderbook team 1 */}
            <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
              {team1 ? (
                <OrderbookPanel
                  ticker={ticker1}
                  eventTicker={team1.event_ticker}
                  positionFp={positionByTicker[ticker1]}
                  marketExposureDollars={exposureByTicker[ticker1]}
                  yes={stream1.orderbook.yes}
                  no={stream1.orderbook.no}
                  bestBid={stream1.bbo.bestBid}
                  bestAsk={stream1.bbo.bestAsk}
                  yesOutcomeLabel={ob1.yes}
                  noOutcomeLabel={ob1.no}
                  onPortfolioRefreshHint={onPortfolioRefreshHint}
                />
              ) : (
                <div className="rounded-lg border border-kalshi-border p-4 text-xs text-kalshi-textSecondary">
                  No market data
                </div>
              )}
            </section>

            {/* 3 — Orderbook team 2 */}
            <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
              {hasPair ? (
                <OrderbookPanel
                  ticker={ticker2}
                  eventTicker={team2.event_ticker ?? team1.event_ticker}
                  positionFp={positionByTicker[ticker2]}
                  marketExposureDollars={exposureByTicker[ticker2]}
                  yes={stream2.orderbook.yes}
                  no={stream2.orderbook.no}
                  bestBid={stream2.bbo.bestBid}
                  bestAsk={stream2.bbo.bestAsk}
                  yesOutcomeLabel={ob2.yes}
                  noOutcomeLabel={ob2.no}
                  onPortfolioRefreshHint={onPortfolioRefreshHint}
                />
              ) : (
                <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-kalshi-border p-4 text-center text-xs text-kalshi-textSecondary">
                  No second outcome market in this event — only one contract is listed.
                </div>
              )}
            </section>

            {/* 4 — Team 2: metrics + trades */}
            <section className="flex h-full min-h-0 min-w-0 flex-col gap-2">
              <div className="shrink-0">
                <RollingMetricsPanel
                  metrics={hasPair ? stream2.metrics : null}
                  subtitle={label2 || undefined}
                />
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {hasPair ? (
                  <TradesFeedPanel
                    trades={stream2.trades}
                    fillHeight
                    subtitle={label2 || undefined}
                  />
                ) : (
                  <div className="rounded-lg border border-kalshi-border bg-kalshi-row p-4 text-xs text-kalshi-textSecondary">
                    No second market stream
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
