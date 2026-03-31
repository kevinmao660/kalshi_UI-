/**
 * Kalshi backend — WebSocket proxy + MarketEngine + SSE stream
 */

import http, { type IncomingMessage } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import { WebSocketServer, WebSocket } from 'ws'
import { connectKalshiWs, connectKalshiPrivateDataWs } from './kalshi-ws.js'
import { kalshiFetch } from './kalshi-rest.js'
import { MarketEngine } from '../../src/market-engine/index.js'

// Always load server/.env (not cwd-dependent — `import 'dotenv/config'` only reads `.env` from process.cwd())
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env') })

const PORT = Number(process.env.PORT) || 3001
const API_KEY_ID = process.env.KALSHI_API_KEY_ID || ''
const PRIVATE_KEY_PEM = process.env.KALSHI_PRIVATE_KEY_PEM || ''

const KALSHI_ORDERBOOK_URL = (ticker: string) =>
  `https://api.elections.kalshi.com/trade-api/v2/markets/${encodeURIComponent(ticker)}/orderbook`

const app = express()
app.use(cors({ origin: true }))
app.use(express.json())

type EngineEntry = {
  engine: MarketEngine
  clients: Set<(data: string) => void>
  /** Resolves after first REST orderbook snapshot is applied (or fetch fails). */
  snapshotReady: Promise<void>
}

const engines = new Map<string, EngineEntry>()

/** Browser clients keyed by market ticker — receive filtered queue snapshots. */
const queuePositionClients = new Map<string, Set<WebSocket>>()
/** While any WS client is subscribed, maps market ticker → event_ticker for scoped queue refresh. */
const eventTickerForMarket = new Map<string, string>()
const queueRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** Browser clients keyed by market ticker — receive resting order list snapshots. */
const restingOrdersClients = new Map<string, Set<WebSocket>>()
const restingOrdersRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** Kalshi private WS: user_orders + fill */
let privateDataKalshiWs: WebSocket | null = null

/** Coalesce portfolio refetch hints into the next resting_orders broadcast for that market. */
const restingPortfolioRefreshPending = new Map<string, boolean>()

type QueuePosRow = {
  order_id: string
  market_ticker?: string
  queue_position_fp?: string
  queue_position?: number | string
}

/** Kalshi may return queue_position / queue_position_fp as number or string. */
function queueValueFromRow(row: QueuePosRow): number | null {
  const direct = numericQueue(row.queue_position)
  if (direct != null) return direct
  if (row.queue_position_fp != null) {
    const n = parseFloat(String(row.queue_position_fp))
    if (Number.isFinite(n)) return Math.round(n)
  }
  return null
}

function numericQueue(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v)
    if (Number.isFinite(n)) return Math.round(n)
  }
  return null
}

/**
 * Queue positions for one market: either GET …/queue_positions?event_ticker=… then filter by
 * market_ticker (matches Python get_queue_positions(event_ticker=…)), or full list + filter.
 */
async function fetchQueuePositionsForMarketScoped(
  marketTicker: string,
  eventTicker: string | null,
): Promise<Record<string, number>> {
  const qs = eventTicker
    ? new URLSearchParams({ event_ticker: eventTicker }).toString()
    : ''
  const path = qs ? `/portfolio/orders/queue_positions?${qs}` : '/portfolio/orders/queue_positions'
  const r = await kalshiFetch(path, { method: 'GET' }, API_KEY_ID, PRIVATE_KEY_PEM)
  const data = (await r.json().catch(() => ({}))) as { queue_positions?: QueuePosRow[] }
  if (!r.ok) return {}
  const out: Record<string, number> = {}
  for (const row of data.queue_positions ?? []) {
    if (row.market_ticker != null && row.market_ticker !== marketTicker) continue
    const q = queueValueFromRow(row)
    if (q != null) out[row.order_id] = q
  }
  return out
}

function broadcastQueuePositions(ticker: string, positions: Record<string, number>) {
  const payload = JSON.stringify({ type: 'queue_positions', ticker, positions })
  const set = queuePositionClients.get(ticker)
  if (!set) return
  for (const client of set) {
    if (client.readyState === WebSocket.OPEN) client.send(payload)
  }
}

function scheduleQueueRefreshForTicker(marketTicker: string) {
  const prev = queueRefreshTimers.get(marketTicker)
  if (prev) clearTimeout(prev)
  queueRefreshTimers.set(
    marketTicker,
    setTimeout(() => {
      queueRefreshTimers.delete(marketTicker)
      void (async () => {
        try {
          const ev = eventTickerForMarket.get(marketTicker) ?? null
          const positions = await fetchQueuePositionsForMarketScoped(marketTicker, ev)
          broadcastQueuePositions(marketTicker, positions)
        } catch (e) {
          console.error('[queue_positions] refresh failed:', e)
        }
      })()
    }, 200),
  )
}

function marketsInSameEvent(triggerMarket: string): string[] {
  const ev = eventTickerForMarket.get(triggerMarket)
  const out = new Set<string>([triggerMarket])
  if (!ev) return [triggerMarket]
  for (const [mkt, e] of eventTickerForMarket) {
    if (e === ev) out.add(mkt)
  }
  return [...out]
}

async function fetchRestingOrdersForMarketServer(
  marketTicker: string,
  eventTicker: string | null,
): Promise<unknown[]> {
  const qs = new URLSearchParams({ status: 'resting', limit: '200' })
  if (eventTicker) qs.set('event_ticker', eventTicker)
  else qs.set('ticker', marketTicker)
  const path = `/portfolio/orders?${qs.toString()}`
  const r = await kalshiFetch(path, { method: 'GET' }, API_KEY_ID, PRIVATE_KEY_PEM)
  const data = (await r.json().catch(() => ({}))) as { orders?: unknown[] }
  if (!r.ok) return []
  return (data.orders ?? []).filter(
    (o: { ticker?: string }) => (o as { ticker?: string }).ticker === marketTicker,
  )
}

function broadcastRestingOrders(
  marketTicker: string,
  orders: unknown[],
  portfolioRefresh?: boolean,
) {
  const payload = JSON.stringify({
    type: 'resting_orders',
    ticker: marketTicker,
    orders,
    portfolio_refresh: !!portfolioRefresh,
  })
  const set = restingOrdersClients.get(marketTicker)
  if (!set) return
  for (const client of set) {
    if (client.readyState === WebSocket.OPEN) client.send(payload)
  }
}

function scheduleRestingOrdersRefreshForTicker(
  marketTicker: string,
  opts?: { portfolioRefresh?: boolean },
) {
  if (opts?.portfolioRefresh) restingPortfolioRefreshPending.set(marketTicker, true)
  const prev = restingOrdersRefreshTimers.get(marketTicker)
  if (prev) clearTimeout(prev)
  restingOrdersRefreshTimers.set(
    marketTicker,
    setTimeout(() => {
      restingOrdersRefreshTimers.delete(marketTicker)
      const portfolioRefresh = restingPortfolioRefreshPending.get(marketTicker) ?? false
      restingPortfolioRefreshPending.delete(marketTicker)
      void (async () => {
        try {
          const ev = eventTickerForMarket.get(marketTicker) ?? null
          const orders = await fetchRestingOrdersForMarketServer(marketTicker, ev)
          broadcastRestingOrders(marketTicker, orders, portfolioRefresh)
        } catch (e) {
          console.error('[resting_orders] refresh failed:', e)
        }
      })()
    }, 150),
  )
}

function handleKalshiPrivateDataMessage(data: unknown) {
  if (!data || typeof data !== 'object') return
  const d = data as { type?: string; msg?: { ticker?: string; market_ticker?: string } }
  const t = d.type
  if (t === 'user_order' && d.msg?.ticker) {
    const mt = d.msg.ticker
    for (const mkt of marketsInSameEvent(mt)) {
      if (queuePositionClients.has(mkt)) scheduleQueueRefreshForTicker(mkt)
      if (restingOrdersClients.has(mkt)) {
        scheduleRestingOrdersRefreshForTicker(mkt, { portfolioRefresh: true })
      }
    }
    return
  }
  if (t === 'fill' && d.msg?.market_ticker) {
    const m = d.msg.market_ticker
    if (restingOrdersClients.has(m)) {
      scheduleRestingOrdersRefreshForTicker(m, { portfolioRefresh: true })
    }
  }
}

function ensureKalshiPrivateDataConnection() {
  if (!API_KEY_ID || !PRIVATE_KEY_PEM) return
  if (
    privateDataKalshiWs !== null &&
    (privateDataKalshiWs.readyState === WebSocket.CONNECTING ||
      privateDataKalshiWs.readyState === WebSocket.OPEN)
  ) {
    return
  }

  const ws = connectKalshiPrivateDataWs(
    (msg) => handleKalshiPrivateDataMessage(msg),
    API_KEY_ID,
    PRIVATE_KEY_PEM,
  )
  privateDataKalshiWs = ws
  ws.on('close', () => {
    if (privateDataKalshiWs === ws) privateDataKalshiWs = null
    setTimeout(() => ensureKalshiPrivateDataConnection(), 3000)
  })
}

function getOrCreateEngine(ticker: string): EngineEntry {
  const existing = engines.get(ticker)
  if (existing) return existing

  const engine = new MarketEngine({
    marketTicker: ticker,
    staleThresholdSeconds: 30,
  })

  const clients = new Set<(data: string) => void>()

  function broadcast(event: string, payload: unknown) {
    const msg = JSON.stringify({ event, data: payload })
    for (const send of clients) send(msg)
  }

  engine.on('orderbook', (ob) => broadcast('orderbook', ob))
  engine.on('bbo', (bbo) => broadcast('bbo', bbo))
  engine.on('tradesFeed', (trades) => broadcast('tradesFeed', trades))
  engine.on('rollingMetrics', (m) => broadcast('rollingMetrics', m))
  engine.on('trade', (t) => broadcast('trade', t))
  engine.on('stale', (s) => broadcast('stale', s))
  engine.on('seqGap', (g) => broadcast('seqGap', g))

  const snapshotReady = fetch(KALSHI_ORDERBOOK_URL(ticker))
    .then((r) => r.json())
    .then((data) => engine.applyOrderbookSnapshot(data))
    .catch((e) => console.error('[Kalshi] REST orderbook snapshot failed:', e))

  if (API_KEY_ID && PRIVATE_KEY_PEM) {
    try {
      const ws = connectKalshiWs(ticker, (msg) => engine.processMessage(msg), API_KEY_ID, PRIVATE_KEY_PEM)
      engine.on('seqGap', () => {
        fetch(KALSHI_ORDERBOOK_URL(ticker))
          .then((r) => r.json())
          .then((data) => engine.applyOrderbookSnapshot(data))
          .catch(console.error)
      })
      ;(engine as unknown as { _ws?: typeof ws })._ws = ws
    } catch (err) {
      console.warn('[Kalshi] WS auth failed, REST only:', err instanceof Error ? err.message : err)
    }
  }

  const entry: EngineEntry = { engine, clients, snapshotReady }
  engines.set(ticker, entry)
  return entry
}

// SSE stream for market data
app.get('/api/market/:ticker/stream', async (req, res) => {
  const ticker = req.params.ticker
  if (!ticker) {
    res.status(400).json({ error: 'ticker required' })
    return
  }

  const entry = getOrCreateEngine(ticker)
  await entry.snapshotReady

  const { engine, clients } = entry

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (msg: string) => {
    res.write(`data: ${msg}\n\n`)
    res.flush?.()
  }

  clients.add(send)

  send(JSON.stringify({ event: 'orderbook', data: engine.getOrderbook() }))
  send(JSON.stringify({ event: 'tradesFeed', data: engine.getTrades() }))
  send(JSON.stringify({ event: 'rollingMetrics', data: engine.getRollingMetrics() }))
  send(JSON.stringify({ event: 'bbo', data: engine.getBBO() }))

  req.on('close', () => {
    clients.delete(send)
    if (clients.size === 0) {
      const ws = (engine as unknown as { _ws?: { close: () => void } })._ws
      ws?.close()
      engine.destroy()
      engines.delete(ticker)
    }
  })
})

// REST snapshot (for initial load without SSE)
app.get('/api/market/:ticker/snapshot', async (req, res) => {
  const ticker = req.params.ticker
  if (!ticker) {
    res.status(400).json({ error: 'ticker required' })
    return
  }

  const entry = getOrCreateEngine(ticker)
  await entry.snapshotReady

  const { engine } = entry
  res.json({
    orderbook: engine.getOrderbook(),
    trades: engine.getTrades(),
    rollingMetrics: engine.getRollingMetrics(),
    bbo: engine.getBBO(),
  })
})

// Positions (Kalshi GET /portfolio/positions — event_ticker and/or ticker)
app.get('/api/portfolio/positions', async (req, res) => {
  if (!API_KEY_ID || !PRIVATE_KEY_PEM) {
    res.status(503).json({ error: 'API keys not configured' })
    return
  }
  try {
    const qs = new URLSearchParams()
    const ticker = req.query.ticker
    if (typeof ticker === 'string' && ticker.length > 0) qs.set('ticker', ticker)
    const eventTicker = req.query.event_ticker
    if (typeof eventTicker === 'string' && eventTicker.length > 0) qs.set('event_ticker', eventTicker)
    const limitRaw = Number(req.query.limit)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 1000) : 200
    qs.set('limit', String(limit))
    const path = `/portfolio/positions${qs.toString() ? `?${qs.toString()}` : ''}`
    const r = await kalshiFetch(path, { method: 'GET' }, API_KEY_ID, PRIVATE_KEY_PEM)
    const data = await r.json().catch(() => ({}))
    res.status(r.status).json(data)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// List orders (Kalshi GET /portfolio/orders — use ticker + status=resting for open orders)
app.get('/api/orders', async (req, res) => {
  if (!API_KEY_ID || !PRIVATE_KEY_PEM) {
    res.status(503).json({ error: 'API keys not configured' })
    return
  }
  try {
    const qs = new URLSearchParams()
    const ticker = req.query.ticker
    if (typeof ticker === 'string' && ticker.length > 0) qs.set('ticker', ticker)
    const eventTicker = req.query.event_ticker
    if (typeof eventTicker === 'string' && eventTicker.length > 0) qs.set('event_ticker', eventTicker)
    const status = typeof req.query.status === 'string' && req.query.status.length > 0 ? req.query.status : 'resting'
    qs.set('status', status)
    const limitRaw = Number(req.query.limit)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 200) : 200
    qs.set('limit', String(limit))
    const path = `/portfolio/orders?${qs.toString()}`
    const r = await kalshiFetch(path, { method: 'GET' }, API_KEY_ID, PRIVATE_KEY_PEM)
    const data = await r.json().catch(() => ({}))
    res.status(r.status).json(data)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// Batch queue positions for resting orders (Kalshi GET /portfolio/orders/queue_positions)
app.get('/api/orders/queue_positions', async (req, res) => {
  if (!API_KEY_ID || !PRIVATE_KEY_PEM) {
    res.status(503).json({ error: 'API keys not configured' })
    return
  }
  try {
    const qs = new URLSearchParams()
    const mt = req.query.market_tickers
    if (typeof mt === 'string' && mt.length > 0) qs.set('market_tickers', mt)
    const ev = req.query.event_ticker
    if (typeof ev === 'string' && ev.length > 0) qs.set('event_ticker', ev)
    const path = `/portfolio/orders/queue_positions${qs.toString() ? `?${qs.toString()}` : ''}`
    const r = await kalshiFetch(path, { method: 'GET' }, API_KEY_ID, PRIVATE_KEY_PEM)
    const data = await r.json().catch(() => ({}))
    res.status(r.status).json(data)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// Cancel order (Kalshi DELETE /portfolio/orders/{order_id})
app.delete('/api/orders/:orderId', async (req, res) => {
  if (!API_KEY_ID || !PRIVATE_KEY_PEM) {
    res.status(503).json({ error: 'API keys not configured' })
    return
  }
  const orderId = req.params.orderId
  if (!orderId) {
    res.status(400).json({ error: 'orderId required' })
    return
  }
  try {
    const path = `/portfolio/orders/${encodeURIComponent(orderId)}`
    const r = await kalshiFetch(path, { method: 'DELETE' }, API_KEY_ID, PRIVATE_KEY_PEM)
    const data = await r.json().catch(() => ({}))
    res.status(r.status).json(data)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// Create order (proxy to Kalshi)
app.post('/api/orders', async (req, res) => {
  if (!API_KEY_ID || !PRIVATE_KEY_PEM) {
    res.status(503).json({ error: 'API keys not configured' })
    return
  }
  try {
    const r = await kalshiFetch(
      '/portfolio/orders',
      { method: 'POST', body: req.body },
      API_KEY_ID,
      PRIVATE_KEY_PEM
    )
    const data = await r.json().catch(() => ({}))
    res.status(r.status).json(data)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// Health
app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

const server = http.createServer(app)
const queuePositionsWss = new WebSocketServer({ noServer: true })

queuePositionsWss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const host = req.headers.host || 'localhost'
  const url = new URL(req.url || '/', `http://${host}`)
  const marketTicker = url.searchParams.get('ticker')
  const eventTickerParam = url.searchParams.get('event_ticker')
  if (!marketTicker) {
    ws.close(4000, 'ticker required')
    return
  }
  if (eventTickerParam) eventTickerForMarket.set(marketTicker, eventTickerParam)
  ensureKalshiPrivateDataConnection()
  let set = queuePositionClients.get(marketTicker)
  if (!set) {
    set = new Set()
    queuePositionClients.set(marketTicker, set)
  }
  set.add(ws)
  void (async () => {
    try {
      if (!API_KEY_ID || !PRIVATE_KEY_PEM) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'queue_positions', ticker: marketTicker, positions: {} }))
        }
        return
      }
      const positions = await fetchQueuePositionsForMarketScoped(
        marketTicker,
        eventTickerParam,
      )
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'queue_positions', ticker: marketTicker, positions }))
      }
    } catch (e) {
      console.error('[queue_positions] initial snapshot failed:', e)
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'queue_positions', ticker: marketTicker, positions: {} }))
      }
    }
  })()
  ws.on('close', () => {
    set.delete(ws)
    if (set.size === 0) {
      queuePositionClients.delete(marketTicker)
      if (!restingOrdersClients.has(marketTicker)) eventTickerForMarket.delete(marketTicker)
    }
  })
})

const restingOrdersWss = new WebSocketServer({ noServer: true })

restingOrdersWss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const host = req.headers.host || 'localhost'
  const url = new URL(req.url || '/', `http://${host}`)
  const marketTicker = url.searchParams.get('ticker')
  const eventTickerParam = url.searchParams.get('event_ticker')
  if (!marketTicker) {
    ws.close(4000, 'ticker required')
    return
  }
  if (eventTickerParam) eventTickerForMarket.set(marketTicker, eventTickerParam)
  ensureKalshiPrivateDataConnection()
  let set = restingOrdersClients.get(marketTicker)
  if (!set) {
    set = new Set()
    restingOrdersClients.set(marketTicker, set)
  }
  set.add(ws)
  void (async () => {
    try {
      if (!API_KEY_ID || !PRIVATE_KEY_PEM) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'resting_orders',
              ticker: marketTicker,
              orders: [],
              portfolio_refresh: false,
            }),
          )
        }
        return
      }
      const orders = await fetchRestingOrdersForMarketServer(marketTicker, eventTickerParam)
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'resting_orders',
            ticker: marketTicker,
            orders,
            portfolio_refresh: false,
          }),
        )
      }
    } catch (e) {
      console.error('[resting_orders] initial snapshot failed:', e)
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'resting_orders',
            ticker: marketTicker,
            orders: [],
            portfolio_refresh: false,
          }),
        )
      }
    }
  })()
  ws.on('close', () => {
    set.delete(ws)
    if (set.size === 0) {
      restingOrdersClients.delete(marketTicker)
      if (!queuePositionClients.has(marketTicker)) eventTickerForMarket.delete(marketTicker)
    }
  })
})

server.on('upgrade', (req, socket, head) => {
  const host = req.headers.host || 'localhost'
  const pathname = new URL(req.url || '/', `http://${host}`).pathname
  if (pathname === '/api/ws/queue_positions') {
    queuePositionsWss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      queuePositionsWss.emit('connection', ws, req)
    })
  } else if (pathname === '/api/ws/resting_orders') {
    restingOrdersWss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      restingOrdersWss.emit('connection', ws, req)
    })
  } else {
    socket.destroy()
  }
})

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[Kalshi backend] Port ${PORT} is already in use (another backend still running?).`,
    )
    console.error(
      `  Fix: stop that process, e.g.  kill $(lsof -ti :${PORT})   or set PORT=3002 in server/.env`,
    )
    process.exit(1)
  }
  console.error('[Kalshi backend] server error:', err)
  throw err
})

server.listen(PORT, () => {
  console.log(`Kalshi backend on http://localhost:${PORT}`)
  if (!API_KEY_ID || !PRIVATE_KEY_PEM) {
    console.warn('No KALSHI_API_KEY_ID / KALSHI_PRIVATE_KEY_PEM — using REST snapshot only (no live WS)')
  } else {
    ensureKalshiPrivateDataConnection()
  }
})
