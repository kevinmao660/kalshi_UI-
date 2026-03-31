import type { WindowMetrics } from './types'
import { WINDOW_SHORT, WINDOW_LONG, METRICS_BUCKET_COUNT } from './constants'

interface Bucket {
  /** Unix second this bucket was last written for (avoids 60s ring collisions). */
  atSec: number
  volume: number
  notional: number
  tradeCount: number
  volumeYes: number
  notionalYes: number
  volumeNo: number
  notionalNo: number
}

export type RollingMetricsListener = (m: {
  window2s: WindowMetrics
  window10s: WindowMetrics
}) => void

export class RollingMetrics {
  private buckets: Bucket[] = Array.from({ length: METRICS_BUCKET_COUNT }, () => ({
    atSec: -1,
    volume: 0,
    notional: 0,
    tradeCount: 0,
    volumeYes: 0,
    notionalYes: 0,
    volumeNo: 0,
    notionalNo: 0,
  }))
  private listeners: Set<RollingMetricsListener> = new Set()

  recordTrade(count: number, notional: number, takerSide: 'yes' | 'no'): void {
    const nowSec = Math.floor(Date.now() / 1000)
    const idx = ((nowSec % METRICS_BUCKET_COUNT) + METRICS_BUCKET_COUNT) % METRICS_BUCKET_COUNT
    const b = this.buckets[idx]
    if (b.atSec !== nowSec) {
      b.atSec = nowSec
      b.volume = 0
      b.notional = 0
      b.tradeCount = 0
      b.volumeYes = 0
      b.notionalYes = 0
      b.volumeNo = 0
      b.notionalNo = 0
    }

    b.volume += count
    b.notional += notional
    b.tradeCount += 1
    if (takerSide === 'yes') {
      b.volumeYes += count
      b.notionalYes += notional
    } else {
      b.volumeNo += count
      b.notionalNo += notional
    }
    this.emit()
  }

  getMetrics(windowSeconds: number): WindowMetrics {
    const nowSec = Math.floor(Date.now() / 1000)
    let volume = 0
    let notional = 0
    let tradeCount = 0
    let volumeYes = 0
    let notionalYes = 0
    let volumeNo = 0
    let notionalNo = 0
    for (let i = 0; i < windowSeconds; i++) {
      const sec = nowSec - i
      const idx = ((sec % METRICS_BUCKET_COUNT) + METRICS_BUCKET_COUNT) % METRICS_BUCKET_COUNT
      const b = this.buckets[idx]
      if (b.atSec !== sec) continue
      volume += b.volume
      notional += b.notional
      tradeCount += b.tradeCount
      volumeYes += b.volumeYes
      notionalYes += b.notionalYes
      volumeNo += b.volumeNo
      notionalNo += b.notionalNo
    }
    return {
      volume,
      notional,
      tradeCount,
      tradesPerSecond: windowSeconds > 0 ? tradeCount / windowSeconds : 0,
      yes: { volume: volumeYes, notional: notionalYes },
      no: { volume: volumeNo, notional: notionalNo },
      net: {
        volume: volumeYes - volumeNo,
        notional: notionalYes - notionalNo,
      },
    }
  }

  onUpdate(listener: RollingMetricsListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    const m = {
      window2s: this.getMetrics(WINDOW_SHORT),
      window10s: this.getMetrics(WINDOW_LONG),
    }
    for (const fn of this.listeners) fn(m)
  }

  destroy(): void {
    this.listeners.clear()
  }
}
