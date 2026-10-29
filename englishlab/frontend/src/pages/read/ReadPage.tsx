import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { BookOpen, CheckCircle2, FileText, Globe, Lightbulb, Loader2, Sparkles } from 'lucide-react'
import { post } from '@/api/client'
import { useProfile, useReadings } from '@/api/el'
import type { Reading } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Segmented, Textarea } from '@/components/ui/controls'
import { EmptyState } from '@/components/ui/empty-state'
import { Input, Label } from '@/components/ui/input'
import { PageHeader } from '@/components/layout/PageHeader'
import { useQueryClient } from '@tanstack/react-query'

type Source = 'topic' | 'url' | 'text'

function CreateCard() {
  const [source, setSource] = useState<Source>('topic')
  const [topic, setTopic] = useState('')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'auto' | 'adapt' | 'gloss'>('auto')
  const [length, setLength] = useState<'short' | 'medium' | 'long'>('medium')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data: prof } = useProfile()

  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await post<Reading>('/readings', { source_kind: source, topic, url, text, mode, length })
      qc.invalidateQueries({ queryKey: ['readings'] })
      nav(`/read/${r.id}`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const ready = source === 'topic' ? topic.trim() : source === 'url' ? url.trim() : text.trim().split(/\s+/).length >= 30

  return (
    <Card>
      <CardHeader title="새 읽기 자료" hint="AI가 지금 레벨보다 반 단계 위(i+1)로 맞춰 줘요" />
      <CardBody className="space-y-4">
        <Segmented
          value={source}
          onChange={setSource}
          options={[
            { value: 'topic', label: <><Lightbulb className="size-3.5" /> 관심 주제</> },
            { value: 'url', label: <><Globe className="size-3.5" /> 웹 기사 URL</> },
            { value: 'text', label: <><FileText className="size-3.5" /> 직접 붙여넣기</> },
          ]}
        />
        {source === 'topic' && (
          <div className="space-y-2">
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="예: 시드니 마라톤 코스의 역사, 교량 내진 설계의 최신 트렌드" onKeyDown={(e) => e.key === 'Enter' && ready && submit()} />
            {prof && (
              <div className="flex flex-wrap gap-1.5">
                {prof.profile.interests.map((i) => (
                  <button key={i} onClick={() => setTopic(i)} className="rounded-full border px-2.5 py-1 text-xs text-muted hover:text-text">
                    {i}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {source === 'url' && <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.bbc.com/news/..." inputMode="url" />}
        {source === 'text' && <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="영어 글을 붙여넣으세요 (논문 초록, 뉴스, 블로그…)" />}
        <div className="grid gap-3 sm:grid-cols-2">
          {source !== 'topic' && (
            <div>
              <Label>변환 방식</Label>
              <Segmented
                size="sm"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'auto', label: '자동' },
                  { value: 'adapt', label: '내 수준으로 다시 쓰기' },
                  { value: 'gloss', label: '원문 + 해설' },
                ]}
              />
            </div>
          )}
          <div>
            <Label>길이</Label>
            <Segmented
              size="sm"
              value={length}
              onChange={setLength}
              options={[
                { value: 'short', label: '짧게' },
                { value: 'medium', label: '보통' },
                { value: 'long', label: '길게' },
              ]}
            />
          </div>
        </div>
        {err && <p className="text-sm text-bad">{err}</p>}
        <Button variant="primary" className="w-full" disabled={!ready || busy} onClick={submit}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy ? 'AI가 글을 만드는 중… (20~60초)' : '만들기'}
        </Button>
      </CardBody>
    </Card>
  )
}

export function ReadPage() {
  const { data } = useReadings()
  return (
    <div>
      <PageHeader title="읽기·듣기" subtitle="모르는 단어는 탭하면 바로 뜻이 나오고, 읽어 주기로 듣기 연습도 할 수 있어요" />
      <div className="grid gap-5 split:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <CreateCard />
        <Card>
          <CardHeader title="내 자료" hint={data ? `${data.length}편` : undefined} />
          <CardBody className="space-y-2">
            {data && data.length === 0 && (
              <EmptyState icon={BookOpen} title="아직 읽은 글이 없어요">
                관심 있는 주제나 기사 URL로 첫 글을 만들어 보세요.
              </EmptyState>
            )}
            {data?.map((r) => (
              <Link key={r.id} to={`/read/${r.id}`} className="lift block rounded-xl border bg-surface-2/40 p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.title}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-subtle">
                      <span>{r.level_label}</span>
                      <span className="num">{r.word_count}단어</span>
                      {r.coverage != null && <span className="num">아는 단어 {(r.coverage * 100).toFixed(0)}%</span>}
                      <span>{r.mode === 'gloss' ? '원문' : r.source_kind === 'topic' ? '주제' : '변환'}</span>
                    </div>
                  </div>
                  {r.finished_at && <CheckCircle2 className="size-4 shrink-0 text-good" />}
                </div>
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
