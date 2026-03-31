/** Kalshi API market response shape (subset we use) */
export interface KalshiMarket {
  ticker: string
  event_ticker: string
  title: string
  /** Optional: short label for YES side (e.g. team name). */
  yes_sub_title?: string
  no_sub_title?: string
  yes_ask_dollars?: string
  yes_ask?: number
  no_ask_dollars?: string
  no_ask?: number
  /** May be omitted; API often returns only `volume_fp` / `volume_24h_fp`. */
  volume?: number
  volume_24h?: number
  volume_fp?: string
  volume_24h_fp?: string
  close_time: string
  expected_expiration_time?: string | null
  status: string
  series_ticker?: string
}

/** Normalized market for screener display */
export interface MarketSnapshot {
  id: string
  ticker: string
  eventTicker: string
  title: string
  yesAsk: number
  noAsk: number
  volume24h: number
  volume: number
  closeTime: string
  /** When the actual event occurs (game, match, etc.); falls back to closeTime */
  eventTime: string
  /** Used for sort; API has volume_24h, we use it as proxy for "5m" hot volume */
  volume5m: number
}
