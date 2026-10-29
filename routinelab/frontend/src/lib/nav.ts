import { BarChart3, ListChecks, type LucideIcon, NotebookPen, Settings, Sun } from 'lucide-react'

export interface NavItem {
  path: string
  label: string
  short: string
  description: string
  icon: LucideIcon
  tab: boolean // shown in the phone's bottom bar
}

export const NAV: NavItem[] = [
  { path: '/', label: '오늘', short: '오늘', description: '신호등 · 오늘 루틴 · 할 일', icon: Sun, tab: true },
  { path: '/routines', label: '루틴', short: '루틴', description: '루틴 만들기 · 모드 · 휴가', icon: ListChecks, tab: true },
  { path: '/journal', label: '회고', short: '회고', description: '하루 돌아보기 · 기분 · 컨디션', icon: NotebookPen, tab: true },
  { path: '/stats', label: '기록', short: '기록', description: '신호등 달력 · 잔디 · 배지', icon: BarChart3, tab: true },
  { path: '/settings', label: '설정', short: '설정', description: '알림 · 신호등 기준 · 휴대폰', icon: Settings, tab: false },
]
