import {
  Footprints,
  Inbox,
  LayoutDashboard,
  Landmark,
  type LucideIcon,
  Plane,
  ReceiptText,
  Settings,
  Sparkles,
  Upload,
  WalletCards,
} from 'lucide-react'

export interface NavItem {
  path: string
  label: string
  short: string
  description: string
  icon: LucideIcon
  shortcut: string
  group: 'main' | 'plan' | 'system'
}

export const NAV: NavItem[] = [
  { path: '/', label: '홈', short: '홈', description: '이번 달 · 올해 한눈에', icon: LayoutDashboard, shortcut: 'G H', group: 'main' },
  { path: '/transactions', label: '거래내역', short: '내역', description: '모든 입출금', icon: ReceiptText, shortcut: 'G T', group: 'main' },
  { path: '/review', label: '확인하기', short: '확인', description: '미분류 · 중복 · 큰 송금', icon: Inbox, shortcut: 'G Q', group: 'main' },
  { path: '/budget', label: '예산', short: '예산', description: '이번 달 예산 · 자금 계획', icon: WalletCards, shortcut: 'G B', group: 'plan' },
  { path: '/trips', label: '여행', short: '여행', description: '여행별 지출', icon: Plane, shortcut: 'G V', group: 'plan' },
  { path: '/hobbies', label: '취미', short: '취미', description: '러닝 km당 비용 · 카메라', icon: Footprints, shortcut: 'G R', group: 'plan' },
  { path: '/assets', label: '자산', short: '자산', description: '순자산 · 투자 · 목표 · 잔액 검증', icon: Landmark, shortcut: 'G A', group: 'plan' },
  { path: '/ai', label: 'AI 도우미', short: 'AI', description: '질문 · 월간 리포트 · 영수증', icon: Sparkles, shortcut: 'G C', group: 'plan' },
  { path: '/import', label: '가져오기', short: '가져오기', description: '뱅크샐러드 · 카드사 엑셀', icon: Upload, shortcut: 'G I', group: 'system' },
  { path: '/settings', label: '설정', short: '설정', description: '규칙 · 계좌 · 알림 · 휴대폰', icon: Settings, shortcut: 'G S', group: 'system' },
]

export const NAV_GROUPS: { key: NavItem['group']; label: string }[] = [
  { key: 'main', label: '가계부' },
  { key: 'plan', label: '계획 & 자산' },
  { key: 'system', label: '' },
]
