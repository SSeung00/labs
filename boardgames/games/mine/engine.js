/* Gold Mine — miners and secret traitors dig tunnels together.
   Connect the entrance with path cards to the gold among the three goals on the right (1 gold, 2 coal); traitors block it unseen.
   Board coordinates: entrance (0,0), goals (8,-2) (8,0) (8,2). x grows to the right (east), y grows downwards (south).
   Path shapes are side bits: N 1 · E 2 · S 4 · W 8. c (centre) false = dead end — tunnels can't pass through. */
import { shuffle, shuffleWith, pick } from "../../core/rng.js";
import { tx } from "../../core/i18n.js";

const name = tx("금광 탐험", "Gold Mine");

/* ---------- Directions · board size ---------- */
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];          // N E S W
const opp = d => (d + 2) & 3;
const rot180 = m => ((m << 2) | (m >> 2)) & 15;        // rotate 180°: N↔S, E↔W
const X0 = -4, X1 = 12, Y0 = -5, Y1 = 5;               // area where cards may be placed
const GW = X1 - X0 + 1, GH = Y1 - Y0 + 1, NC = GW * GH;
const inB = (x, y) => x >= X0 && x <= X1 && y >= Y0 && y <= Y1;
const idx = (x, y) => (y - Y0) * GW + (x - X0);
const ix = i => i % GW + X0, iy = i => Math.floor(i / GW) + Y0;
const key = (x, y) => x + "," + y;
const NB = new Int16Array(NC * 4);                      // neighbour cell index (-1 = off the board)
for (let i = 0; i < NC; i++) for (let d = 0; d < 4; d++) {
  const x = ix(i) + DX[d], y = iy(i) + DY[d];
  NB[i * 4 + d] = inB(x, y) ? idx(x, y) : -1;
}
const START = idx(0, 0);
const GOAL_POS = [[8, -2], [8, 0], [8, 2]];
const GOAL_I = GOAL_POS.map(([x, y]) => idx(x, y));
// Goals are called by number, not position: depending on the screen the board is shown horizontally (#1 on top)
// or vertically (#1 on the left).
export const GOAL_NAME = [tx("1번", "#1"), tx("2번", "#2"), tx("3번", "#3")];
const FAR = 20;                                         // distance when no path can reach

/* ---------- Cards (71) ---------- */
const TOOLS = ["pick", "lamp", "cart"];
export const TOOL_ICON = { pick: "⛏", lamp: "🔦", cart: "🛒" };
export const TOOL_NAME = { pick: tx("곡괭이", "pickaxe"), lamp: tx("등불", "lantern"), cart: tx("수레", "cart") };
export const ROLE_NAME = { m: tx("광부", "Miner"), s: tx("방해꾼", "Traitor") };
/* Korean particle by final consonant: josa("등불", "을", "를") → "등불을" */
export const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return w + (c >= 0 && c < 11172 && c % 28 ? a : b); };
export const CARDS = (() => {
  const C = [];
  // [sides, centre connected, count] — 44 path cards (35 connected + 9 dead ends)
  const PATHS = [
    [15, 1, 5],   // cross
    [7, 1, 5],    // ├ (N·E·S)
    [14, 1, 5],   // ┬ (E·S·W)
    [5, 1, 5],    // vertical straight
    [10, 1, 5],   // horizontal straight
    [6, 1, 5],    // ┌ (E·S)
    [12, 1, 5],   // ┐ (S·W)
    [4, 0, 1], [2, 0, 1], [5, 0, 1], [10, 0, 1], [15, 0, 1], [7, 0, 1], [14, 0, 1], [6, 0, 1], [12, 0, 1]   // dead ends
  ];
  for (const [e, c, k] of PATHS) for (let i = 0; i < k; i++) C.push({ t: "path", e, c: !!c });
  for (const tool of TOOLS) for (let i = 0; i < 3; i++) C.push({ t: "break", tool });       // broken tool 9
  for (const tool of TOOLS) for (let i = 0; i < 2; i++) C.push({ t: "fix", tools: [tool] }); // repair 6
  for (const pair of [["pick", "lamp"], ["pick", "cart"], ["lamp", "cart"]]) C.push({ t: "fix", tools: pair }); // repair one of two 3
  for (let i = 0; i < 6; i++) C.push({ t: "map" });                                         // map 6
  for (let i = 0; i < 3; i++) C.push({ t: "rock" });                                        // rockfall 3
  return C;
})();
const NCARDS = CARDS.length;                           // 71

/* Bilingual card name (C: a CARDS entry or a hand card) */
export function cardNameTx(C) {
  if (C.t === "path") return C.c ? tx("길 카드", "Path card") : tx("막다른 길 카드", "Dead-end card");
  if (C.t === "break") return tx(`${TOOL_NAME[C.tool].ko} 고장 카드`, `Broken ${TOOL_NAME[C.tool].en} card`);
  if (C.t === "fix") return tx(C.tools.map(t => TOOL_NAME[t].ko).join("·") + " 수리 카드", `Repair ${C.tools.map(t => TOOL_NAME[t].en).join("/")} card`);
  return C.t === "map" ? tx("지도 카드", "Map card") : tx("낙석 카드", "Rockfall card");
}

/* Role cards: [traitors, miners] — 1–2 more than the players; the leftover cards stay unknown to everyone.
   With the original table (3p 1·3, 4p 1·4, 6p 2·5, 9p 3·7) miners won 80–95% of AI games — once a lone traitor is
   spotted by three miners their tools keep getting broken and they can do nothing (making traitors hide more didn't help).
   So 3 · 4 · 6 · 9 players get one extra traitor card, raising the expected number of traitors
   → miners win 50–67% with normal AI for every player count 3–10. */
const ROLE_SET = { 3: [2, 3], 4: [2, 4], 5: [2, 4], 6: [3, 5], 7: [3, 5], 8: [3, 6], 9: [4, 7], 10: [4, 7] };
const handSize = n => (n <= 5 ? 6 : n <= 7 ? 5 : 4);

/* ---------- Board maths (on numeric grids, for speed) ----------
   k: 0 empty · 1 entrance · 2 path · 3 hidden goal · 4 revealed goal */
function grid(board) {
  const G = { k: new Int8Array(NC), e: new Int8Array(NC), c: new Int8Array(NC) };
  for (const kk in board) {
    const cell = board[kk], cm = kk.indexOf(","), i = idx(+kk.slice(0, cm), +kk.slice(cm + 1));
    if (cell.k === "s") { G.k[i] = 1; G.e[i] = 15; G.c[i] = 1; }
    else if (cell.k === "p") { G.k[i] = 2; G.e[i] = cell.e; G.c[i] = cell.c ? 1 : 0; }
    else if (cell.rev) { G.k[i] = 4; G.e[i] = cell.e; G.c[i] = 1; }
    else G.k[i] = 3;
  }
  return G;
}
const passable = (G, j) => { const k = G.k[j]; return k === 1 || k === 4 || (k === 2 && G.c[j] === 1); };

/* Cells reachable from the entrance through unbroken tunnels (dead ends and hidden goals can't be passed) */
function reach(G) {
  const R = new Uint8Array(NC), q = [START];
  R[START] = 1;
  while (q.length) {
    const i = q.pop();
    for (let d = 0; d < 4; d++) {
      if (!(G.e[i] >> d & 1)) continue;
      const j = NB[i * 4 + d];
      if (j < 0 || R[j] || !passable(G, j) || !(G.e[j] >> opp(d) & 1)) continue;
      R[j] = 1; q.push(j);
    }
  }
  return R;
}

/* Can a path card (sides e) go on cell i? → null if yes, otherwise the reason */
const ERR_TAKEN = tx("이미 카드가 있는 자리입니다", "There is already a card there");
const ERR_FIT = tx("옆 카드와 굴이 맞지 않습니다", "The tunnels don't match the neighbouring card");
const ERR_LINK = tx("입구와 이어진 굴 끝에만 놓을 수 있습니다", "Cards can only go at a tunnel end connected to the entrance");
function placeErr(G, R, i, e) {
  if (G.k[i]) return ERR_TAKEN;
  let link = false;
  for (let d = 0; d < 4; d++) {
    const j = NB[i * 4 + d];
    if (j < 0) continue;
    const k = G.k[j];
    if (k === 0 || k === 3) continue;                   // empty cells and hidden goals fit either way
    const mine = e >> d & 1, their = G.e[j] >> opp(d) & 1;
    if (mine !== their) return ERR_FIT;
    if (mine && R[j]) link = true;
  }
  return link ? null : ERR_LINK;
}

/* Tunnel ends: empty cells beyond an open side of a connected cell (path cards can only go here) */
function exits(G, R) {
  const out = [], seen = new Uint8Array(NC);
  for (let i = 0; i < NC; i++) if (R[i]) for (let d = 0; d < 4; d++) {
    if (!(G.e[i] >> d & 1)) continue;
    const j = NB[i * 4 + d];
    if (j >= 0 && !G.k[j] && !seen[j]) { seen[j] = 1; out.push(j); }
  }
  return out;
}

/* Distance left to each goal (rough number of cards still needed): from the cells next to the goal, through empty
   cells only, to a tunnel end. 0 once reached. If only one tunnel end lies on the shortest route (a single lane),
   count it as slightly farther — one dead end can easily block it */
const dq = new Int16Array(NC), dd = new Int16Array(NC);
function dists(G, R, raw) {   // raw: whole cell counts without the adjustment (for display)
  const ex = exits(G, R);
  const D = [FAR, FAR, FAR];
  for (let g = 0; g < 3; g++) {
    const gi = GOAL_I[g];
    if (G.k[gi] === 4 && R[gi]) { D[g] = 0; continue; }
    dd.fill(0);
    let qn = 0, hit = false;
    for (let d = 0; d < 4; d++) {
      const j = NB[gi * 4 + d];
      if (j < 0) continue;
      if (R[j] && (G.e[j] >> opp(d) & 1)) { hit = true; break; }
      if (!G.k[j] && !dd[j]) { dd[j] = 1; dq[qn++] = j; }
    }
    if (hit) { D[g] = 0; continue; }
    for (let h = 0; h < qn; h++) {
      const i = dq[h];
      for (let d = 0; d < 4; d++) {
        const j = NB[i * 4 + d];
        if (j >= 0 && !G.k[j] && !dd[j]) { dd[j] = dd[i] + 1; dq[qn++] = j; }
      }
    }
    let best = FAR, width = 0;
    for (const j of ex) {
      const v = dd[j];
      if (!v) continue;
      if (v < best) { best = v; width = 1; } else if (v === best) width++;
    }
    D[g] = best < FAR ? (raw ? best : best + .6 / width) : FAR;
  }
  return D;
}

/* ---------- Rounds ---------- */
function newRound(S) {
  S.round++;
  const [ns, nm] = ROLE_SET[S.n];
  const roles = shuffle(S, [...Array(ns).fill("s"), ...Array(nm).fill("m")]);
  S.roles = roles.slice(0, S.n);                        // the leftover cards stay unknown
  S.deck = shuffle(S, [...Array(NCARDS).keys()]);
  S.hands = [];
  const hs = handSize(S.n);
  for (let p = 0; p < S.n; p++) S.hands.push(S.deck.splice(S.deck.length - hs, hs));
  S.discard = [];
  S.broken = Array.from({ length: S.n }, () => []);
  S.peeks = Array.from({ length: S.n }, () => []);
  S.hist = [];
  const shapes = shuffle(S, [{ gold: true, e0: 15 }, { gold: false, e0: 9 }, { gold: false, e0: 12 }]);   // coal: ┘(N·W) · ┐(S·W)
  S.goals = GOAL_POS.map(([x, y], g) => ({ x, y, gold: shapes[g].gold, e0: shapes[g].e0, e: 0, rev: false }));
  S.board = { [key(0, 0)]: { k: "s" } };
  S.goals.forEach((gl, g) => { S.board[key(gl.x, gl.y)] = { k: "g", g }; });
  S.turn = S.nextStart % S.n;
  S.phase = "play";
  S.res = null;
  S.last = null;
}

/* Flip hidden goals reached by a tunnel from the entrance (coal is turned so the reached side is open). true if gold */
function revealReached(S, ev) {
  let gold = false;
  for (;;) {
    const G = grid(S.board), R = reach(G);
    let any = false;
    for (let g = 0; g < 3; g++) {
      const gl = S.goals[g];
      if (gl.rev) continue;
      const gi = GOAL_I[g], sides = [];
      for (let d = 0; d < 4; d++) { const j = NB[gi * 4 + d]; if (j >= 0 && R[j] && (G.e[j] >> opp(d) & 1)) sides.push(d); }
      if (!sides.length) continue;
      const fit = m => sides.filter(d => m >> d & 1).length;
      let e = gl.e0, rot = 0;
      if (fit(rot180(e)) > fit(e)) { e = rot180(e); rot = 180; }
      gl.e = e; gl.rev = true;
      Object.assign(S.board[key(gl.x, gl.y)], { rev: true, e, c: true, rot });
      ev.push({ type: "reveal", g, x: gl.x, y: gl.y, gold: gl.gold, e, rot,
        text: gl.gold ? tx(`💰 ${GOAL_NAME[g].ko} 목표는 금이었습니다!`, `💰 Goal ${GOAL_NAME[g].en} was gold!`)
          : tx(`${GOAL_NAME[g].ko} 목표는 석탄이었습니다 ⚫`, `Goal ${GOAL_NAME[g].en} was coal ⚫`), toast: gl.gold });
      if (gl.gold) gold = true;
      any = true;
    }
    if (!any || gold) return gold;
  }
}

function endRound(S, winner, finisher, ev) {
  const gains = Array(S.n).fill(0);
  const sabs = [];
  S.roles.forEach((r, p) => { if (r === "s") sabs.push(p); });
  if (winner === "m") S.roles.forEach((r, p) => { if (r === "m") gains[p] = p === finisher ? 3 : 2; });
  else { const per = sabs.length === 1 ? 4 : sabs.length <= 3 ? 3 : 2; for (const p of sabs) gains[p] = per; }
  gains.forEach((g, p) => { S.gold[p] += g; });
  S.roleHist.forEach((h, p) => h.push(S.roles[p]));
  S.phase = "end";
  S.nextStart = (finisher + 1) % S.n;
  const goldAt = S.goals.findIndex(gl => gl.gold);
  S.res = { winner, gains, finisher, goldAt };
  ev.push({ type: "round", winner, finisher, gains, roles: S.roles.slice(), goldAt, round: S.round,
    text: winner === "m" ? tx(`광부 승리! {${finisher}} 님이 금맥을 열었습니다`, `Miners win! {${finisher}} struck gold`)
      : sabs.length ? tx("카드가 모두 떨어졌습니다 — 방해꾼 승리!", "Out of cards — Traitors win!")
        : tx("카드가 모두 떨어졌습니다 — 이번 판엔 방해꾼이 없었습니다", "Out of cards — there was no Traitor this round"), toast: true });
}

/* Next turn: the next player with cards left. If nobody has any, the round ends (traitors win) */
function advance(S, p, ev) {
  for (let k = 1; k <= S.n; k++) {
    const q = (p + k) % S.n;
    if (S.hands[q].length) { S.turn = q; return; }
  }
  endRound(S, "s", p, ev);
}

function actionKey(a) {
  if (!a || typeof a !== "object") return null;
  const ks = ["path", "break", "repair", "map", "rock", "discard"].filter(k => a[k] !== undefined);
  return ks.length === 1 ? ks[0] : null;
}

/* ---------- AI ---------- */
const LEVELS = {
  easy: { noise: 3.5, rand: .3, sneaky: 0, mapBonus: 0 },
  normal: { noise: 2.5, rand: .05, sneaky: .3, mapBonus: 1 },
  hard: { noise: .3, rand: 0, sneaky: .35, mapBonus: 2 }
};
const ed = (D, w) => w[0] * D[0] + w[1] * D[1] + w[2] * D[2];
const noise = (rng, s) => (s ? (rng() + rng() + rng() - 1.5) * s * 1.15 : 0);

/* What o knows about the goals → chance each is gold, w. pub: public info only (what everyone knows) */
function belief(S, o, pub) {
  const known = S.goals.map((gl, g) => (gl.rev || (!pub && o >= 0 && S.peeks[o].includes(g)) ? gl.gold : null));
  const w = [0, 0, 0];
  const gi = known.indexOf(true);
  const unk = [0, 1, 2].filter(g => known[g] === null);
  if (gi >= 0) w[gi] = 1;
  else for (const g of unk) w[g] = 1 / unk.length;
  return { w, known, sure: gi >= 0 || unk.length === 1 };
}

/* Suspicion score guessed from public actions (higher = more traitor-like), from o's point of view — o may use
   their own role and the maps they have seen */
function suspicion(S, o, w) {
  const help = new Array(S.n).fill(0);
  for (const h of S.hist) {
    if (h.t !== "path" && h.t !== "rock") continue;
    let v = w[0] * h.dg[0] + w[1] * h.dg[1] + w[2] * h.dg[2];
    if (h.dead) v -= 1.5;
    help[h.p] += v;
  }
  const t1 = help.map(v => Math.max(-2, Math.min(2, v / 2)));
  const myRole = o >= 0 ? S.roles[o] : null;
  for (const h of S.hist) {
    if (h.t === "break") {
      let v = -1.2 * t1[h.target];
      if (h.target === o) v += myRole === "m" ? -3 : 1.5;   // breaking my tools (as a miner) is suspicious
      help[h.p] += v;
    } else if (h.t === "fix" && h.target !== h.p) {
      let v = t1[h.target];
      if (h.target === o && myRole === "m") v += 1.5;
      help[h.p] += v;
    }
  }
  return help.map(v => -v);
}

function randomAct(S, p, rng) {
  const hand = S.hands[p];
  if (rng() < .12) return { discard: pick(rng, hand) };
  let G = null, R = null, ex = null;
  for (const id of shuffleWith(rng, hand.slice())) {
    const C = CARDS[id];
    if (C.t === "path") {
      if (S.broken[p].length) continue;
      if (!G) { G = grid(S.board); R = reach(G); ex = exits(G, R); }
      const opts = [];
      for (const rot of [0, 180]) {
        const e = rot ? rot180(C.e) : C.e;
        for (const i of ex) if (!placeErr(G, R, i, e)) opts.push({ path: id, x: ix(i), y: iy(i), rot });
      }
      if (opts.length) return pick(rng, opts);
    } else if (C.t === "break") {
      const ts = [];
      for (let t = 0; t < S.n; t++) if (t !== p && !S.broken[t].includes(C.tool)) ts.push(t);
      if (ts.length) return { break: id, target: pick(rng, ts) };
    } else if (C.t === "fix") {
      const opts = [];
      for (let t = 0; t < S.n; t++) for (const tool of C.tools) if (S.broken[t].includes(tool)) opts.push({ repair: id, target: t, tool });
      if (opts.length) return pick(rng, opts);
    } else if (C.t === "map") {
      const gs = [0, 1, 2].filter(g => !S.goals[g].rev && !S.peeks[p].includes(g));
      if (gs.length) return { map: id, goal: pick(rng, gs) };
    } else if (C.t === "rock") {
      const cells = Object.keys(S.board).filter(k => S.board[k].k === "p");
      if (cells.length) { const [x, y] = pick(rng, cells).split(",").map(Number); return { rock: id, x, y }; }
    }
  }
  return { discard: pick(rng, hand) };
}

function aiAct(S, p, level, rng) {
  const L = LEVELS[level] || LEVELS.normal;
  const hand = S.hands[p];
  if (rng() < L.rand) return randomAct(S, p, rng);
  const mine = S.roles[p] === "m";
  const bel = belief(S, p, false), w = bel.w, pw = belief(S, p, true).w;
  const G = grid(S.board), R0 = reach(G), D0 = dists(G, R0), ex = exits(G, R0);
  const ed0 = ed(D0, w), ped0 = ed(D0, pw);
  const sus = suspicion(S, p, w);                       // suspicion from my point of view (higher = more traitor-like)
  const pubSus = suspicion(S, -1, pw);                  // public suspicion — a traitor's estimate of how exposed they are
  const pubTrust = pubSus.map(v => Math.max(-2, Math.min(2, -v / 2)));
  // Traitor attitude: the closer the miners are to gold, the more openly they block. Depending on the level they
  // sometimes pick a less suspicious move (in AI-vs-AI tests, traitors who hide too much lose — doing nothing
  // gets you suspected in the end anyway)
  let near = FAR;                                       // distance to the nearest goal that may be gold
  for (let g = 0; g < 3; g++) if (w[g] > 0) near = Math.min(near, D0[g]);
  let aggr = 1, stealth = 1;
  if (near <= 2.7) { aggr = 2; stealth = 0; } else if (near <= 4.7) { aggr = 1.2; stealth = .35; }
  stealth *= L.sneaky;
  if (pubSus[p] > 2.5) stealth *= .3;                   // already exposed: nothing left to hide
  if (S.deck.length < S.n) stealth *= .5;               // endgame
  const expo = 3.5 * stealth;                           // cost of earning one point of suspicion
  const broken = S.broken[p].length > 0;
  const order = t => (t - p + S.n) % S.n;               // how many turns after me t plays
  const cands = [];
  const add = (a, s) => cands.push({ a, s: s + noise(rng, L.noise) });
  const seenShape = new Set();

  for (const id of hand) {
    const C = CARDS[id];
    // Discard: minus the value of keeping the card (traitors save dead ends, rockfalls and broken-tool cards)
    let keep = 2;
    if (C.t === "path") keep = mine ? (C.c ? (broken ? 1.5 : 3) : 0) : (C.c ? 1 : 3.5);
    else if (C.t === "break") keep = mine ? 2 : 3.5;
    else if (C.t === "map") keep = bel.sure ? 0 : 2.5;
    else if (C.t === "rock") keep = mine ? 1.5 : 3;
    else if (C.t === "fix") keep = mine ? 2 : 1.5;
    add({ discard: id }, -2 - keep);

    if (C.t === "path") {
      if (broken) continue;
      const sig = C.e * 2 + (C.c ? 1 : 0);
      if (seenShape.has(sig)) continue;
      seenShape.add(sig);
      for (const rot of C.e === rot180(C.e) ? [0] : [0, 180]) {
        const e = rot ? rot180(C.e) : C.e;
        for (const i of ex) {
          if (placeErr(G, R0, i, e)) continue;
          G.k[i] = 2; G.e[i] = e; G.c[i] = C.c ? 1 : 0;
          const D = dists(G, reach(G));
          G.k[i] = 0; G.e[i] = 0; G.c[i] = 0;
          const gain = ed0 - ed(D, w), pgain = ped0 - ed(D, pw);
          let hit = 0, coal = 0;                          // chance that a goal flipped by this move is gold · reveals coal I know about
          for (let g = 0; g < 3; g++) if (!S.goals[g].rev && D[g] === 0) { hit += w[g]; if (bel.known[g] === false) coal++; }
          let s;
          if (mine) s = 10 * gain + 60 * hit + 2 * coal - (C.c ? 0 : 4) - (gain <= 0 ? 3 : 0);
          else {
            // Gain: move away from gold. Cost: suspicion for visibly spoiling the tunnel.
            // Digging towards coal I know about looks helpful, but flipping it informs the miners, so don't go all the way
            const exposure = Math.max(0, -pgain) + (C.c ? 0 : 1.5);
            s = -10 * gain * aggr - expo * exposure + (pgain > 0 && gain <= .25 ? (2 + 2 * stealth) * pgain : 0) - 80 * hit - 8 * coal;
          }
          add({ path: id, x: ix(i), y: iy(i), rot }, s);
        }
      }
    } else if (C.t === "break") {
      for (let t = 0; t < S.n; t++) {
        if (t === p || S.broken[t].includes(C.tool)) continue;
        const already = S.broken[t].length > 0, soon = (S.n - order(t)) / S.n;
        let s;
        if (mine) s = 3 * (sus[t] - 2.5) + (already ? -2 : 1.5) + soon;   // only when quite suspicious
        else {
          const trust = Math.max(-2, Math.min(2, -sus[t] / 2));   // the more miner-like, the more worth stopping
          s = (1.5 + 2 * trust) * aggr + (already ? -2 : 1.2) + 3 * soon * aggr - expo * Math.max(0, 1.2 * pubTrust[t]);
        }
        add({ break: id, target: t }, s);
      }
    } else if (C.t === "fix") {
      for (let t = 0; t < S.n; t++) for (const tool of C.tools) {
        if (!S.broken[t].includes(tool)) continue;
        const full = S.broken[t].length === 1;
        let s;
        if (mine) s = t === p ? (full ? 7 : 3) : (sus[t] < -.5 ? 3 - sus[t] + (full ? 1 : 0) : -2 - sus[t]);
        else s = t === p ? (full ? 5 : 2) : (sus[t] > 1 ? 1 + sus[t] - expo * Math.max(0, -pubTrust[t]) : -3);
        add({ repair: id, target: t, tool }, s);
      }
    } else if (C.t === "map") {
      if (bel.sure) continue;
      for (let g = 0; g < 3; g++) {
        if (bel.known[g] !== null) continue;
        const s = (mine ? 4 : 3.5) + (ed0 <= 5 ? 6 : 2) + L.mapBonus + (g === 1 ? .6 : 0);
        add({ map: id, goal: g }, s);
      }
    } else if (C.t === "rock") {
      for (let i = 0; i < NC; i++) {
        if (G.k[i] !== 2) continue;
        const e = G.e[i], c = G.c[i];
        G.k[i] = 0; G.e[i] = 0; G.c[i] = 0;
        const D = dists(G, reach(G));
        G.k[i] = 2; G.e[i] = e; G.c[i] = c;
        const gain = ed0 - ed(D, w), pgain = ped0 - ed(D, pw);
        const s = mine ? 10 * gain - 2 : -10 * gain * aggr - 1 - expo * Math.max(0, -pgain);
        add({ rock: id, x: ix(i), y: iy(i) }, s);
      }
    }
  }
  cands.sort((a, b) => b.s - a.s);
  return cands[0].a;
}

/* ---------- Engine ---------- */
export default {
  id: "mine",
  name,
  icon: "⛏️",
  blurb: tx("굴을 이어 금을 캐세요. 그런데 우리 중에 방해꾼이 숨어 있다!", "Dig a tunnel to the gold. But there's a traitor among us!"),
  players: { min: 3, max: 10, default: 5 },
  spectate: true,                                       // view(S, -1) is the public table (watching screens · replays)
  settings: [
    { key: "rounds", label: tx("라운드", "Rounds"), values: [1, 3], labels: [tx("1라운드", "1 round"), tx("3라운드", "3 rounds")], default: 3,
      note: tx("라운드마다 역할을 새로 나눕니다", "Roles are dealt again every round") }
  ],
  rules: tx(`<ul>
    <li>모두 몰래 <b>역할</b>을 받습니다. <b>광부</b>는 입구에서 금까지 굴을 잇고, <b>방해꾼</b>은 들키지 않게 막습니다.
      역할 카드는 인원보다 1~2장 많고, 남는 카드는 아무도 모릅니다 — 그래서 방해꾼이 몇 명인지는 아무도 모릅니다.
      (방해꾼·광부 카드: 3명 2·3, 4명 2·4, 5명 2·4, 6명 3·5, 7명 3·5, 8명 3·6, 9명 4·7, 10명 4·7.
      우리 규칙: 3 · 4 · 6 · 9명은 원래보다 방해꾼 카드가 한 장 많습니다 — 광부가 너무 쉽게 이겨서.)</li>
    <li><b>입구</b>에서 8칸 떨어진 곳에 뒤집힌 <b>목표 3장</b>(금 1 · 석탄 2, <b>1 · 2 · 3번</b>)이 2칸 간격으로 있습니다.
      화면이 길쭉하면 판이 세로로(입구가 위, 목표가 아래) 보입니다 — 칸을 크게 보여 주려고 돌린 것일 뿐 규칙은 같습니다.</li>
    <li>내 차례에는 카드 <b>한 장을 내거나</b>, 한 장을 <b>엎어 버립니다</b>. 그다음 덱이 남았으면 한 장 뽑습니다. 손패: 3~5명 6장, 6~7명 5장, 8~10명 4장.</li>
  </ul>
  <h4>길 카드 (44장, 막다른 길 9장 포함)</h4>
  <ul>
    <li>이미 놓인 카드 옆에 놓되, <b>맞닿는 모든 면이 맞아야</b> 합니다 (굴↔굴, 벽↔벽). 뒤집힌 목표는 어느 쪽과도 맞는 것으로 칩니다.</li>
    <li>새 카드는 <b>입구에서 끊기지 않은 굴</b>로 이어져야 합니다. 막다른 길(돌무더기)은 굴이 지나가지 못합니다.</li>
    <li>카드는 <b>180° 돌려</b> 놓을 수 있습니다.</li>
    <li>굴이 목표에 닿으면 뒤집습니다. 석탄이면 닿은 쪽으로 굴이 열리게 돌려 놓고, 거기서 계속 팔 수 있습니다. <b>금</b>이 나오면 광부 승리!</li>
  </ul>
  <h4>행동 카드 (27장)</h4>
  <ul>
    <li><b>도구 고장</b> ⛏ 곡괭이 · 🔦 등불 · 🛒 수레 (각 3장): 다른 사람의 도구를 망가뜨립니다. 이미 고장 난 도구는 또 고장 낼 수 없습니다. <b>고장 난 도구가 하나라도 있으면 길 카드를 놓을 수 없습니다.</b></li>
    <li><b>수리</b> (도구마다 2장 + 두 도구 중 하나를 고치는 카드 3장): 나나 다른 사람의 고장 난 도구 하나를 고칩니다.</li>
    <li><b>지도</b> (6장): 목표 하나를 나만 몰래 봅니다. <b>낙석</b> (3장): 입구 · 목표를 뺀 길 카드 한 장을 치웁니다.</li>
    <li>덱과 모든 손패가 떨어질 때까지 금에 닿지 못하면 <b>방해꾼 승리</b>.</li>
  </ul>
  <h4>점수 (우리 규칙)</h4>
  <ul>
    <li>광부 승리: 금을 연 광부 <b>3금</b>, 나머지 광부 <b>2금</b>씩. (방해꾼이 금을 열었다면 광부 모두 2금씩.)</li>
    <li>방해꾼 승리: 방해꾼이 1명이면 <b>4금</b>, 2~3명이면 <b>3금</b>씩, 4명이면 <b>2금</b>씩.</li>
    <li>라운드마다 역할을 새로 받고, 라운드를 끝낸 사람의 다음 사람부터 시작합니다. 마지막 라운드가 끝나면 금이 가장 많은 사람이 1등.</li>
  </ul>`, `<ul>
    <li>Everyone secretly gets a <b>role</b>. <b>Miners</b> dig a tunnel from the entrance to the gold; <b>Traitors</b> block it without being caught.
      There are 1–2 more role cards than players, and nobody knows the leftover cards — so nobody knows how many Traitors there are.
      (Traitor · Miner cards: 3p 2·3, 4p 2·4, 5p 2·4, 6p 3·5, 7p 3·5, 8p 3·6, 9p 4·7, 10p 4·7.
      Our rule: with 3 · 4 · 6 · 9 players there is one more Traitor card than in the original — the Miners won too easily.)</li>
    <li>8 cells from the <b>entrance</b> lie <b>3 face-down goals</b> (1 gold · 2 coal, <b>#1 · #2 · #3</b>), 2 cells apart.
      On a tall screen the board is shown vertically (entrance on top, goals at the bottom) — it is only turned to make the cells bigger; the rules are the same.</li>
    <li>On your turn, <b>play one card</b> or <b>discard one face down</b>. Then draw a card if the deck isn't empty. Hand size: 6 cards for 3–5 players, 5 for 6–7, 4 for 8–10.</li>
  </ul>
  <h4>Path cards (44, including 9 dead ends)</h4>
  <ul>
    <li>Place them next to cards already on the board; <b>every touching side must match</b> (tunnel↔tunnel, wall↔wall). Face-down goals count as matching anything.</li>
    <li>A new card must connect to the entrance through an <b>unbroken tunnel</b>. Tunnels can't pass through a dead end (rubble).</li>
    <li>Cards may be <b>turned 180°</b>.</li>
    <li>When the tunnel reaches a goal, flip it. Coal is turned so its tunnel opens towards the side that was reached, and you can keep digging from it. If it's <b>gold</b>, the Miners win!</li>
  </ul>
  <h4>Action cards (27)</h4>
  <ul>
    <li><b>Broken tool</b> ⛏ pickaxe · 🔦 lantern · 🛒 cart (3 each): break another player's tool. A tool that is already broken can't be broken again. <b>With even one broken tool you can't place path cards.</b></li>
    <li><b>Repair</b> (2 per tool + 3 cards that fix either of two tools): fix one broken tool — yours or someone else's.</li>
    <li><b>Map</b> (6): secretly look at one goal yourself. <b>Rockfall</b> (3): remove one path card (not the entrance or a goal).</li>
    <li>If the deck and every hand run out before the tunnel reaches gold, the <b>Traitors win</b>.</li>
  </ul>
  <h4>Scoring (our rule)</h4>
  <ul>
    <li>Miners win: the Miner who reached the gold gets <b>3 gold</b>, every other Miner <b>2 gold</b>. (If a Traitor reached the gold, every Miner gets 2.)</li>
    <li>Traitors win: a lone Traitor gets <b>4 gold</b>; 2–3 Traitors get <b>3 gold</b> each; 4 Traitors <b>2 gold</b> each.</li>
    <li>Roles are dealt again each round, and the player after the one who ended the round starts. After the last round, the most gold wins.</li>
  </ul>`),

  setup({ n, seed, settings }) {
    const rounds = settings && settings.rounds === 1 ? 1 : 3;
    const S = { n, rs: seed >>> 0, rounds, round: 0, phase: "play", gold: Array(n).fill(0), roleHist: Array.from({ length: n }, () => []), nextStart: 0 };
    S.nextStart = Math.floor((seed >>> 0) % n);
    newRound(S);
    return S;
  },

  pending(S) {
    if (S.phase !== "play") return [];
    return [{ p: S.turn, kind: "turn" }];
  },

  validate(S, p, a) {
    if (S.phase !== "play" || p !== S.turn) return tx("지금은 내 차례가 아닙니다", "It's not your turn");
    const k = actionKey(a);
    if (!k) return tx("낼 카드를 한 장 고르세요", "Choose one card to play");
    const id = a[k];
    if (!Number.isInteger(id) || !S.hands[p].includes(id)) return tx("손에 없는 카드입니다", "That card is not in your hand");
    const C = CARDS[id];
    if (k === "discard") return true;
    if (k === "path") {
      if (C.t !== "path") return tx("길 카드가 아닙니다", "That is not a path card");
      if (S.broken[p].length) return tx("도구가 고장 나서 길을 놓을 수 없습니다", "Your tools are broken, so you can't place paths");
      if (a.rot !== 0 && a.rot !== 180) return tx("카드 방향이 잘못되었습니다", "Invalid card rotation");
      if (!Number.isInteger(a.x) || !Number.isInteger(a.y) || !inB(a.x, a.y)) return tx("놓을 수 없는 자리입니다", "You can't place a card there");
      const G = grid(S.board);
      const err = placeErr(G, reach(G), idx(a.x, a.y), a.rot ? rot180(C.e) : C.e);
      return err || true;
    }
    if (k === "break") {
      if (C.t !== "break") return tx("도구 고장 카드가 아닙니다", "That is not a broken-tool card");
      if (!Number.isInteger(a.target) || a.target < 0 || a.target >= S.n) return tx("고장 낼 사람을 고르세요", "Choose whose tool to break");
      if (a.target === p) return tx("내 도구는 고장 낼 수 없습니다", "You can't break your own tool");
      if (S.broken[a.target].includes(C.tool)) {
        const T = TOOL_NAME[C.tool];
        return tx(`이미 ${josa(T.ko, "이", "가")} 고장 난 사람입니다`, `That player's ${T.en} is already broken`);
      }
      return true;
    }
    if (k === "repair") {
      if (C.t !== "fix") return tx("수리 카드가 아닙니다", "That is not a repair card");
      if (!Number.isInteger(a.target) || a.target < 0 || a.target >= S.n) return tx("고칠 사람을 고르세요", "Choose whose tool to repair");
      if (!C.tools.includes(a.tool)) return tx("이 카드로 고칠 수 없는 도구입니다", "This card can't repair that tool");
      if (!S.broken[a.target].includes(a.tool)) return tx("고장 나지 않은 도구입니다", "That tool isn't broken");
      return true;
    }
    if (k === "map") {
      if (C.t !== "map") return tx("지도 카드가 아닙니다", "That is not a map card");
      if (![0, 1, 2].includes(a.goal)) return tx("볼 목표를 고르세요", "Choose a goal to look at");
      if (S.goals[a.goal].rev) return tx("이미 공개된 목표입니다", "That goal is already revealed");
      if (S.peeks[p].includes(a.goal)) return tx("이미 확인한 목표입니다", "You have already looked at that goal");
      return true;
    }
    if (k === "rock") {
      if (C.t !== "rock") return tx("낙석 카드가 아닙니다", "That is not a rockfall card");
      if (!Number.isInteger(a.x) || !Number.isInteger(a.y)) return tx("무너뜨릴 길을 고르세요", "Choose a path to collapse");
      const cell = S.board[key(a.x, a.y)];
      if (!cell || cell.k !== "p") return tx("입구 · 목표가 아닌 길 카드만 무너뜨릴 수 있습니다", "Only path cards can be collapsed (not the entrance or a goal)");
      return true;
    }
    return tx("알 수 없는 행동입니다", "Unknown action");
  },

  apply(S, p, a) {
    const ev = [];
    const k = actionKey(a), id = a[k], C = CARDS[id];
    S.hands[p].splice(S.hands[p].indexOf(id), 1);
    if (k === "discard") {
      S.discard.push(id);
      S.hist.push({ p, t: "discard" });
      S.last = { p, t: "discard" };
      ev.push({ type: "discard", p, text: tx(`{${p}} 님이 카드 한 장을 엎어 버렸습니다`, `{${p}} discarded a card face down`) });
    } else if (k === "path" || k === "rock") {
      const G0 = grid(S.board), D0 = dists(G0, reach(G0));
      const kk = key(a.x, a.y), gone = k === "rock" ? S.board[kk] : null;   // card removed by the rockfall (everyone saw it)
      if (k === "path") {
        const e = a.rot ? rot180(C.e) : C.e;
        S.board[kk] = { k: "p", id, e, c: C.c, rot: a.rot };
        ev.push({ type: "path", p, x: a.x, y: a.y, id, e, c: C.c, rot: a.rot,
          text: C.c ? tx(`{${p}} 님이 굴을 팠습니다`, `{${p}} dug a tunnel`) : tx(`{${p}} 님이 막다른 길을 놓았습니다`, `{${p}} placed a dead end`) });
      } else {
        S.discard.push(id, S.board[kk].id);
        delete S.board[kk];
        ev.push({ type: "rock", p, x: a.x, y: a.y, text: tx(`{${p}} 님이 낙석으로 굴 하나를 무너뜨렸습니다`, `{${p}} collapsed a tunnel with a rockfall`) });
      }
      const G1 = grid(S.board), D1 = dists(G1, reach(G1));
      S.hist.push({ p, t: k, x: a.x, y: a.y, dead: k === "path" && !C.c, gd: k === "rock" && !gone.c, dg: D0.map((d, g) => d - D1[g]) });
      S.last = { p, t: k, x: a.x, y: a.y };
      if (k === "path" && revealReached(S, ev)) { endRound(S, "m", p, ev); return ev; }
    } else if (k === "break") {
      S.broken[a.target].push(C.tool);
      S.discard.push(id);
      S.hist.push({ p, t: "break", target: a.target, tool: C.tool });
      S.last = { p, t: "break", target: a.target, tool: C.tool };
      const T = TOOL_NAME[C.tool];
      ev.push({ type: "break", p, target: a.target, tool: C.tool,
        text: tx(`{${p}} 님이 {${a.target}} 님의 ${josa(T.ko, "을", "를")} 망가뜨렸습니다 ${TOOL_ICON[C.tool]}`,
          `{${p}} broke {${a.target}}'s ${T.en} ${TOOL_ICON[C.tool]}`) });
    } else if (k === "repair") {
      S.broken[a.target].splice(S.broken[a.target].indexOf(a.tool), 1);
      S.discard.push(id);
      S.hist.push({ p, t: "fix", target: a.target, tool: a.tool });
      S.last = { p, t: "fix", target: a.target, tool: a.tool };
      const T = TOOL_NAME[a.tool];
      ev.push({ type: "repair", p, target: a.target, tool: a.tool,
        text: a.target === p ? tx(`{${p}} 님이 자기 ${josa(T.ko, "을", "를")} 고쳤습니다 ${TOOL_ICON[a.tool]}`, `{${p}} repaired their own ${T.en} ${TOOL_ICON[a.tool]}`)
          : tx(`{${p}} 님이 {${a.target}} 님의 ${josa(T.ko, "을", "를")} 고쳐 주었습니다 ${TOOL_ICON[a.tool]}`, `{${p}} repaired {${a.target}}'s ${T.en} ${TOOL_ICON[a.tool]}`) });
    } else if (k === "map") {
      S.peeks[p].push(a.goal);
      S.discard.push(id);
      S.hist.push({ p, t: "map", goal: a.goal });
      S.last = { p, t: "map", goal: a.goal };
      ev.push({ type: "map", p, goal: a.goal, gold: S.goals[a.goal].gold,
        text: tx(`{${p}} 님이 지도로 ${GOAL_NAME[a.goal].ko} 목표를 몰래 보았습니다 🗺️`, `{${p}} secretly looked at goal ${GOAL_NAME[a.goal].en} with a map 🗺️`) });
    }
    if (S.deck.length) S.hands[p].push(S.deck.pop());
    advance(S, p, ev);
    return ev;
  },

  /* Only the player who used the map learns what the goal is (spectators, p = -1, never do) */
  filterEvent(ev, p) {
    if (ev.type === "map" && p !== ev.p) { const { gold, ...rest } = ev; return rest; }
    return ev;
  },

  step(S) {
    if (S.phase !== "end") return [];
    if (S.round >= S.rounds) {
      S.phase = "over";
      return [{ type: "over", text: tx("게임 끝 — 금을 가장 많이 모은 사람이 이깁니다", "Game over — the most gold wins") }];
    }
    newRound(S);
    return [{ type: "newround", round: S.round, text: tx(`${S.round}라운드 시작 — 역할을 새로 나눴습니다`, `Round ${S.round} begins — roles dealt again`), toast: true }];
  },
  delay(S) { return S.phase === "end" ? 6000 : 800; },

  /* Timeout: discard one card from the hand (chosen without changing S) */
  timeout(S, p) {
    const h = S.hands[p];
    return { discard: h[(S.rs >>> 0) % Math.max(1, h.length)] };
  },
  ai(S, p, { level = "normal", rng = Math.random } = {}) {
    if (S.phase !== "play" || p !== S.turn || !S.hands[p].length) return this.timeout(S, p);
    const a = aiAct(S, p, level, rng);
    return this.validate(S, p, a) === true ? a : this.timeout(S, p);
  },
  thinkTime() { return 800 + Math.random() * 700; },

  view(S, p) {
    const me = p >= 0 && p < S.n ? p : -1;
    const open = S.phase !== "play";
    const known = me >= 0 ? S.peeks[me] : [];
    const board = [];
    let bx0 = 0, bx1 = 8, by0 = -2, by1 = 2;
    for (const kk in S.board) {
      const cell = S.board[kk], [x, y] = kk.split(",").map(Number);
      bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
      if (cell.k === "g") {
        const gl = S.goals[cell.g];
        board.push(gl.rev ? { x, y, k: "g", g: cell.g, rev: true, e: gl.e, gold: gl.gold } : { x, y, k: "g", g: cell.g });
      } else if (cell.k === "s") board.push({ x, y, k: "s", e: 15, c: true });
      else board.push({ x, y, k: "p", id: cell.id, e: cell.e, c: cell.c });
    }
    const goals = S.goals.map((gl, g) => ({ x: gl.x, y: gl.y, rev: gl.rev,
      kind: gl.rev || open || known.includes(g) ? (gl.gold ? "gold" : "coal") : null, peek: !gl.rev && known.includes(g) }));
    const hand = me >= 0 ? S.hands[me].map(id => ({ id, ...CARDS[id] })) : [];
    // Board maths done for the player: tunnel ends (empty cells beyond open ends connected to the entrance) and
    // the cells left from a tunnel end to each goal
    const G = grid(S.board), R = reach(G), ex = exits(G, R);
    const front = ex.map(i => [ix(i), iy(i)]);
    const need = dists(G, R, true).map(d => (d >= FAR ? null : d));
    // Legal spots [x, y, rot] for each path card — always computed so they can be previewed on others' turns
    // (uses only the public board and my own hand)
    let legal = null;
    if (me >= 0 && S.phase === "play" && !S.broken[me].length) {
      legal = {};
      for (const c of hand) if (c.t === "path") {
        const list = [];
        for (const rot of [0, 180]) {
          const e = rot ? rot180(c.e) : c.e;
          for (const i of ex) if (!placeErr(G, R, i, e)) list.push([ix(i), iy(i), rot]);
        }
        legal[c.id] = list;
      }
    }
    // Whose turn, as a public line (also shown in replays, which have no pending list). The player whose turn it is
    // gets "" so the shell shows its own "Your turn" only while really playing — never in a replay
    const status = S.phase === "over" ? tx("게임 끝", "Game over")
      : S.phase === "end" ? (S.res.winner === "m" ? tx("광부 승리! 다음 라운드 준비 중", "Miners win! Next round coming up")
        : tx("방해꾼 승리! 다음 라운드 준비 중", "Traitors win! Next round coming up"))
      : me === S.turn ? "" : tx(`{${S.turn}} 님 차례`, `{${S.turn}}'s turn`);
    return {
      phase: S.phase, round: S.round, rounds: S.rounds, turn: S.turn, n: S.n,
      deck: S.deck.length, sizes: S.hands.map(h => h.length), broken: S.broken.map(b => b.slice()), gold: S.gold.slice(),
      role: me >= 0 ? S.roles[me] : null,
      roles: open ? S.roles.slice() : null,
      res: open ? S.res : null,
      board, goals, hand, legal, last: S.last, front, need,
      roleSet: ROLE_SET[S.n],
      // Who did what this round (all public actions) — for the name-chip badges and the log panel
      log: S.hist.map(h => {
        const o = { p: h.p, t: h.t };
        if (h.t === "path") { o.x = h.x; o.y = h.y; o.dead = h.dead; }
        else if (h.t === "rock") { o.x = h.x; o.y = h.y; o.gone = h.gd ? "dead" : "path"; }   // kind of card collapsed
        else if (h.t === "break" || h.t === "fix") { o.target = h.target; o.tool = h.tool; }
        else if (h.t === "map") o.goal = h.goal;
        return o;
      }),
      bounds: { x0: Math.max(X0, bx0 - 1), x1: Math.min(X1, bx1 + 1), y0: Math.max(Y0, by0 - 1), y1: Math.min(Y1, by1 + 1) },
      status
    };
  },

  over(S) { return S.phase === "over"; },
  results(S) {
    return S.gold.map((g, p) => ({ p, rank: 1 + S.gold.filter(x => x > g).length, score: tx(`${g}금`, `${g} gold`),
      note: tx(S.roleHist[p].map(r => ROLE_NAME[r].ko).join(" · "), S.roleHist[p].map(r => ROLE_NAME[r].en).join(" · ")) }));
  },

  /* ---------- For tests ---------- */
  randomAction(S, p, rng) { return randomAct(S, p, rng); },
  check(S) {
    const ids = [...S.deck, ...S.discard];
    for (const h of S.hands) ids.push(...h);
    for (const kk in S.board) {
      const c = S.board[kk];
      if (c.k !== "p") continue;
      ids.push(c.id);
      const C = CARDS[c.id];
      if (!C || C.t !== "path") return `non-path card on the board ${c.id}`;
      if ((c.rot ? rot180(C.e) : C.e) !== c.e || C.c !== c.c) return `board card shape mismatch ${kk}`;
    }
    if (ids.length !== NCARDS) return `card count mismatch ${ids.length}`;
    if (new Set(ids).size !== NCARDS) return "duplicate card";
    for (const id of ids) if (!Number.isInteger(id) || id < 0 || id >= NCARDS) return `invalid card id ${id}`;
    const st = S.board[key(0, 0)];
    if (!st || st.k !== "s") return "entrance missing";
    for (let g = 0; g < 3; g++) {
      const c = S.board[key(...GOAL_POS[g])];
      if (!c || c.k !== "g" || c.g !== g || !!c.rev !== S.goals[g].rev) return `goal ${g} cell is wrong`;
    }
    for (const kk in S.board) { const [x, y] = kk.split(",").map(Number); if (!inB(x, y)) return `card off the board ${kk}`; }
    // Touching sides of the entrance and path cards must always match (revealed coal is skipped: it may not fit neighbours placed earlier)
    const G = grid(S.board);
    for (let i = 0; i < NC; i++) {
      if (G.k[i] !== 1 && G.k[i] !== 2) continue;
      for (const d of [1, 2]) {
        const j = NB[i * 4 + d];
        if (j < 0 || (G.k[j] !== 1 && G.k[j] !== 2)) continue;
        if ((G.e[i] >> d & 1) !== (G.e[j] >> opp(d) & 1)) return `neighbours with mismatched sides (${ix(i)},${iy(i)})`;
      }
    }
    if (S.phase === "play") {
      const R = reach(G);
      for (let g = 0; g < 3; g++) {
        if (S.goals[g].rev) continue;
        for (let d = 0; d < 4; d++) { const j = NB[GOAL_I[g] * 4 + d]; if (j >= 0 && R[j] && (G.e[j] >> opp(d) & 1)) return `goal ${g} reached but not flipped`; }
      }
      if (S.goals.some(gl => gl.rev && gl.gold)) return "gold revealed but the round goes on";
      if (!S.hands[S.turn].length) return "turn of a player with no cards";
    }
    for (let p = 0; p < S.n; p++) {
      const b = S.broken[p];
      if (new Set(b).size !== b.length) return `seat ${p} has a tool broken twice`;
      if (b.some(t => !TOOLS.includes(t))) return "invalid tool";
      if (S.hands[p].length > handSize(S.n)) return `seat ${p} holds too many cards`;
    }
    const [ns, nm] = ROLE_SET[S.n], sabs = S.roles.filter(r => r === "s").length;
    if (S.roles.length !== S.n || sabs > ns || S.n - sabs > nm) return "wrong number of roles";
    const total = S.gold.reduce((a, b) => a + b, 0);
    if (total < 0 || total > 4 * S.n * S.rounds) return "gold total out of range";
    return true;
  },
  /* p = -1: the public view (spectators) — no hand, no role, no peeked goal, no legal spots */
  leak(S, p, v) {
    const pub = !(p >= 0 && p < S.n);
    if (v.hands || v.peeks || v.hist || Array.isArray(v.deck)) return "hidden-info field visible";
    const a = (pub ? [] : S.hands[p]).slice().sort((x, y) => x - y).join(), b = (v.hand || []).map(c => c.id).sort((x, y) => x - y).join();
    if (a !== b) return pub ? "a hand is visible to spectators" : "cards other than my hand visible";
    if (pub && (v.role !== null || v.legal)) return "a role or a hand's legal spots visible to spectators";
    if (S.phase === "play") {
      if (v.roles || v.res) return "all roles visible during the round";
      if (!pub && v.role !== S.roles[p]) return "my role is wrong";
      const peeks = pub ? [] : S.peeks[p];
      for (let g = 0; g < 3; g++) {
        const gl = S.goals[g];
        if (pub && v.goals[g].peek) return `peek mark of goal ${g} visible to spectators`;
        if (gl.rev || peeks.includes(g)) continue;
        if (v.goals[g].kind !== null) return `identity of unknown goal ${g} visible`;
        const cell = v.board.find(c => c.k === "g" && c.g === g);
        if (!cell || cell.gold !== undefined || cell.e !== undefined) return `shape of hidden goal ${g} visible`;
      }
    }
    return true;
  },
  stepLimit: 5000
};
