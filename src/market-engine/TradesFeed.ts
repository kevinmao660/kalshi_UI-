import type { Trade } from './types'
import { TRADES_FEED_SIZE } from './constants'

export type TradesFeedListener = (trades: Trade[]) => void

export class TradesFeed {
  private buffer: Trade[] = []
  private writeIndex = 0
  private listeners: Set<TradesFeedListener> = new Set()

  push(trade: Trade): void {
    if (this.buffer.length < TRADES_FEED_SIZE) {
      this.buffer.push(trade)
    } else {
      this.buffer[this.writeIndex] = trade
      this.writeIndex = (this.writeIndex + 1) % TRADES_FEED_SIZE
    }
    this.emit()
  }

  getTrades(): Trade[] {
    if (this.buffer.length < TRADES_FEED_SIZE) return [...this.buffer].reverse()
    const out: Trade[] = []
    for (let i = 0; i < TRADES_FEED_SIZE; i++) {
      const idx = (this.writeIndex + i) % TRADES_FEED_SIZE
      out.push(this.buffer[idx])
    }
    return out.reverse()
  }

  onUpdate(listener: TradesFeedListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    const trades = this.getTrades()
    for (const fn of this.listeners) fn(trades)
  }

  destroy(): void {
    this.listeners.clear()
    this.buffer = []
  }
}
