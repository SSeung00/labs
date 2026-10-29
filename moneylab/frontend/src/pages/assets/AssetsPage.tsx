import { useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { PageHeader } from '@/components/layout/PageHeader'
import { Segmented } from '@/components/ui/controls'
import { ClaimsTab } from './ClaimsTab'
import { GoalsPanel } from './GoalsPanel'
import { InvestTab } from './InvestTab'
import { NetWorthTab } from './NetWorthTab'
import { VerifyTab } from './VerifyTab'

type Tab = 'networth' | 'invest' | 'goals' | 'claims' | 'verify'

const TABS: { value: Tab; label: string }[] = [
  { value: 'networth', label: '순자산' },
  { value: 'invest', label: '투자' },
  { value: 'goals', label: '목표' },
  { value: 'claims', label: '받을 돈' },
  { value: 'verify', label: '잔액 검증' },
]

export function AssetsPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'networth'
  return (
    <>
      <PageHeader title="자산" subtitle="가진 돈이 어떻게 늘고 있는지, 투자와 목표까지" />
      <Segmented value={tab} onChange={(v) => setParams(v === 'networth' ? {} : { tab: v }, { replace: true })} options={TABS} className="mb-4" />
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
          {tab === 'networth' && <NetWorthTab />}
          {tab === 'invest' && <InvestTab />}
          {tab === 'goals' && <GoalsPanel />}
          {tab === 'claims' && <ClaimsTab />}
          {tab === 'verify' && <VerifyTab />}
        </motion.div>
      </AnimatePresence>
    </>
  )
}
