import { Fragment, type ReactNode } from 'react'

/**
 * Small Markdown renderer for coach text: #–### headings, - and 1. lists, | tables |,
 * **bold**, `code`, paragraphs. Everything renders as React text — no HTML passthrough.
 */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={i} className="font-semibold text-text">{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return <code key={i} className="rounded bg-surface-3 px-1 text-[0.92em]">{part.slice(1, -1)}</code>
    return <Fragment key={i}>{part}</Fragment>
  })
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
const isRule = (row: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(row)

export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let table: string[] = []

  const flushList = () => {
    if (!list) return
    const { ordered, items } = list
    blocks.push(
      <ul key={`l-${blocks.length}`} className="my-2 space-y-1.5">
        {items.map((li, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-muted">
            {ordered ? (
              <span className="num w-4 shrink-0 text-right text-xs font-semibold leading-relaxed text-accent">{i + 1}.</span>
            ) : (
              <span className="mt-2 size-1 shrink-0 rounded-full bg-accent" />
            )}
            <span className="min-w-0">{inline(li)}</span>
          </li>
        ))}
      </ul>,
    )
    list = null
  }

  const flushTable = () => {
    if (!table.length) return
    const rows = table.filter((r) => !isRule(r)).map(cells)
    const [head, ...body] = rows
    blocks.push(
      <div key={`t-${blocks.length}`} className="my-3 overflow-x-auto rounded-xl border">
        <table className="w-full text-[13px]">
          <thead className="bg-surface-2/70">
            <tr>{head.map((c, i) => <th key={i} className="whitespace-nowrap px-3 py-2 text-left font-semibold">{inline(c)}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((r, i) => (
              <tr key={i} className="border-t">
                {r.map((c, j) => <td key={j} className="num px-3 py-1.5 text-muted">{inline(c)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    )
    table = []
  }

  for (const raw of source.split('\n')) {
    const line = raw.trimEnd()
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushList()
      table.push(line)
      continue
    }
    flushTable()
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (bullet || numbered) {
      const ordered = !!numbered
      if (list && list.ordered !== ordered) flushList()
      list ??= { ordered, items: [] }
      list.items.push((bullet ?? numbered)![1])
      continue
    }
    flushList()
    if (!line.trim() || /^-{3,}$/.test(line.trim())) continue
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      blocks.push(
        <h4 key={blocks.length} className="mb-1 mt-4 text-sm font-semibold tracking-tight first:mt-0">
          {inline(h[2])}
        </h4>,
      )
    } else {
      blocks.push(
        <p key={blocks.length} className="my-2 text-sm leading-relaxed text-muted">
          {inline(line)}
        </p>,
      )
    }
  }
  flushTable()
  flushList()
  return <div>{blocks}</div>
}
