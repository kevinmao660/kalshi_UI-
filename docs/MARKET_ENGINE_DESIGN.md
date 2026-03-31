# MarketEngine — Architecture & Design Document

Design for a high-performance Node.js/TypeScript **MarketEngine** module that maintains real-time state for a single Kalshi market. Optimized for ultra-low latency, minimal CPU spikes, and no memory leaks.

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
│                          │  Stream to Frontend   │                               │
│                          └───────────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      ▲
                                      │ WebSocket messages
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
3. If `seq` gap: request new snapshot via REST `GET /markets/{ticker}/orderbook` and replace state.

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

Kalshi’s orderbook is **aggregated** — only total size per price level, not individual orders. We cannot derive exact queue position from orderbook alone.

### 3.2 Approach

**Option A — Kalshi API (recommended):**
- Kalshi exposes `GET /portfolio/orders/{order_id}/queue_position`.
- When user places a limit order, store `orderId` + `price` + `side`.
- Poll queue position every 1–2 seconds, or subscribe to order updates if available.
- Cache last known position; emit when it changes.

**Option B — Estimation (fallback):**
- When user places order: record `(orderId, price, side, userSize)`.
- On each `orderbook_delta` at that price: if size decreases, contracts left the queue (trades or cancels).
- Estimate: `queuePosition ≈ currentSizeAtPrice` (assuming FIFO, we are behind all resting size).
- On each `trade` at that price: reduce estimated contracts ahead.
- This is approximate; prefer Option A when possible.

### 3.3 Implementation

- **QueuePositionTracker** holds `Map<orderId, { price, side, size, lastKnownPosition }>`.
- On order placement: `registerOrder(orderId, price, side, size)`.
- On order fill/cancel: `unregisterOrder(orderId)`.
- On orderbook delta at tracked price: update estimated position; if using API, refresh on next poll.
- Emit `queuePositionUpdate` events to frontend.

---

## 4. Feature 3: Rolling Time-Series Metrics

### 4.1 Windows

- **10-second window**
- **1-minute window**

### 4.2 Metrics

| Metric | Definition |
|-------|------------|
| Total Volume | Sum of `count` over all trades in window |
| Total Dollar Amount | Sum of `count * yes_price_dollars` (or no_price) over trades |
| Avg Trade Frequency | `tradeCount / windowSeconds` (trades per second) |

### 4.3 Data Structure

**Ring buffer of trades** with timestamps:
- Preallocate `TradeEntry[]` with max capacity (e.g. 10,000).
- Each entry: `{ ts: number, count: number, notional: number }`.
- Head pointer; evict entries older than 1 minute.
- For 10s and 60s: scan from head backwards until `now - windowMs`; O(n) but n is small.

**Alternative — Bucketed counters:**
- 1-second buckets for last 60 seconds.
- On each trade: add to current second’s bucket.
- Rolling sum: sum last 10 buckets, sum last 60 buckets.
- O(1) update, O(1) query.

### 4.4 Recommendation

Use **1-second buckets** for 60 slots. On trade:
1. `bucketIdx = (nowSeconds % 60)`.
2. If `nowSeconds` advanced, zero out overwritten bucket.
3. Add `count` and `notional` to `buckets[bucketIdx]`.
4. Expose `getMetrics10s()` and `getMetrics60s()` by summing last 10 and 60 buckets.

---

## 5. Feature 4: Recent Trades Feed

### 5.1 Structure

- **Fixed-size ring buffer** of 15 trades.
- Each: `{ tradeId, yesPrice, noPrice, count, takerSide, ts }`.
- On new trade: overwrite oldest; emit to frontend.

### 5.2 Implementation

- Array of 15 slots; `writeIndex = (writeIndex + 1) % 15`.
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
    RollingMetrics.ts     # 10s/60s buckets, volume/notional/frequency
    TradesFeed.ts         # Ring buffer of last 15 trades
    constants.ts          # Window sizes, buffer capacities
```

---

## 8. Event Contract (MarketEngine → Frontend)

| Event | Payload | When |
|-------|---------|------|
| `orderbook` | `{ yes: PriceLevel[], no: PriceLevel[] }` | Snapshot or after coalesced deltas |
| `bbo` | `{ bestBid, bestAsk }` | Top of book change |
| `trade` | `Trade` | New trade |
| `tradesFeed` | `Trade[]` (last 15) | After new trade appended |
| `rollingMetrics` | `{ window2s: {...}, window10s: {...} }` | After trade or periodic tick |
| `queuePosition` | `{ orderId, position }` | Position update for tracked order |
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

## 11. Open Questions

1. **Queue position API** — Confirm `GET /portfolio/orders/{order_id}/queue_position` exists and response shape.
2. **Order lifecycle** — Do we get WebSocket events for order fill/cancel, or only via REST?
3. **Notional** — For dollar amount, use `count * yes_price_dollars` (or no) depending on taker side.
