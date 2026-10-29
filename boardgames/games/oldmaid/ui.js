/* Old Maid screen
   Players, portrait: top — opponents in seat order with arrows showing which way cards move (‹) · cards left · finishing place;
     middle — "who is drawing from whom" + the face-down cards of the player being drawn from (large on my turn) · pair reveal ·
     history; bottom — my summary (cards · joker · pair odds) · hint · my hand.
   Players, landscape: the opponents stay on top; the table and my hand sit side by side.
   Spectators (me = -1: watching screens, replays from the public seat): no hand and nothing to tap. Every seat sits around the
     table with its face-down cards, the current draw is in the middle with a tracker of the ranks already paired off.
   Sizes come from the measured screen — spare room makes the cards bigger.
   Flying cards (ctx.fly): the drawn card flies from the fan to the drawer (face up into my hand when I draw), pairs fly to the middle. */
import { cardHTML, rankLabel, rankOf, isJoker } from "../../core/cards.js";
import { L } from "../../core/i18n.js";

const ordEn = n => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
const place = n => L(`${n}등`, ordEn(n));
const LANDSCAPE = "(orientation: landscape) and (min-aspect-ratio: 4/3)";        // the same query as in style.css
const deckNow = () => document.documentElement.dataset.deck || "classic";         // the chosen face design (see core/cards.js)

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "om");
  wrap.innerHTML = `
    <div class="om-opps" data-r="opps"></div>
    <div class="om-body">
      <div class="om-table felt" data-r="table">
        <div class="om-who" data-r="who"></div>
        <div class="om-fan" data-r="fan"></div>
        <div class="om-ranks" data-r="ranks" hidden></div>
        <div class="om-log" data-r="log"></div>
        <div class="om-pile" data-r="pile"></div>
        <div class="om-pair" data-r="pair" hidden></div>
      </div>
      <div class="dock om-dock" data-r="dock">
        <div class="om-me" data-r="me"></div>
        <div class="hint" data-r="hint"></div>
        <div class="om-hand" data-r="hand"></div>
      </div>
    </div>
    <div class="om-opps om-opps2" data-r="opps2"></div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);
  const sideways = matchMedia(LANDSCAPE);
  let M = null, busy = false, lastDrawn = null, prevHand = [], logEv = null, pairT = 0;
  let log = [];              // history lines as functions → HTML, built in the current language at render time
  let geo = { cw: 60, ch: 85, rows: 1, per: 1, gap: 0 }, fgeo = { cw: 60, ch: 85, rows: 1, per: 1, gap: 0 };

  const names = () => (M ? M.players.map(p => p.name) : []);
  const watching = () => !!M && M.me < 0;
  const cardLabel = c => (c === "JC" ? L("조커", "Joker") : ({ S: "♠", H: "♥", D: "♦", C: "♣" })[c[0]] + rankLabel(+c.slice(1)));
  /* Every card gets "om-c": its face scales with --cw (style.css), also on flying copies outside .om */
  const card = (c, extra = "") => cardHTML(c, "om-c " + extra);
  /* A card showing only its rank (suit unknown) — pairs matched by others. Same parts as cardHTML, so every face design works */
  const rankCard = r => {
    const t = rankLabel(r);
    return `<div class="pc om-c om-rk d-${deckNow()}"><span class="pc-corner">${t}</span><span class="pc-mid">${t}</span>` +
      `<span class="pc-rk"><b>${t}</b></span><span class="pc-corner br">${t}</span></div>`;
  };
  function nextWith(v, p) {
    const n = v.sizes.length;
    for (let k = 1; k <= n; k++) { const q = (p + k) % n; if (v.sizes[q] > 0) return q; }
    return -1;
  }
  function prevWith(v, p) {                                   // the player who draws from p's hand
    const n = v.sizes.length;
    for (let k = 1; k < n; k++) { const q = (p - k + n) % n; if (v.sizes[q] > 0) return q; }
    return -1;
  }

  /* ---------- Seats ---------- */
  /* Links lit by the live draw: seat k → k+1 for every k from the drawer to the victim, even past players who are already out */
  function liveLinks() {
    const v = M.v, n = v.sizes.length, live = new Set();
    if (v.phase === "play" && v.victim >= 0) for (let k = v.turn; k !== v.victim && live.size < n; k = (k + 1) % n) live.add(k);
    return live;
  }
  const arrow = on => `<span class="om-arr${on ? " on" : ""}"><i>‹</i></span>`;
  /* One seat. full (spectators): bigger, with its face-down cards drawn as a small fan */
  function seat(p, full) {
    const v = M.v, pl = M.players[p] || { name: "?" }, c = v.sizes[p], o = v.out.indexOf(p), playing = v.phase === "play";
    const cls = ["om-opp"];
    if (playing && p === v.turn) cls.push("turn");
    if (playing && p === v.victim) cls.push("victim");
    if (o >= 0) cls.push(p === v.loser ? "loser" : "done");
    const tag = pl.kind === "ai" ? '<span class="om-ai">AI</span>' : pl.kind === "away" ? `<span class="om-ai away">${L("비움", "away")}</span>` : "";
    const badge = playing && p === v.turn ? `<em class="om-tag now">${L("뽑는 중", "Drawing")}</em>` : playing && p === v.victim ? `<em class="om-tag vic">${L("뽑힘", "Target")}</em>` : "";
    const tight = !full && v.sizes.length >= 6 && !sideways.matches;            // the crowded portrait row
    const cnt = o >= 0 ? (p === v.loser ? `<span class="om-place bad">${tight ? L("🃏도둑", "Maid") : `🃏 ${L("도둑", "Old Maid")}`}</span>` : `<span class="om-place">🏁 ${place(o + 1)}</span>`)
      : `${full ? "" : '<i class="om-ob"></i>'}<b>${c}</b><small>${L("장", c === 1 ? "card" : "cards")}</small>`;
    const fan = full && c ? `<div class="om-mf" style="--n:${c}">${"<i></i>".repeat(c)}</div>` : "";
    return `<div class="${cls.join(" ")}" data-p="${p}">${badge}${tag}${avatarHTML(pl.name, p, "sm")}<div class="om-on">${esc(pl.name)}</div>${fan}<div class="om-oc">${cnt}</div></div>`;
  }
  /* Players: the opponents after me in seat order — cards move from right to left (me ‹ A ‹ B ‹ me) */
  function opps() {
    const v = M.v, me = M.me, n = v.sizes.length, box = R("opps"), live = liveLinks();
    const order = [];
    for (let k = 1; k < n; k++) order.push((me + k) % n);
    const meCap = L("나", "Me");
    let h = `<span class="om-cap${live.has(me) ? " on" : ""}"><i>${meCap}</i>‹</span>`;
    order.forEach((p, i) => { h += seat(p, false); if (i < order.length - 1) h += arrow(live.has(p)); });
    h += `<span class="om-cap${live.has(order[order.length - 1]) ? " on" : ""}">‹<i>${meCap}</i></span>`;
    box.innerHTML = h;
    box.classList.toggle("many", order.length >= 5 && !sideways.matches);   // landscape has the width for full tiles
    R("opps2").innerHTML = "";
  }
  /* Spectators: all seats round the table — the first half on top (left column in landscape), the second half below
     (right column) running back, so the loop is closed and cards always move against the seat order */
  function seats() {
    const n = M.v.sizes.length, t = Math.ceil(n / 2), live = liveLinks();
    const row = (a, b) => { let h = ""; for (let p = a; p < b; p++) { h += seat(p, true); if (p < b - 1) h += arrow(live.has(p)); } return h; };
    R("opps").innerHTML = row(0, t);
    R("opps").classList.remove("many");
    R("opps2").innerHTML = row(t, n);
  }

  /* ---------- Middle ---------- */
  function table() {
    const v = M.v, me = M.me, nm = names(), spec = watching();
    const who = R("who");
    if (v.phase === "play" && v.victim >= 0) {
      const side = (p, role) => `<span class="om-side ${role}">${avatarHTML(nm[p], p, "lg")}<b>${p === me ? L("나", "Me") : esc(nm[p])}</b>` +
        `<small>${L(`${v.sizes[p]}장`, `${v.sizes[p]} card${v.sizes[p] === 1 ? "" : "s"}`)}</small></span>`;
      who.innerHTML = side(v.turn, "drawer") + `<span class="om-flow"><i>${L("뽑기", "draws from")}</i><span>◀ 🂠 ◀</span></span>` + side(v.victim, "victim");
      who.classList.toggle("mine", !!ctx.myAsk("draw"));
    } else {
      const lost = v.loser !== null && v.loser !== undefined;
      who.innerHTML = v.phase === "over" ? `<span class="om-over">${L("게임 끝", "Game over")} — ${lost ? L(`<b>${esc(nm[v.loser])}</b> 님이 도둑 🃏`, `<b>${esc(nm[v.loser])}</b> is the Old Maid 🃏`) : ""}</span>` : "";
    }
    R("pile").innerHTML = L(`버린 짝<b>${v.discards / 2}</b>쌍`, `Pairs<b>${v.discards / 2}</b>out`);
    R("pile").hidden = spec;                       // spectators see the full tracker instead
    R("ranks").hidden = !spec;
    if (spec) ranks();
    R("log").innerHTML = log.slice(-5).reverse().map(f => `<div>${f()}</div>`).join("");
    R("fan").innerHTML = "";
  }
  /* Spectators: which ranks went out in pairs (a rank has four cards = two pairs) */
  function ranks() {
    const v = M.v;
    let h = `<span class="om-rkh">${L(`버린 짝 <b>${v.discards / 2}</b>`, `Pairs out <b>${v.discards / 2}</b>`)}</span>`;
    for (let r = 1; r <= 13; r++) {
      const k = Math.min(2, (v.gone[r] || 0) >> 1);
      h += `<span class="om-rkc${k === 2 ? " full" : ""}"><b>${rankLabel(r)}</b><i>${'<span class="on"></span>'.repeat(k)}${"<span></span>".repeat(2 - k)}</i></span>`;
    }
    R("ranks").innerHTML = h;
  }
  function fanCards() {
    const v = M.v, fan = R("fan");
    fan.innerHTML = "";
    if (v.phase !== "play" || v.victim < 0) return;
    const myTurn = !!ctx.myAsk("draw");
    const n = v.sizes[v.victim], W = fan.clientWidth || 320, g = fgeo;
    fan.style.setProperty("--cw", g.cw + "px");
    fan.style.setProperty("--ch", g.ch + "px");
    let i = 0;
    for (let r = 0; r < g.rows; r++) {
      const cnt = Math.min(g.per, n - r * g.per);
      const xs = spread(cnt, W - 16, g.cw, g.cw + 8).map(x => x + 8);   // margin so tilted outer cards stay inside the table
      for (let k = 0; k < cnt; k++, i++) {
        const idx = i;
        const c = el("button", "om-back" + (myTurn ? " can" : ""), card(null));
        c.style.left = xs[k] + "px";
        c.style.top = (8 + r * g.gap) + "px";
        c.style.setProperty("--rot", (cnt > 1 && g.rows === 1 ? (k - (cnt - 1) / 2) * Math.min(2, 8 / cnt) : 0) + "deg");
        c.disabled = !myTurn;
        c.setAttribute("aria-label", L(`${idx + 1}번째 카드 뽑기`, `Draw card ${idx + 1}`));
        c.onclick = () => {
          if (busy || !ctx.myAsk("draw")) return;
          busy = true; c.classList.add("picked");
          ctx.sound.flip();
          setTimeout(() => { ctx.send({ i: idx }); busy = false; }, 220);
        };
        fan.appendChild(c);
      }
    }
  }

  /* ---------- My summary · hint ---------- */
  function meLine() {
    const v = M.v, me = M.me, nm = names();
    const chips = [];
    const o = v.out.indexOf(me);
    if (o >= 0) chips.push(me === v.loser ? `<span class="om-chip bad">🃏 ${L("도둑", "Old Maid")}</span>` : `<span class="om-chip good">🏁 ${L(`${o + 1}등 탈출`, `Out ${ordEn(o + 1)}`)}</span>`);
    else {
      chips.push(`<span class="om-chip">${L(`내 패 <b>${v.hand.length}</b>장`, `Hand <b>${v.hand.length}</b>`)}</span>`);
      if (v.hand.includes("JC")) chips.push(`<span class="om-chip bad">🃏 ${L("조커 있음", "Joker in hand")}</span>`);
      if (v.phase === "play") {
        const vic = nextWith(v, me), thief = prevWith(v, me);
        if (ctx.myAsk("draw") && v.gone) {
          // Pair odds: for each of my ranks, others hold 3 - (discarded of that rank). Rough estimate assuming they're spread evenly over everyone else's cards
          let T = 0;
          v.sizes.forEach((s, q) => { if (q !== me) T += s; });
          let hit = 0;
          for (const c of v.hand) if (!isJoker(c)) hit += Math.max(0, 3 - (v.gone[rankOf(c)] || 0));
          if (T > 0) {
            const pp = Math.min(100, Math.round(100 * hit / T));
            const ex = T === v.sizes[vic];
            chips.push(`<span class="om-chip ok">${L(`짝 맞을 확률 ${ex ? "" : "약 "}<b>${pp}%</b>`, `Pair chance ${ex ? "" : "~"}<b>${pp}%</b>`)}</span>`);
            if (!v.hand.includes("JC")) chips.push(`<span class="om-chip dim">${L(`조커 ${ex ? "" : "약 "}`, `Joker ${ex ? "" : "~"}`)}${Math.round(100 / T)}%</span>`);
          }
        } else if (vic >= 0 && vic !== me) chips.push(`<span class="om-chip dim">${L(`내가 뽑을 곳 <b>${esc(nm[vic])}</b>`, `Draw from <b>${esc(nm[vic])}</b>`)}</span>`);
        if (thief >= 0 && thief !== me && !ctx.myAsk("draw")) chips.push(`<span class="om-chip dim">${L(`날 뽑는 사람 <b>${esc(nm[thief])}</b>`, `Drawn by <b>${esc(nm[thief])}</b>`)}</span>`);
      }
    }
    R("me").innerHTML = chips.join("");
  }
  /* In a replay ctx.myAsk() is always null, so this never says "your turn" there */
  function hint() {
    const v = M.v, me = M.me, nm = names(), h = R("hint");
    const myTurn = !!ctx.myAsk("draw");
    let t;
    if (v.phase === "over") t = me === v.loser ? L("조커를 끝까지 들고 있었습니다… 🃏", "You were left holding the joker… 🃏") : L("게임 끝", "Game over");
    else if (myTurn) t = L(`<b>내 차례</b> — ${esc(nm[v.victim])} 님의 카드 한 장을 누르세요`, `<b>Your turn</b> — tap one of ${esc(nm[v.victim])}'s cards`);
    else if (v.out.includes(me)) t = L("패를 다 털었습니다 — 구경 중 🎉", "You're out of cards — watching 🎉");
    else if (v.turn === me) t = L(`<b>나</b> — ${esc(nm[v.victim])} 님의 패에서 뽑기`, `<b>You</b> draw from ${esc(nm[v.victim])}'s hand`);   // replays
    else if (v.victim === me) t = L(`<b>${esc(nm[v.turn])}</b> 님이 <b>내 패</b>에서 뽑는 중…`, `<b>${esc(nm[v.turn])}</b> is drawing from <b>your hand</b>…`) +
      (v.hand.includes("JC") ? L(" 조커를 가져가라! 🤞", " Take the joker! 🤞") : "");
    else t = L(`${esc(nm[v.turn])} 님이 ${esc(nm[v.victim])} 님의 패에서 뽑는 중`, `${esc(nm[v.turn])} is drawing from ${esc(nm[v.victim])}'s hand`);
    h.innerHTML = t;
  }

  /* ---------- My hand ---------- */
  function spread(n, W, cw, maxStep) {
    if (!n) return [];
    const step = n > 1 ? Math.min(maxStep, (W - 4 - cw) / (n - 1)) : 0;
    const start = (W - (step * (n - 1) + cw)) / 2;
    return Array.from({ length: n }, (_, i) => start + i * step);
  }
  /* Fit n cards as large as possible within height budget and width W (minVis: minimum visible width when overlapped) */
  function cardGeo(n, W, budget, cwMax, minVis, top, more = 1.12) {
    let best = null;
    n = Math.max(1, n);
    for (let rows = 1; rows <= 4; rows++) {
      const per = Math.ceil(n / rows);
      const byH = (budget - top) / (1 + .55 * (rows - 1)) / 1.42;
      const byW = per > 1 ? Math.min(W / (1 + .38 * (per - 1)), W - 4 - minVis * (per - 1)) : W;
      const cw = Math.max(30, Math.floor(Math.min(cwMax, byH, byW)));
      if (!best || cw > best.cw * more) best = { rows, per, cw, ch: Math.round(cw * 1.42) };   // add a row only if cards grow by more than `more`×
      if (per <= 1) break;
    }
    const rest = budget - top - best.ch;
    best.gap = best.rows > 1 ? Math.round(Math.min(best.ch + 6, Math.max(best.ch * .55, rest / (best.rows - 1)))) : 0;
    best.h = top + best.ch + (best.rows - 1) * best.gap + 2;
    return best;
  }
  function hand() {
    const v = M.v, box = R("hand");
    box.innerHTML = "";
    if (!v.hand.length) return;                           // out of cards (or watching) — no hand area
    const W = box.clientWidth || 340, g = geo;
    box.style.setProperty("--cw", g.cw + "px");
    box.style.setProperty("--ch", g.ch + "px");
    let i = 0;
    for (let r = 0; r < g.rows; r++) {
      const row = v.hand.slice(r * g.per, (r + 1) * g.per);
      const xs = spread(row.length, W, g.cw, g.cw + 6);
      row.forEach((c, k) => {
        const d = el("div", "om-card" + (c === lastDrawn ? " new" : "") + (c === "JC" ? " jk" : ""), card(c));
        d.style.left = xs[k] + "px";
        d.style.top = (12 + r * g.gap) + "px";
        d.style.zIndex = String(++i);
        box.appendChild(d);
      });
    }
  }

  /* ---------- Fitting (layout pixels: the page may be zoomed) ---------- */
  function fit() {
    const v = M.v, H = wrap.clientHeight, W = wrap.clientWidth, side = sideways.matches, spec = watching();
    wrap.classList.toggle("tall", !spec && H >= (side ? 560 : 700));
    // Spectators: one size factor for seats and text, so a TV gets everything bigger.
    // Landscape: the taller seat column (ceil(n/2) seats of ≈ 48·s px, arrows of 17·s px between them) must fit the height.
    const t = Math.ceil(v.sizes.length / 2);
    const s = !spec ? 1 : side ? Math.max(.7, Math.min(1.9, W / 840, H / 350, (H - 20) / (65 * t - 17)))
      : Math.max(.85, Math.min(1.8, W / 390, H / 620));
    wrap.style.setProperty("--s", s.toFixed(3));
    const hb = R("hand"), table = R("table"), dock = R("dock");
    hb.style.height = "0px";
    const n = spec ? 0 : v.hand.length;
    if (n) {
      const hw = hb.clientWidth || W - 20;
      if (side) {                                     // landscape: the hand fills the dock beside the table
        const cs = getComputedStyle(dock);
        const room = dock.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - R("me").offsetHeight - R("hint").offsetHeight - 4;
        geo = cardGeo(n, hw, Math.max(70, room), Math.min(hw / 3.4, 160), 26, 12);
      } else {
        const rest = Math.max(180, H - R("opps").offsetHeight - dock.offsetHeight - 8);
        geo = cardGeo(n, hw, Math.max(80, Math.min(rest * .45, rest - 200)), Math.min(hw / 3.4, Math.max(60, rest * .18)), 26, 12);
      }
      hb.style.height = geo.h + "px";
    }
    // Table: size of the cards to draw from (bigger on my turn — easier to tap)
    const fh = table.clientHeight, fw = table.clientWidth - 16;
    const whoH = R("who").offsetHeight, rkH = spec ? R("ranks").offsetHeight + 4 : 0;
    const LH = Math.round(18 * s);
    wrap.style.setProperty("--lh", LH + "px");
    const fanBudget = Math.max(70, fh - whoH - rkH - LH - 34);
    const vn = v.phase === "play" && v.victim >= 0 ? v.sizes[v.victim] : 0;
    const myTurn = !!ctx.myAsk("draw");
    // Face-down cards look best in one row — use two only when they get too crowded
    const cap = spec ? 110 * s : (myTurn ? 120 : 96) * (side ? Math.max(1, fh / 430) : 1);   // big landscape screens: bigger
    fgeo = cardGeo(vn, fw - 16, fanBudget, Math.min(fw / (myTurn ? 3 : 3.6), cap), myTurn ? 34 : 18, 8, 1.6);
    R("fan").style.height = (vn ? fgeo.h : 0) + "px";
    const lines = Math.max(0, Math.min(5, Math.floor((fh - whoH - rkH - (vn ? fgeo.h : 0) - 26) / LH)));
    const lg = R("log");
    lg.style.height = lines * LH + "px";
    lg.hidden = !lines;
    // The pair reveal grows with the table
    R("pair").style.setProperty("--pcw", Math.round(Math.max(56, Math.min(150, fw / 4.2, fh / 3.4))) + "px");
  }

  /* ---------- Events: history · pair reveal · sound ---------- */
  function showPair(cards) {
    const box = R("pair");
    box.innerHTML = `<div class="om-pairin"><b>${L("짝!", "Pair!")}</b><div class="om-pc">${cards.join("")}</div><small>${L("짝 맞은 카드 — 버림", "Matched pair — discarded")}</small></div>`;
    box.hidden = false;
    box.classList.remove("on"); void box.offsetWidth; box.classList.add("on");
    clearTimeout(pairT);
    pairT = setTimeout(() => { box.hidden = true; box.classList.remove("on"); }, 1900);
  }
  /* One history line for a draw (the card is only known to the two players involved) */
  function drawLine(e, me, nm) {
    const pr = e.paired ? rankLabel(e.paired) : "";
    if (e.to === me) return () => (e.joker ? L("앗, <b>조커</b>를 뽑았습니다! 🃏", "Oops — you drew the <b>joker</b>! 🃏")
      : e.card ? L(`<b>${esc(nm[e.from])}</b> 님에게서 <b>${esc(cardLabel(e.card))}</b>을(를) 뽑았습니다`, `You drew <b>${esc(cardLabel(e.card))}</b> from <b>${esc(nm[e.from])}</b>`)
      : L(`<b>${esc(nm[e.from])}</b> 님에게서 한 장 뽑았습니다`, `You drew from <b>${esc(nm[e.from])}</b>`)) +
      (e.paired ? L(" → 짝! 버렸습니다", " → a pair! Discarded") : "");
    if (e.from === me) return () => (e.card ? L(`<b>${esc(nm[e.to])}</b> 님이 내 <b>${esc(cardLabel(e.card))}</b>을(를) 가져갔습니다`, `<b>${esc(nm[e.to])}</b> took your <b>${esc(cardLabel(e.card))}</b>`)
      : L(`<b>${esc(nm[e.to])}</b> 님이 내 카드를 가져갔습니다`, `<b>${esc(nm[e.to])}</b> took one of your cards`)) +
      (e.joker ? L(" — 조커 넘김! 😆", " — joker gone! 😆") : "") + (pr ? L(` (짝 ${pr})`, ` (pair of ${pr})`) : "");
    return () => L(`${esc(nm[e.to])} 님이 ${esc(nm[e.from])} 님의 카드를 뽑았습니다`, `${esc(nm[e.to])} drew from ${esc(nm[e.from])}`) +
      (pr ? ` — <b>${L(`짝 ${pr}`, `pair of ${pr}`)}</b>` : "");
  }
  function events(m) {
    const me = m.me, nm = m.players.map(p => p.name);
    lastDrawn = null;
    for (const e of m.ev) {
      if (e.type === "draw") {
        log.push(drawLine(e, me, nm));
        if (e.to === me) lastDrawn = e.card && !e.paired ? e.card : null;
        if (e.paired) {
          let cards;
          if (e.to === me && e.card) {
            const mate = prevHand.find(c => !isJoker(c) && rankOf(c) === e.paired && c !== e.card);
            cards = [mate ? card(mate) : rankCard(e.paired), card(e.card)];
          } else if (e.from === me && e.card) cards = [rankCard(e.paired), card(e.card)];
          else cards = [rankCard(e.paired), rankCard(e.paired)];
          showPair(cards);
        }
        if (e.to === me || e.from === me) e.joker ? (e.to === me ? ctx.sound.bad() : ctx.sound.good()) : ctx.sound.place();
        else ctx.sound.deal();
      } else if (e.type === "out") {
        log.push(() => `🏁 <b>${esc(e.p === me ? L("나", "You") : nm[e.p])}</b> ${L(`탈출 — ${e.place}등`, `${e.p === me ? "are" : "is"} out — ${ordEn(e.place)}`)}`);
        if (e.p === me) ctx.sound.good();
      } else if (e.type === "over") {
        log.push(() => (e.loser !== null && e.loser !== undefined ? L(`🃏 <b>${esc(nm[e.loser])}</b> 님이 도둑!`, `🃏 <b>${esc(nm[e.loser])}</b> is the Old Maid!`) : L("게임 끝", "Game over")));
      }
    }
    if (log.length > 12) log.splice(0, log.length - 12);
  }

  /* ---------- Flying cards ----------
     takeOff() runs before the redraw and notes where the moving cards are; land() flies them to where they are now. */
  const rectOf = e => (e ? e.getBoundingClientRect() : null);
  const handCard = c => R("hand").querySelector(`.pc[data-c="${c}"]`);
  const seatEl = p => wrap.querySelector(`.om-opp[data-p="${p}"]`);
  /* Where a card lands at a seat: the last card of its fan, the card icon, or (crowded rows hide the icon) the count */
  const seatSpot = p => { const t = seatEl(p); return t && [...t.querySelectorAll(".om-mf i:last-child, .om-ob, .om-oc b")].find(e => e.offsetWidth); };
  /* fly() copies its target: give the copy the card size, so the face keeps its proportions outside .om */
  const pin = e => { e.style.setProperty("--cw", e.offsetWidth + "px"); e.style.setProperty("--ch", e.offsetHeight + "px"); return e; };
  /* A card (HTML) flying into a small landing spot, starting at the size it had where it came from */
  function flyInto(from, spot, html, delay = 0) {
    const a = from.getBoundingClientRect ? from.getBoundingClientRect() : from, b = spot.getBoundingClientRect();
    if (!b.width) return;
    html = html.replace("<div ", `<div style="--cw:${spot.offsetWidth}px;--ch:${spot.offsetHeight}px" `);
    ctx.fly(a, spot, { html, scale: Math.max(1, Math.min(8, a.width / b.width)), delay });
  }
  function takeOff(m) {
    if (!M || !m.ev.length) return [];
    const fan = R("fan"), plan = [];
    for (const e of m.ev) {
      if (e.type !== "draw") continue;
      let from = null;
      if (e.from === m.me && e.card) from = rectOf(handCard(e.card));                          // my own card leaving my hand
      if (!from && M.v.victim === e.from && fan.children[e.i]) from = rectOf(fan.children[e.i].firstElementChild);   // the face-down card picked
      const mate = e.to === m.me && e.paired ? prevHand.find(c => !isJoker(c) && rankOf(c) === e.paired && c !== e.card) : null;
      plan.push({ e, from, mateFrom: mate ? rectOf(handCard(mate)) : null });
    }
    return plan;
  }
  function land(plan) {
    const me = M.me, pair = R("pair").hidden ? [] : [...R("pair").querySelectorAll(".om-pc .pc")];
    for (const { e, from, mateFrom } of plan) {
      const src = from || seatEl(e.from);
      if (!src) continue;
      if (e.paired && pair.length === 2) {
        // A pair: the drawn card and its mate meet in the middle
        ctx.fly(src, pin(pair[1]));
        const mfrom = e.to === me ? mateFrom : seatEl(e.to);
        if (mfrom) ctx.fly(mfrom, pin(pair[0]), { delay: 120 });
      } else if (e.to === me) {
        const c = e.card && handCard(e.card);
        if (c) ctx.fly(src, pin(c));                                                   // face up into my hand
      } else {
        const spot = seatSpot(e.to);                                                   // face down to the drawer (my own card stays face up for me)
        if (spot) flyInto(src, spot, e.from === me && e.card ? card(e.card) : card(null));
      }
    }
  }

  function render() {
    if (!M) return;
    wrap.classList.toggle("en", L(false, true));
    wrap.classList.toggle("spec", watching());
    if (watching()) seats(); else { opps(); meLine(); hint(); }
    table();
    fit();
    fanCards(); hand();
  }
  function update(m) {
    const again = m === M || m.ev === logEv;             // called again with the same msg: log · sounds · flights only once
    const plan = again ? [] : takeOff(m);
    M = m;
    if (!again) { logEv = m.ev; events(m); }
    if (!log.length && m.v.last) log.push(drawLine(m.v.last, m.me, names()));   // after a remount or a replay jump: the last move
    render();
    land(plan);
    prevHand = m.v.hand.slice();
  }
  // Redraw when the stage changes size: window resize / rotation, and (ResizeObserver) the screen-size zoom
  let size = "";
  function onResize() {
    const k = wrap.clientWidth + "x" + wrap.clientHeight + (sideways.matches ? "L" : "P");
    if (k !== size) { size = k; if (M) render(); }
  }
  const ro = new ResizeObserver(onResize);
  ro.observe(wrap);
  window.addEventListener("resize", onResize);

  return {
    update,
    ticker: false,           // the in-table history replaces the one-line ticker
    landscape: true,         // a sideways layout of its own (style.css)
    destroy() { ro.disconnect(); window.removeEventListener("resize", onResize); clearTimeout(pairT); root.innerHTML = ""; }
  };
}
