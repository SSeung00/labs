/* Dalmuti cards on screen — shared by the game screen (ui.js) and the card-design previews in the settings (core/settings.js).
   Face designs: core/settings.js sets <html data-dmdeck>; every card gets "dd-<design>" (styles in style.css). */
import { L, lang } from "../../core/i18n.js";

export const JESTER = 13;
export const CARD_KO = ["달무티", "대주교", "남작부인", "수녀원장", "기사", "재봉사", "석공", "요리사", "양치기", "채석공", "소작농", "농노"];
export const CARD_EN = ["Dalmuti", "Archbishop", "Baroness", "Abbess", "Knight", "Seamstress", "Mason", "Cook", "Shepherdess", "Stonecutter", "Peasant", "Serf"];
export const cardName = r => r === JESTER ? L("광대", "Jester") : L(CARD_KO[r - 1], CARD_EN[r - 1]);
export const RANK_COLOR = {
  1: "#7d1128", 2: "#5b3a8c", 3: "#a8325e", 4: "#2a6a86", 5: "#33506e", 6: "#1c6f55",
  7: "#6b6257", 8: "#a9591f", 9: "#6f8a33", 10: "#4c5a66", 11: "#8a7320", 12: "#55663a", 13: "#9d1040"
};
export const GLYPH = {
  1: '<path d="M4 8l3.6 3.6L12 4l4.4 7.6L20 8l-1.7 9H5.7z"/><rect x="5.4" y="18.2" width="13.2" height="2.4" rx=".7"/>',
  2: '<path d="M12 3c2.6 3.3 4.2 6.9 4.2 10.5V20H7.8v-6.5C7.8 9.9 9.4 6.3 12 3z"/>',
  3: '<path d="M12 3c1.6 1.4 2.4 3 2.4 4.6 0 1.5-.8 2.6-2.4 4-1.6-1.4-2.4-2.5-2.4-4C9.6 6 10.4 4.4 12 3z"/><path d="M12 11.6c2.6-2.4 5.4-1.6 5.4 1.2 0 1.8-1.8 3-5.4 3s-5.4-1.2-5.4-3c0-2.8 2.8-3.6 5.4-1.2z"/><rect x="11" y="15.6" width="2" height="5" rx=".6"/>',
  4: '<path d="M7 4h10v2.6a5 5 0 0 1-4 4.9V17h3.2v3H7.8v-3H11v-5.5a5 5 0 0 1-4-4.9z"/>',
  5: '<path d="M11 3h2v10.6h-2z"/><path d="M7.4 13.6h9.2v2H7.4z"/><path d="M11 15.6h2v4.2h-2z"/><circle cx="12" cy="20.6" r="1.4"/>',
  6: '<rect x="7.8" y="3.6" width="8.4" height="2.2" rx=".7"/><rect x="9.6" y="5.8" width="4.8" height="12.4" rx=".6"/><rect x="7.8" y="18.2" width="8.4" height="2.2" rx=".7"/>',
  7: '<rect x="3" y="5" width="18" height="4.2" rx=".6"/><rect x="3" y="10" width="8.4" height="4.2" rx=".6"/><rect x="12.6" y="10" width="8.4" height="4.2" rx=".6"/><rect x="3" y="15" width="18" height="4.2" rx=".6"/>',
  8: '<path d="M4 9.2h16v5.3A5.5 5.5 0 0 1 14.5 20h-5A5.5 5.5 0 0 1 4 14.5z"/><rect x="3" y="6.6" width="18" height="2.1" rx=".8"/><rect x="11" y="3.6" width="2" height="2.9" rx=".8"/>',
  9: '<path d="M11 21V9.6a4.6 4.6 0 0 1 9.2 0v1.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  10: '<path d="M2.8 9.6c6-4.4 12.6-4.4 18.4 0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><rect x="11" y="6" width="2" height="15" rx=".8"/>',
  11: '<rect x="11.2" y="10" width="1.6" height="11" rx=".6"/><path d="M12 3.4c1.8 1.4 2.4 3.2 0 5.4-2.4-2.2-1.8-4 0-5.4z"/><path d="M8.2 7.2c2.2.6 3 2.2 2 4.8-2.4-.8-3-2.6-2-4.8z"/><path d="M15.8 7.2c1 2.2.4 4-2 4.8-1-2.6-.2-4.2 2-4.8z"/>',
  12: '<rect x="11" y="3" width="2" height="9" rx=".7"/><path d="M7.5 12h9v3.2c0 3-1.9 5.4-4.5 5.8-2.6-.4-4.5-2.8-4.5-5.8z"/>',
  13: '<path d="M12 6.6c-3.4 0-6.4 2.4-7.4 6.2L3.3 18l3.5-1.2L12 19l5.2-2.2 3.5 1.2-1.3-5.2c-1-3.8-4-6.2-7.4-6.2z"/><circle cx="3" cy="18.8" r="1.5"/><circle cx="21" cy="18.8" r="1.5"/><circle cx="12" cy="4.6" r="1.5"/>'
};

export const DM_DECKS = ["classic", "royal", "number", "minimal", "parchment"];
const deckNow = () => (typeof document !== "undefined" && document.documentElement.dataset.dmdeck) || "classic";

/* One card. cls: extra classes ("mini", state classes); design: preview a design other than the chosen one;
   style: extra inline style (e.g. "--cw:80px" for a card drawn outside the game screen, such as a flying copy) */
export function dmCardHTML(r, cls = "", design, style = "") {
  const j = r === JESTER, name = j ? L("와일드", "Wild") : cardName(r);
  const en = lang === "en" ? " en" : "";
  return `<span class="dm-card${j ? " jk" : ""}${en} dd-${design || deckNow()} ${cls}" style="--rc:${RANK_COLOR[r]};${style}"><span class="band"></span>` +
    `<span class="cn">${j ? "J" : r}</span><svg class="gl" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${GLYPH[r]}</svg>` +
    `<span class="rk">${j ? L("광대", "Jester") : r}</span><span class="tt${name.length > 8 ? " lg" : ""}">${name}</span></span>`;
}
