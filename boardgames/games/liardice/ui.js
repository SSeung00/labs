/* Liar's Dice screen
   Portrait — top: opponents (cup with their dice count, remaining-dice dots, their latest bid this round, turn / out marks)
              felt: round · dice on the table · wild ones · lost dice; the current bid (big) with the chance it is true from my
                    point of view and what it needs; this round's bid history (newest first) and last round's result
              dock: my dice (the ones counting for the chosen face glow) · face buttons with the expected count of each face ·
                    quantity stepper + bid button (chance my bid is true) · "Liar!" (chance the call wins) · "Spot on" (chance exact)
   Landscape — opponents and the felt on the left, my dice and the bid picker on the right.
   Reveal — an overlay lifts every cup, counts the matching dice one by one, then shows who loses a die (the die flies out).
   Spectators (me = -1) get no dice and no picker until the reveal; the felt grows instead and the odds use public info only.
   Flying (ctx.fly): each new bid flies from the bidder's seat (or my bid button) to the table; the lost die flies off. */
import { L } from "../../core/i18n.js";
import { bidKo, bidEn, hits, faceP, minQty, chance, chanceExact, bidRank } from "./engine.js";

const LANDSCAPE = "(orientation: landscape) and (min-aspect-ratio: 4/3)";        // the same query as in style.css
const PIPS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
const dieHTML = (f, cls = "", attr = "") => `<span class="ld-die f${f}${cls ? " " + cls : ""}"${attr}>${PIPS[f].map(k => `<i class="k${k}"></i>`).join("")}</span>`;
const chipHTML = (q, f, cls = "") => `<span class="ld-chip${cls ? " " + cls : ""}"><b>${q}</b><em>×</em>${dieHTML(f)}</span>`;
const bidL = (q, f) => L(bidKo(q, f), bidEn(q, f));
const ordEn = n => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
/* A chance as text: exact for 0 / 100 %, otherwise "약 42%" / "~42%" */
function pctL(x) {
  if (x >= 1) return "100%";
  if (x <= 0) return "0%";
  const r = clamp(Math.round(x * 100), 1, 99);
  return L(`약 ${r}%`, `~${r}%`);
}
const hue = x => Math.round(120 * clamp(x, 0, 1));                 // red (0 %) → green (100 %)

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "ld");
  wrap.innerHTML = `
    <div class="ld-opps" data-r="opps"></div>
    <div class="ld-table felt" data-r="table">
      <div class="ld-top" data-r="top"></div>
      <div class="ld-mid" data-r="mid">
        <div class="ld-cur" data-r="cur"></div>
        <div class="ld-ladder" data-r="ladder" hidden></div>
        <div class="ld-hist" data-r="hist"></div>
      </div>
    </div>
    <div class="dock ld-dock" data-r="dock">
      <div class="ld-mine" data-r="mine"></div>
      <div class="hint" data-r="hint"></div>
      <div class="ld-pick" data-r="pick"></div>
      <div class="ld-ladder" data-r="ladder2" hidden></div>
    </div>
    <div class="ld-rv" data-r="rv" hidden></div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);
  const sideways = matchMedia(LANDSCAPE);
  let M = null, lastEv = null, sent = false;
  const sel = { f: 0, q: 0, key: "", touched: false };     // the bid being prepared in the picker
  let armed = null, armT = 0, myBidRect = null;             // "Liar!" / "Spot on" need a second tap
  let rvTimers = [], rvKey = "", loseT = 0;                 // reveal overlay: running animation and which reveal it shows

  /* ---------- Small helpers ---------- */
  const spec = () => M.me < 0;
  const nm = p => (M.players[p] ? M.players[p].name : "?");
  const who = p => (p === M.me ? L("나", "Me") : esc(nm(p)));
  const lastBid = v => (v.bids.length ? v.bids[v.bids.length - 1] : null);
  const unknown = v => v.total - v.mine.length;
  const pTrue = (v, q, f) => chance(v.mine, unknown(v), q, f, v.wild);
  const iAmOut = v => !spec() && v.out.includes(M.me);
  const dots = (c, s) => `<span class="ld-dots">${Array.from({ length: s }, (_, i) => `<i class="${i < c ? "on" : ""}"></i>`).join("")}</span>`;
  const seatEl = p => wrap.querySelector(`.ld-opp[data-p="${p}"]`);
  /* −1 / +1 next to whoever lost or got back a die in the last round (shown during the next round) */
  const delta = (v, p) => (v.phase !== "bid" || !v.prev ? "" : v.prev.loser === p ? '<em class="ld-delta neg">−1</em>'
    : v.prev.gainer === p ? '<em class="ld-delta pos">+1</em>' : "");
  /* fly() copies its target into <body>, outside .ld: carry the die size along */
  const pin = e => { e.style.setProperty("--ds", getComputedStyle(e).getPropertyValue("--ds").trim() || "24px"); return e; };

  /* ---------- Opponents (spectators: every seat) ---------- */
  function opps() {
    const v = M.v, n = v.counts.length, box = R("opps");
    const order = spec() ? [...Array(n).keys()] : Array.from({ length: n - 1 }, (_, k) => (M.me + 1 + k) % n);
    const top = lastBid(v);
    const lastOf = p => { for (let i = v.bids.length - 1; i >= 0; i--) if (v.bids[i].p === p) return v.bids[i]; return null; };
    box.innerHTML = order.map(p => {
      const pl = M.players[p] || { name: "?" }, c = v.counts[p], o = v.out.indexOf(p);
      const cls = ["ld-opp"];
      if (v.phase === "bid" && p === v.turn) cls.push("turn");
      if (o >= 0) cls.push("out");
      if (v.phase === "over" && p === v.winner) cls.push("win");
      const tag = pl.kind === "ai" ? '<span class="ld-ai">AI</span>' : pl.kind === "away" ? `<span class="ld-ai away">${L("비움", "away")}</span>` : "";
      const badge = v.phase === "bid" && p === v.turn ? `<em class="ld-tag now">${L("차례", "Turn")}</em>`
        : v.phase === "over" && p === v.winner ? '<em class="ld-tag win">🏆</em>' : "";
      const body = o >= 0 ? `<div class="ld-place">${L(`탈락 · ${n - o}등`, `Out · ${ordEn(n - o)}`)}</div>`
        : `<div class="ld-cupline"><span class="ld-cup"><b>${c}</b></span>${delta(v, p)}${dots(c, v.start)}</div>`;
      const lb = v.phase === "bid" ? lastOf(p) : null;
      const act = lb ? chipHTML(lb.q, lb.f, "sm" + (lb === top ? " top" : "")) : "";
      return `<div class="${cls.join(" ")}" data-p="${p}">${badge}${tag}<div class="ld-oname">${avatarHTML(pl.name, p, "sm")}<span>${esc(pl.name)}</span></div>` +
        `${body}<div class="ld-act">${act}</div></div>`;
    }).join("");
    box.classList.toggle("many", order.length >= 5);
  }

  /* ---------- The felt: round info · current bid with its odds · history ---------- */
  function table() {
    const v = M.v, T = v.total, n = v.counts.length;
    const lost = n * v.start - T;
    R("top").innerHTML = `<span class="ld-round">${L(`${v.round}판`, `Round ${v.round}`)}</span>` +
      `<span class="ld-tot">🎲 ${L(`탁자 위 주사위 <b>${T}</b>개`, `<b>${T}</b> dice on the table`)}</span>` +
      (v.wild ? `<span class="ld-wild">${dieHTML(1, "w")}<span>${L("= 와일드", "= wild")}</span></span>` : "") +
      `<span class="ld-grave" title="${L("잃은 주사위", "Dice lost")}">${lost > 0 ? `${dieHTML(6, "dead")}<b>${lost}</b>` : ""}</span>`;
    const last = lastBid(v), cur = R("cur");
    // The big chip with who made the bid and how it reads next to it
    const head = (chip, who, say) => `<div class="ld-big">${chip}<div class="ld-bt"><span class="ld-by">${who}</span><span class="ld-say">${say}</span></div></div>`;
    if (v.phase !== "bid") {
      // Under the reveal overlay: the bid that was challenged
      const X = v.reveal;
      cur.innerHTML = X ? head(chipHTML(X.q, X.f, "big"), "", bidL(X.q, X.f)) : "";
    } else if (last) {
      const p = pTrue(v, last.q, last.f);
      const by = last.p === M.me ? L("내 입찰", "My bid") : L(`${esc(nm(last.p))} 님의 입찰`, `${esc(nm(last.p))}'s bid`);
      cur.innerHTML = head(chipHTML(last.q, last.f, "big"), `${avatarHTML(nm(last.p), last.p, "sm")}<span>${by}</span>`, bidL(last.q, last.f)) +
        `<div class="ld-odds" style="--h:${hue(p)}"><span>${spec() ? L("맞을 확률 (공개 정보)", "Chance it's true (public)") : L("이 입찰이 맞을 확률", "Chance this bid is true")} <b>${pctL(p)}</b></span>` +
        `<div class="ld-bar"><i style="width:${(p * 100).toFixed(1)}%"></i></div></div>` +
        `<div class="ld-need">${needLine(v, last.q, last.f)}</div>`;
    } else {
      const op = v.opener;
      cur.innerHTML = head('<span class="ld-chip big empty"><b>?</b></span>',
        `${avatarHTML(nm(op), op, "sm")}<span>${op === M.me ? L("내가 첫 입찰", "I open") : L(`${esc(nm(op))} 님이 첫 입찰`, `${esc(nm(op))} opens`)}</span>`,
        L("첫 입찰을 기다리는 중", "Waiting for the opening bid")) +
        `<div class="ld-need">${L(`주사위 ${T}개 — 평균적으로 눈마다 ${(T * faceP(2, v.wild)).toFixed(1)}개${v.wild ? " (1 포함)" : ""}`,
          `${T} dice — about ${(T * faceP(2, v.wild)).toFixed(1)} of each face${v.wild ? " (with 1s)" : ""}`)}</div>`;
    }
    // This round's bids, newest first, with the chance each one is true for me
    const rows = v.phase === "bid" ? v.bids.slice().reverse().map((b, i) => {
      const p = pTrue(v, b.q, b.f);
      return `<div class="ld-h${i === 0 ? " top" : ""}">${avatarHTML(nm(b.p), b.p, "sm")}<span class="nm">${who(b.p)}</span>` +
        `${chipHTML(b.q, b.f, "sm")}<span class="say">${bidL(b.q, b.f)}</span><span class="pp" style="--h:${hue(p)}">${pctL(p)}</span></div>`;
    }) : [];
    if (v.phase === "bid" && !rows.length) rows.push(`<div class="ld-h none">${L("아직 입찰이 없습니다", "No bids yet this round")}</div>`);
    const pr = v.prev;
    if (pr && v.phase === "bid") {
      const res = pr.loser >= 0 ? L(`${who(pr.loser)} -1`, `${who(pr.loser)} −1`) : pr.gainer >= 0 ? L(`${who(pr.gainer)} +1`, `${who(pr.gainer)} +1`) : L("딱 맞음", "exact");
      rows.push(`<div class="ld-h prev">${L("지난 판", "Last round")}: ${who(pr.bidder)} ${bidL(pr.q, pr.f)} → ${L(`실제 ${pr.count}개`, `there were ${pr.count}`)} · <b>${res}</b></div>`);
    }
    R("hist").innerHTML = rows.join("");
  }
  /* What a bid needs, from my point of view (spectators: from public info) */
  function needLine(v, q, f) {
    const U = unknown(v), mine = hits(v.mine, f, v.wild), need = q - mine, avg = (U * faceP(f, v.wild)).toFixed(1);
    if (spec() || !v.mine.length) return L(`주사위 ${U}개 중 ${q}개 이상 필요 · 평균 ${avg}개`, `Needs ${q}+ of ${U} dice · average ${avg}`);
    if (need <= 0) return L(`내 주사위만으로 ${mine}개 — 확실히 맞습니다`, `My dice alone make ${mine} — certainly true`);
    if (need > U) return L("남은 주사위로는 불가능 — 확실한 거짓말", "Impossible with the dice left — certainly false");
    return L(`내 주사위 <b>${mine}</b>개 + 나머지 ${U}개 중 <b>${need}</b>개 이상 필요 (평균 ${avg})`,
      `Mine <b>${mine}</b> + need <b>${need}</b>+ of the other ${U} (average ${avg})`);
  }

  /* The chance of "at least k" for one face over a few quantities — my picked face (spectators: the current bid's face).
     Only drawn where there is room: on the felt (portrait, spectators) or under the picker (players, landscape).
     Tapping a row picks that quantity. */
  function ladder() {
    const v = M.v;
    for (const k of ["ladder", "ladder2"]) { R(k).innerHTML = ""; R(k).hidden = true; }
    if (v.phase !== "bid") return;
    const last = lastBid(v), player = !spec() && !iAmOut(v);
    const f = player && sel.f ? sel.f : last ? last.f : 0;
    if (!f) return;
    const side = sideways.matches, sc = parseFloat(wrap.style.getPropertyValue("--s")) || 0;
    const inDock = side && player, box = R(inDock ? "ladder2" : "ladder");
    let free;
    if (inDock) {
      const d = R("dock");
      free = d.clientHeight - ["mine", "hint", "pick"].reduce((a, k) => a + R(k).offsetHeight, 0) - 3 * 5 - 22;
    } else {
      const histH = [...R("hist").children].reduce((a, c) => a + c.offsetHeight + 2, 0);     // natural height (the list itself stretches)
      free = R("mid").clientHeight - R("cur").offsetHeight - (side ? 0 : Math.min(histH, 4 * 26 + 34)) - 14;
    }
    const rowH = 22 + 6 * sc;
    let rows = Math.min(8, v.total, Math.floor((free - 24) / rowH));
    if (rows < 3) return;
    const T = v.total, minQ = minQty(last, f, v.wild, T);
    const mark = player && sel.f === f ? sel.q : last && last.f === f ? last.q : minQ || 1;
    const k0 = clamp(mark - Math.floor(rows / 2), 1, Math.max(1, T - rows + 1));
    let h = `<div class="ld-lh">${dieHTML(f, v.wild && f === 1 ? "w" : "")}<span>${spec() ? L("개수별 맞을 확률 (공개 정보)", "Chance of at least k (public)") : L("개수별 맞을 확률 — 눌러서 고르기", "Chance of at least k — tap to pick")}</span></div>`;
    for (let k = k0; k < k0 + rows && k <= T; k++) {
      const p = pTrue(v, k, f), legal = minQ > 0 && k >= minQ;
      const cls = ["ld-lr"];
      if (k === mark && player) cls.push("sel");
      if (!legal) cls.push("low");
      if (last && last.f === f && last.q === k) cls.push("cur");
      h += `<button class="${cls.join(" ")}" data-q="${k}" style="--h:${hue(p)}"${player && legal ? "" : " disabled"}>` +
        `<span class="k">${L(`${k}개`, `${k}×`)}</span><span class="ld-bar"><i style="width:${(p * 100).toFixed(1)}%"></i></span><b>${pctL(p)}</b></button>`;
    }
    box.innerHTML = h;
    box.style.setProperty("--lrh", rowH + "px");
    box.hidden = false;
  }

  /* ---------- Dock: my dice · hint · picker ---------- */
  function suggest(v) {
    // The raise with the best chance for me (ties → the smaller bid); an opening goes as high as stays ≥ 70 %
    const last = lastBid(v);
    let best = null;
    for (let f = 1; f <= 6; f++) {
      let q = minQty(last, f, v.wild, v.total);
      if (!q) continue;
      if (!last) while (q < v.total && pTrue(v, q + 1, f) >= .7) q++;
      const p = pTrue(v, q, f), s = last ? p : q + p * .5;
      if (!best || s > best.s + 1e-9 || (Math.abs(s - best.s) < 1e-9 && bidRank(q, f, v.wild) < bidRank(best.q, best.f, v.wild))) best = { q, f, s };
    }
    return best;
  }
  function syncSel(v) {
    const last = lastBid(v), key = `${v.round}:${v.bids.length}`;
    if (sel.key !== key) { sel.key = key; sel.touched = false; disarm(); }
    const m = sel.f ? minQty(last, sel.f, v.wild, v.total) : 0;
    if (!sel.touched || !m) {
      const s = suggest(v);
      sel.f = s ? s.f : 0; sel.q = s ? s.q : 0;
    } else sel.q = clamp(sel.q, m, v.total);
  }
  function disarm() { armed = null; clearTimeout(armT); }
  function mine() {
    const v = M.v, box = R("mine");
    if (iAmOut(v)) {
      const o = v.out.indexOf(M.me), n = v.counts.length;
      box.innerHTML = `<div class="ld-outme">${L(`주사위를 모두 잃었습니다 — ${n - o}등`, `Out of dice — ${ordEn(n - o)}`)}</div>`;
      return;
    }
    const f = v.phase === "bid" ? sel.f : 0;
    const dice = v.mine.map(x => {
      let c = v.wild && x === 1 ? "w" : "";
      if (f && x === f) c += " hit";
      else if (f && v.wild && f !== 1 && x === 1) c += " hit";
      return dieHTML(x, c.trim());
    }).join("");
    const k = f ? hits(v.mine, f, v.wild) : 0;
    box.innerHTML = `<span class="ld-mlab">${L("내 주사위", "My dice")}<b>${v.mine.length}${delta(v, M.me)}</b></span><span class="ld-mdice">${dice}</span>` +
      (f ? `<span class="ld-mk">${dieHTML(f)}<b>${k}</b></span>` : "");
  }
  function hint() {
    const v = M.v, h = R("hint");
    const myTurn = !!ctx.myAsk("bid"), last = lastBid(v);
    let t;
    if (v.phase === "over") t = v.winner === M.me ? L("🏆 내가 이겼습니다!", "🏆 You won!") : L(`🏆 ${who(v.winner)} 님 승리`, `🏆 ${who(v.winner)} wins`);
    else if (v.phase === "reveal") t = L("모두 공개 중…", "Revealing…");
    else if (iAmOut(v)) t = L("끝까지 구경하세요 — 누가 마지막까지 남을까요?", "Watch to the end — who will last?");
    else if (myTurn) t = last ? L(`<b>내 차례</b> — ${bidL(last.q, last.f)}보다 높게, 또는 <b>거짓말!</b>`, `<b>Your turn</b> — beat ${bidL(last.q, last.f)} or call <b>Liar!</b>`)
      : L(`<b>내 차례</b> — 첫 입찰을 하세요${v.wild ? " (1은 첫 입찰 불가)" : ""}`, `<b>Your turn</b> — make the opening bid${v.wild ? " (not on 1s)" : ""}`);
    else if (v.turn >= 0) t = L(`${esc(nm(v.turn))} 님 차례 — 눈을 눌러 미리 확률을 볼 수 있어요`, `${esc(nm(v.turn))}'s turn — tap a face to check the odds`);
    else t = "";
    h.innerHTML = t;
  }
  function picker() {
    const v = M.v, box = R("pick");
    if (iAmOut(v) || v.phase !== "bid") { box.innerHTML = ""; box.hidden = true; return; }
    box.hidden = false;
    syncSel(v);
    const last = lastBid(v), myTurn = !!ctx.myAsk("bid") && !sent, U = unknown(v);
    let h = `<div class="ld-cap"><span>${L("눈 고르기 · 탁자 전체 예상 개수", "Pick a face · expected on the table")}</span>` +
      `<span>${L(`나 ${v.mine.length} + 남 ${U}`, `mine ${v.mine.length} + others ${U}`)}</span></div><div class="ld-faces">`;
    for (let f = 1; f <= 6; f++) {
      const m = minQty(last, f, v.wild, v.total), ex = hits(v.mine, f, v.wild) + U * faceP(f, v.wild);
      h += `<button class="ld-face${f === sel.f ? " sel" : ""}" data-f="${f}"${m ? "" : " disabled"} aria-label="${L(`${f} 고르기`, `Pick ${f}s`)}">` +
        `${dieHTML(f, v.wild && f === 1 ? "w" : "")}<small>≈${ex.toFixed(1)}</small></button>`;
    }
    h += "</div>";
    const ok = sel.f > 0;
    const m = ok ? minQty(last, sel.f, v.wild, v.total) : 0;
    const p = ok ? pTrue(v, sel.q, sel.f) : 0;
    h += `<div class="ld-row"><div class="ld-step"><button data-k="-"${ok && sel.q > m ? "" : " disabled"} aria-label="${L("개수 줄이기", "Fewer")}">−</button>` +
      `<b>${ok ? sel.q : "–"}<small>${L("개", "×")}</small></b><button data-k="+"${ok && sel.q < v.total ? "" : " disabled"} aria-label="${L("개수 늘리기", "More")}">+</button></div>` +
      `<button class="btn primary ld-go"${myTurn && ok ? "" : " disabled"}><span>${L("입찰", "Bid")} <b>${ok ? bidL(sel.q, sel.f) : "–"}</b></span>` +
      `<small style="--h:${hue(p)}">${L("맞을 확률", "true")} <i>${ok ? pctL(p) : "–"}</i></small></button></div>`;
    const pl = last ? pTrue(v, last.q, last.f) : 0;
    const pe = last ? chanceExact(v.mine, U, last.q, last.f, v.wild) : 0;
    const can = myTurn && !!last;
    h += `<div class="ld-row"><button class="btn ld-liar${armed === "liar" ? " armed" : ""}" data-a="liar"${can ? "" : " disabled"}>` +
      `<span>${armed === "liar" ? L("한 번 더 눌러 확정!", "Tap again to call!") : L("거짓말!", "Liar!")}</span>` +
      `<small>${last ? L(`이길 확률 ${pctL(1 - pl)}`, `win chance ${pctL(1 - pl)}`) : L("첫 입찰에는 못 외침", "not on the opening")}</small></button>`;
    if (v.spot) h += `<button class="btn ld-spot${armed === "spot" ? " armed" : ""}" data-a="spot"${can ? "" : " disabled"}>` +
      `<span>${armed === "spot" ? L("한 번 더 눌러 확정!", "Tap again!") : L("정확히!", "Spot on!")}</span>` +
      `<small>${last ? L(`딱 맞을 확률 ${pctL(pe)}`, `exact ${pctL(pe)}`) : "–"}</small></button>`;
    h += "</div>";
    box.innerHTML = h;
  }
  /* One action per turn: block double taps until the next state arrives (or a rejected action times out) */
  let sentT = 0;
  function sendOnce(a) {
    sent = true;
    if (!ctx.send(a)) { sent = false; return; }
    clearTimeout(sentT);
    sentT = setTimeout(() => { if (sent) { sent = false; if (M) picker(); } }, 3000);
  }
  R("pick").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b || b.disabled || !M || M.v.phase !== "bid") return;
    const v = M.v, last = lastBid(v);
    if (b.dataset.f) {
      const f = +b.dataset.f, m = minQty(last, f, v.wild, v.total);
      if (!m) return;
      if (sel.f !== f) { sel.f = f; sel.q = m; }
      sel.touched = true;
      ctx.sound.pop ? ctx.sound.pop() : ctx.sound.tick();
    } else if (b.dataset.k) {
      const m = minQty(last, sel.f, v.wild, v.total);
      sel.q = clamp(sel.q + (b.dataset.k === "+" ? 1 : -1), m, v.total);
      sel.touched = true;
      ctx.sound.tick();
    } else if (b.classList.contains("ld-go")) {
      if (!ctx.myAsk("bid") || sent) return;
      myBidRect = b.getBoundingClientRect();
      sendOnce({ t: "bid", q: sel.q, f: sel.f });
    } else if (b.dataset.a) {
      const a = b.dataset.a;
      if (!ctx.myAsk("bid") || sent) return;
      if (armed !== a) {
        armed = a; clearTimeout(armT);
        armT = setTimeout(() => { armed = null; if (M) picker(); }, 3000);
        ctx.buzz(20);
      } else {
        disarm();
        sendOnce({ t: a });
      }
    }
    picker(); mine(); ladder();
  });
  const onLadder = e => {
    const b = e.target.closest("button");
    if (!b || b.disabled || !M || M.v.phase !== "bid" || !sel.f) return;
    sel.q = +b.dataset.q; sel.touched = true;
    ctx.sound.tick();
    picker(); mine(); ladder();
  };
  R("ladder").addEventListener("click", onLadder);
  R("ladder2").addEventListener("click", onLadder);

  /* ---------- Reveal overlay ---------- */
  function clearRv() { rvTimers.forEach(clearTimeout); rvTimers = []; }
  function verdictHTML(v, X) {
    const lose = p => `<span class="ld-nw">${p === M.me ? L("내 주사위 -1", "you lose a die") : L(`${esc(nm(p))} 님 주사위 -1`, `${esc(nm(p))} loses a die`)}</span>`;
    let t;
    if (X.kind === "liar") t = X.count >= X.q ? `${L("입찰이 맞았습니다!", "The bid held!")} ${lose(X.caller)}` : `${L("허풍이었습니다!", "A bluff!")} ${lose(X.bidder)}`;
    else if (!X.exact) t = `${L("딱 맞지 않았습니다 —", "Not exact —")} ${lose(X.caller)}`;
    else if (X.gainer >= 0) t = X.gainer === M.me ? L("딱 맞았습니다! 내 주사위 +1", "Exactly! You get a die back") : L(`딱 맞았습니다! ${esc(nm(X.gainer))} 님 주사위 +1`, `Exactly! ${esc(nm(X.gainer))} gets a die back`);
    else t = L("딱 맞았습니다! (주사위가 이미 가득)", "Exactly! (already at full dice)");
    if (X.out >= 0) t += `<br><span class="ld-outline">${X.out === M.me ? L("탈락했습니다 💀", "You're out 💀") : L(`${esc(nm(X.out))} 님 탈락 💀`, `${esc(nm(X.out))} is out 💀`)}</span>`;
    if (v.phase === "over" && v.winner >= 0) t += `<br><span class="ld-winline">🏆 ${v.winner === M.me ? L("내가 이겼습니다!", "You win!") : L(`${esc(nm(v.winner))} 님 승리!`, `${esc(nm(v.winner))} wins!`)}</span>`;
    return t;
  }
  function revealView(animate) {
    const v = M.v, rv = R("rv"), X = v.reveal;
    clearRv();
    if (!X || v.phase === "bid") { rv.hidden = true; rv.innerHTML = ""; rvKey = ""; return; }
    rv.hidden = false;
    rvKey = `${v.round}`;
    const isHit = d => d === X.f || (X.wild && X.f !== 1 && d === 1);
    const seats = X.all.map((d, p) => (d.length ? p : -1)).filter(p => p >= 0);
    let hi = 0;
    const rows = seats.map(p => {
      const ds = X.all[p].slice().sort((a, b) => (isHit(b) - isHit(a)) || ((b === X.f) - (a === X.f)) || a - b);
      const k = ds.filter(isHit).length;
      const dice = ds.map(d => (isHit(d) ? dieHTML(d, "cnt" + (d !== X.f ? " wild" : "") + (animate ? "" : " on"), ` data-h="${hi++}"`) : dieHTML(d, "miss"))).join("");
      const cls = ["ld-rr"];
      if (!animate) cls.push("lift");
      if (p === X.loser) cls.push("lose");
      if (p === X.gainer) cls.push("gain");
      const role = p === X.caller ? `<em class="ld-role c">${X.kind === "spot" ? L("정확히", "Spot") : L("거짓말", "Liar")}</em>`
        : p === X.bidder ? `<em class="ld-role b">${L("입찰", "Bid")}</em>` : "";
      const plus = p === X.gainer ? '<span class="ld-die plus"></span>' : "";     // the die won back
      return `<div class="${cls.join(" ")}" data-p="${p}"><span class="ld-rn">${avatarHTML(nm(p), p, "sm")}<span>${who(p)}</span>${role}</span>` +
        `<span class="ld-rd"><span class="ld-cupx"></span>${dice}${plus}</span><b class="ld-rk">${k}</b></div>`;
    }).join("");
    const shout = X.kind === "spot" ? L("\"정확히!\"", "\"Spot on!\"") : L("\"거짓말!\"", "\"Liar!\"");
    const held = X.kind === "spot" ? X.exact : X.count >= X.q;
    rv.innerHTML = `<div class="ld-rvbox">
      <div class="ld-shout">${avatarHTML(nm(X.caller), X.caller, "")}<b>${who(X.caller)}</b><span>${shout}</span></div>
      <div class="ld-rvbid"><span>${X.bidder === M.me ? L("내 입찰", "My bid") : L(`${esc(nm(X.bidder))} 님의 입찰`, `${esc(nm(X.bidder))}'s bid`)}</span>${chipHTML(X.q, X.f)}<span class="say">${bidL(X.q, X.f)}</span></div>
      <div class="ld-rvrows${seats.length > 3 ? " many" : ""}">${rows}</div>
      <div class="ld-rvfoot">
        <div class="ld-count ${held ? "ok" : "no"}"><b data-r="cnt">${animate ? 0 : X.count}</b><small>/ ${X.q}${X.kind === "spot" ? L(" 딱", " exact") : ""}</small></div>
        <div class="ld-verdict">${verdictHTML(v, X)}</div>
        <span class="ld-gravebox">${X.loser >= 0 || X.gainer >= 0 ? dieHTML(6, "dead") : ""}</span>
      </div></div>`;
    rv.classList.toggle("anim", animate);
    rv.classList.toggle("counting", !animate);
    rv.classList.toggle("done", !animate);
    fitRv();
    const loserDie = () => { const r = rv.querySelector(".ld-rr.lose"); const ds = r ? r.querySelectorAll(".ld-rd .ld-die") : []; return ds.length ? ds[ds.length - 1] : null; };
    if (!animate) { const d = loserDie(); if (d) d.classList.add("gone"); return; }
    // Timeline: shout → cups lift row by row → matching dice light up one by one → verdict, the lost die flies off
    const sp = ctx.replay ? .2 : 1;
    const at = (ms, f) => rvTimers.push(setTimeout(f, ms * sp));
    ctx.sound.flip();
    const rowEls = [...rv.querySelectorAll(".ld-rr")];
    rowEls.forEach((r, i) => at(650 + i * 120, () => { r.classList.add("lift"); if (i % 2 === 0) ctx.sound.deal(); }));
    const t1 = 650 + rowEls.length * 120 + 350;
    const hitEls = [...rv.querySelectorAll("[data-h]")];
    const step = Math.min(230, 1500 / Math.max(1, hitEls.length));
    const cnt = rv.querySelector('[data-r="cnt"]');
    at(t1 - 150, () => rv.classList.add("counting"));
    hitEls.forEach((e, i) => at(t1 + i * step, () => { e.classList.add("on"); cnt.textContent = String(i + 1); ctx.sound.tick(); }));
    at(t1 + hitEls.length * step + 300, () => {
      rv.classList.add("done");
      const meLost = X.loser === M.me, meGain = X.gainer === M.me;
      const meWon = M.me >= 0 && !meLost && (X.caller === M.me || X.bidder === M.me);
      if (meLost) { ctx.sound.bad(); if (!ctx.replay) ctx.buzz([60, 40, 60]); } else if (meGain || meWon) ctx.sound.good(); else ctx.sound.place();
      const grave = rv.querySelector(".ld-gravebox .ld-die");
      const d = loserDie();
      if (d && grave) { const r = d.getBoundingClientRect(); d.classList.add("gone"); ctx.fly(r, pin(grave), { ms: 520, spin: 200 }); }
      const plus = rv.querySelector(".ld-die.plus");
      if (plus && grave) ctx.fly(grave, pin(plus), { ms: 520, spin: -200 });
    });
  }
  /* Size the revealed dice so every row fits the overlay */
  function fitRv() {
    const rv = R("rv");
    if (rv.hidden) return;
    const rows = rv.querySelector(".ld-rvrows");
    if (!rows) return;
    const nRows = rows.children.length;
    let maxD = 1;
    for (const r of rows.children) maxD = Math.max(maxD, r.querySelectorAll(".ld-rd .ld-die").length);
    const W = Math.min(sideways.matches ? 900 : 560, rv.clientWidth - 16), H = rv.clientHeight - 16;
    const two = nRows > 3 && W >= 520 && (sideways.matches || H < 120 + nRows * 40);
    rows.classList.toggle("two", two);
    const perCol = two ? Math.ceil(nRows / 2) : nRows, colW = two ? (W - 6) / 2 : W;
    const fixed = 150 + (H > 520 ? 30 : 0);
    const sc = parseFloat(wrap.style.getPropertyValue("--s")) || 0;
    const byH = (H - fixed) / perCol - 14, byW = (colW - 120 - 30 * sc) / maxD - 5;
    wrap.style.setProperty("--rds", Math.floor(clamp(Math.min(byH, byW), 16, 56)) + "px");
  }

  /* ---------- Sizes ---------- */
  function fit() {
    const H = wrap.clientHeight;
    const side = sideways.matches;
    const s = side ? clamp((H - 290) / 330, 0, 1) : clamp((H - 560) / 360, 0, 1);
    wrap.style.setProperty("--s", s.toFixed(3));
    wrap.classList.toggle("tall", !side && H >= 700);
    wrap.classList.toggle("short", !side && H < 640);
    ladder();
    fitRv();
  }

  /* ---------- Events: sounds and flying ---------- */
  function events(m) {
    const fx = [];
    for (const e of m.ev) {
      if (e.type === "round") {
        [0, 90, 180].forEach(t => setTimeout(() => ctx.sound.deal(), t));
        fx.push(() => {
          R("mine").querySelector(".ld-mdice")?.classList.add("roll");
          const o = R("opps");
          o.classList.add("roll");
          setTimeout(() => o.classList.remove("roll"), 700);
        });
      } else if (e.type === "bid") {
        ctx.sound.chip();
        fx.push(() => {
          const to = R("cur").querySelector(".ld-chip.big");
          const from = e.p === m.me && myBidRect ? myBidRect : seatEl(e.p);
          if (to && from) ctx.fly(from, pin(to), { ms: 430 });
          myBidRect = null;
        });
      } else if (e.type === "call") { if (m.me >= 0 && !ctx.replay) ctx.buzz(40); }
      else if (e.type === "out" && e.p === m.me && m.v.counts.filter(c => c > 0).length > 1 && !ctx.replay) {
        loseT = setTimeout(() => ctx.sound.lose(), 3200);     // out while the game goes on (the shell sounds the game's end)
      }
    }
    return fx;
  }

  function render() {
    if (!M) return;
    lastSize = `${wrap.clientWidth}x${wrap.clientHeight}:${sideways.matches}`;
    wrap.classList.toggle("spec", spec());
    wrap.classList.toggle("en", L(false, true));
    wrap.classList.toggle("wild", !!M.v.wild);
    R("dock").hidden = spec();
    opps(); table();
    if (!spec()) { mine(); hint(); picker(); }
    fit();
  }
  function update(m) {
    const again = m === M || m.ev === lastEv;              // the same msg again: no sounds or animations twice
    M = m;
    if (!again) sent = false;
    const fx = again ? [] : events(m);
    lastEv = m.ev;
    render();
    // The reveal: animate when the call just happened, otherwise draw it finished (remount, replay jump, game over)
    const call = !again && m.ev.some(e => e.type === "call");
    const v = m.v;
    if (!v.reveal || v.phase === "bid") revealView(false);
    else if (call) revealView(true);
    else if (rvKey !== `${v.round}` || R("rv").hidden) revealView(false);
    else {                                                  // same reveal still on screen (e.g. the game just ended): refresh the verdict
      const vd = R("rv").querySelector(".ld-verdict");
      if (vd) vd.innerHTML = verdictHTML(v, v.reveal);
    }
    for (const f of fx) f();
  }
  // Redraw when the stage changes size (window resize, rotation, or the shell's screen-size zoom changing a moment later)
  let lastSize = "";
  function onResize() {
    const k = `${wrap.clientWidth}x${wrap.clientHeight}:${sideways.matches}`;
    if (M && k !== lastSize) { lastSize = k; render(); }
  }
  window.addEventListener("resize", onResize);
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
  if (ro) ro.observe(wrap);

  return {
    update,
    ticker: false,           // the felt shows this round's bids itself
    landscape: true,         // a sideways layout of its own (style.css)
    destroy() { window.removeEventListener("resize", onResize); if (ro) ro.disconnect(); clearRv(); clearTimeout(armT); clearTimeout(sentT); clearTimeout(loseT); root.innerHTML = ""; }
  };
}
