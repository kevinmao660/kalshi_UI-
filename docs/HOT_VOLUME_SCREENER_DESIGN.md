# Hot Volume Screener — UI/UX Design & Technical Spec

Design document for the **Hot Volume Screener** (Home Dashboard) of a Kalshi prediction-market trading terminal. Assumes no auth/onboarding; user lands directly on this view.

**Data transport:** This page uses **Kalshi public REST only** — `fetch` to `/api/kalshi/...` (dev proxy) or `VITE_KALSHI_API_BASE` in production builds. **No SSE and no WebSockets** on the screener. Refresh: **`App.tsx`** runs `refresh()` on mount and every **10 seconds** (`setInterval(..., 10_000)`).

**System-wide transport map:** [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 1. Text-Based Wireframe (Desktop)

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  TOP NAVBAR                                                                                                  │
│  ┌──────────┐  ┌─────────────────────────────────────────────────────┐  ┌─────────────────────────────────┐ │
│  │ [LOGO]   │  │  🔍 Search markets...                                │  │  (optional: balance — not impl.) │ │
│  │ Kalshi   │  │                                                      │  │                                  │ │
│  └──────────┘  └─────────────────────────────────────────────────────┘  └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────┬───────────────────────────────────────────────────────────────────────────────────────────────┐
│              │                                                                                               │
│  LEFT        │  MAIN CENTER — HOT VOLUME SCREENER TABLE                                                      │
│  SIDEBAR     │  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│              │  │ Sort: 5m Vol ▼  │  Refreshes every 10s  │  Last: 14:32:01                               │ │
│  Categories  │  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│  ─────────   │                                                                                               │
│  ○ All Sports│  ┌──────────────┬──────────┬──────────┬──────────────┬──────────────┬─────────────┬────────┐ │
│  ○ Esports   │  │ Market Name  │ YES Ask  │ NO Ask   │ 5m Volume   │ Daily Vol   │ Time Left   │ Action │ │
│  ─────────   │  ├──────────────┼──────────┼──────────┼──────────────┼──────────────┼─────────────┼────────┤ │
│  Event tag:  │  │ Will X win.. │  0.67    │  0.34    │  $45,230 ░   │  $892,100    │  2d 4h      │ [Trade]│ │
│  ┌────────┐  │  │ Fed rate...  │  0.52    │  0.49    │  $38,100     │  $521,000    │  5d 12h     │ [Trade]│ │
│  │________│  │  │ Rain in NYC..│  0.21    │  0.80    │  $29,400 ░   │  $102,300    │  18h        │ [Trade]│ │
│  └────────┘  │  │ ...          │  ...     │  ...     │  ...         │  ...         │  ...        │ [Trade]│ │
│  [Apply]     │  └──────────────┴──────────┴──────────┴──────────────┴──────────────┴─────────────┴────────┘ │
│              │  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  [narrow]    │  │  Page 1 of 12     ◀ Prev    [ 1 ] 2  3  ...  12   Next ▶     Show: [ 25 ▼ ] per page     │ │
│   ~180px     │  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│              │  ░ = optional subtle green pulse on 5m Volume when 5m volume jumps (between API responses)                     │
└──────────────┴───────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Wireframe notes:**
- **Navbar:** Full width; logo left, centered search. (A live balance widget is not present in the current implementation.)
- **Sidebar:** Fixed width (~180px). Preset categories map to Kalshi **series** tickers (e.g. NBA, college basketball, CS2, League of Legends, Valorant) via `VITE_KALSHI_SERIES_*` env and `CATEGORY_SERIES` in `src/store/screener.ts`. Below that, an **Event tag** text input + [Apply] filters by **`event_ticker`** when applied.
- **Main:** Table fills remaining space. Thin toolbar above table: sort indicator, “Refreshes every 10s”, last update time. **Pagination** below table: page info, Prev/Next, page numbers, and a “Show: N per page” selector (e.g. 25, 50, 100).
- **Table:** Columns as specified; 5m Volume is primary sort (desc). Only the **current page** of rows is rendered (paginated slice of the sorted list).
- **Row flash:** Only the 5m Volume cell gets a short green pulse when that market’s 5m volume jumps significantly between API responses (API-only; no real-time trade events).

---

## 2. React Component Architecture

```
App
└── ScreenerLayout                    # Layout shell: navbar + sidebar + main
    ├── TopNavbar
    │   ├── AppLogo
    │   └── SearchBar                 # Filter by market name/ticker (client-side)
    │
    ├── LeftSidebar
    │   └── CategoryFilters
    │       ├── CategoryFilterItem    # Presets: e.g. NBA, college basketball, CS2, LoL, Valorant
    │       ├── EventTagInput         # Free-text input for custom event tag
    │       └── EventTagApplyButton   # Applies tag filter (e.g. [Apply])
    │
    └── MainContent
        └── HotVolumeScreener
            ├── ScreenerToolbar       # "Sort: 5m Vol", "Refreshes every 10s", "Last update"
            ├── ScreenerTable         # Wrapper for table (current page only)
            │   ├── ScreenerTableHeader
            │   └── ScreenerTableBody # Renders only rows for current page (no virtualization required)
            │       └── ScreenerRow   # Single row; receives row data + flash state
            │           ├── MarketNameCell
            │           ├── YesAskCell
            │           ├── NoAskCell
            │           ├── Volume5mCell    # Contains flash animation
            │           ├── DailyVolumeCell
            │           ├── TimeRemainingCell
            │           └── ActionCell     # [Trade] button
            ├── ScreenerPagination    # Page info, Prev/Next, page numbers, per-page selector
            └── (optional) ScreenerEmptyState
```

**Data flow (conceptual):**
- **Store:** `useScreenerStore` (`src/store/screener.ts`) — markets, **category** (`Category` → series ticker), **eventTag** / **eventTagApplied**, **page**, **pageSize**, **sortKey** / **sortDir**, flash sets, etc.
- **Filtering:** With no applied event tag, **`series_ticker`** is taken from the selected category. When **eventTagApplied** is set, requests use **`event_ticker`** instead of series. Markets are filtered by volume and time-to-event rules in `refresh()` (with optional relaxed fallbacks when the strict filter returns nothing).
- **Refresh:** Every **10 seconds** re-fetch or re-sort as needed and update the store; pagination slice is derived from sorted list + page + pageSize.
- **Row flash:** After each API response, compare 5m volume per market to the previous snapshot; if the delta exceeds a threshold, add that market to `flashMarketIds` (or Set) with TTL (e.g. 800ms). Only `Volume5mCell` for that row subscribes and shows the flash CSS animation. (API-only.)

---

## 3. UI / Styling Guidelines

### 3.1 Dark mode palette (hex)

| Role              | Hex       | Usage |
|-------------------|-----------|--------|
| Background base   | `#0B0E14` | Page / main background |
| Background raised | `#131722` | Navbar, sidebar, table header |
| Background row    | `#1E222D` | Table row default |
| Background row alt| `#191D28` | Zebra (optional) |
| Border / divider  | `#2A2E39` | Borders, table rules |
| Text primary      | `#F7F8F8` | Headers, important labels |
| Text secondary    | `#848E9C` | Secondary text, hints |
| Text muted        | `#474D57` | Disabled, placeholders |
| Positive / bid    | `#0ECB81` | YES, gains, flash pulse |
| Negative / ask    | `#F6465D` | NO, losses (if needed) |
| Accent / link     | `#3861FB` | Links, primary buttons |
| Flash overlay     | `rgba(14, 203, 129, 0.15)` | 5m Volume cell pulse |

### 3.2 Tailwind config (extend theme)

```js
// tailwind.config.js — extend theme
theme: {
  extend: {
    colors: {
      kalshi: {
        bg: '#0B0E14',
        surface: '#131722',
        row: '#1E222D',
        rowAlt: '#191D28',
        border: '#2A2E39',
        text: '#F7F8F8',
        textSecondary: '#848E9C',
        textMuted: '#474D57',
        positive: '#0ECB81',
        negative: '#F6465D',
        accent: '#3861FB',
      },
    },
    fontFamily: {
      mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
    },
  },
},
```

### 3.3 Typography

- **Numeric columns (prices, volumes, time):** Always `font-mono` (e.g. `font-mono text-kalshi-text`) and fixed width so columns don’t jitter. Use `tabular-nums` if available.
- **Market name:** Sans-serif for readability (e.g. default stack or `font-sans`).
- **Table:** `text-sm` for density; header `text-xs uppercase tracking-wider text-kalshi-textSecondary`.

### 3.4 Table layout (Tailwind)

- Table container: `w-full overflow-auto bg-kalshi-surface rounded-lg border border-kalshi-border`.
- Table: `w-full border-collapse`.
- Header: `sticky top-0 z-10 bg-kalshi-surface text-left text-xs uppercase tracking-wider text-kalshi-textSecondary border-b border-kalshi-border`.
- Cells: `px-4 py-2.5 border-b border-kalshi-border`, numbers right-aligned (`text-right`), market name left-aligned.
- Row: `bg-kalshi-row hover:bg-kalshi-rowAlt transition-colors duration-75`.
- 5m Volume cell when flashing: add a temporary class that runs a 600–800ms green pulse (e.g. `animate-volume-flash` with keyframes in CSS).

### 3.5 Row flash animation (CSS)

```css
@keyframes volume-flash {
  0%   { background-color: rgba(14, 203, 129, 0.25); }
  50%  { background-color: rgba(14, 203, 129, 0.08); }
  100% { background-color: transparent; }
}
.animate-volume-flash {
  animation: volume-flash 0.7s ease-out forwards;
}
```

Use this class on `Volume5mCell` when `flashMarketId === marketId` (and remove after animation or after a short timeout). Flash is driven by API response deltas, not WebSocket events.

---

## 4. React Performance & State Management Strategy

### 4.1 Goals

- Ingest updates via REST API polling only (no WebSockets on this page) without blocking the UI.
- Re-sort the table by “Total Volume in the Last 5 Minutes” and refresh data every **10 seconds**.
- **Paginate** the table: only render the current page (e.g. 25, 50, or 100 rows per page); no need for row virtualization at typical page sizes.
- Avoid full-tree re-renders; keep interaction smooth.

### 4.2 Recommended libraries

| Concern           | Library / approach |
|------------------|---------------------|
| State            | **Zustand** — minimal, no Provider; good for refresh cycle and selectors. |
| Table + sort     | **TanStack Table (React Table v8)** — headless, sorting/pagination built-in; you render the DOM. |
| Pagination       | **TanStack Table** has built-in pagination; or derive `currentPageRows = sortedMarkets.slice((page-1)*pageSize, page*pageSize)` in the store/selector. |
| Virtualization   | Optional: if per-page row count is large (e.g. 100+), **@tanstack/react-virtual** or **react-window** can virtualize within the current page. For 25–50 rows, plain DOM is fine. |

### 4.3 Data flow (high level)

1. **Ingest:** REST API requests every **10 seconds** fetch markets for the active filter (preset: All Sports / Esports, or custom event tag) and write into a **plain JS structure** (e.g. `Map<marketId, MarketSnapshot>`) or into a Zustand store; set `lastRefreshAt` after each fetch. No WebSockets on this page.
2. **Filter + sort:** After each refresh, filter by preset (All Sports / Esports) and/or applied event tag; then every **10 seconds** (e.g. `setInterval` that triggers fetch + sort), compute `sortedMarkets = sortBy5mVolume(marketsById)` from the store. Store in Zustand; reset to **page 1** when filter or event tag changes. **Pagination:** Derive `currentPageRows = sortedMarkets.slice((page - 1) * pageSize, page * pageSize)`; store holds `page`, `pageSize` (e.g. 25, 50, 100).
3. **Components:**  
   - Only the **table body** (current page rows) and **pagination** need to re-render when data or page changes.  
   - Use **Zustand selectors** (e.g. `useScreenerStore(s => s.sortedMarkets)`) so only components that depend on `sortedMarkets` re-render.  
   - For each row, pass a **stable row id** (e.g. `marketId`) and the row data; pagination means only the current page of rows is rendered.
4. **Row flash:** After each API response, detect markets whose 5m volume increased significantly vs. previous snapshot; add those to `flashMarketIds` with TTL. Only `Volume5mCell` (or the row) checks flash state and applies the pulse class; clear after ~800ms.
5. **Avoid:**  
   - Sorting inside render (do it in the 10s refresh or in a selector).  
   - Forgetting to reset `page` to 1 when the user changes category or event tag.

### 4.4 Pseudo-code (10s refresh + pagination + store)

```text
// Zustand store (slim)
markets: MarketSnapshot[]       // from API, filtered by category/eventTag
sortedMarketIds: string[]       // updated every 10s after fetch + sort
category: 'all_sports' | 'esports'
eventTag: string                // custom tag input; applied on [Apply]
eventTagApplied: string | null  // last applied value (drives API filter)
page: number
pageSize: number                // 25 | 50 | 100
lastRefreshAt: number
flashMarketIds: Set<string>     // markets with big 5m vol delta (vs prev response); TTL 800ms

// Refresh every 10s (e.g. in a hook or store action)
setInterval(async () => {
  const filter = eventTagApplied ?? category  // or API params: { series: category, event_ticker: eventTagApplied }
  const data = await fetchMarkets(filter)
  const sorted = [...data].sort((a, b) => b.volume5m - a.volume5m)
  set({ markets: data, sortedMarketIds: sorted.map(m => m.id), lastRefreshAt: Date.now() })
}, 10_000)

// Pagination slice (selector or getter)
currentPageRows = sortedMarkets.slice((page - 1) * pageSize, page * pageSize)
totalPages = Math.ceil(sortedMarkets.length / pageSize)

// Table
<ScreenerTableBody rows={currentPageRows} />
<ScreenerPagination page={page} totalPages={totalPages} pageSize={pageSize} onPageChange={...} onPageSizeChange={...} />
```

### 4.5 Summary

- **Zustand** for screener state (markets, category, eventTag, page, pageSize); **selectors** for current page slice and total pages.
- **Refresh every 10 seconds**: single interval that fetches (with current filter), sorts by 5m volume, and updates the store.
- **Pagination**: only the current page of rows is rendered; **ScreenerPagination** for Prev/Next, page numbers, and per-page selector. Reset to page 1 when category or event tag changes.
- **Sidebar**: preset options **All Sports** and **Esports**; plus **Event tag** input and [Apply] to filter by a custom event tag.
- **Flash state** kept separate and short-lived for the 5m Volume cell pulse (triggered by 5m volume deltas between API responses, not WebSockets).

This keeps the Hot Volume Screener data-dense, scannable, and responsive with a 10s API refresh and paginated table. **WebSockets and SSE are used on the trading page only** (see [ARCHITECTURE.md](./ARCHITECTURE.md)); this screener is **REST-only**.
