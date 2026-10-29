import { Extension, generateHTML, type Editor, type JSONContent } from '@tiptap/core'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { StarterKit } from '@tiptap/starter-kit'
import {
  HwpEquation,
  HwpFootnote,
  HwpImage,
  HwpParagraph,
  HwpTable,
  HwpTableCell,
  HwpTableHeader,
  HwpTableRow,
  HwpTextStyle,
  HwpUnderline,
  PARA_DEFAULTS,
  type CharAttrs,
  type ParaAttrs,
} from './extensions'
import { DEFAULT_FONT, DEFAULT_SIZE } from './fonts'
import { Pagination, type PaginationOptions } from './pagination'
import { Search } from './search'

/** Schema-only extensions (no editor plugins): used for static HTML of headers/footers. */
export const schemaExtensions = () => [
  StarterKit.configure({
    paragraph: false,
    underline: false,
    heading: false,
    blockquote: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    link: false,
    trailingNode: false,
  }),
  HwpParagraph,
  HwpTextStyle,
  HwpUnderline,
  Subscript,
  Superscript,
  HwpTable,
  HwpTableRow,
  HwpTableCell,
  HwpTableHeader,
  HwpImage,
  HwpEquation,
  HwpFootnote,
]

export interface EditorHooks {
  onSave: () => void
  onFind: (replace: boolean) => void
  onParagraphDialog: () => void
  onCharDialog: () => void
  onPageDialog: () => void
  onPrint: () => void
}

const HwpKeys = Extension.create<{ hooks: () => EditorHooks }>({
  name: 'hwpKeys',
  addOptions() {
    return { hooks: () => ({}) as EditorHooks }
  },
  addKeyboardShortcuts() {
    const h = () => this.options.hooks()
    const align = (a: ParaAttrs['align']) => () => setPara(this.editor, { align: a })
    return {
      'Mod-s': () => (h().onSave(), true),
      'Mod-f': () => (h().onFind(false), true),
      'Mod-h': () => (h().onFind(true), true),
      'Mod-p': () => (h().onPrint(), true),
      'Alt-t': () => (h().onParagraphDialog(), true),
      'Alt-l': () => (h().onCharDialog(), true),
      F7: () => (h().onPageDialog(), true),
      'Mod-Enter': () => insertPageBreak(this.editor),
      'Mod-Shift-l': align('left'),
      'Mod-Shift-c': align('center'),
      'Mod-Shift-r': align('right'),
      'Mod-Shift-m': align('justify'),
      'Mod-Shift-t': align('distribute'),
      'Mod-]': () => stepFontSize(this.editor, 1),
      'Mod-[': () => stepFontSize(this.editor, -1),
    }
  },
})

export function editorExtensions(pagination: PaginationOptions, hooks: () => EditorHooks) {
  return [...schemaExtensions(), Pagination.configure(pagination), Search, HwpKeys.configure({ hooks })]
}

export function staticHtml(paragraphs: JSONContent[] | null | undefined) {
  if (!paragraphs?.length) return ''
  try {
    return generateHTML({ type: 'doc', content: paragraphs }, schemaExtensions())
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------------------------
// formatting commands

export function currentChar(editor: Editor): CharAttrs & { fontLatin: string; fontHangul: string; size: number } {
  const a = editor.getAttributes('textStyle') as Partial<CharAttrs>
  const para = editor.getAttributes('paragraph') as Partial<ParaAttrs>
  return {
    fontLatin: a.fontLatin || a.fontHangul || DEFAULT_FONT,
    fontHangul: a.fontHangul || a.fontLatin || DEFAULT_FONT,
    size: a.size || para.size || DEFAULT_SIZE,
    color: a.color || '#000000',
    shade: a.shade || null,
    spacing: a.spacing ?? 0,
    ratio: a.ratio ?? 100,
  }
}

export function setChar(editor: Editor, attrs: Partial<CharAttrs>) {
  const chain = editor.chain().focus().setMark('textStyle', attrs)
  // keep empty paragraphs' line height in step with the chosen size
  if (attrs.size) chain.updateAttributes('paragraph', { size: attrs.size })
  return chain.run()
}

export function setFont(editor: Editor, face: string) {
  return setChar(editor, { fontHangul: face, fontLatin: face })
}

export function stepFontSize(editor: Editor, delta: number) {
  const size = currentChar(editor).size
  const next = Math.max(1, Math.round((size + delta) * 10) / 10)
  return setChar(editor, { size: next })
}

export function setPara(editor: Editor, attrs: Partial<ParaAttrs>) {
  return editor.chain().focus().updateAttributes('paragraph', attrs).run()
}

export function currentPara(editor: Editor): ParaAttrs {
  return { ...PARA_DEFAULTS, ...(editor.getAttributes('paragraph') as Partial<ParaAttrs>) }
}

export function insertPageBreak(editor: Editor) {
  return editor
    .chain()
    .focus()
    .splitBlock()
    .updateAttributes('paragraph', { pageBreak: true })
    .run()
}

export function toggleIndent(editor: Editor, hanging: boolean) {
  const p = currentPara(editor)
  const size = currentChar(editor).size
  const step = size * 2 // two characters
  const indent = hanging ? (p.indent < 0 ? 0 : -step) : p.indent > 0 ? 0 : step
  return setPara(editor, { indent })
}

export function shiftMargin(editor: Editor, delta: number) {
  const p = currentPara(editor)
  return setPara(editor, { left: Math.max(0, Math.round((p.left + delta) * 100) / 100) })
}

export function docJson(editor: Editor): JSONContent {
  return editor.getJSON()
}
