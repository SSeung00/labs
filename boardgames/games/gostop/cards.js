/* Hwatu cards — 12 months × 4 = 48 cards + 2 bonus pi. Shared by the engine (Node) and the screen (strings only, no DOM).
   Card code: month number + a–d (e.g. "1a" pine gwang, "12d" rain double pi). Bonus: "B2" bonus double pi · "B3" bonus triple pi.
   Kind t: g gwang · t ribbon (tti) · y animal (yeolkkeut) · p pi.  pv: pi value (pi 1 · double pi 2 · triple pi 3)
   set: hong · cheong · cho (ribbons), go godori (animals).  rain: rain gwang · rain ribbon.  guk: September gukjin (animal or double pi)
   Text helpers come in two flavours: ...Tx() returns a bilingual tx object (for the engine), the plain one resolves it
   in the viewer's language with loc() (for the UI). */
import { tx, loc } from "../../core/i18n.js";

export const MONTH_NAME = [null, tx("송학", "Pine"), tx("매조", "Plum"), tx("벚꽃", "Cherry"), tx("흑싸리", "Wisteria"), tx("난초", "Iris"),
  tx("모란", "Peony"), tx("홍싸리", "Bush clover"), tx("공산", "Moon"), tx("국화", "Chrysanthemum"), tx("단풍", "Maple"),
  tx("오동", "Paulownia"), tx("비", "Rain")];
export const MONTH_ART = ["", "🌲", "🌸", "🌸", "🌿", "🌱", "🌺", "🍂", "🌕", "🌼", "🍁", "🍃", "☔"];
const MON_EN = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/* A month as text: tx("8월", "Aug") */
export const monTx = m => tx(`${m}월`, MON_EN[m] || String(m));
export const mon = m => loc(monTx(m));

const DEF = {
  1: ["g", "t:hong", "p", "p"],
  2: ["y:go", "t:hong", "p", "p"],
  3: ["g", "t:hong", "p", "p"],
  4: ["y:go", "t:cho", "p", "p"],
  5: ["y", "t:cho", "p", "p"],
  6: ["y", "t:cheong", "p", "p"],
  7: ["y", "t:cho", "p", "p"],
  8: ["g", "y:go", "p", "p"],
  9: ["y:guk", "t:cheong", "p", "p"],
  10: ["y", "t:cheong", "p", "p"],
  11: ["g", "pp", "p", "p"],
  12: ["g:rain", "y", "t:rain", "pp"]
};

export const CARDS = {};
export const DECK48 = [];
for (let m = 1; m <= 12; m++) DEF[m].forEach((spec, i) => {
  const id = m + "abcd"[i];
  const [t, x] = spec.split(":");
  const c = { id, m, i, t: t === "pp" ? "p" : t, pv: t === "pp" ? 2 : t === "p" ? 1 : 0, set: null, rain: false, guk: false, bonus: false };
  if (x === "rain") c.rain = true; else if (x === "guk") c.guk = true; else if (x) c.set = x;
  CARDS[id] = c;
  DECK48.push(id);
});
CARDS.B2 = { id: "B2", m: 0, i: 0, t: "p", pv: 2, set: null, rain: false, guk: false, bonus: true };
CARDS.B3 = { id: "B3", m: 0, i: 1, t: "p", pv: 3, set: null, rain: false, guk: false, bonus: true };
export const BONUS = ["B2", "B3"];

export const SET_NAME = { hong: tx("홍단", "Hongdan"), cheong: tx("청단", "Cheongdan"), cho: tx("초단", "Chodan"), go: tx("고도리", "Godori") };
/* Short set names for small tiles and badges */
export const SET_SHORT = { hong: tx("홍단", "Hong"), cheong: tx("청단", "Cheong"), cho: tx("초단", "Cho"), go: tx("고도리", "Godori") };
export const SET_CARDS = { hong: ["1b", "2b", "3b"], cheong: ["6b", "9b", "10b"], cho: ["4b", "5b", "7b"], go: ["2a", "4a", "8b"] };

/* Special moves recorded in a turn (engine keys → bilingual names) */
export const COMBO = {
  ppeok: tx("뻑", "Ppeok"), ppeokTake: tx("뻑 먹기", "Ppeok capture"), selfPpeok: tx("자뻑", "Self-ppeok"),
  jjok: tx("쪽", "Jjok"), ttadak: tx("따닥", "Ttadak"), sseul: tx("쓸", "Sseul"), bomb: tx("폭탄", "Bomb"), shake: tx("흔들기", "Shake")
};

export const isCard = id => typeof id === "string" && Object.prototype.hasOwnProperty.call(CARDS, id);
export const monthOf = id => CARDS[id].m;
export const isBonus = id => isCard(id) && CARDS[id].bonus;

/* Sort: by month, then a–d inside a month. Bonus cards first (so they stand out in the hand) */
export const cardOrder = id => (CARDS[id].bonus ? -10 + CARDS[id].i : CARDS[id].m * 4 + CARDS[id].i);
export const sortCards = arr => arr.slice().sort((a, b) => cardOrder(a) - cardOrder(b));

/* Short kind name of one card */
export function kindLabelTx(id) {
  const c = CARDS[id];
  if (c.bonus) return c.pv === 3 ? tx("쓰리피", "Triple Pi") : tx("쌍피", "Double Pi");
  if (c.t === "g") return c.rain ? tx("비광", "Rain Gwang") : tx("광", "Gwang");
  if (c.t === "t") return c.set ? SET_NAME[c.set] : tx("띠", "Ribbon");
  if (c.t === "y") return c.set === "go" ? SET_NAME.go : c.guk ? tx("국진", "Gukjin") : tx("열끗", "Animal");
  return c.pv === 2 ? tx("쌍피", "Double Pi") : tx("피", "Pi");
}
export function cardNameTx(id) {
  const c = CARDS[id], k = kindLabelTx(id);
  return c.bonus ? tx(`보너스 ${k.ko}`, `Bonus ${k.en}`) : tx(`${c.m}월 ${k.ko}`, `${MON_EN[c.m]} ${k.en}`);
}
export const kindLabel = id => loc(kindLabelTx(id));
export const cardName = id => loc(cardNameTx(id));

/* Captured-card groups: g gwang · t ribbon · y animal · p pi (gukjin goes to y or p, as its owner's score counts it) */
export function groupOf(id, gukAs) {
  const c = CARDS[id];
  if (c.guk) return gukAs === "p" ? "p" : "y";
  return c.t;
}

/* ---------- HTML for the screen (browser only) ----------
   .hw element: size via --cw/--ch (default 40×62). extra: more classes (mini · sel · can · dim · in …)
   MARK is the round badge top-right, LABEL the name strip at the bottom (short enough for small cards in both languages). */
const MARK = {
  g: tx("광", "G"), hong: "", cheong: "", cho: "", rain: "", y: tx("열", "A"), go: "🐦", guk: tx("국", "A"), pp: "2", p: ""
};
const LABEL = {
  g: tx("광", "Gwang"), hong: tx("홍단", "Hong"), cheong: tx("청단", "Cheong"), cho: tx("초단", "Cho"), rain: tx("띠", "Ribbon"),
  y: tx("열끗", "Animal"), go: tx("고도리", "Godori"), guk: tx("국진", "Gukjin"), pp: tx("쌍피", "2× Pi"), p: tx("피", "Pi")
};
export function kindKey(id) {
  const c = CARDS[id];
  if (c.t === "g") return "g";
  if (c.t === "t") return c.set || "rain";
  if (c.t === "y") return c.set === "go" ? "go" : c.guk ? "guk" : "y";
  return c.pv === 2 ? "pp" : "p";
}
/* Short kind label as printed on the card (also used for hand tags) */
export function shortLabel(id) {
  const c = CARDS[id];
  if (c.bonus) return loc(tx("보너스", "Bonus"));
  const k = kindKey(id);
  return k === "g" && c.rain ? loc(tx("비광", "Rain")) : loc(LABEL[k]);
}
/* Face designs chosen in the settings (core/settings.js sets <html data-hwdeck>); every card gets "hd-<design>" */
export const HW_DECKS = ["classic", "trad", "night", "big", "flat"];
const deckNow = () => (typeof document !== "undefined" && document.documentElement.dataset.hwdeck) || "classic";

/* design: preview a design other than the chosen one (settings) */
export function hwHTML(id, extra = "", design) {
  const d = "hd-" + (design || deckNow());
  if (!id) return `<div class="hw back ${d} ${extra}"><i></i></div>`;
  const c = CARDS[id];
  if (c.bonus) {
    return `<div class="hw bonus ${d} ${extra}" data-c="${id}" title="${cardName(id)}"><span class="hw-n">★</span><span class="hw-k">+${c.pv}</span>` +
      `<span class="hw-art">🎁</span><span class="hw-l">${shortLabel(id)}</span></div>`;
  }
  const k = kindKey(id);
  return `<div class="hw m${c.m} k-${k} ${d} ${extra}" data-c="${id}" title="${cardName(id)}"><span class="hw-n">${c.m}</span>` +
    `<span class="hw-k">${loc(MARK[k])}</span><span class="hw-art">${MONTH_ART[c.m]}</span><span class="hw-l">${shortLabel(id)}</span></div>`;
}
