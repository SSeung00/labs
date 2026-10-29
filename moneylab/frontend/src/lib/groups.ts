/** Dashboard spending groups, bottom-to-top in stacked charts. Mirrors Category.group on the backend. */
export const GROUPS = ['고정비', '생활', '취미', '여행', '기타'] as const

export const GROUP_COLORS: Record<string, string> = {
  고정비: '#868e96',
  생활: '#2f9e44',
  취미: '#e8590c',
  여행: '#2a78d6',
  기타: '#adb5bd',
}
