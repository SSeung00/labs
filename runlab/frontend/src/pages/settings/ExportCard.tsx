import { Download, FileSpreadsheet } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'

const FILES = [
  { href: '/api/export/activities.csv', label: '활동 전체', desc: '거리·시간·심박·부하·EF·VDOT·RPE·메모' },
  { href: '/api/export/daily.csv', label: '일별 기록', desc: '가민 웰니스 + 일지 체크인' },
]

export function ExportCard() {
  return (
    <Card>
      <CardHeader
        title="데이터 내보내기"
        hint="엑셀·구글 시트에서 바로 열리는 CSV"
        action={
          <div className="grid size-8 place-items-center rounded-lg bg-surface-2 text-good">
            <FileSpreadsheet className="size-4" />
          </div>
        }
      />
      <CardBody className="grid gap-2 sm:grid-cols-2">
        {FILES.map((f) => (
          <a key={f.href} href={f.href} download className="group flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors hover:border-border-strong hover:bg-surface-2">
            <Download className="size-4 text-subtle group-hover:text-accent" />
            <div className="min-w-0">
              <div className="text-sm font-medium">{f.label}</div>
              <div className="truncate text-[11px] text-subtle">{f.desc}</div>
            </div>
          </a>
        ))}
      </CardBody>
    </Card>
  )
}
