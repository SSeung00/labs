import { Fragment, type ReactNode } from 'react'

/** Minimal Markdown for AI answers: headings, - / 1. lists, | tables |, **bold**, `code`. No HTML passthrough. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} className="font-semibold text-text">{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="rounded bg-surface-2 px-1 text-[0.92em]">{part.slice(1, -1)}</code>
    return <Fragment key={i}>{part}</Fragment>
  })
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let table: string[][] = []

  const flush = () => {
    if (list) {
      const L = list
      const Tag = L.ordered ? 'ol' : 'ul'
      blocks.push(
        <Tag key={`l-${blocks.length}`} className="my-2 space-y-1.5">
          {L.items.map((li, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed text-muted">
              {L.ordered ? <span className="num shrink-0 font-semibold text-accent">{i + 1}.</span> : <span className="mt-2 size-1 shrink-0 rounded-full bg-accent" />}
              <span>{inline(li)}</span>
            </li>
          ))}
        </Tag>,
      )
      list = null
    }
    if (table.length) {
      const [head, ...body] = table.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)))
      blocks.push(
        <div key={`t-${blocks.length}`} className="my-2 overflow-x-auto rounded-lg border">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2/70 text-xs text-muted">
              <tr>{head.map((c, i) => <th key={i} className="px-2.5 py-1.5 text-left font-medium">{inline(c)}</th>)}</tr>
            </thead>
            <tbody className="num divide-y">
              {body.map((r, ri) => (
                <tr key={ri}>{r.map((c, i) => <td key={i} className="px-2.5 py-1.5">{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      table = []
    }
  }

  for (const raw of source.split('\n')) {
    const line = raw.trimEnd()
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (list) flush()
      table.push(cells(line))
      continue
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (bullet || numbered) {
      const ordered = !!numbered
      if (table.length || (list && list.ordered !== ordered)) flush()
      list ??= { ordered, items: [] }
      list.items.push((bullet ?? numbered)![1])
      continue
    }
    flush()
    if (!line.trim()) continue
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      blocks.push(
        <h4 key={blocks.length} className="mb-1 mt-4 text-sm font-semibold tracking-tight first:mt-0">
          {inline(h[2])}
        </h4>,
      )
    } else {
      blocks.push(
        <p key={blocks.length} className="my-2 text-sm leading-relaxed text-muted first:mt-0">
          {inline(line)}
        </p>,
      )
    }
  }
  flush()
  return <div>{blocks}</div>
}
