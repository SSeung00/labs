/* One Card screen
   Portrait — top: opponents row in turn order (me › … › me) — arrows · cards left · last action · bust risk · "Next"
     middle: deck (cards left) · top card · "what can be played now" panel (suit to follow · attack stack · how to answer) ·
             recent plays strip · history
     bottom: my summary (cards · playable cards · distance to bust) · hint · my hand (two rows when large) · buttons
   Landscape (phones held sideways, computers, TVs): the seats form a column on the left, the table sits top right and the
     dock (summary · hint · hand, with the buttons beside the hand) bottom right.
   Spectators (me = -1: watching screens, people waiting, public replays): every seat in the strip, no dock — the table and
     the discard pile take the space. Nothing to press.
   Sizes come from the measured screen — spare room makes the cards bigger (no dead space) */
import { cardHTML, cardName, isJoker, rankOf, suitOf, rankLabel, SUITS, SUIT_SYMBOL, SUIT_NAME } from "../../core/cards.js";
import { L, loc } from "../../core/i18n.js";

const NEED_SYM = { S: "♠", H: "♥", D: "♦", C: "♣", B: "♠♣", R: "♥♦" };
const REDS = { H: 1, D: 1, R: 1 };
const AV_COLORS = ["#c9774a", "#5f9e6e", "#5b84c4", "#b05f9a", "#c4a24a", "#4aa3a8", "#8a6fc4", "#c45b5b", "#7a8a5a", "#a87a4a"];   // same order as core/ui.js
/* Attack value (same rule as the engine — used for hint texts) */
const power = c => (c === "JB" ? 5 : c === "JC" ? 7 : rankOf(c) === 2 ? 2 : rankOf(c) === 1 ? (c === "S1" ? 5 : 3) : 0);
const ordEn = n => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
const place = n => L(`${n}등`, ordEn(n));
/* The landscape layout — the same query as in style.css */
const LAND_Q = "(orientation: landscape) and (min-aspect-ratio: 4/3)";
const isLand = () => typeof matchMedia === "function" && matchMedia(LAND_Q).matches;
const LAND_W = 26, LAND_H = 37;            // size of the landing spot for cards drawn by a seat (.oc-land)

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "oc");
  wrap.innerHTML = `
    <div class="oc-opps" data-r="opps"></div>
    <div class="oc-table felt" data-r="table">
      <div class="oc-row">
        <button class="oc-deck" data-r="deck" aria-label="${L("카드 받기", "Draw a card")}"></button>
        <div class="oc-pile" data-r="pile"></div>
        <div class="oc-info" data-r="info"></div>
      </div>
      <div class="oc-side">
        <div class="oc-recent" data-r="recent"></div>
        <div class="oc-log" data-r="log"></div>
      </div>
      <div class="oc-flash" data-r="flash" aria-live="polite"></div>
    </div>
    <div class="dock oc-dock" data-r="dock">
      <div class="oc-me" data-r="me"></div>
      <div class="hint" data-r="hint"></div>
      <div class="oc-hand" data-r="hand"></div>
      <div class="actions">
        <button class="btn" data-r="draw">${L("1장 받기", "Draw 1")}</button>
        <button class="btn primary" data-r="play" disabled>${L("내기", "Play")}</button>
      </div>
    </div>
    <div class="oc-call" data-r="call" hidden></div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);

  let M = null;              // last msg received
  let sel = null;            // selected card
  let busyUntil = 0, busyAsk = 0;   // block double-sending to the same ask right after sending (released shortly if rejected)
  let fresh = [];            // cards just drawn — highlighted
  let topIn = false;         // the top discard just changed
  let hot = -1;              // player who just acted — name chip pops
  let tapped = null;         // {c, r, t}: the card I just played and where it was (DOMRect) — it flies from there to the pile
  let cdT = 0, flashT = 0, busyT = 0, cdAsk = 0, cdEnd = 0, cdTotal = 1;
  let log = [], logEv = null;   // history inside the table instead of the one-line ticker (raw bilingual texts; newest shown first)
  let geo = { cw: 64, ch: 91, rows: 1, gap: 0, lift: 14 };   // my hand's card size (set by fit)

  const names = () => (M ? M.players.map(p => p.name) : []);
  const watching = () => !!M && M.me < 0;                   // spectator: public view, nothing to act on
  const replaying = () => !!M && (!!M.replay || !!ctx.replay);
  const buzz = p => { if (!replaying()) ctx.buzz(p); };     // no vibration while a replay plays
  const myPlay = () => !!(M && M.v.phase === "play" && ctx.myAsk("play"));
  const busy = () => { const a = ctx.myAsk(); return !!a && a.id === busyAsk && Date.now() < busyUntil; };
  function markBusy() {
    const a = ctx.myAsk();
    busyAsk = a ? a.id : 0;
    busyUntil = Date.now() + 1500;
    clearTimeout(busyT); busyT = setTimeout(render, 1600);
  }
  function nextOf(v, p) {
    const n = v.st.length;
    for (let k = 1; k <= n; k++) { const q = ((p + v.dir * k) % n + n) % n; if (v.st[q] === "in") return q; }
    return -1;
  }
  const tilt = c => { let h = 0; for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) % 997; return (h % 25) - 12; };
  const sym = s => `<span class="${REDS[s] ? "oc-r" : "oc-k"}">${NEED_SYM[s] || SUIT_SYMBOL[s]}</span>`;
  const initial = p => esc([...String(names()[p] || "?")][0] || "?");
  const nCards = n => L(`${n}장`, `${n} card${n === 1 ? "" : "s"}`);

  /* Small card (rank above · suit below) — seats · recent strip */
  function mini(c, cls = "") {
    if (isJoker(c)) return `<span class="oc-mc jk${c === "JC" ? " red" : ""} ${cls}"><b>🃏</b><i>${c === "JC" ? L("컬러", "col") : L("흑백", "b/w")}</i></span>`;
    return `<span class="oc-mc${REDS[suitOf(c)] ? " red" : ""} ${cls}"><b>${rankLabel(rankOf(c))}</b><i>${SUIT_SYMBOL[suitOf(c)]}</i></span>`;
  }

  /* ---------- Rule math: what matches or answers right now ---------- */
  function defendText(v) {
    const t = v.top;
    if (t === "JC") return L("컬러 조커는 막을 수 없어요", "nothing (colour joker)");
    if (t === "JB") return L("컬러 조커로만 막아요", "colour joker only");
    const s = suitOf(t), r = rankOf(t);
    if (r === 2) return `2 · ${sym(s)}A · ${L("조커", "joker")}${v.set.three ? ` · ${sym(s)}3 ${L("막기", "cancels")}` : ""}`;
    if (t === "S1") return L("조커로만 막아요", "jokers only");
    return `A · ${L("조커", "joker")}`;
  }
  function whyNot(v) {
    if (v.attack > 0) return L(`공격 +${v.attack} — 막을 수 있는 공격 카드만 낼 수 있어요`, `Attack +${v.attack} — only an attack card that answers it`);
    if (v.need) return L(`지금은 ${NEED_SYM[v.need]} 무늬나 조커만 낼 수 있어요`, `Only ${NEED_SYM[v.need]} or a joker can be played now`);
    return L("맨 위 카드와 무늬나 숫자가 같아야 해요", "Must match the top card's suit or rank");
  }

  /* ---------- Seats: me › A › B › C › me (‹ when reversed); spectators see every seat: 1 › 2 › … › ↺ ----------
     A row on top in portrait, a column on the left in landscape (the arrows turn with it) */
  function seats() {
    const m = M, v = m.v, box = R("opps"), n = v.st.length, me = m.me, spec = me < 0, land = isLand();
    const playing = v.phase === "play";
    const nx = playing ? (v.call ? v.turn : nextOf(v, v.turn)) : -1;   // during the call window: who plays once it closes
    const order = [];
    if (spec) for (let q = 0; q < n; q++) order.push(q);
    else for (let k = 1; k < n; k++) order.push((me + k) % n);
    const seq = spec ? [...order, order[0]] : [me, ...order, me];   // arrow k sits between seq[k] and seq[k+1]
    const fw = v.dir > 0, g = fw ? "›" : "‹";
    // Light the arrow leading from the current player to the next one
    let liveArr = -1;
    if (playing && !v.call) for (let k = 0; k < seq.length - 1; k++) if ((fw ? seq[k] : seq[k + 1]) === v.turn) { liveArr = k; break; }
    const arr = k => `<span class="oc-arr${k === liveArr ? " on" : ""}"><b>${g}</b></span>`;
    const bust = v.set.bust;
    const meCap = L("나", "Me");
    const chip = p => {
      const pl = m.players[p] || { name: "?" }, st = v.st[p], c = v.sizes[p];
      const turn = playing && !v.call && p === v.turn;
      const cls = ["oc-opp"];
      if (turn) cls.push("turn");
      if (st === "bust") cls.push("out");
      if (st === "done") cls.push("done");
      if (v.call && v.call.p === p) cls.push("calling");
      if (p === hot) cls.push("hot");
      let cnt, warn = "";
      if (st === "done") cnt = `<span class="oc-place">🏁 ${place(v.place[p])}</span>`;
      else if (st === "bust") cnt = `<span class="oc-place bad">💥 ${L("파산", "Bust")}</span>`;
      else {
        if (c <= 2) cls.push(c === 1 ? "one" : "two");
        cnt = `<b>${c}</b><small>${c === 1 ? L("장!", "card!") : L("장", "cards")}</small>`;
      }
      if (st === "in" && bust) {
        const left = bust - c;
        warn = left <= 4 ? `<span class="oc-risk">${L(`파산까지 ${left}`, `bust in ${left}`)}</span>`
          : `<span class="oc-bar"><i style="width:${Math.min(100, 100 * c / bust)}%"></i></span>`;
        if (left <= 4) cls.push("risk");
      }
      const a = v.act && v.act[p];
      const last = !a ? '<span class="oc-mc none"></span>' : a.c ? mini(a.c) :
        `<span class="oc-took${a.pen ? " pen" : ""}">+${a.d}</span>`;
      const tag = pl.kind === "ai" ? '<span class="oc-ai">AI</span>' : pl.kind === "away" ? `<span class="oc-ai away">${L("비움", "away")}</span>` : "";
      const badge = turn ? `<em class="oc-tag now">${L("차례", "Turn")}</em>` : p === nx && playing ? `<em class="oc-tag">${L("다음", "Next")}</em>` : "";
      // Face-down fan of the cards held (shown on big seats — TVs, computers)
      const fan = st === "in" && c ? `<span class="oc-fan" aria-hidden="true">${"<i></i>".repeat(Math.min(c, 14))}</span>` : "";
      return `<div class="${cls.join(" ")}" data-p="${p}">${badge}
        <div class="oc-oh">${avatarHTML(pl.name, p, "sm")}${last}<span class="oc-land"></span></div>
        <div class="oc-on">${esc(pl.name)}${tag}</div>
        <div class="oc-oc">${cnt}</div>${fan}${warn}</div>`;
    };
    let h = spec ? "" : `<span class="oc-cap${liveArr === 0 ? " on" : ""}"><i>${meCap}</i><b>${g}</b></span>`;
    order.forEach((p, i) => {
      h += chip(p);
      if (i < order.length - 1) h += arr(spec ? i : i + 1);
    });
    const endOn = liveArr === seq.length - 2 ? " on" : "";
    h += spec ? `<span class="oc-cap end${endOn}" title="${L("처음 자리로", "back to the first seat")}"><b>${g}</b><i>↺</i></span>`
      : `<span class="oc-cap${endOn}"><b>${g}</b><i>${meCap}</i></span>`;
    box.innerHTML = h;
    box.classList.toggle("many", !land && !spec && order.length >= 4);
    box.classList.toggle("two", !land && spec && n >= 5);   // spectators on a phone: two rows of bigger seats
  }
  /* Landscape: share the column's height between the seats. --sh: a seat's height; --sz: the scale of its contents,
     also limited by the column's width (style.css) */
  function seatSize() {
    const box = R("opps"), k = box.querySelectorAll(".oc-opp").length || 1;
    const arrows = box.querySelectorAll(".oc-arr").length, caps = box.querySelectorAll(".oc-cap").length, avail = box.clientHeight - 14;
    let sh = (avail - arrows * 12 - caps * 18) / k;
    const tight = sh < 40;                                // many seats on a short screen: one-line seats, slimmer arrows
    if (tight) sh = (avail - arrows * 8 - caps * 14) / k;
    box.classList.toggle("tight", tight);
    sh = Math.max(28, Math.min(132, sh));
    const sz = Math.min(sh, (box.clientWidth - 10) * .5);
    sh = Math.min(sh, Math.max(sz * 1.35 + 12, sz >= 60 ? sz * 1.6 + 12 : 0));   // no tall empty seats in a narrow column
    box.style.setProperty("--sh", Math.floor(sh) + "px");
    box.style.setProperty("--sz", Math.floor(sz) + "px");
    box.classList.toggle("big", sh >= 76 && sz >= 60);
  }

  /* ---------- Middle ---------- */
  function table() {
    const m = M, v = m.v, mine = myPlay();
    // Deck
    const deck = R("deck");
    const label = mine ? (v.attack > 0 ? L(`${v.attack}장 받기`, `Draw ${v.attack}`) : v.again ? L("받고 끝내기", "Draw & end") : L("1장 받기", "Draw 1")) : L("더미", "Deck");
    deck.innerHTML = (v.deck ? `<span class="oc-stack">${cardHTML(null)}</span>` : `<span class="oc-empty">${L("비었음", "Empty")}</span>`) +
      `<span class="oc-cnt">${v.deck}</span><span class="oc-dlabel">${label}</span>`;
    deck.classList.toggle("can", mine && !busy());
    deck.classList.toggle("atk", mine && v.attack > 0);
    deck.disabled = !mine;
    deck.setAttribute("aria-label", mine ? label : L(`더미 ${v.deck}장`, `Deck: ${v.deck} cards`));

    // Discard pile (the two cards underneath sit at an angle)
    R("pile").innerHTML = v.under.slice(-2).map(c => `<div class="oc-under" style="--r:${tilt(c)}deg">${cardHTML(c)}</div>`).join("") +
      `<div class="oc-top${topIn ? " in" : ""}${v.attack > 0 ? " hot" : ""}">${cardHTML(v.top)}</div>`;
    topIn = false;

    // What can be played now — attack stack · suit to follow · K · normal
    const jk = L("조커", "joker");
    let h;
    if (v.phase !== "play") h = `<div class="oc-i-big">${L("끝", "End")}</div><div class="oc-i-sub">${L("게임 끝", "Game over")}</div>`;
    else if (v.attack > 0) h = `<div class="oc-i-lbl">${L("공격 누적", "Attack stack")}</div><div class="oc-i-big atk">+${v.attack}</div><div class="oc-i-sub">${L("막기", "Answer")}: ${defendText(v)}</div>`;
    else if (v.need) {
      const two = NEED_SYM[v.need].length > 1;
      h = `<div class="oc-i-lbl">${isJoker(v.top) ? L("조커 — 무늬 지정", "Joker — suits set") : L("7 — 무늬 바뀜", "7 — suit changed")}</div>` +
        `<div class="oc-i-big suit${two ? " two" : ""}${REDS[v.need] ? " red" : ""}">${NEED_SYM[v.need]}</div>` +
        `<div class="oc-i-sub">${L(`${two ? "두 무늬 중 하나" : loc(SUIT_NAME[v.need])}만 · 조커 가능`, `${two ? "Either suit" : `${loc(SUIT_NAME[v.need])} only`} · ${jk} OK`)}</div>`;
    }
    else h = `<div class="oc-i-lbl">${L("맞출 것", "Match")}</div><div class="oc-i-big match${rankOf(v.top) === 10 ? " ten" : ""}">${sym(suitOf(v.top))}<small>${L("또는", "or")}</small>${rankLabel(rankOf(v.top))}</div><div class="oc-i-sub">${L("무늬나 숫자 · 조커", "suit or rank · joker")}</div>`;
    if (v.again && v.phase === "play") h += `<div class="oc-i-k">${L("K — 한 장 더", "K — play again")}</div>`;
    const info = R("info");
    info.innerHTML = h;
    info.className = "oc-info" + (v.attack > 0 ? " atk" : v.need ? " need" : "");

    // Recently played cards (oldest → newest)
    const rec = (v.recent || []).slice(-5);
    R("recent").innerHTML = rec.length ? `<span class="oc-rl">${L("최근", "Recent")}</span>` + rec.map((r, i) =>
      `<span class="oc-ri${i === rec.length - 1 ? " now" : ""}">${mini(r.c)}${r.s ? `<em class="${REDS[r.s] ? "red" : ""}">→${SUIT_SYMBOL[r.s]}</em>` : ""}` +
      (r.p < 0 ? `<span class="oc-who first">${L("첫", "1st")}</span>` : `<span class="oc-who" style="--ac:${AV_COLORS[r.p % AV_COLORS.length]}">${initial(r.p)}</span>`) + `</span>`).join('<span class="oc-rarr">›</span>') : "";
    const lines = log.length ? log.slice(-8).reverse() : v.last ? [v.last] : [];
    R("log").innerHTML = lines.map(t => `<div>${esc(ctx.nameText(t))}</div>`).join("");
  }

  /* ---------- "One card!" call window ----------
     Players get the big button over the table and hand. Spectators and replays only see a banner (nothing to press). */
  function callBox() {
    const m = M, v = m.v, box = R("call");
    clearInterval(cdT);
    if (!v.call || v.phase !== "play") { box.hidden = true; box.innerHTML = ""; return; }
    const owner = v.call.p, mine = owner === m.me, ask = ctx.myAsk("call"), land = isLand();
    const pos = (top, left, w) => Object.assign(box.style, { top: top + "px", left: left + "px", width: w ? w + "px" : "", right: w ? "auto" : "0", bottom: w ? "auto" : "0" });
    box.hidden = false;
    if (watching() || replaying()) {
      const t = R("table");
      box.className = "oc-call passive";
      pos(t.offsetTop + t.offsetHeight - 10, t.offsetLeft, t.offsetWidth);
      box.innerHTML = `<div class="oc-callnote">☝️ ${L(`<b>${esc(names()[owner])}</b> 님이 한 장 — 원카드!`, `<b>${esc(names()[owner])}</b> is down to one card — "One card!"`)}</div>`;
      return;
    }
    // Over the table and my hand; the seats stay visible (above in portrait, at the left in landscape)
    if (land) pos(0, R("opps").offsetWidth); else pos(R("opps").offsetHeight, 0);
    box.className = "oc-call" + (mine ? " own" : "");
    box.innerHTML = `
      <div class="oc-callwho">${mine ? L("한 장 남았습니다!", "One card left!") : L(`<b>${esc(names()[owner])}</b> 님이 한 장!`, `<b>${esc(names()[owner])}</b> has one card!`)}</div>
      <button class="oc-callbtn${mine ? " own" : ""}" data-k="call"${ask ? "" : " disabled"}>
        <b>${L("원카드!", "One card!")}</b><small>${mine ? L("외치세요!", "Call it!") : L("잡기!", "Catch!")}</small></button>
      <div class="oc-cd"${ask && ask.ms ? "" : " hidden"}><i data-k="bar"></i><span data-k="sec"></span></div>
      ${!ask ? `<div class="oc-wait">${L("다른 사람을 기다리는 중…", "Waiting for the others…")}</div>` : !mine ? `<button class="oc-skip" data-k="skip">${L("넘어가기", "Skip")}</button>` : ""}`;
    const btn = box.querySelector('[data-k="call"]');
    btn.onclick = () => {
      if (busy() || !ctx.myAsk("call")) return;
      if (ctx.send({ call: true })) { markBusy(); btn.classList.add("hit"); btn.disabled = true; ctx.sound.chip(); buzz(40); }
    };
    const skip = box.querySelector('[data-k="skip"]');
    if (skip) skip.onclick = () => { if (!busy() && ctx.send({ call: false })) { markBusy(); skip.disabled = true; } };
    if (ask && ask.ms) {
      if (ask.id !== cdAsk) { cdAsk = ask.id; cdEnd = Date.now() + ask.ms; cdTotal = Math.max(ask.ms, 1); }   // the countdown carries on across re-renders
      const total = cdTotal, end = cdEnd;
      const bar = box.querySelector('[data-k="bar"]'), sec = box.querySelector('[data-k="sec"]');
      const tick = () => {
        const left = Math.max(0, end - Date.now());
        bar.style.width = (100 * left / total) + "%";
        sec.textContent = (left / 1000).toFixed(1);
        if (!left) clearInterval(cdT);
      };
      tick(); cdT = setInterval(tick, 100);
    }
  }

  /* ---------- My one-line summary ---------- */
  function meLine() {
    const m = M, v = m.v, me = m.me, mine = myPlay(), st = v.st[me], n = v.hand.length;
    const chips = [];
    if (st === "done") chips.push(`<span class="oc-chip good">🏁 ${place(v.place[me])}</span>`);
    else if (st === "bust") chips.push(`<span class="oc-chip bad">💥 ${L("파산", "Bust")}</span>`);
    else {
      chips.push(`<span class="oc-chip${n <= 2 ? " good" : ""}">${L(`내 패 <b>${n}</b>장`, `Hand <b>${n}</b>`)}</span>`);
      if (mine) {
        const k = v.legal.length;
        if (v.attack > 0) chips.push(k ? `<span class="oc-chip ok">${L(`막을 카드 <b>${k}</b>장`, `<b>${k}</b> can answer`)}</span>` : `<span class="oc-chip bad">${L("막을 카드 없음", "Nothing to answer")}</span>`);
        else chips.push(k ? `<span class="oc-chip ok">${L(`낼 수 있음 <b>${k}</b>장`, `<b>${k}</b> playable`)}</span>` : `<span class="oc-chip bad">${L("낼 카드 없음", "Nothing to play")}</span>`);
      } else if (v.phase === "play" && !v.call && nextOf(v, v.turn) === me) chips.push(`<span class="oc-chip gold">${L("다음이 내 차례", "You're next")}</span>`);
      if (v.set.bust) {
        const left = v.set.bust - n;
        chips.push(`<span class="oc-chip${left <= 4 ? " bad" : " dim"}">${L(`파산까지 <b>${left}</b>`, `Bust in <b>${left}</b>`)}</span>`);
      }
    }
    R("me").innerHTML = chips.join("");
  }

  /* ---------- My hand ---------- */
  function spread(n, W, cw, maxStep) {
    if (!n) return [];
    const step = n > 1 ? Math.min(maxStep, (W - 4 - cw) / (n - 1)) : 0;
    const start = (W - (step * (n - 1) + cw)) / 2;
    return Array.from({ length: n }, (_, i) => start + i * step);
  }
  /* As big as possible within the height budget: number of rows · card size */
  function handGeo(n, W, budget, cwMax) {
    const lift = 14, K = .4;                              // overlapped cards still show 40% of their width (at least 30px)
    let best = null;
    for (let rows = 1; rows <= 4; rows++) {
      const per = Math.ceil(n / rows);
      const byH = (budget - lift) / (1 + .56 * (rows - 1)) / 1.42;
      const byW = per > 1 ? Math.min(W / (1 + K * (per - 1)), W - 4 - 30 * (per - 1)) : W;
      const cw = Math.max(36, Math.floor(Math.min(cwMax, byH, byW)));
      // Add a row only if it makes the cards more than 12% bigger
      if (!best || cw > best.cw * 1.12) best = { rows, per, cw, ch: Math.round(cw * 1.42), lift };
      if (per <= 1) break;
    }
    const rest = budget - lift - best.ch;
    best.gap = best.rows > 1 ? Math.round(Math.min(best.ch + 6, Math.max(best.ch * .56, rest / (best.rows - 1)))) : 0;
    best.h = best.lift + best.ch + (best.rows - 1) * best.gap + 2;
    return best;
  }
  function hand() {
    const m = M, v = m.v, box = R("hand"), mine = myPlay();
    box.innerHTML = "";
    const cards = v.hand, n = cards.length;
    if (sel && (!mine || !v.legal.includes(sel))) sel = null;
    if (!n) return;                                       // out or bust — collapse the hand area (shown in the summary · hint)
    const W = box.clientWidth || 340, g = geo;
    box.style.setProperty("--cw", g.cw + "px");
    box.style.setProperty("--ch", g.ch + "px");
    const rows = [];
    for (let r = 0; r < g.rows; r++) rows.push(cards.slice(r * g.per, (r + 1) * g.per));
    let i = 0;
    rows.forEach((row, r) => {
      const xs = spread(row.length, W, g.cw, g.cw + 6);
      row.forEach((c, k) => {
        const can = mine && v.legal.includes(c);
        const cls = (mine ? (can ? "can" : "dim") : "") + (sel === c ? " sel" : "") + (fresh.includes(c) ? " new" : "");
        const b = el("button", "oc-card", cardHTML(c, cls));
        b.style.left = xs[k] + "px";
        b.style.top = (g.lift + r * g.gap) + "px";
        b.style.zIndex = String(++i);
        b.setAttribute("aria-label", cardName(c) + (can ? L(" (낼 수 있음)", " (playable)") : ""));
        b.onclick = () => tap(c);
        box.appendChild(b);
      });
    });
  }

  /* ---------- Fitting: share out the screen ---------- */
  function fit() {
    const v = M.v, H = wrap.clientHeight, W = wrap.clientWidth, spec = watching(), land = isLand();
    if (!H || !W) { geo = handGeo(v.hand.length || 1, W || 340, 120, 60); return; }
    wrap.classList.toggle("tall", !land && H >= 700);
    wrap.classList.toggle("short", !land && H < 600);
    wrap.style.setProperty("--ocH", H + "px");
    const hb = R("hand"), table = R("table"), n = v.hand.length;
    if (land || !spec) wrap.classList.remove("stack");
    if (land) seatSize();
    if (!spec) {
      hb.style.height = "0px";
      const hw = hb.clientWidth || W - 20;
      if (land) {
        // Landscape: the hand shares the right-hand side with the table; the buttons sit beside it
        const top = Math.max(R("me").offsetHeight, R("hint").offsetHeight) + 12;
        const cwMax = Math.min(hw / 4.2, Math.max(56, H * .2), 120);
        if (n) {
          geo = handGeo(n, hw, Math.max(80, Math.min(H * .42, H - top - Math.max(150, H * .45))), cwMax);
          hb.style.height = geo.h + "px";
        }
      } else {
        const fixed = R("opps").offsetHeight + R("dock").offsetHeight + 8;   // includes the margins around the table
        const rest = Math.max(160, H - fixed);
        const cwMax = Math.min(hw / 3.4, Math.max(66, rest * .17));
        const feltMin = Math.max(150, rest * .36);
        if (n) {
          geo = handGeo(n, hw, Math.max(90, Math.min(rest * .6, rest - feltMin)), cwMax);
          hb.style.height = geo.h + "px";
        }
      }
    }
    // Table: the remaining room sets the top card and recent-strip sizes
    const fh = table.clientHeight, fw = table.clientWidth, lg = R("log");
    let tc, mw, lines, LH = 18, noRecent = false;        // LH: height of one history line
    if (land) {
      // deck · pile · info in a row, the recent strip and history beside them
      mw = Math.round(Math.max(20, Math.min(54, fh * .12, fw * .045)));
      if (spec) LH = Math.round(Math.max(18, Math.min(26, mw * .48)));
      const iw = t => Math.round(Math.max(116, Math.min(230, t * .95)));
      const avail = fw - (mw * 5 + 4 * 12 + 18 + 30) - 30;   // keep room for five recent cards
      tc = Math.floor(Math.min(fh - 38, spec ? 560 : 340));
      const rowW = t => 1.25 * t + 2 * Math.max(16, Math.min(30, t * .08)) + iw(t) + 12;   // deck .55 · pile .7 · gaps (style.css) · info
      while (tc > 64 && rowW(tc) > avail) tc -= 2;
      tc = Math.max(64, tc);
      table.style.setProperty("--iw", iw(tc) + "px");
      lines = Math.max(0, Math.min(spec ? 8 : 6, Math.floor((fh - (mw * 1.38 + 22) - 28) / LH)));
    } else if (spec) {
      // Portrait spectators (no hand): the info panel beside the pile as for players, or — when that gives a clearly
      // bigger pile (tall screens) — underneath it (.stack)
      mw = Math.round(Math.max(22, Math.min(44, fh * .08, (fw - 80) / 5.6)));
      const recentH = mw * 1.38 + 20;
      const side = Math.floor(Math.min(fh - recentH - LH - 30, 300, (fw - 150) / (0.7 + .56)));
      const below = ih => Math.floor(Math.min(fh - recentH - ih - 2 * LH - 46, (fw - 40) / 1.3, 360));
      const stack = below(100) > side * 1.1;
      wrap.classList.toggle("stack", stack);
      if (stack) {
        table.style.setProperty("--tc", Math.max(64, below(100)) + "px");
        const ih = R("info").offsetHeight || 100;          // the panel's text scales with --tc: measure it at that size
        tc = Math.max(64, below(ih));
        lines = Math.max(0, Math.min(6, Math.floor((fh - tc - ih - recentH - 52) / LH)));
      } else {
        tc = Math.max(64, side);
        lines = Math.max(0, Math.min(6, Math.floor((fh - tc - recentH - 34) / LH)));
      }
    } else {
      mw = Math.round(Math.max(22, Math.min(44, fh * .1, (fw - 80) / 5.6)));
      const recentH = mw * 1.38 + 20;
      tc = Math.min(fh - recentH - (fh > 230 ? LH : 0) - 30, 230, (fw - 150) / (0.7 + .56));   // top card height (the deck is 0.8×)
      tc = Math.max(64, Math.floor(tc));
      // Show as many history lines as the spare height allows (up to 5)
      lines = Math.max(0, Math.min(5, Math.floor((fh - tc - recentH - 34) / LH)));
      // A very full hand on a small phone leaves too little table for the recent strip: drop the strip, keep the pile
      noRecent = tc + recentH + 30 > fh;
      if (noRecent) tc = Math.max(64, Math.floor(Math.min(fh - 30, 230, (fw - 150) / (0.7 + .56))));
    }
    R("recent").hidden = noRecent;
    table.style.setProperty("--tc", tc + "px");
    table.style.setProperty("--mw", mw + "px");
    table.style.setProperty("--lh", LH + "px");
    lg.style.height = lines * LH + "px";
    lg.hidden = !lines;
  }

  function tap(c) {
    const v = M.v;
    if (!myPlay() || busy()) return;
    if (!v.legal.includes(c)) { ctx.toast(whyNot(v)); ctx.sound.pass(); return; }
    if (sel === c) { play(c); return; }
    sel = c;
    ctx.sound.flip();
    hand(); buttons(); hint();
  }

  async function play(c) {
    const ask = ctx.myAsk("play");
    if (!ask || busy()) return;
    const a = { card: c };
    if (!isJoker(c) && rankOf(c) === 7) {
      const k = { S: 0, H: 0, D: 0, C: 0 };
      for (const x of M.v.hand) if (x !== c && !isJoker(x)) k[suitOf(x)]++;
      const s = await ctx.choose(L("무늬 바꾸기", "Change suit"),
        L(`${esc(cardName(c))} — 다음 사람이 낼 무늬를 고르세요`, `${esc(cardName(c))} — choose the suit the next player must play`),
        SUITS.map(s => ({ value: s, label: `<span class="oc-suit${s === "H" || s === "D" ? " red" : ""}">${SUIT_SYMBOL[s]}</span> ${esc(loc(SUIT_NAME[s]))}`,
          note: L(`내 패에 ${k[s]}장`, `${k[s]} in your hand`) })));
      if (!s) return;
      const now = ctx.myAsk("play");
      if (!now || now.id !== ask.id) { ctx.toast(L("차례가 지나갔습니다", "Your turn has passed")); return; }
      a.suit = s;
    }
    // Where the card is now — it flies from here to the pile when the play comes back
    const pc = [...R("hand").querySelectorAll(".pc")].find(x => x.dataset.c === c);
    const rect = pc ? pc.getBoundingClientRect() : null;
    if (ctx.send(a)) { tapped = rect ? { c, r: rect, t: Date.now() } : null; markBusy(); sel = null; fresh = []; ctx.sound.place(); render(); }
  }

  async function draw() {
    const ask = ctx.myAsk("play");
    if (!ask || busy()) return;
    const v = M.v;
    if (v.attack > 0 && v.legal.length) {
      const ok = await ctx.choose(L("공격 받기", "Take the attack"),
        L(`막을 수 있는 카드가 <b>${v.legal.length}장</b> 있습니다. 그래도 <b>${v.attack}장</b>을 받을까요?`,
          `You have <b>${nCards(v.legal.length)}</b> that can answer it. Draw <b>${v.attack}</b> anyway?`),
        [{ value: "take", label: L(`${v.attack}장 받기`, `Draw ${v.attack}`) }, { value: "", label: L("취소", "Cancel"), note: L("막을 카드를 고릅니다", "Pick a card to answer with") }]);
      if (ok !== "take") return;
      const now = ctx.myAsk("play");
      if (!now || now.id !== ask.id) return;
    }
    if (ctx.send({ draw: true })) { markBusy(); sel = null; ctx.sound.deal(); render(); }
  }
  R("deck").onclick = draw;
  R("draw").onclick = draw;
  R("play").onclick = () => { if (sel) play(sel); };

  /* ---------- Bottom buttons · hint ---------- */
  function buttons() {
    const v = M.v, mine = myPlay();
    const d = R("draw"), p = R("play");
    d.textContent = mine && v.attack > 0 ? L(`${v.attack}장 받기`, `Draw ${v.attack}`) : mine && v.again ? L("1장 받고 끝내기", "Draw 1 & end turn") : L("1장 받기", "Draw 1");
    d.classList.toggle("danger", mine && v.attack > 0);
    d.disabled = !mine || busy();
    p.disabled = !mine || busy() || !sel || !v.legal.includes(sel);
    p.textContent = sel ? L(`${cardName(sel)} 내기`, `Play ${cardName(sel)}`) : L("내기", "Play");
  }
  function hint() {
    const m = M, v = m.v, me = m.me, h = R("hint");
    const nm = names();
    let t, cls = "hint";
    if (v.phase === "over") t = L("게임 끝", "Game over");
    else if (v.call && replaying()) t = L(`<b>${esc(nm[v.call.p])}</b> 님이 한 장 — 원카드!`, `<b>${esc(nm[v.call.p])}</b> is down to one card — "One card!"`);
    else if (v.call) t = v.call.p === me ? L("<b>원카드!</b> 버튼을 눌러 외치세요", "Press <b>One card!</b> to call it")
      : L(`<b>${esc(nm[v.call.p])}</b> 님이 한 장 — 먼저 누르면 잡아요!`, `<b>${esc(nm[v.call.p])}</b> has one card — press first to catch them!`);
    else if (myPlay()) {
      if (v.attack > 0) {
        cls += " oc-alert";
        const list = v.legal.map(c => esc(cardName(c))).join(" · ");
        t = v.legal.length ? L(`<b>공격 +${v.attack}</b> — 막기: ${list} (아니면 ${v.attack}장 받기)`, `<b>Attack +${v.attack}</b> — answer: ${list} (or draw ${v.attack})`)
          : L(`막을 카드가 없습니다 — <b>${v.attack}장</b>을 받으세요`, `Nothing can answer it — draw <b>${v.attack}</b>`);
      }
      else if (!v.legal.length) t = v.again ? L("이어서 낼 카드가 없습니다 — 1장 받고 끝내세요", "Nothing to follow with — draw 1 to end your turn")
        : L("낼 카드가 없습니다 — <b>1장 받기</b>", "Nothing to play — <b>Draw 1</b>");
      else if (sel) t = L(`<b>${esc(cardName(sel))}</b> — 한 번 더 누르거나 「내기」`, `<b>${esc(cardName(sel))}</b> — tap again or press "Play"`);
      else t = v.again ? L("<b>K</b> — 한 장 더 내세요 (없으면 1장 받기)", "<b>K</b> — play another card (or draw 1)")
        : L("<b>내 차례</b> — 초록 테두리 카드를 누르세요", "<b>Your turn</b> — tap a card with a green border");
    }
    else if (v.st[me] === "done") t = L(`카드를 다 냈습니다 — ${v.place[me]}등 🎉`, `You're out of cards — ${ordEn(v.place[me])} 🎉`);
    else if (v.st[me] === "bust") t = L("파산 — 구경 중", "Bust — watching");
    else t = L(`${esc(nm[v.turn] || "")} 님 차례`, `${esc(nm[v.turn] || "")}'s turn`) + (v.attack > 0 ? ` · <b>${L("공격", "Attack")} +${v.attack}</b>` : "");
    h.className = cls;
    h.innerHTML = t;
  }

  /* ---------- Events: sound · vibration · short flash ---------- */
  function flash(text, cls) {
    const f = R("flash");
    f.className = "oc-flash on " + (cls || "");
    f.textContent = text;
    clearTimeout(flashT);
    flashT = setTimeout(() => { f.className = "oc-flash"; }, 1400);
  }
  function events(m) {
    const v = m.v, me = m.me, nm = m.players.map(p => p.name), spec = me < 0;
    let snd = null, rank = 0;
    const want = (s, r) => { if (r >= rank) { snd = s; rank = r; } };
    for (const e of m.ev) {
      if (e.type === "play") {
        topIn = true; hot = e.p;
        if (e.block) { want("good", 3); flash(L("🛡️ 공격을 막았다!", "🛡️ Attack blocked!"), "good"); }
        else if (e.attack) {
          if (v.phase === "play" && v.turn === me && v.attack > 0) { want("bad", 4); buzz([90, 50, 90]); flash(L(`공격 +${v.attack}!`, `Attack +${v.attack}!`), "bad"); }
          else if (spec && v.phase === "play" && v.attack > 0) { want("chip", 2); flash(`${L("공격", "Attack")} +${v.attack} → ${nm[v.turn] || ""}`, "bad"); }
          else want("chip", 2);
        } else if (e.reverse) { want("pass", 2); flash(v.dir > 0 ? L("› 방향 바뀜 (순서대로)", "› Direction reversed (forward)") : L("‹ 방향 바뀜 (거꾸로)", "‹ Direction reversed (backward)")); }
        else if (e.skip === me) { want("pass", 3); flash(L("건너뜀 ⏭️", "Skipped ⏭️"), "bad"); }
        else if (spec && e.skip !== undefined) { want("pass", 2); flash(L(`⏭️ ${nm[e.skip] || ""} 건너뜀`, `⏭️ ${nm[e.skip] || ""} is skipped`)); }
        else if (e.suit) { want("place", 2); flash(`${L("무늬", "Suit")} → ${SUIT_SYMBOL[e.suit]} ${loc(SUIT_NAME[e.suit])}`, REDS[e.suit] ? "red" : "gold"); }
        else want("place", 1);
        if (e.p === me) fresh = [];
      } else if (e.type === "draw") {
        hot = e.p;
        if (e.p === me && e.cards) fresh = e.cards.slice();
        if (e.p === me && e.reason !== "pass" && e.n) want("bad", 3); else want("deal", 1);
      } else if (e.type === "shuffle") want("flip", 1);
      else if (e.type === "callOpen") {
        if (e.p === me) flash(L("한 장! 원카드를 외치세요", "One card! Call it!"), "gold");
      } else if (e.type === "call") {
        if (e.safe === true) { flash(`📣 ${L("원카드!", "One card!")} — ${nm[e.owner] || ""}`, "gold"); want(e.owner === me ? "good" : "chip", 3); }
        else if (e.safe === false) {
          flash(e.owner === me ? L("잡혔다! 1장 추가 😱", "Caught! +1 card 😱") : e.p === me ? L("잡았다! 🫵", "Got them! 🫵") : L(`${nm[e.p] || ""} 님이 잡았다!`, `${nm[e.p] || ""} caught them!`), e.owner === me ? "bad" : "good");
          if (e.owner === me) { want("bad", 4); buzz(120); } else want(e.p === me ? "good" : "chip", 3);
        }
      } else if (e.type === "out" && e.p === me) want("good", 4);
      else if (e.type === "bust") { want(e.p === me ? "lose" : "bad", 4); flash(L(`💥 ${nm[e.p] || ""} 님 파산`, `💥 ${nm[e.p] || ""} goes bust`), "bad"); }
    }
    if (snd && ctx.sound[snd]) ctx.sound[snd]();
  }

  /* ---------- Flying cards (after the screen shows the new state) ----------
     a played card: from the player's seat (my own: from where I tapped it) to the top of the pile;
     drawn cards: from the deck to the player's seat, or into my hand — one after another for a penalty */
  const seatOf = p => wrap.querySelector(`.oc-opp[data-p="${p}"]`);
  function flyCard(from, to, opt) {
    if (!from || !to) return null;
    // The flying copy lives outside .oc: give it this card's size so the face keeps its proportions (.pc.oc-fly in style.css)
    to.style.setProperty("--cw", to.offsetWidth + "px");
    to.style.setProperty("--ch", to.offsetHeight + "px");
    to.classList.add("oc-fly");
    return ctx.fly(from, to, opt);
  }
  function flights(m) {
    if (!m.ev.length) return;
    const v = m.v, me = m.me;
    const top = wrap.querySelector(".oc-top .pc"), deck = wrap.querySelector(".oc-deck .pc") || R("deck");
    const back = cardHTML(null, "oc-fly").replace("<div ", `<div style="--cw:${LAND_W}px;--ch:${LAND_H}px" `);
    let wait = 0;
    for (const e of m.ev) {
      if (e.type === "play" && top && e.card === v.top) {
        let from;
        if (me >= 0 && e.p === me) {
          from = tapped && tapped.c === e.card && Date.now() - tapped.t < 10000 ? tapped.r : R("hand").offsetHeight ? R("hand") : R("me");
          tapped = null;
        } else { const s = seatOf(e.p); from = s && s.querySelector(".oc-oh"); }
        // The flight replaces the drop-in animation (stop it first: its rotation would distort the measured target)
        const box = top.parentElement;
        box.classList.remove("in");
        if (!flyCard(from, top, { delay: wait })) { void box.offsetWidth; box.classList.add("in"); }
        wait += 120;
      } else if (e.type === "draw" && e.n > 0) {
        const k = Math.min(e.n, 8);
        if (me >= 0 && e.p === me) {
          [...R("hand").querySelectorAll(".oc-card .pc.new")].slice(0, k).forEach((x, i) => flyCard(deck, x, { delay: wait + i * 90, ms: 380 }));
        } else {
          const s = seatOf(e.p), to = s && s.querySelector(".oc-land");
          const sc = Math.max(1, Math.min(4, (deck.offsetWidth || LAND_W) / LAND_W));
          if (to) for (let i = 0; i < k; i++) ctx.fly(deck, to, { html: back, delay: wait + i * 90, ms: 380, scale: sc });
        }
        wait += k * 90;
      }
    }
  }

  function render() {
    if (!M) return;
    const spec = watching();
    wrap.classList.toggle("en", L(false, true));
    wrap.classList.toggle("spec", spec);
    seats(); table();
    if (!spec) { meLine(); hint(); buttons(); }
    fit();
    if (!spec) hand();
    callBox();
  }
  function update(m) {
    const again = m === M || m.ev === logEv;             // called again with the same msg: log · sounds · flights only once
    M = m;
    if (again) { render(); return; }
    logEv = m.ev;
    for (const e of m.ev) if (e.text) log.push(e.text);
    if (log.length > 12) log.splice(0, log.length - 12);
    hot = -1;
    events(m);
    render();
    try { flights(m); } catch (e) { console.error(e); }
  }

  function onResize() { if (M) render(); }
  window.addEventListener("resize", onResize);

  return {
    update,
    ticker: false,           // the recent-plays strip and last-action badges replace the one-line ticker
    landscape: true,         // has its own sideways layout (style.css)
    destroy() {
      window.removeEventListener("resize", onResize);
      clearInterval(cdT); clearTimeout(flashT); clearTimeout(busyT);
      root.innerHTML = "";
    }
  };
}
