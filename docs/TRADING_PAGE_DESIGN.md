# Trading Page — Design Document

The **Trading Page** is the view at `/market/:ticker` when the user opens a market from the screener. It shows live **L2 orderbooks**, **rolling metrics**, **trade tape**, **portfolio exposure**, and **resting orders with queue position** for one or two markets in the same event.

**Authoritative transport overview:** [ARCHITECTURE.md](./ARCHITECTURE.md) (REST vs SSE vs WebSocket).

---

## 1. High-level flow

```
Screener → [Trade] → /market/:ticker → TradingPage
                         │
                         ├── Market metadata (REST, public Kalshi API via /api/kalshi)
                         ├── Per market: REST snapshot + SSE stream (backend MarketEngine)
                         ├── Portfolio: REST GET /api/portfolio/positions (polled ~2.5s)
                         └── OrderbookPanel: REST orders + WS queue/resting + REST queue poll 5s
```

- **Browser → Kalshi:** No direct WebSocket. The **Node server** connects to Kalshi’s public WS (`orderbook_delta`, `trade`) and private WS (`user_orders`, `fill`).
- **Browser → this app:** **SSE** (`EventSource`) for market stream; **WebSockets** only for `queue_positions` and `resting_orders` fan-out from the backend.

---

## 2. Layout (implemented)

Four columns when the event has two outcome markets:

1. **Team / outcome A** — `RollingMetricsPanel` + `TradesFeedPanel` (SSE-driven).
2. **Orderbook A** — `OrderbookPanel` (L2 from SSE; orders/queue as below).
3. **Orderbook B** — same for the paired market.
4. **Team / outcome B** — metrics + trades.

Header: back link, optional **Stale** badge, **net contracts** / per-leg YES·NO lines and average cost (from portfolio REST), event title.

Single-market events show one active orderbook column and placeholders for the missing leg.

---

## 3. Components

| Piece | Source file | Data transport |
|-------|-------------|----------------|
| `TradingPage` | `src/pages/TradingPage.tsx` | Orchestrates metadata REST, `useMarketStream` ×2, `loadPortfolio` REST |
| `useMarketStream` | `src/hooks/useMarketStream.ts` | **REST** snapshot then **SSE** `/api/market/:ticker/stream` |
| `OrderbookPanel` | `src/components/OrderbookPanel.tsx` | SSE book + **REST** place/cancel + **WS** resting + queue + **REST** queue poll |
| `RollingMetricsPanel` | `src/components/RollingMetricsPanel.tsx` | SSE (2s / 10s windows from engine) |
| `TradesFeedPanel` | `src/components/TradesFeedPanel.tsx` | SSE |
| Portfolio helpers | `src/api/portfolio.ts` | **REST** only |

Order entry UI lives **inside** `OrderbookPanel` (not a separate route-level form).

---

## 4. Data flow (detailed)

### 4.1 Live market (orderbook, trades, BBO, rolling metrics)

1. `fetchMarketSnapshot(ticker)` → `GET /api/market/:ticker/snapshot` (REST).
2. `connectMarketStream(ticker)` → `GET /api/market/:ticker/stream` (**SSE**).
3. Server `getOrCreateEngine(ticker)` runs **MarketEngine** with Kalshi **REST** orderbook seed + Kalshi **WebSocket** deltas/trades.

### 4.2 Positions and exposure

- `fetchPortfolioPositions({ event_ticker })` or `{ ticker }` → `GET /api/portfolio/positions`.
- Polled on an interval (~**2.5s**); debounced refresh after order hints from the resting-orders WebSocket path.

**Semantics:** `position_fp` per market: positive ≈ YES contracts, negative ≈ NO. For two-way events, the header net is `position_fp(left) − position_fp(right)` when both legs exist.

### 4.3 Orders and queue

| Action | Transport |
|--------|-----------|
| List resting (initial / merged) | **REST** `GET /api/orders` (scoped by ticker or event) |
| Live resting updates | **WebSocket** `/api/ws/resting_orders` — server pushes after Kalshi private `user_order` / `fill` + REST refetch |
| Queue position map | **WebSocket** `/api/ws/queue_positions` — initial REST batch + pushes on scheduled refresh |
| Queue accuracy vs other traders | **REST** `GET /api/orders/queue_positions` every **5s** (`QUEUE_POLL_INTERVAL_MS`) |

---

## 5. Routes

| Path | Component |
|------|-----------|
| `/` | `ScreenerLayout` — Hot Volume Screener |
| `/market/:ticker` | `TradingPage` |

---

## 6. Implementation status

Implemented: routing, four-column layout, SSE market streams, portfolio polling, orderbook with REST+WS+queue poll as described. For engine internals, see [MARKET_ENGINE_DESIGN.md](./MARKET_ENGINE_DESIGN.md).
