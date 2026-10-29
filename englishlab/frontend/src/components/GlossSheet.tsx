import { useEffect, useState } from 'react'
import { Check, Loader2, Plus, Volume2 } from 'lucide-react'
import { gloss, useAddCard } from '@/api/el'
import type { Gloss } from '@/api/types'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { speak } from '@/lib/audio'

export interface GlossTarget {
  term: string
  sentence: string
}

/** Tap-to-translate sheet: meaning in this sentence, pronunciation, add to cards. */
export function GlossSheet({
  target,
  onClose,
  onLooked,
  source,
}: {
  target: GlossTarget | null
  onClose: () => void
  onLooked?: (term: string, g: Gloss) => void
  source?: { kind: string; id: number }
}) {
  const [data, setData] = useState<Gloss | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [added, setAdded] = useState(false)
  const add = useAddCard()

  useEffect(() => {
    if (!target) return
    setData(null)
    setErr(null)
    setAdded(false)
    let live = true
    gloss(target.term, target.sentence)
      .then((g) => {
        if (!live) return
        setData(g)
        onLooked?.(target.term, g)
      })
      .catch((e) => live && setErr((e as Error).message))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.term, target?.sentence])

  return (
    <Dialog open={!!target} onClose={onClose} title={target?.term ?? ''} description={data ? [data.pos, data.ipa && `/${data.ipa}/`].filter(Boolean).join(' · ') : undefined}>
      <div className="space-y-3 p-5">
        {!data && !err && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> 찾는 중…
          </div>
        )}
        {err && <p className="text-sm text-bad">{err}</p>}
        {data && (
          <>
            <div className="text-lg font-semibold">{data.meaning_ko}</div>
            <p className="text-sm text-muted">{data.definition_en}</p>
            {data.note_ko && <p className="rounded-lg bg-surface-2/60 px-3 py-2 text-sm">{data.note_ko}</p>}
            <div className="text-sm">
              <div className="italic">{data.example_en}</div>
              <div className="text-subtle">{data.example_ko}</div>
            </div>
            {data.rank != null && <div className="text-xs text-subtle">빈도 순위 약 {data.rank.toLocaleString()}위</div>}
          </>
        )}
        <div className="flex gap-2 pt-1">
          <Button variant="secondary" onClick={() => target && speak(data?.lemma && !target.term.includes(' ') ? data.lemma : target.term)}>
            <Volume2 /> 발음
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={!target || added || add.isPending}
            onClick={() =>
              target &&
              add.mutate(
                {
                  term: data?.lemma && !target.term.includes(' ') ? data.lemma : target.term,
                  context: target.sentence,
                  meaning_ko: data?.meaning_ko,
                  definition_en: data?.definition_en,
                  source_kind: source?.kind,
                  source_id: source?.id,
                },
                { onSuccess: () => setAdded(true) },
              )
            }
          >
            {added ? <Check /> : <Plus />} {added ? '단어장에 추가됨' : '단어장에 추가'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
