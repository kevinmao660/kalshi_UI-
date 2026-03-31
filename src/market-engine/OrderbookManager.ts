import type { PriceLevel, OrderbookSnapshotMsg, OrderbookDeltaMsg } from './types'
import { ORDERBOOK_EMIT_THROTTLE_MS } from './constants'

export type OrderbookListener = (orderbook: { yes: PriceLevel[]; no: PriceLevel[] }) => void
export type BBOListener = (bbo: { bestBid: number | null; bestAsk: number | null }) => void

export class OrderbookManager {
  private yes: Map<number, number> = new Map()
  private no: Map<number, number> = new Map()
  private lastSeq: number = 0
  private listeners: Set<OrderbookListener> = new Set()
  private bboListeners: Set<BBOListener> = new Set()
  private throttleTimer: ReturnType<typeof setTimeout> | null = null
  private pendingEmit = false

  applySnapshot(msg: OrderbookSnapshotMsg): void {
    this.yes.clear()
    this.no.clear()
    const levels = msg.yes ?? msg.yes_dollars
    if (levels) {
      for (const [price, size] of levels) {
        const p = this.normalizePriceCents(price)
        const s = typeof size === 'string' ? Math.round(parseFloat(size)) : size
        if (p >= 1 && p <= 99 && s > 0) this.yes.set(p, s)
      }
    }
    const noLevels = msg.no ?? msg.no_dollars
    if (noLevels) {
      for (const [price, size] of noLevels) {
        const p = this.normalizePriceCents(price)
        const s = typeof size === 'string' ? Math.round(parseFloat(size)) : size
        if (p >= 1 && p <= 99 && s > 0) this.no.set(p, s)
      }
    }
    this.scheduleEmit()
  }

  /**
   * YES/NO prices from API/WS:
   * - Dollars: "0.53" or 0.53 → cents
   * - Integer cents: 53 or "53" (no decimal) → 53
   */
  private normalizePriceCents(price: string | number): number {
    if (typeof price === 'string') {
      const f = parseFloat(price)
      if (price.includes('.') || (f > 0 && f < 1)) {
        return Math.round(f * 100)
      }
      return Math.round(f)
    }
    if (price > 0 && price < 1) return Math.round(price * 100)
    return Math.round(price)
  }

  applyDelta(msg: OrderbookDeltaMsg, seq: number): boolean {
    const side = msg.side === 'yes' ? this.yes : this.no
    const current = side.get(msg.price) ?? 0
    const next = current + msg.delta
    if (next <= 0) {
      side.delete(msg.price)
    } else {
      side.set(msg.price, next)
    }
    this.lastSeq = seq
    this.scheduleEmit()
    return true
  }

  getLastSeq(): number {
    return this.lastSeq
  }

  checkSeq(seq: number): boolean {
    return seq === this.lastSeq + 1
  }

  getOrderbook(): { yes: PriceLevel[]; no: PriceLevel[] } {
    const sortDesc = (a: PriceLevel, b: PriceLevel) => b[0] - a[0]
    return {
      yes: [...this.yes.entries()].map(([p, s]) => [p, s] as PriceLevel).sort(sortDesc),
      no: [...this.no.entries()].map(([p, s]) => [p, s] as PriceLevel).sort(sortDesc),
    }
  }

  getBBO(): { bestBid: number | null; bestAsk: number | null } {
    const yesLevels = [...this.yes.keys()].sort((a, b) => b - a)
    const noLevels = [...this.no.keys()].sort((a, b) => a - b)
    return {
      bestBid: yesLevels[0] ?? null,
      bestAsk: noLevels[0] ?? null,
    }
  }

  getSizeAt(side: 'yes' | 'no', price: number): number {
    const map = side === 'yes' ? this.yes : this.no
    return map.get(price) ?? 0
  }

  onOrderbook(listener: OrderbookListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onBBO(listener: BBOListener): () => void {
    this.bboListeners.add(listener)
    return () => this.bboListeners.delete(listener)
  }

  private scheduleEmit(): void {
    if (this.pendingEmit) return
    this.pendingEmit = true
    this.throttleTimer = setTimeout(() => {
      this.pendingEmit = false
      this.throttleTimer = null
      this.emit()
    }, ORDERBOOK_EMIT_THROTTLE_MS)
  }

  private emit(): void {
    const ob = this.getOrderbook()
    for (const fn of this.listeners) fn(ob)
    const bbo = this.getBBO()
    for (const fn of this.bboListeners) fn(bbo)
  }

  destroy(): void {
    if (this.throttleTimer) clearTimeout(this.throttleTimer)
    this.listeners.clear()
    this.bboListeners.clear()
    this.yes.clear()
    this.no.clear()
  }
}
