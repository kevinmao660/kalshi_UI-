/**
 * Market data API — SSE stream and snapshot from backend
 */

const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '')

export type PriceLevel = [price: number, size: number]

export interface MarketSnapshot {
  orderbook: { yes: PriceLevel[]; no: PriceLevel[] }
  trades: Array<{
    tradeId: string
    yesPrice: number
    noPrice: number
    count: number
    notional: number
    takerSide: 'yes' | 'no'
    ts: number
  }>
  rollingMetrics: {
    window2s: {
      volume: number
      notional: number
      tradeCount: number
      tradesPerSecond: number
      yes: { volume: number; notional: number }
      no: { volume: number; notional: number }
      net: { volume: number; notional: number }
    }
    window10s: {
      volume: number
      notional: number
      tradeCount: number
      tradesPerSecond: number
      yes: { volume: number; notional: number }
      no: { volume: number; notional: number }
      net: { volume: number; notional: number }
    }
  }
  bbo: { bestBid: number | null; bestAsk: number | null }
}

export async function fetchMarketSnapshot(ticker: string): Promise<MarketSnapshot> {
  const res = await fetch(`${API_BASE}/api/market/${encodeURIComponent(ticker)}/snapshot`)
  if (!res.ok) throw new Error(`Market snapshot failed: ${res.status}`)
  return res.json()
}

export type MarketStreamEvent =
  | { event: 'orderbook'; data: { yes: PriceLevel[]; no: PriceLevel[] } }
  | { event: 'tradesFeed'; data: MarketSnapshot['trades'] }
  | { event: 'rollingMetrics'; data: MarketSnapshot['rollingMetrics'] }
  | { event: 'bbo'; data: MarketSnapshot['bbo'] }
  | { event: 'trade'; data: MarketSnapshot['trades'][0] }
  | { event: 'stale'; data: boolean }
  | { event: 'seqGap'; data: { expected: number; received: number } }

export function connectMarketStream(
  ticker: string,
  onEvent: (ev: MarketStreamEvent) => void
): () => void {
  const url = `${API_BASE}/api/market/${encodeURIComponent(ticker)}/stream`
  const es = new EventSource(url)

  es.onmessage = (e) => {
    try {
      const parsed = JSON.parse(e.data) as MarketStreamEvent
      onEvent(parsed)
    } catch {
      // ignore
    }
  }

  es.onerror = () => {
    onEvent({ event: 'stale', data: true })
  }

  return () => es.close()
}
