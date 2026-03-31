/**
 * MarketEngine — Real-time state for a single Kalshi market.
 * Ingests WebSocket orderbook + trade data, maintains L2 book, rolling metrics,
 * recent trades feed, and queue position tracking.
 */
/**
 * Kalshi trade legs: `yes_price` / `no_price` are integers 1–99 (cents). Use `*_price_dollars`
 * when present. (A value of 1 must be $0.01, not $1.00.)
 */
function kalshiLegPriceToDollars(centsField, dollarsStr) {
    if (dollarsStr != null && String(dollarsStr).trim() !== '') {
        const d = parseFloat(String(dollarsStr));
        if (Number.isFinite(d))
            return d;
    }
    const n = typeof centsField === 'number' ? centsField : parseFloat(String(centsField ?? 0));
    if (!Number.isFinite(n) || n === 0)
        return 0;
    if (Number.isInteger(n) && n >= 1 && n <= 99)
        return n / 100;
    if (n > 0 && n < 1)
        return n;
    if (n > 1 && n <= 99)
        return n / 100;
    return n / 100;
}
/** Minimal EventEmitter for browser compatibility (no Node 'events' dependency) */
class EventEmitter {
    listeners = new Map();
    on(event, fn) {
        if (!this.listeners.has(event))
            this.listeners.set(event, new Set());
        this.listeners.get(event).add(fn);
        return this;
    }
    emit(event, ...args) {
        const fns = this.listeners.get(event);
        if (!fns)
            return false;
        for (const fn of fns)
            fn(...args);
        return true;
    }
    removeAllListeners() {
        this.listeners.clear();
        return this;
    }
}
import { OrderbookManager } from './OrderbookManager';
import { TradesFeed } from './TradesFeed';
import { RollingMetrics } from './RollingMetrics';
import { WINDOW_LONG, WINDOW_SHORT } from './constants.js';
import { QueuePositionTracker } from './QueuePositionTracker';
export class MarketEngine extends EventEmitter {
    marketTicker;
    orderbook;
    tradesFeed;
    metrics;
    queueTracker;
    lastMessageTs = 0;
    staleThresholdMs;
    staleTimer = null;
    needsSnapshot = false;
    constructor(options) {
        super();
        this.marketTicker = options.marketTicker;
        this.staleThresholdMs = (options.staleThresholdSeconds ?? 30) * 1000;
        this.orderbook = new OrderbookManager();
        this.tradesFeed = new TradesFeed();
        this.metrics = new RollingMetrics();
        this.queueTracker = new QueuePositionTracker();
        if (options.fetchQueuePosition) {
            this.queueTracker.setFetchPosition(options.fetchQueuePosition);
        }
        this.orderbook.onOrderbook((ob) => this.emit('orderbook', ob));
        this.orderbook.onBBO((bbo) => this.emit('bbo', bbo));
        this.tradesFeed.onUpdate((trades) => this.emit('tradesFeed', trades));
        this.metrics.onUpdate((m) => this.emit('rollingMetrics', m));
        this.queueTracker.onUpdate((orderId, pos) => this.emit('queuePosition', orderId, pos));
        this.orderbook.onOrderbook(() => {
            this.queueTracker.onOrderbookDeltaAt(this.orderbook);
        });
    }
    // ─── Public API ───────────────────────────────────────────────────────────
    /** Apply snapshot to orderbook. Call when receiving orderbook_snapshot or REST orderbook. */
    applyOrderbookSnapshot(msg) {
        this.touch();
        const m = msg;
        const raw = m?.orderbook_fp && typeof m.orderbook_fp === 'object'
            ? m.orderbook_fp
            : m?.orderbook && typeof m.orderbook === 'object'
                ? m.orderbook
                : msg;
        this.orderbook.applySnapshot(raw);
        this.needsSnapshot = false;
    }
    /** Apply delta to orderbook. Call when receiving orderbook_delta. */
    applyOrderbookDelta(msg, seq) {
        this.touch();
        if (this.needsSnapshot)
            return false;
        if (!this.orderbook.checkSeq(seq)) {
            this.emit('seqGap', { expected: this.orderbook.getLastSeq() + 1, received: seq });
            this.needsSnapshot = true;
            return false;
        }
        return this.orderbook.applyDelta(msg, seq);
    }
    /** Process a trade. Call when receiving trade message. */
    processTrade(msg) {
        this.touch();
        const yesPrice = kalshiLegPriceToDollars(msg.yes_price, msg.yes_price_dollars);
        const noPrice = kalshiLegPriceToDollars(msg.no_price, msg.no_price_dollars);
        const count = typeof msg.count === 'number' ? msg.count : Math.round(parseFloat(String(msg.count ?? msg.count_fp ?? 0)));
        const price = msg.taker_side === 'yes' ? yesPrice : noPrice;
        const notional = count * price;
        const trade = {
            tradeId: String(msg.trade_id ?? ''),
            yesPrice,
            noPrice,
            count,
            notional,
            takerSide: msg.taker_side,
            ts: msg.ts ?? Date.now(),
        };
        this.tradesFeed.push(trade);
        const side = msg.taker_side === 'no' ? 'no' : 'yes';
        this.metrics.recordTrade(count, notional, side);
        this.emit('trade', trade);
    }
    /** Register an order for queue position tracking. */
    registerOrder(orderId, price, side, size) {
        this.queueTracker.registerOrder(orderId, price, side, size);
    }
    /** Unregister order when filled or cancelled. */
    unregisterOrder(orderId) {
        this.queueTracker.unregisterOrder(orderId);
    }
    /** Refresh queue position from API (if configured). */
    async refreshQueuePosition(orderId) {
        return this.queueTracker.refreshPosition(orderId);
    }
    /** Get current orderbook snapshot. */
    getOrderbook() {
        return this.orderbook.getOrderbook();
    }
    /** Get best bid/offer. */
    getBBO() {
        return this.orderbook.getBBO();
    }
    /** Get last 30 trades (newest first). */
    getTrades() {
        return this.tradesFeed.getTrades();
    }
    /** Get rolling metrics for 2s and 10s windows. */
    getRollingMetrics() {
        return {
            window2s: this.metrics.getMetrics(WINDOW_SHORT),
            window10s: this.metrics.getMetrics(WINDOW_LONG),
        };
    }
    /** Whether a snapshot is needed (e.g. after seq gap). */
    getNeedsSnapshot() {
        return this.needsSnapshot;
    }
    /** Request snapshot refresh. Caller should fetch REST orderbook and call applyOrderbookSnapshot. */
    requestSnapshot() {
        this.needsSnapshot = true;
    }
    /** Process raw WebSocket message. Handles { type, seq?, msg } wrapper. */
    processMessage(raw) {
        const { type, seq, msg } = raw;
        if (!type || !msg || typeof msg !== 'object')
            return;
        const m = msg;
        const ticker = String(m.market_ticker ?? '');
        if (ticker && ticker !== this.marketTicker)
            return;
        switch (type) {
            case 'orderbook_snapshot':
                this.applyOrderbookSnapshot(msg);
                break;
            case 'orderbook_delta':
                this.applyOrderbookDelta(msg, seq ?? this.orderbook.getLastSeq() + 1);
                break;
            case 'trade':
                this.processTrade(msg);
                break;
            default:
                break;
        }
    }
    destroy() {
        this.orderbook.destroy();
        this.tradesFeed.destroy();
        this.metrics.destroy();
        this.queueTracker.destroy();
        if (this.staleTimer)
            clearTimeout(this.staleTimer);
        this.removeAllListeners();
    }
    // ─── Private ──────────────────────────────────────────────────────────────
    touch() {
        this.lastMessageTs = Date.now();
        if (this.staleTimer)
            clearTimeout(this.staleTimer);
        this.staleTimer = setTimeout(() => this.checkStale(), this.staleThresholdMs);
        this.emit('stale', false);
    }
    checkStale() {
        if (Date.now() - this.lastMessageTs >= this.staleThresholdMs) {
            this.emit('stale', true);
        }
        this.staleTimer = null;
    }
}
