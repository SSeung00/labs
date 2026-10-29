/* Go-Stop (3 players) · Matgo (2 players) — 48 hwatu cards + bonus pi.
   A turn: play one hand card (pairs with a floor card of the same month) → flip the top card of the draw pile (pairs the same way).
   When the captured cards score at least the winning threshold (Matgo 7 · Go-Stop 3), choose Go or Stop.
   After the chosen number of rounds, players are ranked by total score.

   Main fields of the state S
     hands[p] hand · floor · deck draw pile (top = end of array) · caps[p] captured cards
     phase: "play" | "choose" (pick one of two floor cards) | "gostop" | "roundEnd" (round settled) | "over"
     tp: the turn in progress (may pause for a choice) · ch: choice info · ppeok: {month: player who made the ppeok}
     go[p] number of Go calls · goScore[p] score at the last Go · shook[p] shakes/bombs [{m, bomb}] · flips[p] flip-only turns
     totals[p] running totals (always sum to 0) · nagari nagari multiplier · result settlement of the last round
     last: the latest finished turn · lastBy[p]: each player's latest turn this round (public; lets a remounted screen show them)
   Every text produced here is bilingual (tx) — see games/README.md. */
import { shuffle, randInt } from "../../core/rng.js";
import { tx } from "../../core/i18n.js";
import { CARDS, DECK48, BONUS, SET_NAME, COMBO, isCard, monthOf, isBonus, cardNameTx, monTx, sortCards } from "./cards.js";

const name = tx("고스톱", "Go-Stop");
const TH = n => (n === 2 ? 7 : 3);                        // winning threshold
const others = (S, p) => { const r = []; for (let q = 0; q < S.n; q++) if (q !== p) r.push(q); return r; };
const ofMonth = (arr, m) => arr.filter(x => monthOf(x) === m);
function removeIds(arr, ids) { for (const id of ids) { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); } }
const turnsOf = (S, p) => S.hands[p].length + S.flips[p];
const anyTurns = S => S.hands.some((h, p) => h.length + S.flips[p] > 0);
const zeros = n => Array.from({ length: n }, () => 0);
const pick = (rng, a) => a[Math.floor(rng() * a.length)];
/* Two identical cards (e.g. two plain pi) need no choice */
const sameKind = (a, b) => CARDS[a].t === "p" && CARDS[b].t === "p" && CARDS[a].pv === CARDS[b].pv;
/* "1 win" / "2 wins" */
const plural = (n, one, many) => `${n} ${Math.abs(n) === 1 ? one : many}`;

/* ===================== Scoring ===================== */
/* gukAs: count the September gukjin as "y" animal or "p" double pi.
   items: [label (tx), points, key] — key: g3/g4/g5/rain3 · t · hong/cheong/cho · y · go · pi */
export function scoreCards(cards, gukAs) {
  let g = 0, rain = false, t = 0, y = 0, pi = 0;
  const sets = { hong: 0, cheong: 0, cho: 0, go: 0 };
  for (const id of cards) {
    const c = CARDS[id];
    if (c.t === "g") { g++; if (c.rain) rain = true; }
    else if (c.t === "t") { t++; if (c.set) sets[c.set]++; }
    else if (c.t === "y") { if (c.guk && gukAs === "p") pi += 2; else { y++; if (c.set) sets[c.set]++; } }
    else pi += c.pv;
  }
  const items = [];
  const gp = g >= 5 ? 15 : g === 4 ? 4 : g === 3 ? (rain ? 2 : 3) : 0;
  if (gp) items.push(g === 3 && rain ? [tx("비삼광", "3 Gwang (rain)"), gp, "rain3"] : [tx(`${g}광`, `${g} Gwang`), gp, "g" + g]);
  let tp = t >= 5 ? t - 4 : 0;
  if (tp) items.push([tx(`띠 ${t}장`, `${t} Ribbons`), tp, "t"]);
  for (const k of ["hong", "cheong", "cho"]) if (sets[k] === 3) { tp += 3; items.push([SET_NAME[k], 3, k]); }
  let yp = y >= 5 ? y - 4 : 0;
  if (yp) items.push([tx(`열끗 ${y}장`, `${y} Animals`), yp, "y"]);
  if (sets.go === 3) { yp += 5; items.push([SET_NAME.go, 5, "go"]); }
  const pp = pi >= 10 ? pi - 9 : 0;
  if (pp) items.push([tx(`피 ${pi}장`, `${pi} Pi`), pp, "pi"]);
  return { g, t, y, pi, gp, tp, yp, pp, total: gp + tp + yp + pp, items, sets, guk: null };
}
/* Gukjin automatically counts the way that scores more (animal on a tie) */
export function scoreOf(cards) {
  if (!cards.includes("9a")) return scoreCards(cards, "y");
  const a = scoreCards(cards, "y"), b = scoreCards(cards, "p");
  if (b.total > a.total) { b.guk = "p"; return b; }
  a.guk = "y";
  return a;
}

/* Settlement if winner w ended the round now (does not change S) */
export function settle(S, w) {
  const ws = scoreOf(S.caps[w]);
  const go = S.go[w], goMul = go >= 3 ? 2 ** (go - 2) : 1;
  const base = ws.total, pts = (base + go) * goMul;
  const shakes = S.shook[w].length;
  const meong = ws.y >= 7;
  const losers = [];
  for (const q of others(S, w)) {
    let lpi = 0, lg = 0;
    for (const id of S.caps[q]) {
      const c = CARDS[id];
      if (c.t === "p") lpi += c.pv;
      else if (c.guk) lpi += 2;                  // a loser's gukjin counts as double pi (helps avoid pibak)
      else if (c.t === "g") lg++;
    }
    const pibak = ws.pp > 0 && lpi < 6;
    const gwangbak = ws.gp > 0 && lg === 0;
    const mul = 2 ** shakes * S.nagari * (pibak ? 2 : 1) * (gwangbak ? 2 : 1) * (meong ? 2 : 1);
    losers.push({ p: q, pi: lpi, gwang: lg, pibak, gwangbak, meongbak: meong, mul, amount: pts * mul, pay: pts * mul, go: S.go[q], gobak: false, covered: false });
  }
  // Gobak (3 players): a loser who called Go pays both losers' shares
  if (S.n === 3) {
    const goers = losers.filter(l => l.go > 0);
    if (goers.length === 1) {
      const g = goers[0], o = losers.find(l => l !== g);
      g.pay = g.amount + o.amount; g.gobak = true; o.pay = 0; o.covered = true;
    }
  }
  const deltas = zeros(S.n);
  for (const l of losers) { deltas[l.p] -= l.pay; deltas[w] += l.pay; }
  return {
    kind: "win", round: S.round, winner: w,
    score: { gp: ws.gp, tp: ws.tp, yp: ws.yp, pp: ws.pp, total: ws.total, items: ws.items, g: ws.g, t: ws.t, y: ws.y, pi: ws.pi, guk: ws.guk },
    base, go, goMul, pts, shakes, nagari: S.nagari, losers, deltas
  };
}

/* ===================== Dealing ===================== */
function deal(S) {
  const n = S.n, hn = n === 2 ? 10 : 7, fn = n === 2 ? 8 : 6;
  let deck, hands, floor, extra;
  for (let tries = 0; ; tries++) {
    deck = shuffle(S, [...DECK48, ...(S.bonus ? BONUS : [])]);
    hands = [];
    for (let p = 0; p < n; p++) hands.push(deck.splice(deck.length - hn, hn));
    floor = deck.splice(deck.length - fn, fn);
    extra = [];
    // Bonus cards dealt to the floor go to the leader; their spots are refilled from the pile
    for (let i = 0; i < floor.length; i++) while (isBonus(floor[i])) { extra.push(floor[i]); floor[i] = deck.pop(); }
    const cnt = {};
    for (const c of floor) cnt[monthOf(c)] = (cnt[monthOf(c)] || 0) + 1;
    if (!Object.values(cnt).some(k => k >= 4) || tries >= 40) break;   // all four of a month on the floor → redeal
  }
  S.hands = hands; S.floor = floor; S.deck = deck;
  S.caps = hands.map(() => []);
  S.caps[S.leader].push(...extra);
  S.go = zeros(n); S.goScore = zeros(n); S.flips = zeros(n); S.shook = hands.map(() => []);
  S.ppeok = {}; S.tp = null; S.ch = null; S.last = null; S.lastBy = hands.map(() => null); S.result = null; S.shown = [];
  S.turn = S.leader; S.phase = "play";
  const nag = S.nagari > 1;
  const ev = [{ type: "deal", round: S.round, leader: S.leader,
    text: tx(`${S.round}판 시작 — {${S.leader}} 님이 선${nag ? ` (나가리 ×${S.nagari})` : ""}`,
      `Round ${S.round} — {${S.leader}} leads${nag ? ` (nagari ×${S.nagari})` : ""}`) }];
  if (extra.length) ev.push({ type: "bonus", p: S.leader, card: extra[0], floor: true,
    text: tx(`바닥의 보너스 피를 선인 {${S.leader}} 님이 가져갑니다`, `The leader {${S.leader}} takes the bonus pi from the floor`) });
  // Chongtong: all four cards of a month in the dealt hand → instant win (10 points)
  for (let k = 0; k < n; k++) {
    const p = (S.leader + k) % n;
    for (let m = 1; m <= 12; m++) {
      const four = ofMonth(S.hands[p], m);
      if (four.length < 4) continue;
      const losers = others(S, p).map(q => ({ p: q, mul: S.nagari, amount: 10 * S.nagari, pay: 10 * S.nagari }));
      const deltas = zeros(n);
      for (const l of losers) { deltas[l.p] -= l.pay; deltas[p] += l.pay; }
      S.result = { kind: "chongtong", round: S.round, winner: p, m, cards: four, pts: 10, nagari: S.nagari, losers, deltas };
      S.shown.push(...four);
      for (let q = 0; q < n; q++) S.totals[q] += deltas[q];
      S.wins[p]++; S.leader = p; S.nagari = 1;
      S.phase = "roundEnd";
      ev.push({ type: "chongtong", p, m, cards: four, toast: true,
        text: tx(`{${p}} 님 총통! (${m}월 4장) — 10점`, `{${p}}: Chongtong! (all four ${monTx(m).en}) — 10 points`) });
      return ev;
    }
  }
  return ev;
}

/* ===================== One turn ===================== */
function capture(S, tp, ids) {
  removeIds(S.floor, ids);
  S.caps[tp.p].push(...ids);
  tp.captured.push(...ids);
}
function stealPi(S, from, to) {
  const cap = S.caps[from];
  for (const want of [1, 2, 3]) for (let i = cap.length - 1; i >= 0; i--) {     // plain pi → double pi → triple pi
    const c = CARDS[cap[i]];
    if (c.t === "p" && c.pv === want) { const [id] = cap.splice(i, 1); S.caps[to].push(id); return id; }
  }
  return null;
}
function ppeokTake(S, tp, m) {
  if (S.ppeok[m] !== undefined) { tp.steals++; tp.combos.push(S.ppeok[m] === tp.p ? "selfPpeok" : "ppeokTake"); }
  delete S.ppeok[m];
}

/* Bonus pi from the hand: goes to my pi and I draw one card from the pile (still my turn) */
function playBonus(S, p, id) {
  removeIds(S.hands[p], [id]);
  S.caps[p].push(id);
  const drew = S.deck.length ? S.deck.pop() : null;
  if (drew) S.hands[p].push(drew);
  const cn = cardNameTx(id);
  return [{ type: "bonus", p, card: id, drew,
    text: tx(`{${p}} 님 ${cn.ko} — 피로 가져가고 한 장 더 받음`, `{${p}} plays a ${cn.en} — keeps it as pi and draws a card`) }];
}

function playTurn(S, p, a) {
  const ev = [];
  const hand = S.hands[p];
  const tp = S.tp = { p, kind: "", m: 0, played: [], target: null, d: null, flipped: [], captured: [], combos: [], steals: 0, stolen: [] };
  if (a.flip) {
    S.flips[p]--;
    tp.kind = "flip";
  } else {
    const m = monthOf(a.card), F = ofMonth(S.floor, m);
    tp.m = m;
    if (a.bomb) {
      const mine = ofMonth(hand, m);
      removeIds(hand, mine);
      tp.played = mine.slice();
      S.floor.push(...mine);
      capture(S, tp, [...mine, ...F]);
      tp.kind = "bomb"; tp.steals++; tp.combos.push("bomb");
      S.flips[p] += 2;
      S.shook[p].push({ m, bomb: true });
      ev.push({ type: "bomb", p, m, cards: mine.slice(), toast: true,
        text: tx(`{${p}} 님 ${m}월 폭탄! 💣 (이기면 ×2)`, `{${p}}: ${monTx(m).en} bomb! 💣 (×2 if they win)`) });
    } else {
      removeIds(hand, [a.card]);
      tp.played = [a.card];
      S.floor.push(a.card);
      if (a.shake) {
        const show = [a.card, ...ofMonth(hand, m)];
        S.shook[p].push({ m, bomb: false });
        S.shown.push(...show);
        tp.combos.push("shake");
        ev.push({ type: "shake", p, m, cards: show, toast: true,
          text: tx(`{${p}} 님 ${m}월 흔들기! (이기면 ×2)`, `{${p}} shakes ${monTx(m).en}! (×2 if they win)`) });
      }
      if (F.length === 0) tp.kind = "lay";
      else if (F.length === 1) { tp.kind = "pair"; tp.target = F[0]; }
      else if (F.length === 2) {
        tp.kind = "pair2";
        if (sameKind(F[0], F[1])) tp.target = F[0];
        else { S.phase = "choose"; S.ch = { stage: "play", m, options: F.slice() }; }
      } else {
        tp.kind = "take4";
        capture(S, tp, [a.card, ...F]);
        ppeokTake(S, tp, m);
      }
    }
  }
  ev.push({ type: "play", p, cards: tp.played.slice(), kind: tp.kind });
  if (S.phase !== "choose") flipStage(S, ev);
  return ev;
}

function flipStage(S, ev) {
  const tp = S.tp, p = tp.p;
  while (S.deck.length && isBonus(S.deck[S.deck.length - 1])) {     // flipped bonus: keep it and flip again
    const b = S.deck.pop();
    S.caps[p].push(b); tp.flipped.push(b); tp.captured.push(b);
    ev.push({ type: "flip", p, card: b, bonus: true });
  }
  if (!S.deck.length) return finishTurn(S, ev);
  const d = S.deck.pop(), md = monthOf(d);
  tp.d = d; tp.flipped.push(d);
  S.floor.push(d);
  ev.push({ type: "flip", p, card: d });
  if (md === tp.m && (tp.kind === "lay" || tp.kind === "pair" || tp.kind === "pair2")) {
    if (tp.kind === "lay") { capture(S, tp, [tp.played[0], d]); tp.steals++; tp.combos.push("jjok"); }
    else if (tp.kind === "pair") { tp.target = null; S.ppeok[md] = p; tp.combos.push("ppeok"); }
    else { tp.target = null; capture(S, tp, ofMonth(S.floor, md)); tp.steals++; tp.combos.push("ttadak"); }
    return finishTurn(S, ev);
  }
  const G = S.floor.filter(x => x !== d && monthOf(x) === md);
  if (G.length === 1) capture(S, tp, [d, G[0]]);
  else if (G.length === 2) {
    if (sameKind(G[0], G[1])) capture(S, tp, [d, G[0]]);
    else { S.phase = "choose"; S.ch = { stage: "flip", m: md, options: G.slice() }; return; }
  } else if (G.length === 3) {
    capture(S, tp, [d, ...G]);
    ppeokTake(S, tp, md);
  }
  finishTurn(S, ev);
}

/* One log line: "{0}: Mar Hongdan → Aug Gwang · took 4 · Jjok!" (after → : the flipped cards) */
function turnText(tp) {
  const out = {};
  for (const l of ["ko", "en"]) {
    const ko = l === "ko", parts = [];
    if (tp.kind === "flip") parts.push(ko ? "(뒤집기만)" : "(flip only)");
    else if (tp.kind === "bomb") parts.push(ko ? `${tp.m}월 폭탄` : `${monTx(tp.m).en} bomb`);
    else parts.push(cardNameTx(tp.played[0])[l]);
    if (tp.flipped.length) parts.push(tp.flipped.map(c => cardNameTx(c)[l]).join(" + "));      // flipped bonus pi included
    let s = `{${tp.p}}${ko ? " 님" : ""}: ${parts.join(" → ")}`;
    if (tp.captured.length) s += ko ? ` · ${tp.captured.length}장 먹음` : ` · took ${tp.captured.length}`;
    const combos = tp.combos.filter(c => c !== "shake" && c !== "bomb");
    if (combos.length) s += ` · ${combos.map(c => COMBO[c][l]).join(" · ")}!`;
    if (tp.stolen.length) s += ko ? ` (피 ${tp.stolen.length}장 뺏음)` : ` (stole ${tp.stolen.length} pi)`;
    out[l] = s;
  }
  return tx(out.ko, out.en);
}

function finishTurn(S, ev) {
  const tp = S.tp, p = tp.p;
  S.phase = "play"; S.ch = null;
  if (tp.target) { capture(S, tp, [tp.played[0], tp.target]); tp.target = null; }
  for (const k of Object.keys(S.ppeok)) if (ofMonth(S.floor, +k).length !== 3) delete S.ppeok[k];
  if (!S.floor.length && anyTurns(S)) { tp.steals++; tp.combos.push("sseul"); }     // no sseul on the round's last turn
  for (const q of others(S, p)) for (let k = 0; k < tp.steals; k++) {
    const c = stealPi(S, q, p);
    if (c) tp.stolen.push({ from: q, card: c });
  }
  S.last = { p, kind: tp.kind, m: tp.m, played: tp.played, flipped: tp.flipped, captured: tp.captured, combos: tp.combos, stolen: tp.stolen };
  if (S.lastBy) S.lastBy[p] = JSON.parse(JSON.stringify(S.last));
  ev.push({ type: "turn", ...JSON.parse(JSON.stringify(S.last)), text: turnText(tp) });
  S.tp = null;
  const sc = scoreOf(S.caps[p]).total;
  if (sc >= TH(S.n) && sc > S.goScore[p]) {
    S.turn = p;
    if (turnsOf(S, p) > 0) { S.phase = "gostop"; return; }
    ev.push(...endRound(S, p, "auto"));          // no cards left to play → automatic Stop
    return;
  }
  if (!anyTurns(S)) { ev.push(...endRound(S, null)); return; }
  nextTurn(S, p);
}

function nextTurn(S, p) {
  for (let k = 1; k <= S.n; k++) {
    const q = (p + k) % S.n;
    if (turnsOf(S, q) > 0) { S.turn = q; S.phase = "play"; return; }
  }
}

function endRound(S, w, how) {
  S.phase = "roundEnd"; S.tp = null; S.ch = null;
  if (w === null) {
    S.nagari *= 2;
    S.result = { kind: "nagari", round: S.round, nagari: S.nagari, deltas: zeros(S.n) };
    return [{ type: "nagari", toast: true,
      text: tx(`나가리! 다음 판은 점수 ×${S.nagari}`, `Nagari — no winner! Next round scores ×${S.nagari}`) }];
  }
  const R = settle(S, w);
  R.how = how;
  S.result = R;
  for (let q = 0; q < S.n; q++) S.totals[q] += R.deltas[q];
  S.wins[w]++;
  S.leader = w; S.nagari = 1;
  return [{ type: "roundEnd", winner: w, gain: R.deltas[w], toast: true,
    text: tx(`{${w}} 님 ${how === "auto" ? "났습니다" : "스톱"}! ${R.pts}점 → 모두 합해 ${R.deltas[w]}점 받음`,
      `{${w}} ${how === "auto" ? "wins" : "stops"}! ${R.pts} points → collects ${R.deltas[w]} in total`) }];
}

/* Months my hand can shake or bomb with */
function specials(S, p) {
  const r = { shake: [], bomb: [] };
  for (let m = 1; m <= 12; m++) {
    const k = ofMonth(S.hands[p], m).length, f = ofMonth(S.floor, m).length;
    if (k >= 3 && f === 1) r.bomb.push(m);
    if (k >= 3 && f === 0 && !S.shook[p].some(x => x.m === m)) r.shake.push(m);
  }
  return r;
}

/* ===================== AI ===================== */
function profile(S, q) {
  const pr = { g: 0, t: 0, y: 0, pi: 0, sets: { hong: 0, cheong: 0, cho: 0, go: 0 }, dead: { hong: false, cheong: false, cho: false, go: false } };
  for (const id of S.caps[q]) {
    const c = CARDS[id];
    if (c.t === "g") pr.g++;
    else if (c.t === "t") { pr.t++; if (c.set) pr.sets[c.set]++; }
    else if (c.t === "y") { pr.y++; if (c.set) pr.sets[c.set]++; }
    else pr.pi += c.pv;
  }
  for (const r of others(S, q)) for (const id of S.caps[r]) { const s = CARDS[id].set; if (s) pr.dead[s] = true; }
  return pr;
}
/* How valuable one card is to that player (roughly in points). aware: whether set / ribbon / godori progress counts */
function cardVal(pr, id, aware) {
  const c = CARDS[id];
  const perPi = pr.pi >= 7 ? 0.95 : pr.pi < 5 ? 0.8 : 0.65;
  if (c.t === "p") return c.pv * perPi;
  if (c.t === "g") {
    if (!aware) return 2.2;
    let v = 2 + [0.3, 1, 3, 1.5, 6][Math.min(4, pr.g)];
    if (c.rain && pr.g < 3) v -= 0.8;
    return v;
  }
  let v = c.t === "t" ? 0.7 : 0.8;
  if (aware) {
    if ((c.t === "t" ? pr.t : pr.y) >= 4) v += 0.8;
    if (c.set && !pr.dead[c.set]) v += (c.set === "go" ? [1, 2, 5] : [0.8, 1.5, 3.3])[pr.sets[c.set]] || 0;
  }
  if (c.guk) v = Math.max(v, 2 * perPi);
  return v;
}
/* How close a player looks to scoring out (for blocking opponents) */
function potential(S, q) {
  const pr = profile(S, q);
  let v = 0;
  for (const k of ["hong", "cheong", "cho"]) if (pr.sets[k] === 2 && !pr.dead[k]) v += 1.5;
  if (pr.sets.go === 2 && !pr.dead.go) v += 2.5;
  if (pr.g === 2) v += 1.2;
  if (pr.pi >= 8) v += 1;
  if (pr.y >= 4) v += 0.5;
  if (pr.t >= 4) v += 0.5;
  return v;
}
function aiCtx(S, p, level) {
  const aware = level !== "easy", block = level === "hard";
  const me = profile(S, p);
  const opp = others(S, p).map(q => profile(S, q));
  const seen = zeros(13);
  for (const id of S.hands[p]) seen[monthOf(id)]++;
  for (const id of S.floor) seen[monthOf(id)]++;
  for (const cap of S.caps) for (const id of cap) seen[monthOf(id)]++;
  let U = S.deck.length;
  for (const q of others(S, p)) U += S.hands[q].length;
  return {
    aware, block,
    my: id => cardVal(me, id, aware),
    opp: id => Math.max(0, ...opp.map(pr => cardVal(pr, id, true))),
    unseen: seen.map((k, m) => (m ? Math.max(0, 4 - k) : 0)),
    U: Math.max(1, U), nOpp: S.n - 1, nextHand: S.hands[(p + 1) % S.n].length, stealV: 0.9
  };
}
/* Expected gain of playing one hand card (or a bomb) — the flip only weighs jjok / ppeok / ttadak odds lightly */
function evalPlay(S, p, X, id, mode) {
  const m = monthOf(id), F = ofMonth(S.floor, m), mine = ofMonth(S.hands[p], m);
  const u = X.unseen[m], pFlip = u / X.U, steal = X.stealV * X.nOpp;
  const take = ids => ids.reduce((a, x) => a + X.my(x) + (X.block ? 0.4 * X.opp(x) : 0), 0);
  if (mode === "bomb") return take([...mine, ...F]) + steal + 3.5;
  let v;
  if (F.length === 0) {
    const pOpp = Math.min(1, u * X.nextHand / X.U);              // rough chance the next player holds this month
    const keep = mine.length >= 2 ? 0.3 : 1;                      // more of this month in hand → can take it back
    const loss = X.block ? X.opp(id) : X.aware ? 0.5 * X.my(id) + 0.3 : 0.3;
    v = -0.5 + pFlip * (X.my(id) + steal) - keep * pOpp * loss * 0.7;
  } else if (F.length === 1) {
    const g = take([id, F[0]]);
    v = g - pFlip * g;                                            // ppeok risk
  } else if (F.length === 2) {
    const [a, b] = F.slice().sort((x, y) => X.my(y) - X.my(x));
    v = take([id, a]) + pFlip * (take([b]) + steal);
    if (X.block && u > 0) v -= 0.3 * X.opp(b);                    // an opponent may take the card left behind
  } else {
    v = take([id, ...F]) + (S.ppeok[m] !== undefined ? steal : 0);
  }
  if (mode === "shake") v += X.aware ? 1.5 : 0.5;
  return v;
}
function aiPlay(S, p, level, rng) {
  const hand = S.hands[p];
  const b = hand.find(isBonus);
  if (b) return { bonus: b };
  const X = aiCtx(S, p, level);
  const noise = level === "easy" ? 2.5 : level === "normal" ? 0.6 : 0.2;
  let best = null, bv = -Infinity;
  const consider = (a, v) => { v += (rng() - 0.5) * noise; if (v > bv) { bv = v; best = a; } };
  for (const id of hand) {
    const m = monthOf(id), k = ofMonth(hand, m).length, f = ofMonth(S.floor, m).length;
    if (k >= 3 && f === 1) consider({ card: id, bomb: true }, evalPlay(S, p, X, id, "bomb") - (level === "easy" ? 2 : 0));
    const shake = k >= 3 && f === 0 && !S.shook[p].some(x => x.m === m) && (level !== "easy" || rng() < 0.5);
    consider(shake ? { card: id, shake: true } : { card: id }, evalPlay(S, p, X, id, shake ? "shake" : "plain"));
  }
  if (S.flips[p] > 0) consider({ flip: true }, hand.length ? 0.2 : 1e6);
  return best;
}
function aiChoose(S, p, level, rng) {
  const X = aiCtx(S, p, level);
  let best = S.ch.options[0], bv = -Infinity;
  for (const id of S.ch.options) {
    const v = X.my(id) + (X.block ? 0.5 * X.opp(id) : 0) + (level === "easy" ? rng() * 1.5 : 0);
    if (v > bv) { bv = v; best = id; }
  }
  return { take: best };
}
function aiGo(S, p, level) {
  if (level === "easy") return { go: false };
  const th = TH(S.n), left = turnsOf(S, p);
  if (left < 2) return { go: false };
  const threat = Math.max(...others(S, p).map(q => scoreOf(S.caps[q]).total + potential(S, q)));
  if (level === "normal") return { go: left >= 3 && S.go[p] < 3 && threat <= th - (S.n === 2 ? 3 : 2) };
  // Hard: weighs opponents' threat, gobak (with 3 players a loser may pay both shares) and the payout now (multipliers).
  // In test games, going boldly with 2+ cards left paid off (Matgo has no gobak).
  const now = settle(S, p).deltas[p];
  const margin = S.n === 3 ? 1 : 2;                                  // 3 players: gobak exists, so respect threats more
  if (now >= th * 12 && left <= 3) return { go: false };             // multipliers already huge → keep it
  if (S.n === 3 && now >= th * 6 && threat >= th - 2) return { go: false };
  return { go: threat <= th - margin };
}

/* ===================== Engine ===================== */
export default {
  id: "gostop",
  name,
  icon: "🎴",
  blurb: tx("화투 짝 맞추기! 2명은 맞고, 3명은 고스톱. 점수가 나면 고? 스톱?",
    "Match hwatu flower cards by month! Matgo for 2, Go-Stop for 3. Once you score: Go on, or Stop?"),
  players: { min: 2, max: 3, default: 3 },
  spectate: true,                  // view(S, -1) is the public view
  settings: [
    { key: "rounds", label: tx("판 수", "Rounds"), values: [5, 10], labels: [tx("5판", "5"), tx("10판", "10")], default: 5,
      note: tx("누적 점수로 순위를 정합니다", "Ranked by total score") },
    { key: "bonus", label: tx("보너스 피", "Bonus pi"), values: [2, 0], labels: [tx("2장", "2 cards"), tx("없음", "None")], default: 2,
      note: tx("보너스 쌍피 1장 + 쓰리피 1장", "One bonus double pi + one bonus triple pi") }
  ],
  rules: tx(`
    <h4>인원과 패</h4>
    <ul>
      <li><b>2명 = 맞고</b>: 손패 10장 · 바닥 8장 · <b>7점</b>부터 날 수 있습니다.</li>
      <li><b>3명 = 고스톱</b>: 손패 7장 · 바닥 6장 · <b>3점</b>부터 날 수 있습니다.</li>
      <li>화투 48장 (설정에 따라 <b>보너스 피</b> 2장: 쌍피 1 · 쓰리피 1). 바닥에 같은 월 4장이 깔리면 다시 나눕니다.</li>
      <li><b>총통</b>: 처음 받은 손패에 같은 월 4장 → 그 판은 바로 승리 (10점).</li>
    </ul>
    <h4>한 차례</h4>
    <ul>
      <li>손패 한 장을 냅니다. 바닥에 같은 월이 1장이면 짝, 2장이면 <b>하나를 골라</b> 짝, 3장이면 4장을 모두 먹습니다. 없으면 바닥에 놓입니다.</li>
      <li>이어서 더미 맨 위 한 장을 뒤집어 같은 방식으로 짝을 맞춥니다.</li>
      <li><b>쪽</b>: 낸 패가 짝이 없었는데 뒤집은 패가 같은 월 → 2장을 먹고 상대마다 피 1장씩 뺏기.</li>
      <li><b>뻑</b>: 낸 패로 1장과 짝을 맞췄는데 뒤집은 패도 같은 월 → 3장 모두 바닥에 남습니다. 나중에 그 월 마지막 패로 4장을 먹으면 피 1장씩 뺏기 (바닥에 처음부터 3장이 깔린 것은 뺏기 없음).</li>
      <li><b>따닥</b>: 바닥 2장에 같은 월을 내고 4번째를 뒤집음 → 4장 + 피 1장씩.</li>
      <li><b>쓸</b>: 내 차례 뒤 바닥이 비면 피 1장씩 (판의 마지막 차례는 제외).</li>
      <li><b>흔들기</b>: 같은 월 3장을 들고 바닥에 그 월이 없을 때, 그중 한 장을 내며 선언 → 이기면 ×2.</li>
      <li><b>폭탄</b>: 같은 월 3장을 들고 바닥에 나머지 1장이 있으면 3장을 한꺼번에 내 4장을 먹고 피 1장씩 뺏기, 이기면 ×2. 손패가 2장 줄어드는 대신 <b>뒤집기만 하는 차례</b>가 2번 생깁니다 (아무 때나 사용).</li>
      <li><b>보너스 피</b>: 손에 있으면 아무 때나 내서 내 피로 가져가고 더미에서 한 장을 받은 뒤, 원래대로 한 장을 냅니다. 뒤집다 나오면 내 것이 되고 한 장 더 뒤집습니다. 처음 바닥에 깔리면 선이 가져갑니다.</li>
      <li>피를 뺏을 때는 보통 피부터, 없으면 쌍피(그다음 쓰리피)를 가져옵니다.</li>
    </ul>
    <h4>점수 (먹은 패로 늘 자동 계산)</h4>
    <ul>
      <li><b>광</b>: 3광 3점 (비광이 끼면 2점) · 4광 4점 · 5광 15점.</li>
      <li><b>띠</b>: 5장 1점, 1장마다 +1. <b>홍단</b>(1·2·3월) · <b>청단</b>(6·9·10월) · <b>초단</b>(4·5·7월) 각 3점. 12월 비띠는 장수에만 듭니다.</li>
      <li><b>열끗</b>: 5장 1점, 1장마다 +1. <b>고도리</b>(2·4·8월 새) 5점.</li>
      <li><b>피</b>: 10장 1점, 1장마다 +1. 쌍피는 2장, 보너스 쓰리피는 3장으로 셉니다.</li>
      <li><b>9월 국진</b>: 열끗 또는 쌍피 — 점수가 더 높아지는 쪽으로 자동 (같으면 열끗). 진 사람의 국진은 피박을 면하는 쪽(쌍피)으로 셉니다.</li>
    </ul>
    <h4>고 · 스톱</h4>
    <ul>
      <li>내 차례가 끝났을 때 점수가 나기 점수 이상이고 마지막으로 고를 부를 때보다 높으면 <b>고</b> 또는 <b>스톱</b>을 고릅니다.</li>
      <li><b>고</b>: 판을 계속합니다. 1고 +1점, 2고 +2점, 3고부터는 (점수 + 고 횟수)에 ×2, 4고 ×4, 5고 ×8…</li>
      <li><b>스톱</b>: 이번 판을 이기고 끝냅니다. 더 낼 패가 없으면 자동으로 스톱됩니다.</li>
      <li>모두 패를 다 낼 때까지 아무도 스톱하지 못하면 <b>나가리</b> — 점수 없이 다음 판은 ×2 (연속이면 계속 곱해집니다).</li>
    </ul>
    <h4>정산 (진 사람마다)</h4>
    <ul>
      <li>낼 점수 = 이긴 사람 점수(고 포함) × 아래 배수들.</li>
      <li><b>흔들기 · 폭탄</b>: 이긴 사람이 한 번 할 때마다 ×2 (진 사람의 흔들기는 셈하지 않음).</li>
      <li><b>피박</b>: 이긴 사람이 피로 점수를 냈고 진 사람 피가 6장 미만 (0장 포함) → ×2.</li>
      <li><b>광박</b>: 이긴 사람이 광으로 점수를 냈고 진 사람 광이 0장 → ×2.</li>
      <li><b>멍박</b>: 이긴 사람 열끗 7장 이상 → ×2.</li>
      <li><b>고박</b> (3명): 고를 불렀다가 진 사람이 두 사람 몫을 혼자 모두 냅니다 (진 두 사람이 모두 고를 불렀으면 각자 냄). 맞고에는 고박이 없습니다.</li>
      <li>나가리 다음 판에는 나가리 배수가 곱해집니다.</li>
    </ul>
    <h4>여러 판</h4>
    <ul>
      <li>정한 판 수(5 · 10판)를 하고 <b>누적 점수</b>로 순위를 정합니다. 첫 판 선은 무작위, 그다음은 이긴 사람이 선 (나가리면 그대로).</li>
    </ul>`, `
    <p>Hwatu has 12 months (suits) of 4 cards each. Every card is a <b>Gwang</b> (광, bright), a <b>Tti</b> (띠, ribbon),
      a <b>Yeolkkeut</b> (열끗, animal) or a <b>Pi</b> (피, junk). The month number is printed in the card's top-left corner.</p>
    <h4>Players and cards</h4>
    <ul>
      <li><b>2 players = Matgo</b> (맞고): 10 cards in hand · 8 on the floor · you can win from <b>7 points</b>.</li>
      <li><b>3 players = Go-Stop</b> (고스톱): 7 cards in hand · 6 on the floor · you can win from <b>3 points</b>.</li>
      <li>48 hwatu cards (plus 2 <b>bonus pi</b> if enabled: one double pi, one triple pi). If all four cards of a month land on the floor, the cards are redealt.</li>
      <li><b>Chongtong</b> (총통): all four cards of one month in your starting hand → you win that round at once (10 points).</li>
    </ul>
    <h4>A turn</h4>
    <ul>
      <li>Play one card from your hand. If the floor has 1 card of the same month you pair it; with 2 you <b>pick one</b> of them;
        with 3 you take all four. Otherwise your card stays on the floor.</li>
      <li>Then flip the top card of the draw pile and pair it the same way.</li>
      <li><b>Jjok</b> (쪽): your played card found no pair, but the flipped card is the same month → take both and steal 1 pi from each opponent.</li>
      <li><b>Ppeok</b> (뻑): you paired your card with 1 floor card, but the flipped card is the same month too → all 3 stay on the floor.
        Whoever later takes all four with the last card of that month steals 1 pi from each opponent
        (no steal for three of a month dealt to the floor at the start).</li>
      <li><b>Ttadak</b> (따닥): you play onto 2 floor cards of a month and flip the fourth → take all 4 + 1 pi from each opponent.</li>
      <li><b>Sseul</b> (쓸) — sweep: the floor is empty after your turn → 1 pi from each opponent (not on the last turn of the round).</li>
      <li><b>Shake</b> (흔들기): holding 3 cards of a month that is not on the floor, show them as you play one → ×2 if you win.</li>
      <li><b>Bomb</b> (폭탄): holding 3 cards of a month whose 4th card is on the floor, play all 3 at once → take all 4, steal 1 pi from each opponent,
        ×2 if you win. Your hand shrinks by 2, so you get 2 <b>flip-only turns</b> (use them any time).</li>
      <li><b>Bonus pi</b>: play it from your hand any time — it joins your pi and you draw a card, then you play a card as usual.
        A bonus pi you flip is yours and you flip again. One dealt to the floor goes to the leader.</li>
      <li>Stolen pi: a plain pi first; if there is none, a double pi (then a triple pi).</li>
    </ul>
    <h4>Scoring (always counted automatically from your captured cards)</h4>
    <ul>
      <li><b>Gwang</b>: 3 gwang 3 points (2 if one is the rain gwang) · 4 gwang 4 · 5 gwang 15.</li>
      <li><b>Tti</b> (ribbons): 5 cards 1 point, +1 for each extra. <b>Hongdan</b> (홍단, red poem ribbons: months 1·2·3) · <b>Cheongdan</b>
        (청단, blue ribbons: 6·9·10) · <b>Chodan</b> (초단, grass ribbons: 4·5·7) 3 points each. The December rain ribbon only counts toward the number of ribbons.</li>
      <li><b>Yeolkkeut</b> (animals): 5 cards 1 point, +1 for each extra. <b>Godori</b> (고도리, the birds of months 2·4·8) 5 points.</li>
      <li><b>Pi</b> (junk): 10 cards 1 point, +1 for each extra. A <b>Ssangpi</b> (쌍피, double junk) counts as 2, the bonus triple pi as 3.</li>
      <li><b>Gukjin</b> (국진, the September animal): counts as an animal or a double pi — whichever scores more, automatically (animal on a tie).
        A loser's gukjin counts as double pi, to help avoid pibak.</li>
    </ul>
    <h4>Go or Stop</h4>
    <ul>
      <li>When your turn ends with a score at or above the threshold, and higher than at your last Go, choose <b>Go</b> (고) or <b>Stop</b> (스톱).</li>
      <li><b>Go</b>: the round goes on. 1 Go +1 point, 2 Go +2; from 3 Go, (score + number of Gos) ×2, 4 Go ×4, 5 Go ×8…</li>
      <li><b>Stop</b>: you win the round and it ends. If you have no cards left to play, you stop automatically.</li>
      <li>If nobody stops before all cards are played: <b>Nagari</b> (나가리) — no winner, no points, and the next round counts ×2
        (consecutive nagari keep multiplying).</li>
    </ul>
    <h4>Settlement (each loser)</h4>
    <ul>
      <li>Payment = the winner's score (Go included) × the multipliers below.</li>
      <li><b>Shake · Bomb</b>: ×2 for each one the winner made (a loser's shakes don't count).</li>
      <li><b>Pibak</b> (피박): the winner scored with pi and the loser has fewer than 6 pi (0 included) → ×2.</li>
      <li><b>Gwangbak</b> (광박): the winner scored with gwang and the loser has no gwang → ×2.</li>
      <li><b>Meongbak</b> (멍박): the winner has 7 or more animals → ×2.</li>
      <li><b>Gobak</b> (고박, 3 players): a loser who had called Go pays both losers' shares alone
        (if both losers called Go, each pays their own). Matgo has no gobak.</li>
      <li>After a nagari, the nagari multiplier applies too.</li>
    </ul>
    <h4>Several rounds</h4>
    <ul>
      <li>Play the chosen number of rounds (5 or 10); players are ranked by <b>total score</b>. The first leader is random;
        after that the winner leads (unchanged after a nagari).</li>
    </ul>`),

  setup({ n, seed, settings = {} }) {
    const S = {
      n, rs: seed >>> 0,
      bonus: settings.bonus === 0 ? 0 : 2,
      rounds: [5, 10].includes(settings.rounds) ? settings.rounds : 5,
      round: 1, totals: zeros(n), wins: zeros(n), nagari: 1, leader: 0
    };
    S.leader = randInt(S, n);
    deal(S);
    return S;
  },

  pending(S) {
    if (S.phase === "play" || S.phase === "choose" || S.phase === "gostop") return [{ p: S.turn, kind: S.phase }];
    return [];
  },

  validate(S, p, a) {
    if (!this.pending(S).some(x => x.p === p)) return tx("지금은 내 차례가 아닙니다", "It's not your turn");
    if (!a || typeof a !== "object") return tx("행동을 고르세요", "Choose an action");
    if (S.phase === "gostop") return typeof a.go === "boolean" ? true : tx("고 또는 스톱을 고르세요", "Choose Go or Stop");
    if (S.phase === "choose") return S.ch && S.ch.options.includes(a.take) ? true : tx("가져갈 바닥 카드를 고르세요", "Pick the floor card to take");
    const hand = S.hands[p];
    if (a.flip) return S.flips[p] > 0 ? true : tx("뒤집기만 하는 차례가 없습니다", "You have no flip-only turns");
    if (a.bonus !== undefined) return isBonus(a.bonus) && hand.includes(a.bonus) ? true : tx("그 보너스 피가 손에 없습니다", "That bonus pi is not in your hand");
    if (!isCard(a.card) || !hand.includes(a.card)) return tx("손에 없는 카드입니다", "That card is not in your hand");
    if (isBonus(a.card)) return tx("보너스 피는 따로 냅니다", "Bonus pi is played separately");
    const m = monthOf(a.card), k = ofMonth(hand, m).length, f = ofMonth(S.floor, m).length;
    if (a.bomb && a.shake) return tx("폭탄과 흔들기는 함께 할 수 없습니다", "You can't bomb and shake at once");
    if (a.bomb && !(k >= 3 && f === 1)) return tx("폭탄은 같은 월 3장을 들고 바닥에 나머지 1장이 있을 때만 됩니다",
      "A bomb needs 3 cards of a month in hand and its 4th card on the floor");
    if (a.shake && !(k >= 3 && f === 0)) return tx("흔들기는 같은 월 3장을 들고 바닥에 그 월이 없을 때만 됩니다",
      "A shake needs 3 cards of a month in hand and none of that month on the floor");
    if (a.shake && S.shook[p].some(x => x.m === m)) return tx("이미 흔든 월입니다", "You already shook that month");
    return true;
  },

  apply(S, p, a) {
    if (S.phase === "gostop") {
      if (a.go) {
        S.go[p]++;
        S.goScore[p] = scoreOf(S.caps[p]).total;
        const ev = [{ type: "go", p, go: S.go[p], toast: true, text: tx(`{${p}} 님 ${S.go[p]}고!`, `{${p}}: ${S.go[p]} Go!`) }];
        nextTurn(S, p);
        return ev;
      }
      return endRound(S, p, "stop");
    }
    if (S.phase === "choose") {
      const ch = S.ch, tp = S.tp, ev = [];
      S.ch = null; S.phase = "play";
      if (ch.stage === "play") { tp.target = a.take; flipStage(S, ev); }
      else { capture(S, tp, [tp.d, a.take]); finishTurn(S, ev); }
      return ev;
    }
    // Interpret in the same order as validate (flip → bonus → card)
    if (a.flip) return playTurn(S, p, { flip: true });
    if (a.bonus !== undefined) return playBonus(S, p, a.bonus);
    return playTurn(S, p, { card: a.card, bomb: !!a.bomb, shake: !!a.shake });
  },

  step(S) {
    if (S.phase !== "roundEnd") return [];
    if (S.round >= S.rounds) { S.phase = "over"; return [{ type: "over", text: tx("모든 판이 끝났습니다", "All rounds are finished") }]; }
    S.round++;
    return deal(S);
  },

  delay(S) { return S.phase === "roundEnd" ? (S.result && S.result.kind === "nagari" ? 4000 : 5500) : 1200; },

  /* The card drawn after playing a bonus pi from the hand is known only to its owner (spectators, p = -1, never see it) */
  filterEvent(ev, p) {
    if (ev.type === "bonus" && ev.drew && p !== ev.p) return { ...ev, drew: null };
    return ev;
  },

  timeout(S, p) {
    if (S.phase === "choose") return aiChoose(S, p, "normal", () => 0.5);
    if (S.phase === "gostop") return { go: false };
    return aiPlay(S, p, "normal", () => 0.5);
  },
  ai(S, p, { level = "normal", rng = Math.random } = {}) {
    if (S.phase === "choose") return aiChoose(S, p, level, rng);
    if (S.phase === "gostop") return aiGo(S, p, level);
    return aiPlay(S, p, level, rng);
  },
  thinkTime(S, p, kind) {
    if (kind === "choose") return 450 + Math.random() * 300;
    if (kind === "gostop") return 900 + Math.random() * 600;
    return 800 + Math.random() * 600;
  },

  /* p = -1: the public view for spectators, watching screens and replays (no hand, no private preview) */
  view(S, p) {
    const me = Number.isInteger(p) && p >= 0 && p < S.n ? p : -1;
    const scores = S.caps.map(c => {
      const s = scoreOf(c);
      return { total: s.total, gp: s.gp, tp: s.tp, yp: s.yp, pp: s.pp, g: s.g, t: s.t, y: s.y, pi: s.pi, items: s.items, guk: s.guk, sets: s.sets };
    });
    let status = "";
    if (S.phase === "over") status = tx("게임 끝", "Game over");
    else if (S.phase === "roundEnd") {
      const r = S.result, k = S.round;
      status = r && r.kind === "nagari" ? tx(`${k}판 나가리 — 다음 판 ×${S.nagari}`, `Nagari! Next round ×${S.nagari}`)
        : r && r.kind === "chongtong" ? tx(`${k}판 총통!`, `Round ${k}: chongtong!`)
        : tx(`${k}판 끝 — 곧 다음 판`, `Round ${k} over, next soon`);
    } else if (S.turn === me) {
      status = S.phase === "choose" ? tx("가져갈 카드를 고르세요", "Pick a card to take") : S.phase === "gostop" ? tx("고? 스톱?", "Go or Stop?")
        : S.hands[me].length ? tx("내 차례 — 낼 카드를 고르세요", "Your turn — play a card") : tx("내 차례 — 패를 뒤집으세요", "Your turn — flip a card");
    } else if (S.phase === "choose") status = tx(`{${S.turn}} 님이 가져갈 카드를 고르는 중`, `{${S.turn}} is picking a card to take`);
    else if (S.phase === "gostop") status = tx(`{${S.turn}} 님 고? 스톱?`, `{${S.turn}}: Go or Stop?`);
    const copy = x => (x ? JSON.parse(JSON.stringify(x)) : null);
    return {
      phase: S.phase, round: S.round, rounds: S.rounds, n: S.n, th: TH(S.n), turn: S.turn, leader: S.leader,
      deck: S.deck.length, floor: sortCards(S.floor), ppeok: Object.keys(S.ppeok).map(Number),
      caps: S.caps.map(sortCards), scores, sizes: S.hands.map(h => h.length), flips: S.flips.slice(),
      go: S.go.slice(), goScore: S.goScore.slice(), shook: S.shook.map(a => a.map(x => ({ m: x.m, bomb: x.bomb }))),
      totals: S.totals.slice(), wins: S.wins.slice(), nagari: S.nagari,
      ch: S.phase === "choose" && S.ch ? { stage: S.ch.stage, m: S.ch.m, options: S.ch.options.slice() } : null,
      cur: S.tp ? { p: S.tp.p, played: S.tp.played.slice(), flipped: S.tp.flipped.slice() } : null,
      last: copy(S.last), lastBy: S.lastBy ? copy(S.lastBy) : null, result: copy(S.result),
      hand: me >= 0 ? sortCards(S.hands[me]) : [],
      can: me >= 0 ? specials(S, me) : null,
      preview: me >= 0 && S.phase === "gostop" && S.turn === me ? settle(S, me) : null,
      status
    };
  },

  over(S) { return S.phase === "over"; },
  results(S) {
    return S.totals.map((t, p) => ({
      p, rank: 1 + S.totals.filter(x => x > t).length, score: t,
      note: tx(`${t > 0 ? "+" : ""}${t}점 · ${S.wins[p]}승`, `${t > 0 ? "+" : ""}${plural(t, "pt", "pts")} · ${plural(S.wins[p], "win", "wins")}`)
    })).sort((a, b) => a.rank - b.rank);
  },

  /* ---------- For tests ---------- */
  randomAction(S, p, rng) {
    if (S.phase === "choose") return { take: pick(rng, S.ch.options) };
    if (S.phase === "gostop") return { go: rng() < 0.5 };
    const hand = S.hands[p], acts = [];
    for (const id of hand) {
      if (isBonus(id)) { acts.push({ bonus: id }); continue; }
      const m = monthOf(id), k = ofMonth(hand, m).length, f = ofMonth(S.floor, m).length;
      acts.push({ card: id });
      if (k >= 3 && f === 1) acts.push({ card: id, bomb: true });
      if (k >= 3 && f === 0 && !S.shook[p].some(x => x.m === m)) acts.push({ card: id, shake: true });
    }
    if (S.flips[p] > 0) acts.push({ flip: true });
    return pick(rng, acts);
  },
  check(S) {
    const all = [...S.hands.flat(), ...S.floor, ...S.deck, ...S.caps.flat()];
    const want = 48 + (S.bonus ? 2 : 0);
    if (all.length !== want) return `card count mismatch ${all.length} ≠ ${want}`;
    const seen = new Set();
    for (const id of all) {
      if (!isCard(id)) return `unknown card ${id}`;
      if (seen.has(id)) return `duplicate card ${id}`;
      seen.add(id);
    }
    if (!S.bonus && (seen.has("B2") || seen.has("B3"))) return "bonus pi present although bonus is off";
    if (S.totals.reduce((a, b) => a + b, 0) !== 0) return "running totals do not sum to 0";
    if (S.floor.some(isBonus)) return "bonus pi on the floor";
    if (S.phase === "choose") {
      if (!S.tp || !S.ch || S.ch.options.length !== 2 || !S.ch.options.every(c => S.floor.includes(c))) return "bad choice state";
      return true;
    }
    if (S.tp) return "turn finished but turn-in-progress data remains";
    for (let m = 1; m <= 12; m++) if (ofMonth(S.floor, m).length > 3) return `four cards of month ${m} on the floor`;
    for (const k of Object.keys(S.ppeok)) if (ofMonth(S.floor, +k).length !== 3) return `ppeok marker mismatch (month ${k})`;
    // Plain cards in the pile = turns left (a bonus in hand uses one extra card as its replacement) → the pile never runs short
    const dn = S.deck.filter(c => !isBonus(c)).length;
    let need = 0;
    for (let p = 0; p < S.n; p++) need += S.hands[p].length + S.hands[p].filter(isBonus).length + S.flips[p];
    if (dn !== need) return `draw pile mismatch (plain ${dn}, needed ${need})`;
    if ((S.phase === "play" || S.phase === "gostop") && turnsOf(S, S.turn) <= 0) return "player to move has no cards to play";
    if (S.phase === "over" && S.round !== S.rounds) return "round count mismatch";
    return true;
  },
  leak(S, p, v) {
    const hidden = new Set(S.deck);
    S.hands.forEach((h, q) => { if (q !== p) for (const id of h) hidden.add(id); });
    for (const id of S.shown || []) hidden.delete(id);
    let bad = null;
    const walk = x => {
      if (bad) return;
      if (typeof x === "string") { if (hidden.has(x)) bad = x; }
      else if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") Object.values(x).forEach(walk);
    };
    walk(v);
    if (bad) return `hidden card ${bad} is visible`;
    if (p < 0) {
      if (v.hand.length || v.can || v.preview) return "spectator view has private parts";
    } else if (JSON.stringify(sortCards(S.hands[p])) !== JSON.stringify(v.hand)) return "own hand mismatch";
    if (typeof v.deck !== "number") return "deck is not a number";
    return true;
  },
  stepLimit: 20000
};
