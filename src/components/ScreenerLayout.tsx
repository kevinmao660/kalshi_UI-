import { TopNavbar } from './TopNavbar'
import { LeftSidebar } from './LeftSidebar'
import { HotVolumeScreener } from './HotVolumeScreener'

export function ScreenerLayout() {
  return (
    <div className="flex h-screen flex-col">
      <TopNavbar />
      <div className="flex flex-1 overflow-hidden">
        <LeftSidebar />
        <main className="flex-1 overflow-auto p-4">
          <HotVolumeScreener />
        </main>
      </div>
    </div>
  )
}
