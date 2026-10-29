import { useState, type ReactNode } from 'react'
import { CalendarRange, Check, Copy, DatabaseBackup, Eye, Loader2, Power } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStatus } from '@/api/auth'
import { useBackup, useBackupDir, useLedger, useMakeShortcuts, useRestartService, useRevealKey, useRunBackup, useService, useSetAutostart, useSetLedger } from '@/api/tools'
import { cn } from '@/lib/utils'

function Copyable({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-surface-2/70 py-1 pl-3 pr-1 font-mono text-[12px]">
      <span className="min-w-0 flex-1 truncate" title={text}>{text}</span>
      <Button size="sm" variant="ghost" aria-label="복사" onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500) })}>
        {done ? <Check className="text-good" /> : <Copy />}
      </Button>
    </div>
  )
}

export function BackupCard() {
  const { data } = useBackup()
  const { data: auth } = useAuthStatus()
  const run = useRunBackup()
  const setDir = useBackupDir()
  const reveal = useRevealKey()
  const [dir, setDirText] = useState<string | null>(null)
  if (!data) return <div className="shimmer h-80 rounded-card" />
  const local = !!auth?.local
  const ago = data.last ? Math.round((Date.now() - new Date(data.last).getTime()) / 3600000) : null

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-1.5 text-text"><DatabaseBackup className="size-4 text-accent" /> 자동 백업 (암호화)</span>}
        hint={`MoneyLab이 켜져 있으면 하루 한 번 자동으로 백업하고, 최근 ${data.keep}개를 남겨요.`}
        action={
          <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? <Loader2 className="animate-spin" /> : null}지금 백업
          </Button>
        }
      />
      <CardBody className="space-y-4 text-[13px]">
        <div className={cn('rounded-lg px-3 py-2', ago == null || ago > 48 ? 'bg-warn/10 text-warn' : 'bg-good/10 text-good')}>
          {data.last ? `마지막 백업: ${data.last.replace('T', ' ')} (${ago}시간 전)` : '아직 백업이 없어요'}
          {run.data && <span className="ml-2 text-text">· 방금 {run.data.file} 저장</span>}
          {run.error && <span className="ml-2 text-bad">{run.error.message}</span>}
        </div>

        <div>
          <div className="mb-1.5 text-xs font-semibold text-muted">백업 폴더</div>
          {local ? (
            <div className="flex gap-2">
              <Input value={dir ?? data.dir} onChange={(e) => setDirText(e.target.value)} className="font-mono text-[12px]" />
              <Button
                disabled={dir == null || dir === data.dir || setDir.isPending}
                onClick={() => setDir.mutate(dir || null, { onSuccess: () => setDirText(null) })}
              >
                바꾸기
              </Button>
            </div>
          ) : (
            <p className="font-mono text-xs">{data.dir}</p>
          )}
          <p className="mt-1 text-[11px] text-subtle">
            OneDrive·Google Drive 폴더로 바꾸면 PC가 고장 나도 남아요. 파일은 암호화돼 있어서 클라우드에 올라가도 내용을 볼 수 없어요.
          </p>
          {setDir.error && <p className="mt-1 text-xs text-bad">{setDir.error.message}</p>}
        </div>

        <div>
          <div className="mb-1.5 text-xs font-semibold text-muted">복구 키</div>
          <p className="text-xs text-muted">
            키 파일: <code className="rounded bg-surface-2 px-1">{data.key_file}</code>. 키가 없으면 백업을 열 수 없어요. 비밀번호 관리자 등 PC 밖에 따로 적어 두세요.
          </p>
          {local ? (
            reveal.data ? (
              <div className="mt-2">
                <Copyable text={reveal.data.key} />
              </div>
            ) : (
              <Button size="sm" variant="ghost" className="mt-1" onClick={() => reveal.mutate()}>
                <Eye /> 복구 키 보기
              </Button>
            )
          ) : (
            <p className="mt-1 text-xs text-subtle">복구 키는 PC에서만 볼 수 있어요.</p>
          )}
        </div>

        <div>
          <div className="mb-1.5 text-xs font-semibold text-muted">복원하는 법</div>
          <p className="text-xs text-muted">MoneyLab을 끄고 backend 폴더에서 아래 명령을 실행하세요. 지금 데이터는 .before-restore로 남겨 둬요.</p>
          <div className="mt-1.5">
            <Copyable text="uv run python -m app.tools.restore <백업 파일 경로>" />
          </div>
        </div>

        {data.files.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs text-muted">백업 파일 {data.files.length}개</summary>
            <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-subtle">
              {data.files.map((f) => (
                <li key={f.name} className="flex justify-between gap-2">
                  <span className="truncate">{f.name}</span>
                  <span>{Math.round(f.bytes / 1024)} KB</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardBody>
    </Card>
  )
}

export function AutostartCard() {
  const { data } = useService()
  const { data: auth } = useAuthStatus()
  const setAuto = useSetAutostart()
  const icons = useMakeShortcuts()
  const restart = useRestartService()
  if (!data) return <div className="shimmer h-64 rounded-card" />
  const local = !!auth?.local
  const running = !!data.service

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-1.5 text-text"><Power className="size-4 text-accent" /> PC 앱 · 자동 실행</span>}
        hint="휴대폰에서 보려면 PC에서 MoneyLab이 항상 돌고 있어야 해요. 창 없이 백그라운드로 돌고, 고친 코드는 저절로 반영돼요."
      />
      <CardBody className="space-y-3 text-[13px]">
        <Row ok={running} label="백그라운드 서비스" value={running ? '실행 중' : data.supervised ? '확인 중' : '꺼져 있음 (창으로 실행 중)'} />
        <Row ok={data.autostart} label="PC 켜면 자동 실행" value={data.autostart ? '켜짐' : '꺼짐'}>
          {local && data.windows && (
            <Button size="sm" variant={data.autostart ? 'ghost' : 'primary'} disabled={setAuto.isPending} onClick={() => setAuto.mutate(!data.autostart)}>
              {setAuto.isPending ? <Loader2 className="animate-spin" /> : null}
              {data.autostart ? '끄기' : '켜기'}
            </Button>
          )}
        </Row>
        <Row ok={data.shortcuts} label="시작 메뉴 · 바탕화면 아이콘" value={data.shortcuts ? '있음' : '없음'}>
          {local && data.windows && !data.shortcuts && (
            <Button size="sm" disabled={icons.isPending} onClick={() => icons.mutate()}>
              만들기
            </Button>
          )}
        </Row>
        {data.build && <p className="text-[11px] text-subtle">웹 화면 빌드: {new Date(data.build.build).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
        {(setAuto.error || icons.error) && <p className="text-xs text-bad">{(setAuto.error || icons.error)?.message}</p>}
        {local && running && (
          <Button size="sm" variant="ghost" disabled={restart.isPending || restart.isSuccess} onClick={() => restart.mutate()}>
            {restart.isSuccess ? '다시 시작하는 중… 몇 초 뒤 새로고침하세요' : '서버 다시 시작'}
          </Button>
        )}
        {!local && <p className="text-xs text-subtle">이 설정은 PC에서만 바꿀 수 있어요.</p>}
        <p className="text-xs text-muted">
          Windows 설정 → 시스템 → 전원 → <b className="text-text">전원 연결 시 절전 모드: 안 함</b>으로 두세요. PC가 잠들면 휴대폰에서 연결이 끊겨요. 로그는{' '}
          <code className="rounded bg-surface-2 px-1">data\logs</code>에 남아요.
        </p>
      </CardBody>
    </Card>
  )
}

function Row({ ok, label, value, children }: { ok: boolean; label: string; value: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface-2/60 px-3 py-2">
      <span className={cn('size-2 shrink-0 rounded-full', ok ? 'bg-good' : 'bg-warn')} />
      <span className="flex-1 text-muted">{label}</span>
      <span className={cn('text-xs font-semibold', ok ? 'text-good' : 'text-warn')}>{value}</span>
      {children}
    </div>
  )
}

/** Where the ledger starts: earlier rows are deleted and later imports skip them. */
export function LedgerCard() {
  const { data } = useLedger()
  const set = useSetLedger()
  const [value, setValue] = useState<string | null>(null)
  if (!data) return <div className="shimmer h-40 rounded-card" />
  const current = data.start ?? ''
  const draft = value ?? current
  const save = () => {
    if (draft && draft !== current && !confirm(`${draft} 이전 거래를 모두 지울까요? 이후 가져오기에서도 다시 들어오지 않아요.`)) return
    set.mutate(draft || null, { onSuccess: () => setValue(null) })
  }

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-1.5 text-text"><CalendarRange className="size-4 text-accent" /> 데이터 기간</span>}
        hint="이 날짜 이전 거래는 지우고, 엑셀을 다시 가져와도 건너뛰어요. 띄엄띄엄한 초기 기록을 정리할 때 써요."
      />
      <CardBody className="flex flex-wrap items-center gap-2">
        <Input type="date" className="h-9 w-44" value={draft} onChange={(e) => setValue(e.target.value)} />
        <span className="text-sm text-muted">부터 기록</span>
        {draft !== current && (
          <Button size="sm" variant="primary" onClick={save} disabled={set.isPending}>
            {set.isPending && <Loader2 className="animate-spin" />}
            저장
          </Button>
        )}
        {set.data && <span className="w-full text-xs text-good">이전 거래 {set.data.removed}건을 정리했어요.</span>}
        {set.error && <span className="w-full text-xs text-bad">{set.error.message}</span>}
      </CardBody>
    </Card>
  )
}
