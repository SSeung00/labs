/* Secret Numbers screen
   Portrait: the opponents' rows on top (name line + tiles), a middle strip (pool · what just happened · helper switch),
   my own row, then the dock (hint + buttons, number picker). Landscape: the dock moves to the right-hand side and every
   seat's name sits to the left of its row. Spectators get every seat's row and no dock.
   Tiles are drawn in CSS. Striped face = hidden from the others: opponents' hidden tiles show only colour and stripes,
   my own hidden tiles show my number on the stripes (🔒). A plain face = revealed to everyone.
   The "possible numbers" helper runs the same deduction as the AI (logic.js) on my own view only.
   Tile size comes from the measured stage, so spare room makes the tiles bigger. */
import { L } from "../../core/i18n.js";
import { analyze, JOKER } from "./logic.js";

const HELP_KEY = "bg.cb.help";
const numTxt = n => (n === JOKER ? "−" : String(n));
const ordEn = n => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
const place = n => L(`${n}등`, ordEn(n));
const pctTxt = p => (p >= 0.995 ? "100%" : p < 0.01 ? "<1%" : Math.round(p * 100) + "%");
/* What a remount of the same game keeps (the shell remounts after a language switch): history and the half-made guess */
let kept = null;

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "cb");
  wrap.innerHTML = `
    <div class="cb-main felt" data-r="main">
      <div class="cb-opps" data-r="opps"></div>
      <div class="cb-mid" data-r="mid"></div>
      <div class="cb-mine" data-r="mine"></div>
    </div>
    <div class="dock cb-dock" data-r="dock"></div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);

  let M = null, lastEv = null;
  let help = true;
  try { help = localStorage.getItem(HELP_KEY) !== "0"; } catch (e) { }
  let sel = null, num = null, again = false, jokerPick = false, revSel = null, askId = 0, busy = false;
  let an = null, anFor = null, anim = null;
  const log = [];          // what happened, as functions → HTML (built in the current language at render time)

  const spectator = () => !M || M.me < 0;
  const ask = () => (M && !M.over ? ctx.myAsk() : null);
  const guessAsk = () => { const a = ask(); return a && (a.kind === "guess" || a.kind === "more") ? a : null; };
  const revealAsk = () => { const a = ask(); return a && a.kind === "reveal" ? a : null; };
  const names = () => (M ? M.players.map(p => p.name) : []);
  const nameOf = q => esc((M.players[q] || { name: "?" }).name);
  const who = q => (q === M.me ? L("나", "You") : nameOf(q));                              // subject
  const whose = q => (q === M.me ? L("내", "your") : L(`${nameOf(q)}의`, `${nameOf(q)}'s`));  // possessive
  const chip = (c, n) => `<span class="cb-chip ${c ? "w" : "b"}">${n === null || n === undefined ? "?" : numTxt(n)}</span>`;
  const shown = () => {
    const n = M.v.rows.length, me = M.me;
    if (me < 0) return [...Array(n).keys()];
    return Array.from({ length: n - 1 }, (_, k) => (me + 1 + k) % n);
  };
  function analysis() {
    if (!guessAsk()) return null;
    if (anFor !== M) { anFor = M; an = analyze(M.v); }
    return an;
  }

  /* ---------- Tiles ---------- */
  function tileHTML(t, o = {}) {
    const known = t.n !== null && t.n !== undefined;
    const cls = ["cb-t", t.c ? "w" : "b", t.up ? "up" : "hid"];
    if (known) cls.push("kn");
    if (o.cls) cls.push(...o.cls);
    let inner = known ? `<b${t.n === 6 || t.n === 9 ? ' class="u"' : ""}>${numTxt(t.n)}</b>` : `<i class="cb-q">?</i>`;
    if (!t.up && known && o.mine) inner += `<i class="cb-lk">🔒</i>`;
    if (!t.up && !known && t.no && t.no.length) inner += `<s class="cb-no">≠${t.no.slice().sort((a, b) => a - b).map(numTxt).join("·")}</s>`;
    if (o.poss) inner += `<em class="cb-pc${o.poss.size === 1 ? " one" : ""}">${o.poss.size}</em>`;
    if (o.boom) inner += `<span class="cb-boom ${o.boom.ok ? "ok" : "bad"}">${o.boom.ok ? "✔" : "✗"} ${numTxt(o.boom.n)}</span>`;
    const data = o.q !== undefined ? ` data-q="${o.q}" data-i="${o.i}"` : "";
    if (o.act) return `<button class="${cls.join(" ")}"${data} aria-label="${esc(o.label || "")}">${inner}</button>`;
    return `<div class="${cls.join(" ")}"${data}>${inner}</div>`;
  }
  function rowHTML(q) {
    const v = M.v, row = v.rows[q], mine = q === M.me, a = anim || {};
    const g = guessAsk() && !jokerPick && !busy, canPick = g && !mine && !v.out.includes(q);
    const canRev = mine && revealAsk() && !busy;
    const A = canPick && help ? analysis() : null;
    let h = mine && jokerPick ? slot(0) : "";
    row.forEach((t, i) => {
      const id = q + ":" + i, cls = [];
      const act = (canPick && !t.up) || (canRev && !t.up);
      if (act) cls.push("can");
      if ((sel && sel.q === q && sel.i === i) || (canRev && revSel === i)) cls.push("sel");
      if (a.flip && a.flip.has(id)) cls.push("flip");
      if (a.shake && a.shake.has(id)) cls.push("shake");
      if (v.placed && v.placed.p === q && v.placed.i === i && v.phase !== "over") cls.push("fresh");
      const boom = a.boom && a.boom.q === q && a.boom.i === i ? a.boom : null;
      const label = mine ? L(`내 ${i + 1}번째 타일`, `My tile ${i + 1}`) : L(`${(M.players[q] || {}).name} ${i + 1}번째 타일`, `${(M.players[q] || {}).name}'s tile ${i + 1}`);
      h += tileHTML(t, { cls, q, i, act, mine, boom, label, poss: A && !t.up ? A.tiles[q][i] : null });
      if (mine && jokerPick) h += slot(i + 1);
    });
    if (v.drawn && v.turn === q && v.phase !== "over") h += `<span class="cb-plus">+</span>` + tileHTML({ ...v.drawn, up: false }, { cls: ["drawn"], mine });
    return h;
  }
  const slot = at => `<button class="cb-slot" data-at="${at}" aria-label="${esc(L(`${at + 1}번째 자리에 놓기`, `Place at spot ${at + 1}`))}"><i>▼</i></button>`;

  /* ---------- Seats ---------- */
  function seatHead(q) {
    const v = M.v, pl = M.players[q] || { name: "?" }, row = v.rows[q];
    const hid = row.filter(t => !t.up).length, up = row.length - hid, o = v.out.indexOf(q);
    let tag = "";
    if (v.phase === "over" && v.winner === q) tag = `<span class="cb-tag win">🏆<span class="cb-tt"> ${L("승리", "Winner")}</span></span>`;
    else if (o >= 0) tag = `<span class="cb-tag out">${L("탈락", "Out")} · ${place(v.rows.length - o)}</span>`;
    else if (q === v.turn && v.phase !== "over" && v.phase !== "begin") tag = `<span class="cb-tag now">${v.streak ? `✔×${v.streak}` : L("차례", "Turn")}</span>`;
    const ai = pl.kind === "ai" ? '<span class="cb-ai">AI</span>' : pl.kind === "away" ? `<span class="cb-ai away">${L("비움", "away")}</span>` : "";
    const nm = q === M.me ? L("나", "Me") : esc(pl.name);
    const cnt = o >= 0 ? "" : `<span class="cb-cnt" title="${esc(L("숨김 · 공개", "hidden · revealed"))}">🔒<b>${hid}</b> 👁<b>${up}</b></span>`;
    return `<span class="cb-who">${avatarHTML(pl.name, q, "sm")}<b class="cb-nm">${nm}</b>${ai}</span>${cnt}${tag}`;
  }
  function seatHTML(q) {
    const v = M.v, cls = ["cb-seat"];
    if (q === M.me) cls.push("me");
    if (q === v.turn && v.phase !== "over" && v.phase !== "begin" && !v.out.includes(q)) cls.push("turn");
    if (v.out.includes(q)) cls.push("out");
    if (v.phase === "over" && v.winner === q) cls.push("win");
    return `<div class="${cls.join(" ")}" data-seat="${q}"><div class="cb-sh">${seatHead(q)}</div><div class="cb-row">${rowHTML(q)}</div></div>`;
  }

  /* ---------- Middle strip: pool · latest news · helper switch ---------- */
  function midHTML() {
    const v = M.v;
    const pool = `<div class="cb-pool" data-r="pool" title="${esc(L("남은 타일 (검은색 · 흰색)", "Tiles left (black · white)"))}">` +
      `<span class="cb-pile b">${v.poolB}</span><span class="cb-pile w">${v.poolW}</span></div>`;
    const lines = log.slice(-2).reverse().map((f, k) => `<div class="${k ? "old" : ""}">${f()}</div>`).join("");
    const sw = spectator() ? "" : `<button class="cb-help" data-act="help" aria-pressed="${help}" title="${esc(L("가능한 숫자 보기", "Show possible numbers"))}">` +
      `🔍<span>${L("가능한 숫자", "Possible")}</span></button>`;
    return pool + `<div class="cb-msg">${lines || `<div class="old">${L("숫자 암호 — 상대의 숨은 숫자를 맞혀 보세요", "Secret Numbers — find the hidden numbers")}</div>`}</div>` + sw;
  }

  /* ---------- Dock: hint · buttons · number picker ---------- */
  function hintHTML() {
    const v = M.v, me = M.me, a = ask();
    if (ctx.replay) return ctx.nameText(v.status || "");
    if (v.phase === "over") return v.winner === me ? L("🏆 <b>승리!</b> 마지막까지 숫자를 지켰습니다", "🏆 <b>You win!</b> Your secret held to the end")
      : L(`게임 끝 — <b>${nameOf(v.winner)}</b> 님 승리`, `Game over — <b>${nameOf(v.winner)}</b> wins`);
    if (a && a.kind === "reveal") return revSel === null ? L("틀렸습니다 — 뽑은 타일이 없으니 <b>공개할 내 타일</b>을 고르세요", "Wrong — you drew nothing, so <b>reveal one of your tiles</b>")
      : L(`내 ${chip(v.rows[me][revSel].c, v.rows[me][revSel].n)} 타일을 공개할까요?`, `Reveal your ${chip(v.rows[me][revSel].c, v.rows[me][revSel].n)}?`);
    if (a) {
      if (jokerPick) return L("뽑은 조커(−)를 놓을 <b>자리(▼)</b>를 내 줄에서 고르세요", "Pick a <b>spot (▼)</b> in your row for your joker (−)");
      if (busy) return L("보내는 중…", "Sending…");
      if (sel) {
        const t = v.rows[sel.q][sel.i], A = help ? analysis() : null, p = A && A.tiles[sel.q][sel.i];
        const head = `${whose(sel.q)} ${L(`${sel.i + 1}번째`, `tile ${sel.i + 1}`)} ${chip(t.c, null)}`;
        if (!p) return `${head} — ${L("숫자를 고르세요", "pick a number")}`;
        if (p.size === 1) return `${head} — ${L(`<b>${numTxt(p.nums[0])}</b> 확실!`, `surely <b>${numTxt(p.nums[0])}</b>!`)}`;
        return `${head} — ${L("가능", "could be")} <b>${p.nums.map(numTxt).join(" · ")}</b>`;
      }
      const A = help ? analysis() : null;
      let sure = 0;
      if (A) A.tiles.forEach((row, q) => { if (q !== me) row.forEach(x => { if (x && x.size === 1) sure++; }); });
      const tip = sure ? L(` · 💡 확실한 타일 <b>${sure}</b>개`, ` · 💡 <b>${sure}</b> sure tile${sure > 1 ? "s" : ""}`) : "";
      if (a.kind === "more" && !again) return (v.drawn ? L(`🎯 <b>정답!</b> 한 번 더 맞힐까요? 멈추면 ${chip(v.drawn.c, v.drawn.n)} 타일은 숨겨집니다`, `🎯 <b>Correct!</b> Again? If you stop, ${chip(v.drawn.c, v.drawn.n)} stays hidden`)
        : L("🎯 <b>정답!</b> 한 번 더? 이번엔 틀리면 내 타일 하나를 공개합니다", "🎯 <b>Correct!</b> Again? A miss now reveals one of your tiles"));
      if (a.kind === "more") return L("한 번 더 — 상대의 숨은 타일을 누르세요", "Again — tap an opponent's hidden tile") + tip;
      return L("<b>내 차례</b> — 상대의 숨은 타일을 누르세요", "<b>Your turn</b> — tap an opponent's hidden tile") + tip;
    }
    if (me >= 0 && v.out.includes(me)) return L("내 타일이 모두 공개되어 탈락했습니다 — 구경 중", "All your tiles are revealed — you're out, watching");
    if (v.phase === "begin") return L("타일을 받았습니다 — 내 숫자를 확인하세요", "Tiles dealt — check your numbers");
    if (v.phase === "next") return !(v.last && !v.last.ok) ? L("차례가 넘어갑니다…", "Next turn…")
      : v.turn === me ? L("틀렸습니다 — 차례가 넘어갑니다", "You missed — the turn passes")
      : L(`<b>${nameOf(v.turn)}</b> 님이 틀려서 차례가 넘어갑니다`, `<b>${nameOf(v.turn)}</b> missed — the turn passes`);
    const t = v.turn;
    if (v.phase === "reveal") return L(`<b>${nameOf(t)}</b> 님이 자기 타일을 공개하는 중…`, `<b>${nameOf(t)}</b> is choosing a tile to reveal…`);
    return L(`<b>${nameOf(t)}</b> 님이 추리하는 중…`, `<b>${nameOf(t)}</b> is thinking…`) + (v.streak ? ` ✔×${v.streak}` : "");
  }
  const btn = (act, label, cls = "", dis = false) => `<button class="btn ${cls}" data-act="${act}"${dis ? " disabled" : ""}>${label}</button>`;
  function actsHTML() {
    const v = M.v, a = ask();
    if (!a) {
      if (M.me < 0) return "";
      return `<span class="cb-score" title="${esc(L("맞힘 · 틀림", "correct · wrong"))}">✔<b>${v.hits[M.me]}</b> ✗<b>${v.miss[M.me]}</b></span>`;
    }
    if (a.kind === "reveal") return btn("reveal", L("이 타일 공개", "Reveal it"), "primary", revSel === null || busy);
    if (jokerPick) return btn("cancelJ", L("취소", "Cancel"));
    const g = btn("guess", sel && num !== null ? L(`<b>${numTxt(num)}</b> 맞히기`, `Guess <b>${numTxt(num)}</b>`) : L("맞히기", "Guess"), "primary", !sel || num === null || busy);
    if (a.kind === "more") return again || sel ? btn("stop", L("멈추기", "Stop"), "", busy) + g
      : btn("again", L("한 번 더", "Guess again"), "primary") + btn("stop", L("멈추기", "Stop"), "", busy);
    return g;
  }
  function pickHTML() {
    const v = M.v, maxN = v.jokers ? JOKER : 11, a = guessAsk();
    const target = a && sel ? v.rows[sel.q][sel.i] : null;
    const A = target && help ? analysis() : null, poss = A ? A.tiles[sel.q][sel.i] : null;
    const mirror = !a && v.last && v.rows[v.last.q] && v.rows[v.last.q][v.last.i] ? v.last : null;   // someone else's last guess
    const color = target ? target.c : mirror ? v.rows[mirror.q][mirror.i].c : -1;
    let h = "";
    for (let n = 0; n <= maxN; n++) {
      const cls = ["cb-pn"];
      let dis = !target || jokerPick || busy, pct = "";
      if (poss) {
        if (!poss.nums.includes(n)) { cls.push("no"); dis = true; }
        else { pct = `<small>${pctTxt(poss.p[n])}</small>`; if (poss.p[n] >= Math.max(...poss.nums.map(x => poss.p[x])) - 1e-9) cls.push("top"); }
      }
      if (target && !poss && target.no.includes(n)) cls.push("x");
      if (target && num === n) cls.push("on");
      if (mirror && mirror.n === n) cls.push(mirror.ok ? "hit" : "miss");
      h += `<button class="${cls.join(" ")}" data-n="${n}"${dis ? " disabled" : ""}><b>${numTxt(n)}</b>${pct}</button>`;
    }
    return `<div class="cb-pick${color === 1 ? " w" : color === 0 ? " b" : ""}${v.jokers ? " j" : ""}">${h}</div>`;
  }
  function dockHTML() {
    return `<div class="cb-bar"><div class="cb-hint">${hintHTML()}</div><div class="cb-acts">${actsHTML()}</div></div>${pickHTML()}`;
  }

  /* ---------- Sizing ---------- */
  const TW_MAX = 100;
  /* The biggest tile width that fits every row (15 = nothing fits). Names go above the rows (portrait), at the left of
     each row (always in landscape) or, on very short screens, on one slim line at the left — whichever gives bigger tiles. */
  function fit() {
    const land = wrap.classList.contains("land"), main = R("main");
    const W = main.clientWidth - 12, H = main.clientHeight - 12;
    const seats = [...main.querySelectorAll(".cb-seat")];
    const counts = seats.map(s => {
      const q = +s.dataset.seat, n = M.v.rows[q].length;
      return n + 1.4 + (q === M.me && jokerPick ? 0.95 * (n + 1) : 0);          // room for the drawn tile on every row (+ joker spots)
    });
    const solve = (inline, slim) => {
      const chipW = inline ? 104 : 0, minBlock = !inline ? 0 : slim ? 32 : 50;
      const free = H - (land ? 36 : 44) - 5 * seats.length;
      for (let t = TW_MAX; t >= 16; t--) {
        const th = Math.round(t * 1.4), g = Math.max(3, Math.round(t * 0.1)), hdr = inline ? 0 : t >= 64 ? 30 : 24;
        const per = Math.max(1, Math.floor((W - chipW - 10 + g) / (t + g)));
        let tot = 0, ok = true;
        for (const c of counts) {
          const lines = Math.ceil(c / per);
          if (lines > 3) { ok = false; break; }
          tot += Math.max(minBlock, hdr + 15 + lines * th + (lines - 1) * g);
        }
        if (ok && tot <= free) return t;
      }
      return 15;
    };
    // preference: names on top (portrait) › names at the left › one-line names; a later option must give clearly bigger tiles
    const opts = land ? [[true, false], [true, true]] : [[false, false], [true, false], [true, true]];
    let tw = 0, inl = false, slim = false;
    for (const [i, s] of opts) { const t = solve(i, s); if (!tw || t >= tw + 3 || (tw < 16 && t > tw)) { tw = t; inl = i; slim = s; } }
    wrap.classList.toggle("inl", inl);
    wrap.classList.toggle("slim", slim);
    wrap.style.setProperty("--tw", tw + "px");
    wrap.classList.toggle("tiny", tw < 30);
    wrap.classList.toggle("big", tw >= 64);
    // safety net: measured heights (transforms of running animations don't count) must fit the table
    const cs = getComputedStyle(main), kids = [R("opps"), R("mid"), R("mine")].filter(e => !e.hidden && e.offsetHeight);
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + (kids.length - 1) * (parseFloat(cs.rowGap) || 0);
    const need = () => kids.reduce((a, e) => a + e.offsetHeight, pad);
    for (let k = 0; k < 24 && tw > 15 && need() > main.clientHeight; k++) wrap.style.setProperty("--tw", --tw + "px");
  }

  /* ---------- Events: history · sounds · animations ---------- */
  function events(m) {
    const me = m.me;
    anim = { flip: new Set(), shake: new Set(), boom: null, draw: null, place: null };
    if (!m.ev.length) return;
    for (const e of m.ev) {
      if (e.type === "draw") {
        anim.draw = e.p;
        log.push(() => (e.p === me ? L(`${chip(e.c, e.n)} 타일을 뽑았습니다`, `You drew ${chip(e.c, e.n)}`)
          : L(`${who(e.p)} 님이 ${chip(e.c, null)} 타일을 뽑았습니다`, `${who(e.p)} drew a ${chip(e.c, null)} tile`)));
        ctx.sound.deal();
      } else if (e.type === "nodraw") {
        log.push(() => L(`더미가 비었습니다 — ${who(e.p)}${e.p === me ? "는" : " 님은"} 뽑지 않고 맞힙니다`, `The pool is empty — ${who(e.p)} guess${e.p === me ? "" : "es"} without drawing`));
      } else if (e.type === "guess") {
        const id = e.q + ":" + e.i;
        (e.ok ? anim.flip : anim.shake).add(id);
        anim.boom = { q: e.q, i: e.i, n: e.n, ok: e.ok };
        log.push(() => (e.ok ? '<b class="ok">✔</b> ' : '<b class="bad">✗</b> ') + `${who(e.p)} → ${whose(e.q)} ${L(`${e.i + 1}번째`, `tile ${e.i + 1}`)} ${chip(e.c, e.n)}? ` +
          (e.ok ? `<b class="ok">${L("정답", "Correct")}</b>` : `<b class="bad">${L("틀림", "Wrong")}</b>`));
        if (e.ok) { ctx.sound.flip(); if (e.p === me) ctx.sound.good(); else if (e.q === me) { ctx.sound.bad(); ctx.buzz(80); } }
        else if (e.p === me) { ctx.sound.bad(); ctx.buzz([60, 40, 60]); }
        else ctx.sound.pass();
      } else if (e.type === "place") {
        if (e.i >= 0) anim.place = { p: e.p, i: e.i };
        if (e.up) {
          anim.flip.add(e.p + ":" + e.i);
          log.push(() => L(`${e.p === me ? "내가" : nameOf(e.p) + " 님이"} 뽑은 타일 ${chip(e.c, e.n)} 공개`, `${e.p === me ? "Your" : nameOf(e.p) + "'s"} drawn tile ${chip(e.c, e.n)} goes face up`));
        } else log.push(() => (e.p === me ? (e.n !== null && e.n !== undefined ? L(`멈춤 — ${chip(e.c, e.n)} 타일은 숨긴 채로`, `You stop — ${chip(e.c, e.n)} goes in hidden`) : L("멈췄습니다", "You stop"))
          : L(`${who(e.p)} 님이 멈췄습니다 — 뽑은 타일은 숨김`, `${who(e.p)} stops — the drawn tile stays hidden`)));
        ctx.sound.place();
      } else if (e.type === "reveal") {
        anim.flip.add(e.p + ":" + e.i);
        log.push(() => L(`${e.p === me ? "내" : who(e.p) + " 님이 자기"} 타일 ${chip(e.c, e.n)} 공개`, `${who(e.p)} reveal${e.p === me ? "" : "s"} ${e.p === me ? "your" : "their"} own ${chip(e.c, e.n)}`));
        ctx.sound.flip();
      } else if (e.type === "out") {
        log.push(() => `💥 ${L(`${who(e.p)} 탈락 (${e.place}등)`, `${who(e.p)} ${e.p === me ? "are" : "is"} out (${ordEn(e.place)})`)}`);
        if (e.p !== me) ctx.sound.chip();
      } else if (e.type === "over") {
        log.push(() => `🏆 ${L(`${who(e.winner)} 승리!`, `${who(e.winner)} win${e.winner === me ? "" : "s"}!`)}`);
      }
    }
    if (log.length > 30) log.splice(0, log.length - 30);
  }
  /* Fly the drawn tile from the pool to its spot, and a placed tile from where the drawn tile was into the row */
  const pin = e => { e.style.setProperty("--tw", e.offsetWidth + "px"); return e; };
  function landAnim(before) {
    if (!anim) return;
    if (anim.draw !== null) {
      const to = wrap.querySelector(`.cb-seat[data-seat="${anim.draw}"] .cb-t.drawn`), from = R("pool");
      if (to && from) ctx.fly(from, pin(to), { ms: 480 });
    }
    if (anim.place && before) {
      const to = wrap.querySelector(`.cb-seat[data-seat="${anim.place.p}"] .cb-t[data-i="${anim.place.i}"]`);
      if (to) ctx.fly(before, pin(to), { ms: 420, scale: 1 });
    }
  }

  /* ---------- Render ---------- */
  function render() {
    if (!M) return;
    const v = M.v, spec = spectator();
    wrap.classList.toggle("spec", spec);
    wrap.classList.toggle("en", L(false, true));
    const W = wrap.clientWidth, H = wrap.clientHeight;
    wrap.classList.toggle("land", W >= H * 1.25 && W >= 560);
    R("opps").innerHTML = shown().map(seatHTML).join("");
    R("mine").innerHTML = spec ? "" : seatHTML(M.me);
    R("mine").hidden = spec;
    R("mid").innerHTML = midHTML();
    const dock = R("dock");
    dock.hidden = spec;
    dock.innerHTML = spec ? "" : dockHTML();
    fit();
  }
  function update(m) {
    if (!M && kept && !ctx.replay && kept.run === m.run) {
      log.push(...kept.log);
      ({ sel, num, again, jokerPick, revSel, askId } = kept);
      if (kept.seq === m.seq) lastEv = m.ev;             // these events are in the history already
    }
    kept = null;
    const again2 = m === M || m.ev === lastEv;
    const a = m.pending && m.pending.find(x => x.p === m.me);
    if (!a || a.id !== askId) { sel = null; num = null; again = false; jokerPick = false; revSel = null; busy = false; askId = a ? a.id : 0; }
    // where the moving tile was before the redraw
    let before = null;
    if (!again2 && M && m.ev.some(e => e.type === "place")) {
      const d = wrap.querySelector(".cb-t.drawn");
      if (d) before = d.getBoundingClientRect();
    }
    M = m;
    if (sel && (!M.v.rows[sel.q] || !M.v.rows[sel.q][sel.i] || M.v.rows[sel.q][sel.i].up)) { sel = null; num = null; }
    if (!again2) { lastEv = m.ev; events(m); } else anim = null;
    render();
    if (!again2 && m.ev.length) landAnim(before);
    anim = null;
  }

  /* ---------- Input ---------- */
  let busyT = 0;
  function send(action) {
    if (busy) return;
    busy = true;
    if (!ctx.send(action)) busy = false;
    else {                                   // a rejected action gets no new state: unlock after a moment
      clearTimeout(busyT);
      busyT = setTimeout(() => { if (busy) { busy = false; render(); } }, 2500);
    }
    render();
  }
  wrap.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b || !wrap.contains(b) || b.disabled || !M) return;
    if (b.classList.contains("cb-t") && b.dataset.q !== undefined) {
      const q = +b.dataset.q, i = +b.dataset.i;
      if (revealAsk() && q === M.me) { revSel = revSel === i ? null : i; ctx.sound.tick(); render(); return; }
      if (!guessAsk() || q === M.me) return;
      if (sel && sel.q === q && sel.i === i) { sel = null; num = null; }
      else {
        sel = { q, i }; num = null; again = true;
        const A = help ? analysis() : null, p = A && A.tiles[q][i];
        if (p && p.size === 1) num = p.nums[0];             // only one number fits — preselect it (still needs a tap on the button)
      }
      ctx.sound.tick();
      render();
      return;
    }
    if (b.dataset.n !== undefined) { if (sel && guessAsk()) { num = +b.dataset.n; ctx.sound.tick(); render(); } return; }
    if (b.dataset.at !== undefined) { jokerPick = false; send({ t: "stop", at: +b.dataset.at }); return; }
    switch (b.dataset.act) {
      case "help":
        help = !help;
        try { localStorage.setItem(HELP_KEY, help ? "1" : "0"); } catch (err) { }
        render(); break;
      case "guess": if (sel && num !== null) send({ t: "guess", q: sel.q, i: sel.i, n: num }); break;
      case "again": again = true; render(); break;
      case "stop":
        if (M.v.drawn && M.v.drawn.n === JOKER) { jokerPick = true; sel = null; num = null; render(); }
        else send({ t: "stop" });
        break;
      case "cancelJ": jokerPick = false; render(); break;
      case "reveal": if (revSel !== null) send({ t: "reveal", i: revSel }); break;
    }
  });
  const onResize = () => { if (M) render(); };
  window.addEventListener("resize", onResize);

  return {
    update,
    ticker: false,           // the middle strip shows what just happened
    landscape: true,
    destroy() {
      if (M && !ctx.replay) kept = { run: M.run, seq: M.seq, log: log.slice(), sel, num, again, jokerPick, revSel, askId };
      window.removeEventListener("resize", onResize); clearTimeout(busyT); root.innerHTML = "";
    }
  };
}
