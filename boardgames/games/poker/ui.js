/* Poker screen — top: opponent panels (name · chips · this street's bet · last action · D/SB/BB · turn and time left)
   Felt in the middle: 5 board cards (cards making my hand in gold) · pot · this hand's action log (results when the hand ends)
   Bottom: my cards · chips · current hand · draws / calc row (call · pot after call · pot odds · rough win chance) / action buttons
   Cards and text scale with the real height of .pk and the felt (container units) — no dead space.
   Sideways (landscape): opponents above the felt on the left, my cards and buttons in a column on the right.
   Spectators (me = -1, watching screens, TVs, public replays): no dock — every seat sits around the felt
   (top and bottom rows in portrait, left and right columns sideways) and the board gets the freed space.
   A raise is chosen in the panel below and only sent after pressing confirm. An all-in call, and folding when checking is
   free, also need a second tap. All visible text is L("한국어", "English"), evaluated at render time. */
import { cardHTML } from "../../core/cards.js";
import { L, loc } from "../../core/i18n.js";
import { bestHand, evalCodes, C2I, ev7, preflopEq, preflopPct } from "./engine.js";

const streetName = i => [L("프리플랍", "Preflop"), L("플랍", "Flop"), L("턴", "Turn"), L("리버", "River")][i] || "";
const shortSt = i => L("프플턴리", "PFTR")[i] || "";    // one-letter street marks in the per-seat history
const SUIT = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RANK = { 1: "A", 11: "J", 12: "Q", 13: "K" };
const RN = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];   // engine rank index (0=2 … 12=A) → label
const fmt = n => Number(n || 0).toLocaleString("ko-KR");
const label = c => (RANK[+c.slice(1)] || c.slice(1)) + SUIT[c[0]];
const red = c => c[0] === "H" || c[0] === "D";
const ridx = c => { const r = +c.slice(1); return r === 1 ? 12 : r - 2; };
const mini = (c, extra = "") => `<span class="pk-mini s-${c[0]}${red(c) ? " red" : ""}${extra ? " " + extra : ""}">${label(c)}</span>`;
const pct = x => `${Math.round(x * 100)}%`;
const EQ_KEY = "bg.poker.eq";        // show the rough win chance (localStorage)
const LSget = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const LSset = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
const LAND = "(orientation: landscape) and (min-aspect-ratio: 4/3)";   // same query as the sideways layout in style.css
/* Action code (engine log / seat act) → word */
function actWord(a) {
  switch (a) {
    case "fold": return L("폴드", "Fold");
    case "check": return L("체크", "Check");
    case "call": return L("콜", "Call");
    case "bet": return L("벳", "Bet");
    case "raise": return L("레이즈", "Raise");
    case "allin": return L("올인", "All-in");
    case "sb": return "SB";
    case "bb": return "BB";
  }
  return a || "";
}

/* ===================== My hand analysis (public info + my own cards only) ===================== */
/* Current hand: {name, detail, core: cards forming the hand, onBoard: whether the hand is on the board alone} */
function madeHand(hole, board) {
  const h = bestHand([...hole, ...board]), k = h.score >> 20;
  const a = (h.score >> 16) & 15, b = (h.score >> 12) & 15;
  const high = r => L(`${RN[r]} 하이`, `${RN[r]} high`);
  let detail = "", core;
  switch (k) {
    case 0: detail = high(a); break;
    case 1: case 3: case 7: detail = RN[a]; break;
    case 2: case 6: detail = `${RN[a]}·${RN[b]}`; break;
    case 4: case 5: detail = high(a); break;
    case 8: detail = a === 12 ? "" : high(a); break;
  }
  if (k === 0) core = [h.best.reduce((x, y) => (ridx(y) > ridx(x) ? y : x))];
  else if (k === 1 || k === 3 || k === 7) core = h.best.filter(c => ridx(c) === a);
  else if (k === 2) core = h.best.filter(c => ridx(c) === a || ridx(c) === b);
  else core = h.best.slice();
  const onBoard = k > 0 && !hole.some(c => core.includes(c));
  return { k, score: h.score, name: loc(h.name), detail, core, onBoard };
}
/* Draws: number of next cards that make a straight or better (stronger than now). Hands made by the board alone don't count */
function drawsOf(hole, board, k, known) {
  if (board.length < 3 || board.length > 4) return [];
  const used = new Set([...hole, ...board, ...known]);
  const cnt = {};
  for (const s of "SHDC") for (let r = 1; r <= 13; r++) {
    const c = s + r;
    if (used.has(c)) continue;
    const k2 = evalCodes([...hole, ...board, c]) >> 20;
    if (k2 < 4 || k2 <= k) continue;
    if (board.length === 4 && (evalCodes([...board, c]) >> 20) >= k2) continue;
    const key = k2 >= 6 && k < 6 ? 6 : k2;           // below a full house now: group as 'full house or better'
    cnt[key] = (cnt[key] || 0) + 1;
  }
  const NM = {
    4: L("스트레이트", "Straight"), 5: L("플러시", "Flush"), 6: L("풀하우스 이상", "Full house+"),
    7: L("포카드", "Four of a kind"), 8: L("스트레이트 플러시", "Straight flush")
  };
  return Object.keys(cnt).sort((x, y) => y - x).map(x => ({ name: NM[x], n: cnt[x] }));
}
/* Description of the two preflop cards */
function preDesc(hole) {
  const [x, y] = hole, rx = ridx(x), ry = ridx(y), hi = Math.max(rx, ry), lo = Math.min(rx, ry);
  const suited = x[0] === y[0], gap = hi - lo, pair = hi === lo;
  const two = `${RN[hi]}·${RN[lo]}`;
  if (pair) return { name: L("포켓 페어", "Pocket pair"), detail: two };
  if (suited && (gap === 1 || (hi === 12 && lo === 0))) return { name: L("수딧 커넥터", "Suited connectors"), detail: two };
  if (gap === 1) return { name: L("커넥터", "Connectors"), detail: two };
  if (suited) return { name: L("수딧", "Suited"), detail: two };
  return { name: hi >= 9 && lo >= 8 ? L("하이 카드 두 장", "Two high cards") : L("오프수트", "Offsuit"), detail: two };
}
/* Rough win chance: remaining opponents' hands random (shown hands as they are), remaining board random, sims times */
function equityMC(hole, board, opps, sims) {
  const used = new Uint8Array(52), h = hole.map(c => C2I[c]), b = board.map(c => C2I[c]);
  for (const c of [...h, ...b]) used[c] = 1;
  const known = opps.map(o => (o ? o.map(c => C2I[c]) : null));
  for (const o of known) if (o) for (const c of o) used[c] = 1;
  const deck = [];
  for (let c = 0; c < 52; c++) if (!used[c]) deck.push(c);
  const B = new Array(5), nd = deck.length;
  let win = 0;
  for (let s = 0; s < sims; s++) {
    let top = nd;
    const draw = () => { const j = (Math.random() * top) | 0; top--; const t = deck[j]; deck[j] = deck[top]; deck[top] = t; return t; };
    for (let i = 0; i < 5; i++) B[i] = i < b.length ? b[i] : draw();
    const my = ev7(h[0], h[1], B[0], B[1], B[2], B[3], B[4]);
    let lost = false, ties = 0;
    for (const o of known) {
      const a1 = o ? o[0] : draw(), a2 = o ? o[1] : draw();
      const os = ev7(a1, a2, B[0], B[1], B[2], B[3], B[4]);
      if (os > my) { lost = true; break; }
      if (os === my) ties++;
    }
    if (!lost) win += 1 / (ties + 1);
  }
  return win / sims;
}

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  const fly = ctx.fly || (() => null);
  root.innerHTML = "";
  const wrap = el("div", "pk");
  wrap.innerHTML = `
    <div class="pk-opps" data-r="opps"></div>
    <div class="pk-table felt" data-r="table">
      <div class="pk-info" data-r="info"></div>
      <div class="pk-board" data-r="board"></div>
      <div class="pk-mid" data-r="mid"></div>
      <div class="pk-log" data-r="log"></div>
    </div>
    <div class="pk-opps pk-opps2" data-r="opps2" hidden></div>
    <div class="dock pk-dock" data-r="dock">
      <div class="pk-me" data-r="me"></div>
      <div class="pk-calc" data-r="calc"></div>
      <div class="hint" data-r="hint"></div>
      <div class="pk-raise" data-r="raise" hidden>
        <div class="pk-rhead"><span data-r="rlabel">${L("레이즈", "Raise")}</span><b data-r="ramt"></b></div>
        <div class="pk-rinfo" data-r="rinfo"></div>
        <div class="pk-rslide">
          <button class="pk-step" data-r="minus" aria-label="${L("줄이기", "Decrease")}">−</button>
          <input type="range" data-r="slider" aria-label="${L("금액", "Amount")}">
          <button class="pk-step" data-r="plus" aria-label="${L("늘리기", "Increase")}">+</button>
        </div>
        <div class="pk-quick" data-r="quick"></div>
        <div class="actions">
          <button class="btn" data-r="rcancel">${L("취소", "Cancel")}</button>
          <button class="btn primary" data-r="rok">${L("확인", "OK")}</button>
        </div>
      </div>
      <div class="actions" data-r="acts">
        <button class="btn" data-r="fold">${L("폴드", "Fold")}</button>
        <button class="btn" data-r="call">${L("체크", "Check")}</button>
        <button class="btn primary" data-r="raiseBtn">${L("레이즈", "Raise")}</button>
      </div>
    </div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);
  const mq = typeof matchMedia === "function" ? matchMedia(LAND) : null;

  let m = null;                 // last msg
  let lastEv = null;            // events already handled (update may be called again with the same msg)
  let askId = 0;                // id of my current decision
  let busy = false, busyT = 0;  // short lock right after sending (prevents double taps)
  let panel = false, amt = 0;   // raise panel
  let armed = "", armT = 0;     // button waiting for a confirming second tap
  let tickT = 0, resizeT = 0;
  let spec = false, land = false;   // spectator view · sideways layout
  let newBoard = 0;             // board cards that just came out (flip animation)
  let flips = new Set();        // seats whose cards were just turned up (flip animation)
  let showEq = LSget(EQ_KEY) !== "0";
  let eqCache = { key: "", val: 0 };
  let mine = null;              // current analysis of my hand (made in analyze, shared by the felt and the calc row)

  /* ---------- Helpers ---------- */
  const names = () => m.players.map(p => p.name);
  const nameOf = q => (q === m.me ? L("나", "You") : names()[q] || "?");
  const myAsk = () => (busy || m.replay ? null : ctx.myAsk("bet"));
  const lastHere = v => (v.last && v.last.hand === v.hand && (v.phase === "end" || v.phase === "over") ? v.last : null);
  function winnersOf(last) {
    const s = new Set();
    if (last) for (const pot of last.pots) for (const w of pot.winners) s.add(w.p);
    return s;
  }
  function badges(q) {
    const v = m.v;
    if (!v.hand || v.phase === "over") return "";
    let h = "";
    if (q === v.button) h += '<i class="pk-b d">D</i>';
    if (q === v.sbSeat) h += '<i class="pk-b">SB</i>';
    if (q === v.bbSeat) h += '<i class="pk-b">BB</i>';
    return h;
  }
  /* Seat act code from the engine ("fold", "check", "call", "allin", "bet 120", "raise 300") → badge class */
  const actClass = code => (code === "bet" || code === "raise" ? "raise" : ["call", "check", "allin", "fold"].includes(code) ? code : "");
  /* Opponents still in this hand (not folded, not out), with their cards if shown */
  function liveOpps() {
    const v = m.v, out = [];
    v.seats.forEach((s, q) => { if (q !== m.me && s.inHand && !s.fold && !s.out) out.push(s.cards || null); });
    return out;
  }

  /* ---------- Seat panels ---------- */
  /* One seat: name row / chips · cards / last action · bet / this hand's history.
     big: real cards (heads-up panel, spectator panels with room) instead of mini labels */
  function seatEl(q, big) {
    const v = m.v, s = v.seats[q], pl = m.players[q] || { name: "?", kind: "ai" }, active = v.turn === q;
    const last = lastHere(v), wins = winnersOf(last);
    const d = el("div", "seatchip pk-seat" + (active ? " turn" : "") + (s.out ? " out" : "") + (s.fold ? " pk-fold" : "") +
      (s.allin && !s.fold ? " pk-allin" : "") + (wins.has(q) ? " pk-win" : ""));
    d.dataset.q = q;
    const show = last ? last.shows.find(x => x.p === q) : null;
    // Status · last action (this street)
    let st;
    const folded = `<span class="pk-ab fold">${L("폴드", "Fold")}</span>`;
    if (s.out) st = `<span class="pk-ab out">${L("탈락", "Out")}</span>`;
    else if (active) st = `<span class="pk-tm" data-tm="${q}">${L("생각 중…", "Thinking…")}</span>`;
    else if (show) st = `<span class="pk-ab hand${wins.has(q) ? " won" : ""}">${esc(loc(show.hand))}</span>`;
    else if (last) st = wins.has(q) ? `<span class="pk-ab won">${L("승리", "Won")}</span>` : s.fold ? folded : "";
    else if (s.fold) st = folded;
    else if (s.allin) st = `<span class="pk-ab allin">${L("올인", "All-in")}</span>`;
    else if (s.act) {
      // The bet amount is on the gold chip next to it, so the badge shows only the action word
      const [code, to] = s.act.split(" ");
      const word = actWord(code) + (s.bet > 0 || !to ? "" : " " + fmt(+to));
      st = `<span class="pk-ab ${actClass(code)}">${esc(word)}</span>`;
    } else st = "";
    // Bottom right: this street's bet, or chips won/lost once the hand is over
    let right = "";
    if (last && last.delta[q]) right = `<b class="pk-dl ${last.delta[q] > 0 ? "up" : "down"}">${last.delta[q] > 0 ? "+" : ""}${fmt(last.delta[q])}</b>`;
    else if (s.bet > 0) right = `<span class="pk-bet" data-bq="${q}">${fmt(s.bet)}</span>`;
    const live = s.inHand && !s.fold && !s.out && v.phase !== "over";
    const best = show ? show.best : [];
    const flip = flips.has(q) ? " pk-new" : "";
    let cards;
    if (big) cards = s.cards ? s.cards.map(c => cardHTML(c, "pk-oc" + flip + (wins.has(q) && best.includes(c) ? " pk-hl" : ""))).join("")
      : live ? cardHTML(null, "pk-oc") + cardHTML(null, "pk-oc") : "";
    else cards = s.cards ? s.cards.map(c => mini(c, (wins.has(q) && best.includes(c) ? "hl" : "") + flip)).join("")
      : live ? '<span class="pk-back"></span><span class="pk-back"></span>' : "";
    d.innerHTML = `<div class="pk-s1">${avatarHTML(pl.name, q, "sm")}<span class="nm">${esc(pl.name)}</span>` +
      (pl.kind === "away" ? `<span class="away">${L("비움", "Away")}</span>` : "") + `<span class="pk-bs">${badges(q)}</span></div>` +
      `<div class="pk-s2"><span class="pk-stk">${s.out ? "-" : fmt(s.chips)}</span><span class="pk-hc">${cards}</span><span class="pk-bs pk-bs2">${badges(q)}</span></div>` +
      `<div class="pk-s3"><span class="pk-st">${st}</span><span class="pk-rt2">${right}</span></div>` +
      `<div class="pk-hist">${histHTML(q)}</div>` +
      (active ? `<div class="pk-tbar"><i data-tb="${q}"></i></div>` : "");
    return d;
  }
  /* Fill one seat box. cols: grid columns (0 = one column, as tall as the box) */
  function fillSeats(box, seats, cls, cols, big) {
    box.className = (box.dataset.r === "opps2" ? "pk-opps pk-opps2 " : "pk-opps ") + cls;
    box.style.gridTemplateColumns = cols ? `repeat(${cols},minmax(0,1fr))` : "";
    box.innerHTML = "";
    for (const q of seats) box.appendChild(seatEl(q, big));
  }

  /* Top: opponent panels (playing a seat) */
  function renderOpps() {
    const n = m.players.length, box = R("opps");
    const order = [];
    for (let k = 1; k < n; k++) order.push((m.me + k) % n);
    const no = order.length;
    let cls, cols;
    if (land) {
      // Sideways the felt needs the height: one row whenever every panel stays at least about 62px wide
      // (xs: very narrow panels drop the card backs — folds and shown cards still show)
      const W = box.clientWidth || 480;
      cols = no > 1 && W / no < 62 ? Math.ceil(no / 2) : Math.max(1, no);
      const rows = Math.ceil(no / cols), pw = W / cols;
      cls = (cols === 1 ? "c1 wide" : cols === 2 ? "c2" : pw < 112 ? "c4" : "c3") + (rows > 1 ? " r2" : "") + (pw < 74 ? " xs" : "");
    } else {
      cols = no <= 3 ? no : no === 4 ? 4 : no <= 6 ? 3 : 4;
      cls = `c${cols}${no >= 5 ? " r2" : ""}${no === 4 ? " n4" : ""}${no === 1 ? " wide" : ""}`;
      cols = 0;                  // the c1–c4 classes set the columns (n4 switches to 2×2 on tall screens)
    }
    wrap.classList.toggle("pk-many", no >= 5);
    fillSeats(box, order, cls, cols, no === 1);
  }

  /* Spectators: every seat around the felt, going clockwise */
  function renderRing() {
    const n = m.players.length, k = Math.ceil(n / 2);
    const A = [], B = [];
    for (let q = 0; q < n; q++) (q < k ? A : B).push(q);
    const a = R("opps"), b = R("opps2");
    wrap.classList.remove("pk-many");
    if (land) {
      // Left column from the bottom up, right column from the top down.
      // Very short screens (a sideways phone with the replay bar): two compact panels per row on each side
      const per = (wrap.clientHeight - 12 - (k - 1) * 6) / k;
      if (k >= 3 && per < 66) {
        fillSeats(a, A.slice().reverse(), "spec c4 dense", 2, false);
        fillSeats(b, B, "spec c4 dense", 2, false);
        return;
      }
      fillSeats(a, A.slice().reverse(), `spec col wide left k${k}`, 0, true);
      fillSeats(b, B, `spec col wide right k${k}`, 0, true);
      for (const box of [a, b]) box.style.setProperty("--k", k);
      return;
    }
    // Portrait: top row left → right, bottom row right → left. Tall screens use two wider columns with real cards
    const tall = wrap.clientHeight >= 680;
    const colsOf = c => (c <= 2 ? c : tall ? 2 : c);
    const ca = colsOf(A.length), cb = colsOf(B.length);
    const big = Math.max(ca, cb) <= 2;
    const cls = (c, cnt) => `spec c${Math.min(4, c)}${c === 1 ? " wide" : ""}${cnt > c ? " r2" : ""}${big ? " big" : ""}`;
    fillSeats(a, A, cls(ca, A.length), ca, big);
    fillSeats(b, B.slice().reverse(), cls(cb, B.length), cb, big);
  }

  /* Per-seat actions this hand (oldest → newest), with the street's first letter where the street changes */
  function histHTML(q) {
    const v = m.v;
    if (!v.log || !v.hand) return "";
    let h = "", prev = -1;
    for (const e of v.log) {
      if (e.p !== q) continue;
      const w = actWord(e.a) + (e.a === "fold" || e.a === "check" || e.a === "call" ? "" : " " + fmt(e.to));
      h += `<span class="pk-he" data-st="${e.st}">${e.st !== prev ? `<i>${shortSt(e.st)}</i>` : ""}<span class="${e.a}">${w}</span></span>`;
      prev = e.st;
    }
    return h;
  }
  /* If the history overflows the panel, drop the oldest entries first (the newest stays visible) */
  function fitHist() {
    for (const h of wrap.querySelectorAll(".pk-opps .pk-hist")) {
      let guard = 30;
      while (h.children.length > 1 && h.scrollWidth > h.clientWidth + 1 && guard--) {
        h.removeChild(h.firstElementChild);
        const f = h.firstElementChild;
        if (f && !f.querySelector("i")) f.insertAdjacentHTML("afterbegin", `<i>${shortSt(+f.dataset.st)}</i>`);
        h.classList.add("cut");
      }
    }
  }

  /* ---------- Middle: the felt ---------- */
  function renderTable() {
    const v = m.v, last = lastHere(v);
    wrap.classList.toggle("pk-ended", !!last);
    // Top line: hand · blinds · street
    let info = "";
    if (v.hand) {
      const k = v.nextUp ? v.nextUp - v.hand : 0;
      const handNo = v.limit ? L(`${v.hand}/${v.limit}판`, `Hand ${v.hand}/${v.limit}`) : L(`${v.hand}번째 판`, `Hand ${v.hand}`);
      const up = k > 0 ? (k === 1 ? L(" · 다음 판 ↑", " · ↑ next hand") : L(` · ${k}판 뒤 ↑`, ` · ↑ in ${k} hands`)) : "";
      info = `<span class="pk-lv">${handNo} · ${L("블라인드", "Blinds")} <b>${fmt(v.sb)}/${fmt(v.bb)}</b>${up}</span>`;
      if (v.phase === "bet" || v.phase === "deal") info += `<b class="pk-street">${streetName(v.street)}</b>`;
      if (v.last && !last) info += `<button class="pk-lastbtn" data-r="lastbtn">${L("지난 판", "Last hand")}</button>`;
    }
    R("info").innerHTML = info;
    const lb = R("lastbtn");
    if (lb) lb.onclick = () => showLast();

    // 5 board slots — gold for the winning hand when the hand is over, otherwise for the cards making my hand
    const board = R("board");
    const fresh = v.board.length - newBoard;
    let hl = null, dimRest = false;
    if (last && last.showdown && last.pots.length) {
      const w = last.pots[0].winners[0].p;
      hl = (last.shows.find(x => x.p === w) || {}).best || null;
      dimRest = true;
    } else if (!last && mine && mine.core && !mine.fold) hl = mine.core;
    let bh = "";
    for (let i = 0; i < 5; i++) {
      const c = v.board[i];
      if (!c) { bh += '<div class="pk-slot"></div>'; continue; }
      const cls = (i >= fresh ? "pk-new" : "") + (hl ? (hl.includes(c) ? " pk-hl" : dimRest ? " dim" : "") : "");
      bh += cardHTML(c, cls);
    }
    board.innerHTML = bh;
    board.querySelectorAll(".pk-new").forEach((x, i) => x.style.animationDelay = (i * 0.12) + "s");

    // Below: hand results, or the pot
    const mid = R("mid");
    if (last) { mid.innerHTML = resultHTML(last, L(`${last.hand}번째 판 결과`, `Hand ${last.hand} results`)); R("log").innerHTML = ""; return; }
    if (!v.hand) { mid.innerHTML = `<div class="pk-line">${L("카드를 섞는 중…", "Shuffling…")}</div>`; R("log").innerHTML = ""; return; }
    let h = `<div class="pk-pot"><span class="pk-chipico"></span>${L("팟", "Pot")} <b>${fmt(v.potTotal)}</b>` +
      (v.curBet > 0 && v.phase === "bet" ? `<span class="pk-cur">${L("현재 베팅", "Current bet")} ${fmt(v.curBet)}</span>` : "") + `</div>`;
    if (v.pots.length > 1) h += `<div class="pk-side">${v.pots.map((x, i) =>
      `${i ? L("사이드", "Side") + (v.pots.length > 2 ? " " + i : "") : L("메인", "Main")} <b>${fmt(x.amount)}</b>`).join(" · ")}</div>`;
    if (v.runout) h += `<div class="pk-runout">${L("올인! 남은 카드를 펼칩니다", "All-in! Dealing the rest of the board")}</div>`;
    mid.innerHTML = h;
    renderLog();
  }

  /* This hand's action log — newest first, with the street name where the street changes */
  function renderLog() {
    const v = m.v, box = R("log"), log = v.log || [];
    let h = "", prev = -1;
    const list = log.slice(-14).reverse();
    list.forEach((e, i) => {
      if (e.st !== prev) h += `<span class="pk-lgst">${streetName(e.st)}</span>`;
      prev = e.st;
      const w = actWord(e.a);
      const amtTxt = e.a === "fold" || e.a === "check" ? "" : ` ${fmt(e.to)}`;
      h += `<span class="pk-lg ${e.a}${i === 0 ? " new" : ""}${e.p === m.me ? " me" : ""}"><b>${esc(nameOf(e.p))}</b> ${w}${amtTxt}</span>`;
    });
    box.innerHTML = h;
  }

  function resultHTML(last, title) {
    const nm = names(), wins = winnersOf(last);
    let h = `<div class="pk-res"><div class="pk-rt">${esc(title)}</div>`;
    for (const pot of last.pots) {
      h += `<div class="pk-prow"><span class="pk-pl">${esc(loc(pot.label))} <b>${fmt(pot.amount)}</b></span><span class="pk-pw">` +
        pot.winners.map(w => `<span class="pk-wn">${avatarHTML(nm[w.p], w.p, "sm")}<b>${esc(nm[w.p])}</b> +${fmt(w.amount)}</span>`).join("") +
        (pot.hand ? `<em>${esc(loc(pot.hand))}${pot.winners.length > 1 ? L(" · 나눔", " · split") : ""}</em>` : "") + `</span></div>`;
    }
    if (last.shows.length) {
      h += '<div class="pk-shows">';
      for (const s of last.shows) {
        const won = wins.has(s.p);
        h += `<div class="pk-show${won ? " win" : ""}${s.p === m.me ? " me" : ""}">${avatarHTML(nm[s.p], s.p, "sm")}<span class="nm">${esc(nm[s.p])}</span>` +
          `<span class="pk-cards">${s.cards.map(c => cardHTML(c, "sm" + (won && s.best.includes(c) ? " pk-hl" : ""))).join("")}</span>` +
          `<span class="pk-hn">${esc(loc(s.hand))}</span></div>`;
      }
      h += "</div>";
    } else h += `<div class="pk-nosd">${L("모두 폴드 — 패를 보이지 않고 가져갑니다", "Everyone folded — pot taken without a showdown")}</div>`;
    if (last.bust.length) {
      const who = last.bust.map(q => esc(nm[q])).join(", ");
      h += `<div class="pk-bust">💥 ${L(`${who} 님 탈락`, `${who} ${last.bust.length > 1 ? "are" : "is"} out`)}</div>`;
    }
    return h + "</div>";
  }

  function showLast() {
    const last = m && m.v.last;
    if (!last) return;
    ctx.modal(box => {
      ctx.head(box, L("지난 판", "Last hand"), L(`${last.hand}번째 판 결과`, `Hand ${last.hand} results`), "");
      const b = el("div", "pk-board pk-mboard", last.board.map(c => cardHTML(c, "sm")).join("") || "");
      box.appendChild(b);
      box.appendChild(el("div", "pk-mres", resultHTML(last, "")));
    });
  }

  /* ---------- My hand analysis ---------- */
  function analyze() {
    const v = m.v, my = v.my;
    mine = null;
    if (!my || !my.hole || v.phase === "over") return;
    const s = v.seats[m.me];
    if (s.out || !s.inHand) return;
    const opps = liveOpps();
    const known = opps.filter(Boolean).flat();
    const r = { fold: s.fold, nOpp: opps.length, eq: null };
    if (v.board.length >= 3) {
      const mh = madeHand(my.hole, v.board);
      Object.assign(r, mh);
      r.draws = s.fold ? [] : drawsOf(my.hole, v.board, mh.k, known);
    } else {
      Object.assign(r, preDesc(my.hole), { core: null, pre: true });
      if (opps.length) {
        const a = C2I[my.hole[0]], b = C2I[my.hole[1]], no = Math.min(7, opps.length);
        r.top = Math.max(1, Math.round((1 - preflopPct(a, b, no)) * 100));
      }
    }
    // Rough win chance — not recomputed for the same situation (so the number doesn't jitter)
    if (!s.fold && opps.length && !lastHere(v)) {
      const key = `${v.hand}|${my.hole}|${v.board}|${opps.map(o => (o ? o.join("") : "?")).join(",")}`;
      if (eqCache.key !== key) {
        let eq;
        if (v.board.length === 0 && !known.length) eq = preflopEq(C2I[my.hole[0]], C2I[my.hole[1]], Math.min(7, opps.length));
        else eq = equityMC(my.hole, v.board, opps, 300);
        eqCache = { key, val: eq };
      }
      r.eq = eqCache.val;
    }
    mine = r;
  }

  /* ---------- Bottom: my hand ---------- */
  function renderMe() {
    const v = m.v, my = v.my, box = R("me");
    if (!my) { box.innerHTML = ""; return; }
    const s = v.seats[m.me], last = lastHere(v), wins = winnersOf(last);
    const shown = last && last.shows.find(x => x.p === m.me);
    const core = !last && mine && mine.core ? mine.core : null;
    let cards;
    if (my.hole) cards = my.hole.map(c => cardHTML(c, (s.fold ? "dim" : "") +
      ((shown && wins.has(m.me) && shown.best.includes(c)) || (core && !s.fold && core.includes(c)) ? " pk-hl" : ""))).join("");
    else cards = `<div class="pk-nohole">${s.out ? L("탈락", "Out") : v.phase === "over" ? "" : L("다음 판부터", "From the next hand")}</div>`;
    // Current hand · draws
    let made = "", sub = "";
    if (s.out) made = "";
    else if (s.fold && my.hole) made = `<span class="pk-folded">${L("폴드", "Folded")}</span>`;
    else if (shown) made = `<span class="pk-mk">${L("결과", "Result")}</span><b class="${wins.has(m.me) ? "pk-good" : ""}">${esc(loc(shown.hand))}</b>`;
    else if (last) made = wins.has(m.me) ? `<b class="pk-good">${L("이겼습니다", "You won")}</b>` : "";
    else if (mine) {
      made = `<span class="pk-mk">${mine.pre ? L("내 패", "Hand") : L("현재", "Now")}</span><b>${esc(mine.name)}</b>${mine.detail ? `<span class="pk-dt">(${mine.detail})</span>` : ""}`;
      if (mine.pre && mine.top) {
        const topHalf = mine.top <= 50, p = topHalf ? mine.top : 100 - mine.top + 1, n = mine.nOpp;
        sub = L(`시작 패 순위 ${topHalf ? "상위" : "하위"} <b>${p}%</b> (상대 ${n}명 기준)`,
          `Starting hand: ${topHalf ? "top" : "bottom"} <b>${p}%</b> (vs ${n} opponent${n > 1 ? "s" : ""})`);
      } else if (mine.onBoard) sub = L("공용 카드로 된 패 — 다른 사람도 같이 가집니다", "Made on the board — everyone shares it");
      if (mine.draws && mine.draws.length) sub = (sub ? sub + " · " : "") + L("다음 카드로 ", "Outs: ") +
        mine.draws.map(d => `${d.name} <b>${L(d.n + "장", String(d.n))}</b>`).join(" · ");
    }
    const delta = last ? last.delta[m.me] : 0;
    box.innerHTML = `<div class="pk-hole">${cards}</div>
      <div class="pk-mine">
        <div class="pk-mystk"><b>${fmt(my.chips)}</b><small>${L("칩", "chips")}</small>${badges(m.me)}${delta ? `<span class="pk-delta ${delta > 0 ? "up" : "down"}">${delta > 0 ? "+" : ""}${fmt(delta)}</span>` : ""}</div>
        <div class="pk-mysub">${my.bet ? `<span>${L("베팅", "Bet")} <b class="pk-bet" data-bq="${m.me}">${fmt(my.bet)}</b></span>` : ""}${my.put && !last ? `<span>${L("이번 판", "This hand")} ${fmt(my.put)}</span>` : ""}${s.allin && !s.fold && !last ? `<span class="pk-ab allin">${L("올인", "All-in")}</span>` : ""}</div>
        <div class="pk-made">${made}</div>
        ${sub ? `<div class="pk-draw">${sub}</div>` : ""}
      </div>`;
  }

  /* ---------- Calc row: call · pot after call · pot odds · rough win chance ---------- */
  function renderCalc() {
    const v = m.v, my = v.my, box = R("calc");
    const s = my ? v.seats[m.me] : null;
    const on = my && s && mine && !s.fold && !s.out && (v.phase === "bet" || v.phase === "deal");
    box.hidden = !on;
    if (!on) { box.innerHTML = ""; return; }
    const toCall = s.allin ? 0 : my.toCall, callAmt = s.allin ? 0 : my.callAmt;
    const after = v.potTotal + callAmt, odds = callAmt > 0 ? callAmt / after : 0;
    const cell = (k, val, cls = "", extra = "") => `<div class="pk-cc ${cls}"${extra}><small>${k}</small><b>${val}</b></div>`;
    let h = "";
    if (s.allin) h += cell(L("내 상태", "Status"), L("올인", "All-in"), "allin");
    else h += toCall > 0 ? cell(L("콜", "Call"), fmt(callAmt), "call") : cell(L("콜", "Call"), L("0 · 체크", "0 · check"), "free");
    h += cell(toCall > 0 ? L("콜 후 팟", "Pot if called") : L("팟", "Pot"), fmt(after));
    h += cell(L("팟 오즈", "Pot odds"), toCall > 0 ? pct(odds) : "—", "", toCall > 0 ? ` title="${L("콜 금액 ÷ 콜 후 팟", "Call ÷ pot after calling")}"` : "");
    let eqTxt = L("보기 ▸", "Show ▸"), cls = "eq off";
    if (showEq && mine.eq !== null) {
      eqTxt = pct(mine.eq);
      cls = "eq" + (toCall > 0 ? (mine.eq >= odds ? " good" : " bad") : "");
    } else if (showEq) eqTxt = "—";
    h += `<button class="pk-cc ${cls}" data-r="eqbtn" aria-pressed="${showEq}" title="${L("대략적인 승률", "Rough win chance")}">` +
      `<small>${L("대략적인 승률", "Rough win %")}</small><b>${eqTxt}</b></button>`;
    box.innerHTML = h;
    R("eqbtn").onclick = () => { showEq = !showEq; LSset(EQ_KEY, showEq ? "1" : "0"); renderCalc(); };
  }

  /* ---------- Action buttons · hint ---------- */
  function renderActions() {
    const v = m.v, my = v.my, ask = myAsk();
    const s = my ? v.seats[m.me] : null;
    const kinds = ask && my ? my.kinds : [];
    if (!ask) panel = false;                 // nothing to decide (a replay, or the turn moved on): never leave the raise panel open
    R("dock").classList.toggle("pk-act", !!ask);
    wrap.classList.toggle("pk-raising", panel);
    R("acts").hidden = panel || !!m.replay;   // a replay only shows the table, never buttons
    R("raise").hidden = !panel;
    const fold = R("fold"), call = R("call"), raise = R("raiseBtn");
    const toCall = my ? my.toCall : 0, callAmt = my ? my.callAmt : 0;
    const callAll = my && toCall > 0 && callAmt >= my.chips && my.chips > 0;
    fold.textContent = armed === "fold" ? L("정말 폴드?", "Really fold?") : L("폴드", "Fold");
    fold.classList.toggle("danger", armed === "fold");
    call.textContent = toCall > 0
      ? (callAll ? (armed === "call" ? L("올인 콜 확인", "Confirm all-in") : L(`올인 콜 ${fmt(callAmt)}`, `All-in ${fmt(callAmt)}`)) : L(`콜 ${fmt(callAmt)}`, `Call ${fmt(callAmt)}`))
      : L("체크", "Check");
    call.classList.toggle("danger", armed === "call");
    raise.textContent = ask && my && my.canRaise && my.minTo >= my.maxTo ? L("올인", "All-in") : v.phase === "bet" && v.curBet === 0 ? L("벳", "Bet") : L("레이즈", "Raise");
    fold.disabled = !kinds.includes("fold");
    call.disabled = !(kinds.includes("call") || kinds.includes("check"));
    raise.disabled = !kinds.includes("raise");

    let hint;
    const whoseTurn = () => {
      const who = `<b>${esc(names()[v.turn])}</b>`, t = `<span class="pk-tm" data-tm="${v.turn}"></span>`;
      return L(`${who} 님 차례 ${t}`, `${who}'s turn ${t}`);
    };
    if (v.phase === "over") hint = L("게임 끝", "Game over");
    else if (!my || !s || s.out) hint = s && s.out ? L("탈락했습니다 — 끝까지 구경할 수 있어요", "You're out — you can watch until the end") : L("구경 중", "Watching");
    else if (v.phase === "start") hint = L("카드를 섞는 중…", "Shuffling…");
    else if (v.phase === "end") hint = L("다음 판을 준비하는 중…", "Getting the next hand ready…");
    else if (ask) {
      const t = `<span class="pk-tm" data-tm="${m.me}"></span>`;
      const open = v.curBet === 0;
      hint = toCall > 0 ? L(`<b>내 차례</b> — 콜 ${fmt(callAmt)} · 레이즈 · 폴드 ${t}`, `<b>Your turn</b> — call ${fmt(callAmt)}, raise or fold ${t}`)
        : L(`<b>내 차례</b> — 체크하거나 ${open ? "벳" : "레이즈"}하세요 ${t}`, `<b>Your turn</b> — check or ${open ? "bet" : "raise"} ${t}`);
    } else if (m.replay && v.turn >= 0) hint = whoseTurn();      // replays: say whose turn it is, never "your turn"
    else if (s.fold) hint = L("폴드했습니다 — 이번 판은 구경", "You folded — watching this hand");
    else if (s.allin) hint = L("올인! 결과를 기다리는 중", "All-in! Waiting for the result");
    else if (v.turn >= 0) hint = whoseTurn();
    else hint = v.runout ? L("올인 — 남은 카드를 펼치는 중", "All-in — dealing the rest of the board") : L("다음 카드를 펼치는 중", "Dealing the next card");
    R("hint").innerHTML = hint;
    if (panel) renderPanel();
  }

  /* ---------- Raise panel ---------- */
  function quick() {
    const v = m.v, my = v.my, potAfter = v.potTotal + my.callAmt;
    const clamp = x => Math.max(my.minTo, Math.min(my.maxTo, Math.round(x / v.sb) * v.sb));
    return [[L("최소", "Min"), my.minTo], [L("½ 팟", "½ pot"), clamp(v.curBet + potAfter / 2)], [L("팟", "Pot"), clamp(v.curBet + potAfter)],
      [L("올인", "All-in"), my.maxTo]];
  }
  function setAmt(x) {
    const v = m.v, my = v.my;
    if (x >= my.maxTo) amt = my.maxTo;
    else amt = Math.max(my.minTo, Math.min(my.maxTo, x));
    renderPanel();
  }
  /* Raise size = (total − current bet) ÷ pot after call. The ½ pot button is 50% */
  const potShare = x => { const v = m.v, my = v.my, base = v.potTotal + my.callAmt; return base > 0 ? (x - v.curBet) / base : 0; };
  function renderPanel() {
    const v = m.v, my = v.my;
    if (!my) return;
    const sl = R("slider");
    sl.min = my.minTo; sl.max = my.maxTo; sl.step = 1; sl.value = amt;
    sl.disabled = my.minTo >= my.maxTo;
    const all = amt >= my.maxTo, open = v.curBet === 0, word = open ? L("벳", "Bet") : L("레이즈", "Raise");
    const add = amt - my.bet;
    R("rlabel").innerHTML = all ? L("올인 <small>가진 칩 전부 · 이번 거리 총액</small>", "All-in <small>all your chips · street total</small>")
      : `${word} <small>${L("이번 거리 총액", "street total")}</small>`;
    R("ramt").textContent = fmt(amt);
    const a = fmt(add), share = Math.round(potShare(amt) * 100), potThen = fmt(v.potTotal + add), left = fmt(my.chips - add);
    R("rinfo").innerHTML = L(`칩 <b>${a}</b> 더 냄 · 팟의 <b>${share}%</b> · 낸 뒤 팟 <b>${potThen}</b> · 남는 칩 <b>${left}</b>`,
      `Adds <b>${a}</b> · <b>${share}%</b> of pot · pot then <b>${potThen}</b> · <b>${left}</b> left`);
    const ok = R("rok");
    ok.textContent = all ? L(`올인 ${fmt(amt)} 확인`, `All-in ${fmt(amt)} ✓`) : L(`${word} ${fmt(amt)} 확인`, `${open ? "Bet" : "Raise to"} ${fmt(amt)} ✓`);
    ok.classList.toggle("pk-allok", all);
    const q = R("quick");
    q.innerHTML = "";
    for (const [t, x] of quick()) {
      const b = el("button", "pk-qb" + (x === amt ? " on" : ""), `${t}<small>${fmt(x)}</small>`);
      b.onclick = () => setAmt(x);
      q.appendChild(b);
    }
  }
  R("slider").addEventListener("input", e => {
    const v = m.v, my = v.my;
    let x = +e.target.value;
    if (x < my.maxTo) x = Math.round(x / v.sb) * v.sb;
    setAmt(Math.max(my.minTo, x));
  });
  R("minus").onclick = () => setAmt(amt - m.v.bb);
  R("plus").onclick = () => setAmt(amt + m.v.bb);
  R("rcancel").onclick = () => { panel = false; renderActions(); };
  R("rok").onclick = () => {
    const my = m && m.v.my;
    if (!my || !myAsk()) return;
    send(amt >= my.maxTo ? { a: "allin" } : { a: "raise", to: amt });
  };

  function arm(k) {
    armed = k;
    clearTimeout(armT);
    armT = setTimeout(() => { armed = ""; if (m) renderActions(); }, 2500);
    ctx.buzz(20);
    renderActions();
  }
  function send(a) {
    if (!ctx.send(a)) return;
    busy = true; panel = false; armed = "";
    clearTimeout(busyT);
    busyT = setTimeout(() => { busy = false; if (m) renderActions(); }, 1500);   // if rejected, allow pressing again
    if (a.a === "fold") ctx.sound.pass(); else if (a.a === "check") ctx.sound.tick(); else ctx.sound.chip();
    renderActions();
  }
  R("fold").onclick = () => {
    const my = m && m.v.my;
    if (!my || !myAsk()) return;
    if (my.toCall === 0 && armed !== "fold") return arm("fold");      // folding when checking is free?
    send({ a: "fold" });
  };
  R("call").onclick = () => {
    const my = m && m.v.my;
    if (!my || !myAsk()) return;
    if (my.toCall === 0) return send({ a: "check" });
    if (my.callAmt >= my.chips && armed !== "call") return arm("call");  // an all-in call needs a second tap
    send({ a: "call" });
  };
  R("raiseBtn").onclick = () => {
    const my = m && m.v.my;
    if (!my || !myAsk() || !my.canRaise) return;
    panel = true; armed = "";
    amt = my.minTo;
    renderActions();
  };

  /* ---------- Sound ---------- */
  function sounds(evs) {
    let chip = false, deal = false, flip = false, pass = false, tick = false, good = false, bad = false;
    for (const e of evs) {
      if (e.type === "act") {
        if (e.p === m.me && !m.replay) continue;        // my own action already made its sound on tap
        if (e.a === "fold") pass = true; else if (e.a === "check") tick = true; else chip = true;
      } else if (e.type === "hand") deal = true;
      else if (e.type === "street" || e.type === "reveal" || e.type === "show") flip = true;
      else if (e.type === "win") { if (e.p === m.me) good = true; else chip = true; }
      else if (e.type === "bust" && e.p === m.me) bad = true;
      else if (e.type === "refund") chip = true;
    }
    if (bad) { ctx.sound.bad(); ctx.buzz(120); }
    else if (good) ctx.sound.good();
    else if (flip) ctx.sound.flip();
    else if (chip) ctx.sound.chip();
    else if (pass) ctx.sound.pass();
    else if (tick) ctx.sound.tick();
    if (deal) { ctx.sound.deal(); setTimeout(() => ctx.sound.deal(), 130); setTimeout(() => ctx.sound.deal(), 260); }
  }

  /* ---------- Flying chips and cards ----------
     snap() saves where the pot and the bet chips were before redrawing; flights() then moves copies from there:
     a bet from the seat to its bet chip (or straight into the pot when the street closed), bets left on the table into the pot,
     the pot to the winners, and the hole cards from the middle of the felt to every seat. */
  const shown = x => x && x.isConnected && x.getClientRects().length && x.offsetWidth > 0;
  const first = (...xs) => xs.find(shown) || null;
  const rectOf = x => (shown(x) ? x.getBoundingClientRect() : null);
  function parts(q) {
    if (!spec && q === m.me) {
      const me = R("me");
      const stk = me.querySelector(".pk-mystk > b");
      return { src: stk, bet: me.querySelector(".pk-mysub .pk-bet"), won: first(me.querySelector(".pk-delta.up"), stk), cards: [...me.querySelectorAll(".pk-hole .pc")] };
    }
    const d = wrap.querySelector(`.pk-seat[data-q="${q}"]`);
    if (!d) return null;
    const stk = d.querySelector(".pk-stk");
    return { src: first(d.querySelector(".av"), stk, d), bet: d.querySelector(".pk-bet"), won: first(d.querySelector(".pk-dl.up"), stk), cards: [...d.querySelectorAll(".pk-hc > *")] };
  }
  function snap() {
    const bets = {};
    for (const b of wrap.querySelectorAll("[data-bq]")) { const r = rectOf(b); if (r) bets[b.dataset.bq] = r; }
    return { pot: rectOf(wrap.querySelector(".pk-chipico")), board: rectOf(R("board")), bets };
  }
  function flights(evs, before) {
    const v = m.v, n = v.seats.length;
    const pot = wrap.querySelector(".pk-chipico");
    let t = 0;
    if (evs.some(e => e.type === "hand")) {
      // Hole cards: two rounds from the small blind, one card at a time
      const board = R("board");
      let i = 0;
      for (let k = 0; k < 2; k++) for (let j = 0; j < n; j++) {
        const q = (Math.max(0, v.sbSeat) + j) % n;
        if (!v.seats[q].inHand) continue;
        const p = parts(q), c = p && p.cards[k];
        if (c && shown(c)) fly(board, c, { ms: 300, delay: i * 45, spin: k ? 8 : -8 });
        i++;
      }
      t = i * 45 + 200;
      // then the blinds go out
      for (const q of [v.sbSeat, v.bbSeat]) {
        const p = q >= 0 ? parts(q) : null;
        if (p && p.src && shown(p.bet)) fly(p.src, p.bet, { ms: 380, delay: t });
      }
    }
    const ended = evs.some(e => e.type === "win");
    for (const e of evs) {
      if (e.type !== "act" || !(e.amount > 0)) continue;
      const p = parts(e.p);
      if (!p || !p.src) continue;
      if (shown(p.bet)) fly(p.src, p.bet, { ms: 380 });
      else if (shown(pot)) fly(p.src, pot, { ms: 420 });
    }
    // The street closed: chips still in front of the players slide into the pot
    if (before && !ended && shown(pot) && v.seats.every(s => !s.bet)) {
      let k = 0;
      for (const q of Object.keys(before.bets)) fly(before.bets[q], pot, { ms: 420, delay: 120 + 60 * k++, scale: 1 });
    }
    // The hand is over: the pot goes to the winner(s)
    if (ended) {
      const from = (before && before.pot) || R("board");
      let k = 0;
      const seen = new Set();
      for (const e of evs) {
        if (e.type !== "win" || seen.has(e.p)) continue;
        seen.add(e.p);
        const p = parts(e.p);
        if (p && p.won) fly(from, p.won, { ms: 520, delay: 200 + 160 * k++, scale: 1.3 });
      }
    }
  }

  /* Time left for the player to act — text (⏱ 12s) and a bar under their panel */
  function startTick() {
    clearInterval(tickT);
    const v = m.v;
    if (v.turn < 0) return;
    const pe = (m.pending || []).find(a => a.p === v.turn);
    const end = pe && pe.ms > 0 ? Date.now() + pe.ms : 0;
    const total = pe && (pe.total || (m.settings && m.settings.timer ? m.settings.timer * 1000 : 0));
    const paint = () => {
      const left = end ? Math.max(0, end - Date.now()) : 0, s = Math.ceil(left / 1000);
      for (const t of wrap.querySelectorAll(`[data-tm="${v.turn}"]`)) {
        if (!end) { t.textContent = v.turn === m.me && !spec ? "" : L("생각 중…", "Thinking…"); continue; }
        t.textContent = L(`⏱ ${s}초`, `⏱ ${s}s`);
        t.classList.toggle("low", s <= 5);
      }
      for (const b of wrap.querySelectorAll(`[data-tb="${v.turn}"]`)) {
        b.style.width = end && total ? `${Math.min(100, 100 * left / total)}%` : "100%";
        b.classList.toggle("low", !!end && s <= 5);
        b.classList.toggle("think", !end);
      }
    };
    paint();
    if (end) tickT = setInterval(paint, 250);
  }

  function render() {
    spec = m.me < 0 || !m.v.seats[m.me];
    land = !!(mq && mq.matches);
    wrap.classList.toggle("pk-spec", spec);
    wrap.classList.toggle("pk-bigfelt", spec || land);     // the felt's text scales with the felt (style.css)
    R("dock").hidden = spec;
    R("opps2").hidden = !spec;
    analyze();
    if (spec) renderRing(); else renderOpps();
    fitHist();
    renderTable();
    if (!spec) { renderMe(); renderCalc(); renderActions(); }
    startTick();
  }

  function update(msg) {
    const evs = msg.ev && msg.ev !== lastEv ? msg.ev : [];   // the same msg again: draw it, but no sounds or flights
    lastEv = msg.ev;
    const before = evs.length && m ? snap() : null;
    m = msg;
    const ask = ctx.myAsk("bet");
    const id = ask && !msg.replay ? ask.id : 0;
    if (id !== askId) { askId = id; panel = false; armed = ""; busy = false; clearTimeout(busyT); }
    newBoard = 0;
    flips = new Set();
    for (const e of evs) {
      if (e.type === "street" && e.cards) newBoard += e.cards.length;
      else if (e.type === "reveal" && e.shows) for (const x of e.shows) flips.add(x.p);
      else if (e.type === "show") flips.add(e.p);
    }
    newBoard = Math.min(newBoard, msg.v.board.length);
    sounds(evs);
    render();
    if (evs.length) flights(evs, before);
    newBoard = 0; flips = new Set();          // re-renders (resize) don't animate again
  }

  /* Rotating the phone or resizing the window switches between the portrait and sideways layouts */
  function onResize() {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (m) render(); }, 60);
  }
  window.addEventListener("resize", onResize);
  if (mq) { if (mq.addEventListener) mq.addEventListener("change", onResize); else if (mq.addListener) mq.addListener(onResize); }

  return {
    update,
    ticker: false,               // the felt shows this hand's log itself, so hide the one-line ticker
    landscape: true,             // has its own sideways layout (style.css)
    destroy() {
      clearInterval(tickT); clearTimeout(busyT); clearTimeout(armT); clearTimeout(resizeT);
      window.removeEventListener("resize", onResize);
      if (mq) { if (mq.removeEventListener) mq.removeEventListener("change", onResize); else if (mq.removeListener) mq.removeListener(onResize); }
      root.innerHTML = "";
    }
  };
}
