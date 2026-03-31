/** Number of trades to keep in recent feed */
export const TRADES_FEED_SIZE = 30

/** Rolling window sizes in seconds (short = fast tape, long = smoother) */
export const WINDOW_SHORT = 2
export const WINDOW_LONG = 10

/** Number of 1-second buckets for rolling metrics */
export const METRICS_BUCKET_COUNT = 60

/** Max orderbook emits per second (throttle) */
export const ORDERBOOK_EMIT_THROTTLE_MS = 16
