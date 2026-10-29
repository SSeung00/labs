/* Dalmuti screen — designed for portrait phones.
   Top: name-chip grid (turn order) — title crest · cards left · score · last action in this trick (small cards) · pass · finishing place
   Middle (felt): the current trick's cards (large) · who played them · what it takes to beat them · this trick's record
                  (cleared when the trick ends — fair-play rule). Seat draw, tax and round results are shown in the same spot.
   Bottom: one line with my title · score · rank / hint / my hand grouped by number / [Pass] · chosen set (adjust count) · [Play]
   The revolution question and choosing cards to give back open as dialogs for that player only.
   Sizes are derived from the measured screen height (no dead space).
   Landscape (phones held sideways, computers, TVs): name chips in a column on the left, the table in the middle,
   my line · hint · hand · buttons in a column on the right.
   Spectators (me = -1: watching screens, people waiting, the public replay view): no dock — the table takes the space.
   Replays: nothing prompts (no dialogs, no buttons, no "your turn"). */
import { L } from "../../core/i18n.js";
import { JESTER, cardName, RANK_COLOR, GLYPH, dmCardHTML } from "./cards.js";

/* Same query as the shell's landscape rules (games/README.md) */
const LAND_Q = "(orientation: landscape) and (min-aspect-ratio: 4/3)";

const TITLE_KO = ["평민", "대달무티", "소달무티", "상인", "소농노", "대농노"];
const TITLE_EN = ["Commoner", "Greater Dalmuti", "Lesser Dalmuti", "Merchant", "Lesser Peon", "Greater Peon"];
const titleName = t => L(TITLE_KO[t], TITLE_EN[t]);
const SHORT_KO = ["평민", "대달", "소달", "상인", "소농", "대농"];
const SHORT_EN = ["Comm.", "G.Dal", "L.Dal", "Merch.", "L.Peon", "G.Peon"];
const titleShort = t => L(SHORT_KO[t], SHORT_EN[t]);
/* Score-table cells: two-letter codes in English (explained in the dialog text) */
const CODE_EN = ["", "GD", "LD", "M", "LP", "GP"];
const titleCode2 = t => L(SHORT_KO[t], CODE_EN[t]);
const TITLE_COLOR = ["#a39784", "#e2bd68", "#c3ccd8", "#9cc39a", "#c48c68", "#b5525c"];
const CREST = { 0: GLYPH[11], 1: GLYPH[1], 2: GLYPH[2], 3: GLYPH[8], 4: GLYPH[11], 5: GLYPH[12] };
/* Title code (same as titleCode in rules.js) */
function titleCode(i, n) {
  if (i === 0) return 1;
  if (i === 1) return 2;
  if (i === n - 1) return 5;
  if (n > 3 && i === n - 2) return 4;
  return 3;
}
const label = r => r === JESTER ? L("광대", "Jester") : L(`${cardName(r)}(${r})`, `${cardName(r)} (${r})`);
/* English helpers: "3 cards", "1 Jester", "2nd" */
const cardsEn = n => `${n} card${n === 1 ? "" : "s"}`;
const jestersEn = n => `${n} Jester${n === 1 ? "" : "s"}`;
const ord = n => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
/* Place label in the viewer's language (e.g. "2nd") */
const placeL = k => L(`${k}위`, ord(k));

export function mount(root, ctx) {
  const { el, esc } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "dm");
  wrap.innerHTML = `
    <div class="dm-seats" data-r="seats"></div>
    <div class="dm-table felt" data-r="table">
      <div class="dm-call" data-r="call" aria-live="polite"></div>
      <div class="dm-center" data-r="center"></div>
      <div class="dm-log" data-r="log"></div>
      <div class="dm-banner" data-r="banner" hidden></div>
      <div class="dm-passfx" data-r="passfx" hidden></div>
    </div>
    <div class="dock dm-dock" data-r="dock">
      <button class="dm-me" data-r="me" aria-label="${L("점수표 보기", "Show scores")}"></button>
      <div class="hint" data-r="hint"></div>
      <div class="dm-hand" data-r="hand"></div>
      <div class="dm-acts">
        <button class="btn dm-pass" data-r="pass">${L("패스", "Pass")}</button>
        <div class="dm-sel" data-r="sel"></div>
        <button class="btn primary dm-play" data-r="play" disabled>${L("내기", "Play")}</button>
      </div>
    </div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);

  let M = null;                 // last msg
  let sel = null;               // chosen set {rank, plain, jesters}
  let selAsk = 0;               // ask id the set was chosen for (cleared when the turn changes)
  let busyAsk = 0, busyUntil = 0, busyT = 0;
  let flashText = "", flashT = 0;
  let hot = new Set();          // players who just played — their name chips flash gold
  let hotPass = new Set();      // players who just passed — their chips give a small grey nod instead
  let passT = 0;
  let dealIn = false;           // cards were just dealt — hand entry animation
  let modalAsk = 0, modalClose = null, modalKind = "";
  let bannerT = 0, callText = "", callKind = "";   // callKind "trick": message to clear on the next play
  let geo = { cw: 52, rows: 1 };
  let landed = "";              // last trick whose landing animation was shown — not repeated on re-render
  let flyNow = false;           // this update flies the played cards in (instead of the landing animation)
  let sentFrom = null;          // where my last play left my hand {at, r: DOMRect, j: DOMRect} — start of its flight
  let evSeen = null;            // events already handled (update may be called again with the same msg)
  const landMQ = typeof matchMedia === "function" ? matchMedia(LAND_Q) : { matches: false };

  const names = () => (M ? M.players.map(p => p.name) : []);
  const nm = p => esc(names()[p] || "?");
  const myPlayAsk = () => (M && M.v.phase === "play" ? ctx.myAsk("play") : null);
  const watching = () => !!M && M.me < 0;                 // spectator: nothing to act on
  const replaying = () => !!(M && M.replay) || !!ctx.replay;
  const land = () => landMQ.matches;
  const busy = () => { const a = ctx.myAsk(); return !!a && a.id === busyAsk && Date.now() < busyUntil; };
  function markBusy() {
    const a = ctx.myAsk();
    busyAsk = a ? a.id : 0; busyUntil = Date.now() + 1800;
    clearTimeout(busyT); busyT = setTimeout(render, 1900);
  }

  /* ---------- Drawing cards ---------- */
  const cardHTML = (r, cls = "") => dmCardHTML(r, cls);
  const pip = r => `<i class="dm-pip" style="--rc:${RANK_COLOR[r]}">${r === JESTER ? "J" : r}</i>`;
  function pips(rank, plain, jesters, max = 4) {
    let s = "";
    const shown = Math.min(plain, max);
    for (let i = 0; i < shown; i++) s += pip(rank);
    if (plain > shown) s += `<i class="dm-pip more">+${plain - shown}</i>`;
    for (let i = 0; i < jesters; i++) s += pip(JESTER);
    return `<span class="dm-pips">${s}</span>`;
  }
  const crest = t => `<span class="dm-crest" style="--tc:${TITLE_COLOR[t]}"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${CREST[t]}</svg></span>`;
  const playText = (rank, plain, jesters) => rank === JESTER
    ? L(`광대 ${jesters}장`, jestersEn(jesters))
    : `${rank} ${cardName(rank)} ×${plain}${jesters ? L(` + 광대 ${jesters}`, ` + ${jestersEn(jesters)}`) : ""}`;

  /* ---------- What can be played ---------- */
  function groups(v) {
    const out = [];
    for (let r = 1; r <= 13; r++) if (v.hand[r] > 0) out.push(r);
    return out;
  }
  /* State of the number-r group: {can, why} — when leading anything goes; when following r < trick number and enough cards
     (Jesters included). why: "jlead" | "same" | "high" | "short" */
  function groupState(v, r) {
    const h = v.hand, J = h[JESTER], t = v.trick;
    if (!t) return { can: true };
    if (r === JESTER) return J ? { can: anyPlayable(v), why: "jlead", aux: true } : { can: false };
    if (r >= t.rank) return { can: false, why: r === t.rank ? "same" : "high" };
    if (h[r] + J < t.count) return { can: false, why: "short" };
    return { can: true };
  }
  const whyLabel = w => ({
    jlead: L("광대만은 선일 때만", "Lead only"), same: L("같음", "Same"), high: L("높음", "Higher"), short: L("부족", "Too few")
  })[w] || "";
  function anyPlayable(v) {
    if (!v.trick) return true;
    const J = v.hand[JESTER];
    for (let r = 1; r < v.trick.rank && r <= 12; r++) if (v.hand[r] && v.hand[r] + J >= v.trick.count) return true;
    return false;
  }
  function legalSel(v, s) {
    if (!s) return false;
    const h = v.hand, t = v.trick;
    if (s.rank === JESTER) return !t && s.plain === 0 && s.jesters >= 1 && s.jesters <= h[JESTER];
    if (s.plain < 1 || s.plain > h[s.rank] || s.jesters < 0 || s.jesters > h[JESTER]) return false;
    if (!t) return true;
    return s.plain + s.jesters === t.count && s.rank < t.rank;
  }
  function whySel(v, s) {
    const t = v.trick, need = t ? t.count : 0;
    if (s.rank === JESTER) return L("광대만으로는 선일 때만 낼 수 있습니다", "Jesters alone can only be played when leading");
    if (t && s.rank >= t.rank) return L(`${t.rank}보다 낮은 숫자여야 합니다`, `Must be lower than ${t.rank}`);
    if (t && s.plain + s.jesters < need) {
      const k = need - s.plain - s.jesters;
      return L(`${need}장이 필요합니다 — 광대 ${k}장을 더하세요 (광대 묶음을 누르기)`, `Need ${cardsEn(need)} — add ${jestersEn(k)} (tap the Jester)`);
    }
    if (t && s.plain + s.jesters > need) return L(`${need}장만 낼 수 있습니다 — 장수를 줄이세요`, `Only ${cardsEn(need)} allowed — use fewer`);
    return L("낼 수 없는 조합입니다", "That set can't be played");
  }
  /* The set first chosen when number r is tapped */
  function defaultSel(v, r) {
    const h = v.hand, J = h[JESTER], t = v.trick;
    if (r === JESTER) return { rank: JESTER, plain: 0, jesters: J };
    if (!t) return { rank: r, plain: h[r], jesters: 0 };
    const plain = Math.min(h[r], t.count);
    const jesters = v.assist ? Math.min(J, t.count - plain) : 0;
    return { rank: r, plain, jesters };
  }

  /* ---------- Top: name chips ---------- */
  function seats() {
    const v = M.v, box = R("seats"), n = v.n;
    const cols = n <= 4 ? n : Math.ceil(n / 2);
    box.style.setProperty("--cols", cols);
    const order = v.seats;
    const drawn = v.draw && (v.phase === "deal" || v.phase === "draw") ? new Map(v.draw.draws.map(d => [d.p, d.rank])) : null;
    box.innerHTML = "";
    for (const p of order) {
      const pl = M.players[p] || { name: "?" }, t = v.titles[p], place = v.finish.indexOf(p);
      const turn = v.turn === p, out = place >= 0 && v.phase === "play";
      const la = v.phase === "play" ? v.lastAct[p] : null;
      let act = "";
      if (drawn && drawn.has(p)) act = `<span class="dm-drew">${L("뽑음", "Drew")} ${pip(drawn.get(p))}</span>`;
      else if (v.phase === "roundEnd" || v.phase === "over") act = place >= 0 ? `<span class="dm-place">${placeL(place + 1)} +${v.n - place}</span>` : "";
      else if (place >= 0) act = `<span class="dm-place">${placeL(place + 1)} ✓</span>`;
      else if (turn) act = `<span class="dm-think">${L("고민 중", "Thinking")}<b>…</b></span>`;
      else if (la && la.pass && v.passed[p]) act = `<span class="dm-passed">${v.passLock ? L("패스 · 이번 판 끝", "Passed · out") : L("패스", "Pass")}</span>`;
      else if (la && !la.pass) act = pips(la.rank, la.count - la.jesters, la.jesters, 3);
      else if (v.phase === "tax" && v.tax) {
        const x = v.tax.pairs.find(q => q.peon === p || q.lord === p);
        if (x) act = `<span class="dm-taxm">${x.peon === p ? L(`상납 ${x.k}`, `Pays ${x.k}`) : L(`받음 ${x.k}`, `Gets ${x.k}`)}</span>`;
      }
      const sat = v.passLock && v.phase === "play" && v.trick && v.passed[p] && !out;     // pass lock: sits out this trick
      const chip = el("div", "dm-seat" + (turn ? " turn" : "") + (p === M.me ? " me" : "") + (out ? " out" : "") + (sat ? " sat" : "") +
        (hot.has(p) ? " hot" : "") + (hotPass.has(p) ? " hotpass" : ""));
      chip.style.setProperty("--tc", TITLE_COLOR[t]);
      const tag = pl.kind === "ai" ? '<span class="dm-tag">AI</span>' : pl.kind === "away" ? `<span class="dm-tag away">${L("비움", "Away")}</span>` : "";
      const rev = v.reveal && v.reveal.p === p ? `<span class="dm-tag rev">${L("광대2", "J×2")}</span>` : "";
      chip.innerHTML =
        `<div class="l1">${crest(t)}<span class="nm">${esc(pl.name)}</span><span class="cnt" title="${L("남은 카드", "Cards left")}">${v.sizes[p]}</span></div>` +
        `<div class="l2"><span class="ti"><span class="tn">${titleShort(t)}</span><span class="tf">${titleName(t)}</span>${tag}${rev}</span><span class="sc">${L(`${v.scores[p]}점`, `${v.scores[p]}pt`)}</span></div>` +
        `<div class="l3">${act}</div>`;
      chip.setAttribute("aria-label", L(`${pl.name} ${titleName(t)}, 카드 ${v.sizes[p]}장, ${v.scores[p]}점`,
        `${pl.name}, ${titleName(t)}, ${cardsEn(v.sizes[p])}, ${v.scores[p]} points`));
      chip.dataset.p = p;
      box.appendChild(chip);
    }
    // Landscape: one column of full chips; if they don't fit the height, compact two-line chips,
    // then two columns of full chips, then two columns of compact chips
    box.classList.remove("cmp", "two");
    box.style.setProperty("--scols", 1);
    if (land()) {
      const over = () => box.scrollHeight > box.clientHeight + 1;
      if (over()) box.classList.add("cmp");
      if (over()) { box.classList.remove("cmp"); box.classList.add("two"); box.style.setProperty("--scols", 2); }
      if (over()) box.classList.add("cmp");
    }
  }

  /* ---------- Middle: the trick ---------- */
  function center() {
    const v = M.v, c = R("center"), lg = R("log");
    c.className = "dm-center"; lg.innerHTML = "";
    if (v.phase === "draw" || v.phase === "deal") return drawView(c);
    if (v.phase === "tax") return taxView(c);
    if (v.phase === "roundEnd" || v.phase === "over") return standingsView(c);
    // Play
    const t = v.trick;
    const mine = v.turn === M.me && !replaying();          // a replay never says "you"
    if (t) {
      // only a new play lands the cards again — a pass leaves the table still (it used to replay the drop and look like a play).
      // Not after a jump / remount (no events), and not when the cards fly in from the player's seat instead.
      const plays = v.trickLog.filter(e => !e.pass).length;
      const key = [v.round, t.by, t.rank, t.plain, t.jesters, plays].join(":");
      const land = key !== landed && M.ev.length > 0 && !flyNow; landed = key;
      c.innerHTML = `<div class="dm-trick${land ? " land" : ""}" data-r="trick">${trickCards(t)}</div>
        <div class="dm-who">${crest(v.titles[t.by])}<b>${nm(t.by)}</b> · ${esc(playText(t.rank, t.plain, t.jesters))}</div>
        <div class="dm-need">${mine ? L("받아치려면", "To beat it") : L("받아칠 조건", "To beat")}: ` +
        L(`<b>${t.count}장</b> · <b>${t.rank}보다 낮은 숫자</b>`, `<b>${cardsEn(t.count)}</b> · <b>lower than ${t.rank}</b>`) +
        (v.passLock ? `<span class="dm-lockrule">${L("패스하면 이번 판 끝", "a pass sits out this trick")}</span>` : "") + `</div>`;
    } else {
      const pt = v.prevTrick;
      c.innerHTML = (pt ? `<div class="dm-trick prev" data-r="trick">${trickCards(pt)}</div>
          <div class="dm-who">${L(`${nm(pt.by)} 님이 판을 가져갔습니다`, `${nm(pt.by)} won the trick`)}</div>`
        : `<div class="dm-trick empty" data-r="trick"><span>${L("빈 판", "Empty")}</span></div>`) +
        `<div class="dm-need">${L(`새 판 — <b>${mine ? "내가" : nm(v.turn) + " 님이"}</b> 선 · 아무 숫자 몇 장이든`,
          `New trick — <b>${mine ? "you lead" : nm(v.turn) + " leads"}</b> · any number, any count`)}</div>`;
    }
    // This trick's record (fair-play rule: cleared when the trick ends)
    if (v.trickLog.length) {
      lg.innerHTML = `<span class="lab">${L("이번 판", "This trick")}</span>` + v.trickLog.slice(-8).map(e =>
        `<span class="ent${e.p === M.me ? " me" : ""}"><b>${nm(e.p)}</b>${e.pass ? `<i class="ps">${L("패스", "Pass")}</i>` : pips(e.rank, e.plain, e.jesters, 3)}</span>`).join("");
    }
    let cw = sizeTrick();
    // A short table: drop the oldest entries of the record (the newest stay) while the record takes more than one line
    // and the trick doesn't fit or gets too small
    for (let k = 0; k < 8 && (c.scrollHeight > c.clientHeight + 1 || cw < 52) && lg.offsetHeight > 26 && lg.children.length > 2; k++) {
      lg.children[1].remove(); lg.firstChild.classList.add("cut");
      cw = sizeTrick();
    }
  }
  const slotRot = i => ((i % 2 ? 1 : -1) * (1.5 + (i * .9) % 3)).toFixed(1);
  function trickCards(t) {
    const ranks = Array(t.plain).fill(t.rank).concat(Array(t.jesters).fill(JESTER));
    return ranks.map((r, i) => `<span class="slot" data-rank="${r}" style="--i:${i};--rot:${slotRot(i)}deg">${cardHTML(r)}</span>`).join("");
  }
  /* Trick card size: from the height and width left on the felt (watchers and big screens get bigger cards) */
  function sizeTrick() {
    const tr = R("table").querySelector('[data-r="trick"]');
    if (!tr) return 999;
    const table = R("table"), c = R("center");
    const others = [...c.children].filter(x => x !== tr).reduce((a, x) => a + x.offsetHeight + 4, 0);
    const avH = table.clientHeight - R("call").offsetHeight - R("log").offsetHeight - others - 22;
    const W = table.clientWidth - 24;
    const k = tr.children.length || 1;
    const big = wrap.classList.contains("big");
    const cap = watching() ? (W > 700 ? 230 : W > 400 ? 170 : 150) : big ? 160 : W > 400 ? 128 : 112;
    let cw = Math.max(40, Math.min(cap, avH / 1.42, W));
    // Overlap: tighten the spacing when too wide
    let step = k > 1 ? Math.min(cw * .62, (W - cw) / (k - 1)) : 0;
    if (k > 1 && step < cw * .22) { cw = Math.max(36, W / (1 + (k - 1) * .3)); step = Math.min(cw * .62, (W - cw) / (k - 1)); }
    tr.style.setProperty("--cw", cw.toFixed(1) + "px");
    tr.style.setProperty("--step", step.toFixed(1) + "px");
    tr.style.width = (cw + step * (k - 1)).toFixed(1) + "px";
    return cw;
  }

  function drawView(c) {
    const v = M.v;
    if (!v.draw) {
      c.innerHTML = `<div class="dm-big">${L("자리를 정합니다", "Choosing seats")}</div><div class="dm-need">` +
        L("한 장씩 뽑아 <b>가장 낮은 숫자</b>가 첫 선", "Everyone draws a card — <b>the lowest number</b> leads first") + `</div>`;
      return;
    }
    const first = v.draw.order[0];
    const items = v.draw.order.map((p, i) => {
      const r = v.draw.draws.find(d => d.p === p).rank;
      return `<div class="dm-dr${p === first ? " win" : ""}" style="--i:${i}">${cardHTML(r)}<b>${nm(p)}</b></div>`;
    }).join("");
    // Card size: fit on one row (two when there are many)
    const T = R("table"), per = v.n > 5 && T.clientWidth < 460 ? Math.ceil(v.n / 2) : v.n;
    const capD = wrap.classList.contains("big") || (watching() && T.clientWidth > 600) ? 120 : 76;
    const dw = Math.floor(Math.max(38, Math.min(capD, (T.clientWidth - 24) / per - 8, (T.clientHeight - 110) / (per < v.n ? 2 : 1) / 1.42 - 20)));
    c.innerHTML = `<div class="dm-sub">${L("자리 뽑기 — 낮은 숫자부터 앉습니다", "Seat draw — lowest number sits first")}</div>` +
      `<div class="dm-draws" style="--cw:${dw}px; max-width:${per * (dw + 8) + 4}px">${items}</div>
      <div class="dm-need">${L(`<b>${nm(first)}</b> 님이 가장 낮은 카드로 첫 선`, `<b>${nm(first)}</b> drew the lowest card and leads`)}</div>`;
  }

  function taxView(c) {
    const v = M.v, me = M.me;
    let html = `<div class="dm-sub">${L(`라운드 ${v.round} · 세금`, `Round ${v.round} · Tax`)}</div>`;
    if (!v.tax) {
      html += v.ask && v.ask.kind === "revolt"
        ? (replaying()
          ? `<div class="dm-big">${L(`${nm(me)} 님 손에 광대 2장!`, `${nm(me)} holds both Jesters!`)}</div><div class="dm-need">${L("혁명을 선언할지 고르는 중", "Deciding whether to declare a revolution")}</div>`
          : `<div class="dm-big">${L("광대 2장이 내 손에!", "You hold both Jesters!")}</div><div class="dm-need">${L("혁명을 선언할지 고르세요", "Choose whether to declare a revolution")}</div>`)
        : `<div class="dm-big dim">${L("세금을 걷을 준비 중…", "Preparing to collect taxes…")}</div>`;
      html += myTitleLine();
      c.innerHTML = html; return;
    }
    if (!v.tax.pairs.length) html += `<div class="dm-need">${L("이번 라운드는 세금이 없습니다", "No tax this round")}</div>`;
    v.tax.pairs.forEach((x, i) => {
      const st = x.downDone ? L("끝", "Done") : x.upDone ? (v.tax.i === i ? L("돌려줄 카드 고르는 중", "Choosing cards to return") : "") : L("대기", "Waiting");
      const mine = x.peon === me || x.lord === me;
      const cards = mine ? `<div class="dm-txc">${x.up ? `<span>${L("바친 카드", "Paid")}</span>${x.up.map(r => cardHTML(r, "mini")).join("")}` : ""}` +
        `${x.down ? `<span>${L("돌려준 카드", "Returned")}</span>${x.down.map(r => cardHTML(r, "mini")).join("")}` : ""}</div>` : "";
      html += `<div class="dm-tx${v.tax.i === i && !v.tax.done ? " now" : ""}${mine ? " mine" : ""}">
        <div class="row">${crest(v.titles[x.peon])}<b>${nm(x.peon)}</b><span class="arr">→ ${L(`${x.k}장`, cardsEn(x.k))} →</span>${crest(v.titles[x.lord])}<b>${nm(x.lord)}</b><span class="st">${st}</span></div>${cards}</div>`;
    });
    html += myTitleLine();
    c.innerHTML = html;
  }
  function myTitleLine() {
    const v = M.v, t = v.titles[M.me];
    if (watching()) return "";                          // spectators have no title
    return `<div class="dm-need">${L("이번 라운드 내 계급", "My title this round")}: ${crest(t)}<b style="color:${TITLE_COLOR[t]}">${titleName(t)}</b></div>`;
  }

  /* Round results: places · points earned · new titles · next round's tax */
  function standingsView(c) {
    const v = M.v, n = v.n, fin = v.finish, last = v.phase === "over" || v.round >= v.rounds;
    const rows = fin.map((p, i) => {
      const t = titleCode(i, n);
      return `<li class="${p === M.me ? "me" : ""}"><span class="md m${i + 1}">${i + 1}</span><b>${nm(p)}</b>
        <span class="nt" style="color:${TITLE_COLOR[t]}">${crest(t)}${titleName(t)}</span><span class="pt">+${n - i}</span><span class="tot">${v.scores[p] + (v.phase === "roundEnd" ? n - i : 0)}</span></li>`;
    }).join("");
    let tax = "";
    if (!last && fin.length === n) {
      const gp = fin[n - 1], gd = fin[0], lp = fin[n - 2], ld = fin[1];
      tax = `<div class="dm-need">${L(`다음 라운드 세금: <b>${nm(gp)}</b> → <b>${nm(gd)}</b> 2장 · <b>${nm(lp)}</b> → <b>${nm(ld)}</b> 1장`,
        `Next round's tax: <b>${nm(gp)}</b> → <b>${nm(gd)}</b> 2 cards · <b>${nm(lp)}</b> → <b>${nm(ld)}</b> 1 card`)}</div>`;
    }
    c.className = "dm-center stand";
    c.innerHTML = `<div class="dm-sub">${last ? L("마지막 라운드 결과", "Final round results")
        : L(`라운드 ${v.round} 결과 — 이 순서로 다음 라운드에 앉습니다`, `Round ${v.round} results — next round's seating order`)}</div>
      <ol class="dm-stand"><li class="hd"><span></span><span>${L("이름", "Name")}</span><span>${last ? L("계급", "Title") : L("새 계급", "New title")}</span>` +
      `<span>${L("점수", "Pts")}</span><span>${L("합계", "Total")}</span></li>${rows}</ol>${tax}`;
    // Short tables (phones held sideways, many players): tighten the rows until everything fits
    const ol = c.querySelector(".dm-stand"), over = () => c.scrollHeight > c.clientHeight + 1;
    if (over()) ol.classList.add("tight");
    if (over()) ol.classList.add("tighter");
  }

  /* ---------- One line at the top: the important thing that just happened ---------- */
  function call() {
    const v = M.v, box = R("call");
    let t = callText;
    if (!t) {
      const rd = L(`라운드 ${v.round} / ${v.rounds}`, `Round ${v.round} / ${v.rounds}`);
      if (v.phase === "play") t = v.reveal ? (v.reveal.great
        ? L(`대혁명 — ${nm(v.reveal.p)} 님이 서열을 뒤집었습니다`, `Great revolution — ${nm(v.reveal.p)} reversed the ranks`)
        : L(`혁명 — ${nm(v.reveal.p)} 님 · 이번 라운드 세금 없음`, `Revolution — ${nm(v.reveal.p)} · no tax this round`)) : rd;
      else if (v.phase === "over") t = L("게임 끝", "Game over");
      else t = rd;
    }
    box.innerHTML = t;
  }

  /* ---------- Bottom: my line · hint · hand · buttons ---------- */
  function meLine() {
    const v = M.v, me = M.me, t = v.titles[me];
    const order = [...Array(v.n).keys()].sort((a, b) => v.scores[b] - v.scores[a]);
    const rank = order.findIndex(p => v.scores[p] === v.scores[me]) + 1;
    const place = v.finish.indexOf(me);
    R("me").innerHTML = `${crest(t)}<b class="ti" style="color:${TITLE_COLOR[t]}">${titleName(t)}</b>` +
      `<span class="it">${L(`<b>${v.scores[me]}</b>점 · ${rank}위`, `<b>${v.scores[me]}</b> pt · ${ord(rank)}`)}</span>` +
      `<span class="it rd">${L(`라운드 <b>${v.round}</b>/${v.rounds}`, `Rd <b>${v.round}</b>/${v.rounds}`)}</span>` +
      `<span class="it">${place >= 0 && v.phase === "play" ? L(`<b>${place + 1}위</b> 탈출`, `Out <b>${ord(place + 1)}</b>`)
        : L(`내 패 <b>${v.sizes[me]}</b>장`, `Hand <b>${v.sizes[me]}</b>`)}</span><span class="more">${L("점수표 ›", "Scores ›")}</span>`;
  }

  function hint() {
    const v = M.v, me = M.me, h = R("hint"), mine = myPlayAsk() && !busy();
    let t = "", cls = "hint";
    if (flashText) { t = flashText; cls += " dm-warn"; }
    else if (v.phase === "over") t = L("게임 끝", "Game over");
    else if (v.phase === "draw" || v.phase === "deal") t = L("곧 카드를 나눕니다", "Dealing soon");
    else if (v.phase === "roundEnd") t = v.finish[0] === me ? L("<b>1등!</b> 다음 라운드는 대달무티입니다 👑", "<b>1st!</b> You'll be Greater Dalmuti next round 👑")
      : L(`라운드 끝 — 나는 <b>${v.finish.indexOf(me) + 1}위</b>`, `Round over — you finished <b>${ord(v.finish.indexOf(me) + 1)}</b>`);
    else if (v.phase === "tax") {
      const rp = replaying();                          // a replay describes the decision instead of asking for it
      if (v.ask && v.ask.kind === "return") t = rp
        ? L(`<b>${nm(me)}</b> 님이 <b>${nm(v.ask.peon)}</b> 님에게 돌려줄 카드 ${v.ask.k}장을 고르는 중`, `<b>${nm(me)}</b> is choosing ${cardsEn(v.ask.k)} to give back to <b>${nm(v.ask.peon)}</b>`)
        : L(`<b>${nm(v.ask.peon)}</b> 님에게 돌려줄 카드 <b>${v.ask.k}장</b>을 고르세요`, `Choose <b>${cardsEn(v.ask.k)}</b> to give back to <b>${nm(v.ask.peon)}</b>`);
      else if (v.ask && v.ask.kind === "revolt") t = rp
        ? L(`<b>${nm(me)}</b> 님이 <b>혁명</b>을 고민하는 중`, `<b>${nm(me)}</b> is deciding on a <b>revolution</b>`)
        : L("<b>혁명</b>을 선언할지 고르세요 (15초)", "Declare a <b>revolution</b>? (15s)");
      else t = L("세금 정산 중 — 잠시 기다리세요", "Collecting taxes — please wait");
    } else if (v.phase === "play") {
      const tr = v.trick;
      if (v.finish.includes(me)) {
        const k = v.finish.indexOf(me), nt = titleName(titleCode(k, v.n));
        t = L(`<b>${k + 1}위</b>로 빠져나왔습니다 — 다음 라운드 ${nt}`, `You went out <b>${ord(k + 1)}</b> — ${nt} next round`);
      }
      else if (busy()) t = L("보냈습니다…", "Sent…");
      else if (!mine) t = L(`${nm(v.turn)} 님 차례` + (tr ? ` · ${tr.count}장, ${tr.rank}보다 낮게` : " · 새 판의 선"),
        `${nm(v.turn)}'s turn` + (tr ? ` · ${cardsEn(tr.count)}, lower than ${tr.rank}` : " · leading a new trick"));
      else if (sel && legalSel(v, sel)) t = `<b>${esc(playText(sel.rank, sel.plain, sel.jesters))}</b>` + L(" — 「내기」를 누르세요", " — tap Play");
      else if (sel) { t = esc(whySel(v, sel)); cls += " dm-warn"; }
      else if (tr && !anyPlayable(v)) {
        t = L(`${tr.count}장 · ${tr.rank}보다 낮은 묶음이 없습니다 — <b>패스</b>하세요`, `No ${cardsEn(tr.count)} lower than ${tr.rank} — <b>pass</b>`);
        cls += " dm-urge";
      }
      else if (tr) t = L(`<b>${tr.count}장</b> · <b>${tr.rank}보다 낮은</b> 숫자를 누르거나 패스`, `Tap a number <b>lower than ${tr.rank}</b> (<b>${cardsEn(tr.count)}</b>) or pass`);
      else t = L("<b>선</b>입니다 — 낼 숫자를 누르세요", "<b>Your lead</b> — tap a number to play") +
        (v.hand[JESTER] ? L(" (광대를 붙이려면 광대도 누르기)", " (tap the Jester to add it)") : "");
    }
    h.className = cls; h.innerHTML = t;
  }

  function hand() {
    const v = M.v, box = R("hand"), mine = !!myPlayAsk() && !busy();
    const gs = groups(v);
    box.innerHTML = "";
    box.classList.toggle("xs", geo.cw < 46);
    box.style.setProperty("--cw", geo.cw + "px");
    box.style.setProperty("--cols", Math.ceil(gs.length / geo.rows) || 1);
    box.classList.toggle("empty", !gs.length);
    if (!gs.length) {
      const place = v.finish.indexOf(M.me);
      box.innerHTML = `<div class="dm-empty">${place >= 0 ? L(`${place + 1}위로 패를 다 털었습니다 🎉`, `You went out ${ord(place + 1)} 🎉`)
        : v.phase === "draw" || v.phase === "deal" ? L("카드를 기다리는 중", "Waiting for cards") : ""}</div>`;
      return;
    }
    gs.forEach((r, i) => {
      const cnt = v.hand[r], st = v.phase === "play" ? groupState(v, r) : { can: true };
      const picked = sel ? (r === JESTER ? sel.jesters : sel.rank === r ? sel.plain : 0) : 0;
      const b = el("button", "dm-grp" + (r === JESTER ? " jk" : "") + (mine && st.can && !st.aux ? " can" : "") + (mine && !st.can ? " dim" : "") +
        (picked ? " sel" : "") + (dealIn ? " in" : "") + (cnt >= 3 ? " s3" : cnt === 2 ? " s2" : ""));
      b.style.setProperty("--i", i);
      b.dataset.rank = r;
      b.innerHTML = cardHTML(r) + `<span class="n">${cnt}</span>` +
        (picked ? `<span class="pk">${L(`${picked}장`, `×${picked}`)}</span>` : mine && !st.can && st.why ? `<span class="why">${whyLabel(st.why)}</span>` : "");
      b.setAttribute("aria-label", L(`${label(r)} ${cnt}장` + (picked ? `, ${picked}장 고름` : "") + (mine && !st.can ? " (낼 수 없음)" : ""),
        `${label(r)}, ${cardsEn(cnt)}` + (picked ? `, ${picked} selected` : "") + (mine && !st.can ? " (can't play)" : "")));
      b.onclick = () => tap(r);
      box.appendChild(b);
    });
    dealIn = false;
  }

  function controls() {
    const v = M.v, mine = !!myPlayAsk() && !busy();
    const pass = R("pass"), play = R("play"), sb = R("sel");
    pass.disabled = !mine || !v.trick;
    pass.classList.toggle("dm-urgebtn", mine && !!v.trick && !anyPlayable(v) && !sel);
    const ok = mine && legalSel(v, sel);
    play.disabled = !ok;
    play.textContent = sel && ok ? L(`${sel.plain + sel.jesters}장 내기`, `Play ${sel.plain + sel.jesters}`) : L("내기", "Play");
    // Chosen set · adjust the count
    if (mine && sel) {
      const lo = stepRange(v, sel);
      const what = sel.rank === JESTER ? `${pip(JESTER)}×${sel.jesters}` : `${pip(sel.rank)}×${sel.plain}${sel.jesters ? ` +${pip(JESTER)}${sel.jesters}` : ""}`;
      sb.innerHTML = `<button class="st" data-d="-1" ${lo.min >= lo.cur ? "disabled" : ""} aria-label="${L("한 장 덜", "One fewer")}">−</button><span class="cur">${what}</span>` +
        `<button class="st" data-d="1" ${lo.max <= lo.cur ? "disabled" : ""} aria-label="${L("한 장 더", "One more")}">+</button>`;
      sb.querySelectorAll("button").forEach(b => b.onclick = () => stepSel(+b.dataset.d));
    } else sb.innerHTML = mine ? `<span class="none">${L("숫자를 눌러 고르기", "Tap a number")}</span>` : "";
  }
  /* Count range: Jesters alone → number of Jesters, otherwise number cards (when following, Jesters fill the rest) */
  function stepRange(v, s) {
    const h = v.hand, J = h[JESTER], t = v.trick;
    if (s.rank === JESTER) return { min: 1, max: J, cur: s.jesters };
    if (!t) return { min: 1, max: h[s.rank], cur: s.plain };
    return { min: Math.max(1, t.count - J), max: Math.min(h[s.rank], t.count), cur: s.plain };
  }
  function stepSel(d) {
    const v = M.v;
    if (!sel) return;
    const r = stepRange(v, sel), nv = Math.max(r.min, Math.min(r.max, r.cur + d));
    if (sel.rank === JESTER) sel.jesters = nv;
    else {
      sel.plain = nv;
      if (v.trick && (v.assist || sel.jesters)) sel.jesters = Math.max(0, Math.min(v.hand[JESTER], v.trick.count - nv));
    }
    ctx.sound.deal();
    render();
  }

  function flash(text) {
    flashText = text;
    clearTimeout(flashT); flashT = setTimeout(() => { flashText = ""; if (M) hint(); }, 2200);
  }

  function tap(r) {
    const v = M.v, ask = myPlayAsk();
    if (v.phase !== "play" || replaying() || watching()) return;
    if (!ask) {
      const who = esc(names()[v.turn] || "");
      flash(v.finish.includes(M.me) ? L("이미 패를 다 털었습니다", "You've already gone out") : L(`${who} 님 차례입니다`, `It's ${who}'s turn`));
      hint(); return;
    }
    if (busy()) return;
    selAsk = ask.id;
    const h = v.hand, t = v.trick, J = h[JESTER];
    if (r === JESTER) {
      if (sel && sel.rank !== JESTER) {
        // add / remove Jesters on the chosen number
        if (!t) sel.jesters = (sel.jesters + 1) % (J + 1);
        else {
          // when following: same count, cycle through using one more Jester and one fewer number card
          const opts = [];
          for (let j = 0; j <= J; j++) { const pl = t.count - j; if (pl >= 1 && pl <= h[sel.rank]) opts.push(j); }
          if (!opts.length) { flash(L("광대를 써도 장수를 맞출 수 없습니다", "Even with Jesters the count can't be matched")); render(); return; }
          const i = opts.indexOf(sel.jesters);
          sel.jesters = opts[(i + 1) % opts.length]; sel.plain = t.count - sel.jesters;
        }
      } else if (t) { flash(L("광대는 숫자 카드와 함께 내세요 — 숫자를 먼저 누르세요", "Play Jesters with a number — tap a number first")); render(); return; }
      else sel = sel && sel.rank === JESTER ? null : defaultSel(v, JESTER);
      ctx.sound.flip();
      render();
      return;
    }
    if (sel && sel.rank === r) { sel = null; render(); return; }
    const st = groupState(v, r);
    if (!st.can) {
      flash(st.why === "short"
        ? L(`${label(r)} ${h[r]}장${J ? ` + 광대 ${J}장` : ""}으로는 ${t.count}장을 맞출 수 없습니다`,
            `${label(r)} ×${h[r]}${J ? ` + ${jestersEn(J)}` : ""} can't make ${cardsEn(t.count)}`)
        : L(`${label(r)}는 지금 판(${t.rank})보다 낮지 않습니다`, `${label(r)} is not lower than the current ${t.rank}`));
      ctx.sound.pass();
      render();
      return;
    }
    sel = defaultSel(v, r);
    ctx.sound.flip();
    render();
  }
  function doPlay() {
    const v = M.v;
    if (!myPlayAsk() || busy() || !legalSel(v, sel)) return;
    // remember where the cards leave my hand: their flight to the table starts there once the play comes back
    const grp = r => { const b = R("hand").querySelector(`[data-rank="${r}"]`); return b ? b.getBoundingClientRect() : null; };
    const from = { at: Date.now(), r: sel.rank !== JESTER ? grp(sel.rank) : null, j: sel.jesters ? grp(JESTER) : null };
    sentFrom = from;                                   // set first: a local host may answer before send() returns
    if (ctx.send({ rank: sel.rank, plain: sel.plain, jesters: sel.jesters })) { markBusy(); sel = null; ctx.sound.place(); render(); }
    else sentFrom = null;
  }
  function doPass() {
    if (!myPlayAsk() || busy() || !M.v.trick) return;
    if (ctx.send({ pass: true })) { markBusy(); sel = null; ctx.sound.pass(); render(); }
  }
  R("play").onclick = doPlay;
  R("pass").onclick = doPass;
  R("me").onclick = () => scoreTable();

  /* ---------- Dialogs: revolution question · cards to give back · score table ---------- */
  const revoltNote = t => ({
    4: L("나는 <b>소농노</b> — 선언하면 소달무티에게 바칠 가장 좋은 카드 1장을 지킵니다.",
      "You are the <b>Lesser Peon</b> — declaring keeps the best card you would pay the Lesser Dalmuti."),
    3: L("나는 <b>상인</b> — 세금과는 무관하지만, 혁명은 두 달무티의 특권을 없앱니다.",
      "You are a <b>Merchant</b> — tax doesn't affect you, but a revolution takes away both Dalmuti's privileges."),
    2: L("나는 <b>소달무티</b> — 선언하면 내가 받을 상납 1장도 사라집니다.",
      "You are the <b>Lesser Dalmuti</b> — declaring also cancels the 1 card you would receive."),
    1: L("나는 <b>대달무티</b> — 선언하면 내가 받을 상납 2장도 사라집니다.",
      "You are the <b>Greater Dalmuti</b> — declaring also cancels the 2 cards you would receive.")
  })[t] || "";
  function asks() {
    const v = M.v;
    const a = ctx.myAsk("revolt") || ctx.myAsk("return");
    const want = a && v.ask && v.ask.kind === a.kind ? a : null;
    if (modalClose && (!want || want.id !== modalAsk)) { const c = modalClose; modalClose = null; modalAsk = 0; c(); }
    if (!want || want.id === modalAsk) return;
    modalAsk = want.id; modalKind = want.kind;
    ctx.buzz([60, 80, 60]);
    if (want.kind === "revolt") revoltModal(want);
    else returnModal(want);
  }
  function revoltModal(ask) {
    const v = M.v;
    ctx.modal((box, close) => {
      modalClose = close;
      box.classList.add("dm-modal");
      ctx.head(box, L("혁명", "Revolution"), L("혁명을 선언할까요?", "Declare a revolution?"),
        L("광대 2장이 모두 내 손에 있습니다. 선언하면 <b>이번 라운드 세금이 전부 취소</b>되고 광대 2장이 모두에게 공개됩니다. 감추면 아무도 모릅니다. 15초 안에 고르지 않으면 감춘 것으로 합니다.",
          "You hold both Jesters. If you declare, <b>all taxes this round are cancelled</b> and both Jesters are shown to everyone. If you keep them hidden, nobody will know. No choice within 15 seconds counts as hiding them."));
      box.appendChild(el("div", "dm-mnote", `<span>${revoltNote(v.ask.title)}</span><div class="dm-mcards">${cardHTML(JESTER)}${cardHTML(JESTER)}</div>`));
      ctx.buttonRow(box, [
        { label: L("감춘다", "Keep hidden"), on: () => { if (ctx.myAsk("revolt")) ctx.send({ revolt: false }); close(); } },
        { label: L("혁명 선언!", "Revolution!"), primary: true, on: () => { if (ctx.myAsk("revolt")) ctx.send({ revolt: true }); ctx.sound.win(); close(); } }
      ]);
    }, { dismissible: false }).then(() => { if (modalAsk === ask.id) modalClose = null; });
  }
  function returnModal(ask) {
    const v = M.v, k = v.ask.k, peon = v.ask.peon, recv = v.ask.received;
    const pick = [];
    ctx.modal((box, close) => {
      modalClose = close;
      box.classList.add("dm-modal");
      ctx.head(box, L("세금", "Tax"), L(`${nm(peon)} 님에게 돌려줄 카드 ${k}장`, `Give ${cardsEn(k)} back to ${nm(peon)}`),
        L(`${nm(peon)} 님이 가장 낮은 숫자 ${k}장을 바쳤습니다. 아무 카드나 ${k}장을 골라 돌려주세요. 시간이 다 되면 가장 약한 카드가 나갑니다.`,
          `${nm(peon)} paid you their ${k === 1 ? "lowest card" : `${k} lowest cards`}. Pick any ${cardsEn(k)} to give back. If time runs out, your weakest ${k === 1 ? "card goes" : "cards go"}.`));
      box.appendChild(el("div", "dm-recv", `<span>${L("받은 카드", "Received")}</span>${recv.map(r => cardHTML(r, "mini")).join("")}`));
      const grid = el("div", "dm-rgrid"), picked = el("div", "dm-picked");
      box.appendChild(grid); box.appendChild(picked);
      const row = ctx.buttonRow(box, [
        { label: L("가장 약한 카드로", "Weakest cards"), on: () => send(weakest(v.hand, k)) },
        { label: L("돌려주기", "Give back"), primary: true, disabled: true, on: () => send(pick.slice()) }
      ]);
      const give = row.querySelector(".btn.primary");
      function send(cards) { if (ctx.myAsk("return")) { ctx.send({ cards }); ctx.sound.chip(); } close(); }
      function draw() {
        grid.innerHTML = "";
        for (let r = 1; r <= 13; r++) {
          const have = v.hand[r]; if (!have) continue;
          const used = pick.filter(x => x === r).length;
          const b = el("button", "dm-rc" + (used ? " sel" : "") + (used >= have ? " full" : ""), cardHTML(r, "mini") + `<span class="n">${have - used}</span>`);
          b.disabled = used >= have || pick.length >= k;
          b.onclick = () => { pick.push(r); ctx.sound.flip(); draw(); };
          grid.appendChild(b);
        }
        picked.innerHTML = `<span>${L(`돌려줄 카드 ${pick.length}/${k}`, `To give back ${pick.length}/${k}`)}</span>` +
          pick.map((r, i) => `<button class="dm-pc" data-i="${i}" aria-label="${L(`${label(r)} 빼기`, `Remove ${label(r)}`)}">${cardHTML(r, "mini")}</button>`).join("");
        picked.querySelectorAll("button").forEach(b => b.onclick = () => { pick.splice(+b.dataset.i, 1); draw(); });
        give.disabled = pick.length !== k;
      }
      draw();
    }, { dismissible: false }).then(() => { if (modalAsk === ask.id) modalClose = null; });
  }
  function weakest(h, k) {
    const out = [];
    for (let r = 12; r >= 1 && out.length < k; r--) for (let c = h[r]; c > 0 && out.length < k; c--) out.push(r);
    for (let c = h[JESTER]; c > 0 && out.length < k; c--) out.push(JESTER);
    return out;
  }
  function scoreTable() {
    if (!M) return;
    const v = M.v, n = v.n;
    const order = [...Array(n).keys()].sort((a, b) => v.scores[b] - v.scores[a]);
    ctx.modal((box, close) => {
      box.classList.add("dm-modal", "dm-scores");
      ctx.head(box, L(`라운드 ${v.round} / ${v.rounds}`, `Round ${v.round} / ${v.rounds}`), L("점수표", "Scores"),
        L("라운드마다 1등 n점 … 꼴찌 1점. 칸의 글자는 그 라운드에서 얻은 계급입니다.",
          "Each round: 1st gets n points … last gets 1. Letters show the title earned that round: GD / LD Greater / Lesser Dalmuti, M Merchant, LP / GP Lesser / Greater Peon."));
      const hs = v.history;
      const head = `<tr><th></th><th>${L("이름", "Name")}</th>${hs.map(h => `<th>${h.round}R</th>`).join("")}<th>${L("합계", "Total")}</th></tr>`;
      const rows = order.map((p, i) => `<tr class="${p === M.me ? "me" : ""}"><td>${i + 1}</td><td class="nm"><span>${crest(v.titles[p])}${nm(p)}</span></td>` +
        hs.map(h => { const k = h.finish.indexOf(p), t = titleCode(k, n); return `<td style="color:${TITLE_COLOR[t]}">${h.points[k]}<small>${titleCode2(t)}</small></td>`; }).join("") +
        `<td class="tot">${v.scores[p]}</td></tr>`).join("");
      box.appendChild(el("div", "dm-scorewrap", `<table class="dm-score">${head}${rows}</table>`));
      if (!hs.length) box.appendChild(el("p", "", L("아직 끝난 라운드가 없습니다.", "No rounds finished yet.")));
      ctx.buttonRow(box, [{ label: L("닫기", "Close"), primary: true, on: () => close() }]);
    });
  }

  /* ---------- Events: sound · flashes · messages ---------- */
  function events(m) {
    const v = m.v, me = m.me;
    hot = new Set();
    let snd = null, pr = 0;
    const want = (s, r) => { if (r >= pr) { snd = s; pr = r; } };
    for (const e of m.ev) {
      if (e.type === "play") { hot.add(e.p); want("place", 1); if (e.p === me) sel = null; if (callKind === "trick") { callText = ""; callKind = ""; } }
      else if (e.type === "pass") { hotPass.add(e.p); passFx(e.p); want("pass", 1); }
      else if (e.type === "trickEnd") {
        callKind = "trick";
        callText = e.winner === me ? L("판을 가져왔습니다 — <b>내가 선</b>", "You won the trick — <b>you lead</b>")
          : L(`<b>${nm(e.winner)}</b> 님이 판을 가져감 · 새 판 선 <b>${e.leader === me ? "나" : nm(e.leader)}</b>`,
              `<b>${nm(e.winner)}</b> won the trick · next lead: <b>${e.leader === me ? "you" : nm(e.leader)}</b>`);
        want("flip", 1);
      }
      else if (e.type === "out") {
        const tn = titleName(e.title);
        callText = e.p === me ? L(`<b>${e.place}위</b>로 빠져나왔습니다 — ${tn}`, `You went out <b>${ord(e.place)}</b> — ${tn}`)
          : L(`<b>${nm(e.p)}</b> 님 ${e.place}위 — ${tn}`, `<b>${nm(e.p)}</b> out ${ord(e.place)} — ${tn}`);
        if (e.p === me) { want(e.last ? "lose" : "good", 4); if (!replaying()) ctx.buzz(80); } else want("chip", 2);
      }
      else if (e.type === "draw") { callText = L("자리 뽑기", "Seat draw"); want("deal", 2); }
      else if (e.type === "deal") { callText = L(`라운드 ${e.round} — 카드를 나눴습니다`, `Round ${e.round} — cards dealt`); dealIn = true; sel = null; want("deal", 2); }
      else if (e.type === "revolt") {
        callText = e.great ? L(`<b>대혁명!</b> ${nm(e.p)} 님 — 서열이 뒤집혔습니다`, `<b>Great revolution!</b> ${nm(e.p)} — ranks reversed`)
          : L(`<b>혁명!</b> ${nm(e.p)} 님 — 세금 없음`, `<b>Revolution!</b> ${nm(e.p)} — no tax`);
        banner(e); want("win", 5);
      }
      else if (e.type === "revoltNo") { callText = L("광대 2장을 감췄습니다 🤫", "You kept both Jesters hidden 🤫"); }
      else if (e.type === "taxStart") callText = L("세금을 걷습니다", "Collecting taxes");
      else if (e.type === "tax") {
        hot.add(e.from); hot.add(e.to);
        const mine = e.from === me || e.to === me;
        callText = `<b>${nm(e.from)}</b> → <b>${nm(e.to)}</b> · ` +
          (e.dir === "up" ? L(`${e.n}장 상납`, `${cardsEn(e.n)} tribute`) : L(`${e.n}장 하사`, `${cardsEn(e.n)} returned`)) +
          (mine && e.ranks ? ` <span class="dm-callc">${e.ranks.map(r => pip(r)).join("")}</span>` : "");
        if (e.to === me) dealIn = false;
        want("chip", 2);
      } else if (e.type === "taxDone") callText = L("세금 끝 — 플레이 시작", "Taxes done — play begins");
      else if (e.type === "lead") { if (e.p !== me) callText = callText || L(`<b>${nm(e.p)}</b> 님이 선`, `<b>${nm(e.p)}</b> leads`); }
      else if (e.type === "roundEnd") { callText = L(`라운드 ${e.round} 끝`, `Round ${e.round} over`); want(e.finish[0] === me ? "win" : "good", 3); }
      else if (e.type === "round") callText = "";
    }
    if (snd && ctx.sound[snd]) ctx.sound[snd]();
  }
  /* A pass: a grey "Pass" tag slides across the felt; the cards on the table stay where they are */
  function passFx(p) {
    const b = R("passfx");
    b.innerHTML = `<span class="ico">✋</span><b>${p === M.me ? L("나", "You") : nm(p)}</b> ${L("패스", "pass")}` +
      (M.v.passLock ? `<small>${L("이번 판은 끝", "out for this trick")}</small>` : "");
    b.hidden = false;
    b.classList.remove("go"); void b.offsetWidth; b.classList.add("go");
    clearTimeout(passT); passT = setTimeout(() => { b.hidden = true; }, 1300);
  }
  function banner(e) {
    const b = R("banner");
    b.hidden = false;
    b.className = "dm-banner" + (e.great ? " great" : "") + (ctx.lang === "en" ? " en" : "");
    const small = L(e.great ? "GREAT REVOLUTION" : "REVOLUTION", "");
    b.innerHTML = `<div>${small ? `<small>${small}</small>` : ""}<b>${e.great ? L("대혁명", "Great Revolution") : L("혁명", "Revolution")}</b>` +
      `<span>${L(`${nm(e.p)} 님이 광대 2장을 펼쳤습니다`, `${nm(e.p)} reveals both Jesters`)}<br>` +
      `${e.great ? L("서열이 통째로 뒤집힙니다", "The whole ranking is turned upside down") : L("이번 라운드 세금은 없습니다", "No tax this round")}</span></div>`;
    clearTimeout(bannerT); bannerT = setTimeout(() => { b.hidden = true; }, e.great ? 2600 : 2100);
  }

  /* ---------- Flying cards (ctx.fly) ---------- */
  const chipOf = p => R("seats").querySelector(`.dm-seat[data-p="${p}"]`);
  function flights(m) {
    if (!ctx.fly) return;
    let k = 0;
    for (const e of m.ev || []) {
      if (e.type === "play") flyPlay(e);
      else if (e.type === "tax") flyTax(e, k++);
    }
  }
  /* A play: each card flies from the player's name chip (my own play: from the hand group I tapped) to its place on the table */
  function flyPlay(e) {
    const v = M.v, t = v.trick || v.prevTrick, tr = R("table").querySelector('[data-r="trick"]');
    const mine = e.p === M.me && sentFrom && Date.now() - sentFrom.at < 8000 ? sentFrom : null;
    if (e.p === M.me) sentFrom = null;
    if (!t || !tr || t.by !== e.p || tr.classList.contains("empty")) return;
    const chip = e.p === M.me && !watching() ? R("hand") : chipOf(e.p);
    const cw = parseFloat(tr.style.getPropertyValue("--cw")) || 64;
    [...tr.querySelectorAll(".slot")].forEach((slot, i) => {
      const r = +slot.dataset.rank;
      const from = mine ? (r === JESTER ? mine.j || mine.r : mine.r || mine.j) || chip : chip;
      if (!from) return;
      const html = `<span class="dm-flyc" style="--rot:${slotRot(i)}deg">${dmCardHTML(r, "", undefined, `--cw:${cw.toFixed(1)}px`)}</span>`;
      ctx.fly(from, slot, { html, delay: i * 45, ms: 420 });
    });
  }
  /* Tax: the cards move from one name chip to the other (faces only for the two players involved) */
  function flyTax(e, k) {
    const a = chipOf(e.from), b = chipOf(e.to);
    if (!a || !b) return;
    for (let i = 0; i < e.n; i++) {
      const anchor = el("span", "dm-anchor");              // an invisible landing spot inside the receiving chip
      b.appendChild(anchor);
      const r = e.ranks && e.ranks[i];
      const html = r ? dmCardHTML(r, "mini") : `<span class="dm-back"></span>`;
      const delay = k * 200 + i * 110;
      ctx.fly(a, anchor, { html, delay, ms: 520, scale: 1 });
      setTimeout(() => anchor.remove(), delay + 600);
    }
  }

  /* ---------- Sizing ---------- */
  function fit() {
    const v = M.v, H = wrap.clientHeight, W = wrap.clientWidth;
    const gn = groups(v).length, gs = gn || 1;
    const hb = R("hand");
    if (!H || !W) { geo = { cw: 46, rows: gs > 7 ? 2 : 1 }; return; }
    if (land()) return fitSide(gn, gs, hb);
    const hw = (hb.clientWidth || W - 20);
    const gap = 5;
    // up to 7 groups per row (more when wide)
    const perRow = Math.max(5, Math.min(13, Math.floor((hw + gap) / (40 + gap))));
    let rows = gs > Math.min(7, perRow) ? 2 : 1;
    const cols = Math.ceil(gs / rows);
    const byW = (hw - (cols - 1) * gap - 6) / cols;
    // height: a share of what's left after the name chips, my line and the buttons
    hb.style.height = "0px";
    const fixed = R("seats").offsetHeight + R("dock").offsetHeight;
    const rest = Math.max(200, H - fixed);
    const handMax = Math.max(84, Math.min(rest * .46, rest - 170));
    const byH = (handMax / rows - 8) / 1.42;
    const cw = Math.floor(Math.max(34, Math.min(rows === 1 ? 94 : 84, byW, byH)));
    geo = { cw, rows };
    // without cards (seat draw · went out) shrink the hand area so the table gets bigger
    hb.style.height = gn ? Math.ceil(rows * (cw * 1.42 + 8) + 2) + "px" : "40px";
  }
  /* Landscape: the hand fills the right-hand column between my line · hint and the buttons.
     Try 1–5 rows and keep the layout with the biggest cards. */
  function fitSide(gn, gs, hb) {
    hb.style.height = "";
    const hw = hb.clientWidth, hh = hb.clientHeight;
    const gap = 5, rowGap = 8, cap = wrap.classList.contains("big") ? 112 : 96;
    let best = null;
    for (let rows = 1; rows <= 5; rows++) {
      const cols = Math.ceil(gs / rows);
      if (rows > 1 && Math.ceil(gs / (rows - 1)) === cols) continue;     // no gain over fewer rows
      const byW = (hw - (cols - 1) * gap - 10) / cols;
      const byH = (hh - 10 - (rows - 1) * rowGap) / rows / 1.42;
      const cw = Math.floor(Math.max(28, Math.min(cap, byW, byH)));
      if (!best || cw > best.cw) best = { cw, rows };
    }
    geo = best;
  }

  function render() {
    if (!M) return;
    const spec = watching(), H = wrap.clientHeight;
    wrap.classList.toggle("spec", spec);
    wrap.classList.toggle("rp", replaying());
    wrap.classList.toggle("short", H < 600);
    wrap.classList.toggle("tall", H >= 760);
    wrap.classList.toggle("big", land() && H >= 560);
    wrap.classList.toggle("nohand", !spec && !groups(M.v).length);   // landscape: a narrower right column once my hand is empty
    const a = myPlayAsk();
    if (!a || a.id !== selAsk) sel = null;          // drop the chosen set when the turn changes
    if (sel && !(M.v.hand[sel.rank] > 0)) sel = null;
    seats(); call();
    if (!spec) {                                    // spectators have no hand, no line of their own and no buttons
      meLine(); hint(); controls();
      fit();
      hand();
    }
    center();
  }
  function update(m) {
    const again = m === M || (!!evSeen && m.ev === evSeen);   // the same msg again: no sounds / flashes / flights twice
    M = m;
    if (!M.ev) M.ev = [];
    flyNow = false;
    if (!again) {
      evSeen = M.ev;
      events(m);
      flyNow = !!ctx.fly && M.ev.some(e => e.type === "play");
    }
    render();
    if (!again) flights(m);
    flyNow = false;
    hot = new Set(); hotPass = new Set();   // flash only once
    asks();
  }
  function onResize() { if (M) render(); }
  window.addEventListener("resize", onResize);

  return {
    update,
    ticker: false,            // this trick's record and the top line (call) replace the history ticker
    landscape: true,          // own sideways layout (name chips left · table · hand and buttons right)
    destroy() {
      window.removeEventListener("resize", onResize);
      clearTimeout(busyT); clearTimeout(flashT); clearTimeout(bannerT); clearTimeout(passT);
      if (modalClose) { try { modalClose(); } catch (e) { } }
      root.innerHTML = "";
    }
  };
}
