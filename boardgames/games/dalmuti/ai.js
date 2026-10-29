/* Dalmuti AI — C:\Users\user\dalmuti\web\ai.js ported to an ES module.
   One difference: the original draws random numbers with E.rand(G), which changes the game state, but the room contract
   forbids AI from changing state, so a separate random function rnd() is passed in. Given the same random sequence it
   picks the same moves as the original (test_port.mjs compares them). */
import * as E from "./rules.js";
const { JESTER, TOTAL } = E;

/* Easy — always beats with the weakest possible cards when it can; when leading, plays any set */
export function easy(G, p, rnd) {
  const h = G.hands[p], J = h[JESTER];
  if (!G.trick) {
    const ranks = [];
    for (let r = 1; r <= 12; r++) if (h[r] > 0) ranks.push(r);
    if (!ranks.length) return E.actionId(JESTER, 0, J);
    const r = ranks[Math.floor(rnd() * ranks.length)];
    return E.actionId(r, h[r], 0);
  }
  const c = followCands(G, p);
  return c.length ? E.actionId(c[0].r, c[0].own, c[0].uj) : 0;
}

/* Candidates that beat the trick with the same card count. Ordered by fewest Jesters, weakest number, fewest split sets */
export function followCands(G, p) {
  const h = G.hands[p], J = h[JESTER], need = G.trick.count, limit = G.trick.rank;
  const out = [];
  for (let r = 1; r < limit && r <= 12; r++) {
    if (!h[r]) continue;
    const own = Math.min(h[r], need), uj = need - own;
    if (uj > J) continue;
    out.push({ r, own, uj, breaks: h[r] - own });
  }
  out.sort((a, b) => a.uj - b.uj || b.r - a.r || a.breaks - b.breaks);
  return out;
}

/* Normal — sheds large weak sets first and saves cards of 2 or lower and Jesters */
export function normal(G, p, rnd) {
  const h = G.hands[p], J = h[JESTER], size = E.handSize(G, p);
  if (!G.trick) {
    for (let r = 1; r <= 12; r++) if (h[r] > 0 && h[r] + J === size) return E.actionId(r, h[r], J);
    let best = 0;
    for (let r = 1; r <= 12; r++)
      if (h[r] > 0 && (!best || h[r] > h[best] || (h[r] === h[best] && r > best))) best = r;
    if (!best) return E.actionId(JESTER, 0, J);
    const j = (J > 0 && size - h[best] <= J + 1) ? J : 0;
    return E.actionId(best, h[best], j);
  }
  const c = followCands(G, p);
  if (!c.length) return 0;
  const pick = c[0], need = G.trick.count, id = E.actionId(pick.r, pick.own, pick.uj);
  if (size - need === 0) return id;
  if (pick.r <= 2 && size > 5 && need <= 2) return 0;
  if (pick.uj > 0 && size > 7 && rnd() < 0.55) return 0;
  return id;
}

/* Hard — counts played cards to know "plays nobody can beat", and keeps the lead while shedding */
export function hard(G, p) {
  const h = G.hands[p], J = h[JESTER], size = E.handSize(G, p);
  const unseen = new Array(14).fill(0);
  for (let r = 1; r <= 13; r++) unseen[r] = TOTAL(r) - G.played[r] - h[r];
  const uJ = unseen[JESTER];
  const beatable = (r, c) => {
    for (let q = 1; q < r && q <= 12; q++) if (unseen[q] > 0 && unseen[q] + uJ >= c) return true;
    return false;
  };
  let minOther = 99;
  for (const q of G.seats) if (q !== p) { const s = E.handSize(G, q); if (s > 0 && s < minOther) minOther = s; }

  if (!G.trick) {
    const ranks = [];
    for (let r = 1; r <= 12; r++) if (h[r] > 0) ranks.push(r);
    if (!ranks.length) return E.actionId(JESTER, 0, J);
    if (ranks.length === 1) return E.actionId(ranks[0], h[ranks[0]], J);
    const safe = ranks.filter(r => !beatable(r, h[r]));
    if (ranks.length === 2 && safe.length) return E.actionId(safe[0], h[safe[0]], 0);
    if (minOther <= 2) {
      // someone is about to go out — block them with a big set that is hard to follow
      let best = ranks[0];
      for (const r of ranks) if (h[r] > h[best] || (h[r] === h[best] && r > best)) best = r;
      if (h[best] > minOther) return E.actionId(best, h[best], 0);
    }
    const weak = ranks.filter(r => safe.indexOf(r) < 0);
    const pool = weak.length ? weak : ranks;
    const r = pool[pool.length - 1];
    return E.actionId(r, h[r], 0);
  }

  const need = G.trick.count, limit = G.trick.rank, cands = [];
  for (let r = 1; r < limit && r <= 12; r++) {
    if (!h[r]) continue;
    const own = Math.min(h[r], need), uj = need - own;
    if (uj > J) continue;
    let cost = (13 - r) + uj * 6 + (h[r] - own > 0 ? 2 : 0);
    if (!beatable(r, need)) cost -= 3;
    if (size - need === 0) cost = -100;
    cands.push({ r, own, uj, cost });
  }
  if (!cands.length) return 0;
  cands.sort((a, b) => a.cost - b.cost || b.r - a.r);
  const c = cands[0];
  const danger = minOther <= need || minOther <= 2;
  const limitCost = danger ? 99 : (size > 6 ? 9 : 14);
  if (c.cost > limitCost) return 0;
  return E.actionId(c.r, c.own, c.uj);
}

/* ---------- Learned policy (Q network) ----------
   Policy: {obs, act, layers:[{in,out,w,b}]} (w, b are float32 base64) — policy.js */
function b64f32(s) {
  const bin = atob(s), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(u8.buffer);
}
export function loadPolicy(raw) {
  if (!raw || !raw.layers) return null;
  if (raw.obs !== E.OBS || raw.act !== E.ACT) return null;    // don't use it if the encoding has changed
  return {
    meta: raw.meta || {}, layers: raw.layers.map(L => ({
      in: L.in, out: L.out,
      w: typeof L.w === "string" ? b64f32(L.w) : Float32Array.from(L.w),
      b: typeof L.b === "string" ? b64f32(L.b) : Float32Array.from(L.b)
    }))
  };
}
export function qValue(policy, x) {
  let h = x;
  policy.layers.forEach((L, li) => {
    const o = new Float32Array(L.out);
    for (let j = 0; j < L.out; j++) o[j] = L.b[j];
    for (let i = 0; i < L.in; i++) {
      const xi = h[i];
      if (xi === 0) continue;
      const row = i * L.out;
      for (let j = 0; j < L.out; j++) o[j] += xi * L.w[row + j];
    }
    if (li < policy.layers.length - 1) for (let j = 0; j < L.out; j++) if (o[j] < 0) o[j] = 0;
    h = o;
  });
  return h[0];
}
/* Learned AI. tau (temperature) 0 always plays the best move; higher values mix in weaker moves */
export function learned(G, p, policy, tau, rnd) {
  const ids = E.legal(G);
  if (ids.length === 1) return ids[0];
  const obs = E.encodeObs(G, p);
  const qs = ids.map(id => qValue(policy, obs.concat(E.encodeAct(G, p, id))));
  let bi = 0;
  for (let i = 1; i < qs.length; i++) if (qs[i] > qs[bi]) bi = i;
  if (!tau || tau <= 0) return ids[bi];
  const w = qs.map(q => Math.exp((q - qs[bi]) / tau));
  const sum = w.reduce((a, b) => a + b, 0);
  let r = rnd() * sum;
  for (let i = 0; i < ids.length; i++) { r -= w[i]; if (r <= 0) return ids[i]; }
  return ids[bi];
}

export function choose(G, p, level, rnd, policy) {
  if (level === "rl" && policy) return learned(G, p, policy, 0, rnd);
  if (level === "easy") return easy(G, p, rnd);
  if (level === "hard") return hard(G, p);
  return normal(G, p, rnd);
}

/* Revolution: the Greater Peon has nothing to lose (always), the Lesser Peon declares to save its tax, a Merchant sometimes, a Dalmuti never */
export function revolt(G, p, rnd) {
  const t = G.titles[p];
  if (t === E.T.GP || t === E.T.LP) return true;
  if (t === E.T.MER) return rnd() < 0.6;
  return false;
}
