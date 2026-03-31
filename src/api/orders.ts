/**
 * Order placement API — proxy through backend
 */

const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '')

/** Order row from GET /portfolio/orders (subset used by the ladder). */
export interface PortfolioOrder {
  order_id: string
  ticker: string
  side: 'yes' | 'no'
  action: 'buy' | 'sell'
  type: 'limit' | 'market'
  status: string
  yes_price_dollars: string
  no_price_dollars: string
}

/** Row on the ladder: YES uses yes price; NO uses row index = 100 − no price (¢). */
export type BookOrderRow = {
  orderId: string
  priceCents: number
  action: 'buy' | 'sell'
  side: 'yes' | 'no'
}

/** Maps a Kalshi resting limit order to ladder rows (YES left/right; NO on the NO side column). */
export function mapPortfolioOrderToBookRow(o: PortfolioOrder): BookOrderRow | null {
  if (o.status !== 'resting' || o.type !== 'limit') return null
  const act = o.action === 'buy' ? 'buy' : 'sell'
  if (o.side === 'yes') {
    const cents = Math.round(parseFloat(o.yes_price_dollars || '0') * 100)
    if (cents < 1 || cents > 99) return null
    return { orderId: o.order_id, priceCents: cents, action: act, side: 'yes' }
  }
  if (o.side === 'no') {
    const noCents = Math.round(parseFloat(o.no_price_dollars || '0') * 100)
    if (noCents < 1 || noCents > 99) return null
    const priceCents = 100 - noCents
    if (priceCents < 1 || priceCents > 99) return null
    return { orderId: o.order_id, priceCents, action: act, side: 'no' }
  }
  return null
}

export async function fetchRestingOrders(ticker: string): Promise<{
  orders: PortfolioOrder[]
  cursor: string
}> {
  const qs = new URLSearchParams({ ticker, status: 'resting', limit: '200' })
  const res = await fetch(`${API_BASE}/api/orders?${qs}`)
  const data = (await res.json()) as { orders?: PortfolioOrder[]; cursor?: string }
  if (!res.ok) {
    throw new Error(
      (data as { message?: string; code?: string }).message ||
        (data as { message?: string; code?: string }).code ||
        `List orders failed: ${res.status}`,
    )
  }
  return { orders: data.orders ?? [], cursor: data.cursor ?? '' }
}

/**
 * Resting orders for an event (Kalshi GET /portfolio/orders?event_ticker=…), then keep this market only.
 * Matches Python: get_orders(event_ticker=…) + filter status == resting + match by ticker.
 */
export async function fetchRestingOrdersForMarket(
  eventTicker: string,
  marketTicker: string,
): Promise<{
  orders: PortfolioOrder[]
  cursor: string
}> {
  const qs = new URLSearchParams({
    event_ticker: eventTicker,
    status: 'resting',
    limit: '200',
  })
  const res = await fetch(`${API_BASE}/api/orders?${qs}`)
  const data = (await res.json()) as { orders?: PortfolioOrder[]; cursor?: string }
  if (!res.ok) {
    throw new Error(
      (data as { message?: string; code?: string }).message ||
        (data as { message?: string; code?: string }).code ||
        `List orders failed: ${res.status}`,
    )
  }
  const orders = (data.orders ?? []).filter((o) => o.ticker === marketTicker)
  return { orders, cursor: data.cursor ?? '' }
}

export interface CreateOrderRequest {
  ticker: string
  side: 'yes' | 'no'
  action: 'buy' | 'sell'
  count: number
  yes_price?: number
  no_price?: number
  time_in_force?: 'fill_or_kill' | 'good_till_canceled' | 'immediate_or_cancel'
}

export interface CreateOrderResponse {
  order?: {
    order_id: string
    status: string
    remaining_count: number
    fill_count: number
  }
  code?: string
  message?: string
}

export async function createOrder(req: CreateOrderRequest): Promise<CreateOrderResponse> {
  const res = await fetch(`${API_BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || data.code || `Order failed: ${res.status}`)
  return data
}

/** Cancel a resting order (Kalshi DELETE /portfolio/orders/{order_id}). */
export async function cancelOrder(orderId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/orders/${encodeURIComponent(orderId)}`, {
    method: 'DELETE',
  })
  if (res.ok) return
  const data = (await res.json().catch(() => ({}))) as { message?: string; code?: string }
  throw new Error(data.message || data.code || `Cancel failed: ${res.status}`)
}

function numericQueueField(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v)
    if (Number.isFinite(n)) return Math.round(n)
  }
  return null
}

function queueFromRow(row: {
  queue_position?: number | string
  queue_position_fp?: string
}): number | null {
  const direct = numericQueueField(row.queue_position)
  if (direct != null) return direct
  if (row.queue_position_fp != null) {
    const n = parseFloat(String(row.queue_position_fp))
    if (Number.isFinite(n)) return Math.round(n)
  }
  return null
}

/**
 * Queue positions for one market: GET …/queue_positions?event_ticker=… or market_tickers=…,
 * then rows for this market (Python: get_queue_positions(event_ticker=…) + order_id map).
 * @see https://docs.kalshi.com/api-reference/orders/get-queue-positions-for-orders
 */
export async function fetchQueuePositionsForMarket(
  marketTicker: string,
  eventTicker?: string,
): Promise<Record<string, number>> {
  const qs = new URLSearchParams()
  if (eventTicker) qs.set('event_ticker', eventTicker)
  else qs.set('market_tickers', marketTicker)
  const res = await fetch(`${API_BASE}/api/orders/queue_positions?${qs}`)
  const raw = await res.text()
  let data: {
    queue_positions?: Array<{
      order_id: string
      market_ticker?: string
      queue_position_fp?: string
      queue_position?: number | string
    }>
    message?: string
    code?: string
  }
  try {
    data = raw ? (JSON.parse(raw) as typeof data) : {}
  } catch {
    data = {}
  }
  if (!res.ok) {
    const hint = data.message || data.code || raw.slice(0, 200) || 'empty body'
    throw new Error(`Queue positions failed: ${res.status} — ${hint}`)
  }
  const out: Record<string, number> = {}
  for (const row of data.queue_positions ?? []) {
    if (row.market_ticker != null && row.market_ticker !== marketTicker) continue
    const q = queueFromRow(row)
    if (q != null) out[row.order_id] = q
  }
  return out
}

/**
 * Queue positions for the given order ids using only GET …/queue_positions (event or market scope),
 * filtered to this market — no per-order queue_position endpoint.
 */
export async function resolveQueuePositionsForOrders(
  ticker: string,
  orderIds: string[],
  eventTicker?: string,
): Promise<Record<string, number>> {
  const uniq = [...new Set(orderIds)].filter(Boolean)
  if (uniq.length === 0) return {}
  const batch = await fetchQueuePositionsForMarket(ticker, eventTicker)
  const out: Record<string, number> = {}
  for (const id of uniq) {
    if (id in batch) out[id] = batch[id]!
  }
  return out
}

/**
 * Live queue positions: server GET …/queue_positions (event_ticker or market scope) + filter by
 * market, pushed over WS when Kalshi user_orders fires. The OrderbookPanel also refetches this
 * REST endpoint whenever the SSE orderbook updates so queue tracks others’ impact on the line.
 */
export function subscribeQueuePositions(
  marketTicker: string,
  onPositions: (positions: Record<string, number>) => void,
  eventTicker?: string,
  onWsStatus?: (connected: boolean) => void,
): () => void {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = import.meta.env.DEV
    ? window.location.host
    : (() => {
        const base = import.meta.env.VITE_API_URL || window.location.origin
        try {
          return new URL(base).host
        } catch {
          return window.location.host
        }
      })()
  const qs = new URLSearchParams({ ticker: marketTicker })
  if (eventTicker) qs.set('event_ticker', eventTicker)
  const ws = new WebSocket(`${proto}//${host}/api/ws/queue_positions?${qs}`)
  ws.onopen = () => {
    onWsStatus?.(true)
  }
  ws.onclose = () => {
    onWsStatus?.(false)
  }
  ws.onerror = () => {
    onWsStatus?.(false)
  }
  ws.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data as string) as {
        type?: string
        ticker?: string
        positions?: Record<string, number>
      }
      if (d.type === 'queue_positions' && d.ticker === marketTicker && d.positions) {
        onPositions(d.positions)
      }
    } catch {
      // ignore
    }
  }
  return () => {
    // Avoid calling close() while CONNECTING — React Strict Mode unmounts before open and
    // synchronous close() logs "WebSocket is closed before the connection is established".
    if (ws.readyState === WebSocket.OPEN) {
      ws.close()
    } else if (ws.readyState === WebSocket.CONNECTING) {
      ws.addEventListener(
        'open',
        () => {
          ws.close()
        },
        { once: true },
      )
    }
  }
}

/**
 * Resting orders for one market: server GET /portfolio/orders + Kalshi user_orders WS refresh,
 * pushed as JSON { type: 'resting_orders', ticker, orders, portfolio_refresh? }.
 */
export function subscribeRestingOrders(
  marketTicker: string,
  onOrders: (orders: PortfolioOrder[]) => void,
  eventTicker?: string,
  onWsStatus?: (connected: boolean) => void,
  /** When true, refetch GET /portfolio/positions (fills / order updates). */
  onPortfolioRefreshHint?: () => void,
): () => void {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = import.meta.env.DEV
    ? window.location.host
    : (() => {
        const base = import.meta.env.VITE_API_URL || window.location.origin
        try {
          return new URL(base).host
        } catch {
          return window.location.host
        }
      })()
  const qs = new URLSearchParams({ ticker: marketTicker })
  if (eventTicker) qs.set('event_ticker', eventTicker)
  const ws = new WebSocket(`${proto}//${host}/api/ws/resting_orders?${qs}`)
  ws.onopen = () => {
    onWsStatus?.(true)
  }
  ws.onclose = () => {
    onWsStatus?.(false)
  }
  ws.onerror = () => {
    onWsStatus?.(false)
  }
  ws.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data as string) as {
        type?: string
        ticker?: string
        orders?: PortfolioOrder[]
        portfolio_refresh?: boolean
      }
      if (d.type === 'resting_orders' && d.ticker === marketTicker && Array.isArray(d.orders)) {
        onOrders(d.orders)
        if (d.portfolio_refresh) onPortfolioRefreshHint?.()
      }
    } catch {
      // ignore
    }
  }
  return () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close()
    } else if (ws.readyState === WebSocket.CONNECTING) {
      ws.addEventListener(
        'open',
        () => {
          ws.close()
        },
        { once: true },
      )
    }
  }
}
