import type { PlacementResult } from '@/api/types'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { cefr, levelColor } from '@/lib/level'

const SKILLS: [keyof PlacementResult['levels'], string][] = [
  ['reading', '읽기'],
  ['listening', '듣기'],
  ['speaking', '말하기'],
  ['writing', '쓰기'],
]

export function LevelBars({ levels }: { levels: Partial<Record<string, number | null>> }) {
  return (
    <div className="space-y-3">
      {SKILLS.map(([k, label]) => {
        const v = levels[k]
        return (
          <div key={k}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="text-muted">{label}</span>
              <span className="num font-semibold">
                {cefr(v)} <span className="text-xs font-normal text-subtle">{v != null ? v.toFixed(1) : ''}</span>
              </span>
            </div>
            <div className="relative h-2.5 rounded-full bg-surface-3">
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${((v ?? 1) - 1) * 20}%`, background: levelColor(v) }} />
              {[2, 3, 4, 5].map((t) => (
                <span key={t} className="absolute inset-y-0 w-px bg-bg/70" style={{ left: `${(t - 1) * 20}%` }} />
              ))}
            </div>
          </div>
        )
      })}
      <div className="flex justify-between px-0.5 text-[10px] text-subtle">
        {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </div>
  )
}

export function PlacementResultView({ result }: { result: PlacementResult }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="진단 결과" hint="CEFR 1–6 척도 (TOEFL iBT 밴드와 같은 척도: 6 = C2)" />
        <CardBody className="space-y-4">
          <LevelBars levels={result.levels} />
          <p className="text-[15px] leading-relaxed">{result.summary_ko}</p>
        </CardBody>
      </Card>
      <div className="grid gap-4 split:grid-cols-2">
        <Card>
          <CardHeader title="강점" />
          <CardBody>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {result.strengths_ko.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="약점" />
          <CardBody>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {result.weaknesses_ko.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="집중할 점 3가지" />
        <CardBody className="space-y-3">
          {result.focus_ko.map((f, i) => (
            <div key={i} className="rounded-xl border bg-surface-2/40 p-3">
              <div className="font-semibold">
                {i + 1}. {f.title}
              </div>
              <div className="mt-1 text-sm text-muted">{f.why}</div>
              <div className="mt-1.5 text-sm">
                <span className="text-accent">연습법 · </span>
                {f.how}
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="목표까지 현실적인 전망" />
        <CardBody>
          <p className="text-sm leading-relaxed">{result.outlook_ko}</p>
        </CardBody>
      </Card>
      <div className="grid gap-4 split:grid-cols-2">
        <Card>
          <CardHeader title="말하기 피드백" />
          <CardBody>
            <p className="text-sm leading-relaxed">{result.speaking_feedback_ko}</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="쓰기 피드백" />
          <CardBody className="space-y-3">
            <p className="text-sm leading-relaxed">{result.writing_feedback_ko}</p>
            {result.writing_improved && (
              <div className="rounded-xl bg-surface-2/60 p-3 font-serif text-[15px] leading-7">
                <div className="mb-1 font-sans text-xs text-subtle">한 단계 위 버전</div>
                {result.writing_improved}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
