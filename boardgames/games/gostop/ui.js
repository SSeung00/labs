/* Go-Stop screen — top: opponents' panels · middle felt: draw pile + floor (grid of month stacks; cards grow with the spare height)
   · bottom: my panel + hand.
   Panels (mine and opponents'): score · points still needed · gwang/ribbon/animal/pi/hongdan/cheongdan/chodan/godori progress ·
   pibak/gwangbak danger · go/shake multipliers · last move.
   Hand: without tapping, each card shows what it would take from the floor, whether the score rises, whether it blocks an
   opponent's set, and whether it can shake/bomb. One tap selects (with a preview), a second tap plays.
   The panels show the history directly, so the one-line ticker at the top is turned off.
   Spectators (me = -1, watching screens and public replays): no hand or dock; every seat's panel shows its captured cards
   when there is room, and the floor takes the rest.
   Landscape (phones held sideways, computers, TVs): the panels form a column on the left, the felt and my hand fill the right.
   Flying cards (ctx.fly): played cards fly from the player's panel (or the card I tapped) to the floor, flipped cards from the
   draw pile, then captured cards fly from the floor to the capturer's panel. An update that also captured cards is drawn in
   two stages: first the floor with the captured cards still on it, then (≈0.6 s later) the final state.
   All visible text goes through L()/loc() at render time (Korean / English). */
import { CARDS, hwHTML, monthOf, isBonus, cardName, groupOf, kindKey, kindLabel, shortLabel, mon, sortCards, SET_NAME, SET_SHORT, SET_CARDS, COMBO } from "./cards.js";
import { scoreOf, settle } from "./engine.js";
import { L, loc, tx } from "../../core/i18n.js";

const GROUPS = ["g", "t", "y", "p"];
const groupLabel = k => ({ g: L("광", "Gwang"), t: L("띠", "Ribbons"), y: L("열끗", "Animals"), p: L("피", "Pi") })[k];
const SETS = ["hong", "cheong", "cho", "go"];
const GWANG = ["1a", "3a", "8a", "11a", "12a"];
const OFFR = 0.27;                    // vertical offset between same-month cards stacked on the floor (ratio of card height)
/* One-glyph kind marks for the text-sized cards in the last-move line (the coloured underline tells ribbon sets apart) */
const TK = {
  g: tx("광", "G"), hong: tx("홍", "R"), cheong: tx("청", "R"), cho: tx("초", "R"), rain: tx("띠", "R"),
  y: tx("열", "A"), go: tx("새", "B"), guk: tx("국", "A"), pp: tx("쌍", "2P"), p: tx("피", "P")
};
const KPRI = { g: 9, hong: 7, cheong: 7, cho: 7, go: 7, guk: 5, y: 4, rain: 3, pp: 3, p: 1 };
const signed = x => (x > 0 ? "+" : "") + x;
const ptsEn = n => `${n} ${Math.abs(n) === 1 ? "pt" : "pts"}`;
const pointsEn = n => `${n} ${Math.abs(n) === 1 ? "point" : "points"}`;
const sameKind = (a, b) => CARDS[a].t === "p" && CARDS[b].t === "p" && CARDS[a].pv === CARDS[b].pv;
/* Score items that complete a set (keys from scoreCards) */
const SET_ITEM = /^(hong|cheong|cho|go|g\d|rain3)$/;
const GW3 = tx("3광", "3 Gwang");
/* Short name of a completed item for the small hand tag */
function itemShort(it) {
  const k = it[2];
  if (k === "rain3") return L("비삼광", "3Gw");
  if (/^g\d$/.test(k)) return L(`${k[1]}광`, `${k[1]}Gw`);
  return loc(SET_SHORT[k] || it[0]);
}
const bakName = k => ({ pibak: L("피박", "Pibak"), gwangbak: L("광박", "Gwangbak"), meongbak: L("멍박", "Meongbak"), gobak: L("고박", "Gobak") })[k];
/* Same query as the landscape rules in style.css */
const LAND = typeof matchMedia === "function" ? matchMedia("(orientation: landscape) and (min-aspect-ratio: 4/3)") : { matches: false };
const calm = () => document.documentElement.dataset.motion === "calm" || matchMedia("(prefers-reduced-motion: reduce)").matches;

/* One card as a text-sized token (for the last-move line) */
function tok(id) {
  const c = CARDS[id];
  if (c.bonus) return `<span class="gs-tk t-b" title="${cardName(id)}"><b>★</b>+${c.pv}</span>`;
  const k = kindKey(id);
  return `<span class="gs-tk m${c.m} t-${k}" title="${cardName(id)}"><b>${c.m}</b>${k === "g" && c.rain ? L("비", "☂") : loc(TK[k])}</span>`;
}

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "gs");
  wrap.innerHTML = `
    <div class="gs-side" data-r="side">
      <div class="gs-opps" data-r="opps"></div>
      <div class="gs-p gs-mine" data-r="mine" role="button" tabindex="0"></div>
    </div>
    <div class="gs-main">
      <div class="gs-table felt" data-r="table">
        <div class="gs-floor" data-r="floor"></div>
        <div class="gs-pick" data-r="pick" hidden></div>
        <div class="gs-banner" data-r="banner"></div>
      </div>
      <div class="gs-dock" data-r="dock">
        <div class="gs-hint" data-r="hint"></div>
        <div class="gs-hand" data-r="hand"></div>
      </div>
    </div>
    <div class="gs-over" data-r="over" hidden></div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);

  let M = null;                 // last msg
  let A = null;                 // what the screen precomputed (analyze)
  let sel = null;               // selected hand card
  let sentId = 0;               // id of the ask already answered (never send twice)
  let playAsk = 0;              // id of the last "play" ask I saw
  let gsBox = null;             // open go/stop dialog {id, close}
  let hiddenRound = 0;          // round whose result panel was closed
  let prevFloor = null, prevHand = null, prevCaps = null;     // the last state drawn (to see what moved)
  let lastBy = {}, lastKey = "", lastRound = 0;     // each player's last move (fallback when the view has no lastBy)
  let handRects = null;         // where my hand cards were when I played (my played card flies from there)
  let stageT = 0;               // pending second stage of a staged update
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const name = p => (M && M.players[p] ? M.players[p].name : "?");
  const who = p => (M && p === M.me ? L("나", "You") : esc(name(p)));
  /* "Kim's Hongdan" / "your Hongdan" — plain text (escape where used) */
  const own = (q, label) => (M && q === M.me ? L(`나 ${label}`, `your ${label}`) : L(`${name(q)} ${label}`, `${name(q)}'s ${label}`));
  const open = kind => { const a = ctx.myAsk(kind); return a && a.id !== sentId ? a : null; };
  const live = v => ["play", "choose", "gostop"].includes(v.phase);
  const spec = () => !!M && M.me < 0;                              // spectator: public view, nothing to act on
  const inReplay = () => !!(M && M.replay) || !!ctx.replay;

  R("mine").onclick = () => { const q = +R("mine").dataset.q; if (M && q >= 0) showCaps(q); };

  /* ---------------- State ---------------- */
  function update(m) {
    const fresh = m !== M;
    if (stageT) { clearTimeout(stageT); timers.delete(stageT); stageT = 0; }   // a newer state replaces a staged one
    M = m;
    const v = m.v;
    if (!v || !v.caps) return;
    let fx = null;
    if (fresh) {
      if (v.round !== lastRound) { lastRound = v.round; lastBy = {}; lastKey = ""; }
      if (v.last) { const k = JSON.stringify(v.last); if (k !== lastKey) { lastKey = k; lastBy[v.last.p] = v.last; } }
      // What moved (for flying cards) — skipped for redraws and replay jumps (ev: [])
      if (m.ev && m.ev.length && !calm()) fx = moves(m);
      prevFloor = new Set(v.floor); prevHand = new Set(v.hand); prevCaps = v.caps.map(c => new Set(c));
      events(m);
    }
    if (sel && !v.hand.includes(sel)) sel = null;
    const pa = open("play");
    if (pa && pa.id !== playAsk) { playAsk = pa.id; sel = null; }     // new turn: release a card selected in advance
    if (fx) animate(fx); else render();
    if (fresh && (m.ev || []).some(e => (e.type === "play" || e.type === "bonus") && e.p === m.me)) handRects = null;
    later(onResize, 0);          // the shell may still change the stage's size after this update (status line, replay bar)
  }

  /* ---------------- Flying cards ---------------- */
  /* What this update moved: cards played and flipped onto the floor, and each seat's newly captured cards with their source
     ("floor", "deck" for a flipped bonus pi, "hand" for a bonus pi played from the hand, or a seat number for stolen pi) */
  function moves(m) {
    const v = m.v;
    if (!prevFloor || !prevCaps || prevCaps.length !== v.caps.length) return null;
    const played = [], flipped = [];
    let bonusHand = null;
    for (const e of m.ev) {
      if (e.type === "deal") return { deal: true };
      if (e.type === "play") for (const c of e.cards || []) played.push({ c, p: e.p });
      else if (e.type === "flip" && e.card) flipped.push({ c: e.card, p: e.p, bonus: !!e.bonus });
      else if (e.type === "bonus" && !e.floor) bonusHand = { c: e.card, p: e.p };
    }
    const viaFloor = new Set([...prevFloor, ...played.map(x => x.c), ...flipped.filter(x => !x.bonus).map(x => x.c)]);
    const caps = [];
    v.caps.forEach((cap, q) => {
      for (const c of cap) {
        if (prevCaps[q].has(c)) continue;
        let src = null;
        if (viaFloor.has(c) && !isBonus(c)) src = "floor";
        else {
          const r = prevCaps.findIndex(s => s.has(c));
          if (r >= 0) src = r;
          else if (flipped.some(x => x.c === c)) src = "deck";
          else if (bonusHand && bonusHand.c === c) src = "hand";
        }
        if (src !== null) caps.push({ c, q, src });
      }
    });
    const onFloor = caps.filter(x => x.src === "floor").map(x => x.c);
    const drawn = m.me >= 0 && prevHand ? v.hand.filter(c => !prevHand.has(c)) : [];
    return { played, flipped, caps, drawn, bonusHand, stageFloor: onFloor.length ? sortCards([...v.floor, ...onFloor]) : null };
  }
  function animate(fx) {
    if (fx.deal) { render(); flyDeal(); return; }
    const incoming = fx.played.length || fx.flipped.some(x => !x.bonus);
    if (fx.stageFloor && incoming) {
      // Stage 1: the played / flipped cards land on the floor; stage 2: the captured ones leave it
      render({ floor: fx.stageFloor, staging: true });
      flyIn(fx);
      stageT = later(() => { stageT = 0; finish(fx); }, 620);
    } else if (fx.stageFloor) finish(fx);              // the captured cards are on the screen already (after a choice)
    else { render(); flyIn(fx); flyCaps(fx, new Map()); flyDrawn(fx); }
  }
  function finish(fx) {
    const rects = new Map();
    for (const x of fx.caps) {
      const e = x.src === "floor" ? floorCard(x.c) : typeof x.src === "number" ? pileCard(x.src, x.c) : null;
      if (e) rects.set(x.c, e.getBoundingClientRect());
    }
    render();
    flyCaps(fx, rects);
    flyDrawn(fx);
  }
  const floorCard = c => R("floor").querySelector(`.gs-fc .hw[data-c="${c}"]`);
  const pileCard = (q, c) => wrap.querySelector(`.gs-p[data-q="${q}"] .gs-piles .hw[data-c="${c}"]`);
  const deckEl = () => R("floor").querySelector(".gs-deck");
  /* A card-sized spot in the middle of a seat's panel (where a played card comes from) */
  function panelSrc(q) {
    const p = wrap.querySelector(`.gs-p[data-q="${q}"]`);
    if (!p) return null;
    const r = (p.querySelector(".gs-ph") || p).getBoundingClientRect(), z = parseFloat(getComputedStyle(document.body).zoom) || 1;
    const w = 26 * z, h = 40 * z;
    return { left: r.left + r.width / 2 - w / 2, top: r.top + r.height / 2 - h / 2, width: w, height: h };
  }
  /* fly() sizes the copy like the target; the card's own size variables must follow, or its text keeps the default size */
  function flyCard(from, to, opt = {}) {
    if (!from || !to || !ctx.fly) return null;
    const a = from.getBoundingClientRect ? from.getBoundingClientRect() : from, b = to.getBoundingClientRect();
    if (!a.width || !b.width) return null;
    const an = ctx.fly(from, to, { ms: 380, scale: Math.max(.3, Math.min(3, a.width / b.width)), ...opt });
    const g = an && an.effect && an.effect.target;
    if (g) { g.style.setProperty("--cw", to.offsetWidth + "px"); g.style.setProperty("--ch", to.offsetHeight + "px"); }
    return an;
  }
  /* Where a captured card lands: its small card in the panel's piles, or a hidden card-sized spot over the matching tile */
  function capTarget(q, c) {
    const panel = wrap.querySelector(`.gs-p[data-q="${q}"]`);
    if (!panel) return null;
    const mini = panel.querySelector(`.gs-piles .hw[data-c="${c}"]`);
    if (mini) return { el: mini };
    const sc = M.v.scores[q], tile = panel.querySelectorAll(".gs-ti")[GROUPS.indexOf(groupOf(c, sc && sc.guk))] || panel;
    const t = el("div", "hw mini gs-tgt");
    t.style.left = Math.round(tile.offsetLeft + tile.offsetWidth / 2 - 10) + "px";
    t.style.top = Math.round(tile.offsetTop + tile.offsetHeight / 2 - 15) + "px";
    panel.appendChild(t);
    return { el: t, tmp: true };
  }
  function flyIn(fx) {
    fx.played.forEach((x, i) => {
      const to = floorCard(x.c);
      const from = (x.p === M.me && handRects && handRects.get(x.c)) || panelSrc(x.p);
      if (to) flyCard(from, to, { delay: i * 60 });
    });
    let k = 0;
    const deck = deckEl();
    for (const x of fx.flipped) {
      if (x.bonus) continue;
      const to = floorCard(x.c);
      if (to) flyCard(deck, to, { ms: 360, delay: (fx.played.length ? 240 : 0) + 140 * k++ });
    }
  }
  function flyCaps(fx, rects) {
    const deck = deckEl();
    let i = 0;
    for (const x of fx.caps) {
      let from = rects.get(x.c) || null;
      if (!from) {
        if (x.src === "deck") from = deck;
        else if (x.src === "hand") from = (x.q === M.me && handRects && handRects.get(x.c)) || panelSrc(x.q);
        else if (typeof x.src === "number") from = panelSrc(x.src);
      }
      if (!from) continue;
      const t = capTarget(x.q, x.c);
      if (!t) continue;
      const an = flyCard(from, t.el, { html: hwHTML(x.c), ms: 360, delay: 30 + 55 * i++ });
      if (t.tmp) { if (an) an.finished.then(() => t.el.remove(), () => t.el.remove()); else t.el.remove(); }
    }
  }
  function flyDrawn(fx) {
    const deck = deckEl();
    fx.drawn.forEach((c, i) => { const to = R("hand").querySelector(`.hw[data-c="${c}"]`); if (to) flyCard(deck, to, { ms: 360, delay: 120 + 60 * i }); });
  }
  /* A new round: the floor and my hand are dealt from the pile */
  function flyDeal() {
    const deck = deckEl();
    let i = 0;
    for (const h of [...R("floor").querySelectorAll(".gs-fc .hw"), ...R("hand").querySelectorAll(".gs-hc .hw[data-c]")]) flyCard(deck, h, { ms: 340, delay: 40 * i++ });
  }

  /* Precompute everything a player would otherwise count in their head */
  function analyze(v, me) {
    const n = v.n, th = v.th;
    const owner = {};
    v.caps.forEach((cap, q) => cap.forEach(id => { owner[id] = q; }));
    const fake = { n, round: v.round, caps: v.caps, go: v.go, shook: v.shook, nagari: v.nagari };
    const P = [];
    for (let q = 0; q < n; q++) {
      const sc = v.scores[q], cap = v.caps[q];
      let lpi = 0, lg = 0;                                  // as a loser (gukjin as double pi) — same as the pibak/gwangbak rule
      for (const id of cap) { const c = CARDS[id]; if (c.t === "p") lpi += c.pv; else if (c.guk) lpi += 2; else if (c.t === "g") lg++; }
      const sets = {};
      for (const s of SETS) {
        const have = SET_CARDS[s].filter(id => owner[id] === q).length;
        const dead = SET_CARDS[s].some(id => owner[id] !== undefined && owner[id] !== q);
        sets[s] = { have, dead, done: have === 3, near: have === 2 && !dead, miss: SET_CARDS[s].filter(id => owner[id] === undefined) };
      }
      const missG = GWANG.filter(id => owner[id] === undefined);
      const goal = v.go[q] ? Math.max(th, v.goScore[q] + 1) : th;
      const goMul = v.go[q] >= 3 ? 2 ** (v.go[q] - 2) : 1;
      P.push({
        q, sc, lpi, lg, sets, missG, rain: cap.includes("12a"), goal, need: Math.max(0, goal - sc.total),
        mul: 2 ** v.shook[q].length * goMul * v.nagari, goMul,
        stop: sc.total >= goal ? settle(fake, q) : null      // if this score holds at turn end: what they'd collect / pay
      });
    }
    // Danger if q loses — warn only when someone else is ahead in pi / gwang / animals (always-on warnings are noise)
    for (const p of P) {
      const o = P.filter(x => x !== p);
      p.pibak = p.lpi < 6 && o.some(x => x.sc.pi >= 6);
      p.gwangbak = p.lg === 0 && o.some(x => x.sc.g >= 2);
      p.meong = o.some(x => x.sc.y >= 6);
    }
    // Floor / hand cards that would complete someone's set (sets missing one card); labels are resolved now
    const need = new Map();               // id → [{q, label}]
    const add = (id, q, label) => { if (!need.has(id)) need.set(id, []); need.get(id).push({ q, label: loc(label) }); };
    for (const p of P) {
      for (const s of SETS) if (p.sets[s].near) for (const id of p.sets[s].miss) add(id, p.q, SET_NAME[s]);
      if (p.sc.g === 2) for (const id of p.missG) add(id, p.q, GW3);
    }
    const threat = id => (need.get(id) || []).filter(x => x.q !== me);
    const mineNeed = id => (need.get(id) || []).filter(x => x.q === me);
    return { P, need, threat, mineNeed, owner };
  }

  /* What happens if I play this hand card (up to the flip) */
  function handInfo(v, c) {
    const me = M.me, P = A.P[me], caps = v.caps[me];
    if (isBonus(c)) return { kind: "bonus", tag: L("보너스", "Bonus"), tcls: "good", can: true, gains: [] };
    const m = monthOf(c), F = v.floor.filter(x => monthOf(x) === m);
    const bomb = !!(v.can && v.can.bomb.includes(m)), shake = !!(v.can && v.can.shake.includes(m));
    let kind, gains = [], alt = null;
    const gain = ids => scoreOf([...caps, ...ids]).total;
    if (bomb) { kind = "bomb"; gains = [...v.hand.filter(x => monthOf(x) === m), ...F]; }
    else if (!F.length) kind = "lay";
    else if (F.length === 1) { kind = "pair"; gains = [c, F[0]]; }
    else if (F.length === 2) {
      if (sameKind(F[0], F[1])) { kind = "pair"; gains = [c, F[0]]; }
      else {
        kind = "pair2";
        const val = x => gain([c, x]) * 100 + (A.threat(x).length ? 50 : 0) + KPRI[kindKey(x)];
        const [b, o] = val(F[0]) >= val(F[1]) ? [F[0], F[1]] : [F[1], F[0]];
        gains = [c, b]; alt = o;
      }
    } else { kind = "take4"; gains = [c, ...F]; }
    const after = gains.length ? scoreOf([...caps, ...gains]) : P.sc;
    const delta = after.total - P.sc.total;
    const doneItems = after.items.filter(x => SET_ITEM.test(x[2]) && !P.sc.items.some(y => y[2] === x[2]));
    const done = doneItems.map(x => loc(x[0]));
    const blocks = [];
    for (const id of gains) for (const t of A.threat(id)) blocks.push(own(t.q, t.label));
    const gives = kind === "lay" ? A.threat(c).map(t => own(t.q, t.label)) : [];
    let tag = "", tcls = "";
    if (bomb) { tag = L("💣폭탄", "💣Bomb"); tcls = "bomb"; }
    else if (doneItems.length) { tag = itemShort(doneItems[0]) + "!"; tcls = "gold"; }
    else if (delta > 0) { tag = L(`+${delta}점`, `+${delta}pt`); tcls = "gold"; }
    else if (blocks.length) { tag = L("막기", "Block"); tcls = "block"; }
    else if (kind === "pair") { tag = shortLabel(gains[1]); tcls = KPRI[kindKey(gains[1])] >= 4 ? "good" : ""; }
    else if (kind === "pair2") tag = L("택1", "Pick 1");
    else if (kind === "take4") { tag = v.ppeok.includes(m) ? L("뻑먹기", "Ppeok!") : L("4장", "All 4"); tcls = "good"; }
    else if (gives.length) { tag = L("⚠내줌", "⚠Risk"); tcls = "bad"; }
    return { kind, m, F, gains, alt, bomb, shake, after, delta, done, blocks, gives, tag, tcls, can: F.length > 0 };
  }

  /* ---------------- Drawing ---------------- */
  /* opt.floor: draw this floor instead of the view's (first stage of a staged update); opt.staging: no dialogs or results yet */
  function render(opt = {}) {
    if (!M) return;
    const v = M.v, sp = spec(), land = LAND.matches;
    A = analyze(v, M.me);
    const W = wrap.clientWidth || 360, H = wrap.clientHeight || 600;
    lastW = wrap.clientWidth; lastH = wrap.clientHeight;
    wrap.classList.toggle("spec", sp);
    wrap.classList.toggle("land", land);
    wrap.classList.toggle("short", H < 600);
    wrap.classList.toggle("tall", H > 740);
    wrap.classList.toggle("roomy", land && H >= 560);
    wrap.classList.toggle("p3", v.n >= 3);
    R("dock").hidden = sp;
    if (!sp) renderHint();
    renderOver(opt.staging);
    renderPanels(land, sp, H);
    const cells = floorCells(v, opt.floor || v.floor);
    const lay = layout(W, cells, land, sp);   // hand and floor share the spare height (both as large as possible)
    if (!sp) renderHand(lay);
    renderTable(cells, lay.fl, opt.staging);
    if (opt.staging) return;
    const g = open("gostop");
    if (g) openGoStop(g); else closeGoStop();
  }

  /* Panels with or without each seat's captured cards (piles), as room allows.
     mode 2: every panel · 1: my panel only · 0: none (tap a panel to see its cards) */
  function renderPanels(land, sp, H) {
    const side = R("side"), table = R("table"), v = M.v;
    const modes = land ? (sp ? [2, 0] : [2, 1, 0]) : sp ? [2, 0] : [H >= 690 ? 1 : 0];
    // A long hand on a small sideways phone (Matgo: 10 cards): try a narrower panel column (tiles in two rows) to widen the hand
    const narrow = land && !sp && v.hand.length + (v.flips[M.me] ? 1 : 0) >= 8 && wrap.clientWidth < 900;
    const tries = [...(narrow ? modes.map(m => [true, m]) : []), ...modes.map(m => [false, m])];
    wrap.style.setProperty("--pz", "1");
    let mode = 0;
    for (let i = 0; i < tries.length; i++) {
      wrap.classList.toggle("narrow", tries[i][0]);
      drawPanels(mode = tries[i][1]);
      if (i === tries.length - 1) break;
      if (land ? side.scrollHeight <= side.clientHeight + 1 : table.clientHeight >= Math.max(170, H * .36)) break;
    }
    // Landscape: scale the panels to the column — up on computers and TVs (readable from the sofa), slightly down when even the
    // smallest panels don't fit (a replay's controls on a small sideways phone)
    const used = R("opps").offsetHeight + R("mine").offsetHeight + 4;
    if (land && used > 4) {
      const fit = (side.clientHeight - 6) / used;
      // scaling up keeps the panels' inner width at least their normal minimum (tiles stay readable)
      const z = fit < 1 ? Math.max(.72, fit) : Math.min(1.45, fit, side.clientWidth / (wrap.classList.contains("narrow") ? 216 : 320));
      if (z > 1.06 || z < .995) { wrap.style.setProperty("--pz", z.toFixed(3)); drawPanels(mode); }
    }
  }
  function drawPanels(mode) {
    const v = M.v, me = M.me, sp = me < 0, box = R("opps"), mine = R("mine");
    const bottom = sp ? 0 : me;                          // spectators: seat 0 in my panel's place, the others on top
    box.innerHTML = "";
    for (let k = 1; k < v.n; k++) {
      const q = (bottom + k) % v.n;
      const b = el("div", "gs-p gs-opp" + (live(v) && v.turn === q ? " turn" : ""), panelHTML(q));
      b.dataset.q = q;
      b.setAttribute("role", "button");
      b.tabIndex = 0;
      b.setAttribute("aria-label", L(`${name(q)} 님 먹은 패 보기`, `View ${name(q)}'s captured cards`));
      b.onclick = () => showCaps(q);
      box.appendChild(b);
      if (mode === 2) addPiles(b, q);
    }
    mine.className = "gs-p gs-mine" + (live(v) && v.turn === bottom ? " turn" : "");
    mine.dataset.q = bottom;
    mine.setAttribute("aria-label", sp ? L(`${name(bottom)} 님 먹은 패 보기`, `View ${name(bottom)}'s captured cards`)
      : L("내 정보 · 먹은 패 보기", "My info · view captured cards"));
    mine.innerHTML = panelHTML(bottom);
    if (mode >= 1) addPiles(mine, bottom);
  }
  /* One row of small captured cards per group (gwang · ribbons · animals · pi), overlapped to fit */
  function addPiles(box, q) {
    const v = M.v, sc = v.scores[q];
    const groups = { g: [], t: [], y: [], p: [] };
    for (const c of v.caps[q]) groups[groupOf(c, sc.guk)].push(c);
    const piles = el("div", "gs-piles");
    for (const k of GROUPS) piles.appendChild(el("div", `gs-pc p-${k}`, groups[k].map(c => hwHTML(c, "mini")).join("") || '<span class="gs-faint">—</span>'));
    box.appendChild(piles);
    const first = piles.querySelector(".hw"), cw = first ? first.offsetWidth : 20;
    for (const pc of piles.children) {
      const cards = pc.querySelectorAll(".hw"), k = cards.length;
      if (k < 2) continue;
      const W = pc.clientWidth || 70;
      const step = Math.min(cw + 2, (W - cw) / (k - 1));
      for (let i = 1; i < k; i++) cards[i].style.marginLeft = (step - cw) + "px";
    }
  }

  /* One player's panel (same for me and opponents) */
  function panelHTML(q) {
    const v = M.v, me = M.me, isMe = q === me, sp = me < 0, pl = M.players[q] || { name: "?" }, P = A.P[q], sc = P.sc;
    // Row 1: name · status tags · points needed · score
    const tags = [];
    if (pl.kind === "ai") tags.push('<span class="gs-tg ai">AI</span>');
    else if (pl.kind === "away") tags.push(`<span class="gs-tg away">${L("자리 비움", "Away")}</span>`);
    if (v.leader === q && live(v)) tags.push(`<span class="gs-tg" title="${L("선 (먼저 내는 사람)", "Leader (plays first)")}">${L("선", "Lead")}</span>`);
    if (!isMe) tags.push(`<span class="gs-tg" title="${L("손패", "Cards in hand")}">${L(`손 ${v.sizes[q]}`, `✋${v.sizes[q]}`)}</span>`);
    if (v.flips[q]) tags.push(`<span class="gs-tg" title="${L("뒤집기만 하는 차례", "Flip-only turns")}">${L(`뒤집기 ${v.flips[q]}`, `Flip ${v.flips[q]}`)}</span>`);
    if (v.go[q]) tags.push(`<span class="gs-tg go">${L(`${v.go[q]}고`, `${v.go[q]} Go`)}${P.goMul > 1 ? ` ×${P.goMul}` : ""}</span>`);
    if (v.shook[q].length) {
      const sh = v.shook[q], ic = sh.map(s => (s.bomb ? "💣" : L("흔들", "Shake"))).filter((x, i, a) => a.indexOf(x) === i).join("·");
      const tt = sh.map(s => L(`${s.m}월 ${s.bomb ? "폭탄" : "흔들기"}`, `${mon(s.m)} ${s.bomb ? "bomb" : "shake"}`)).join(", ");
      tags.push(`<span class="gs-tg sh" title="${tt}">${ic} ×${2 ** sh.length}</span>`);
    }
    let needT;
    if (P.stop) needT = isMe || sp ? `<span class="gs-need ok"${sp ? ` title="${L("지금 스톱하면 받는 점수", "What they collect if they stop now")}"` : ""}>${L(`스톱 시 +${P.stop.deltas[q]}`, `Stop: +${P.stop.deltas[q]}`)}</span>`
      : `<span class="gs-need bad" title="${L("지금 나면 내가 낼 점수", "What you pay if they stop now")}">${L(`지금 나면 나 −${-P.stop.deltas[me] || 0}`, `If they stop: −${-P.stop.deltas[me] || 0}`)}</span>`;
    else needT = `<span class="gs-need${P.need <= 2 ? (isMe || sp ? " ok" : " warn") : ""}">` +
      `${v.go[q] ? L(`다음 고/스톱까지 <b>${P.need}</b>점`, `Next stop: <b>${P.need}</b>`) : L(`나기까지 <b>${P.need}</b>점`, `To win: <b>${P.need}</b>`)}</span>`;
    const nar = wrap.classList.contains("narrow");          // narrow panel column: the points-needed line moves to row 3
    const head = `<div class="gs-ph">${isMe ? "" : avatarHTML(pl.name, q, "sm")}<b class="nm">${isMe ? L("나", "You") : esc(pl.name)}</b>${tags.join("")}` +
      `<span class="gs-sp"></span>${live(v) && !nar ? needT : ""}<span class="gs-score"><b>${sc.total}</b>${L("점", "pt")}</span></div>`;

    // Row 2: 8 progress tiles
    const near = isMe || sp ? "good" : "warn";
    const bak = L("박", "×2");
    const ti = (label, val, cls, title) => `<div class="gs-ti ${cls}" title="${esc(title || "")}" data-bak="${bak}"><small>${label}</small><b>${val}</b></div>`;
    const t = [];
    const g = sc.g, gNear = g === 2 && P.missG.length;
    t.push(ti(P.rain ? L("광☂", "Gw☂") : L("광", "Gwang"), g >= 3 ? `${g}<i>+${sc.gp}</i>` : `${g}/3`, (g >= 3 ? "done" : gNear ? near : g ? "" : "zero") + (P.gwangbak ? " bak" : ""),
      L(`광 ${g}장${P.rain ? " (비광 포함 — 3광이면 2점)" : ""}${P.gwangbak ? " · 광박 위험" : ""}`,
        `${g} gwang${P.rain ? " (incl. the rain gwang — 3 gwang score 2)" : ""}${P.gwangbak ? " · gwangbak risk" : ""}`)));
    t.push(ti(L("띠", "Ribbon"), sc.t >= 5 ? `${sc.t}<i>+${sc.t - 4}</i>` : `${sc.t}/5`, sc.t >= 5 ? "done" : sc.t === 4 ? near : sc.t ? "" : "zero",
      L(`띠 ${sc.t}장`, `${sc.t} ribbons`)));
    t.push(ti(L("열끗", "Animal"), sc.y >= 5 ? `${sc.y}<i>+${sc.y - 4}</i>` : `${sc.y}/5`, sc.y >= 5 ? "done" : sc.y === 4 ? near : sc.y ? "" : "zero",
      L(`열끗 ${sc.y}장${sc.guk === "y" ? " (국진 포함)" : ""}`, `${sc.y} animals${sc.guk === "y" ? " (incl. gukjin)" : ""}`)));
    t.push(ti(L("피", "Pi"), sc.pi >= 10 ? `${sc.pi}<i>+${sc.pp}</i>` : `${sc.pi}/10`, (sc.pi >= 10 ? "done" : sc.pi === 9 ? near : sc.pi ? "" : "zero") + (P.pibak ? " bak" : ""),
      L(`피 ${sc.pi}장 (쌍피 2 · 쓰리피 3${sc.guk === "p" ? " · 국진 쌍피" : ""})${P.pibak ? " · 피박 위험" : ""}`,
        `${sc.pi} pi (double pi 2 · triple pi 3${sc.guk === "p" ? " · gukjin as double pi" : ""})${P.pibak ? " · pibak risk" : ""}`)));
    for (const s of SETS) {
      const st = P.sets[s], nm = loc(SET_NAME[s]), sh = loc(SET_SHORT[s]);
      t.push(st.done ? ti(sh, `✓<i>+${s === "go" ? 5 : 3}</i>`, "done", L(`${nm} 완성`, `${nm} complete`))
        : st.dead ? ti(sh, `✕`, "dead", L(`${nm} — 다른 사람이 이미 한 장을 먹어 불가`, `${nm} — impossible, someone else has one of its cards`))
        : ti(sh, `${st.have}/3`, st.near ? near : st.have ? "" : "zero",
          st.near ? L(`${nm} 1장 남음: `, `${nm} — 1 card left: `) + st.miss.map(cardName).join(", ") : `${nm} ${st.have}/3`));
    }

    // Row 3: last move · danger · running total
    const cur = v.cur && v.cur.p === q ? v.cur : null;
    const lm = cur ? null : (v.lastBy || lastBy)[q];       // the view keeps every seat's last move (survives a remount)
    let mv;
    if (cur) mv = `${cur.played.length ? cur.played.map(tok).join("") : `<em>${L("뒤집기", "Flip")}</em>`}${cur.flipped.length ? `<i>→</i>${cur.flipped.map(tok).join("")}` : ""}<em>…</em>`;
    else if (lm) mv = moveHTML(lm, me);
    else mv = `<em class="gs-faint">${live(v) ? L("아직 안 냄", "Not played yet") : ""}</em>`;
    const fresh = (cur || (lm && v.last && v.last.p === q)) ? " fresh" : "";
    const dg = [];
    const dcls = isMe || sp ? "gs-dg" : "gs-dg opp";
    if (P.pibak) dg.push(`<span class="${dcls}" title="${isMe ? L("상대가 피로 나면 ×2", "×2 if an opponent wins with pi")
      : sp ? L("다른 사람이 피로 나면 ×2", "×2 if someone else wins with pi") : L("내가 피로 나면 ×2", "×2 if you win with pi")}">` +
      `${L(`피박 위험: 피 ${P.lpi}`, `Pibak: ${P.lpi} pi`)}</span>`);
    if (P.gwangbak) dg.push(`<span class="${dcls}" title="${L("광으로 나면 ×2", "×2 if the winner scores with gwang")}">${L("광박 위험", "Gwangbak")}</span>`);
    if (P.meong && isMe) dg.push(`<span class="${dcls}" title="${L("상대 열끗 7장 이상으로 나면 ×2", "×2 if an opponent wins with 7+ animals")}">${L("멍박 주의", "Meongbak")}</span>`);
    const foot = `<div class="gs-pf"><span class="gs-lm${fresh}">${mv}</span>${dg.join("")}${live(v) && nar ? needT : ""}<span class="gs-tot">${L("누적", "Total")} <b>${signed(v.totals[q])}</b></span></div>`;
    return head + `<div class="gs-tiles">${t.join("")}</div>` + foot;
  }

  function moveHTML(lm, me) {
    let s = "";
    if (lm.kind === "flip") s += `<em>${L("뒤집기", "Flip")}</em>`;
    else if (lm.kind === "bomb") s += `<em>💣</em>${lm.played.map(tok).join("")}`;
    else s += lm.played.map(tok).join("");
    if (lm.flipped.length) s += `<i>→</i>${lm.flipped.map(tok).join("")}`;
    s += lm.captured.length ? `<span class="got">${L(`+${lm.captured.length}장`, `+${lm.captured.length}`)}</span>` : `<span class="miss">${L("못 먹음", "missed")}</span>`;
    const combos = lm.combos.filter(c => c !== "shake" && c !== "bomb");
    if (combos.length) s += `<span class="cb">${combos.map(c => loc(COMBO[c])).join("·")}!</span>`;
    if (lm.stolen.length) {
      const fromMe = lm.stolen.filter(x => x.from === me).length, k = lm.stolen.length;
      s += lm.p === me ? `<span class="got">${L(`피 ${k}장 뺏음`, `stole ${k} pi`)}</span>`
        : fromMe ? `<span class="bad">${L(`내 피 −${fromMe}`, `your pi −${fromMe}`)}</span>`
        : `<span class="cb">${L(`피 ${k}장 뺏음`, `stole ${k} pi`)}</span>`;
    }
    return s;
  }

  /* Floor cells: draw pile + month stacks (+ an empty spot where the selected card would land) */
  function floorCells(v, floor) {
    const byM = new Map();
    for (const c of floor) { const m = monthOf(c); if (!byM.has(m)) byM.set(m, []); byM.get(m).push(c); }
    const selM = sel && !isBonus(sel) ? monthOf(sel) : 0;
    const cells = [{ deck: true, d: 1 }];
    for (const m of [...byM.keys()].sort((a, b) => a - b)) cells.push({ m, cs: byM.get(m), d: byM.get(m).length });
    if (selM && !byM.has(selM)) cells.push({ ghost: selM, d: 1 });
    return cells;
  }

  /* Choose hand rows · hand card size together with the floor card size so the smaller of the two is as large as possible */
  function layout(W, cells, land, sp) {
    const v = M.v, hand = R("hand"), table = R("table");
    hand.style.height = "0px";
    const T0 = table.clientHeight || 300, Wf = table.clientWidth || W - 12;    // felt height with a zero-height hand
    const HW = (R("dock").clientWidth || W) - 12;                           // room for the hand (the dock's inner width)
    // Largest floor card: portrait as before; landscape by the felt's width (spectators on a TV get the biggest)
    const cap = land ? Math.min(sp ? 190 : 140, Math.floor((Wf - 16) / 3.2)) : Math.min(112, Math.floor((W - 28) / 3.4));
    const minT = parseFloat(getComputedStyle(table).minHeight) || 90;       // the felt never gets shorter than this
    const depths = cells.map(x => x.d);
    const count = sp ? 0 : v.hand.length + (v.flips[M.me] ? 1 : 0);
    const tagH = 14, gap = 5;
    if (!count) { const hh = sp ? 0 : 44; return { rows: 1, per: 1, hc: 40, hh, fl: fixFl(floorLayout(depths, Wf, T0 - hh, cap)) }; }
    let best = null;
    for (let rows = 1; rows <= Math.min(3, count); rows++) {
      const per = Math.ceil(count / rows);
      if (rows > 1 && Math.ceil(count / (rows - 1)) === per) continue;
      const byW = Math.floor((HW - (per - 1) * gap) / per);
      for (let hc = Math.min(byW, 84); hc >= 28; hc -= 2) {
        const hh = rows * (Math.ceil(hc * 1.55) + tagH) + (rows - 1) * gap;
        if (T0 - hh < minT && hc > 28) continue;                              // the hand would push the felt below its minimum
        const fl = floorLayout(depths, Wf, T0 - hh, cap);
        const s = Math.min(hc, fl.cw) + 0.01 * (hc + fl.cw) - (rows - 1) * 2;     // on a tie, one row reads easier
        if (!best || s > best.s) best = { rows, per, hc, hh, fl, s };
      }
    }
    if (!best) { const hc = 28; best = { rows: 1, per: count, hc, hh: Math.ceil(hc * 1.55) + tagH, fl: null }; best.fl = floorLayout(depths, Wf, T0 - best.hh, cap); }
    fixFl(best.fl);
    return best;
  }
  const fixFl = fl => { fl.cw = Math.max(24, Math.floor(fl.cw)); return fl; };

  function renderTable(cells, FL, staging) {
    const v = M.v, me = M.me, fl = R("floor");
    const selM = sel && !isBonus(sel) ? monthOf(sel) : 0;
    const ask = staging ? null : open("choose");
    const opts = ask && v.ch ? v.ch.options : [];
    const watch = !ask && v.ch && v.phase === "choose" ? v.ch.options : [];   // someone else is choosing: show between which two
    const cur = new Set(v.cur ? [...v.cur.played, ...v.cur.flipped] : []);
    const handM = new Set(v.hand.filter(c => !isBonus(c)).map(monthOf));
    const sp = me < 0;
    const cw = FL.cw, ch = Math.round(cw * 1.55), off = Math.round(ch * OFFR);
    R("table").style.setProperty("--fw", cw + "px");
    R("table").style.setProperty("--fh", ch + "px");
    fl.style.gridTemplateColumns = `repeat(${FL.c}, ${cw}px)`;
    fl.innerHTML = "";
    for (const x of cells) {
      if (x.deck) {
        fl.appendChild(el("div", "gs-stack gs-deck", `<div class="hw back"><i></i></div><div class="gs-dk"><b>${v.deck || L("끝", "0")}</b>` +
          `<small>${L(`${v.round}/${v.rounds}판`, `R${v.round}/${v.rounds}`)}</small>` +
          `${v.nagari > 1 ? `<span class="gs-nag">×${v.nagari}</span>` : ""}</div>`));
        continue;
      }
      if (x.ghost) { fl.appendChild(el("div", "gs-stack ghost", `<span>${L(`${x.ghost}월<br>여기에`, `${mon(x.ghost)}<br>here`)}</span>`)); continue; }
      const mm = x.m, cs = x.cs;
      const st = el("div", "gs-stack" + (mm === selM ? " match" : "") + (handM.has(mm) ? " hm" : "") + (v.ppeok.includes(mm) ? " ppeok" : ""));
      st.style.height = (ch + (cs.length - 1) * off) + "px";
      cs.forEach((c, i) => {
        const cls = [];
        if (mm === selM) cls.push("can");
        if (opts.includes(c)) cls.push("pick");
        if (watch.includes(c)) cls.push("opt");
        if (cur.has(c)) cls.push("cur");
        const thr = A.threat(c), mn = A.mineNeed(c);
        const d = el("div", "gs-fc", hwHTML(c, cls.join(" ")) +
          (thr.length ? `<span class="gs-mk ${sp ? "spec" : "bad"}" title="${esc(L("완성 패: ", "Completes ") + thr.map(t => own(t.q, t.label)).join(", "))}">!</span>`
            : mn.length ? `<span class="gs-mk good" title="${esc(L("완성 패: ", "Completes ") + mn.map(t => own(t.q, t.label)).join(", "))}">★</span>` : ""));
        d.style.top = i * off + "px";
        if (opts.includes(c)) { d.classList.add("tap"); d.onclick = () => send({ take: c }, "choose"); }
        st.appendChild(d);
      });
      if (v.ppeok.includes(mm)) st.insertAdjacentHTML("beforeend", `<span class="gs-pk">${loc(COMBO.ppeok)}</span>`);
      fl.appendChild(st);
    }

    // Choosing: two large cards + what each choice would do
    const pk = R("pick");
    if (opts.length) {
      pk.hidden = false;
      const x = v.ch.stage === "play" ? (v.cur && v.cur.played[0]) : (v.cur && v.cur.flipped[v.cur.flipped.length - 1]);
      const base = A.P[me].sc, m = v.ch.m;
      pk.innerHTML = `<div class="gs-pick-t">${v.ch.stage === "play"
        ? L(`낸 ${m}월 패로 <b>가져갈 카드</b>를 고르세요`, `Your played ${mon(m)} card: <b>pick one to take</b>`)
        : L(`뒤집은 ${m}월 패로 <b>가져갈 카드</b>를 고르세요`, `Your flipped ${mon(m)} card: <b>pick one to take</b>`)}</div><div class="gs-pick-c"></div>`;
      const row = pk.querySelector(".gs-pick-c");
      for (const c of opts) {
        const after = scoreOf([...v.caps[me], ...(x ? [x] : []), c]);
        const done = after.items.filter(i => SET_ITEM.test(i[2]) && !base.items.some(y => y[2] === i[2])).map(i => loc(i[0]));
        const delta = after.total - base.total;
        const thr = A.threat(c);
        const note = done.length ? `<em class="gold">${L(`${done.join("·")} 완성 +${delta}`, `${done.join("·")} +${delta}`)}</em>`
          : delta > 0 ? `<em class="gold">${L(`+${delta}점`, `+${ptsEn(delta)}`)}</em>`
          : thr.length ? `<em class="block">${esc(L(`${thr.map(t => own(t.q, t.label)).join(", ")} 막기`, `Blocks ${thr.map(t => own(t.q, t.label)).join(", ")}`))}</em>` : "";
        const b = el("button", "gs-pbtn", hwHTML(c) + `<span class="gs-pi"><small>${esc(cardName(c))}</small>${note}</span>`);
        b.onclick = () => send({ take: c }, "choose");
        row.appendChild(b);
      }
      // The panel sits inside the felt: shrink its cards until it fits (short felts, e.g. 3 players on a 360×640 phone)
      const maxH = R("table").clientHeight - 14;
      let w = Math.max(32, Math.min(76, cw + 4));
      pk.style.setProperty("--pw", w + "px");
      while (pk.offsetHeight > maxH && w > 30) { w -= 4; pk.style.setProperty("--pw", w + "px"); }
    } else pk.hidden = true;
  }

  /* Floor grid: try different row counts and keep the one with the largest cards (cap: largest card width) */
  function floorLayout(depths, Wf, Hf, cap) {
    const gx = 6, gy = 8, px = 8, py = 9;
    let best = null;
    for (let r = 1; r <= Math.min(4, depths.length); r++) {
      const c = Math.ceil(depths.length / r), rows = Math.ceil(depths.length / c);
      const byW = (Wf - 2 * px - (c - 1) * gx) / c;
      let units = 0;
      for (let i = 0; i < rows; i++) units += 1.55 * (1 + (Math.max(...depths.slice(i * c, (i + 1) * c)) - 1) * OFFR);
      const byH = (Hf - 2 * py - (rows - 1) * gy) / units;
      const cw = Math.min(byW, byH);
      if (!best || cw > best.cw + 0.5) best = { c, rows, cw };
    }
    best.cw = Math.min(best.cw, cap);
    return best;
  }

  function renderHand(lay) {
    const v = M.v, me = M.me, hand = R("hand");
    const ask = open("play");
    const flips = v.flips[me] || 0;
    const count = v.hand.length + (flips ? 1 : 0);
    hand.innerHTML = "";
    const cw = lay.hc, per = lay.per;
    hand.style.setProperty("--hw", cw + "px");
    hand.style.height = lay.hh + "px";
    if (!count) {
      hand.style.maxWidth = "none";
      hand.innerHTML = `<div class="gs-faint gs-nohand">${["roundEnd", "over"].includes(v.phase) ? "" : L("손패를 다 냈습니다", "No cards left in your hand")}</div>`;
      return;
    }
    hand.style.maxWidth = (per * cw + (per - 1) * 5) + "px";
    for (const c of v.hand) {
      const I = handInfo(v, c);
      const cls = [];
      if (c === sel) cls.push("sel");
      if (I.can) cls.push("can");
      const sp = I.bomb ? "" : I.shake ? `<span class="gs-sb">${L("흔들", "Shake")}</span>` : "";
      const b = el("button", "gs-hc" + (I.can ? "" : " nm"), hwHTML(c, cls.join(" ")) + sp + `<span class="gs-ht ${I.tcls}">${I.tag || "&nbsp;"}</span>`);
      b.setAttribute("aria-label", cardName(c) + (I.tag ? ` — ${I.tag}` : ""));
      b.onclick = () => tap(c);
      hand.appendChild(b);
    }
    if (flips) {
      const b = el("button", "gs-hc gs-flip", `<div class="hw back${ask ? " can" : ""}"><i></i></div><span class="gs-fl">${L("뒤집기", "Flip")}<br>×${flips}</span><span class="gs-ht">&nbsp;</span>`);
      b.setAttribute("aria-label", L("패 뒤집기만 하기", "Flip a card only"));
      b.onclick = () => { if (open("play")) send({ flip: true }, "play"); else if (!inReplay()) ctx.toast(L("내 차례에 누르세요", "Wait for your turn")); };
      hand.appendChild(b);
    }
  }

  /* What the selected card would do — including the score change */
  function describe(v, c) {
    if (isBonus(c)) return L(`${esc(cardName(c))} — 내면 바로 내 피(+${CARDS[c].pv})가 되고 한 장 더 받습니다`,
      `${esc(cardName(c))} — becomes your pi (+${CARDS[c].pv}) at once and you draw a card`);
    const I = handInfo(v, c), m = I.m, F = I.F;
    let t;
    if (I.bomb) t = L(`<b>💣 폭탄</b> 가능 — ${m}월 4장 + 상대마다 피 1장`, `<b>💣 Bomb</b> possible — all 4 ${mon(m)} cards + 1 pi from each opponent`);
    else if (I.kind === "lay") t = L(`${m}월은 바닥에 없어 깔립니다`, `No ${mon(m)} on the floor — it is laid down`) + (I.shake ? L(" · <b>흔들기</b> 가능", " · <b>Shake</b> possible") : "");
    else if (I.kind === "pair") t = L(`바닥 ${esc(cardName(I.gains[1]))}와 짝`, `Pairs with the floor ${esc(cardName(I.gains[1]))}`);
    else if (I.kind === "pair2") t = L(`${esc(kindLabel(F[0]))}·${esc(kindLabel(F[1]))} 중 골라 먹기`, `Take ${esc(kindLabel(F[0]))} or ${esc(kindLabel(F[1]))} (your choice)`);
    else t = v.ppeok.includes(m) ? L("뻑 3장 모두 먹고 피 뺏기", "Takes all 3 ppeok cards + steals pi") : L(`${m}월 3장 모두 먹기`, `Takes all 3 ${mon(m)} cards`);
    if (I.delta > 0) {
      const P = A.P[M.me], now = P.sc.total, aft = I.after.total, done = I.done.join("·"), can = aft >= P.goal;
      t += L(` → <b class="gold">${done ? done + " 완성 " : ""}+${I.delta}점</b> (${now}→${aft}${can ? " · 날 수 있음" : ""})`,
        ` → <b class="gold">${done ? done + " complete " : ""}+${ptsEn(I.delta)}</b> (${now}→${aft}${can ? " · enough to win" : ""})`);
    }
    if (I.blocks.length) t += ` · <b class="block">${esc(L(`${I.blocks.join(", ")} 막기`, `blocks ${I.blocks.join(", ")}`))}</b>`;
    if (I.gives.length) t += ` · <b class="bad">⚠ ${esc(L(`${I.gives.join(", ")} 재료를 내줌`, `feeds ${I.gives.join(", ")}`))}</b>`;
    return t;
  }

  function renderHint() {
    const v = M.v, me = M.me, h = R("hint");
    let t;
    if (v.phase === "over") t = L("게임 끝", "Game over");
    else if (v.phase === "roundEnd") t = v.round >= v.rounds ? L("마지막 판이 끝났습니다", "The last round is over") : L("곧 다음 판이 시작됩니다", "The next round starts soon");
    else if (open("choose")) t = L("<b>가져갈 바닥 카드</b>를 고르세요", "Pick the <b>floor card to take</b>");
    else if (open("gostop")) t = L("<b>고? 스톱?</b>", "<b>Go or Stop?</b>");
    else if (open("play")) t = sel ? `${L("<b>다시 누르면 냄</b>", "<b>Tap again to play</b>")} · ${describe(v, sel)}`
      : v.hand.length ? L("<b>내 차례</b> — 낼 카드를 누르세요 (아래 글씨: 먹는 패 · 점수)", "<b>Your turn</b> — tap a card to play (tags below: what it takes · points)")
      : L("<b>내 차례</b> — 「뒤집기」를 누르세요", "<b>Your turn</b> — tap “Flip”");
    else if (sel) t = describe(v, sel);
    else if (v.turn === me) t = !inReplay() ? "…" : v.phase === "choose" ? L("<b>내 차례</b> — 가져갈 카드 고르는 중", "<b>Your turn</b> — picking a card to take")
      : v.phase === "gostop" ? L("<b>내 차례</b> — 고/스톱 고민 중", "<b>Your turn</b> — deciding: Go or Stop") : L("<b>내 차례</b>", "<b>Your turn</b>");
    else {
      const nm = esc(name(v.turn));
      t = L(`${nm} 님 ${v.phase === "choose" ? "카드 고르는 중" : v.phase === "gostop" ? "고/스톱 고민 중" : "차례"} — 손패를 눌러 미리 볼 수 있습니다`,
        `${v.phase === "choose" ? `${nm} is picking a card` : v.phase === "gostop" ? `${nm} is deciding: Go or Stop` : `${nm}'s turn`} — tap your cards to preview`);
    }
    h.innerHTML = `<span>${t}</span>`;
  }

  /* ---------------- Round result ---------------- */
  function renderOver(staging) {
    const v = M.v, box = R("over"), r = v.result;
    if (staging || !r || !["roundEnd", "over"].includes(v.phase) || hiddenRound === r.round) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = resultHTML(v, r) + `<div class="gs-ofoot"><small>${v.phase === "over" || v.round >= v.rounds
      ? L("마지막 판이었습니다", "That was the last round") : L("잠시 후 다음 판", "Next round shortly")}</small><button class="btn small">${L("닫기", "Close")}</button></div>`;
    box.querySelector(".gs-ofoot button").onclick = () => { hiddenRound = r.round; box.hidden = true; };
  }
  function resultHTML(v, r) {
    const me = M.me;
    let h = `<div class="eyebrow">${L(`${r.round}판 결과`, `Round ${r.round} result`)}</div>`;
    if (r.kind === "nagari") {
      h += L(`<h3>나가리</h3><p>아무도 스톱하지 못했습니다. 다음 판 점수는 <b>×${r.nagari}</b></p>`,
        `<h3>Nagari — no winner</h3><p>Nobody stopped. The next round scores <b>×${r.nagari}</b></p>`);
    } else if (r.kind === "chongtong") {
      h += `<h3>${r.winner === me ? L("총통! 🎉", "Chongtong! 🎉") : L(`${who(r.winner)} 님 총통!`, `${who(r.winner)}: chongtong!`)}</h3>` +
        `<div class="gs-rcards">${r.cards.map(c => hwHTML(c, "md")).join("")}</div>` +
        `<p>${L(`${r.m}월 4장 — <b>10점</b>`, `All four ${mon(r.m)} cards — <b>10 points</b>`)}${r.nagari > 1 ? L(` × 나가리 ${r.nagari}`, ` × nagari ${r.nagari}`) : ""}</p>` + payHTML(r);
    } else {
      const s = r.score;
      h += `<h3>${r.winner === me ? L("이겼습니다! 🎉", "You won! 🎉") : L(`${who(r.winner)} 님 승리`, `${who(r.winner)} wins`)}` +
        `${r.how === "auto" ? ` <small>${L("(패를 다 내서 자동 스톱)", "(out of cards — automatic stop)")}</small>` : ""}</h3>`;
      h += `<div class="gs-items">${s.items.map(([l, p]) => `<span>${esc(loc(l))} <b>${p}</b></span>`).join("")}</div>`;
      let calc = L(`${r.base}점`, ptsEn(r.base));
      if (r.go) calc += L(` + ${r.go}고 ${r.go}점`, ` + ${r.go} Go ${ptsEn(r.go)}`);
      if (r.goMul > 1) calc = L(`(${calc}) × ${r.goMul} (${r.go}고)`, `(${calc}) × ${r.goMul} (${r.go} Go)`);
      h += `<p class="gs-calc">${calc} = <b>${L(`${r.pts}점`, ptsEn(r.pts))}</b></p>`;
      const mul = [];
      if (r.shakes) mul.push(L(`흔들기·폭탄 ×${2 ** r.shakes}`, `Shake·bomb ×${2 ** r.shakes}`));
      if (r.nagari > 1) mul.push(L(`나가리 ×${r.nagari}`, `Nagari ×${r.nagari}`));
      if (mul.length) h += `<p class="gs-calc">${L("모두에게", "Every loser")}: ${mul.join(" · ")}</p>`;
      h += payHTML(r);
    }
    h += `<div class="gs-totals">${M.players.map((pl, p) => `<span class="${p === me ? "me" : ""}">${who(p)} <b>${signed(v.totals[p])}</b>` +
      `${r.deltas && r.deltas[p] ? `<small>(${signed(r.deltas[p])})</small>` : ""}</span>`).join("")}</div>`;
    return h;
  }
  function payHTML(r) {
    if (!r.losers || !r.losers.length) return "";
    const rows = r.losers.map(l => {
      const t = [];
      if (l.pibak) t.push(`${bakName("pibak")} ×2 <small>${L(`(피 ${l.pi})`, `(${l.pi} pi)`)}</small>`);
      if (l.gwangbak) t.push(`${bakName("gwangbak")} ×2`);
      if (l.meongbak) t.push(`${bakName("meongbak")} ×2`);
      if (l.gobak) t.push(L("고박 — 두 사람 몫", "Gobak — pays both shares"));
      if (l.covered) t.push(L("고박 덕에 면제", "Covered by gobak"));
      const calc = l.mul > 1 && !l.covered ? `<small class="gs-pcalc">${l.amount / l.mul}×${l.mul}</small>` : "";
      return `<tr><td>${who(l.p)}</td><td>${t.map(x => `<span class="gs-mul">${x}</span>`).join("") || `<span class="gs-faint">${L("배수 없음", "No multipliers")}</span>`}</td>` +
        `<td class="pay">${calc}−${l.pay}</td></tr>`;
    }).join("");
    return `<table class="gs-pay"><tbody>${rows}</tbody></table>`;
  }

  /* ---------------- Go / Stop dialog ---------------- */
  function openGoStop(ask) {
    if (gsBox && gsBox.id === ask.id) return;
    closeGoStop();
    const v = M.v, me = M.me, sc = v.scores[me], pv = v.preview;
    const entry = { id: ask.id, close: null };
    gsBox = entry;
    ctx.sound.good();
    ctx.modal((box, close) => {
      entry.close = close;
      box.classList.add("gs-gsm");
      const goN = v.go[me] + 1;
      ctx.head(box, v.go[me] ? L(`${v.go[me]}고 하는 중`, `On ${v.go[me]} Go`) : L("났습니다!", "You scored!"),
        L(`${sc.total}점 — 고? 스톱?`, `${pointsEn(sc.total)} — Go or Stop?`),
        sc.items.map(([l, p]) => `${esc(loc(l))}${L(` ${p}점`, `: ${p}`)}`).join(" · "));
      const stopGain = pv ? pv.deltas[me] : 0;
      const lines = [];
      if (pv) {
        const mults = pv.losers.map(l => {
          const t = ["pibak", "gwangbak", "meongbak", "gobak"].filter(k => l[k]).map(bakName);
          return `${who(l.p)} −${l.pay}${t.length ? ` (${t.join("·")})` : ""}`;
        });
        lines.push(L(`<li><b>스톱</b>: 지금 끝내고 <b>${stopGain}점</b>을 받습니다 — ${mults.join(", ")}</li>`,
          `<li><b>Stop</b>: end the round now and collect <b>${pointsEn(stopGain)}</b> — ${mults.join(", ")}</li>`));
      }
      lines.push(L(`<li><b>${goN}고</b>: 판을 계속합니다. ${goN <= 2 ? `+${goN}점` : `점수에 ×${2 ** (goN - 2)}`} — 다음에 점수가 더 나야 다시 고/스톱을 고를 수 있습니다.</li>`,
        `<li><b>${goN} Go</b>: keep playing. ${goN <= 2 ? `+${pointsEn(goN)}` : `score ×${2 ** (goN - 2)}`} — you choose Go/Stop again only after scoring more.</li>`));
      // Opponents' threat: score · sets missing one card
      const thr = [];
      for (const P of A.P) {
        if (P.q === me) continue;
        const near = SETS.filter(s => P.sets[s].near).map(s => loc(SET_NAME[s]));
        if (P.sc.g === 2 && P.missG.length) near.push(loc(GW3));
        thr.push(L(`${who(P.q)} ${P.sc.total}점 (나기까지 ${P.need})${near.length ? ` · <b>${near.join("·")} 1장 남음</b>` : ""}`,
          `${who(P.q)} ${ptsEn(P.sc.total)} (needs ${P.need})${near.length ? ` · <b>${near.join("·")}: 1 card left</b>` : ""}`));
      }
      lines.push(`<li>${L("상대", "Opponents")}: ${thr.join(" / ")}</li>`);
      lines.push(L(`<li>상대가 먼저 나면 내가 집니다${v.n === 3 ? " — <b>고박</b>: 두 사람 몫을 혼자 냅니다" : ""}. 아무도 못 나면 나가리.</li>`,
        `<li>If an opponent scores out first, you lose${v.n === 3 ? " — <b>gobak</b>: you alone pay both shares" : ""}. If nobody does: nagari (no winner).</li>`));
      const left = v.hand.length + (v.flips[me] || 0);
      lines.push(L(`<li>내 남은 패 ${left}장 · 더미 ${v.deck}장</li>`, `<li>Your cards left: ${left} · draw pile: ${v.deck}</li>`));
      box.appendChild(el("ul", "gs-golist", lines.join("")));
      ctx.buttonRow(box, [
        { label: L("스톱", "Stop"), on: () => { if (send({ go: false }, "gostop")) close(); } },
        { label: L(`${goN}고!`, `${goN} Go!`), primary: true, on: () => { if (send({ go: true }, "gostop")) close(); } }
      ]);
    }, { dismissible: false }).then(() => { if (gsBox === entry) gsBox = null; });
  }
  function closeGoStop() {
    if (gsBox) { const b = gsBox; gsBox = null; if (b.close) b.close(null); }
  }

  /* ---------------- Captured cards ---------------- */
  function showCaps(q) {
    const v = M.v, sc = v.scores[q];
    const groups = { g: [], t: [], y: [], p: [] };
    for (const c of v.caps[q]) groups[groupOf(c, sc.guk)].push(c);
    const pts = { g: sc.gp, t: sc.tp, y: sc.yp, p: sc.pp };
    ctx.modal(box => {
      box.classList.add("gs-capm");
      ctx.head(box, L("먹은 패", "Captured cards"), `${q === M.me ? L("나", "You") : esc(name(q))} — ${L(`${sc.total}점`, ptsEn(sc.total))}`,
        sc.items.length ? sc.items.map(([l, p]) => `${esc(loc(l))}${L(` ${p}점`, `: ${p}`)}`).join(" · ") : L("아직 점수가 없습니다", "No points yet"));
      const grid = el("div", "gs-mgs");
      box.appendChild(grid);
      for (const k of GROUPS) {
        const cs = groups[k];
        const guk = sc.guk && cs.includes("9a")
          ? ` <small>${L(`(9월 국진을 ${k === "p" ? "쌍피" : "열끗"}로 셈)`, `(Sep gukjin counted as ${k === "p" ? "double pi" : "an animal"})`)}</small>` : "";
        const cnt = k === "p" ? L(`${sc.pi}장 <small>(쌍피 2 · 쓰리피 3)</small>`, `${sc.pi} <small>(double pi 2 · triple pi 3)</small>`) : L(`${cs.length}장`, String(cs.length));
        grid.insertAdjacentHTML("beforeend", `<div class="gs-mg"><div class="gs-mgh">${groupLabel(k)} ${cnt}` +
          ` · <b>${L(`${pts[k]}점`, ptsEn(pts[k]))}</b>${guk}</div>` +
          `<div class="gs-mgc">${cs.map(c => hwHTML(c, "md")).join("") || `<span class="gs-faint">${L("없음", "None")}</span>`}</div></div>`);
      }
    });
  }

  /* ---------------- Sending actions ---------------- */
  function tap(c) {
    if (sel !== c) { sel = c; render(); return; }
    if (inReplay()) { sel = null; render(); return; }                // replays: a tap only previews
    if (!open("play")) { ctx.toast(L("아직 내 차례가 아닙니다", "It's not your turn yet")); return; }
    play(c);
  }
  async function play(c) {
    const v = M.v;
    if (isBonus(c)) { send({ bonus: c }, "play"); return; }
    const m = monthOf(c);
    let a = { card: c };
    if (v.can && v.can.bomb.includes(m)) {
      const r = await ctx.choose(L(`${m}월 폭탄?`, `${mon(m)} bomb?`),
        L(`${m}월 3장을 들고 있고 바닥에 나머지 1장이 있습니다.`, `You hold 3 ${mon(m)} cards and the 4th is on the floor.`), [
          { value: "bomb", label: L("💣 폭탄 — 3장을 한꺼번에", "💣 Bomb — play all 3 at once"),
            note: L("4장을 다 먹고 상대마다 피 1장씩 · 이기면 ×2 · 뒤집기만 하는 차례 2번", "Take all 4 and 1 pi from each opponent · ×2 if you win · 2 flip-only turns") },
          { value: "one", label: L("한 장만 내기", "Play just one"), note: L("바닥의 1장과 짝", "Pairs with the floor card") }]);
      if (!r) return;
      if (r === "bomb") a.bomb = true;
    } else if (v.can && v.can.shake.includes(m)) {
      const r = await ctx.choose(L(`${m}월 흔들기?`, `Shake ${mon(m)}?`),
        L(`${m}월 3장을 들고 있습니다. 흔들면 3장을 모두에게 보여 주고, 이 판을 이기면 점수 ×2.`,
          `You hold 3 ${mon(m)} cards. Shaking shows all 3 to everyone; if you win this round, your score is ×2.`), [
          { value: "shake", label: L("흔들고 내기", "Shake and play"), note: L("이기면 ×2", "×2 if you win") },
          { value: "one", label: L("그냥 내기", "Just play") }]);
      if (!r) return;
      if (r === "shake") a.shake = true;
    }
    send(a, "play");
  }
  function send(a, kind) {
    const ask = open(kind);
    if (!ask) return false;
    // Remember where my hand cards are: the card I play flies from there once the new state arrives
    const rects = new Map();
    if (kind === "play") for (const h of R("hand").querySelectorAll(".gs-hc .hw[data-c]")) rects.set(h.dataset.c, h.getBoundingClientRect());
    if (!ctx.send(a)) return false;
    if (kind === "play") handRects = rects;
    sentId = ask.id; sel = null;
    render();
    return true;
  }

  /* ---------------- Events: sounds · big captions ---------------- */
  let bannerT = 0;
  function banner(text, cls = "") {
    const b = R("banner");
    b.innerHTML = `<b class="${cls}">${esc(text)}</b>`;
    clearTimeout(bannerT);
    bannerT = setTimeout(() => { b.innerHTML = ""; }, 1500);
  }
  function events(m) {
    const me = m.me, S = ctx.sound, sp = me < 0;
    const good = p => p === me || sp;                  // spectators cheer for everyone
    for (const e of m.ev || []) {
      if (e.type === "deal") S.deal();
      else if (e.type === "play") S.place();
      else if (e.type === "flip") later(() => S.flip(), 230);
      else if (e.type === "bonus" && !e.floor) { if (e.p === me) S.good(); }
      else if (e.type === "turn") {
        if (e.captured.length) later(() => S.deal(), 430);
        const robbed = e.stolen.some(s => s.from === me);
        if (e.combos.length) {
          banner(e.combos.map(c => loc(COMBO[c])).join(" · ") + "!", e.p === me ? "good" : robbed ? "bad" : "");
          later(() => (e.p === me ? S.good() : robbed ? S.bad() : S.chip()), 520);
          if (e.p === me) ctx.buzz(40);
        }
      } else if (e.type === "go") { banner(L(`${e.go}고!`, `${e.go} Go!`), "go"); S.chip(); }
      else if (e.type === "roundEnd") {
        banner(e.winner === me ? L("스톱! 승리", "Stop! You win") : sp ? L(`${name(e.winner)} 스톱!`, `${name(e.winner)} stops!`) : L("스톱!", "Stop!"), good(e.winner) ? "good" : "bad");
        later(() => (good(e.winner) ? S.good() : S.bad()), 300);
      }
      else if (e.type === "nagari") { banner(L("나가리", "Nagari"), ""); S.pass(); }
      else if (e.type === "chongtong") { banner(L("총통!", "Chongtong!"), good(e.p) ? "good" : "bad"); later(() => (good(e.p) ? S.good() : S.bad()), 300); }
    }
  }

  /* Redraw when the stage changes size (window resize, rotation, or the page zoom of the screen-size setting) */
  let lastW = 0, lastH = 0;
  function onResize() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (w !== lastW || h !== lastH) { lastW = w; lastH = h; if (M) render(); }
  }
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
  if (ro) ro.observe(wrap);
  window.addEventListener("resize", onResize);

  return {
    update,
    ticker: false,                 // each panel shows the last move directly
    landscape: true,               // own sideways layout (style.css)
    destroy() {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", onResize);
      for (const t of timers) clearTimeout(t);
      clearTimeout(bannerT);
      closeGoStop();
      root.innerHTML = "";
    }
  };
}
