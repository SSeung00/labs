import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ArrowDown, ArrowUp, CalendarDays, Check, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useActivities, useCalendar, useMonthly, usePatchAnyActivity, useRunTypeSummary, useWeekly, type Activity, type MonthTotal } from '@/api/activities'
import { useGear, type Shoe } from '@/api/life'
import { ShoeSwatch } from '@/components/gear/ShoeSwatch'
import { RunTypeDot, RunTypePicker } from '@/components/runtype/RunTypePicker'
import { needsReview, RUN_TYPES, type RunType } from '@/lib/runTypes'
import { fmtDuration, fmtHours, fmtKm, fmtNum, fmtPace, monthLabel, sportLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import { YearHeatmap } from './YearHeatmap'
import { WeeklyVolumeChart } from './WeeklyVolumeChart'
import { MonthlyVolumeChart } from './MonthlyVolumeChart'

const PAGE = 30

type SortKey = 'start_time' | 'distance' | 'duration' | 'pace' | 'hr'

const COLUMNS: { key: SortKey | null; label: string; align?: 'right'; className?: string }[] = [
  { key: 'start_time', label: '날짜' },
  { key: null, label: '활동' },
  { key: null, label: '종류' },
  { key: 'distance', label: '거리', align: 'right' },
  { key: 'duration', label: '시간', align: 'right' },
  { key: 'pace', label: '페이스', align: 'right' },
  { key: 'hr', label: '심박', align: 'right' },
  { key: null, label: '케이던스', align: 'right', className: 'hidden lg:table-cell' },
  { key: null, label: '상승', align: 'right', className: 'hidden xl:table-cell' },
  { key: null, label: '신발' },
]

function YearStats({ cal }: { cal: { distance_m: number; duration_s: number; count: number }[] }) {
  const total = cal.reduce(
    (a, d) => ({ dist: a.dist + d.distance_m, dur: a.dur + d.duration_s, n: a.n + d.count, days: a.days + 1 }),
    { dist: 0, dur: 0, n: 0, days: 0 },
  )
  const stats = [
    { label: '최근 1년 거리', value: fmtNum(total.dist / 1000, 0), unit: 'km' },
    { label: '러닝 횟수', value: fmtNum(total.n), unit: '회' },
    { label: '달린 날', value: fmtNum(total.days), unit: '일' },
    { label: '평균 페이스', value: total.dist ? fmtPace(total.dist / total.dur) : '—', unit: '/km' },
  ]
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label}>
          <div className="text-xs text-subtle">{s.label}</div>
          <div className="num mt-1 text-2xl font-bold tracking-tight">
            {s.value}
            <span className="ml-1 text-sm font-medium text-subtle">{s.unit}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Inline shoe picker: swatch + name over a transparent native select, so it works on touch too. */
function ShoeCell({ a, shoes, onShoe, compact }: { a: Activity; shoes: Shoe[]; onShoe: (id: number | null) => void; compact?: boolean }) {
  const shoe = shoes.find((x) => x.id === a.shoe_id)
  return (
    <label
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'relative inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md hover:text-text',
        compact ? 'text-[11px] text-subtle' : 'text-[13px]',
        !shoe && 'text-subtle',
      )}
      title="신발 바꾸기"
    >
      {shoe ? (
        <ShoeSwatch color={shoe.color} color2={shoe.color2} className="size-2.5" />
      ) : (
        <span className="size-2.5 shrink-0 rounded-full border border-dashed border-border-strong" />
      )}
      <span className="truncate">{shoe ? shoe.name : compact ? '신발 미지정' : '—'}</span>
      <select
        value={a.shoe_id ?? ''}
        onChange={(e) => onShoe(e.target.value ? Number(e.target.value) : null)}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label="신발"
      >
        <option value="">신발 없음</option>
        {shoes
          .filter((x) => !x.retired || x.id === a.shoe_id)
          .map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
              {x.retired ? ' (은퇴)' : ''}
            </option>
          ))}
      </select>
    </label>
  )
}

function MonthSummary({ m }: { m: MonthTotal }) {
  const types = RUN_TYPES.filter((t) => (m.by_type[t.key] ?? 0) > 0)
  return (
    <div className="mx-4 mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl bg-surface-2/70 px-4 py-3 text-sm sm:mx-5">
      <span className="font-semibold">{monthLabel(m.month, true)}</span>
      <span className="num">
        <b>{(m.distance_m / 1000).toFixed(1)}</b> km · {m.count}회 · {fmtHours(m.duration_s)}
        {m.duration_s ? ` · 평균 ${fmtPace(m.distance_m / m.duration_s)}/km` : ''}
      </span>
      <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        {types.map((t) => (
          <span key={t.key} className="inline-flex items-center gap-1">
            <RunTypeDot type={t.key} />
            {t.label} <span className="num">{((m.by_type[t.key] ?? 0) / 1000).toFixed(0)}km</span>
          </span>
        ))}
      </span>
    </div>
  )
}

function Row({ a, onClick, onType, onShoe, shoes, review }: { a: Activity; onClick: () => void; onType: (t: RunType | 'auto') => void; onShoe: (id: number | null) => void; shoes: Shoe[]; review: boolean }) {
  const d = new Date(a.start_time)
  return (
    <tr onClick={onClick} className="group cursor-pointer border-t transition-colors hover:bg-surface-2/70">
      <td className="whitespace-nowrap py-3 pl-5 pr-3">
        <div className="num text-sm font-medium">{format(d, 'yy.MM.dd')}</div>
        <div className="text-[11px] text-subtle">{format(d, 'EEE HH:mm', { locale: ko })}</div>
      </td>
      <td className="max-w-[16rem] px-3 py-3">
        <div className="truncate text-sm font-medium group-hover:text-accent">{a.name || '러닝'}</div>
        <div className="text-[11px] text-subtle">{sportLabel(a.sport)}</div>
      </td>
      <td className="whitespace-nowrap px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1">
          <RunTypePicker type={a.run_type} source={a.run_type_source} confidence={a.run_type_confidence} reason={a.run_type_reason} onChange={onType} />
          {review && a.run_type && needsReview(a.run_type_source, a.run_type_confidence) && (
            <button
              onClick={() => onType(a.run_type!)}
              className="grid size-6 place-items-center rounded-full bg-good/15 text-good hover:bg-good/25"
              title="이 분류가 맞아요"
              aria-label="분류 확정"
            >
              <Check className="size-3.5" />
            </button>
          )}
        </div>
        {review && a.run_type_reason && <div className="mt-1 max-w-[14rem] truncate text-[10px] text-subtle">{a.run_type_reason}</div>}
      </td>
      <td className="num px-3 py-3 text-right text-sm font-semibold">{fmtKm(a.distance_m)}</td>
      <td className="num px-3 py-3 text-right text-sm">{fmtDuration(a.moving_time_s ?? a.duration_s)}</td>
      <td className="num px-3 py-3 text-right text-sm">{fmtPace(a.avg_speed_mps)}</td>
      <td className="num px-3 py-3 text-right text-sm">{fmtNum(a.avg_hr)}</td>
      <td className="num hidden px-3 py-3 text-right text-sm lg:table-cell">{fmtNum(a.avg_cadence)}</td>
      <td className="num hidden px-3 py-3 text-right text-sm xl:table-cell">{a.elevation_gain_m != null ? `${fmtNum(a.elevation_gain_m)} m` : '—'}</td>
      <td className="max-w-[11rem] py-3 pl-3 pr-5">
        <ShoeCell a={a} shoes={shoes} onShoe={onShoe} />
      </td>
    </tr>
  )
}

/** Phone layout: one tappable card per run instead of a wide table. */
function MobileRow({ a, onClick, onType, onShoe, shoes, review }: { a: Activity; onClick: () => void; onType: (t: RunType | 'auto') => void; onShoe: (id: number | null) => void; shoes: Shoe[]; review: boolean }) {
  const d = new Date(a.start_time)
  return (
    <li onClick={onClick} className="flex cursor-pointer items-center gap-3 border-t px-4 py-3 active:bg-surface-2/70">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">{a.name || '러닝'}</div>
        <div className="mt-1 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <span className="num text-xs text-subtle">{format(d, 'M.d (EEE) HH:mm', { locale: ko })}</span>
          <RunTypePicker type={a.run_type} source={a.run_type_source} confidence={a.run_type_confidence} reason={a.run_type_reason} onChange={onType} />
          {review && a.run_type && needsReview(a.run_type_source, a.run_type_confidence) && (
            <button onClick={() => onType(a.run_type!)} className="grid size-7 place-items-center rounded-full bg-good/15 text-good" aria-label="분류 확정">
              <Check className="size-4" />
            </button>
          )}
        </div>
        {review && a.run_type_reason && <div className="mt-1 truncate text-[11px] text-subtle">{a.run_type_reason}</div>}
        <div className="mt-1 flex">
          <ShoeCell a={a} shoes={shoes} onShoe={onShoe} compact />
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="num text-[15px] font-bold">
          {fmtKm(a.distance_m)}
          <span className="ml-0.5 text-[11px] font-medium text-subtle">km</span>
        </div>
        <div className="num mt-0.5 text-[11px] text-subtle">
          {fmtPace(a.avg_speed_mps)} · {fmtDuration(a.moving_time_s ?? a.duration_s)}
        </div>
      </div>
    </li>
  )
}

const SORTS: { key: SortKey; order: 'asc' | 'desc'; label: string }[] = [
  { key: 'start_time', order: 'desc', label: '최신순' },
  { key: 'distance', order: 'desc', label: '긴 거리순' },
  { key: 'pace', order: 'desc', label: '빠른 페이스순' },
  { key: 'duration', order: 'desc', label: '긴 시간순' },
]

export function ActivitiesPage() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [typeFilter, setTypeFilter] = useState<RunType | 'review' | null>(null)
  const [month, setMonth] = useState<string | null>(null)
  const [volView, setVolView] = useState<'month' | 'week'>('month')
  const { data: monthly } = useMonthly()
  const { data: shoes = [] } = useGear()
  const { data: summary } = useRunTypeSummary()
  const patch = usePatchAnyActivity()
  const [sort, setSort] = useState<{ key: SortKey; order: 'asc' | 'desc' }>({ key: 'start_time', order: 'desc' })
  const { data: cal } = useCalendar()
  const { data: weekly } = useWeekly(16)
  const { data, isFetching } = useActivities({
    limit: PAGE,
    offset: page * PAGE,
    sort: sort.key,
    order: sort.order,
    q: q.trim(),
    run_type: typeFilter && typeFilter !== 'review' ? typeFilter : undefined,
    review: typeFilter === 'review' || undefined,
    month: month ?? undefined,
  })
  // Months with runs, newest first.
  const monthList = useMemo(() => [...(monthly ?? [])].reverse().filter((m) => m.count > 0), [monthly])
  const selMonth = monthly?.find((m) => m.month === month) ?? null
  const pickMonth = (m: string | null) => {
    setMonth(m)
    setPage(0)
  }
  const stepMonth = (dir: 1 | -1) => {
    const i = monthList.findIndex((m) => m.month === month)
    const next = monthList[i - dir]
    if (next) pickMonth(next.month)
  }
  const pages = useMemo(() => Math.max(1, Math.ceil((data?.total ?? 0) / PAGE)), [data?.total])

  const toggleSort = (key: SortKey) => {
    setPage(0)
    setSort((s) => (s.key === key ? { key, order: s.order === 'desc' ? 'asc' : 'desc' } : { key, order: 'desc' }))
  }

  return (
    <>
      <PageHeader title="활동" subtitle={data ? `러닝 ${data.total.toLocaleString()}개` : '모든 러닝 기록을 한눈에'} />

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="최근 1년" hint="색 = 그날의 훈련 종류 · 날짜를 누르거나 마우스를 올리면 기록이 보여요" />
          <CardBody className="space-y-6">
            {cal ? <YearStats cal={cal} /> : <div className="h-14 animate-pulse rounded-lg bg-surface-2" />}
            {cal ? <YearHeatmap data={cal} /> : <div className="h-36 animate-pulse rounded-lg bg-surface-2" />}
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader
            title={volView === 'month' ? '월별 거리' : '주간 거리'}
            hint={volView === 'month' ? '색 = 훈련 종류 · 막대를 누르면 그 달만 보기' : '최근 16주 · 이번 주 강조'}
            action={
              <div className="flex rounded-lg bg-surface-2 p-0.5 text-xs font-medium">
                {(['month', 'week'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setVolView(v)}
                    className={cn('rounded-md px-2.5 py-1', volView === v ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text')}
                  >
                    {v === 'month' ? '월별' : '주간'}
                  </button>
                ))}
              </div>
            }
          />
          <CardBody>
            {volView === 'month' ? (
              monthly ? (
                <MonthlyVolumeChart data={monthly} selected={month} onSelect={pickMonth} height={250} />
              ) : (
                <div className="h-[250px] animate-pulse rounded-lg bg-surface-2" />
              )
            ) : weekly ? (
              <WeeklyVolumeChart data={weekly} height={250} />
            ) : (
              <div className="h-[250px] animate-pulse rounded-lg bg-surface-2" />
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(0)
              }}
              placeholder="이름·메모 검색"
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => stepMonth(-1)} disabled={!month || monthList.at(-1)?.month === month} aria-label="이전 달">
              <ChevronLeft />
            </Button>
            <label
              className={cn(
                'relative inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm',
                month ? 'border-accent/50 bg-accent-soft font-semibold' : 'bg-surface-2/70 text-muted',
              )}
            >
              <CalendarDays className="size-4" />
              {month ? monthLabel(month, true) : '전체 기간'}
              <select value={month ?? ''} onChange={(e) => pickMonth(e.target.value || null)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="월 선택">
                <option value="">전체 기간</option>
                {monthList.map((m) => (
                  <option key={m.month} value={m.month}>
                    {monthLabel(m.month, true)} · {m.count}회 · {(m.distance_m / 1000).toFixed(0)}km
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => (month ? stepMonth(1) : monthList[0] && pickMonth(monthList[0].month))}
              disabled={monthList[0]?.month === month}
              aria-label="다음 달"
            >
              <ChevronRight />
            </Button>
            {month && (
              <Button variant="ghost" size="icon" onClick={() => pickMonth(null)} aria-label="월 선택 해제">
                <X />
              </Button>
            )}
          </div>
          {/* Phones: one swipeable row of chips. */}
          <div className="-mx-4 flex w-[calc(100%+2rem)] items-center gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0">
            <button
              onClick={() => { setTypeFilter(null); setPage(0) }}
              className={cn('h-8 shrink-0 rounded-full px-3 text-xs font-medium', !typeFilter ? 'bg-text text-bg' : 'bg-surface-2 text-muted hover:text-text')}
            >
              전체
            </button>
            {RUN_TYPES.map((t) => (
              <button
                key={t.key}
                onClick={() => { setTypeFilter(typeFilter === t.key ? null : t.key); setPage(0) }}
                className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium', typeFilter === t.key ? 'bg-text text-bg' : 'bg-surface-2 text-muted hover:text-text')}
              >
                <RunTypeDot type={t.key} />
                {t.label}
                <span className="num opacity-60">{summary?.types[t.key]?.count ?? ''}</span>
              </button>
            ))}
            {!!summary?.review && (
              <button
                onClick={() => { setTypeFilter(typeFilter === 'review' ? null : 'review'); setPage(0) }}
                className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-dashed px-3 text-xs font-semibold', typeFilter === 'review' ? 'border-warn bg-warn/15 text-text' : 'border-warn/60 text-warn hover:bg-warn/10')}
              >
                확인 필요 <span className="num">{summary.review}</span>
              </button>
            )}
          </div>
          {isFetching && <span className="text-xs text-subtle">불러오는 중…</span>}
          <select
            value={`${sort.key}:${sort.order}`}
            onChange={(e) => {
              const [key, order] = e.target.value.split(':') as [SortKey, 'asc' | 'desc']
              setSort({ key, order })
              setPage(0)
            }}
            className="h-8 rounded-lg border bg-surface-2/70 px-2 text-xs text-muted md:hidden"
            aria-label="정렬"
          >
            {SORTS.map((o) => <option key={o.key} value={`${o.key}:${o.order}`}>{o.label}</option>)}
            {!SORTS.some((o) => o.key === sort.key && o.order === sort.order) && <option value={`${sort.key}:${sort.order}`}>사용자 정렬</option>}
          </select>
          <div className="num ml-auto flex items-center gap-2 text-xs text-subtle">
            {page + 1} / {pages}
            <Button variant="ghost" size="icon" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="이전 페이지">
              <ChevronLeft />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} aria-label="다음 페이지">
              <ChevronRight />
            </Button>
          </div>
        </div>
        {selMonth && <MonthSummary m={selMonth} />}
        {typeFilter === 'review' && (
          <div className="mx-4 mb-3 rounded-xl sm:mx-5 bg-warn/10 px-4 py-3 text-sm text-muted">
            자동 분류가 애매한 러닝이에요. 맞으면 <Check className="inline size-3.5 text-good" />, 아니면 종류 칩을 눌러 고르세요. 직접 정한 분류는 다시 바뀌지 않아요.
          </div>
        )}
        <ul className="md:hidden">
          {data?.items.map((a) => (
            <MobileRow
              key={a.id}
              a={a}
              review={typeFilter === 'review'}
              onClick={() => navigate(`/activities/${a.id}`)}
              onType={(t) => patch.mutate({ id: a.id, run_type: t })}
              onShoe={(id) => patch.mutate({ id: a.id, shoe_id: id })}
              shoes={shoes}
            />
          ))}
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
                {COLUMNS.map((c, i) => (
                  <th
                    key={c.label}
                    className={cn(
                      'py-2.5 font-semibold',
                      i === 0 ? 'pl-5 pr-3' : i === COLUMNS.length - 1 ? 'pl-3 pr-5' : 'px-3',
                      c.align === 'right' ? 'text-right' : 'text-left',
                      c.className,
                    )}
                  >
                    {c.key ? (
                      <button onClick={() => toggleSort(c.key!)} className={cn('inline-flex items-center gap-1 hover:text-text', sort.key === c.key && 'text-text')}>
                        {c.label}
                        {sort.key === c.key && (sort.order === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((a) => (
                <Row
                  key={a.id}
                  a={a}
                  review={typeFilter === 'review'}
                  onClick={() => navigate(`/activities/${a.id}`)}
                  onType={(t) => patch.mutate({ id: a.id, run_type: t })}
              onShoe={(id) => patch.mutate({ id: a.id, shoe_id: id })}
              shoes={shoes}
                />
              ))}
            </tbody>
          </table>
        </div>
        {data && data.items.length === 0 && <div className="border-t py-12 text-center text-sm text-subtle">조건에 맞는 활동이 없어요</div>}
      </Card>
    </>
  )
}
