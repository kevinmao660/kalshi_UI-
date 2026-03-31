/**
 * Kalshi REST API client (public market data).
 *
 * Dev (`npm run dev`): always `http://localhost:5173/api/kalshi` → Vite proxy → Kalshi.
 * Kalshi does not send CORS headers for browser origins, so `VITE_KALSHI_API_BASE` is ignored
 * in dev to avoid accidental direct calls that fail with CORS.
 *
 * Prod build: `VITE_KALSHI_API_BASE` or the public Kalshi URL (same-origin proxy still
 * recommended if you deploy a SPA without a backend).
 */

import type { KalshiMarket } from '@/types/market'

const BASE =
  import.meta.env.DEV
    ? '/api/kalshi'
    : import.meta.env.VITE_KALSHI_API_BASE || 'https://api.elections.kalshi.com/trade-api/v2'

/** Fetch markets. Public endpoint - no auth required. */
export async function fetchMarkets(params: {
  seriesTicker?: string
  eventTicker?: string
  status?: string
  limit?: number
  cursor?: string
}): Promise<{ markets: KalshiMarket[]; cursor: string }> {
  const sp = new URLSearchParams()
  if (params.seriesTicker) sp.set('series_ticker', params.seriesTicker)
  if (params.eventTicker) sp.set('event_ticker', params.eventTicker)
  if (params.status) sp.set('status', params.status)
  sp.set('limit', String(params.limit ?? 200))
  if (params.cursor) sp.set('cursor', params.cursor)

  const base = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE
  const url = `${base}/markets?${sp}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Markets API error: ${res.status}`)
  const data = await res.json()
  return { markets: data.markets || [], cursor: data.cursor || '' }
}

/** Fetch series list (for discovering esports/sports tickers) */
export async function fetchSeries(params: {
  category?: string
  tags?: string
}): Promise<{ ticker: string; title: string; category?: string }[]> {
  const sp = new URLSearchParams()
  if (params.category) sp.set('category', params.category)
  if (params.tags) sp.set('tags', params.tags)
  const base = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE
  const url = `${base}/series?${sp}`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  return (data.series || []).map((s: { ticker: string; title: string; category?: string }) => ({
    ticker: s.ticker,
    title: s.title,
    category: s.category,
  }))
}

/** Fetch events (for esports/sports when series filter returns nothing) */
export async function fetchEvents(params: {
  seriesTicker?: string
  limit?: number
  cursor?: string
}): Promise<{ events: { ticker: string }[]; cursor: string }> {
  const sp = new URLSearchParams()
  if (params.seriesTicker) sp.set('series_ticker', params.seriesTicker)
  sp.set('status', 'open')
  sp.set('limit', String(params.limit ?? 100))
  if (params.cursor) sp.set('cursor', params.cursor)
  const base = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE
  const url = `${base}/events?${sp}`
  const res = await fetch(url)
  if (!res.ok) return { events: [], cursor: '' }
  const data = await res.json()
  const raw = data.events || []
  return {
    events: raw.map((e: { ticker?: string; event_ticker?: string }) => ({
      ticker: e.ticker || e.event_ticker || '',
    })),
    cursor: data.cursor || '',
  }
}

/** Volume from API: prefer integers if present, else parse fixed-point strings (current API shape). */
export function getMarketVolumes(m: KalshiMarket): { volume: number; volume24h: number } {
  const volume =
    m.volume ??
    (m.volume_fp != null && m.volume_fp !== '' ? parseFloat(String(m.volume_fp)) : 0)
  const volume24h =
    m.volume_24h ??
    (m.volume_24h_fp != null && m.volume_24h_fp !== '' ? parseFloat(String(m.volume_24h_fp)) : 0)
  return { volume, volume24h }
}

/** Fetch all markets by series or event ticker. */
export async function fetchAllMarkets(params: {
  seriesTicker?: string
  eventTicker?: string
}): Promise<KalshiMarket[]> {
  const { seriesTicker, eventTicker } = params
  return fetchAllMarketsByParams({ seriesTicker, eventTicker })
}

const baseUrl = () => (BASE.endsWith('/') ? BASE.slice(0, -1) : BASE)

/** Single market (for event_ticker + subtitles). Public GET /markets/{ticker} */
export async function fetchMarketByTicker(ticker: string): Promise<KalshiMarket | null> {
  const res = await fetch(`${baseUrl()}/markets/${encodeURIComponent(ticker)}`)
  if (!res.ok) return null
  const data = await res.json()
  return (data.market as KalshiMarket) ?? null
}

/** All open markets in an event (e.g. each team win / outcome). Paginated. */
export async function fetchAllMarketsForEvent(eventTicker: string): Promise<KalshiMarket[]> {
  const all: KalshiMarket[] = []
  let cursor = ''
  for (let i = 0; i < 25; i++) {
    const { markets, cursor: next } = await fetchMarkets({
      eventTicker,
      status: 'open',
      limit: 200,
      cursor: cursor || undefined,
    })
    all.push(...markets)
    cursor = next
    if (!next) break
  }
  const seen = new Set<string>()
  return all.filter((m) => {
    if (seen.has(m.ticker)) return false
    seen.add(m.ticker)
    return true
  })
}

/** Display label for the YES contract (this market winning). */
export function yesOutcomeLabel(m: KalshiMarket): string {
  const y = m.yes_sub_title?.trim()
  if (y) return y.replace(/^yes\s+/i, '').trim() || m.title
  return m.title
}

/** Label for NO side on this market (often the other outcome). */
export function noOutcomeLabel(m: KalshiMarket): string {
  const n = m.no_sub_title?.trim()
  if (n) return n.replace(/^no\s+/i, '').trim() || 'No'
  return 'No'
}

const TARGET_TOP = 50
const FETCH_PAGES = 5
const PAGE_SIZE = 200

async function fetchAllMarketsByParams(params: {
  seriesTicker?: string
  eventTicker?: string
}): Promise<KalshiMarket[]> {
  const all: KalshiMarket[] = []
  let cursor = ''
  for (let i = 0; i < FETCH_PAGES; i++) {
    const { markets, cursor: next } = await fetchMarkets({
      ...params,
      status: 'open',
      limit: PAGE_SIZE,
      cursor: cursor || undefined,
    })
    all.push(...markets)
    cursor = next
    if (!next) break
  }
  return all
    .sort((a, b) => getMarketVolumes(b).volume24h - getMarketVolumes(a).volume24h)
    .slice(0, TARGET_TOP)
}
