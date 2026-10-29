import { useRef, useState, type DragEvent } from 'react'
import { FileUp, Loader2, UploadCloud } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { useImportFiles, useSyncStatus } from '@/api/garmin'
import { cn } from '@/lib/utils'

const ACCEPT = ['.fit', '.zip']

export function ImportCard() {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const upload = useImportFiles()
  const { data: sync } = useSyncStatus()
  const busy = upload.isPending || !!sync?.running

  const send = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => ACCEPT.some((ext) => f.name.toLowerCase().endsWith(ext)))
    if (files.length && !busy) upload.mutate(files)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    send(e.dataTransfer.files)
  }

  return (
    <Card>
      <CardHeader
        title="파일 가져오기"
        hint="자동 연결이 안 되거나 과거 기록을 한 번에 넣고 싶을 때"
        action={
          <div className="grid size-8 place-items-center rounded-lg bg-surface-2 text-z3">
            <FileUp className="size-4" />
          </div>
        }
      />
      <CardBody>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-9 text-center transition-all',
            dragging ? 'scale-[1.01] border-accent bg-accent-soft' : 'border-border-strong hover:border-accent/60 hover:bg-surface-2/60',
            busy && 'cursor-not-allowed opacity-60',
          )}
        >
          {upload.isPending ? (
            <Loader2 className="size-8 animate-spin text-accent" />
          ) : (
            <UploadCloud className={cn('size-8 transition-colors', dragging ? 'text-accent' : 'text-subtle')} strokeWidth={1.6} />
          )}
          <div className="mt-3 text-sm font-medium">
            {upload.isPending ? '업로드 중…' : '.fit 또는 .zip 파일을 끌어다 놓으세요'}
          </div>
          <div className="mt-1 text-xs text-subtle">
            개별 활동 FIT · 가민 "데이터 내보내기" 전체 ZIP 모두 지원 · 중복은 자동으로 건너뜀
          </div>
        </button>
        <input ref={inputRef} type="file" multiple accept={ACCEPT.join(',')} className="hidden" onChange={(e) => send(e.target.files)} />
        {upload.error && <p className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad">{upload.error.message}</p>}
      </CardBody>
    </Card>
  )
}
