# Kalshi UI — Trading Terminal

A trading screener and terminal for Kalshi prediction markets: **Hot Volume Screener** (public **REST** only) and a **Trading Page** with live market data (**SSE** + backend **WebSockets** to Kalshi).

**Full architecture (REST vs SSE vs WebSocket):** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Setup

```bash
npm install
cd server && npm install
```

> If you see `EPERM` errors with npm cache, run: `sudo chown -R $(whoami) ~/.npm`

**Frontend (.env):** Copy `.env.example` to `.env` if you use client-side keys (optional for screener-only).

**Backend (`server/.env`):** Required for live market SSE, orders, portfolio, and Kalshi WebSockets:

```
KALSHI_API_KEY_ID=your_key_id
KALSHI_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
```

## Run

**Terminal 1 — Backend (port 3001):**

```bash
npm run server
```

**Terminal 2 — Frontend:**

```bash
npm run dev
```

Vite proxies `/api/market`, `/api/orders`, `/api/portfolio`, `/api/health`, `/api/ws` to the backend, and `/api/kalshi` to Kalshi’s public REST API. Without backend keys, authenticated routes fail; the screener still works via public REST.

## Features (summary)

- **Screener (`/`)**: Category presets (e.g. NBA, college basketball, CS2, LoL, Valorant), optional event tag filter, sortable table, pagination, **10s REST refresh**, row flash on volume jumps.
- **Trading (`/market/:ticker`)**: Four-column layout (metrics + trades per side, dual orderbooks when the event has two markets). Market data via **SSE**; positions via **REST** polling; orders via **REST**; resting orders and queue via **app WebSockets** plus **REST** queue poll.

## API overview

| Area | Protocol |
|------|----------|
| Screener market lists | Kalshi public **REST** (`GET /markets`, …) via `/api/kalshi` proxy |
| Live L2, tape, metrics | **SSE** `/api/market/:ticker/stream` (browser); Kalshi **WebSocket** from the Node server |
| Portfolio & orders | Kalshi authenticated **REST** via backend proxy |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the complete table.
