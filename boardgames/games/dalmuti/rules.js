/* Dalmuti rules engine (ES module) — a verbatim port of C:\Users\user\dalmuti\web\engine.js.
   Rules, randomness and action ids must match the original line for line (games/dalmuti/test_port.mjs compares them).
   If the original changes, change this file too. Pure rules — no screen, sound or DOM.

   One addition that the original doesn't have: the "pass lock" house rule (opt.passLock, off by default — the original rules
   are untouched when it is off): a player who passes can't play again until the trick ends.
   Cards are tracked as counts per number, not as objects: hands[p][r] = how many r cards player p holds.
   r = 1..12 are normal cards, r = 13 is the Jester (wild). Index 0 is unused. */

export const JESTER = 13;
export const TOTAL = r => r === JESTER ? 2 : r;
/* Title codes: 0 commoner (first round) · 1 Greater Dalmuti · 2 Lesser Dalmuti · 3 Merchant · 4 Lesser Peon · 5 Greater Peon */
export const T = { NONE: 0, GD: 1, LD: 2, MER: 3, LP: 4, GP: 5 };

/* ---------- Action list (fixed, 237 entries) ----------
   0 = pass. Then (number r, k cards of that number, j Jesters) in r → k → j order, and finally Jesters alone (1 or 2). */
export const ACTIONS = [{ id: 0, pass: true, rank: 0, plain: 0, jesters: 0, count: 0 }];
for (let r = 1; r <= 12; r++)
  for (let k = 1; k <= r; k++)
    for (let j = 0; j <= 2; j++)
      ACTIONS.push({ id: ACTIONS.length, pass: false, rank: r, plain: k, jesters: j, count: k + j });
for (let j = 1; j <= 2; j++)
  ACTIONS.push({ id: ACTIONS.length, pass: false, rank: JESTER, plain: 0, jesters: j, count: j });
const ACTION_INDEX = new Map();
ACTIONS.forEach(a => ACTION_INDEX.set(a.rank * 100 + a.plain * 3 + a.jesters, a.id));
export function actionId(r, k, j) {
  const id = ACTION_INDEX.get(r * 100 + k * 3 + j);
  if (id === undefined) throw new Error(`no such action: ${r}/${k}/${j}`);
  return id;
}

/* ---------- Randomness (mulberry32) — the state lives in G.rs, so games can be saved and replayed ----------
   As in the original, G.rs is kept as a signed 32-bit int (| 0) (same sequence as core/rng.js, different storage form) */
export function rand(G) {
  G.rs = (G.rs + 0x6D2B79F5) | 0;
  let t = Math.imul(G.rs ^ (G.rs >>> 15), 1 | G.rs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function shuffle(G, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(G) * (i + 1));
    const x = a[i]; a[i] = a[j]; a[j] = x;
  }
  return a;
}
export function newDeck() {
  const d = [];
  for (let r = 1; r <= 12; r++) for (let i = 0; i < r; i++) d.push(r);
  d.push(JESTER, JESTER);
  return d;
}
const zeros = n => new Array(n).fill(0);

export function titleCode(i, n) {
  if (i === 0) return T.GD;
  if (i === 1) return T.LD;
  if (i === n - 1) return T.GP;
  if (n > 3 && i === n - 2) return T.LP;
  return T.MER;
}

/* ---------- Game creation ---------- */
export function create(opt) {
  const n = opt.n;
  return {
    v: 1, n, rounds: opt.rounds, round: 1, rs: opt.seed | 0,
    ...(opt.passLock ? { passLock: true } : {}),   // house rule: once you pass, you sit out the rest of the trick (absent = original)
    seats: [...Array(n).keys()],          // seating order = turn order
    titles: zeros(n), scores: zeros(n),
    hands: [...Array(n)].map(() => zeros(14)),
    played: zeros(14),
    trick: null,                          // {rank, count, plain, jesters, by}
    turn: 0,                              // index into seats
    passStreak: 0,
    passed: new Array(n).fill(false),
    finish: [],
    phase: "draw",                        // draw → deal → (revolution → tax) → play → roundEnd → … → over
    reveal: null,                         // {p, great} the player whose two Jesters a revolution revealed
    firstLeader: null,
    lastAct: new Array(n).fill(null)      // each player's last action in the current trick (for display)
  };
}

export const handSize = (G, p) => { let s = 0; for (let r = 1; r <= 13; r++) s += G.hands[p][r]; return s; };
export const current = G => G.seats[G.turn];
export const seatOf = (G, p) => G.seats.indexOf(p);
export function nextWithCards(G, fromSeat) {
  for (let step = 1; step <= G.n; step++) {
    const s = (fromSeat + step) % G.n;
    if (handSize(G, G.seats[s]) > 0) return s;
  }
  return -1;
}
/* Pass lock: the next seat that still holds cards and hasn't passed in this trick */
function nextActive(G, fromSeat) {
  for (let step = 1; step <= G.n; step++) {
    const s = (fromSeat + step) % G.n, q = G.seats[s];
    if (handSize(G, q) > 0 && !G.passed[q]) return s;
  }
  return -1;
}

/* ---------- Seat draw: everyone draws one card, lowest number sits first (the Jester, 13, is the weakest) ---------- */
export function seatingDraw(G) {
  const deck = shuffle(G, newDeck());
  const draws = [];
  for (let p = 0; p < G.n; p++) draws.push({ p, rank: deck[p], tie: rand(G) });
  const order = draws.slice().sort((a, b) => a.rank - b.rank || a.tie - b.tie).map(d => d.p);
  G.seats = order;
  G.firstLeader = order[0];
  G.phase = "deal";
  return { draws: draws.map(d => ({ p: d.p, rank: d.rank })), order };
}

/* ---------- Deal ---------- */
function resetTrick(G) {
  G.trick = null;
  G.passStreak = 0;
  G.passed.fill(false);
  G.lastAct.fill(null);
}
export function deal(G) {
  for (let p = 0; p < G.n; p++) G.hands[p] = zeros(14);
  G.played = zeros(14);
  G.finish = [];
  G.reveal = null;
  resetTrick(G);
  if (G.round > 1) G.seats.forEach((p, i) => { G.titles[p] = titleCode(i, G.n); });
  else G.titles.fill(T.NONE);
  const deck = shuffle(G, newDeck());
  deck.forEach((r, i) => { G.hands[G.seats[i % G.n]][r]++; });
  if (G.round > 1) G.phase = "revolution";
  else toPlay(G);
}
export function toPlay(G) {
  G.phase = "play";
  const leader = G.round === 1 ? G.firstLeader : G.seats[0];
  G.turn = seatOf(G, leader);
  resetTrick(G);
}

/* ---------- Revolution ---------- */
export function revolutionCandidate(G) {
  for (let p = 0; p < G.n; p++) if (G.hands[p][JESTER] === 2) return p;
  return -1;
}
export function declareRevolution(G, p) {
  const great = G.titles[p] === T.GP;
  G.reveal = { p, great };
  if (great) {
    G.seats.reverse();
    G.seats.forEach((q, i) => { G.titles[q] = titleCode(i, G.n); });
  }
  toPlay(G);
  return { great };
}
export function skipRevolution(G) { G.phase = "tax"; }

/* ---------- Tax ---------- */
export function taxPairs(G) {
  const by = t => G.seats.find(p => G.titles[p] === t);
  const out = [];
  const gp = by(T.GP), gd = by(T.GD), lp = by(T.LP), ld = by(T.LD);
  if (gp !== undefined && gd !== undefined && gp !== gd) out.push({ peon: gp, lord: gd, k: 2 });
  if (lp !== undefined && ld !== undefined && lp !== ld) out.push({ peon: lp, lord: ld, k: 1 });
  return out;
}
/* Peons pay their lowest numbers first — the Jester counts as 13, so it is practically never paid */
export function tribute(G, peon, k) {
  const out = [];
  for (let r = 1; r <= 13 && out.length < k; r++)
    for (let c = G.hands[peon][r]; c > 0 && out.length < k; c--) out.push(r);
  return out;
}
/* Default Dalmuti give-back: weakest normal cards first, Jesters are kept until last */
export function giveBackDefault(G, lord, k) {
  const out = [];
  for (let r = 12; r >= 1 && out.length < k; r--)
    for (let c = G.hands[lord][r]; c > 0 && out.length < k; c--) out.push(r);
  for (let c = G.hands[lord][JESTER]; c > 0 && out.length < k; c--) out.push(JESTER);
  return out;
}
export function transfer(G, from, to, ranks) {
  const need = zeros(14);
  ranks.forEach(r => need[r]++);
  for (let r = 1; r <= 13; r++) if (need[r] > G.hands[from][r]) throw new Error("cannot transfer more cards than held");
  ranks.forEach(r => { G.hands[from][r]--; G.hands[to][r]++; });
}
export function finishTax(G) { toPlay(G); }

/* ---------- Legal moves ---------- */
export function legal(G) {
  const p = current(G), h = G.hands[p], J = h[JESTER], out = [];
  if (!G.trick) {
    for (let r = 1; r <= 12; r++)
      for (let k = 1; k <= h[r]; k++)
        for (let j = 0; j <= J; j++) out.push(actionId(r, k, j));
    for (let j = 1; j <= J; j++) out.push(actionId(JESTER, 0, j));
    return out;
  }
  out.push(0);
  const t = G.trick;
  for (let r = 1; r < t.rank && r <= 12; r++)
    for (let k = 1; k <= h[r] && k <= t.count; k++) {
      const j = t.count - k;
      if (j <= J) out.push(actionId(r, k, j));
    }
  return out;
}
export function isLegal(G, id) {
  const a = ACTIONS[id], h = G.hands[current(G)];
  if (!a) return false;
  if (a.pass) return !!G.trick;
  if (a.rank !== JESTER && h[a.rank] < a.plain) return false;
  if (h[JESTER] < a.jesters) return false;
  if (!G.trick) return true;
  return a.rank !== JESTER && a.count === G.trick.count && a.rank < G.trick.rank;
}

/* ---------- Making a move ---------- */
export function act(G, id) {
  if (G.phase !== "play") throw new Error("not in the play phase");
  if (!isLegal(G, id)) throw new Error("illegal move: " + id);
  const p = current(G), a = ACTIONS[id];
  const ev = { player: p, id, type: a.pass ? "pass" : "play" };

  if (a.pass) {
    G.passStreak++;
    G.passed[p] = true;
    G.lastAct[p] = { pass: true };
  } else {
    if (a.rank !== JESTER) { G.hands[p][a.rank] -= a.plain; G.played[a.rank] += a.plain; }
    G.hands[p][JESTER] -= a.jesters;
    G.played[JESTER] += a.jesters;
    G.trick = { rank: a.rank, count: a.count, plain: a.plain, jesters: a.jesters, by: p };
    G.passStreak = 0;
    if (!G.passLock) G.passed.fill(false);   // pass lock: whoever passed stays out until the trick ends
    G.lastAct[p] = { rank: a.rank, count: a.count, jesters: a.jesters };
    if (handSize(G, p) === 0) {
      G.finish.push(p);
      ev.finished = G.finish.length;
    }
  }

  const holders = G.seats.filter(q => handSize(G, q) > 0);
  if (holders.length <= 1) {
    if (holders.length === 1) { G.finish.push(holders[0]); ev.last = holders[0]; }
    G.phase = "roundEnd";
    ev.roundEnd = true;
    return ev;
  }
  if (G.trick) {
    const owner = G.trick.by, ownerHas = handSize(G, owner) > 0;
    // Official rule: the trick ends when everyone except the last player to play has passed in a row.
    // Pass lock: when everyone still holding cards, except the last player to play, has passed at some point in the trick.
    const ends = G.passLock ? holders.every(q => q === owner || G.passed[q])
                            : G.passStreak >= holders.length - (ownerHas ? 1 : 0);
    if (ends) {
      const ws = seatOf(G, owner);
      G.turn = ownerHas ? ws : nextWithCards(G, ws);
      ev.trickEnd = { winner: owner, leader: G.seats[G.turn] };
      resetTrick(G);
      return ev;
    }
  }
  G.turn = G.passLock && G.trick ? nextActive(G, G.turn) : nextWithCards(G, G.turn);
  return ev;
}

/* ---------- Round scoring ---------- */
export function endRound(G) {
  const points = G.finish.map((p, i) => G.n - i);
  G.finish.forEach((p, i) => { G.scores[p] += G.n - i; });
  const summary = { round: G.round, finish: G.finish.slice(), points };
  G.seats = G.finish.slice();
  G.seats.forEach((p, i) => { G.titles[p] = titleCode(i, G.n); });
  G.round++;
  G.phase = G.round > G.rounds ? "over" : "deal";
  return summary;
}

/* ---------- Encoding for the learned AI (must match the original and python/dalmuti/engine.py) ---------- */
export const OBS = 104, ACT = 21;
export function encodeObs(G, p) {
  const f = new Array(OBS).fill(0), h = G.hands[p], n = G.n;
  let o = 0;
  for (let r = 1; r <= 13; r++) f[o++] = h[r] / TOTAL(r);
  for (let r = 1; r <= 13; r++) f[o++] = G.played[r] / TOTAL(r);
  for (let r = 1; r <= 13; r++) f[o++] = (TOTAL(r) - G.played[r] - h[r]) / TOTAL(r);
  f[o + (G.trick ? G.trick.rank : 0)] = 1; o += 14;
  f[o++] = G.trick ? G.trick.count / 10 : 0;
  const me = seatOf(G, p);
  if (G.trick) f[o + (seatOf(G, G.trick.by) - me + n) % n] = 1;
  o += 8;
  for (let rel = 1; rel <= 7; rel++) {
    if (rel < n) {
      const q = G.seats[(me + rel) % n], s = handSize(G, q);
      f[o] = s / 20; f[o + 1] = s === 0 ? 1 : 0; f[o + 2] = G.passed[q] ? 1 : 0;
    }
    o += 3;
  }
  f[o + (n - 4)] = 1; o += 5;
  f[o + G.titles[p]] = 1; o += 6;
  if (G.reveal) f[o + (seatOf(G, G.reveal.p) - me + n) % n] = 1;
  o += 8;
  f[o++] = G.passStreak / 8;
  f[o++] = handSize(G, p) / 20;
  return f;
}
export function encodeAct(G, p, id) {
  const a = ACTIONS[id], f = new Array(ACT).fill(0), h = G.hands[p];
  if (a.pass) { f[0] = 1; return f; }
  f[a.rank] = 1;
  f[14] = a.count / 10;
  f[15] = a.plain / 12;
  f[16] = a.jesters / 2;
  const after = handSize(G, p) - a.count;
  f[17] = after / 20;
  f[18] = after === 0 ? 1 : 0;
  f[19] = a.rank === JESTER ? 0 : (h[a.rank] - a.plain) / 12;
  f[20] = G.trick ? 0 : 1;
  return f;
}

export const clone = G => JSON.parse(JSON.stringify(G));

const api = {
  JESTER, TOTAL, T, ACTIONS, OBS, ACT,
  actionId, rand, shuffle, newDeck, titleCode,
  create, clone, handSize, current, seatOf, nextWithCards,
  seatingDraw, deal, toPlay,
  revolutionCandidate, declareRevolution, skipRevolution,
  taxPairs, tribute, giveBackDefault, transfer, finishTax,
  legal, isLegal, act, endRound,
  encodeObs, encodeAct
};
export default api;
