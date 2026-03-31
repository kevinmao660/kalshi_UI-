import { useScreenerStore, type Category } from '@/store/screener'
import { EventTagInput } from './EventTagInput'

const PRESETS: { value: Category; label: string }[] = [
  { value: 'college_basketball', label: 'College Basketball' },
  { value: 'nba', label: 'NBA' },
  { value: 'cs2', label: 'CS2 (Esports)' },
  { value: 'league_of_legends', label: 'League of Legends (Esports)' },
  { value: 'valorant', label: 'Valorant (Esports)' },
]

export function CategoryFilters() {
  const category = useScreenerStore((s) => s.category)
  const setCategory = useScreenerStore((s) => s.setCategory)

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-kalshi-textSecondary">
          Categories
        </p>
        <div className="space-y-1">
          {PRESETS.map(({ value, label }) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-kalshi-row"
            >
              <input
                type="radio"
                name="category"
                checked={category === value}
                onChange={() => setCategory(value)}
                className="h-3.5 w-3.5 border-kalshi-border text-kalshi-accent focus:ring-kalshi-accent"
              />
              <span className="text-sm text-kalshi-text">{label}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="border-t border-kalshi-border pt-3">
        <EventTagInput />
      </div>
    </div>
  )
}
