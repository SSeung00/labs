import {
  Activity,
  BookHeart,
  CalendarRange,
  Footprints,
  Gauge,
  Sparkles,
  type LucideIcon,
  Settings,
  Sun,
  TrendingUp,
  Trophy,
} from 'lucide-react'

export interface NavItem {
  path: string
  label: string
  description: string
  icon: LucideIcon
  shortcut: string
  group: 'main' | 'log' | 'system'
}

export const NAV: NavItem[] = [
  { path: '/', label: '오늘', description: '오늘의 준비도와 계획', icon: Sun, shortcut: 'G T', group: 'main' },
  { path: '/activities', label: '활동', description: '모든 러닝 기록', icon: Activity, shortcut: 'G A', group: 'main' },
  { path: '/fitness', label: '컨디션', description: '체력 · 피로 · 지금 상태', icon: Gauge, shortcut: 'G F', group: 'main' },
  { path: '/progress', label: '성장', description: '성장 곡선과 기록 예측', icon: TrendingUp, shortcut: 'G P', group: 'main' },
  { path: '/plan', label: '훈련 계획', description: '목표 레이스 플랜', icon: CalendarRange, shortcut: 'G L', group: 'main' },
  { path: '/races', label: '대회', description: '대회 일정 · 기록 · 플랜 반영', icon: Trophy, shortcut: 'G R', group: 'main' },
  { path: '/coach', label: 'AI 코치', description: '내 기록으로 묻고 답하기', icon: Sparkles, shortcut: 'G C', group: 'main' },
  { path: '/journal', label: '일지', description: '체크인 · 수면 · 부상', icon: BookHeart, shortcut: 'G J', group: 'log' },
  { path: '/gear', label: '장비', description: '신발 마일리지', icon: Footprints, shortcut: 'G G', group: 'log' },
  { path: '/settings', label: '설정', description: '가민 연결 · 존 · 지표', icon: Settings, shortcut: 'G S', group: 'system' },
]
