# Kalshi UI — Architecture & Data Transport

This document describes how the app is structured and **which network transports are used where**: **REST**, **Server-Sent Events (SSE)**, and **WebSockets** (browser ↔ this repo’s backend, and backend ↔ Kalshi).

---

## 1. Runtime layout

| Layer | Role |
|-------|------|
| **Vite SPA** (`src/`) | Hot Volume Screener (`/`), Trading Page (`/market/:ticker`). Calls public Kalshi REST via proxy; calls the **local backend** for trading, portfolio, and live market streams. |
| **Node backend** (`server/`) | Proxies authenticated Kalshi REST; runs **MarketEngine** per subscribed market; exposes **SSE** for public market data; exposes **WebSockets** for queue positions and resting orders; connects **outbound WebSockets** to Kalshi (public market + private user data). |

**Dev:** Vite (`npm run dev`, typically port 5173) proxies `/api/kalshi`, `/api/market`, `/api/orders`, `/api/portfolio`, `/api/health`, and `/api/ws` — see `vite.config.ts`. The backend defaults to port **3001** (`npm run server`).

---

## 2. Transport matrix (quick reference)

| Feature | Browser transport | Backend → Kalshi |
|---------|-------------------|------------------|
| Screener: list markets, volumes, prices | **REST** (public `GET /markets…` via `/api/kalshi` proxy) | Same (HTTP) |
| Trading: L2 book, trades tape, rolling metrics | **SSE** `GET /api/market/:ticker/stream` + initial **REST** `GET /api/market/:ticker/snapshot` | **WebSocket** `orderbook_delta` + `trade` (authenticated); **REST** snapshot for seed + recovery |
| Trading: portfolio positions (contracts, exposure) | **REST** `GET /api/portfolio/positions` (polled ~2.5s on Trading Page) | **REST** `GET /portfolio/positions` |
| Trading: place / cancel orders | **REST** `POST /api/orders`, `DELETE /api/orders/:id` | **REST** |
| Trading: resting orders list | **WebSocket** `/api/ws/resting_orders` (push) + Kalshi **REST** list behind the scenes | **REST** `GET /portfolio/orders`; **WebSocket** `user_orders` + `fill` triggers refresh |
| Trading: queue position per order | **WebSocket** `/api/ws/queue_positions` + **REST** `GET /api/orders/queue_positions` on each **SSE orderbook** update (OrderbookPanel) | **REST** `GET /portfolio/orders/queue_positions`; **WebSocket** `user_order` triggers refresh |

**Important distinctions:**

- **Browser does not open a WebSocket to Kalshi.** The Node server holds Kalshi WS connections and feeds **MarketEngine**; the browser uses **SSE** (`EventSource`) for market data.
- **Portfolio positions** are **REST-only** in the browser (polling). They are not streamed over SSE/WS in this project.
- **Queue position** needs **REST** because other participants’ trades change your place in line; Kalshi’s private WS does not fully substitute for **`queue_positions`** GETs. The UI uses **both** app WebSocket (server-pushed snapshots after events) and **REST** refetch whenever the **SSE orderbook** updates.

---

## 3. Hot Volume Screener (`/`)

- **Transport:** **REST only** (no SSE/WebSocket on this page).
- **Refresh:** `useEffect` in `App.tsx` runs `refresh()` on mount and every **10 seconds** (`setInterval(..., 10_000)`).
- **API:** `src/api/kalshi.ts` — in dev, `fetch` goes to `/api/kalshi/...` → Vite rewrites to Kalshi `trade-api/v2` (avoids CORS). Uses `GET /markets` with `series_ticker` or `event_ticker` from `src/store/screener.ts`.
- **State:** Zustand (`useScreenerStore`): categories (NBA, CS2, etc.), optional event tag, sort, pagination, row flash on volume delta.

---

## 4. Trading Page (`/market/:ticker`)

### 4.1 Market metadata

- **REST** via `fetchMarketByTicker`, `fetchAllMarketsForEvent` (`src/api/kalshi.ts`) — resolves event, paired outcomes, labels.

### 4.2 Live orderbook, trades, BBO, rolling metrics

- **Hook:** `useMarketStream` (`src/hooks/useMarketStream.ts`).
- **Initial load:** **REST** `GET /api/market/:ticker/snapshot` → `fetchMarketSnapshot` (`src/api/market.ts`).
- **Updates:** **SSE** `GET /api/market/:ticker/stream` → `connectMarketStream` uses `EventSource`; JSON lines parse to `orderbook`, `tradesFeed`, `rollingMetrics`, `bbo`, `stale`, etc.

### 4.3 Server-side MarketEngine + Kalshi

- **MarketEngine** (`src/market-engine/`) runs **inside the Node process** (`server/src/index.ts`).
- On first client for a ticker: `getOrCreateEngine` loads a **REST** orderbook snapshot from Kalshi public URL `GET .../markets/{ticker}/orderbook`, then connects **Kalshi WebSocket** with channels `orderbook_delta` and `trade` (`server/src/kalshi-ws.ts` `connectKalshiWs`).
- On sequence gap, engine refetches the same **REST** orderbook snapshot.
- When the last SSE client disconnects, the engine and Kalshi WS for that ticker are torn down.

### 4.4 Portfolio (positions)

- **REST** `fetchPortfolioPositions` → `/api/portfolio/positions` → Kalshi `GET /portfolio/positions`.
- Trading Page polls on an interval (~**2.5s**) and also schedules a debounced refetch after order activity (`onPortfolioRefreshHint`).

### 4.5 Orders, queue, resting ladder

- **Place/cancel:** **REST** (`createOrder`, `cancelOrder` → `/api/orders`).
- **Resting orders:** **WebSocket** `subscribeRestingOrders` → `/api/ws/resting_orders?ticker=…&event_ticker=…`. Server sends an initial **REST** snapshot and pushes updates when Kalshi **private** WS reports `user_order` or `fill` (coalesced refresh).
- **Queue positions:** **WebSocket** `subscribeQueuePositions` → `/api/ws/queue_positions?...` plus **REST** `fetchQueuePositionsForMarket` whenever **`yes`/`no`** orderbook props change (SSE). Private Kalshi WS `user_order` also schedules a server-side queue refresh for that market.

---

## 5. Backend routes (this repo)

### 5.1 REST (Express)

| Route | Purpose |
|-------|---------|
| `GET /api/market/:ticker/snapshot` | One-shot orderbook + trades + metrics + BBO from MarketEngine |
| `GET /api/market/:ticker/stream` | **SSE** stream of engine events |
| `GET /api/portfolio/positions` | Proxy to Kalshi portfolio positions |
| `GET /api/orders` | List orders (e.g. resting) |
| `GET /api/orders/queue_positions` | Batch queue positions |
| `POST /api/orders` | Create order |
| `DELETE /api/orders/:orderId` | Cancel order |
| `GET /api/health` | Liveness |

### 5.2 WebSocket (browser ↔ Node, `ws` upgrade)

| Path | Payload (examples) |
|------|---------------------|
| `/api/ws/queue_positions?ticker=&event_ticker=` | `{ type: 'queue_positions', ticker, positions }` |
| `/api/ws/resting_orders?ticker=&event_ticker=` | `{ type: 'resting_orders', ticker, orders, portfolio_refresh? }` |

### 5.3 Kalshi outbound WebSockets (Node only)

| Connection | Channels | Use |
|------------|----------|-----|
| Public (`connectKalshiWs`) | `orderbook_delta`, `trade` | Feed MarketEngine per market |
| Private (`connectKalshiPrivateDataWs`) | `user_orders`, `fill` | Invalidate/rest **resting_orders** and **queue_positions** snapshots for subscribed browsers |

---

## 6. Related docs

| Doc | Topic |
|-----|--------|
| [HOT_VOLUME_SCREENER_DESIGN.md](./HOT_VOLUME_SCREENER_DESIGN.md) | Screener UX, REST-only polling |
| [TRADING_PAGE_DESIGN.md](./TRADING_PAGE_DESIGN.md) | Trading layout and data flow |
| [MARKET_ENGINE_DESIGN.md](./MARKET_ENGINE_DESIGN.md) | Engine internals, Kalshi message types |
| [kalshi/](./kalshi/) | Kalshi API notes and references |

---

## 7. Configuration

- **Frontend:** `.env` — see root `README.md` (optional `VITE_*` for Kalshi base URL in production builds).
- **Backend:** `server/.env` — `KALSHI_API_KEY_ID`, `KALSHI_PRIVATE_KEY_PEM` for authenticated REST + WS; without them, portfolio/order routes return 503 and MarketEngine may run without live Kalshi WS (snapshot-only behavior depends on server code paths).
