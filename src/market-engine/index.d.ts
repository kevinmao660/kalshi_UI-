/**
 * MarketEngine — Real-time state for a single Kalshi market.
 * Ingests WebSocket orderbook + trade data, maintains L2 book, rolling metrics,
 * recent trades feed, and queue position tracking.
 */
import type { PriceLevel, Trade, KalshiTrade, OrderbookSnapshotMsg, OrderbookDeltaMsg } from './types';
/** Minimal EventEmitter for browser compatibility (no Node 'events' dependency) */
declare class EventEmitter {
    private listeners;
    on(event: string, fn: (...args: unknown[]) => void): this;
    emit(event: string, ...args: unknown[]): boolean;
    removeAllListeners(): this;
}
import type { WindowMetrics } from './types';
export interface MarketEngineEvents {
    orderbook: (ob: {
        yes: PriceLevel[];
        no: PriceLevel[];
    }) => void;
    bbo: (bbo: {
        bestBid: number | null;
        bestAsk: number | null;
    }) => void;
    trade: (trade: Trade) => void;
    tradesFeed: (trades: Trade[]) => void;
    rollingMetrics: (m: {
        window2s: WindowMetrics;
        window10s: WindowMetrics;
    }) => void;
    queuePosition: (orderId: string, position: number | null) => void;
    stale: (stale: boolean) => void;
    seqGap: (payload: {
        expected: number;
        received: number;
    }) => void;
}
export interface MarketEngineOptions {
    marketTicker: string;
    /** Optional: fetch queue position from Kalshi API */
    fetchQueuePosition?: (orderId: string) => Promise<number | null>;
    /** Seconds without messages before marking stale */
    staleThresholdSeconds?: number;
}
export declare class MarketEngine extends EventEmitter {
    readonly marketTicker: string;
    private readonly orderbook;
    private readonly tradesFeed;
    private readonly metrics;
    private readonly queueTracker;
    private lastMessageTs;
    private staleThresholdMs;
    private staleTimer;
    private needsSnapshot;
    constructor(options: MarketEngineOptions);
    /** Apply snapshot to orderbook. Call when receiving orderbook_snapshot or REST orderbook. */
    applyOrderbookSnapshot(msg: OrderbookSnapshotMsg | {
        orderbook?: OrderbookSnapshotMsg;
        orderbook_fp?: OrderbookSnapshotMsg;
    }): void;
    /** Apply delta to orderbook. Call when receiving orderbook_delta. */
    applyOrderbookDelta(msg: OrderbookDeltaMsg, seq: number): boolean;
    /** Process a trade. Call when receiving trade message. */
    processTrade(msg: KalshiTrade): void;
    /** Register an order for queue position tracking. */
    registerOrder(orderId: string, price: number, side: 'yes' | 'no', size: number): void;
    /** Unregister order when filled or cancelled. */
    unregisterOrder(orderId: string): void;
    /** Refresh queue position from API (if configured). */
    refreshQueuePosition(orderId: string): Promise<number | null>;
    /** Get current orderbook snapshot. */
    getOrderbook(): {
        yes: PriceLevel[];
        no: PriceLevel[];
    };
    /** Get best bid/offer. */
    getBBO(): {
        bestBid: number | null;
        bestAsk: number | null;
    };
    /** Get last 30 trades (newest first). */
    getTrades(): Trade[];
    /** Get rolling metrics for 2s and 10s windows. */
    getRollingMetrics(): {
        window2s: WindowMetrics;
        window10s: WindowMetrics;
    };
    /** Whether a snapshot is needed (e.g. after seq gap). */
    getNeedsSnapshot(): boolean;
    /** Request snapshot refresh. Caller should fetch REST orderbook and call applyOrderbookSnapshot. */
    requestSnapshot(): void;
    /** Process raw WebSocket message. Handles { type, seq?, msg } wrapper. */
    processMessage(raw: {
        type?: string;
        seq?: number;
        msg?: unknown;
    }): void;
    destroy(): void;
    private touch;
    private checkStale;
}
export type { PriceLevel, Trade, KalshiTrade, OrderbookSnapshotMsg, OrderbookDeltaMsg, WindowMetrics, TrackedOrder, } from './types';
