import { useCallback, useEffect, useRef, useState } from 'react'

const SIZE_STEP = 100

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

type Props = {
  tradeSize: number
  onTradeSizeChange: (n: number) => void
  onCancelAll: () => Promise<void>
}

/** Same shell as the net-position card on TradingPage (rounded-xl border-kalshi-accent/25 bg-kalshi-bg). */
export function TradingSizeControls({ tradeSize, onTradeSizeChange, onCancelAll }: Props) {
  const [cancelBusy, setCancelBusy] = useState(false)
  const cancelBusyRef = useRef(false)

  const bump = useCallback(
    (delta: number) => {
      onTradeSizeChange(Math.max(0, tradeSize + delta))
    },
    [tradeSize, onTradeSizeChange],
  )

  const setFromInput = useCallback(
    (raw: string) => {
      if (raw.trim() === '') {
        onTradeSizeChange(0)
        return
      }
      const n = Math.floor(Number(raw))
      onTradeSizeChange(Number.isFinite(n) && n >= 0 ? n : 0)
    },
    [onTradeSizeChange],
  )

  const runCancelAll = useCallback(async () => {
    if (cancelBusyRef.current) return
    cancelBusyRef.current = true
    setCancelBusy(true)
    try {
      await onCancelAll()
    } finally {
      cancelBusyRef.current = false
      setCancelBusy(false)
    }
  }, [onCancelAll])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || isTypingTarget(e.target)) return
      const k = e.key.toLowerCase()
      if (k === 'w') {
        e.preventDefault()
        bump(SIZE_STEP)
        return
      }
      if (k === 's') {
        e.preventDefault()
        bump(-SIZE_STEP)
        return
      }
      if (k === 'a') {
        e.preventDefault()
        void runCancelAll()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bump, runCancelAll])

  return (
    <div
      className="flex w-full max-w-[min(100%,22rem)] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-kalshi-accent/25 bg-kalshi-bg px-4 py-2 text-center"
      title="Global size for both orderbooks. W/S adjust by 100; A cancels all resting orders on this event."
    >
      <span className="text-[9px] font-medium uppercase tracking-widest text-kalshi-textSecondary">
        Order size
      </span>
      <span className="text-3xl font-bold tabular-nums leading-tight text-kalshi-text">
        {tradeSize.toLocaleString()}
      </span>
      <span className="text-[9px] text-kalshi-textSecondary/90">contracts</span>

      <div className="mt-1 flex w-full min-w-0 flex-col gap-1.5">
        <label className="flex items-center justify-center gap-2 text-[10px] text-kalshi-textSecondary">
          <span>Manual</span>
          <input
            type="number"
            min={0}
            step={SIZE_STEP}
            value={tradeSize}
            onChange={(e) => setFromInput(e.target.value)}
            className="w-24 rounded border border-kalshi-border/80 bg-kalshi-row px-2 py-1 text-center font-mono text-xs text-kalshi-text"
          />
        </label>
        <p className="font-mono text-[10px] leading-tight tabular-nums text-kalshi-textSecondary">
          <kbd className="rounded border border-kalshi-border/60 bg-kalshi-row px-1 py-px font-mono">W</kbd>{' '}
          +{SIZE_STEP}{' '}
          <kbd className="rounded border border-kalshi-border/60 bg-kalshi-row px-1 py-px font-mono">S</kbd>{' '}
          −{SIZE_STEP}{' '}
          <kbd className="rounded border border-kalshi-border/60 bg-kalshi-row px-1 py-px font-mono">A</kbd>{' '}
          {cancelBusy ? 'cancelling…' : 'cancel'}
        </p>
      </div>
    </div>
  )
}
