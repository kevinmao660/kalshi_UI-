# Kalshi UI — Trading Terminal

A professional-grade trading screener and terminal for Kalshi prediction markets. Hot Volume Screener (REST) + single-market Trading Page (WebSocket via backend).

## Setup

```bash
npm install
cd server && npm install
```

> If you see `EPERM` errors with npm cache, run: `sudo chown -R $(whoami) ~/.npm`

**Frontend (.env):** Copy `.env.example` to `.env`:
```
VITE_KALSHI_API_KEY_ID=your_key_id
VITE_KALSHI_API_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

**Backend (server/.env):** For live WebSocket + order placement:
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

Vite proxies `/api/market`, `/api/orders`, `/api/health` to the backend. Without backend keys, the trading page uses REST snapshot only (no live WS).

## Features

- **Top Navbar**: Logo, search bar, live account balance
- **Left Sidebar**: All Sports / Esports presets + custom event tag input
- **Main Table**: Market name, YES/NO ask, 5m volume (proxy: 24h), daily volume, time remaining, Trade button
- **Pagination**: 25/50/100 per page, Prev/Next, page numbers
- **10s refresh**: REST API polling (no WebSockets on this page)
- **Row flash**: Green pulse on 5m volume cell when volume jumps between responses

## API

Uses Kalshi REST API:
- `GET /markets` — public, no auth
- `GET /portfolio/balance` — requires API key + RSA-PSS signature

Markets endpoint supports `series_ticker`, `event_ticker`, `status=open`. Configure series via `VITE_KALSHI_SERIES_SPORTS` and `VITE_KALSHI_SERIES_ESPORTS`.
