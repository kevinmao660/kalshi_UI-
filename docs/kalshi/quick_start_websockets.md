# Quick Start: WebSockets (No SDK)

> Source: https://docs.kalshi.com/getting_started/quick_start_websockets.md

## Connection URL

- Production: `wss://api.elections.kalshi.com/trade-api/ws/v2`
- Demo: `wss://demo-api.kalshi.co/trade-api/ws/v2`

## Authentication

**Private channels (auth required):** `orderbook_delta`, `fill`, `market_positions`, `communications`, `order_group_updates`
**Public channels (no auth):** `ticker`, `trade`, `market_lifecycle_v2`, `multivariate`

### Required Headers

```
KALSHI-ACCESS-KEY: your_api_key_id
KALSHI-ACCESS-SIGNATURE: request_signature
KALSHI-ACCESS-TIMESTAMP: unix_timestamp_in_milliseconds
```

### Signing

Message to sign: `timestamp + "GET" + "/trade-api/ws/v2"`

## Subscribe Command

```json
{
  "id": 1,
  "cmd": "subscribe",
  "params": {
    "channels": ["orderbook_delta"],
    "market_ticker": "KXHARRIS24-LSV"
  }
}
```

For multiple markets: use `market_tickers` (array) instead of `market_ticker`.

## Channels

- `orderbook_delta` - Snapshot + deltas (market_ticker required)
- `trade` - Public trades
- `ticker` - Market prices
- `fill` - Your fills
- `user_orders` - Your order updates
