import { useState } from 'react'
import { createOrder } from '@/api/orders'

interface Props {
  ticker: string
  bestBid: number | null
  bestAsk: number | null
}

export function OrderForm({ ticker, bestBid, bestAsk }: Props) {
  const [side, setSide] = useState<'yes' | 'no'>('yes')
  const [action, setAction] = useState<'buy' | 'sell'>('buy')
  const [price, setPrice] = useState('')
  const [size, setSize] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const suggestedPrice = side === 'yes' ? (bestBid ?? 50) : (bestAsk ?? 50)
  const priceCents = price ? Math.round(parseFloat(price) * 100) : suggestedPrice

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    const count = parseInt(size, 10)
    if (!count || count < 1) {
      setError('Enter valid size')
      return
    }
    if (priceCents < 1 || priceCents > 99) {
      setError('Price must be 1–99¢')
      return
    }

    setLoading(true)
    try {
      const res = await createOrder({
        ticker,
        side,
        action,
        count,
        yes_price: side === 'yes' ? priceCents : undefined,
        no_price: side === 'no' ? priceCents : undefined,
        time_in_force: 'good_till_canceled',
      })
      setSuccess(res.order ? `Order ${res.order.order_id} placed` : 'Order placed')
      setSize('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Order failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border border-kalshi-border bg-kalshi-row p-4">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-kalshi-textSecondary">
        Place Order
      </h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSide('yes')}
            className={`rounded px-3 py-1 text-sm ${side === 'yes' ? 'bg-kalshi-accent text-white' : 'bg-kalshi-border text-kalshi-textSecondary'}`}
          >
            YES
          </button>
          <button
            type="button"
            onClick={() => setSide('no')}
            className={`rounded px-3 py-1 text-sm ${side === 'no' ? 'bg-kalshi-accent text-white' : 'bg-kalshi-border text-kalshi-textSecondary'}`}
          >
            NO
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAction('buy')}
            className={`rounded px-3 py-1 text-sm ${action === 'buy' ? 'bg-green-600 text-white' : 'bg-kalshi-border text-kalshi-textSecondary'}`}
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => setAction('sell')}
            className={`rounded px-3 py-1 text-sm ${action === 'sell' ? 'bg-red-600 text-white' : 'bg-kalshi-border text-kalshi-textSecondary'}`}
          >
            Sell
          </button>
        </div>
        <div>
          <label className="mb-1 block text-xs text-kalshi-textSecondary">Price ($)</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            max="0.99"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={(suggestedPrice / 100).toFixed(2)}
            className="w-full rounded border border-kalshi-border bg-kalshi-bg px-3 py-2 font-mono text-sm text-kalshi-text"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-kalshi-textSecondary">Size (contracts)</label>
          <input
            type="number"
            min="1"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className="w-full rounded border border-kalshi-border bg-kalshi-bg px-3 py-2 font-mono text-sm text-kalshi-text"
          />
        </div>
        {error && <div className="text-sm text-red-400">{error}</div>}
        {success && <div className="text-sm text-green-400">{success}</div>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-kalshi-accent py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {loading ? 'Placing…' : `${action === 'buy' ? 'Buy' : 'Sell'} ${side.toUpperCase()}`}
        </button>
      </form>
    </div>
  )
}
