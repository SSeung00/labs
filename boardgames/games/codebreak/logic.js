/* Secret Numbers — shared deduction, used by the engine's AI and by the screen's "possible numbers" helper.
   It only ever reads a view (what one seat may see), so the AI never peeks and the helper shows exactly what that player
   could work out on paper:
   - every row is in ascending order (equal numbers: black left of white; jokers may sit anywhere),
   - tile colours are public, wrong guesses rule numbers out for that tile,
   - a hidden tile can only be a tile the viewer can't see anywhere (own row, own drawn tile, revealed tiles),
   - two hidden tiles can't be the same tile, and when the pool is empty every unseen tile sits in some row.

   Tiles are "keys": number n (0..11) of colour c (0 black, 1 white) is n * 2 + c, so sorting keys sorts the row.
   Jokers ("−", number 12 in actions and views) are keys 24 (black) and 25 (white). Sets of keys are 26-bit masks. */

export const JOKER = 12;
export const keyOf = (n, c) => (n >= JOKER ? 24 + c : n * 2 + c);
export const numOf = k => (k >= 24 ? JOKER : k >> 1);
export const colOf = k => k & 1;
export const keyCount = jokers => (jokers ? 26 : 24);
const COL = [0x1555555, 0x2AAAAAA];             // even keys = black (incl. 24), odd keys = white (incl. 25)

export const bitsOf = m => { const a = []; while (m) { const b = m & -m; a.push(31 - Math.clz32(b)); m ^= b; } return a; };
export const popCount = m => { let c = 0; while (m) { m &= m - 1; c++; } return c; };
const known = t => t && t.n !== null && t.n !== undefined;

/* Row filling state: (last number key + 1) << 2 | jokers used (bit 0 black, bit 1 white). Start state 0. */
function tr(s, k) {
  if (k >= 24) { const b = 1 << (k - 24); return s & b ? -1 : s | b; }
  return k > (s >> 2) - 1 ? ((k + 1) << 2) | (s & 3) : -1;
}

/* Count the ways to fill one row in order. masks[i] = keys possible at position i (known tiles: one key).
   Returns {total, marg}: marg[i][k] = number of fillings with key k at position i. */
function rowDP(masks) {
  const m = masks.length, keys = masks.map(bitsOf), F = [new Map([[0, 1]])];
  for (let i = 0; i < m; i++) {
    const nx = new Map();
    for (const [s, w] of F[i]) for (const k of keys[i]) { const t = tr(s, k); if (t >= 0) nx.set(t, (nx.get(t) || 0) + w); }
    F.push(nx);
  }
  let B = new Map();
  for (const s of F[m].keys()) B.set(s, 1);
  const marg = new Array(m);
  for (let i = m - 1; i >= 0; i--) {
    const Bi = new Map(), mg = new Float64Array(26);
    for (const [s, w] of F[i]) {
      let sum = 0;
      for (const k of keys[i]) {
        const t = tr(s, k); if (t < 0) continue;
        const b = B.get(t); if (!b) continue;
        sum += b; mg[k] += w * b;
      }
      if (sum) Bi.set(s, sum);
    }
    marg[i] = mg; B = Bi;
  }
  return { total: B.get(0) || 0, marg };
}
/* Every ordered filling of a row (null if there are more than cap) */
function enumRow(masks, cap) {
  const out = [], m = masks.length, cur = new Array(m), keys = masks.map(bitsOf);
  let over = false;
  (function go(i, s) {
    if (over) return;
    if (i === m) { if (out.length >= cap) { over = true; return; } out.push(cur.slice()); return; }
    for (const k of keys[i]) { const t = tr(s, k); if (t >= 0) { cur[i] = k; go(i + 1, t); } }
  })(0, 0);
  return over ? null : out;
}

/* Exact odds over all rows at once (no tile used twice). Only for small cases; null when too big. */
function exactMarg(M, rowsWithSlots, res, cap) {
  let prod = 1;
  for (const q of rowsWithSlots) { prod *= res[q].total; if (prod > cap) return null; }
  const lists = new Map();
  for (const q of rowsWithSlots) {
    const l = enumRow(M[q], cap);
    if (!l) return null;
    lists.set(q, l.map(keys => ({ keys, used: keys.reduce((a, k) => a | (1 << k), 0) })));
  }
  const order = [...rowsWithSlots].sort((a, b) => lists.get(a).length - lists.get(b).length);
  const hits = new Map(order.map(q => [q, new Float64Array(lists.get(q).length)]));
  const pick = new Array(order.length);
  let total = 0, nodes = 0;
  (function go(j, used) {
    if (nodes++ > cap * 4) return;
    if (j === order.length) { total++; for (let x = 0; x < order.length; x++) hits.get(order[x])[pick[x]]++; return; }
    const l = lists.get(order[j]);
    for (let s = 0; s < l.length; s++) if (!(l[s].used & used)) { pick[j] = s; go(j + 1, used | l[s].used); }
  })(0, 0);
  if (!total || nodes > cap * 4) return null;
  const out = new Map();
  for (const q of order) {
    const l = lists.get(q), h = hits.get(q), mg = M[q].map(() => new Float64Array(26));
    l.forEach((seq, s) => { if (h[s]) seq.keys.forEach((k, i) => { mg[i][k] += h[s]; }); });
    out.set(q, mg);
  }
  return out;
}

/* Analyse a view. Returns {tiles, drawn, exact}:
   tiles[q][i] = null for tiles the viewer knows, else {nums: possible numbers (ascending), p: {number: probability}, size}
   drawn = possible numbers of someone else's drawn tile (or null).
   opt.exact: try exact joint odds (slower; used by the hard AI) */
export function analyze(v, opt = {}) {
  const K = keyCount(v.jokers), rows = v.rows;
  let seen = 0;
  for (const row of rows) for (const t of row) if (known(t)) seen |= 1 << keyOf(t.n, t.c);
  if (known(v.drawn)) seen |= 1 << keyOf(v.drawn.n, v.drawn.c);
  const U = ((1 << K) - 1) & ~seen;
  const excl = t => (t.no || []).reduce((a, n) => a | (n <= JOKER ? 1 << keyOf(n, t.c) : 0), 0);
  const M = rows.map(row => row.map(t => (known(t) ? 1 << keyOf(t.n, t.c) : U & COL[t.c] & ~excl(t))));
  const slots = [];
  rows.forEach((row, q) => row.forEach((t, i) => { if (!known(t)) slots.push({ q, i }); }));
  const hasD = !!v.drawn && !known(v.drawn);
  let dm = hasD ? U & COL[v.drawn.c] : 0;
  const poolEmpty = !(v.pool > 0);
  const withSlots = [...new Set(slots.map(s => s.q))];
  const res = rows.map(() => null), dirty = rows.map((_, q) => withSlots.includes(q));

  // Propagate: per-row order ↔ "one tile can't be in two places" ↔ (empty pool) "every unseen tile is somewhere"
  for (let it = 0; it < 60; it++) {
    const snapM = M.map(r => r.slice()), snapD = dm;
    let changed = false, broken = false;
    for (const q of withSlots) if (dirty[q]) {
      dirty[q] = false;
      const r = rowDP(M[q]);
      if (!r.total) { broken = true; break; }
      res[q] = r;
      r.marg.forEach((mg, i) => {
        let f = 0;
        for (const k of bitsOf(M[q][i])) if (mg[k] > 0) f |= 1 << k;
        if (f !== M[q][i]) { M[q][i] = f; changed = true; }
      });
    }
    if (!broken) {
      const strip = (mk, except) => {
        for (const o of slots) if (o !== except && (M[o.q][o.i] & mk)) { M[o.q][o.i] &= ~mk; dirty[o.q] = true; changed = true; }
        if (except !== "d" && (dm & mk)) { dm &= ~mk; changed = true; }
      };
      for (const s of slots) { const mk = M[s.q][s.i]; if (popCount(mk) === 1) strip(mk, s); }
      if (hasD && popCount(dm) === 1) strip(dm, "d");
      if (poolEmpty) for (const k of bitsOf(U)) {
        const b = 1 << k;
        let who = null, cnt = 0;
        for (const s of slots) if (M[s.q][s.i] & b) { cnt++; who = s; }
        if (hasD && (dm & b)) { cnt++; who = "d"; }
        if (cnt !== 1) continue;
        if (who === "d") { if (dm !== b) { dm = b; changed = true; } }
        else if (M[who.q][who.i] !== b) { M[who.q][who.i] = b; dirty[who.q] = true; changed = true; }
      }
      if (slots.some(s => !M[s.q][s.i]) || (hasD && !dm)) broken = true;
    }
    if (broken) {                                   // can't happen with consistent information; keep the last sound state
      snapM.forEach((r, q) => { M[q] = r; });
      dm = snapD;
      for (const q of withSlots) res[q] = rowDP(M[q]);
      break;
    }
    if (!changed && !withSlots.some(q => dirty[q])) break;
  }
  for (const q of withSlots) if (dirty[q] || !res[q]) res[q] = rowDP(M[q]);

  let marg = null, exact = false;
  if (opt.exact && withSlots.length) {
    marg = exactMarg(M, withSlots, res, opt.cap || 20000);
    exact = !!marg;
  }
  const tiles = rows.map(row => row.map(() => null));
  for (const s of slots) {
    const mask = M[s.q][s.i], ks = bitsOf(mask);
    const mg = marg ? marg.get(s.q)[s.i] : res[s.q].marg[s.i];
    let tot = 0;
    for (const k of ks) tot += mg[k];
    const p = {};
    for (const k of ks) p[numOf(k)] = tot ? mg[k] / tot : 1 / ks.length;
    tiles[s.q][s.i] = { nums: ks.map(numOf).sort((a, b) => a - b), p, size: ks.length };
  }
  return { tiles, drawn: hasD ? bitsOf(dm).map(numOf) : null, exact };
}

/* The quick estimate a casual player makes: unseen numbers of the right colour that fit between the nearest known
   neighbours (no chains of reasoning). Used by the easy AI. */
export function simpleNums(v, q, i) {
  const K = keyCount(v.jokers), row = v.rows[q], t = row[i];
  let seen = 0;
  for (const r of v.rows) for (const x of r) if (known(x)) seen |= 1 << keyOf(x.n, x.c);
  if (known(v.drawn)) seen |= 1 << keyOf(v.drawn.n, v.drawn.c);
  let lo = -1, hi = 24;
  for (let j = i - 1; j >= 0; j--) if (known(row[j]) && row[j].n < JOKER) { lo = keyOf(row[j].n, row[j].c); break; }
  for (let j = i + 1; j < row.length; j++) if (known(row[j]) && row[j].n < JOKER) { hi = keyOf(row[j].n, row[j].c); break; }
  const out = [];
  for (let k = 0; k < K; k++) {
    if (colOf(k) !== t.c || (seen & (1 << k)) || (t.no || []).includes(numOf(k))) continue;
    if (k < 24 && (k <= lo || k >= hi)) continue;
    out.push(numOf(k));
  }
  return out;
}
