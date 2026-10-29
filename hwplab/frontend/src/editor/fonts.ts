// HWP documents name Hangul's own fonts (함초롬바탕, 휴먼명조, HY견고딕 …) that are usually not
// installed. Each run lists its Latin and Hangul faces first and then falls back to an
// installed font of the same family style, so line breaks stay close to the original.

const SERIF = /바탕|명조|batang|myeongjo|궁서|gungsuh|serif|times|신명|순명|HY.*(명|궁)|한컴.*바탕|garamond|georgia|cambria|book/i

const SERIF_FALLBACK = '"HCR Batang", "함초롬바탕", "Noto Serif KR", "NanumMyeongjo", "나눔명조", "Batang", "바탕", serif'
const SANS_FALLBACK = '"HCR Dotum", "함초롬돋움", "Malgun Gothic", "맑은 고딕", "Noto Sans KR", "NanumGothic", "Dotum", sans-serif'

const quote = (name: string) => `"${name.replace(/"/g, '')}"`

export function isSerif(name: string | null | undefined) {
  return SERIF.test(name || '')
}

export function fontStack(latin?: string | null, hangul?: string | null) {
  const names = [...new Set([latin, hangul].filter((n): n is string => !!n))]
  const fallback = isSerif(hangul || latin) ? SERIF_FALLBACK : SANS_FALLBACK
  return [...names.map(quote), fallback].join(', ')
}

// Fonts offered in the toolbar; fonts used by the open document are added in front.
export const COMMON_FONTS = [
  '함초롬바탕',
  '함초롬돋움',
  '맑은 고딕',
  '바탕',
  '돋움',
  '굴림',
  '궁서',
  '나눔고딕',
  '나눔명조',
  'Noto Sans KR',
  'Noto Serif KR',
  '휴먼명조',
  'HY헤드라인M',
  'Times New Roman',
  'Arial',
  'Calibri',
]

export const DEFAULT_FONT = '함초롬바탕'
export const DEFAULT_SIZE = 10
