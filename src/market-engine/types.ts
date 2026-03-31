/** Price level: [price_cents, size_contracts] */
export type PriceLevel = [price: number, size: number]

/** Orderbook snapshot for a single side */
export type OrderbookSide = Map<number, number>

/** Trade from Kalshi WebSocket */
export interface KalshiTrade {
  trade_id: string
  market_ticker: string
  yes_price: number
  yes_price_dollars?: string
  no_price: number
  no_price_dollars?: string
  count: number
  count_fp?: string
  taker_side: 'yes' | 'no'
  ts: number
}

/** Normalized trade for internal use */
export interface Trade {
  tradeId: string
  yesPrice: number
  noPrice: number
  count: number
  notional: number
  takerSide: 'yes' | 'no'
  ts: number
}

/** Rolling metrics for a time window */
export interface WindowMetrics {
  volume: number
  notional: number
  tradeCount: number
  tradesPerSecond: number
  /** Taker-side flow: YES vs NO contracts and notional (money) in that window. */
  yes: { volume: number; notional: number }
  no: { volume: number; notional: number }
  /** Signed net taker flow YES − NO (contracts & $). Positive = YES-heavy, negative = NO-heavy. */
  net: { volume: number; notional: number }
}

/** Orderbook snapshot message from Kalshi (WS) or REST orderbook response */
export interface OrderbookSnapshotMsg {
  market_ticker?: string
  market_id?: string
  yes?: [number, number][]
  no?: [number, number][]
  yes_dollars?: (string | number)[][]
  no_dollars?: (string | number)[][]
  yes_dollars_fp?: [string, string][]
  no_dollars_fp?: [string, string][]
}

/** Orderbook delta message from Kalshi */
export interface OrderbookDeltaMsg {
  market_ticker: string
  price: number
  delta: number
  side: 'yes' | 'no'
}

/** Tracked order for queue position */
export interface TrackedOrder {
  orderId: string
  price: number
  side: 'yes' | 'no'
  size: number
  lastKnownPosition: number | null
}
