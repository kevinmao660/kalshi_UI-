# Orderbook Updates (WebSocket)

> Source: https://docs.kalshi.com/websockets/orderbook-updates.md
> Real-time orderbook price level changes. Provides incremental updates to maintain a live orderbook.

**Requirements:**
- Authentication required
- Market specification required: `market_ticker` (string) or `market_tickers` (array)
- `market_id`/`market_ids` are NOT supported for this channel
- Sends `orderbook_snapshot` first, then incremental `orderbook_delta` updates

## orderbook_snapshot

```json
{
  "type": "orderbook_snapshot",
  "sid": 2,
  "seq": 2,
  "msg": {
    "market_ticker": "FED-23DEC-T3.00",
    "market_id": "9b0f6b43-5b68-4f9f-9f02-9a2d1b8ac1a1",
    "yes": [[8, 300], [22, 333]],
    "no": [[54, 20], [56, 146]]
  }
}
```

- Format: `[price_in_cents, number_of_resting_contracts]`
- `yes_dollars` / `no_dollars` and `yes_dollars_fp` / `no_dollars_fp` variants available

## orderbook_delta

```json
{
  "type": "orderbook_delta",
  "sid": 2,
  "seq": 3,
  "msg": {
    "market_ticker": "FED-23DEC-T3.00",
    "price": 96,
    "price_dollars": "0.960",
    "delta": -54,
    "delta_fp": "-54.00",
    "side": "yes",
    "ts": "2022-11-22T20:44:01Z"
  }
}
```

- `delta`: Change in contracts (positive=increase, negative=decrease)
- `client_order_id`: Optional, present only when you caused this change
- **Seq consistency**: Check `seq === lastSeq + 1`; if gap, fetch REST snapshot
