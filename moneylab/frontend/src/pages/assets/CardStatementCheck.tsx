import { useRef, useState } from 'react'
import { CheckCircle2, CreditCard, FileSpreadsheet, Loader2, Wand2 } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { type CardIssuerReport, useCardStatements } from '@/api/tools'
import { fmtDate, fmtMonth, won, wonSigned } from '@/lib/format'
import { cn } from '@/lib/utils'

/** 카드사 이용대금명세서 vs the card's rows: every bill, what's missing, and a one-click fix. */
export function CardStatementCheck() {
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const run = useCardStatements()
  const report = run.data?.report

  const send = (apply: boolean, list = files) => list.length && run.mutate({ files: list, apply })

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-1.5 text-text"><CreditCard className="size-4 text-accent" /> 카드 명세서 대조</span>}
        hint="카드사 앱·홈페이지에서 받은 이용대금명세서(삼성 .xlsx, 현대 .xls)를 여러 달 한꺼번에 올리면, 줄마다 MoneyLab 거래와 맞춰 보고 청구액이 통장에서 나간 돈과 같은지 확인해요."
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            multiple
            accept=".xls,.xlsx"
            className="hidden"
            onChange={(e) => {
              const list = [...(e.target.files ?? [])]
              setFiles(list)
              send(false, list)
              e.target.value = ''
            }}
          />
          <Button onClick={() => input.current?.click()} disabled={run.isPending}>
            {run.isPending ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} 명세서 올리기
          </Button>
          {files.length > 0 && <span className="text-xs text-subtle">{files.length}개 파일</span>}
          {run.error && <span className="text-xs text-bad">{run.error.message}</span>}
        </div>

        {run.data && run.data.added.length > 0 && (
          <p className="rounded-lg bg-good/10 px-3 py-2 text-[13px] text-good">
            명세서에만 있던 {run.data.added.length}건을 넣었어요 (합계 {won(-run.data.added.reduce((s, a) => s + a.amount, 0))}). 거래내역에서 '명세서'로 찾을 수 있어요.
          </p>
        )}

        {report?.issuers.map((iss) => <IssuerView key={iss.issuer} iss={iss} onFix={() => send(true)} busy={run.isPending} />)}
      </CardBody>
    </Card>
  )
}

function IssuerView({ iss, onFix, busy }: { iss: CardIssuerReport; onFix: () => void; busy: boolean }) {
  const missing = iss.bills.flatMap((b) => b.missing.filter((m) => m.amount > 0).map((m) => ({ ...m, month: b.month })))
  const fx = iss.bills.reduce((s, b) => s + b.fx_total, 0)
  const fixable = missing.length > 0 || fx !== 0
  if (!iss.cards.length) {
    return <p className="text-sm text-warn">{iss.issuer}카드 명세서인데, 카드사가 '{iss.issuer}'로 정해진 카드가 없어요. 설정 → 계좌·카드에서 카드사를 골라 주세요.</p>
  }
  return (
    <section className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-semibold">
          {iss.issuer}카드 <span className="text-xs font-normal text-subtle">{iss.cards.join(', ')} · {fmtDate(iss.first)} ~ {fmtDate(iss.last)} 이용분</span>
        </h4>
        {fixable && (
          <Button size="sm" variant="primary" onClick={onFix} disabled={busy}>
            <Wand2 /> 명세서 기준으로 맞추기
          </Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b">
              <th className="py-1.5 text-left font-medium">명세서</th>
              <th className="py-1.5 text-right font-medium">청구액</th>
              <th className="py-1.5 text-right font-medium">통장 출금</th>
              <th className="py-1.5 text-right font-medium">맞음</th>
              <th className="py-1.5 text-right font-medium">해외 차액</th>
              <th className="py-1.5 text-right font-medium">빠짐</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {iss.bills.map((b) => {
              const ok = b.bank_paid === b.total
              return (
                <tr key={b.month}>
                  <td className="py-1.5">{fmtMonth(b.month)}</td>
                  <td className="num py-1.5 text-right">{won(b.total)}</td>
                  <td className={cn('num py-1.5 text-right', ok ? 'text-good' : 'text-warn')}>
                    {b.bank_payments.length ? won(b.bank_paid) : '—'} {ok && <CheckCircle2 className="inline size-3.5" />}
                  </td>
                  <td className="num py-1.5 text-right">
                    {b.matched + b.fx.length}/{b.lines}
                  </td>
                  <td className="num py-1.5 text-right text-muted">{b.fx_total ? wonSigned(b.fx_total) : ''}</td>
                  <td className={cn('num py-1.5 text-right', b.missing.length && 'font-semibold text-warn')}>{b.missing.length || ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {missing.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold text-muted">명세서에는 있는데 MoneyLab에 없는 것</div>
          <ul className="divide-y rounded-lg border text-sm">
            {missing.map((m, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-1.5">
                <span className="w-20 shrink-0 text-xs text-subtle">{fmtDate(m.date)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {m.merchant} {m.fee && <span className="text-xs text-subtle">(수수료)</span>}
                </span>
                <span className="num">{won(m.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {fx !== 0 && (
        <p className="text-xs text-muted">
          해외 결제는 뱅크샐러드 금액(승인 당시 환율)과 실제 청구액(매입 환율 + 해외 수수료)이 달라요. 합계 <b className="num text-text">{won(-fx)}</b> 더 나갔어요.
        </p>
      )}
      {iss.extra.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold text-muted">MoneyLab에만 있는 것 (다음 명세서에 나오거나, 청구되지 않은 승인)</div>
          <ul className="divide-y rounded-lg border text-sm">
            {iss.extra.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-3 py-1.5">
                <span className="w-20 shrink-0 text-xs text-subtle">{fmtDate(e.date)}</span>
                <span className="min-w-0 flex-1 truncate">{e.title || e.merchant}</span>
                <span className="num">{wonSigned(e.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {iss.released.length > 0 && (
        <p className="text-xs text-subtle">
          승인됐다가 풀린 {iss.released.length}건(가승인·보증금)은 청구되지 않았고 MoneyLab에서도 합계 0원이에요.
        </p>
      )}
    </section>
  )
}
