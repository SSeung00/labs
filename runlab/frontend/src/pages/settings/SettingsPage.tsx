import { PageHeader } from '@/components/layout/PageHeader'
import { GarminCard } from './GarminCard'
import { SyncCard } from './SyncCard'
import { ImportCard } from './ImportCard'
import { ProfileCard } from './ProfileCard'
import { ExportCard } from './ExportCard'
import { MobileCard } from './MobileCard'
import { AiUsageCard } from './AiUsageCard'
import { PcAppCard } from './PcAppCard'

export function SettingsPage() {
  return (
    <>
      <PageHeader title="설정" subtitle="데이터 연결 · 동기화 · 심박 프로필" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <GarminCard />
          <AiUsageCard />
          <ProfileCard />
        </div>
        <div className="space-y-4 lg:col-span-3">
          <PcAppCard />
          <MobileCard />
          <SyncCard />
          <ImportCard />
          <ExportCard />
        </div>
      </div>
    </>
  )
}
