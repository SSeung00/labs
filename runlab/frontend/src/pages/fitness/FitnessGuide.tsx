import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface Section {
  key: string
  title: string
  swatch?: string
  what: string
  how: string
  read: { range: string; meaning: string; tone?: 'good' | 'warn' | 'bad' | 'muted' }[]
  note?: string
}

const SECTIONS: Section[] = [
  {
    key: 'load',
    title: '훈련 부하 (일일 부하)',
    what: '한 번의 운동이 몸에 준 스트레스를 하나의 숫자로 만든 것. 아래 모든 지표의 재료예요.',
    how: '초 단위 심박을 심박 예비량(안정~최대 사이 위치)으로 바꿔 Banister TRIMP를 구하고, "LTHR(젖산역치 심박)로 1시간 = 100점"이 되도록 정규화해요(hrTSS). 심박이 없으면 RPE×시간, 그것도 없으면 시간으로 추정해요.',
    read: [
      { range: '30–60', meaning: '쉬운 조깅 1시간 안팎' },
      { range: '70–100', meaning: '템포·인터벌, 긴 롱런' },
      { range: '150+', meaning: '하프 이상 레이스, 아주 긴 LSD' },
    ],
    note: 'LTHR이 실제보다 높게 잡히면 부하가 낮게, 낮게 잡히면 높게 나와요. 설정에서 LTHR을 정확히 넣을수록 정확해져요.',
  },
  {
    key: 'ctl',
    title: '체력 · CTL (Chronic Training Load)',
    swatch: 'var(--fitness)',
    what: '최근 약 6주 동안 꾸준히 쌓은 훈련량. "얼마나 훈련된 몸인가"에 가까워요.',
    how: '일일 부하의 42일 지수가중평균. 오늘 부하가 (부하 − 어제 CTL) ÷ 42 만큼 반영돼요. 그래서 하루 이틀 쉬어도 거의 안 떨어지고, 몇 주 꾸준해야 올라가요.',
    read: [
      { range: '주당 +3~5', meaning: '건강한 상승 속도', tone: 'good' },
      { range: '주당 +8 이상', meaning: '너무 빠른 증가 — 부상·과훈련 위험', tone: 'warn' },
      { range: '하락 추세', meaning: '테이퍼·휴식기라면 정상, 아니면 체력 감소 신호', tone: 'muted' },
    ],
    note: '절대값은 사람마다 달라요. 남과 비교하기보다 내 과거와 비교하세요. 이 앱에서 예측(성장 화면)은 CTL과 VDOT의 관계를 내 기록으로 학습해 써요.',
  },
  {
    key: 'atl',
    title: '피로 · ATL (Acute Training Load)',
    swatch: 'var(--fatigue)',
    what: '최근 약 1주의 훈련량. 지금 몸에 남아 있는 피로에 가까워요.',
    how: '일일 부하의 7일 지수가중평균. 빠르게 오르고 빠르게 내려가요.',
    read: [{ range: 'CTL보다 큼', meaning: '최근에 평소보다 많이 했다는 뜻 (폼이 음수가 됨)' }],
  },
  {
    key: 'tsb',
    title: '폼 · TSB (Training Stress Balance)',
    swatch: 'var(--form)',
    what: '체력에서 피로를 뺀 값. "오늘 얼마나 신선한가".',
    how: '어제의 CTL − 어제의 ATL. 오늘 운동은 내일 폼에 반영돼요.',
    read: [
      { range: '+25 이상', meaning: '너무 오래 쉼 — 체력이 빠지는 중', tone: 'muted' },
      { range: '+5 ~ +25', meaning: '신선함. 레이스·기록 도전에 좋은 상태', tone: 'good' },
      { range: '−10 ~ +5', meaning: '유지. 평소 훈련 구간' },
      { range: '−30 ~ −10', meaning: '생산적 훈련. 피로를 감수하며 체력을 쌓는 중', tone: 'good' },
      { range: '−30 이하', meaning: '과부하. 며칠 이어지면 회복을 우선하세요', tone: 'bad' },
    ],
    note: '레이스 전 테이퍼의 목표는 CTL을 크게 잃지 않으면서 TSB를 +5~+20으로 올리는 거예요.',
  },
  {
    key: 'acwr',
    title: 'ACWR (급성:만성 부하 비율)',
    swatch: 'var(--accent)',
    what: '최근 1주가 지난 4주에 비해 얼마나 많았는지. 부하를 너무 급하게 늘리고 있지 않은지 보는 지표예요.',
    how: '최근 7일 평균 부하 ÷ 최근 28일 평균 부하.',
    read: [
      { range: '0.8 – 1.3', meaning: '적정 범위', tone: 'good' },
      { range: '1.3 – 1.5', meaning: '빠른 증가 — 주의', tone: 'warn' },
      { range: '1.5 이상', meaning: '부상 위험이 크게 높아지는 구간 (Gabbett, 2016)', tone: 'bad' },
      { range: '0.8 미만', meaning: '부하 감소 중 (테이퍼·휴식)', tone: 'muted' },
    ],
    note: '하루짜리 레이스나 장거리 한 번으로 튀는 건 자연스러워요. 며칠 연속 1.5를 넘는지가 중요해요.',
  },
  {
    key: 'zones',
    title: '주간 강도 분포',
    what: '한 주 동안 심박 존별로 몇 시간 달렸는지. 러닝만 집계해요.',
    how: 'LTHR 기준 5존: Z1 ≤85% · Z2 85–89% · Z3 89–94% · Z4 94–100% · Z5 >100% (Friel 방식). 설정에서 최대 심박 기준으로 바꿀 수 있어요.',
    read: [
      { range: 'Z1–2 약 80%', meaning: '지구력 훈련의 정석 "80/20" (Seiler)', tone: 'good' },
      { range: 'Z3 비중 큼', meaning: '"애매하게 힘든" 러닝이 많음 — 쉬운 날은 더 쉽게', tone: 'warn' },
    ],
  },
  {
    key: 'ef',
    title: '유산소 효율 (EF)',
    swatch: 'var(--fitness)',
    what: '같은 심박으로 얼마나 빨리 달리는지. 유산소 체력이 좋아지면 올라가요.',
    how: '경사 보정 속도(GAP, m/분) ÷ 평균 심박. GAP은 Minetti(2002) 경사 에너지 비용으로 오르막·내리막을 평지로 환산한 속도예요.',
    read: [
      { range: '추세 상승', meaning: '유산소 기반이 좋아지는 중', tone: 'good' },
      { range: '갑자기 낮은 점', meaning: '더위·탈수·피로·수면 부족, 또는 심박 센서 오류', tone: 'muted' },
    ],
    note: '하루하루 점은 들쭉날쭉해요. 주황 선(최근 9회 중앙값)의 방향을 보세요. 트레드밀은 속도 측정이 부정확해 제외해요.',
  },
  {
    key: 'decoupling',
    title: '디커플링 (Pa:HR)',
    what: '같은 속도를 유지할 때 후반에 심박이 얼마나 올라가는지. 장거리 지구력의 지표예요.',
    how: '이동 시간 기준 전반·후반의 EF 차이 ÷ 전반 EF. 30분 이상 러닝만 계산해요.',
    read: [
      { range: '< 5%', meaning: '유산소 기반이 탄탄함', tone: 'good' },
      { range: '5–10%', meaning: '보통 — 롱런을 꾸준히 이어 가세요' },
      { range: '> 10%', meaning: '그 거리·속도가 아직 버거움 (또는 더위)', tone: 'warn' },
    ],
  },
]

const TONE = { good: 'text-good', warn: 'text-warn', bad: 'text-bad', muted: 'text-subtle' }

export function FitnessGuide() {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(SECTIONS[0].key)
  const sec = SECTIONS.find((s) => s.key === active)!
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <BookOpen /> 읽는 법
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="컨디션 화면 읽는 법" description="각 지표가 무엇이고, 어떻게 계산하고, 어떻게 읽는지" className="sm:max-w-3xl">
        <div className="grid sm:grid-cols-[12rem_1fr]">
          <nav className="flex gap-1 overflow-x-auto border-b p-2 sm:flex-col sm:border-b-0 sm:border-r">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                onClick={() => setActive(s.key)}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium',
                  active === s.key ? 'bg-surface-2 text-text' : 'text-muted hover:text-text',
                )}
              >
                {s.swatch && <span className="size-2 shrink-0 rounded-full" style={{ background: s.swatch }} />}
                {s.title.split(' (')[0]}
              </button>
            ))}
          </nav>
          <div className="space-y-5 p-5">
            <div>
              <h3 className="text-base font-semibold">{sec.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{sec.what}</p>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-semibold text-subtle">계산 방법</div>
              <p className="rounded-xl bg-surface-2/60 p-3 text-sm leading-relaxed text-muted">{sec.how}</p>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-semibold text-subtle">읽는 법</div>
              <ul className="divide-y overflow-hidden rounded-xl border">
                {sec.read.map((r) => (
                  <li key={r.range} className="grid grid-cols-[7.5rem_1fr] gap-3 px-3 py-2.5 text-sm">
                    <span className={cn('num font-semibold', r.tone ? TONE[r.tone] : 'text-text')}>{r.range}</span>
                    <span className="text-muted">{r.meaning}</span>
                  </li>
                ))}
              </ul>
            </div>
            {sec.note && <p className="text-xs leading-relaxed text-subtle">💡 {sec.note}</p>}
          </div>
        </div>
      </Dialog>
    </>
  )
}
