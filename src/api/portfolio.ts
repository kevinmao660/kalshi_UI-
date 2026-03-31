/**
 * Portfolio positions — proxy through backend (Kalshi GET /portfolio/positions).
 * position_fp: positive = YES contracts, negative = NO contracts (per market).
 */

const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '')

export interface MarketPosition {
  ticker: string
  position_fp: string
  /** Cost of aggregate position in dollars (Kalshi fixed-point string). */
  market_exposure_dollars?: string
}

export interface GetPositionsResponse {
  market_positions?: MarketPosition[]
  event_positions?: Array<{ event_ticker: string; total_cost_shares_fp?: string }>
  cursor?: string
}

export async function fetchPortfolioPositions(params: {
  event_ticker?: string
  ticker?: string
}): Promise<GetPositionsResponse> {
  const qs = new URLSearchParams()
  if (params.event_ticker) qs.set('event_ticker', params.event_ticker)
  if (params.ticker) qs.set('ticker', params.ticker)
  qs.set('limit', '200')
  const res = await fetch(`${API_BASE}/api/portfolio/positions?${qs}`)
  const raw = await res.text()
  let data: GetPositionsResponse = {}
  try {
    data = raw ? (JSON.parse(raw) as GetPositionsResponse) : {}
  } catch {
    data = {}
  }
  if (!res.ok) {
    const err = data as { message?: string; code?: string }
    throw new Error(err.message || err.code || `Positions failed: ${res.status}`)
  }
  return data
}

/** Kalshi position_fp: positive = YES contracts, negative = NO contracts. */
export function splitYesNoContracts(positionFp: number): { yes: number; no: number } {
  if (!Number.isFinite(positionFp)) return { yes: 0, no: 0 }
  if (positionFp > 1e-9) return { yes: positionFp, no: 0 }
  if (positionFp < -1e-9) return { yes: 0, no: -positionFp }
  return { yes: 0, no: 0 }
}

/** Human-readable net position for one market (Kalshi position_fp semantics). */
export function formatMarketPosition(positionFp: number): string {
  if (!Number.isFinite(positionFp) || Math.abs(positionFp) < 1e-6) return 'Flat'
  const r = Math.round(positionFp * 100) / 100
  if (r > 0) return `Long ${r} YES`
  return `Long ${Math.abs(r)} NO`
}

/** One-line YES / NO contract counts (same convention as formatMarketPosition). */
export function formatYesNoPositionLine(positionFp: number): string {
  const { yes, no } = splitYesNoContracts(positionFp)
  if (yes < 1e-6 && no < 1e-6) return 'Flat'
  const y = Math.round(yes * 100) / 100
  const n = Math.round(no * 100) / 100
  const parts: string[] = []
  if (y >= 1e-6) parts.push(`${y} YES`)
  if (n >= 1e-6) parts.push(`${n} NO`)
  return parts.join(' · ')
}

/**
 * Signed net contracts for the left column team in a two-way event:
 * position_fp(left market) − position_fp(right). Same as YES(left) + NO(right) − NO(left) − YES(right).
 */
export function formatNetLeftTeamExposure(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) < 1e-6) return '0'
  const r = Math.round(n * 100) / 100
  if (r % 1 === 0) return String(Math.round(r))
  return String(r)
}

/** Dollars per contract from Kalshi `market_exposure_dollars` / |position_fp|. */
export function averageCostPerContractUsd(
  positionFp: number | undefined,
  marketExposureDollars: number | undefined,
): number | null {
  if (positionFp === undefined || marketExposureDollars === undefined) return null
  if (!Number.isFinite(positionFp) || !Number.isFinite(marketExposureDollars)) return null
  const abs = Math.abs(positionFp)
  if (abs < 1e-9) return null
  return marketExposureDollars / abs
}

export function formatAvgCostPerContract(costUsd: number | null | undefined): string {
  if (costUsd == null || !Number.isFinite(costUsd)) return '—'
  const c = Math.round(costUsd * 10000) / 10000
  return `$${c.toFixed(2)}/ct`
}
