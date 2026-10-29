import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Share2, Upload } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ACCOUNT_KIND_LABEL, type ImportResult, useImports, useUpload } from '@/api/money'
import { ApiError } from '@/api/client'
import { FileMapper } from './import/FileMapper'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'

const SHARE_CACHE = 'moneylab-share'

/** Files the Android share sheet handed to the service worker (see public/sw.js). */
async function takeSharedFiles(): Promise<File[]> {
  if (!('caches' in window)) return []
  const cache = await caches.open(SHARE_CACHE)
  const files: File[] = []
  for (const req of await cache.keys()) {
    const res = await cache.match(req)
    if (res) {
      const name = decodeURIComponent(res.headers.get('x-filename') ?? 'shared.xlsx')
      files.push(new File([await res.blob()], name, { type: res.headers.get('content-type') ?? '' }))
    }
    await cache.delete(req)
  }
  return files
}

export function ImportPage() {
  const upload = useUpload()
  const { data: history } = useImports()
  const [params, setParams] = useSearchParams()
  const [drag, setDrag] = useState(false)
  const [results, setResults] = useState<ImportResult[] | null>(null)
  const [mapperFile, setMapperFile] = useState<File | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const otherInput = useRef<HTMLInputElement>(null)

  const send = (files: File[]) => {
    const ok = files.filter((f) => /\.(xlsx?|csv)$/i.test(f.name) || f.type.includes('spreadsheet') || f.type.includes('csv'))
    if (!ok.length) {
      setResults([{ filename: files[0]?.name ?? '파일', error: '엑셀(.xlsx/.xls) 또는 CSV 파일만 올릴 수 있어요.' }])
      return
    }
    setResults(null)
    // Banksalad exports are always .xlsx; anything else goes straight to the column-mapping importer.
    const other = ok.find((f) => !/\.xlsx$/i.test(f.name))
    if (other) {
      setMapperFile(other)
      return
    }
    upload.mutate(ok, {
      onSuccess: (r) => setResults(r.results),
      onError: (e) => {
        if (e instanceof ApiError && e.code === 'not_banksalad' && ok.length === 1) setMapperFile(ok[0])
        else setResults([{ filename: ok.map((f) => f.name).join(', '), error: e.message }])
      },
    })
  }

  useEffect(() => {
    if (params.get('shared') !== '1') return
    setParams({}, { replace: true })
    takeSharedFiles().then((files) => {
      if (files.length) send(files)
      else setResults([{ filename: '공유된 파일', error: '공유받은 파일을 찾지 못했어요. 다시 공유해 주세요.' }])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    send([...e.dataTransfer.files])
  }

  return (
    <>
      <PageHeader title="가져오기" subtitle="뱅크샐러드 엑셀은 그대로, 카드사·은행 엑셀은 열만 확인하면 돼요. 기간이 겹쳐도 중복으로 들어가지 않아요." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {mapperFile && <FileMapper key={mapperFile.name + mapperFile.size} file={mapperFile} onClose={() => setMapperFile(null)} />}
          <Card>
            <CardBody className="pt-5">
              <button
                type="button"
                onClick={() => input.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDrag(true)
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={onDrop}
                disabled={upload.isPending}
                className={cn(
                  'flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors',
                  drag ? 'border-accent bg-accent-soft' : 'border-border-strong hover:border-accent/60 hover:bg-surface-2/50',
                )}
              >
                {upload.isPending ? <Loader2 className="size-8 animate-spin text-accent" /> : <FileSpreadsheet className="size-8 text-accent" />}
                <span className="text-sm font-semibold">{upload.isPending ? '가져오는 중…' : '엑셀 파일을 끌어다 놓거나 눌러서 고르기'}</span>
                <span className="text-xs text-subtle">여러 개를 한 번에 올려도 돼요 · 뱅크샐러드 .xlsx / 카드사·은행 .xlsx .xls .csv</span>
              </button>
              <input
                ref={input}
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                multiple
                hidden
                onChange={(e) => {
                  send([...(e.target.files ?? [])])
                  e.target.value = ''
                }}
              />
              <input
                ref={otherInput}
                type="file"
                accept=".xlsx,.xls,.csv,.htm,.html"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) setMapperFile(f)
                  e.target.value = ''
                }}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span>2024년 12월 이전처럼 뱅크샐러드에 없는 기간은 카드사·은행 사이트의 엑셀로 채울 수 있어요.</span>
                <Button size="sm" variant="ghost" onClick={() => otherInput.current?.click()}>
                  카드사 · 은행 엑셀 고르기
                </Button>
              </div>
            </CardBody>
          </Card>

          {results && (
            <Card>
              <CardHeader title="결과" />
              <CardBody className="space-y-3">
                {results.map((r, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm">
                    {r.error ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{r.filename}</div>
                      {r.error ? (
                        <p className="text-bad">{r.error}</p>
                      ) : (
                        <p className="text-muted">
                          {fmtDate(r.period_start)} ~ {fmtDate(r.period_end)} · 새 거래 <b className="num text-text">{r.rows_new}건</b>
                          {r.rows_existing ? ` · 이미 있던 거래 ${r.rows_existing}건` : ''}
                          {r.rows_skipped ? ` · 0원 ${r.rows_skipped}건 건너뜀` : ''}
                          {r.already_imported && ' · 전에 올린 파일이에요'}
                        </p>
                      )}
                      {r.new_accounts && r.new_accounts.length > 0 && (
                        <p className="mt-1 text-xs text-subtle">
                          새 계좌: {r.new_accounts.map((a) => `${a.name} (${ACCOUNT_KIND_LABEL[a.kind]})`).join(', ')} —{' '}
                          <Link to="/settings" className="text-accent">
                            종류 확인
                          </Link>
                        </p>
                      )}
                    </div>
                  </div>
                ))}
                {results.some((r) => !r.error) && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link to="/review">
                      <Button size="sm" variant="primary">
                        확인할 거래 보기
                      </Button>
                    </Link>
                    <Link to="/">
                      <Button size="sm">홈으로</Button>
                    </Link>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="가져온 기록" />
            <CardBody className="px-0 pb-2">
              {!history?.length && <p className="px-5 py-4 text-sm text-subtle">아직 없어요</p>}
              <ul className="divide-y">
                {history?.map((b) => (
                  <li key={b.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <Upload className="size-4 shrink-0 text-subtle" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{b.filename}</div>
                      <div className="text-xs text-subtle">
                        {fmtDate(b.imported_at)} 가져옴 · {fmtDate(b.period_start)} ~ {fmtDate(b.period_end)}
                      </div>
                    </div>
                    <span className="num shrink-0 text-xs text-muted">+{b.rows_new}건</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="한 달에 한 번, 이렇게" />
            <CardBody>
              <ol className="list-decimal space-y-2 pl-4 text-[13px] leading-relaxed text-muted marker:text-subtle">
                <li>뱅크샐러드 앱에서 가계부 엑셀을 내보내요. 기간은 지난번 이후를 포함하면 돼요. 넉넉하게 겹쳐도 괜찮아요.</li>
                <li>
                  휴대폰에서 받은 파일을 <b className="text-text">공유 → MoneyLab</b>으로 보내면 바로 이 화면에서 가져와요.
                  <span className="mt-1 flex items-center gap-1 text-xs text-subtle">
                    <Share2 className="size-3" /> MoneyLab을 홈 화면에 앱으로 설치해야 공유 목록에 나와요 (Android).
                  </span>
                </li>
                <li>PC라면 파일을 여기로 끌어다 놓으세요.</li>
                <li>
                  <Link to="/review" className="font-medium text-accent">
                    확인하기
                  </Link>
                  에 모인 몇 건만 분류하면 끝이에요.
                </li>
              </ol>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="가져올 때 자동으로 하는 일" />
            <CardBody className="space-y-1.5 text-[13px] leading-relaxed text-muted">
              <p>· 통장에서 나간 카드대금은 지출에서 빼요 (카드 사용 내역과 겹치니까요).</p>
              <p>· 간편결제와 카드에 같이 찍힌 결제는 한 번만 세요.</p>
              <p>· 청년도약계좌 같은 적금 입금은 저축으로 따로 모아요.</p>
              <p>· 규칙에 맞는 가맹점은 러닝·카메라·여행 등으로 분류해요.</p>
              <p>· 손으로 고친 분류는 다시 가져와도 그대로 둬요.</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
