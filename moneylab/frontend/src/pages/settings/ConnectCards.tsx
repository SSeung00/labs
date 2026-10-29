import { useState } from 'react'
import { Link } from 'react-router'
import { Check, Copy, FileSpreadsheet, KeyRound, Radio, RotateCw, Sparkles, Trash2 } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, Textarea } from '@/components/ui/controls'
import { useRemoteStatus } from '@/api/auth'
import { useAccounts } from '@/api/money'
import {
  useAiStatus,
  useDeleteTemplate,
  useNotifyStatus,
  useRotateToken,
  useSaveNotifyMapping,
  useTemplates,
  useTestNotify,
} from '@/api/extra'
import { fmtTime, won } from '@/lib/format'
import { cn } from '@/lib/utils'

function CopyLine({ text, secret }: { text: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false)
  const [shown, setShown] = useState(!secret)
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-surface-2/70 py-1 pl-3 pr-1 font-mono text-[12px]">
      <span className="min-w-0 flex-1 truncate">{shown ? text : text.replace(/token=[^&]+/, 'token=••••••••')}</span>
      {secret && (
        <Button size="sm" variant="ghost" onClick={() => setShown((s) => !s)}>
          {shown ? '숨기기' : '보기'}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        aria-label="복사"
        onClick={() =>
          navigator.clipboard?.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }
      >
        {copied ? <Check className="text-good" /> : <Copy />}
      </Button>
    </div>
  )
}

const PAY_BRANDS = ['카카오페이', '네이버페이', '페이코']

export function NotifyCard() {
  const { data } = useNotifyStatus()
  const { data: remote } = useRemoteStatus()
  const { data: accounts } = useAccounts()
  const rotate = useRotateToken()
  const saveMap = useSaveNotifyMapping()
  const test = useTestNotify()
  const [sample, setSample] = useState('[삼성카드] 승인 이*호 12,500원 일시불 10/09 12:34 스타벅스코리아 누적 345,000원')

  if (!data) return <div className="shimmer h-96 rounded-card" />
  const base = remote?.url ?? window.location.origin
  const url = `${base}${data.path}?token=${data.token}`
  const issuers = Array.from(new Set([...(accounts ?? []).map((a) => a.issuer).filter(Boolean), ...PAY_BRANDS])) as string[]
  const statusCls = { added: 'text-good', duplicate: 'text-muted', ignored: 'text-subtle', error: 'text-bad' }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-1.5 text-text">
            <Radio className="size-4 text-accent" /> 결제 알림 실시간 연동 (Android)
          </span>
        }
        hint="카드·페이 결제 알림을 휴대폰 자동화 앱이 MoneyLab으로 보내면, 엑셀을 기다리지 않고 바로 예산에 잡혀요."
      />
      <CardBody className="space-y-5 text-[13px]">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">대기 중 실시간 거래 {data.pending}건 · {won(data.pending_amount)}</span>
          <Link to="/review?tab=live" className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted hover:text-text">
            보기 →
          </Link>
        </div>

        <ol className="list-decimal space-y-3 pl-4 marker:font-semibold marker:text-subtle">
          <li>
            Play 스토어에서 <b>MacroDroid</b>(또는 Tasker)를 설치하고 <b>알림 접근 권한</b>을 허용해요.
          </li>
          <li>
            <b>트리거</b>: 알림 수신 → 앱: 삼성카드, 현대카드, 카카오페이 등 → 내용에 "원" 포함.
          </li>
          <li>
            <b>동작</b>: HTTP 요청 · POST · 아래 주소 · 본문 형식 JSON
            <div className="mt-1.5 space-y-1.5">
              <CopyLine text={url} secret />
              <pre className="overflow-x-auto rounded-lg bg-surface-2/70 px-3 py-2 font-mono text-[11.5px] text-muted">{`{"app": "알림 앱 이름", "title": "알림 제목", "text": "알림 내용"}`}</pre>
              <p className="text-xs text-subtle">따옴표 안에는 MacroDroid의 매직 텍스트(알림 앱 이름·제목·내용)를 넣어요.</p>
            </div>
          </li>
          <li>휴대폰 Tailscale이 켜져 있고 PC에서 MoneyLab이 실행 중이어야 전송돼요. 놓친 알림은 월말 엑셀이 채워 줘요.</li>
        </ol>

        <div>
          <div className="mb-1.5 text-xs font-semibold text-muted">알림 → 계좌 연결</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {issuers.map((iss) => (
              <label key={iss} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs">{iss}</span>
                <Select
                  value={data.mapping[iss] ?? ''}
                  onChange={(e) => saveMap.mutate({ ...data.mapping, [iss]: e.target.value ? Number(e.target.value) : null })}
                  className="flex-1 [&_select]:h-8 [&_select]:text-xs"
                >
                  <option value="">자동 (카드사가 같은 카드)</option>
                  {(accounts ?? [])
                    .filter((a) => ['card', 'check_card', 'pay'].includes(a.kind))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label || a.name}
                      </option>
                    ))}
                </Select>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-semibold text-muted">알림 문구 테스트 (저장 안 함)</div>
          <Textarea rows={2} value={sample} onChange={(e) => setSample(e.target.value)} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => test.mutate({ text: sample })} disabled={!sample.trim() || test.isPending}>
              이렇게 읽혀요?
            </Button>
            {test.data &&
              (test.data.ok ? (
                <span className="text-xs">
                  <b className="num">{won(test.data.amount ?? 0)}</b> · {test.data.merchant} · {test.data.issuer ?? '카드사 모름'} →{' '}
                  <span className={test.data.account ? 'text-good' : 'text-bad'}>{test.data.account ?? '연결된 계좌 없음'}</span>
                </span>
              ) : (
                <span className="text-xs text-subtle">결제 알림으로 보이지 않아요 (무시돼요)</span>
              ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-muted">
            최근 받은 알림
            <Button size="sm" variant="ghost" onClick={() => confirm('토큰을 바꾸면 자동화 앱의 주소도 바꿔야 해요. 바꿀까요?') && rotate.mutate()}>
              <KeyRound /> 토큰 새로 만들기
            </Button>
          </div>
          {data.logs.length === 0 ? (
            <p className="text-xs text-subtle">아직 없어요</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {data.logs.slice(0, 8).map((l) => (
                <li key={l.id} className="flex items-start gap-2 px-3 py-2 text-xs">
                  <span className="num shrink-0 text-subtle">{fmtTime(l.received_at)}</span>
                  <span className={cn('shrink-0 font-semibold', statusCls[l.status])}>{{ added: '추가', duplicate: '중복', ignored: '무시', error: '실패' }[l.status]}</span>
                  <span className="min-w-0 flex-1 truncate text-muted" title={l.text}>
                    {l.detail ?? l.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

export function AiCard() {
  const { data, refetch, isFetching } = useAiStatus()
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-1.5 text-text">
            <Sparkles className="size-4 text-accent" /> AI 분류 제안
          </span>
        }
        hint="결제대행사 이름만 찍힌 거래를 Claude가 보고 카테고리를 제안해요. 적용은 직접 눌러야 돼요."
        action={
          <Button size="icon" variant="ghost" onClick={() => refetch()} aria-label="다시 확인">
            <RotateCw className={cn(isFetching && 'animate-spin')} />
          </Button>
        }
      />
      <CardBody className="space-y-3 text-[13px] text-muted">
        {data?.available ? (
          <>
            <p className="flex items-center gap-1.5 text-good">
              <Check className="size-4" /> Claude API 연결됨 · {data.model}
            </p>
            <p>제안을 기다리는 가맹점 {data.pending}곳</p>
            <Link to="/review">
              <Button size="sm">확인하기에서 실행 →</Button>
            </Link>
          </>
        ) : (
          <>
            <p>RunLab 코치와 같은 방식으로 연결돼요. 둘 중 하나를 하고 MoneyLab을 다시 실행하세요.</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>
                <code className="rounded bg-surface-2 px-1">backend/.env</code>에 <code className="rounded bg-surface-2 px-1">ANTHROPIC_API_KEY=…</code> 넣기
              </li>
              <li>
                터미널에서 <code className="rounded bg-surface-2 px-1">ant auth login</code>
              </li>
            </ul>
          </>
        )}
        <p className="rounded-lg bg-surface-2/60 px-3 py-2 text-xs">
          보내는 것: 가맹점 이름, 금액, 날짜, 결제수단 종류, 뱅크샐러드 분류. 사람 이름·잔액·계좌번호는 보내지 않아요.
        </p>
      </CardBody>
    </Card>
  )
}

export function TemplatesCard() {
  const { data } = useTemplates()
  const del = useDeleteTemplate()
  return (
    <Card>
      <CardHeader title="기억해 둔 엑셀 형식" hint="카드사·은행 엑셀을 처음 가져올 때 저장한 열 지정이에요" />
      <CardBody className="space-y-1.5">
        {!data?.length && (
          <p className="text-sm text-subtle">
            아직 없어요. <Link to="/import" className="text-accent">가져오기</Link>에서 카드사·은행 엑셀을 올려 보세요.
          </p>
        )}
        {data?.map((t) => (
          <div key={t.id} className="flex items-center gap-2 text-sm">
            <FileSpreadsheet className="size-4 text-muted" />
            <span className="flex-1 truncate">{t.name}</span>
            <Button size="icon" variant="ghost" className="size-7" onClick={() => del.mutate(t.id)} aria-label="삭제">
              <Trash2 />
            </Button>
          </div>
        ))}
      </CardBody>
    </Card>
  )
}
