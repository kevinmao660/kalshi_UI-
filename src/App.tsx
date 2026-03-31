import { useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import { ScreenerLayout } from '@/components/ScreenerLayout'
import { TradingPage } from '@/pages/TradingPage'
import { useScreenerStore } from '@/store/screener'

function App() {
  const refresh = useScreenerStore((s) => s.refresh)

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 10_000)
    return () => clearInterval(id)
  }, [refresh])

  return (
    <div className="min-h-screen bg-kalshi-bg">
      <Routes>
        <Route path="/" element={<ScreenerLayout />} />
        <Route path="/market/:ticker" element={<TradingPage />} />
      </Routes>
    </div>
  )
}

export default App
