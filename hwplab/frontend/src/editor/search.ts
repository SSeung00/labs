// Find & replace: highlights every match with decorations; the current one is emphasised.
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface Match {
  from: number
  to: number
}
interface SearchState {
  query: string
  caseSensitive: boolean
  matches: Match[]
  index: number
  deco: DecorationSet
}

export const searchKey = new PluginKey<SearchState>('hwp-search')

function findMatches(doc: PMNode, query: string, caseSensitive: boolean): Match[] {
  if (!query) return []
  const out: Match[] = []
  const q = caseSensitive ? query : query.toLowerCase()
  // Text is gathered per textblock so matches can span differently formatted runs.
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    const map: number[] = []
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) map.push(pos + 1 + offset + i)
        text += child.text
      } else {
        map.push(-1)
        text += '￼'
      }
    })
    const hay = caseSensitive ? text : text.toLowerCase()
    let i = hay.indexOf(q)
    while (i >= 0) {
      const from = map[i]
      const last = map[i + q.length - 1]
      if (from >= 0 && last >= 0) out.push({ from, to: last + 1 })
      i = hay.indexOf(q, i + Math.max(1, q.length))
    }
    return false
  })
  return out
}

function build(state: EditorState, query: string, caseSensitive: boolean, index: number): SearchState {
  const matches = findMatches(state.doc, query, caseSensitive)
  const idx = matches.length ? Math.min(Math.max(index, 0), matches.length - 1) : -1
  const deco = DecorationSet.create(
    state.doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === idx ? 'hwp-find hwp-find-cur' : 'hwp-find' })),
  )
  return { query, caseSensitive, matches, index: idx, deco }
}

export const Search = Extension.create({
  name: 'hwpSearch',
  addProseMirrorPlugins() {
    const plugin: Plugin<SearchState> = new Plugin<SearchState>({
      key: searchKey,
      state: {
        init: (_, state) => build(state, '', false, 0),
        apply(tr, value, _old, state) {
          const meta = tr.getMeta(searchKey) as Partial<SearchState> | undefined
          if (meta) return build(state, meta.query ?? value.query, meta.caseSensitive ?? value.caseSensitive, meta.index ?? value.index)
          if (tr.docChanged && value.query) return build(state, value.query, value.caseSensitive, value.index)
          return value
        },
      },
      props: { decorations: (state) => plugin.getState(state)?.deco },
    })
    return [plugin]
  },
})

export function setSearch(state: EditorState, dispatch: (tr: Transaction) => void, query: string, caseSensitive: boolean) {
  const sel = state.selection.from
  const matches = findMatches(state.doc, query, caseSensitive)
  const index = Math.max(0, matches.findIndex((m) => m.from >= sel))
  dispatch(state.tr.setMeta(searchKey, { query, caseSensitive, index }))
}

export function gotoMatch(state: EditorState, dispatch: (tr: Transaction) => void, delta: number) {
  const s = searchKey.getState(state)
  if (!s || !s.matches.length) return null
  const index = (s.index + delta + s.matches.length) % s.matches.length
  const m = s.matches[index]
  dispatch(
    state.tr
      .setMeta(searchKey, { index })
      .setSelection(TextSelection.create(state.doc, m.from, m.to))
      .scrollIntoView(),
  )
  return m
}

export function replaceCurrent(state: EditorState, dispatch: (tr: Transaction) => void, replacement: string) {
  const s = searchKey.getState(state)
  if (!s || s.index < 0) return
  const m = s.matches[s.index]
  const marks = state.doc.resolve(m.from + 1).marks()
  const tr = state.tr.replaceWith(m.from, m.to, replacement ? state.schema.text(replacement, marks) : [])
  dispatch(tr.setMeta(searchKey, { index: s.index }))
}

export function replaceAll(state: EditorState, dispatch: (tr: Transaction) => void, replacement: string) {
  const s = searchKey.getState(state)
  if (!s || !s.matches.length) return 0
  const tr = state.tr
  for (const m of [...s.matches].reverse()) {
    const marks = state.doc.resolve(m.from + 1).marks()
    tr.replaceWith(m.from, m.to, replacement ? state.schema.text(replacement, marks) : [])
  }
  dispatch(tr.setMeta(searchKey, { index: 0 }))
  return s.matches.length
}
