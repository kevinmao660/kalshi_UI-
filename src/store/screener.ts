import { create } from 'zustand'
import { fetchAllMarkets, getMarketVolumes } from '@/api/kalshi'
import type { KalshiMarket } from '@/types/market'
import type { MarketSnapshot } from '@/types/market'

const FLASH_TTL_MS = 800
const VOLUME_DELTA_THRESHOLD = 100
const MIN_VOLUME = 10_000
const MAX_TIME_LEFT_MS = 24 * 60 * 60 * 1000 // 24 hours

function sortMarkets(
  arr: MarketSnapshot[],
  key: SortKey,
  dir: SortDir
): MarketSnapshot[] {
  const mult = dir === 'asc' ? 1 : -1
  return [...arr].sort((a, b) => {
    let cmp = 0
    switch (key) {
      case 'eventTicker':
        cmp = (a.eventTicker || '').localeCompare(b.eventTicker || '')
        break
      case 'yesAsk':
        cmp = a.yesAsk - b.yesAsk
        break
      case 'noAsk':
        cmp = a.noAsk - b.noAsk
        break
      case 'volume5m':
        cmp = a.volume5m - b.volume5m
        break
      case 'volume':
        cmp = a.volume - b.volume
        break
      case 'closeTime':
        cmp = new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime()
        break
      default:
        cmp = 0
    }
    return mult * cmp
  })
}

function toSnapshot(m: KalshiMarket): MarketSnapshot {
  const yesAsk = m.yes_ask_dollars != null ? parseFloat(m.yes_ask_dollars) : (m.yes_ask ?? 0)
  const noAsk = m.no_ask_dollars != null ? parseFloat(m.no_ask_dollars) : (m.no_ask ?? 0)
  const eventTime = m.expected_expiration_time || m.close_time
  const { volume, volume24h } = getMarketVolumes(m)
  return {
    id: m.ticker,
    ticker: m.ticker,
    eventTicker: m.event_ticker,
    title: m.title,
    yesAsk,
    noAsk,
    volume24h,
    volume,
    volume5m: volume24h,
    closeTime: m.close_time,
    eventTime,
  }
}

export type Category =
  | 'college_basketball'
  | 'nba'
  | 'cs2'
  | 'league_of_legends'
  | 'valorant'

export const CATEGORY_SERIES: Record<Category, string> = {
  college_basketball: import.meta.env.VITE_KALSHI_SERIES_COLLEGE_BASKETBALL || 'KXNCAAMBGAME',
  nba: import.meta.env.VITE_KALSHI_SERIES_NBA || 'KXNBAGAME',
  cs2: import.meta.env.VITE_KALSHI_SERIES_CS2 || 'KXCS2GAME',
  league_of_legends: import.meta.env.VITE_KALSHI_SERIES_LOL || 'KXLOLGAME',
  valorant: import.meta.env.VITE_KALSHI_SERIES_VALORANT || 'KXVALORANTGAME',
}

export type SortKey = 'eventTicker' | 'yesAsk' | 'noAsk' | 'volume5m' | 'volume' | 'closeTime'
export type SortDir = 'asc' | 'desc'

interface ScreenerState {
  markets: MarketSnapshot[]
  sortedMarkets: MarketSnapshot[]
  category: Category
  eventTag: string
  eventTagApplied: string | null
  page: number
  pageSize: number
  sortKey: SortKey
  sortDir: SortDir
  lastRefreshAt: number | null
  isLoading: boolean
  error: string | null
  usingRelaxedFilters: boolean
  flashMarketIds: Set<string>

  setCategory: (c: Category) => void
  setEventTag: (v: string) => void
  applyEventTag: () => void
  setPage: (p: number) => void
  setPageSize: (s: number) => void
  setSort: (key: SortKey) => void
  refresh: () => Promise<void>
  clearFlash: (id: string) => void
}

export const useScreenerStore = create<ScreenerState>((set, get) => ({
  markets: [],
  sortedMarkets: [],
  category: 'nba',
  eventTag: '',
  eventTagApplied: null,
  page: 1,
  pageSize: 25,
  sortKey: 'volume5m',
  sortDir: 'desc',
  lastRefreshAt: null,
  isLoading: false,
  error: null,
  usingRelaxedFilters: false,
  flashMarketIds: new Set(),

  setCategory: (c) => {
    set({ category: c, page: 1 })
    get().refresh()
  },

  setEventTag: (v) => set({ eventTag: v }),

  applyEventTag: () => {
    const { eventTag } = get()
    set({ eventTagApplied: eventTag.trim() || null, page: 1 })
    get().refresh()
  },

  setPage: (p) => set({ page: p }),
  setPageSize: (s) => {
    set({ pageSize: s, page: 1 })
  },

  setSort: (key) => {
    const { sortKey, sortDir } = get()
    const newDir = key === sortKey ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc'
    set((s) => ({
      sortKey: key,
      sortDir: newDir,
      page: 1,
      sortedMarkets: sortMarkets(s.sortedMarkets, key, newDir),
    }))
  },

  refresh: async () => {
    set({ isLoading: true, error: null })
    const { category, eventTagApplied } = get()
    const prevByTicker = new Map(get().markets.map((m) => [m.ticker, m]))

    try {
      let seriesTicker: string | undefined
      let eventTicker: string | undefined

      if (eventTagApplied) {
        eventTicker = eventTagApplied
      } else {
        seriesTicker = CATEGORY_SERIES[category]
      }

      const raw = await fetchAllMarkets({
        seriesTicker: eventTagApplied ? undefined : seriesTicker,
        eventTicker,
      })
      const snapshots = raw.map(toSnapshot)
      const vol = (m: MarketSnapshot) => Math.max(m.volume24h, m.volume)
      let markets = snapshots.filter((m) => {
        if (vol(m) < MIN_VOLUME) return false
        const closeMs = new Date(m.closeTime).getTime()
        const eventMs = new Date(m.eventTime).getTime()
        const eventRemaining = eventMs - Date.now()
        return closeMs > Date.now() && eventRemaining > 0 && eventRemaining <= MAX_TIME_LEFT_MS
      })
      let usingRelaxedFilters = false
      if (markets.length === 0 && snapshots.length > 0) {
        markets = snapshots.filter((m) => {
          if (vol(m) < 1000) return false
          const closeMs = new Date(m.closeTime).getTime()
          const eventMs = new Date(m.eventTime).getTime()
          const eventRemaining = eventMs - Date.now()
          return closeMs > Date.now() && eventRemaining > 0 && eventRemaining <= 7 * 24 * 60 * 60 * 1000
        })
        usingRelaxedFilters = markets.length > 0
        if (markets.length === 0) {
          markets = snapshots.filter((m) => new Date(m.closeTime).getTime() > Date.now())
          if (markets.length === 0) markets = snapshots
        }
      }
      const { sortKey, sortDir } = get()
      const sorted = sortMarkets(markets, sortKey, sortDir)

      const flash = new Set<string>()
      for (const m of markets) {
        const prev = prevByTicker.get(m.ticker)
        if (prev && m.volume5m - prev.volume5m >= VOLUME_DELTA_THRESHOLD) {
          flash.add(m.ticker)
        }
      }

      set({
        markets,
        sortedMarkets: sorted,
        lastRefreshAt: Date.now(),
        isLoading: false,
        usingRelaxedFilters,
        flashMarketIds: flash,
      })

      flash.forEach((id) => {
        setTimeout(() => get().clearFlash(id), FLASH_TTL_MS)
      })
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : 'Failed to fetch markets',
        isLoading: false,
      })
    }
  },

  clearFlash: (id) => {
    set((s) => {
      const next = new Set(s.flashMarketIds)
      next.delete(id)
      return { flashMarketIds: next }
    })
  },
}))
