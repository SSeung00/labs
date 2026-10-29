import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Archive, CalendarRange, FileUp, Footprints, Loader2, MoreHorizontal, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { ShoeSwatch } from '@/components/gear/ShoeSwatch'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input, Label } from '@/components/ui/input'
import { useAssignShoe, useCreateShoe, useDeleteShoe, useGear, useImportShoeCsv, usePatchShoe, type Shoe } from '@/api/life'
import { fmtNum, fmtPaceSec } from '@/lib/format'
import { cn } from '@/lib/utils'

function wearTone(w: number | null) {
  if (w == null) return 'bg-accent'
  if (w >= 0.9) return 'bg-bad'
  if (w >= 0.7) return 'bg-warn'
  return 'bg-good'
}

const PRESETS = ['#111827', '#f8fafc', '#ff6a3d', '#ef4444', '#f59e0b', '#facc15', '#a3e635', '#10b981', '#22d3ee', '#3b82f6', '#8b5cf6', '#ec4899', '#94a3b8']

function ColorField({ label, value, onChange, optional }: { label: string; value: string | null; onChange: (c: string | null) => void; optional?: boolean }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {optional && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className={cn('grid size-7 place-items-center rounded-full border border-dashed text-[10px] text-subtle ring-offset-2 ring-offset-surface', value == null && 'ring-2 ring-text')}
            aria-label="없음"
          >
            —
          </button>
        )}
        {PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={cn('size-7 rounded-full ring-1 ring-black/10 ring-offset-2 ring-offset-surface dark:ring-white/15', value?.toLowerCase() === c && 'ring-2 ring-text')}
            style={{ background: c }}
            aria-label={c}
          />
        ))}
        <label className="relative grid size-7 cursor-pointer place-items-center overflow-hidden rounded-full border text-[10px] text-subtle" title="직접 고르기">
          +
          <input type="color" value={value ?? '#ff6a3d'} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
      </div>
    </div>
  )
}

/** Create a shoe, or edit one when `shoe` is given. */
function ShoeForm({ shoe, onDone }: { shoe?: Shoe; onDone: () => void }) {
  const create = useCreateShoe()
  const patch = usePatchShoe()
  const [name, setName] = useState(shoe?.name ?? '')
  const [brand, setBrand] = useState(shoe?.brand ?? '')
  const [bought, setBought] = useState(shoe?.purchased_on ?? '')
  const [retire, setRetire] = useState(String(shoe?.retire_at_km ?? 700))
  const [initial, setInitial] = useState(String(shoe?.initial_km ?? 0))
  const [color, setColor] = useState<string | null>(shoe?.color ?? PRESETS[2])
  const [color2, setColor2] = useState<string | null>(shoe?.color2 ?? null)
  const [note, setNote] = useState(shoe?.note ?? '')
  const [def, setDef] = useState(shoe ? !!shoe.is_default : true)
  const busy = create.isPending || patch.isPending
  const error = create.error ?? patch.error
  return (
    <form
      className="space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault()
        const body = {
          name,
          brand: brand || null,
          purchased_on: bought || null,
          retire_at_km: Number(retire) || 700,
          initial_km: Number(initial) || 0,
          color,
          color2,
          note: note || null,
          is_default: def,
        }
        if (shoe) patch.mutate({ id: shoe.id, ...body }, { onSuccess: onDone })
        else create.mutate(body, { onSuccess: onDone })
      }}
    >
      <div className="flex items-center gap-3 rounded-xl bg-surface-2/60 p-3">
        <ShoeSwatch color={color} color2={color2} className="size-9" />
        <div className="min-w-0">
          <div className="truncate font-semibold">{name || '새 신발'}</div>
          <div className="text-xs text-subtle">{brand || '브랜드'}</div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="s-name">이름</Label>
          <Input id="s-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 노바블라스트 5" />
        </div>
        <div>
          <Label htmlFor="s-brand">브랜드</Label>
          <Input id="s-brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="예: ASICS" />
        </div>
        <div>
          <Label htmlFor="s-date">구매일</Label>
          <Input id="s-date" type="date" value={bought} onChange={(e) => setBought(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="s-retire">교체 기준 (km)</Label>
          <Input id="s-retire" inputMode="numeric" value={retire} onChange={(e) => setRetire(e.target.value)} className="num" />
        </div>
        <div>
          <Label htmlFor="s-init">기록 전에 달린 거리 (km)</Label>
          <Input id="s-init" inputMode="numeric" value={initial} onChange={(e) => setInitial(e.target.value)} className="num" />
        </div>
        <div>
          <Label htmlFor="s-note">메모</Label>
          <Input id="s-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="용도, 사이즈 등" />
        </div>
      </div>
      <ColorField label="메인 색" value={color} onChange={setColor} />
      <ColorField label="보조 색 (선택)" value={color2} onChange={setColor2} optional />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={def} onChange={(e) => setDef(e.target.checked)} className="size-4 accent-[var(--accent)]" />
        기본 신발로 설정 (새로 동기화되는 러닝에 자동 배정)
      </label>
      {error && <p className="text-xs text-bad">{error.message}</p>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} {shoe ? '저장' : '추가'}
        </Button>
      </div>
    </form>
  )
}

function AssignForm({ shoe, onDone }: { shoe: Shoe; onDone: () => void }) {
  const assign = useAssignShoe()
  const [start, setStart] = useState(shoe.purchased_on ?? '')
  const [end, setEnd] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  return (
    <form
      className="space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault()
        assign.mutate({ id: shoe.id, start, end: end || null, overwrite })
      }}
    >
      <p className="text-sm text-muted">이 기간의 러닝에 <b className="text-text">{shoe.name}</b>을(를) 배정해요.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="a-start">시작일</Label>
          <Input id="a-start" type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="a-end">종료일 (비우면 오늘까지)</Label>
          <Input id="a-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="size-4 accent-[var(--accent)]" />
        이미 다른 신발이 배정된 러닝도 덮어쓰기
      </label>
      {assign.data && <p className="rounded-lg bg-good/10 px-3 py-2 text-sm text-good">러닝 {assign.data.assigned}개에 배정했어요.</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>닫기</Button>
        <Button type="submit" variant="primary" disabled={!start || assign.isPending}>
          {assign.isPending && <Loader2 className="animate-spin" />} 배정
        </Button>
      </div>
    </form>
  )
}

function ShoeCard({ s, onAssign, onEdit }: { s: Shoe; onAssign: (s: Shoe) => void; onEdit: (s: Shoe) => void }) {
  const patch = usePatchShoe()
  const del = useDeleteShoe()
  const [menu, setMenu] = useState(false)
  const pct = Math.min(100, (s.wear ?? 0) * 100)
  return (
    <Card className={cn('relative overflow-hidden', s.retired && 'opacity-60')}>
      <div className="flex h-1.5">
        <div className="flex-1" style={{ background: s.color ?? 'var(--accent)' }} />
        {s.color2 && <div className="flex-1" style={{ background: s.color2 }} />}
      </div>
      <CardBody className="pt-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <ShoeSwatch color={s.color} color2={s.color2} />
              <h3 className="truncate font-semibold">{s.name}</h3>
              {s.is_default && <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent"><Star className="size-3" />기본</span>}
              {s.retired && <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-semibold text-muted">은퇴</span>}
            </div>
            <div className="text-xs text-subtle">{s.brand ?? '브랜드 미입력'}{s.purchased_on ? ` · ${format(parseISO(s.purchased_on), 'yy.M.d')} 구매` : ''}</div>
          </div>
          <div className="relative">
            <Button size="icon" variant="ghost" onClick={() => setMenu((m) => !m)} aria-label="메뉴">
              <MoreHorizontal />
            </Button>
            {menu && (
              <div className="absolute right-0 top-10 z-20 w-44 rounded-xl border bg-surface p-1 shadow-xl" onMouseLeave={() => setMenu(false)}>
                <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-surface-2" onClick={() => { setMenu(false); onEdit(s) }}>
                  <Pencil className="size-4" /> 수정
                </button>
                {!s.is_default && !s.retired && (
                  <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-surface-2" onClick={() => patch.mutate({ id: s.id, is_default: true })}>
                    <Star className="size-4" /> 기본 신발로
                  </button>
                )}
                <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-surface-2" onClick={() => patch.mutate({ id: s.id, retired: !s.retired, is_default: s.retired ? s.is_default : false })}>
                  <Archive className="size-4" /> {s.retired ? '다시 사용' : '은퇴시키기'}
                </button>
                <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-bad hover:bg-surface-2" onClick={() => confirm(`${s.name}을(를) 삭제할까요? 러닝 기록은 남아요.`) && del.mutate(s.id)}>
                  <Trash2 className="size-4" /> 삭제
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-baseline justify-between">
          <span className="num text-3xl font-bold tracking-tight">{fmtNum(s.km)}<span className="ml-1 text-sm font-medium text-subtle">km</span></span>
          <span className="num text-xs text-subtle">/ {s.retire_at_km} km</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
          <div className={cn('h-full rounded-full transition-all', wearTone(s.wear))} style={{ width: `${pct}%` }} />
        </div>
        {s.wear != null && s.wear >= 0.9 && !s.retired && <p className="mt-1.5 text-[11px] font-medium text-bad">교체 시기가 됐어요</p>}

        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[
            { k: '러닝', v: `${s.runs}회` },
            { k: '평균 페이스', v: s.avg_pace_s_per_km ? fmtPaceSec(s.avg_pace_s_per_km) : '—' },
            { k: '평균 EF', v: s.avg_ef ? s.avg_ef.toFixed(2) : '—' },
          ].map((x) => (
            <div key={x.k} className="rounded-lg bg-surface-2/60 py-2">
              <dt className="text-[10px] text-subtle">{x.k}</dt>
              <dd className="num text-sm font-semibold">{x.v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex items-center justify-between text-[11px] text-subtle">
          <span>{s.last_used ? `마지막 ${format(parseISO(s.last_used), 'yy.M.d')}` : '아직 기록 없음'}</span>
          <button onClick={() => onAssign(s)} className="inline-flex items-center gap-1 text-muted hover:text-text">
            <CalendarRange className="size-3.5" /> 기간으로 배정
          </button>
        </div>
      </CardBody>
    </Card>
  )
}

export function GearPage() {
  const { data, isLoading } = useGear()
  const [adding, setAdding] = useState(false)
  const [assigning, setAssigning] = useState<Shoe | null>(null)
  const [editing, setEditing] = useState<Shoe | null>(null)
  const importCsv = useImportShoeCsv()
  const unassigned = data?.[0]?.unassigned_runs ?? 0

  return (
    <>
      <PageHeader
        title="장비"
        subtitle="신발 마일리지와 신발별 효율"
        actions={
          <div className="flex gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border bg-surface-2 px-4 text-sm font-medium hover:bg-surface-3" title="Type, Date, Title, Distance, …, Shoe 열이 있는 기록표">
              {importCsv.isPending ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
              기록표 CSV
              <input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv.mutate(e.target.files[0])} />
            </label>
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus /> 신발 추가
            </Button>
          </div>
        }
      />
      {importCsv.data && (
        <div className="mb-4 rounded-xl bg-good/10 px-4 py-3 text-sm text-muted">
          기록표 {importCsv.data.rows}행 중 <b className="text-text">{importCsv.data.matched}개</b>를 활동과 맞췄어요
          {importCsv.data.shoes_created.length ? ` · 새 신발 ${importCsv.data.shoes_created.join(', ')}` : ''} · 레이스 {importCsv.data.races}개 표시 · 제목 {importCsv.data.renamed}개 반영
          {importCsv.data.unmatched.length > 0 && <span className="text-subtle"> · 못 찾은 행 {importCsv.data.unmatched.length}개</span>}
        </div>
      )}
      {importCsv.error && <p className="mb-4 rounded-xl bg-bad/10 px-4 py-3 text-sm text-bad">{importCsv.error.message}</p>}
      {data && data.length > 0 && unassigned > 0 && (
        <div className="mb-4 rounded-xl border bg-surface-2/60 px-4 py-3 text-sm text-muted">
          신발이 지정되지 않은 러닝이 <b className="text-text">{unassigned}개</b> 있어요. 각 신발의 <b className="text-text">기간으로 배정</b>으로 한 번에 채울 수 있어요.
        </div>
      )}
      {isLoading ? (
        <div className="h-64 animate-pulse rounded-card bg-surface" />
      ) : data?.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data.map((s) => <ShoeCard key={s.id} s={s} onAssign={setAssigning} onEdit={setEditing} />)}</div>
      ) : (
        <Card>
          <EmptyState icon={Footprints} title="등록된 신발이 없어요" action={<Button variant="primary" onClick={() => setAdding(true)}><Plus /> 첫 신발 추가</Button>}>
            신발을 등록하면 누적 거리와 교체 시기를 알려 주고, 신발별로 페이스·효율을 비교할 수 있어요.
          </EmptyState>
        </Card>
      )}
      <Dialog open={adding} onClose={() => setAdding(false)} title="신발 추가">
        <ShoeForm onDone={() => setAdding(false)} />
      </Dialog>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title="신발 수정">
        {editing && <ShoeForm key={editing.id} shoe={editing} onDone={() => setEditing(null)} />}
      </Dialog>
      <Dialog open={!!assigning} onClose={() => setAssigning(null)} title="기간으로 배정">
        {assigning && <AssignForm key={assigning.id} shoe={assigning} onDone={() => setAssigning(null)} />}
      </Dialog>
    </>
  )
}
