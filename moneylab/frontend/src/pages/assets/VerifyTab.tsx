import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, ScanSearch, Trash2 } from 'lucide-react'
import { useRef } from 'react'
import type { EChartsOption } from 'echarts'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Select } from '@/components/ui/controls'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EChart } from '@/components/charts/EChart'
import { baseAxis, baseTooltip, useChartTheme } from '@/components/charts/theme'
import { useAccounts } from '@/api/money'
import { type CheckReport, type StatementResult, useAddCheck, useCheckReport, useCheckStatement, useDeleteCheck } from '@/api/tools'
import { fmtDate, parseWon, won, wonShort } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CardStatementCheck } from './CardStatementCheck'

/** Compare the ledger with balances from real bank statements to find missing transactions. */
export function VerifyTab() {
  const { data: accounts } = useAccounts()
  const candidates = (accounts ?? []).filter((a) => ['bank', 'savings', 'pay', 'invest', 'cash'].includes(a.kind))
  const [accountId, setAccountId] = useState<number | null>(null)
  useEffect(() => {
    if (accountId == null && candidates.length) setAccountId([...candidates].sort((a, b) => b.txn_count - a.txn_count)[0].id)
  }, [candidates, accountId])
  const { data } = useCheckReport(accountId)

  return (
    <Stagger className="grid grid-cols-1 gap-4">
      <StaggerItem>
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-1.5 text-text"><ScanSearch className="size-4 text-accent" /> 잔액으로 빠진 거래 찾기</span>}
            hint="은행 앱의 거래내역에는 거래마다 '잔액'이 나와요. 그 숫자를 몇 개 넣으면, 기록이 빠진 기간과 금액을 찾아드려요."
          />
          <CardBody className="space-y-4">
            <div className="max-w-sm">
              <Label>계좌</Label>
              <Select value={accountId ?? ''} onChange={(e) => setAccountId(Number(e.target.value))}>
                {candidates.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label || a.name} ({a.txn_count}건)
                  </option>
                ))}
              </Select>
            </div>
            {data && <Summary data={data} />}
            {accountId != null && <StatementUpload accountId={accountId} />}
          </CardBody>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <CardStatementCheck />
      </StaggerItem>

      {data?.anchor && (
        <>
          <StaggerItem className="grid grid-cols-1 gap-4 split:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader title="기록으로 계산한 월말 잔액" hint="점은 직접 넣은 실제 잔액이에요" />
              <CardBody>
                <BalanceChart data={data} />
              </CardBody>
            </Card>
            <AddCheck accountId={data.account.id} />
          </StaggerItem>

          {data.checks.length > 0 && (
            <StaggerItem>
              <Card>
                <CardHeader title="넣은 잔액과 구간별 결과" />
                <CardBody className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[460px] text-sm">
                      <thead className="text-left text-xs text-muted">
                        <tr>
                          <th className="py-1.5 font-medium">날짜</th>
                          <th className="py-1.5 text-right font-medium">실제 잔액</th>
                          <th className="py-1.5 text-right font-medium">기록상 잔액</th>
                          <th className="py-1.5 text-right font-medium">차이</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody className="num divide-y">
                        {data.checks.map((c) => (
                          <CheckRow key={c.id} c={c} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="space-y-1.5">
                    {data.intervals.map((iv, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-[13px]', iv.ok ? 'bg-good/10' : 'bg-warn/10')}
                      >
                        {iv.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />}
                        <span>
                          <b className="num">{fmtDate(iv.from)} ~ {fmtDate(iv.to)}</b>:{' '}
                          {iv.ok
                            ? '기록과 잔액이 맞아요'
                            : iv.unrecorded < 0
                              ? `기록에 없는 출금이 ${won(-iv.unrecorded)} 있어요 (또는 입금이 두 번 잡혔어요)`
                              : `기록에 없는 입금이 ${won(iv.unrecorded)} 있어요 (또는 출금이 두 번 잡혔어요)`}
                        </span>
                      </motion.div>
                    ))}
                  </div>
                  <p className="text-xs text-subtle">구간을 좁히려면 차이가 바뀌는 두 날짜 사이의 잔액을 하나 더 넣어 보세요. 찾은 거래는 가져오기 → 카드사·은행 엑셀이나 직접 입력으로 채우면 돼요.</p>
                </CardBody>
              </Card>
            </StaggerItem>
          )}
        </>
      )}
    </Stagger>
  )
}

function Summary({ data }: { data: CheckReport }) {
  if (!data.anchor) {
    return <p className="text-sm text-subtle">기준이 될 잔액이 없어요. 오른쪽에 아무 날짜의 실제 잔액을 하나 넣으면 시작할 수 있어요.</p>
  }
  return (
    <div className="space-y-2 text-[13px]">
      <p className="text-muted">
        기준: <b className="num text-text">{fmtDate(data.anchor.date)}</b> 잔액 <b className="num text-text">{won(data.anchor.amount)}</b> (
        {data.anchor.source === 'banksalad' ? '뱅크샐러드 재무현황' : '직접 넣은 잔액'}). 기록은 {fmtDate(data.first_date)}부터 있어요.
      </p>
      {data.negative ? (
        <div className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
          <span>
            기록대로 거꾸로 계산하면 <b className="num">{fmtDate(data.negative.date)}</b> 잔액이 <b className="num text-bad">{won(data.negative.implied)}</b>가 돼요. 잔액은
            마이너스일 수 없으니, 그 뒤 어딘가에 <b>최소 {won(-data.negative.implied)}</b> 이상 기록되지 않은 출금이 있어요 (아니면 입금이 중복됐어요). 실제 잔액을 넣어서 기간을 좁혀 보세요.
          </span>
        </div>
      ) : (
        data.opening_implied != null && (
          <p className="text-muted">
            기록 시작 전날 잔액은 <b className="num text-text">{won(data.opening_implied)}</b>로 계산돼요. 은행 앱의 그날 잔액과 같다면 그 사이 기록이 온전해요.
          </p>
        )
      )}
    </div>
  )
}

function CheckRow({ c }: { c: CheckReport['checks'][number] }) {
  const del = useDeleteCheck()
  const ok = Math.abs(c.diff) < 1000
  return (
    <tr>
      <td className="py-1.5">{fmtDate(c.on_date)}{c.is_anchor && <span className="ml-1 text-[10px] text-accent">기준</span>}</td>
      <td className="py-1.5 text-right">{won(c.actual)}</td>
      <td className="py-1.5 text-right text-muted">{won(c.implied)}</td>
      <td className={cn('py-1.5 text-right font-semibold', ok ? 'text-good' : 'text-warn')}>{ok ? '일치' : `${c.diff > 0 ? '+' : ''}${wonShort(c.diff)}`}</td>
      <td className="py-1.5 text-right">
        <Button size="icon" variant="ghost" className="size-7" onClick={() => del.mutate(c.id)} aria-label="삭제">
          <Trash2 />
        </Button>
      </td>
    </tr>
  )
}

function AddCheck({ accountId }: { accountId: number }) {
  const add = useAddCheck()
  const [day, setDay] = useState('')
  const [amount, setAmount] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = parseWon(amount)
    if (n == null || !day) return
    add.mutate({ account_id: accountId, on_date: day, amount: n }, { onSuccess: () => { setDay(''); setAmount('') } })
  }
  return (
    <Card>
      <CardHeader title="실제 잔액 넣기" hint="그날 마지막 거래 뒤의 잔액을 넣어 주세요" />
      <CardBody>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="chk-date">날짜</Label>
            <Input id="chk-date" type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="chk-amt">은행 앱에 나온 잔액</Label>
            <Input id="chk-amt" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="예: 1,234,567" required />
          </div>
          {add.error && <p className="text-sm text-bad">{add.error.message}</p>}
          <Button type="submit" variant="primary" disabled={add.isPending} className="w-full">
            {add.isPending && <Loader2 className="animate-spin" />}비교하기
          </Button>
          <p className="text-[11px] leading-relaxed text-subtle">추천: 기록 시작 직전(2024년 12월 말), 6개월마다 한 번, 최근 날짜. 넣은 숫자는 이 PC에만 저장돼요.</p>
        </form>
      </CardBody>
    </Card>
  )
}

function BalanceChart({ data }: { data: CheckReport }) {
  const t = useChartTheme()
  const option = useMemo<EChartsOption>(() => {
    const x = data.monthly.map((m) => m.date.slice(2, 7).replace('-', '.'))
    return {
      grid: { left: 4, right: 8, top: 12, bottom: 4, containLabel: true },
      tooltip: { ...baseTooltip(t), trigger: 'axis', valueFormatter: (v) => won(Number(v)) },
      xAxis: { type: 'category', data: x, ...baseAxis(t), splitLine: { show: false } },
      yAxis: { type: 'value', ...baseAxis(t), axisLabel: { ...baseAxis(t).axisLabel, formatter: (v: number) => wonShort(v) } },
      series: [
        {
          name: '기록상 잔액', type: 'line', step: 'end', data: data.monthly.map((m) => m.implied), symbol: 'none',
          lineStyle: { color: t.accent, width: 2 }, areaStyle: { color: t.accent, opacity: 0.08 },
          markLine: { silent: true, symbol: 'none', data: [{ yAxis: 0 }], lineStyle: { color: t.bad, type: 'dashed' }, label: { show: false } },
        },
        {
          name: '실제 잔액', type: 'scatter', symbolSize: 11, itemStyle: { color: t.warn, borderColor: t.surface, borderWidth: 2 },
          data: data.checks.map((c) => [c.on_date.slice(2, 7).replace('-', '.'), c.actual]),
        },
      ],
    }
  }, [data, t])
  return <EChart option={option} style={{ height: 240 }} />
}

/** Upload the bank's own 거래내역 엑셀: every row is matched against MoneyLab. */
function StatementUpload({ accountId }: { accountId: number }) {
  const check = useCheckStatement()
  const input = useRef<HTMLInputElement>(null)
  const r = check.data
  return (
    <div className="rounded-xl border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => input.current?.click()} disabled={check.isPending}>
          {check.isPending ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} 통장 거래내역 엑셀로 한 번에 검증
        </Button>
        <span className="text-xs text-subtle">은행 사이트·앱에서 받은 거래내역 파일(.xls/.xlsx). 잔액 열이 있으면 월말 잔액도 자동으로 넣어요.</span>
        <input
          ref={input}
          type="file"
          accept=".xls,.xlsx,.csv,.htm,.html"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) check.mutate({ file: f, account_id: accountId })
            e.target.value = ''
          }}
        />
      </div>
      {check.error && <p className="mt-2 text-sm text-bad">{check.error.message}</p>}
      {r && <StatementResultView r={r} />}
    </div>
  )
}

function StatementResultView({ r }: { r: StatementResult }) {
  const allGood = r.missing.length === 0 && r.extra.length === 0
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 space-y-3 text-[13px]">
      <div className={cn('flex items-start gap-2 rounded-lg px-3 py-2.5', allGood ? 'bg-good/10' : 'bg-warn/10')}>
        {allGood ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />}
        <div>
          <b>
            {allGood
              ? '빠진 거래가 없어요.'
              : `통장에는 있는데 MoneyLab에 없는 거래 ${r.missing.length}건, MoneyLab에만 있는 거래 ${r.extra.length}건이 있어요.`}
          </b>
          <div className="text-muted">
            비교 {r.compared}건 ({r.ledger.first} 이후) · 같은 계좌에서 일치 {r.matched}건 · 체크카드·간편결제 쪽에 기록된 {r.via_other.length}건({won(-r.via_other_total)})은
            이 통장에서 나간 걸로 연결했어요.
          </div>
        </div>
      </div>
      {r.missing.length > 0 && (
        <List title={`MoneyLab에 없는 거래 (합계 ${won(r.missing_total)})`} rows={r.missing.map((m) => ({ ...m, extra: m.memo ?? '' }))} />
      )}
      {r.extra.length > 0 && <List title="통장에는 없는데 MoneyLab에만 있는 거래" rows={r.extra.map((m) => ({ ...m, extra: '' }))} />}
      {r.via_other.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-muted">다른 결제수단에 기록된 {r.via_other.length}건 보기</summary>
          <List rows={r.via_other.map((m) => ({ ...m, extra: `→ ${m.booked_on}` }))} />
        </details>
      )}
      {r.before.rows > 0 && (
        <p className="text-xs text-muted">
          뱅크샐러드 기록 이전({r.before.first} ~ {r.before.last}) 거래가 {r.before.rows}건 있어요. 가져오기 → 카드사·은행 엑셀에 같은 파일을 올리면 그 기간을 채울 수 있어요
          (기준일 이전만 들어가서 겹치지 않아요).
        </p>
      )}
    </motion.div>
  )
}

function List({ title, rows }: { title?: string; rows: { date: string; merchant: string; amount: number; extra: string }[] }) {
  return (
    <div>
      {title && <div className="mb-1 text-xs font-semibold text-muted">{title}</div>}
      <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border text-xs">
        {rows.map((m, i) => (
          <li key={i} className="flex items-center gap-2 px-3 py-1.5">
            <span className="num w-28 shrink-0 text-subtle">{m.date.slice(0, 10)}</span>
            <span className="min-w-0 flex-1 truncate">{m.merchant}</span>
            <span className="truncate text-subtle">{m.extra}</span>
            <span className="num shrink-0 font-semibold">{won(m.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
