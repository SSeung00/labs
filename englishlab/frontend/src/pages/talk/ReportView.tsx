import { useState } from 'react'
import { Check, Plus, Volume2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { post } from '@/api/client'
import type { TalkMetrics, TalkReport } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { speak } from '@/lib/audio'
import { band, cefr, levelColor } from '@/lib/level'
import { cn } from '@/lib/utils'

const DIMS: [keyof TalkReport['scores'], string][] = [
  ['accuracy', '정확성'],
  ['complexity', '복잡성'],
  ['fluency', '유창성'],
  ['pronunciation', '발음'],
]

function Metric({ label, value, hint }: { label: string; value: string | number | null | undefined; hint?: string }) {
  return (
    <div className="rounded-xl border bg-surface-2/40 px-3 py-2.5">
      <div className="text-[11px] text-subtle">{label}</div>
      <div className="num text-lg font-bold">{value ?? '–'}</div>
      {hint && <div className="text-[10px] text-subtle">{hint}</div>}
    </div>
  )
}

export function ReportView({ cid, report, metrics }: { cid: number; report: TalkReport; metrics: TalkMetrics }) {
  const qc = useQueryClient()
  const items = [
    ...report.expressions.map((e) => ({ key: `e:${e.expr}`, expr: e.expr, meaning_ko: e.meaning_ko, example: e.example })),
    ...report.upgrades.map((u) => ({ key: `u:${u.better}`, better: u.better, original: u.original, meaning_ko: u.why_ko })),
  ]
  const [picked, setPicked] = useState<Set<string>>(new Set(report.expressions.map((e) => `e:${e.expr}`)))
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="이번 대화 리포트" hint={`말하기 ${cefr(report.level)} · TOEFL 말하기 밴드 약 ${band(report.toefl_band)}`} />
        <CardBody className="space-y-4">
          <p className="text-[15px] leading-relaxed">{report.summary_ko}</p>
          <div className="space-y-2.5">
            {DIMS.map(([k, label]) => (
              <div key={k}>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="text-muted">{label}</span>
                  <span className="num font-semibold">{cefr(report.scores[k])}</span>
                </div>
                <div className="h-2 rounded-full bg-surface-3">
                  <div className="h-full rounded-full" style={{ width: `${(report.scores[k] - 1) * 20}%`, background: levelColor(report.scores[k]) }} />
                </div>
                <p className="mt-1 text-xs text-subtle">{report.caf_ko[k]}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <Metric label="말한 단어" value={metrics.words} />
            <Metric label="말하기 속도" value={metrics.wpm} hint="wpm (원어민 140~170)" />
            <Metric label="턴당 단어" value={metrics.words_per_turn} />
            <Metric label="오류" value={metrics.errors_per_100w} hint="100단어당" />
            <Metric label="군말" value={metrics.fillers_per_100w} hint="100단어당" />
            <Metric label="어휘 다양성" value={metrics.lexical_diversity} hint="MATTR" />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="다음에 집중할 3가지" />
        <CardBody className="space-y-2.5">
          {report.focus.map((f, i) => (
            <div key={i} className="rounded-xl border bg-surface-2/40 p-3">
              <div className="font-semibold">
                {i + 1}. {f.title_ko}
              </div>
              <div className="mt-0.5 text-sm text-muted">{f.why_ko}</div>
              <button onClick={() => speak(f.practice_en)} className="mt-1.5 flex items-center gap-1.5 text-left text-sm text-accent">
                <Volume2 className="size-4 shrink-0" /> {f.practice_en}
              </button>
            </div>
          ))}
        </CardBody>
      </Card>

      {report.mistakes.length > 0 && (
        <Card>
          <CardHeader title="반복되는 실수" hint="교정 카드로 자동 추가돼요 (설정에서 끌 수 있어요)" />
          <CardBody className="space-y-2">
            {report.mistakes.map((m, i) => (
              <div key={i} className="rounded-xl border p-3 text-sm">
                <div className="text-xs font-semibold text-muted">{m.pattern}</div>
                <div className="mt-1">
                  <span className="text-bad line-through">{m.wrong}</span> → <span className="font-medium text-good">{m.right}</span>
                </div>
                <div className="mt-1 text-xs text-subtle">{m.explanation_ko}</div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="단어장에 넣을 표현" hint="원어민이라면 이렇게 말해요 · 고른 것만 카드로" />
        <CardBody className="space-y-2">
          {items.map((it) => {
            const on = picked.has(it.key)
            const en = 'expr' in it ? it.expr : it.better
            return (
              <div key={it.key} className={cn('flex items-start gap-3 rounded-xl border p-3', on && 'border-accent/50 bg-accent-soft/50')}>
                <button
                  disabled={saved}
                  onClick={() => setPicked((s) => (s.has(it.key) ? new Set([...s].filter((x) => x !== it.key)) : new Set(s).add(it.key)))}
                  className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border', on && 'border-accent bg-accent text-accent-fg')}
                  aria-label="선택"
                >
                  {on && <Check className="size-3.5" />}
                </button>
                <div className="min-w-0 flex-1 text-sm">
                  {'original' in it && it.original && <div className="text-xs text-subtle line-through">{it.original}</div>}
                  <div className="font-medium">{en}</div>
                  <div className="text-xs text-muted">{it.meaning_ko}</div>
                  {'example' in it && it.example && <div className="text-xs italic text-subtle">{it.example}</div>}
                </div>
                <button onClick={() => speak(en)} className="text-subtle" aria-label="듣기">
                  <Volume2 className="size-4" />
                </button>
              </div>
            )
          })}
          <Button
            variant="primary"
            disabled={saved || busy || picked.size === 0}
            onClick={async () => {
              setBusy(true)
              await post(`/talk/${cid}/cards`, { items: items.filter((i) => picked.has(i.key)) })
              qc.invalidateQueries({ queryKey: ['cards'] })
              qc.invalidateQueries({ queryKey: ['today'] })
              setSaved(true)
              setBusy(false)
            }}
          >
            {saved ? <Check /> : <Plus />} {saved ? '추가했어요' : `${picked.size}개 단어장에 추가`}
          </Button>
        </CardBody>
      </Card>

      {report.next_ko && (
        <Card>
          <CardHeader title="다음 대화 제안" />
          <CardBody className="text-sm">{report.next_ko}</CardBody>
        </Card>
      )}
    </div>
  )
}
