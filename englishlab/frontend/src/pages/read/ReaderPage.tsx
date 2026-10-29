import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, BookOpenText, Check, Eye, EyeOff, Headphones, Loader2, Maximize2, MessagesSquare, Minimize2, NotebookPen, PanelRight, Pause,
  PenLine, Play, Plus, Type, Underline, Volume2, X,
} from 'lucide-react'
import { post } from '@/api/client'
import { gloss, tts, useAddCard, useReading, useRefreshProgress } from '@/api/el'
import { putInk, getInk, quickGloss } from '@/api/plan'
import type { Conversation, Gloss, Reading, Stroke, TtsClip } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Segmented } from '@/components/ui/controls'
import { Dialog } from '@/components/ui/dialog'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { GlossSheet, type GlossTarget } from '@/components/GlossSheet'
import { InkToolbar } from '@/components/ink/InkToolbar'
import { InkPad } from '@/components/ink/InkPad'
import { useReaderInk } from '@/components/ink/useReaderInk'
import { hlColor, isDark, useInkTool } from '@/lib/ink'
import { playKey, speak, stopAudio, usePlayingKey } from '@/lib/audio'
import { useMediaQuery } from '@/lib/useMedia'
import { useFocusMode } from '@/stores/focus'
import { cn } from '@/lib/utils'

const WORD = /([A-Za-z]+(?:['’][A-Za-z]+)*)/

interface Tok {
  t: string
  word: boolean
  wi: number // word index in the paragraph (-1 for separators)
  start: number // char offset
}

function tokenize(p: string): Tok[] {
  const out: Tok[] = []
  let wi = 0
  let pos = 0
  for (const part of p.split(WORD)) {
    if (!part) continue
    const word = WORD.test(part) && /^[A-Za-z]/.test(part)
    out.push({ t: part, word, wi: word ? wi++ : -1, start: pos })
    pos += part.length
  }
  return out
}

function sentenceAt(p: string, offset: number): string {
  const re = /[^.!?]+[.!?]*["'’”)\]]*\s*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(p))) {
    if (offset >= m.index && offset < m.index + m[0].length) return m[0].trim()
  }
  return p.slice(0, 300)
}

const norm = (s: string) => s.toLowerCase().replace(/’/g, "'").replace(/[^a-z']/g, '')
const formKey = (s: string) => s.toLowerCase().replace(/’/g, "'")

/** Map TTS word marks to word indices (marks can split/merge differently from our tokens). */
function alignMarks(toks: Tok[], marks: TtsClip['marks']): number[] {
  const words = toks.filter((t) => t.word)
  const out: number[] = []
  let j = 0
  for (const m of marks) {
    const w = norm(m.w)
    let found = -1
    for (let k = j; k < Math.min(words.length, j + 4); k++) {
      const tw = norm(words[k].t)
      if (tw === w || tw.startsWith(w) || w.startsWith(tw)) {
        found = k
        break
      }
    }
    if (found >= 0) j = found + 1
    out.push(found >= 0 ? words[found].wi : -1)
  }
  return out
}

function targetRanges(p: string, terms: string[]): [number, number][] {
  const low = p.toLowerCase()
  const out: [number, number][] = []
  for (const term of terms) {
    const t = term.toLowerCase()
    let i = low.indexOf(t)
    while (i >= 0) {
      out.push([i, i + t.length])
      i = low.indexOf(t, i + t.length)
    }
  }
  return out
}

type LookupMode = 'off' | 'tap' | 'hint'

function Paragraph({
  text,
  index,
  active,
  forms,
  targets,
  showUnknown,
  hidden,
  hints,
  marks,
  dark,
  onWord,
  onPlay,
  playing,
}: {
  text: string
  index: number
  active: number | null
  forms: Record<string, string>
  targets: string[]
  showUnknown: boolean
  hidden: boolean
  hints: Record<string, string> | null
  marks: Map<number, number> | undefined
  dark: boolean
  onWord: (tk: Tok) => void
  onPlay: () => void
  playing: boolean
}) {
  const toks = useMemo(() => tokenize(text), [text])
  const ranges = useMemo(() => targetRanges(text, targets), [text, targets])
  return (
    <div className="group relative" data-p={index}>
      <button
        onClick={onPlay}
        className={cn(
          'absolute -left-9 top-1 hidden size-7 place-items-center rounded-full text-subtle hover:bg-surface-2 hover:text-accent sm:grid',
          playing && 'grid text-accent',
        )}
        aria-label="이 문단 듣기"
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </button>
      <p className={cn('transition-[filter]', hidden && 'select-none blur-md')}>
        {toks.map((tk, i) => {
          if (!tk.word) return <span key={i}>{tk.t}</span>
          const isTarget = ranges.some(([a, b]) => tk.start >= a && tk.start < b)
          const unknown = !!forms[formKey(tk.t)]
          const hint = hints && unknown ? hints[formKey(tk.t)] : undefined
          const mark = marks?.get(tk.wi)
          return (
            <span
              key={i}
              data-wi={tk.wi}
              data-ko={hint}
              onClick={() => {
                const sel = window.getSelection()?.toString().trim() ?? ''
                if (sel.includes(' ')) return // a phrase selection is handled on pointer-up
                onWord(tk)
              }}
              style={mark != null ? { background: `color-mix(in srgb, ${hlColor(mark, dark)} ${dark ? 55 : 60}%, transparent)` } : undefined}
              className={cn(
                'cursor-pointer rounded-[3px] transition-colors hover:bg-accent-soft',
                isTarget && 'font-semibold text-accent',
                showUnknown && unknown && !isTarget && 'underline decoration-warn/70 decoration-dotted decoration-2 underline-offset-4',
                hint && 'relative before:pointer-events-none before:absolute before:-top-[1.05em] before:left-0 before:whitespace-nowrap before:font-sans before:text-[0.56em] before:font-medium before:leading-none before:text-accent before:content-[attr(data-ko)]',
                active === tk.wi && 'bg-accent/30',
              )}
            >
              {tk.t}
            </span>
          )
        })}
      </p>
    </div>
  )
}

function Quiz({ r, answers, setAnswers, onChecked }: { r: Reading; answers: number[]; setAnswers: (a: number[]) => void; onChecked: () => void }) {
  const [checked, setChecked] = useState(false)
  const qs = r.data.questions ?? []
  if (!qs.length) return null
  return (
    <Card>
      <CardHeader title="이해도 확인" hint={checked ? `${qs.filter((q, i) => q.answer === answers[i]).length} / ${qs.length} 정답` : '읽은 뒤 풀어 보세요 (듣기 먼저 모드에서 텍스트를 안 보고 풀면 듣기 실력에 반영돼요)'} />
      <CardBody className="space-y-4">
        {qs.map((q, qi) => (
          <div key={qi}>
            <div className="mb-2 text-[15px] font-medium">
              {qi + 1}. {q.q}
            </div>
            <div className="grid gap-1.5">
              {q.choices.map((c, ci) => {
                const picked = answers[qi] === ci
                const right = checked && ci === q.answer
                const wrong = checked && picked && ci !== q.answer
                return (
                  <button
                    key={ci}
                    disabled={checked}
                    onClick={() => setAnswers(answers.map((v, j) => (j === qi ? ci : v)))}
                    className={cn(
                      'rounded-lg border px-3 py-2.5 text-left text-sm',
                      picked && !checked && 'border-accent bg-accent-soft',
                      right && 'border-good bg-good/10',
                      wrong && 'border-bad bg-bad/10',
                    )}
                  >
                    {c}
                  </button>
                )
              })}
            </div>
            {checked && <p className="mt-2 text-sm text-muted">{q.explanation_ko}</p>}
          </div>
        ))}
        {!checked && (
          <Button
            variant="secondary"
            disabled={answers.some((a) => a < 0)}
            onClick={() => {
              onChecked()
              setChecked(true)
            }}
          >
            채점하기
          </Button>
        )}
      </CardBody>
    </Card>
  )
}

function useStudyTimer(playing: boolean) {
  const [read, setRead] = useState(0)
  const [listen, setListen] = useState(0)
  const last = useRef(Date.now())
  useEffect(() => {
    const touch = () => (last.current = Date.now())
    const evs = ['scroll', 'pointerdown', 'pointermove', 'keydown', 'touchmove'] as const
    evs.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (playing) setListen((s) => s + 1)
      else if (Date.now() - last.current < 90_000) setRead((s) => s + 1)
    }, 1000)
    return () => {
      evs.forEach((e) => window.removeEventListener(e, touch))
      window.clearInterval(id)
    }
  }, [playing])
  return { read, listen }
}

interface Lookup {
  key: string
  term: string
  sentence: string
  quick?: string
}

/** One looked-up word in the side panel: the quick meaning at once, the full explanation on demand. */
function LookupCard({ item, auto, source, onLooked }: { item: Lookup; auto: boolean; source: { kind: string; id: number }; onLooked: (term: string, g: Gloss) => void }) {
  const [g, setG] = useState<Gloss | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [added, setAdded] = useState(false)
  const add = useAddCard()
  const load = () => {
    if (busy || g) return
    setBusy(true)
    gloss(item.term, item.sentence)
      .then((d) => {
        setG(d)
        onLooked(item.term, d)
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(false))
  }
  useEffect(() => {
    if (auto && !item.quick) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="rounded-xl border bg-surface-2/40 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{item.term}</div>
          {g ? (
            <div className="text-sm">{g.meaning_ko}</div>
          ) : item.quick ? (
            <div className="text-sm">{item.quick}</div>
          ) : busy ? (
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <Loader2 className="size-3.5 animate-spin" /> 찾는 중…
            </div>
          ) : null}
        </div>
        <button onClick={() => speak(g?.lemma && !item.term.includes(' ') ? g.lemma : item.term)} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="발음">
          <Volume2 className="size-4" />
        </button>
        <button
          disabled={added}
          onClick={() =>
            add.mutate(
              { term: g?.lemma && !item.term.includes(' ') ? g.lemma : item.term, context: item.sentence, meaning_ko: g?.meaning_ko ?? item.quick, definition_en: g?.definition_en, source_kind: source.kind, source_id: source.id },
              { onSuccess: () => setAdded(true) },
            )
          }
          className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 disabled:text-good"
          aria-label="단어장에 추가"
        >
          {added ? <Check className="size-4" /> : <Plus className="size-4" />}
        </button>
      </div>
      {g && (
        <div className="mt-2 space-y-1.5 text-sm">
          <p className="text-muted">{g.definition_en}</p>
          {g.note_ko && <p className="rounded-lg bg-surface px-2.5 py-1.5 text-[13px]">{g.note_ko}</p>}
          <p className="italic">{g.example_en}</p>
          <p className="text-xs text-subtle">{g.example_ko}</p>
        </div>
      )}
      {!g && !busy && (
        <button onClick={load} className="mt-1.5 text-xs font-medium text-accent">
          자세히 (문맥 뜻·예문)
        </button>
      )}
      {err && <p className="mt-1 text-xs text-bad">{err}</p>}
    </div>
  )
}

function ReadingNotes({ readingId, inPanel = false }: { readingId: number; inPanel?: boolean }) {
  const [initial, setInitial] = useState<Stroke[] | null>(null)
  const [height, setHeight] = useState(1400)
  useEffect(() => {
    getInk('readnote', readingId).then((d) => {
      setInitial(d.strokes ?? [])
      setHeight(d.height || 1400)
    })
  }, [readingId])
  if (!initial) return <div className="p-4 text-sm text-muted">불러오는 중…</div>
  return <InkPad initial={initial} initialHeight={height} onSave={(d) => void putInk('readnote', readingId, { ...d, highlights: [] })} toolbarClassName={inPanel ? 'top-0' : undefined} />
}

const LOOKUP_KEY = 'englishlab-lookup'

export function ReaderPage() {
  const id = Number(useParams().id)
  const { data: r } = useReading(id)
  const nav = useNavigate()
  const qc = useQueryClient()
  const refresh = useRefreshProgress()
  const add = useAddCard()
  const playingKey = usePlayingKey()
  const wide = useMediaQuery('(min-width: 64rem)')
  const { focus, setFocus } = useFocusMode()
  const inkTool = useInkTool()
  const [mode, setMode] = useState<'read' | 'listen'>(() => (new URLSearchParams(location.search).get('mode') === 'listen' ? 'listen' : 'read'))
  const [reveal, setReveal] = useState(false)
  const revealedEver = useRef(mode === 'read')
  const quizMode = useRef<'read' | 'listen'>('read')
  const [showUnknown, setShowUnknown] = useState(true)
  const [size, setSize] = useState(() => localStorage.getItem('englishlab-reader-size') || 'md')
  const [lookupMode, setLookupMode] = useState<LookupMode>(() => (localStorage.getItem(LOOKUP_KEY) as LookupMode) || 'tap')
  const [speed, setSpeed] = useState(1)
  const [target, setTarget] = useState<GlossTarget | null>(null)
  const [peek, setPeek] = useState<Lookup | null>(null)
  const [lookups, setLookups] = useState<Lookup[]>([])
  const [panel, setPanel] = useState(true)
  const [panelTab, setPanelTab] = useState<'words' | 'notes'>('words')
  const [inkOpen, setInkOpen] = useState(() => inkTool.tool !== 'none')
  const [quick, setQuick] = useState<Record<string, string> | null>(null)
  const [quickBusy, setQuickBusy] = useState(false)
  const [looked, setLooked] = useState<Set<string>>(new Set())
  const [answers, setAnswers] = useState<number[]>([])
  const [active, setActive] = useState<{ p: number; w: number } | null>(null)
  const [loadingP, setLoadingP] = useState<number | null>(null)
  const [finishOpen, setFinishOpen] = useState(false)
  const [savedTerms, setSavedTerms] = useState<Set<string>>(new Set())
  const playAll = useRef(false)
  const wrap = useRef<HTMLDivElement>(null)
  const timer = useStudyTimer(!!playingKey)
  const showPanel = wide && panel

  const paras = useMemo(() => (r ? r.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : []), [r])
  const targets = useMemo(() => (r?.data.targets ?? []).map((t) => t.term), [r])

  useEffect(() => {
    if (r) setAnswers((r.data.questions ?? []).map(() => -1))
  }, [r])
  useEffect(() => () => stopAudio(), [])
  useEffect(() => () => useFocusMode.getState().setFocus(false), [])

  // Quick meanings of the likely-unknown words (one cheap AI call per text, cached on the server).
  useEffect(() => {
    if (!r || lookupMode === 'off') return
    if (r.data.quick_gloss) {
      setQuick(r.data.quick_gloss)
      return
    }
    if (quick || quickBusy || !r.unknown.length) return
    setQuickBusy(true)
    quickGloss(r.id)
      .then((d) => setQuick(d.meanings))
      .catch(() => setQuick({}))
      .finally(() => setQuickBusy(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, lookupMode])

  const hints = useMemo(() => {
    if (lookupMode !== 'hint' || !quick || !r) return null
    const out: Record<string, string> = {}
    for (const [form, lemma] of Object.entries(r.unknown_forms)) if (quick[lemma]) out[form] = quick[lemma]
    return out
  }, [lookupMode, quick, r])

  const lookup = (term: string, sentence: string, explicit = false) => {
    if (lookupMode === 'off' && !explicit) return
    const lemma = r?.unknown_forms[formKey(term)] ?? formKey(term)
    const item: Lookup = { key: `${term}-${Date.now()}`, term, sentence, quick: !term.includes(' ') ? quick?.[lemma] : undefined }
    setLooked((s) => new Set(s).add(term.toLowerCase()).add(lemma))
    if (showPanel) {
      setPanelTab('words')
      setLookups((l) => [item, ...l.filter((x) => x.term.toLowerCase() !== term.toLowerCase())].slice(0, 40))
    } else if (item.quick) {
      setPeek(item)
    } else {
      setTarget({ term, sentence })
    }
  }

  const ink = useReaderInk({
    readingId: id,
    wrap,
    ready: !!r,
    onLookup: (words) => {
      const [p] = words[0]
      const toks = tokenize(paras[p] ?? '')
      const set = new Set(words.filter(([wp]) => wp === p).map(([, w]) => w))
      const hit = toks.filter((t) => t.word && set.has(t.wi))
      if (!hit.length) return
      const first = hit[0]
      const last = hit[hit.length - 1]
      const term = (paras[p] ?? '').slice(first.start, last.start + last.t.length).replace(/\s+/g, ' ')
      lookup(term.length > 80 ? first.t : term, sentenceAt(paras[p] ?? '', first.start), true)
    },
  })

  useEffect(() => {
    ink.remeasure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, lookupMode, showPanel, focus, mode, reveal])

  const playPara = async (i: number) => {
    if (i >= paras.length) {
      playAll.current = false
      setActive(null)
      return
    }
    setLoadingP(i)
    try {
      const clip = await tts(paras[i])
      const map = alignMarks(tokenize(paras[i]), clip.marks)
      await playKey(clip.key, {
        speed,
        onTime: (t) => {
          let k = -1
          for (let m = 0; m < clip.marks.length && clip.marks[m].t <= t + 0.05; m++) k = m
          setActive({ p: i, w: k >= 0 ? map[k] : -1 })
        },
        onEnd: () => {
          setActive(null)
          if (playAll.current) void playPara(i + 1)
        },
      })
    } finally {
      setLoadingP(null)
    }
  }

  const togglePara = (i: number) => {
    if (active?.p === i && playingKey) {
      playAll.current = false
      stopAudio()
      setActive(null)
    } else {
      playAll.current = false
      void playPara(i)
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (ink.drawing && e.pointerType === 'pen') return
    const sel = window.getSelection()
    const text = sel?.toString().trim().replace(/\s+/g, ' ') ?? ''
    if (!text.includes(' ') || text.length > 80) return
    const pEl = (sel?.anchorNode?.parentElement as HTMLElement | null)?.closest('[data-p]') ?? (e.target as HTMLElement).closest('[data-p]')
    const pi = pEl ? Number(pEl.getAttribute('data-p')) : 0
    const para = paras[pi] ?? ''
    const off = para.toLowerCase().indexOf(text.toLowerCase())
    lookup(text, sentenceAt(para, Math.max(0, off)), true)
  }

  if (!r) return <PageSkeleton />
  const hidden = mode === 'listen' && !reveal
  const sizeCls =
    size === 'sm' ? 'text-[16px] leading-7' : size === 'lg' ? 'text-[21px] leading-9' : size === 'xl' ? 'text-[24px] leading-10' : 'text-[18px] leading-8'
  const anyPlaying = !!playingKey
  const dark = isDark()
  const setLookupPersist = (m: LookupMode) => {
    setLookupMode(m)
    try {
      localStorage.setItem(LOOKUP_KEY, m)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className={cn('mx-auto', showPanel ? 'max-w-6xl' : 'max-w-3xl')}>
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav('/read')} aria-label="목록">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold tracking-tight">{r.title}</h1>
          <div className="flex flex-wrap gap-x-2 text-xs text-subtle">
            <span>{r.level_label}</span>
            <span className="num">{r.word_count}단어</span>
            <span className="num">아는 단어 {(r.coverage_now * 100).toFixed(1)}%</span>
            {r.source_url && (
              <a href={r.source_url} target="_blank" rel="noreferrer" className="underline">
                원문 링크
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="sticky top-[var(--chrome-top)] z-20 -mx-4 mb-4 border-b bg-bg/85 px-4 py-2 backdrop-blur fold:mx-0 fold:rounded-xl fold:border">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            value={mode}
            onChange={(m) => {
              setMode(m)
              setReveal(false)
              if (m === 'read') revealedEver.current = true
            }}
            options={[
              { value: 'read', label: '읽기' },
              { value: 'listen', label: <><Headphones className="size-3.5" /> 듣기 먼저</> },
            ]}
          />
          <Button
            size="sm"
            variant={anyPlaying && playAll.current ? 'primary' : 'secondary'}
            onClick={() => {
              if (anyPlaying) {
                playAll.current = false
                stopAudio()
                setActive(null)
              } else {
                playAll.current = true
                void playPara(active?.p ?? 0)
              }
            }}
          >
            {loadingP !== null ? <Loader2 className="animate-spin" /> : anyPlaying ? <Pause /> : <Play />} {anyPlaying ? '멈춤' : '전체 듣기'}
          </Button>
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="h-8 rounded-lg border bg-surface-2/60 px-2 text-xs" aria-label="재생 속도">
            {[0.75, 0.9, 1, 1.15, 1.3].map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
          <Segmented
            size="sm"
            value={lookupMode}
            onChange={setLookupPersist}
            options={[
              { value: 'off', label: '뜻 끔' },
              { value: 'tap', label: '탭해서 뜻' },
              { value: 'hint', label: <>뜻 표시{quickBusy && <Loader2 className="size-3 animate-spin" />}</> },
            ]}
          />
          <div className="ml-auto flex items-center gap-1">
            {mode === 'listen' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setReveal(!reveal)
                  revealedEver.current = true
                }}
              >
                {reveal ? <EyeOff /> : <Eye />} {reveal ? '가리기' : '텍스트 보기'}
              </Button>
            )}
            <Button size="icon" variant={inkOpen ? 'secondary' : 'ghost'} onClick={() => {
              if (inkOpen) inkTool.set({ tool: 'none' })
              setInkOpen(!inkOpen)
            }} title="펜 필기" aria-label="펜 필기">
              <PenLine />
            </Button>
            <Button size="icon" variant={showUnknown ? 'secondary' : 'ghost'} onClick={() => setShowUnknown(!showUnknown)} title="모를 것 같은 단어 밑줄" aria-label="모르는 단어 밑줄">
              <Underline />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              title="글자 크기"
              aria-label="글자 크기"
              onClick={() => {
                const order = ['sm', 'md', 'lg', 'xl']
                const next = order[(order.indexOf(size) + 1) % order.length]
                setSize(next)
                try {
                  localStorage.setItem('englishlab-reader-size', next)
                } catch {
                  /* ignore */
                }
              }}
            >
              <Type />
            </Button>
            {wide && (
              <Button size="icon" variant={panel ? 'secondary' : 'ghost'} onClick={() => setPanel(!panel)} title="옆 패널 (단어·메모)" aria-label="옆 패널">
                <PanelRight />
              </Button>
            )}
            <Button size="icon" variant={focus ? 'secondary' : 'ghost'} onClick={() => setFocus(!focus)} title={focus ? '집중 모드 끄기' : '집중 모드 (전체 화면)'} aria-label="집중 모드">
              {focus ? <Minimize2 /> : <Maximize2 />}
            </Button>
          </div>
        </div>
        {inkOpen && (
          <div className="mt-2 flex items-center gap-2 border-t pt-2">
            <InkToolbar lookup onUndo={ink.undo} onRedo={ink.redo} onClear={ink.clear} canUndo={ink.canUndo} canRedo={ink.canRedo} className="flex-1" />
          </div>
        )}
      </div>

      {mode === 'listen' && !reveal && (
        <p className="mb-3 rounded-xl bg-accent-soft px-4 py-2.5 text-sm text-accent">먼저 텍스트 없이 들어 보세요. 텍스트를 보기 전에 퀴즈를 풀면 듣기 실력 추정에 반영돼요. 그다음 '텍스트 보기'로 확인하고 따라 읽어요(쉐도잉).</p>
      )}

      <div className={cn(showPanel && 'grid grid-cols-[minmax(0,1fr)_340px] items-start gap-6')}>
        <div className="min-w-0">
          <div ref={wrap} className={cn('relative', ink.drawing ? 'select-none' : '')}>
            <article
              className={cn('space-y-5 font-serif sm:pl-9', sizeCls, hints && 'leading-[2.35] [&_p]:pt-1')}
              onPointerUp={onPointerUp}
            >
              {paras.map((p, i) => (
                <Paragraph
                  key={i}
                  text={p}
                  index={i}
                  active={active?.p === i ? active.w : null}
                  forms={r.unknown_forms}
                  targets={targets}
                  showUnknown={showUnknown}
                  hidden={hidden}
                  hints={hints}
                  marks={ink.marks.get(i)}
                  dark={dark}
                  playing={active?.p === i && anyPlaying}
                  onPlay={() => togglePara(i)}
                  onWord={(tk) => {
                    if (ink.justTapped()) return
                    lookup(tk.t, sentenceAt(p, tk.start))
                  }}
                />
              ))}
            </article>
            {ink.overlay}
          </div>
          <p className="mt-3 text-xs text-subtle sm:pl-9">
            {lookupMode === 'off'
              ? '뜻 끔: 사전 없이 읽는 연습이에요. 펜의 찾기 도구나 드래그로는 여전히 찾을 수 있어요.'
              : '단어를 탭하면 뜻이 나와요. 여러 단어를 드래그하거나, 펜 도구의 돋보기로 그으면 표현 단위로 찾아 줘요.'}
            {inkOpen && ' 펜(S Pen)으로 쓰고, 형광펜으로 단어를 칠하고, 버튼을 누른 채 그으면 지워져요. 손가락으로는 스크롤돼요.'}
          </p>

          <div className="mt-8 space-y-4">
            {r.data.summary_ko && (
              <Card>
                <CardHeader title="요약" />
                <CardBody className="text-sm leading-relaxed">{r.data.summary_ko}</CardBody>
              </Card>
            )}
            <Card>
              <CardHeader title="이 글에서 배울 표현" hint="단어장에 넣으면 FSRS 복습에 들어가요" />
              <CardBody className="grid gap-2 split:grid-cols-2">
                {[...(r.data.targets ?? []).map((t) => ({ term: t.term, ko: t.meaning_ko, en: t.definition_en })), ...(r.data.expressions ?? []).map((e) => ({ term: e.expr, ko: e.meaning_ko, en: e.note_ko }))].map((t) => {
                  const para = paras.find((p) => p.toLowerCase().includes(t.term.toLowerCase())) ?? ''
                  const saved = savedTerms.has(t.term)
                  return (
                    <div key={t.term} className="flex items-start gap-3 rounded-xl border bg-surface-2/40 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{t.term}</div>
                        <div className="text-sm">{t.ko}</div>
                        {t.en && <div className="text-xs text-subtle">{t.en}</div>}
                      </div>
                      <Button
                        size="sm"
                        variant={saved ? 'ghost' : 'secondary'}
                        disabled={saved}
                        onClick={() =>
                          add.mutate(
                            { term: t.term, context: para ? sentenceAt(para, para.toLowerCase().indexOf(t.term.toLowerCase())) : undefined, meaning_ko: t.ko, source_kind: 'reading', source_id: r.id },
                            { onSuccess: () => setSavedTerms((s) => new Set(s).add(t.term)) },
                          )
                        }
                      >
                        {saved ? <Check /> : <Plus />}
                      </Button>
                    </div>
                  )
                })}
              </CardBody>
            </Card>

            <Quiz
              r={r}
              answers={answers}
              setAnswers={setAnswers}
              onChecked={() => (quizMode.current = mode === 'listen' && !revealedEver.current ? 'listen' : 'read')}
            />

            {r.original && r.mode === 'adapt' && (
              <details className="rounded-card border bg-surface p-4 shadow-card">
                <summary className="cursor-pointer text-sm font-semibold text-muted">원문 보기</summary>
                <div className="mt-3 whitespace-pre-wrap font-serif text-[15px] leading-7 text-muted">{r.original}</div>
              </details>
            )}

            {!showPanel && (
              <details className="rounded-card border bg-surface shadow-card">
                <summary className="flex cursor-pointer items-center gap-2 p-4 text-sm font-semibold text-muted">
                  <NotebookPen className="size-4" /> 이 글 메모 (손글씨)
                </summary>
                <ReadingNotes readingId={r.id} />
              </details>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="primary" className="flex-1" onClick={() => setFinishOpen(true)}>
                <Check /> {r.finished_at ? '다시 읽음 기록' : '다 읽었어요'}
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                onClick={async () => {
                  const res = await post<{ conversation: Conversation }>('/talk', { scenario: 'free', reading_id: r.id })
                  nav(`/talk/${res.conversation.id}`)
                }}
              >
                <MessagesSquare /> 이 글로 AI와 대화하기
              </Button>
            </div>
            <p className="num text-center text-xs text-subtle">
              읽은 시간 {Math.floor(timer.read / 60)}분 {timer.read % 60}초 · 들은 시간 {Math.floor(timer.listen / 60)}분 {timer.listen % 60}초
            </p>
          </div>
        </div>

        {showPanel && (
          <aside className="sticky top-[calc(var(--chrome-top)+4.5rem)] flex max-h-[calc(100dvh-var(--chrome-top)-6rem)] flex-col overflow-hidden rounded-card border bg-surface shadow-card">
            <div className="flex items-center gap-2 border-b p-2">
              <Segmented
                size="sm"
                value={panelTab}
                onChange={setPanelTab}
                options={[
                  { value: 'words', label: <><BookOpenText className="size-3.5" /> 찾은 단어 {lookups.length > 0 && <span className="num">{lookups.length}</span>}</> },
                  { value: 'notes', label: <><NotebookPen className="size-3.5" /> 메모</> },
                ]}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {panelTab === 'words' ? (
                <div className="space-y-2 p-3">
                  {lookups.length === 0 ? (
                    <p className="px-1 py-6 text-center text-sm leading-relaxed text-subtle">
                      단어를 탭하거나 펜 돋보기로 그으면
                      <br />
                      여기에 뜻이 쌓여요. 글을 가리지 않아요.
                    </p>
                  ) : (
                    lookups.map((l, i) => (
                      <LookupCard
                        key={l.key}
                        item={l}
                        auto={i === 0}
                        source={{ kind: 'reading', id: r.id }}
                        onLooked={(term, g) => setLooked((s) => new Set(s).add(term.toLowerCase()).add((g.lemma || '').toLowerCase()))}
                      />
                    ))
                  )}
                </div>
              ) : (
                <ReadingNotes readingId={r.id} inPanel />
              )}
            </div>
          </aside>
        )}
      </div>

      {peek && !showPanel && (
        <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-40 mx-auto max-w-lg rounded-2xl border border-border-strong bg-surface p-3 shadow-2xl fold:bottom-5">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <span className="font-semibold">{peek.term}</span> <span className="text-sm">{peek.quick}</span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => speak(peek.term)} aria-label="발음">
              <Volume2 />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setTarget({ term: peek.term, sentence: peek.sentence })
                setPeek(null)
              }}
            >
              자세히
            </Button>
            <button onClick={() => setPeek(null)} className="grid size-8 place-items-center rounded-lg text-muted" aria-label="닫기">
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      <GlossSheet
        target={target}
        onClose={() => setTarget(null)}
        source={{ kind: 'reading', id: r.id }}
        onLooked={(term, g) => setLooked((s) => new Set(s).add(term.toLowerCase()).add((g.lemma || '').toLowerCase()))}
      />
      <FinishDialog
        open={finishOpen}
        onClose={() => setFinishOpen(false)}
        r={r}
        looked={looked}
        minutes={timer.read / 60}
        listenMinutes={timer.listen / 60}
        answers={answers}
        quizMode={quizMode.current}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ['reading', r.id] })
          qc.invalidateQueries({ queryKey: ['readings'] })
          refresh()
        }}
      />
    </div>
  )
}

function FinishDialog({
  open,
  onClose,
  r,
  looked,
  minutes,
  listenMinutes,
  answers,
  quizMode,
  onDone,
}: {
  open: boolean
  onClose: () => void
  r: Reading
  looked: Set<string>
  minutes: number
  listenMinutes: number
  answers: number[]
  quizMode: 'read' | 'listen'
  onDone: () => void
}) {
  const words = r.unknown.slice(0, 60)
  const [unknown, setUnknown] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ quiz_score: number | null; known_count: number } | null>(null)
  const [mins, setMins] = useState('')
  useEffect(() => {
    if (open) {
      setUnknown(new Set(words.filter((w) => looked.has(w))))
      setResult(null)
      setMins(String(Math.max(1, Math.round(minutes))))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  return (
    <Dialog open={open} onClose={onClose} title={result ? '기록했어요' : '다 읽었어요'} description={result ? undefined : '모를 것 같았던 단어 중 실제로 몰랐던 것만 눌러 주세요. 나머지는 아는 단어로 기록돼요.'}>
      <div className="space-y-4 p-5">
        {result ? (
          <>
            {result.quiz_score != null && (
              <div className="text-lg font-semibold">
                퀴즈 {Math.round(result.quiz_score * 100)}점{quizMode === 'listen' && <span className="ml-2 text-sm font-normal text-muted">듣기 실력에 반영됨</span>}
              </div>
            )}
            <div className="text-sm text-muted">아는 단어(추정) {result.known_count.toLocaleString()}개</div>
            <Link to="/read">
              <Button variant="primary" className="w-full">
                목록으로
              </Button>
            </Link>
          </>
        ) : (
          <>
            {words.length > 0 ? (
              <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">
                {words.map((w) => (
                  <button
                    key={w}
                    onClick={() => setUnknown((s) => (s.has(w) ? new Set([...s].filter((x) => x !== w)) : new Set(s).add(w)))}
                    className={cn('rounded-full border px-3 py-1.5 text-sm', unknown.has(w) ? 'border-warn bg-warn/15 text-warn' : 'text-muted')}
                  >
                    {w}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">모를 것 같은 단어가 없었어요.</p>
            )}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted">읽은 시간</span>
              <input value={mins} onChange={(e) => setMins(e.target.value)} type="number" className="h-9 w-20 rounded-lg border bg-surface-2/60 px-2 text-right" />
              <span className="text-muted">분</span>
              {listenMinutes >= 0.5 && <span className="num text-xs text-subtle">+ 듣기 {Math.round(listenMinutes)}분</span>}
            </div>
            <Button
              variant="primary"
              className="w-full"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const qs = r.data.questions ?? []
                  const res = await post<{ quiz_score: number | null; known_count: number }>(`/readings/${r.id}/finish`, {
                    minutes: Number(mins) || 0,
                    listen_minutes: Math.round(listenMinutes * 10) / 10,
                    answers: qs.length && answers.every((a) => a >= 0) ? answers : null,
                    known: words.filter((w) => !unknown.has(w)),
                    unknown: [...unknown],
                    quiz_mode: quizMode,
                  })
                  setResult(res)
                  onDone()
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Check />} 기록하기
            </Button>
          </>
        )}
      </div>
    </Dialog>
  )
}
