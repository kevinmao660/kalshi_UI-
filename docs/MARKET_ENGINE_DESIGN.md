# MarketEngine — Architecture & Design Document

Design for a high-performance TypeScript **MarketEngine** module that maintains real-time state for a single Kalshi market. In this repo the engine runs **inside the Node backend** (`server/src/index.ts`); the browser receives updates via **SSE** (`/api/market/:ticker/stream`), not by instantiating MarketEngine in the client.

**How data enters the engine:** Kalshi **WebSocket** (`orderbook_delta`, `trade`) plus **REST** snapshots for initial load and sequence-gap recovery. See [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           MarketEngine (orchestrator)                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ Orderbook    │  │ QueuePosition    │  │ RollingMetrics  │  │ TradesFeed   │ │
│  │ Manager      │  │ Tracker          │  │ Calculator      │  │ (RingBuffer) │ │
│  └──────┬───────┘  └────────┬─────────┘  └────────┬────────┘  └──────┬───────┘ │
│         │                    │                     │                 │         │
│         └────────────────────┴─────────────────────┴─────────────────┘         │
│                                      │                                            │
│                          ┌───────────▼───────────┐                               │
│                          │  EventEmitter /       │                               │
│                          │  SSE to browser       │                               │
│                          └───────────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      ▲
                                      │ WebSocket (Node ↔ Kalshi only)
                          ┌───────────┴───────────┐
                          │  Kalshi WS:           │
                          │  - orderbook_snapshot │
                          │  - orderbook_delta    │
                          │  - trade              │
                          └───────────────────────┘
```

**Design principles:**
- **Single-threaded, event-driven** — no worker threads; all work on the main event loop with minimal synchronous work.
- **Preallocated structures** — avoid allocations in hot paths; use ring buffers and fixed-size arrays.
- **Lazy / batched emissions** — coalesce updates before emitting to frontend to avoid flooding.
- **Seq-number validation** — detect gaps and trigger snapshot refresh if deltas are missed.

---

## 2. Feature 1: Live L2 Orderbook

### 2.1 Data Structures

**Price level:** Kalshi uses cents (1–99) for binary markets. We store:

```ts
// Price in cents (1-99), size in contracts (integer)
type PriceLevel = [price: number, size: number]
```

**Orderbook representation:**
- **yes** and **no** sides: `Map<number, number>` (price → size) for O(1) delta application.
- Sorted views for display: derived on-demand or cached and invalidated on delta.
- Use **cents** as keys for consistency with Kalshi’s `orderbook_delta` (price in cents).

**Why Map:**
- O(1) get/set/delete for delta application.
- No reallocation when adding/removing levels.
- Sorted iteration via `[...map.entries()].sort()` only when emitting to frontend.

### 2.2 Snapshot Handling

1. On `orderbook_snapshot`: clear both sides, apply all levels from `msg.yes` and `msg.no`.
2. Store `seq`; subsequent deltas must have `seq = lastSeq + 1`.
3. If `seq` gap: request new snapshot via REST `GET https://api.elections.kalshi.com/trade-api/v2/markets/{ticker}/orderbook` (same as server `KALSHI_ORDERBOOK_URL`) and replace state.

### 2.3 Delta Handling

- `msg.price` (cents), `msg.delta` (contracts), `msg.side` (yes/no).
- `newSize = currentSize + delta`. If `newSize <= 0`, delete the level.
- Update `lastSeq = seq`.

### 2.4 Kalshi Format Notes

- Snapshot: `yes` / `no` as `[[price_cents, size], ...]`.
- Delta: `price`, `delta`, `side`.
- `yes_dollars` / `no_dollars` available; we normalize to cents for internal state.

---

## 3. Feature 2: Queue Position Tracking

### 3.1 Constraint

Kalshi’s **public** orderbook is **aggregated** — only total size per price level. Exact queue position for your resting orders comes from the **authenticated** batch API, not from the public book alone.

### 3.2 Approach (as used in Kalshi UI)

**Primary — Kalshi REST batch endpoint:**
- `GET /portfolio/orders/queue_positions` with `event_ticker` and/or `market_tickers`, returns rows keyed by `order_id` with `queue_position` / `queue_position_fp`.
- The **OrderbookPanel** and server fan-out also use **WebSocket** pushes and **REST** `queue_positions` whenever the **SSE orderbook** updates so queue place tracks when *other* traders move the line (private `user_orders` WS alone is insufficient).

**Fallback — `QueuePositionTracker` estimation** (`src/market-engine/QueuePositionTracker.ts`):
- Optional `fetchPosition(orderId)` from REST, or infer from size-at-price on the L2 book when API mode is not wired.
- Used when extending the engine; the trading UI’s source of truth for displayed queue is the REST batch + server WS + poll path described in [ARCHITECTURE.md](./ARCHITECTURE.md).

### 3.3 Implementation (engine module)

- **QueuePositionTracker** holds `Map<orderId, { price, side, size, lastKnownPosition }>`.
- `registerOrder` / `unregisterOrder` when tracking inside the engine.
- `onOrderbookDeltaAt` can update coarse estimates; `setFetchPosition` enables API-backed refresh.
- Emits `queuePosition` events on the engine EventEmitter (browser receives market events via SSE; queue display is separate).

---

## 4. Feature 3: Rolling Time-Series Metrics

### 4.1 Windows (`src/market-engine/constants.ts`)

- **Short:** **2s** (`WINDOW_SHORT`) — exposed as `window2s`
- **Long:** **10s** (`WINDOW_LONG`) — exposed as `window10s`
- **Buckets:** **60** one-second slots (`METRICS_BUCKET_COUNT`) backing both windows

### 4.2 Metrics

| Metric | Definition |
|-------|------------|
| Volume | Sum of `count` over trades in window |
| Notional | Sum of trade notional in window |
| Trades per second | `tradeCount / windowSeconds` |

Per-window YES/NO taker breakdown is included (`RollingMetrics.ts`).

### 4.3 Data structure (implemented)

**1-second bucket ring (60 slots):** on each trade, add to the current second’s bucket; `getMetrics(n)` sums the last `n` seconds. `getRollingMetrics()` returns `{ window2s, window10s }`.

---

## 5. Feature 4: Recent Trades Feed

### 5.1 Structure

- **Fixed-size ring buffer**; capacity **`TRADES_FEED_SIZE`** (30 in `constants.ts`).
- Each: `{ tradeId, yesPrice, noPrice, count, takerSide, ts }`.
- On new trade: overwrite oldest; emit to frontend.

### 5.2 Implementation

- Ring buffer; `writeIndex = (writeIndex + 1) % TRADES_FEED_SIZE`.
- No allocations in hot path; reuse objects if possible.

---

## 6. Additional Features (Recommended)

### 6.1 Best Bid/Offer (BBO) Cache

- Maintain `bestBid`, `bestAsk` (or best yes/no) and update only when top of book changes.
- Avoids scanning full book for every delta.

### 6.2 Mid-Price & Spread

- `midPrice = (bestBid + bestAsk) / 2`
- `spread = bestAsk - bestBid`
- Useful for UI and simple signals.

### 6.3 Sequence Gap Detection & Recovery

- Track `lastSeq`; if incoming `seq !== lastSeq + 1`, set `needsSnapshot = true`.
- Background: fetch REST snapshot and replace state; resume from new seq.

### 6.4 Heartbeat / Stale Detection

- If no message for N seconds, mark `stale` and optionally reconnect.
- Emit `stale` event so UI can show warning.

### 6.5 Memory Bounds

- Cap ring buffer sizes.
- No unbounded arrays or maps.
- Explicit `destroy()` to clear references and allow GC.

### 6.6 Backpressure for Frontend Stream

- If frontend is slow, buffer updates (e.g. last state only) and emit on `drain`.
- Prefer **snapshot + incremental** over full dumps when possible.

---

## 7. File Structure

```
src/
  market-engine/
    index.ts              # MarketEngine facade, wires submodules
    types.ts              # Shared types (PriceLevel, Trade, etc.)
    OrderbookManager.ts   # L2 book, snapshot/delta handling
    QueuePositionTracker.ts # Order queue position (API + estimation)
    RollingMetrics.ts     # 2s/10s windows via 60×1s buckets
    TradesFeed.ts         # Ring buffer of recent trades (size TRADES_FEED_SIZE)
    constants.ts          # Window sizes, buffer capacities
```

---

## 8. Event Contract (MarketEngine → SSE clients)

Serialized as JSON on the SSE wire (`{ event, data }`). The browser **EventSource** client is in `src/api/market.ts` / `useMarketStream`.

| Event | Payload | When |
|-------|---------|------|
| `orderbook` | `{ yes: PriceLevel[], no: PriceLevel[] }` | Snapshot or after coalesced deltas |
| `bbo` | `{ bestBid, bestAsk }` | Top of book change |
| `trade` | `Trade` | New trade |
| `tradesFeed` | `Trade[]` (last `TRADES_FEED_SIZE`, default 30) | After new trade appended |
| `rollingMetrics` | `{ window2s: {...}, window10s: {...} }` | After trade or periodic tick |
| `queuePosition` | `orderId`, position (via engine tracker) | If queue tracker wired |
| `stale` | `boolean` | Connection stale |
| `seqGap` | `{ expected, received }` | Seq gap detected |

---

## 9. Latency & Performance Notes

- **No async in hot path** for orderbook delta: sync update, sync emit.
- **Batch emits**: e.g. max 60 orderbook emits/sec; coalesce deltas within 16ms.
- **Avoid JSON.stringify in hot path**: pre-serialize or use binary if needed.
- **V8 optimization**: keep functions small; avoid closures over large objects in hot path.

---

## 10. Kalshi WebSocket Message Types (Reference)

| Type | Channel | Use |
|------|---------|-----|
| `orderbook_snapshot` | orderbook_delta | Initial state |
| `orderbook_delta` | orderbook_delta | Incremental update |
| `trade` | trade | Public trade |

**Trade payload:** `trade_id`, `market_ticker`, `yes_price`, `no_price`, `count`, `taker_side`, `ts`

---

## 11. Related implementation notes

1. **Queue position** — This app uses the **batch** endpoint `GET /portfolio/orders/queue_positions` (see `src/api/orders.ts` and server proxy), not a per-order URL.
2. **Order lifecycle** — Kalshi **private WebSocket** (`user_orders`, `fill`) on the server triggers **REST** refetches of resting orders and queue maps; the browser does not subscribe to Kalshi private WS directly. See [ARCHITECTURE.md](./ARCHITECTURE.md).
3. **Notional** — Implemented in `RollingMetrics` / trade normalization in the engine per Kalshi trade fields.
