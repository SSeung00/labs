import { CloudOff, RotateCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useNet } from '@/stores/net'
import { flush, useOutbox } from '@/lib/outbox'

export function OfflineBanner() {
  const stale = useNet((s) => s.stale)
  const pending = useOutbox((s) => s.ops.length)
  const offline = useOutbox((s) => s.offline)
  const qc = useQueryClient()
  if (!stale && !(pending && offline)) return null
  return (
    <div className="flex items-center gap-2 border-b bg-warn/15 px-4 py-2 text-xs text-warn sm:px-6">
      <CloudOff className="size-4 shrink-0" />
      <span className="flex-1">
        PC에 연결할 수 없어요.
        {pending > 0 ? ` 체크 ${pending}건은 폰에 저장해 두었다가 연결되면 보낼게요.` : ' 마지막으로 받은 데이터를 보여주고 있어요.'}
      </span>
      <button
        onClick={() => {
          void flush()
          qc.invalidateQueries()
        }}
        className="flex items-center gap-1 font-semibold"
      >
        <RotateCw className="size-3.5" /> 다시 시도
      </button>
    </div>
  )
}
