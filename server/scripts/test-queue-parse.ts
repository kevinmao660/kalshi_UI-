/**
 * Offline checks for queue row parsing / market filter (no Kalshi network call).
 * npm run test:queue:parse
 */

import assert from 'node:assert'

type Row = {
  order_id?: string
  market_ticker?: string
  queue_position_fp?: string
  queue_position?: number | string
}

function numericQueue(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v)
    if (Number.isFinite(n)) return Math.round(n)
  }
  return null
}

function queueFromRow(row: Row): number | null {
  const d = numericQueue(row.queue_position)
  if (d != null) return d
  if (row.queue_position_fp != null) {
    const n = parseFloat(String(row.queue_position_fp))
    if (Number.isFinite(n)) return Math.round(n)
  }
  return null
}

function filterToMarket(rows: Row[], marketTicker: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) {
    const oid = row.order_id
    if (!oid) continue
    if (row.market_ticker != null && row.market_ticker !== marketTicker) continue
    const q = queueFromRow(row)
    if (q != null) out[oid] = q
  }
  return out
}

const rows: Row[] = [
  { order_id: 'a', market_ticker: 'M1', queue_position_fp: '5.0' },
  { order_id: 'b', market_ticker: 'M2', queue_position_fp: '1' },
  { order_id: 'c', market_ticker: 'M1', queue_position: '12' },
  { order_id: 'd', queue_position_fp: '3' },
]

const m1 = filterToMarket(rows, 'M1')
assert.strictEqual(m1['a'], 5)
assert.strictEqual(m1['c'], 12)
assert.strictEqual(m1['b'], undefined)
assert.strictEqual(m1['d'], 3)

const m2 = filterToMarket(rows, 'M2')
assert.strictEqual(m2['b'], 1)

console.log('test-queue-parse: OK')
