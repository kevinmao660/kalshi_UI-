import { useState } from 'react'

export function SearchBar() {
  const [q, setQ] = useState('')
  return (
    <div className="flex flex-1 max-w-md justify-center px-4">
      <input
        type="text"
        placeholder="Search markets..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded-lg border border-kalshi-border bg-kalshi-bg px-3 py-2 text-sm text-kalshi-text placeholder-kalshi-textMuted focus:border-kalshi-accent focus:outline-none focus:ring-1 focus:ring-kalshi-accent"
      />
    </div>
  )
}
