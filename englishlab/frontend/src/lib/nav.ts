import { BarChart3, BookOpen, CalendarCheck, Layers, type LucideIcon, MessagesSquare, NotebookPen, PenLine, Settings, Sun } from 'lucide-react'

export interface NavItem {
  path: string
  label: string
  short: string
  description: string
  icon: LucideIcon
  tab: boolean // shown in the phone's bottom bar
}

export const NAV: NavItem[] = [
  { path: '/', label: '오늘', short: '오늘', description: '오늘의 코스 · 출석', icon: Sun, tab: true },
  { path: '/read', label: '읽기·듣기', short: '읽기', description: '내 수준에 맞춘 글 · 듣기', icon: BookOpen, tab: true },
  { path: '/talk', label: 'AI 대화', short: '대화', description: '음성 대화 · 롤플레이 · 인터뷰', icon: MessagesSquare, tab: true },
  { path: '/write', label: '쓰기', short: '쓰기', description: 'TOEFL 쓰기 · 손글씨 첨삭', icon: PenLine, tab: false },
  { path: '/words', label: '단어', short: '단어', description: 'FSRS 복습 · 단어장 · 실수 노트', icon: Layers, tab: true },
  { path: '/plan', label: '계획', short: '계획', description: '실력 예측 · 공부 계획 · 교재', icon: CalendarCheck, tab: true },
  { path: '/notes', label: '노트', short: '노트', description: '손글씨 노트 · 읽기 필기', icon: NotebookPen, tab: false },
  { path: '/stats', label: '기록', short: '기록', description: '레벨 · 입력 시간 · 배지', icon: BarChart3, tab: false },
  { path: '/settings', label: '설정', short: '설정', description: '목표 · 목소리 · AI · 휴대폰', icon: Settings, tab: false },
]
