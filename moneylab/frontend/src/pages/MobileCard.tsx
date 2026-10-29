import { useState, type FormEvent, type ReactNode } from 'react'
import { Check, Copy, ExternalLink, Loader2, Lock, RotateCw, Smartphone } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStatus, useLock, useRemoteStatus, useSetPin } from '@/api/auth'
import { cn } from '@/lib/utils'

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: ReactNode }) {
  return (
    <li className="group relative flex gap-3 pb-5 last:pb-0">
      <span className="absolute bottom-0 left-[13px] top-8 w-px bg-border group-last:hidden" aria-hidden />
      <span
        className={cn(
          'num z-10 grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold',
          done ? 'bg-good text-white' : 'border-2 border-border-strong bg-surface text-muted',
        )}
      >
        {done ? <Check className="size-4" strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-1.5 text-[13px] leading-relaxed text-muted">{children}</div>
      </div>
    </li>
  )
}

function PinForm({ pinSet }: { pinSet: boolean }) {
  const [pin, setPin] = useState('')
  const [editing, setEditing] = useState(!pinSet)
  const setPinM = useSetPin()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setPinM.mutate(pin, { onSuccess: () => { setPin(''); setEditing(false) } })
  }
  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-good">PIN이 설정돼 있어요.</span>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>변경</Button>
        <Button size="sm" variant="ghost" onClick={() => setPinM.mutate(null)} title="휴대폰 접속이 다시 막혀요">해제</Button>
      </div>
    )
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <p>휴대폰에서 처음 열 때 한 번 입력해요. PIN을 바꾸면 모든 휴대폰이 다시 잠겨요.</p>
      <div className="flex gap-2">
        <Input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          inputMode="numeric"
          autoComplete="new-password"
          type="password"
          placeholder="숫자 4~8자리 (6자리 권장)"
          className="num max-w-[220px] tracking-widest"
          aria-label="새 PIN"
        />
        <Button type="submit" variant="primary" disabled={pin.length < 4 || setPinM.isPending}>
          {setPinM.isPending ? <Loader2 className="animate-spin" /> : null}
          저장
        </Button>
        {pinSet && <Button type="button" variant="ghost" onClick={() => setEditing(false)}>취소</Button>}
      </div>
      {setPinM.error && <p className="text-bad">{setPinM.error.message}</p>}
    </form>
  )
}

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-surface-2/70 py-1 pl-3 pr-1 font-mono text-[12.5px] text-text">
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          navigator.clipboard?.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
        aria-label="복사"
      >
        {copied ? <Check className="text-good" /> : <Copy />}
      </Button>
    </div>
  )
}

export function MobileCard() {
  const { data: auth } = useAuthStatus()
  const { data: st, refetch, isFetching } = useRemoteStatus()
  const lock = useLock()

  if (auth && !auth.local) {
    return (
      <Card>
        <CardHeader title="휴대폰에서 보기" hint="이 기기는 Tailscale로 PC에 접속 중이에요" />
        <CardBody className="space-y-3 text-[13px] text-muted">
          <p>PIN 변경과 연결 설정은 PC에서만 할 수 있어요. 휴대폰을 다른 사람과 같이 쓴다면 잠가 두세요.</p>
          <Button onClick={() => lock.mutate()} disabled={lock.isPending}>
            <Lock /> 이 기기 잠그기
          </Button>
        </CardBody>
      </Card>
    )
  }

  const connected = !!st?.installed && !!st.running
  return (
    <Card>
      <CardHeader
        title="휴대폰에서 보기"
        hint="Tailscale로 내 기기끼리만 연결돼요. 인터넷에는 공개되지 않아요."
        action={
          <Button size="icon" variant="ghost" onClick={() => refetch()} aria-label="다시 확인" title="다시 확인">
            <RotateCw className={cn(isFetching && 'animate-spin')} />
          </Button>
        }
      />
      <CardBody>
        <ol>
          <Step n={1} done={!!st?.pin_set} title="PIN 정하기">
            <PinForm pinSet={!!st?.pin_set} />
          </Step>
          <Step n={2} done={connected} title="Tailscale 설치 · 로그인 (PC와 휴대폰 모두)">
            {!st?.installed ? (
              <>
                PC와 휴대폰에 설치하고 <b className="text-text">같은 계정</b>으로 로그인하세요. 휴대폰은 앱스토어/플레이스토어에서 "Tailscale"을 찾으면 돼요.
                <a href="https://tailscale.com/download" target="_blank" rel="noreferrer" className="mt-1.5 flex items-center gap-1 font-medium text-accent">
                  tailscale.com/download <ExternalLink className="size-3" />
                </a>
              </>
            ) : !st.running ? (
              <>설치는 됐어요. 작업 표시줄의 Tailscale 아이콘에서 로그인(Connect)해 주세요.</>
            ) : (
              <>PC가 <span className="font-mono text-text">{st.dns_name}</span>(으)로 연결돼 있어요. 휴대폰도 같은 계정으로 로그인해 주세요.</>
            )}
          </Step>
          <Step n={3} done={!!st?.serving} title="MoneyLab 연결 켜기 (처음 한 번)">
            {st?.serving ? (
              <>켜져 있어요. PC를 다시 켜도 유지돼요.</>
            ) : (
              <div className="space-y-2">
                <p>PC에서 터미널(PowerShell)을 열고 아래 명령을 실행하세요. 안내 링크가 나오면 열어서 HTTPS를 허용하면 돼요.</p>
                <CopyLine text={st?.serve_cmd ?? 'tailscale serve --bg --https=8443 8001'} />
              </div>
            )}
          </Step>
          <Step n={4} done={false} title="휴대폰에서 열고 홈 화면에 추가">
            {st?.url ? (
              <div className="flex flex-wrap items-start gap-4">
                {st.qr_svg && (
                  <div
                    className="size-[132px] shrink-0 overflow-hidden rounded-xl bg-white p-1 [&_svg]:size-full"
                    dangerouslySetInnerHTML={{ __html: st.qr_svg }}
                    aria-label="주소 QR 코드"
                  />
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <CopyLine text={st.url} />
                  <p>휴대폰 카메라로 QR을 찍거나 주소를 열고 PIN을 입력하세요.</p>
                  <ul className="space-y-1">
                    <li><b className="text-text">iPhone</b> · Safari 공유 버튼 → 홈 화면에 추가</li>
                    <li><b className="text-text">Android</b> · Chrome ⋮ 메뉴 → 앱 설치 (또는 홈 화면에 추가)</li>
                  </ul>
                </div>
              </div>
            ) : (
              <>2~3단계가 끝나면 여기에 휴대폰용 주소와 QR 코드가 나와요.</>
            )}
          </Step>
        </ol>
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-muted">
          <Smartphone className="mt-0.5 size-3.5 shrink-0" />
          휴대폰으로 볼 때는 PC가 켜져 있고 MoneyLab이 실행 중이어야 해요. PC가 꺼져 있으면 마지막으로 본 화면을 보여줘요.
        </p>
      </CardBody>
    </Card>
  )
}
