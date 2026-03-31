import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PriceLevel } from '@/api/market'
import {
  averageCostPerContractUsd,
  formatAvgCostPerContract,
  formatYesNoPositionLine,
} from '@/api/portfolio'
import {
  type BookOrderRow,
  type PortfolioOrder,
  QUEUE_POLL_INTERVAL_MS,
  cancelOrder,
  createOrder,
  fetchQueuePositionsForMarket,
  fetchRestingOrders,
  fetchRestingOrdersForMarket,
  mapPortfolioOrderToBookRow,
  resolveQueuePositionsForOrders,
  subscribeQueuePositions,
  subscribeRestingOrders,
} from '@/api/orders'

/** YES price rows, high → low (99¢ … 1¢). */
const PRICE_ROWS = Array.from({ length: 99 }, (_, i) => 99 - i)

/** Drop optimistic ladder rows if they never show as resting within this window (instant fill / cancel). */
const OPTIMISTIC_RESTING_GRACE_MS = 10_000

function priceToCents(raw: number | string): number | null {
  if (typeof raw === 'string') {
    const f = parseFloat(raw)
    if (!Number.isFinite(f)) return null
    const p = raw.includes('.') || (f > 0 && f < 1) ? Math.round(f * 100) : Math.round(f)
    if (p >= 1 && p <= 99) return p
    return null
  }
  if (!Number.isFinite(raw)) return null
  const p = raw > 0 && raw < 1 ? Math.round(raw * 100) : Math.round(raw)
  if (p >= 1 && p <= 99) return p
  return null
}

function buildSizeMap(levels: PriceLevel[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const [price, size] of levels) {
    const p = priceToCents(typeof price === 'number' ? price : String(price))
    if (p == null) continue
    const s = typeof size === 'number' ? size : Math.round(Number(size))
    if (s > 0) m.set(p, s)
  }
  return m
}

function fmtCents(cents: number) {
  return (cents / 100).toFixed(2)
}

function fmtQueue(q: number | null | undefined) {
  return q === null || q === undefined ? '…' : String(q)
}

interface Props {
  ticker: string
  /** When set, orders and queue use GET …?event_ticker=… then filter to this market (Python flow). */
  eventTicker?: string
  yes: PriceLevel[]
  no: PriceLevel[]
  bestBid: number | null
  bestAsk: number | null
  /** Shown on bid / ask headers (which team/outcome each side is for). */
  yesOutcomeLabel?: string
  noOutcomeLabel?: string
  /** Net contracts from GET /portfolio/positions (positive = YES, negative = NO). */
  positionFp?: number
  /** Kalshi `market_exposure_dollars` for this ticker (for avg cost). */
  marketExposureDollars?: number
  /** Server signals portfolio refetch after fills / order updates (via resting_orders WS). */
  onPortfolioRefreshHint?: () => void
}

export function OrderbookPanel({
  ticker,
  eventTicker,
  yes,
  no,
  bestBid,
  bestAsk,
  yesOutcomeLabel,
  noOutcomeLabel,
  positionFp,
  marketExposureDollars,
  onPortfolioRefreshHint,
}: Props) {
  const [quickSize, setQuickSize] = useState('1')
  const [pending, setPending] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [placedOrders, setPlacedOrders] = useState<BookOrderRow[]>([])
  const placedOrdersRef = useRef(placedOrders)
  placedOrdersRef.current = placedOrders
  /** Rows we added locally before GET/WS shows them; server snapshot is authoritative for everything else. */
  const optimisticRowsRef = useRef<BookOrderRow[]>([])
  /** When we placed each optimistic order (ms) — drop optimistic rows not confirmed as resting after grace (e.g. instant fill). */
  const optimisticPlacedAtRef = useRef<Record<string, number>>({})
  const restingReconcileTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const [queueByOrderId, setQueueByOrderId] = useState<Record<string, number | null>>({})
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null)
  const [queueWsConnected, setQueueWsConnected] = useState(false)
  const [restingWsConnected, setRestingWsConnected] = useState(false)

  const yesMap = useMemo(() => buildSizeMap(yes), [yes])
  const noMap = useMemo(() => buildSizeMap(no), [no])

  const count = useMemo(() => {
    const n = parseInt(quickSize, 10)
    return Number.isFinite(n) && n >= 1 ? n : 1
  }, [quickSize])

  const avgCostUsd = useMemo(
    () => averageCostPerContractUsd(positionFp, marketExposureDollars),
    [positionFp, marketExposureDollars],
  )

  const { maxBuy, maxSell } = useMemo(() => {
    let mb = 0
    let ms = 0
    for (const c of PRICE_ROWS) {
      mb = Math.max(mb, yesMap.get(c) ?? 0)
      const comp = 100 - c
      if (comp >= 1 && comp <= 99) ms = Math.max(ms, noMap.get(comp) ?? 0)
    }
    return { maxBuy: mb || 1, maxSell: ms || 1 }
  }, [yesMap, noMap])

  const mergeFromRestingSnapshot = useCallback((fromApi: BookOrderRow[]) => {
    const apiIds = new Set(fromApi.map((r) => r.orderId))
    const now = Date.now()
    optimisticRowsRef.current = optimisticRowsRef.current.filter((r) => {
      if (apiIds.has(r.orderId)) {
        delete optimisticPlacedAtRef.current[r.orderId]
        return false
      }
      const t = optimisticPlacedAtRef.current[r.orderId]
      if (t != null && now - t < OPTIMISTIC_RESTING_GRACE_MS) return true
      delete optimisticPlacedAtRef.current[r.orderId]
      return false
    })
    setPlacedOrders([...fromApi, ...optimisticRowsRef.current])
  }, [])

  const fetchRestingRowsAndMerge = useCallback(async () => {
    if (!ticker) return
    try {
      let orders: PortfolioOrder[]
      if (eventTicker) {
        orders = (await fetchRestingOrdersForMarket(eventTicker, ticker)).orders
      } else {
        orders = (await fetchRestingOrders(ticker)).orders
      }
      const fromApi = orders
        .map(mapPortfolioOrderToBookRow)
        .filter((r): r is NonNullable<typeof r> => r != null)
      mergeFromRestingSnapshot(fromApi)
    } catch {
      /* keys / network */
    }
  }, [ticker, eventTicker, mergeFromRestingSnapshot])

  const place = useCallback(
    async (side: 'yes' | 'no', action: 'buy' | 'sell', priceCents: number) => {
      const key = `${side}-${action}-${priceCents}`
      setPending(key)
      setToast(null)
      try {
        const res = await createOrder({
          ticker,
          side,
          action,
          count,
          yes_price: side === 'yes' ? priceCents : undefined,
          no_price: side === 'no' ? priceCents : undefined,
          time_in_force: 'good_till_canceled',
        })
        const oid = res.order?.order_id != null ? String(res.order.order_id) : ''
        const o = res.order
        const remaining =
          o && 'remaining_count' in o
            ? typeof o.remaining_count === 'number'
              ? o.remaining_count
              : parseFloat(String(o.remaining_count ?? ''))
            : NaN
        const fullyFilledOrGone =
          o?.status === 'executed' ||
          (Number.isFinite(remaining) && remaining <= 0)
        if (oid && !fullyFilledOrGone) {
          const row: BookOrderRow = {
            orderId: oid,
            priceCents,
            action: action === 'buy' ? 'buy' : 'sell',
            side,
          }
          optimisticPlacedAtRef.current[oid] = Date.now()
          optimisticRowsRef.current = [...optimisticRowsRef.current, row]
          setPlacedOrders((prev) => {
            const optimisticIds = new Set(optimisticRowsRef.current.map((o) => o.orderId))
            const fromApi = prev.filter((r) => !optimisticIds.has(r.orderId))
            return [...fromApi, ...optimisticRowsRef.current]
          })
          const tid = window.setTimeout(() => {
            restingReconcileTimeoutsRef.current = restingReconcileTimeoutsRef.current.filter((x) => x !== tid)
            void fetchRestingRowsAndMerge()
          }, OPTIMISTIC_RESTING_GRACE_MS + 200)
          restingReconcileTimeoutsRef.current.push(tid)
          void resolveQueuePositionsForOrders(ticker, [oid], eventTicker)
            .then((qp) => {
              setQueueByOrderId((prev) => ({ ...prev, ...qp }))
            })
            .catch(() => {
              delete optimisticPlacedAtRef.current[oid]
              optimisticRowsRef.current = optimisticRowsRef.current.filter((r) => r.orderId !== oid)
              setPlacedOrders((prev) => prev.filter((p) => p.orderId !== oid))
            })
        }
        if (oid && fullyFilledOrGone) {
          void fetchRestingRowsAndMerge()
        }
        setToast({
          kind: 'ok',
          text:
            res.order?.order_id != null
              ? `Order ${String(res.order.order_id).slice(0, 8)}… @ ${fmtCents(priceCents)}`
              : `Placed @ ${fmtCents(priceCents)}`,
        })
      } catch (e) {
        setToast({
          kind: 'err',
          text: e instanceof Error ? e.message : 'Order failed',
        })
      } finally {
        setPending(null)
      }
    },
    [ticker, count, eventTicker, fetchRestingRowsAndMerge]
  )

  useEffect(() => {
    optimisticRowsRef.current = []
    optimisticPlacedAtRef.current = {}
    for (const t of restingReconcileTimeoutsRef.current) clearTimeout(t)
    restingReconcileTimeoutsRef.current = []
  }, [ticker])

  useEffect(() => {
    if (!ticker) return
    let cancelled = false
    ;(async () => {
      try {
        let orders: PortfolioOrder[]
        let qp: Record<string, number> = {}

        if (eventTicker) {
          const [ordersRes, qpRes] = await Promise.all([
            fetchRestingOrdersForMarket(eventTicker, ticker),
            fetchQueuePositionsForMarket(ticker, eventTicker).catch(() => ({} as Record<string, number>)),
          ])
          if (cancelled) return
          orders = ordersRes.orders
          qp = qpRes
        } else {
          const res = await fetchRestingOrders(ticker)
          if (cancelled) return
          orders = res.orders
        }

        const fromApi = orders
          .map(mapPortfolioOrderToBookRow)
          .filter((r): r is NonNullable<typeof r> => r != null)
        if (cancelled) return
        mergeFromRestingSnapshot(fromApi)
        const merged = [...fromApi, ...optimisticRowsRef.current]

        if (!eventTicker) {
          try {
            qp = await resolveQueuePositionsForOrders(ticker, merged.map((r) => r.orderId))
          } catch {
            // queue chips show … until WS
          }
        }

        if (cancelled) return
        const ids = merged.map((r) => r.orderId)
        setQueueByOrderId((prev) => {
          const next: Record<string, number | null> = {}
          for (const id of ids) {
            if (id in qp) next[id] = qp[id]!
            else if (prev[id] !== undefined) next[id] = prev[id] ?? null
          }
          return next
        })
      } catch {
        // Missing API keys or network — keep UI-driven rows only; resting WS may still populate
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ticker, eventTicker, mergeFromRestingSnapshot])

  const mergeQueueMap = useCallback((qp: Record<string, number>) => {
    setQueueByOrderId((prev) => {
      const orderIds = new Set(placedOrdersRef.current.map((r) => r.orderId))
      const next: Record<string, number | null> = {}
      for (const [id, q] of Object.entries(qp)) {
        if (orderIds.has(id)) next[id] = q
      }
      for (const r of placedOrdersRef.current) {
        if (next[r.orderId] === undefined) {
          next[r.orderId] = prev[r.orderId] ?? null
        }
      }
      return next
    })
  }, [])

  /** Drop queue / cancel UI for order ids that are no longer on the ladder (filled, cancelled, etc.). */
  useEffect(() => {
    const ids = new Set(placedOrders.map((r) => r.orderId))
    setQueueByOrderId((prev) => {
      const next: Record<string, number | null> = {}
      for (const [id, q] of Object.entries(prev)) {
        if (ids.has(id)) next[id] = q
      }
      return next
    })
  }, [placedOrders])

  useEffect(() => {
    if (!ticker) return
    return subscribeQueuePositions(ticker, mergeQueueMap, eventTicker, setQueueWsConnected)
  }, [ticker, eventTicker, mergeQueueMap])

  const applyRestingOrdersFromApi = useCallback(
    (orders: PortfolioOrder[]) => {
      const fromApi = orders
        .map(mapPortfolioOrderToBookRow)
        .filter((r): r is NonNullable<typeof r> => r != null)
      mergeFromRestingSnapshot(fromApi)
    },
    [mergeFromRestingSnapshot],
  )

  useEffect(() => {
    if (!ticker) return
    return subscribeRestingOrders(
      ticker,
      applyRestingOrdersFromApi,
      eventTicker,
      setRestingWsConnected,
      onPortfolioRefreshHint,
    )
  }, [ticker, eventTicker, applyRestingOrdersFromApi, onPortfolioRefreshHint])

  /** REST poll: queue moves when others trade — Kalshi user_orders WS only signals your orders. */
  useEffect(() => {
    if (!ticker) return
    const run = () => {
      void fetchQueuePositionsForMarket(ticker, eventTicker)
        .then(mergeQueueMap)
        .catch(() => {
          /* keys / network */
        })
    }
    void run()
    const id = setInterval(run, QUEUE_POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [ticker, eventTicker, mergeQueueMap])

  const handleCancel = useCallback(async (orderId: string) => {
    setCancellingOrderId(orderId)
    try {
      await cancelOrder(orderId)
      delete optimisticPlacedAtRef.current[orderId]
      optimisticRowsRef.current = optimisticRowsRef.current.filter((r) => r.orderId !== orderId)
      setPlacedOrders((prev) => prev.filter((p) => p.orderId !== orderId))
      setQueueByOrderId((prev) => {
        const next = { ...prev }
        delete next[orderId]
        return next
      })
      setToast({ kind: 'ok', text: 'Order cancelled' })
    } catch (e) {
      setToast({
        kind: 'err',
        text: e instanceof Error ? e.message : 'Cancel failed',
      })
    } finally {
      setCancellingOrderId(null)
    }
  }, [])

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col rounded-lg border border-kalshi-border/70 bg-kalshi-bg">
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-kalshi-border/60 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-kalshi-textSecondary">
            Order book
          </h2>
          <label className="flex items-center gap-1.5 text-[11px] text-kalshi-textSecondary">
            <span>Qty</span>
            <input
              type="number"
              min={1}
              value={quickSize}
              onChange={(e) => setQuickSize(e.target.value)}
              className="w-14 rounded border border-kalshi-border/80 bg-kalshi-row px-2 py-0.5 font-mono text-xs text-kalshi-text"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] leading-tight">
          <div className="min-w-0 text-kalshi-text">
            <p>
              <span className="text-kalshi-textSecondary">Position: </span>
              {positionFp === undefined ? '…' : formatYesNoPositionLine(positionFp)}
            </p>
            <p className="text-kalshi-textSecondary">
              <span>Avg cost: </span>
              {formatAvgCostPerContract(avgCostUsd)}
            </p>
          </div>
          <p
            className="text-kalshi-textSecondary"
            title="Resting orders: GET /portfolio/orders + Kalshi user_orders WS. Queue: GET /queue_positions + WS refresh; REST polls for others’ impact on the queue."
          >
            Orders: {restingWsConnected ? 'WS' : 'WS off'} · Queue: {queueWsConnected ? 'WS' : 'WS off'}{' '}
            · REST {QUEUE_POLL_INTERVAL_MS / 1000}s
          </p>
        </div>
      </div>

      {toast && (
        <div
          className={`shrink-0 border-b border-kalshi-border/40 px-3 py-1 text-[11px] ${
            toast.kind === 'ok' ? 'text-emerald-400/90' : 'text-red-400/90'
          }`}
        >
          {toast.text}
        </div>
      )}

      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] border-b border-kalshi-border/60 bg-kalshi-row/40 text-[10px] font-medium uppercase tracking-wider text-kalshi-textSecondary">
        <div
          className="min-w-0 py-1.5 pl-2 text-left leading-tight"
          title={yesOutcomeLabel ? `YES · ${yesOutcomeLabel}` : undefined}
        >
          <span className="block text-[9px] text-kalshi-textSecondary/80">YES</span>
          <span className="line-clamp-2 font-normal normal-case text-kalshi-text">
            {yesOutcomeLabel ?? 'Bid'}
          </span>
        </div>
        <div className="border-x border-kalshi-border/50 px-2 py-1.5 text-center leading-tight">
          BUY · $ · SELL
        </div>
        <div
          className="min-w-0 py-1.5 pr-2 text-right leading-tight"
          title={noOutcomeLabel ? `NO · ${noOutcomeLabel}` : undefined}
        >
          <span className="block text-[9px] text-kalshi-textSecondary/80">NO</span>
          <span className="line-clamp-2 font-normal normal-case text-kalshi-text">
            {noOutcomeLabel ?? 'Ask'}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {PRICE_ROWS.map((cents) => {
          const buySize = yesMap.get(cents) ?? 0
          const complement = 100 - cents
          const sellSize =
            complement >= 1 && complement <= 99 ? (noMap.get(complement) ?? 0) : 0

          const buyPct = maxBuy > 0 ? (buySize / maxBuy) * 100 : 0
          const sellPct = maxSell > 0 ? (sellSize / maxSell) * 100 : 0

          const isBestYes = bestBid != null && cents === bestBid
          const isBestNoSide =
            bestAsk != null && complement >= 1 && complement <= 99 && complement === bestAsk

          const busyBuy = pending === `yes-buy-${cents}`
          const busySellYes = pending === `yes-sell-${cents}`

          const myOrdersAtPrice = placedOrders.filter((o) => o.priceCents === cents)
          const buySideOrders = myOrdersAtPrice.filter(
            (o) => o.side === 'yes' && o.action === 'buy',
          )
          const sellSideOrders = myOrdersAtPrice.filter(
            (o) => !(o.side === 'yes' && o.action === 'buy'),
          )

          return (
            <div
              key={cents}
              data-ladder-price={cents}
              className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] border-b border-white/[0.04] font-mono text-[11px] tabular-nums ${
                isBestYes || isBestNoSide ? 'bg-kalshi-accent/[0.06]' : ''
              }`}
            >
              <div className="relative flex min-h-[24px] min-w-0 items-center justify-end py-px pl-2 pr-1">
                <div className="relative flex min-h-[24px] min-w-0 flex-1 items-center justify-end">
                  <div
                    className="pointer-events-none absolute inset-y-0 right-0 bg-emerald-500/15"
                    style={{ width: `${buyPct}%` }}
                  />
                  <span className="relative z-[1] shrink-0 text-kalshi-text/90">
                    {buySize > 0 ? buySize.toLocaleString() : '—'}
                  </span>
                </div>
              </div>

              {/* Buy-side orders: queue + cancel left of price; sell-side (YES sell + NO): right of price */}
              <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 border-x border-kalshi-border/40 px-1.5 py-0.5">
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                  {buySideOrders.map((o) => (
                    <div key={o.orderId} className="flex items-center gap-1.5">
                      <span
                        title="Contracts ahead of your order in queue"
                        className="min-w-[1.75rem] rounded border border-kalshi-accent/50 bg-kalshi-accent/10 px-2 py-1 text-center text-sm font-semibold tabular-nums text-kalshi-accent"
                      >
                        {fmtQueue(queueByOrderId[o.orderId])}
                      </span>
                      <button
                        type="button"
                        title="Cancel order"
                        disabled={cancellingOrderId === o.orderId}
                        onClick={() => void handleCancel(o.orderId)}
                        className="min-h-[2rem] min-w-[2rem] shrink-0 rounded border border-red-500/45 bg-red-500/10 px-2 text-xs font-semibold uppercase tracking-wide text-red-400 hover:bg-red-500/20 disabled:opacity-40"
                      >
                        {cancellingOrderId === o.orderId ? '…' : '×'}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex min-w-0 items-center justify-center gap-1.5">
                  <button
                    type="button"
                    title="Buy YES"
                    disabled={busyBuy}
                    onClick={() => place('yes', 'buy', cents)}
                    className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-emerald-500 hover:text-emerald-400 disabled:opacity-40"
                  >
                    {busyBuy ? '…' : 'BUY'}
                  </button>
                  <span className="min-w-[2.25rem] shrink-0 text-center font-medium text-kalshi-text">
                    {fmtCents(cents)}
                  </span>
                  <button
                    type="button"
                    title="Sell YES"
                    disabled={busySellYes}
                    onClick={() => place('yes', 'sell', cents)}
                    className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-rose-400 hover:text-rose-300 disabled:opacity-40"
                  >
                    {busySellYes ? '…' : 'SELL'}
                  </button>
                </div>
                <div className="flex min-w-0 flex-wrap items-center justify-start gap-1.5">
                  {sellSideOrders.map((o) => (
                    <div key={o.orderId} className="flex items-center gap-1.5">
                      <span
                        title="Contracts ahead of your order in queue"
                        className="min-w-[1.75rem] rounded border border-kalshi-accent/50 bg-kalshi-accent/10 px-2 py-1 text-center text-sm font-semibold tabular-nums text-kalshi-accent"
                      >
                        {fmtQueue(queueByOrderId[o.orderId])}
                      </span>
                      <button
                        type="button"
                        title="Cancel order"
                        disabled={cancellingOrderId === o.orderId}
                        onClick={() => void handleCancel(o.orderId)}
                        className="min-h-[2rem] min-w-[2rem] shrink-0 rounded border border-red-500/45 bg-red-500/10 px-2 text-xs font-semibold uppercase tracking-wide text-red-400 hover:bg-red-500/20 disabled:opacity-40"
                      >
                        {cancellingOrderId === o.orderId ? '…' : '×'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative flex min-h-[24px] min-w-0 items-center justify-start py-px pl-1 pr-2">
                <div className="relative flex min-h-[24px] min-w-0 flex-1 items-center justify-start">
                  <div
                    className="pointer-events-none absolute inset-y-0 left-0 bg-rose-500/12"
                    style={{ width: `${sellPct}%` }}
                  />
                  <span className="relative z-[1] shrink-0 text-kalshi-text/90">
                    {sellSize > 0 ? sellSize.toLocaleString() : '—'}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
