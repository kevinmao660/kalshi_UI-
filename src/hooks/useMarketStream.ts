import { useEffect, useState } from 'react'
import {
  connectMarketStream,
  fetchMarketSnapshot,
  type MarketSnapshot,
  type MarketStreamEvent,
  type PriceLevel,
} from '@/api/market'

export function useMarketStream(ticker: string) {
  const [orderbook, setOrderbook] = useState<{ yes: PriceLevel[]; no: PriceLevel[] }>({
    yes: [],
    no: [],
  })
  const [trades, setTrades] = useState<MarketSnapshot['trades']>([])
  const [metrics, setMetrics] = useState<MarketSnapshot['rollingMetrics'] | null>(null)
  const [bbo, setBbo] = useState<MarketSnapshot['bbo']>({ bestBid: null, bestAsk: null })
  const [stale, setStale] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ticker) {
      setLoading(false)
      setError(null)
      setStale(false)
      setOrderbook({ yes: [], no: [] })
      setTrades([])
      setMetrics(null)
      setBbo({ bestBid: null, bestAsk: null })
      return
    }

    setLoading(true)
    setError(null)

    fetchMarketSnapshot(ticker)
      .then((snap) => {
        setOrderbook(snap.orderbook)
        setTrades(snap.trades)
        setMetrics(snap.rollingMetrics)
        setBbo(snap.bbo)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))

    const disconnect = connectMarketStream(ticker, (ev: MarketStreamEvent) => {
      switch (ev.event) {
        case 'orderbook':
          setOrderbook(ev.data)
          break
        case 'tradesFeed':
          setTrades(ev.data)
          break
        case 'rollingMetrics':
          setMetrics(ev.data)
          break
        case 'bbo':
          setBbo(ev.data)
          break
        case 'stale':
          setStale(ev.data)
          break
        default:
          break
      }
    })

    return disconnect
  }, [ticker])

  return { orderbook, trades, metrics, bbo, stale, loading, error }
}
