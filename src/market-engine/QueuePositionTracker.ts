import type { TrackedOrder } from './types'

export type QueuePositionListener = (orderId: string, position: number | null) => void

/**
 * Tracks order queue positions. Kalshi's orderbook is aggregated (no per-order visibility),
 * so we support two modes:
 * 1. API mode: caller provides fetcher (e.g. from GET /portfolio/orders/queue_positions batch + match)
 * 2. Estimate mode: infer from orderbook deltas at our price (contracts ahead ≈ size at price)
 */
export class QueuePositionTracker {
  private orders: Map<string, TrackedOrder> = new Map()
  private listeners: Set<QueuePositionListener> = new Set()
  private fetchPosition: ((orderId: string) => Promise<number | null>) | null = null

  setFetchPosition(fn: (orderId: string) => Promise<number | null>): void {
    this.fetchPosition = fn
  }

  registerOrder(orderId: string, price: number, side: 'yes' | 'no', size: number): void {
    this.orders.set(orderId, {
      orderId,
      price,
      side,
      size,
      lastKnownPosition: null,
    })
  }

  unregisterOrder(orderId: string): void {
    this.orders.delete(orderId)
  }

  onOrderbookDeltaAt(orderbook: { getSizeAt: (side: 'yes' | 'no', price: number) => number }): void {
    for (const o of this.orders.values()) {
      const sizeAtPrice = orderbook.getSizeAt(o.side, o.price)
      const estimated = sizeAtPrice
      if (o.lastKnownPosition !== estimated) {
        o.lastKnownPosition = estimated
        this.emit(o.orderId, estimated)
      }
    }
  }

  async refreshPosition(orderId: string): Promise<number | null> {
    const o = this.orders.get(orderId)
    if (!o) return null
    if (this.fetchPosition) {
      const pos = await this.fetchPosition(orderId)
      o.lastKnownPosition = pos
      this.emit(orderId, pos)
      return pos
    }
    return o.lastKnownPosition
  }

  getPosition(orderId: string): number | null {
    return this.orders.get(orderId)?.lastKnownPosition ?? null
  }

  onUpdate(listener: QueuePositionListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(orderId: string, position: number | null): void {
    for (const fn of this.listeners) fn(orderId, position)
  }

  destroy(): void {
    this.orders.clear()
    this.listeners.clear()
    this.fetchPosition = null
  }
}
