import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WINDOW_LONG, WINDOW_SHORT } from './constants'
import { RollingMetrics } from './RollingMetrics'

function assertYesNoMatchesTotal(
  w: ReturnType<RollingMetrics['getMetrics']>,
  label: string,
) {
  expect(w.yes.volume + w.no.volume, `${label}: volume`).toBe(w.volume)
  expect(w.yes.notional + w.no.notional, `${label}: notional`).toBeCloseTo(w.notional, 5)
}

describe('RollingMetrics YES/NO (taker-side)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('splits YES vs NO and YES+NO equals total volume and notional', () => {
    vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'))
    const m = new RollingMetrics()
    m.recordTrade(10, 3.5, 'yes')
    m.recordTrade(5, 2.25, 'no')

    const w = m.getMetrics(WINDOW_LONG)
    expect(w.volume).toBe(15)
    expect(w.notional).toBeCloseTo(5.75, 8)
    expect(w.yes.volume).toBe(10)
    expect(w.yes.notional).toBeCloseTo(3.5, 8)
    expect(w.no.volume).toBe(5)
    expect(w.no.notional).toBeCloseTo(2.25, 8)
    expect(w.net.volume).toBe(5)
    expect(w.net.notional).toBeCloseTo(1.25, 8)
    assertYesNoMatchesTotal(w, '10s window')
  })

  it('aggregates multiple trades in the same second into one bucket', () => {
    vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'))
    const m = new RollingMetrics()
    m.recordTrade(1, 0.4, 'yes')
    m.recordTrade(2, 0.5, 'no')
    m.recordTrade(3, 0.6, 'yes')

    const w = m.getMetrics(WINDOW_LONG)
    expect(w.volume).toBe(6)
    expect(w.yes.volume).toBe(4)
    expect(w.no.volume).toBe(2)
    expect(w.notional).toBeCloseTo(1.5, 8)
    assertYesNoMatchesTotal(w, 'same second')
  })

  it('drops trades older than the short (2s) window', () => {
    const t0 = new Date('2025-06-01T12:00:00.000Z').getTime()
    vi.setSystemTime(t0)
    const m = new RollingMetrics()
    m.recordTrade(100, 50, 'yes')

    vi.setSystemTime(t0 + 3_000)
    const w = m.getMetrics(WINDOW_SHORT)
    expect(w.volume).toBe(0)
    expect(w.yes.volume).toBe(0)
    expect(w.no.volume).toBe(0)
    expect(w.notional).toBe(0)
  })

  it('keeps trades inside the 2s window', () => {
    const t0 = new Date('2025-06-01T12:00:00.000Z').getTime()
    vi.setSystemTime(t0)
    const m = new RollingMetrics()
    m.recordTrade(7, 3, 'no')

    vi.setSystemTime(t0 + 1_000)
    const w = m.getMetrics(WINDOW_SHORT)
    expect(w.volume).toBe(7)
    expect(w.no.volume).toBe(7)
    expect(w.yes.volume).toBe(0)
    assertYesNoMatchesTotal(w, '1s later')
  })

  it('does not confuse bucket index after 60s (atSec vs ring slot)', () => {
    const t0 = new Date('2025-06-01T12:00:00.000Z').getTime()
    vi.setSystemTime(t0)
    const m = new RollingMetrics()
    m.recordTrade(1, 1, 'yes')

    vi.setSystemTime(t0 + 60_000)
    const w = m.getMetrics(WINDOW_LONG)
    expect(w.volume).toBe(0)

    m.recordTrade(2, 2, 'no')
    const w2 = m.getMetrics(WINDOW_LONG)
    expect(w2.volume).toBe(2)
    expect(w2.no.volume).toBe(2)
    expect(w2.yes.volume).toBe(0)
    assertYesNoMatchesTotal(w2, 'after 60s new trade')
  })

  it('net YES − NO matches per-leg split', () => {
    vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'))
    const m = new RollingMetrics()
    m.recordTrade(20, 10, 'yes')
    m.recordTrade(8, 3, 'no')
    const w = m.getMetrics(WINDOW_LONG)
    expect(w.net.volume).toBe(w.yes.volume - w.no.volume)
    expect(w.net.notional).toBeCloseTo(w.yes.notional - w.no.notional, 8)
    expect(w.net.volume).toBe(12)
    expect(w.net.notional).toBeCloseTo(7, 8)
  })

  it('10s window includes more history than 2s', () => {
    const t0 = new Date('2025-06-01T12:00:00.000Z').getTime()
    const m = new RollingMetrics()
    vi.setSystemTime(t0 + 1_000)
    m.recordTrade(1, 1, 'yes')

    vi.setSystemTime(t0 + 10_000)
    m.recordTrade(2, 2, 'no')

    const w2 = m.getMetrics(WINDOW_SHORT)
    expect(w2.volume).toBe(2)

    const w10 = m.getMetrics(WINDOW_LONG)
    expect(w10.volume).toBe(3)
    assertYesNoMatchesTotal(w2, '2s')
    assertYesNoMatchesTotal(w10, '10s')
  })
})
