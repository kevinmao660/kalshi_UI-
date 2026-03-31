# Trading Page — Design Document

Design for the **Market Trading Page** — the view users land on when clicking [Trade] from the Hot Volume Screener. This page consumes the MarketEngine backend and displays real-time data for a single market.

---

## 1. High-Level Flow

```
Screener → [Trade] → /market/:ticker → TradingPage
                         │
                         ├── Fetch market metadata (REST)
                         ├── Connect WebSocket (orderbook_delta + trade)
                         ├── MarketEngine processes messages
                         └── UI streams: orderbook, trades, metrics, order form
```

---

## 2. Layout Wireframe

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  TOP NAVBAR (same as screener)                                                    │
│  [← Back to Screener]  [Market Title]                              Balance: $X   │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│  MAIN CONTENT                                                                    │
│  ┌─────────────────────┬─────────────────────────────────────────────────────┐  │
│  │  ORDERBOOK (L2)     │  ORDER FORM                                          │  │
│  │  YES    │  NO      │  [Side: YES / NO]   [Price: ___]   [Size: ___]       │  │
│  │  42  13 │  56  17  │  [Buy YES] [Sell YES] [Buy NO] [Sell NO]             │  │
│  │  41  10 │  45  20  │  ─────────────────────────────────────────────────   │  │
│  │  ...    │  ...     │  ROLLING METRICS                                     │  │
│  │         │          │  10s: 1,234 vol | $5.2K | 2.1 trades/s               │  │
│  │         │          │  60s: 8,901 vol | $42.1K | 1.8 trades/s             │  │
│  └────────────────────┴─────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │  RECENT TRADES (last 15)                                                     │ │
│  │  Time    | Price | Size  | Side                                              │ │
│  │  14:32:01| 0.42  | 136   | YES                                               │ │
│  │  ...                                                                         │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │  MY ORDERS (resting) |  QUEUE POSITION                                       │ │
│  │  Order ID | Price | Size | Side | Queue Pos                                  │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Components

| Component | Purpose |
|-----------|---------|
| MarketTradingLayout | Shell: navbar, back link, main content |
| OrderbookPanel | L2 YES/NO levels from MarketEngine |
| OrderForm | Side, price, size, Buy/Sell buttons |
| RollingMetricsPanel | 10s/60s volume, notional, trades/sec |
| TradesFeedPanel | Last 15 trades ticker |
| MyOrdersPanel | Resting orders + queue position |

---

## 4. Data Flow

- **MarketEngine** runs in browser (or via backend proxy). Subscribes to WS for `orderbook_delta` + `trade` for this market.
- **MarketEngine** emits: `orderbook`, `bbo`, `tradesFeed`, `rollingMetrics`, `queuePosition`, `stale`, `seqGap`
- **TradingPage** subscribes to these events and updates React state.
- **Order placement**: REST `POST /portfolio/orders`; on success, `registerOrder` with MarketEngine for queue tracking.

---

## 5. Implementation Status

- [x] Screener Trade button → navigate to /market/:ticker
- [x] Routing (react-router-dom)
- [ ] TradingPage layout and placeholder
- [ ] WebSocket connection + MarketEngine integration
- [ ] OrderbookPanel, TradesFeedPanel, RollingMetricsPanel
- [ ] Order form + REST API

---

## 6. Routes

| Path | Component |
|------|-----------|
| `/` | ScreenerLayout (Hot Volume Screener) |
| `/market/:ticker` | TradingPage |
