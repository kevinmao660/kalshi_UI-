/**
 * Exercise GET /portfolio/orders/queue_positions (event_ticker + market_tickers)
 * and the same filtering logic as the app. Run from server/: npm run test:queue
 *
 * Usage:
 *   npm run test:queue
 *   npm run test:queue -- --event=KXEVENT --market=KXMARKET-TEAM
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { kalshiFetch } from '../src/kalshi-rest.js'

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env') })

const API_KEY_ID = process.env.KALSHI_API_KEY_ID || ''
const PRIVATE_KEY_PEM = process.env.KALSHI_PRIVATE_KEY_PEM || ''

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

function parseArgs(): { event?: string; market?: string } {
  const out: { event?: string; market?: string } = {}
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--event=')) out.event = a.slice('--event='.length)
    else if (a.startsWith('--market=')) out.market = a.slice('--market='.length)
  }
  return out
}

async function main() {
  console.log('=== Kalshi queue_positions test ===\n')

  if (!API_KEY_ID || !PRIVATE_KEY_PEM) {
    console.error('Missing KALSHI_API_KEY_ID or KALSHI_PRIVATE_KEY_PEM in server/.env')
    process.exit(1)
  }

  const { event: eventArg, market: marketArg } = parseArgs()
  const eventTicker = eventArg || process.env.TEST_EVENT_TICKER || ''
  const marketTicker = marketArg || process.env.TEST_MARKET_TICKER || ''

  if (!marketTicker) {
    console.error(
      'Pass a market ticker: npm run test:queue -- --market=YOUR-MARKET-TICKER\n' +
        'Optional: --event=EVENT_TICKER (recommended for event-scoped fetch; else uses market_tickers only)',
    )
    process.exit(1)
  }

  const paths: string[] = []
  if (eventTicker) {
    paths.push(
      `/portfolio/orders/queue_positions?${new URLSearchParams({ event_ticker: eventTicker }).toString()}`,
    )
  }
  paths.push(
    `/portfolio/orders/queue_positions?${new URLSearchParams({ market_tickers: marketTicker }).toString()}`,
  )

  for (const p of paths) {
    const label = p.includes('event_ticker') ? 'event_ticker' : 'market_tickers'
    console.log(`--- ${label} ---`)
    console.log(`GET ${p}\n`)

    const r = await kalshiFetch(p, { method: 'GET' }, API_KEY_ID, PRIVATE_KEY_PEM)
    const raw = await r.text()
    let data: { queue_positions?: Row[]; message?: string; code?: string } = {}
    try {
      data = raw ? JSON.parse(raw) : {}
    } catch {
      console.error('Non-JSON body:', raw.slice(0, 500))
      process.exit(r.ok ? 0 : 1)
    }

    if (!r.ok) {
      console.error(`HTTP ${r.status} ${r.statusText}`)
      console.error(data.message || data.code || raw.slice(0, 300))
      console.error('')
      if (r.status === 401) {
        console.error('401 = invalid/expired API key or wrong private key for that key id.')
      }
      process.exit(1)
    }

    const rows = data.queue_positions ?? []
    console.log(`queue_positions rows: ${rows.length}`)
    if (rows.length > 0) {
      const sample = rows[0]!
      console.log('sample keys:', Object.keys(sample).join(', '))
      console.log('sample row:', JSON.stringify(sample))
    }

    const filtered = filterToMarket(rows, marketTicker)
    console.log(`after filter to market "${marketTicker}": ${Object.keys(filtered).length} order ids`)
    if (Object.keys(filtered).length > 0) {
      console.log('sample map:', JSON.stringify(Object.entries(filtered).slice(0, 3)))
    }
    console.log('')
  }

  console.log('OK — no errors from Kalshi for these requests.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
