import { useScreenerStore } from '@/store/screener'

export function EventTagInput() {
  const eventTag = useScreenerStore((s) => s.eventTag)
  const setEventTag = useScreenerStore((s) => s.setEventTag)
  const applyEventTag = useScreenerStore((s) => s.applyEventTag)

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-wider text-kalshi-textSecondary">
        Event tag
      </label>
      <input
        type="text"
        placeholder="e.g. nfl, lol-worlds"
        value={eventTag}
        onChange={(e) => setEventTag(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && applyEventTag()}
        className="w-full rounded border border-kalshi-border bg-kalshi-bg px-2 py-1.5 text-sm text-kalshi-text placeholder-kalshi-textMuted focus:border-kalshi-accent focus:outline-none"
      />
      <button
        type="button"
        onClick={applyEventTag}
        className="w-full rounded bg-kalshi-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
      >
        Apply
      </button>
    </div>
  )
}
