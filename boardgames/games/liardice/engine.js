/* Liar's Dice (Perudo style). Everyone rolls their dice under a cup; players take turns raising a bid about ALL the dice on
   the table ("at least four 5s") or calling "Liar!" on the previous bid. On a call every die is revealed and whoever was wrong
   loses a die. Out of dice = out of the game; the last player with dice wins.
   Options: dice per player (5 / 3), ones are wild (Perudo bidding: half the quantity to switch to ones, double + 1 to leave them),
   and "Spot on" (claim the bid is exactly right: get a die back, or lose one).
   Hidden info: each seat sees only its own dice until the reveal; spectators (-1) see no dice at all until then. */
import { randInt } from "../../core/rng.js";
import { tx } from "../../core/i18n.js";

const name = tx("거짓말 주사위", "Liar's Dice");
const ord = n => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
const ON_OFF = [tx("켬", "On"), tx("끔", "Off")];
const OFF_ON = [tx("끔", "Off"), tx("켬", "On")];

/* ---------- Bid wording (shared with ui.js) ---------- */
// Korean subject particle after the Sino-Korean reading of the face (일이, 이가, 삼이, 사가, 오가, 육이)
const JO = ["", "이", "가", "이", "가", "가", "이"];
export const bidKo = (q, f) => `${f}${JO[f]} ${q}개`;
export const bidEn = (q, f) => `${q} × ${f}${q === 1 ? "" : "s"}`;
const bidTx = (q, f) => tx(bidKo(q, f), bidEn(q, f));

/* ---------- Bid rules and probabilities (shared with ui.js) ---------- */
/* Dice that count for face f (ones are wild for every other face when `wild`) */
export const hits = (dice, f, wild) => dice.reduce((a, d) => a + (d === f || (wild && f !== 1 && d === 1) ? 1 : 0), 0);
/* Chance that one unseen die counts for face f */
export const faceP = (f, wild) => (wild && f !== 1 ? 1 / 3 : 1 / 6);
/* The smallest legal quantity for face f after bid `last` (null = opening bid); 0 = no legal bid on this face.
   Ones wild (Perudo): to ones at least half the quantity rounded up, from ones back at least double + 1; no opening on ones. */
export function minQty(last, f, wild, total) {
  let q;
  if (!last) q = wild && f === 1 ? 0 : 1;
  else if (!wild) q = f > last.f ? last.q : last.q + 1;
  else if (last.f !== 1) q = f === 1 ? Math.ceil(last.q / 2) : f > last.f ? last.q : last.q + 1;
  else q = f === 1 ? last.q + 1 : 2 * last.q + 1;
  return q >= 1 && q <= total ? q : 0;
}
export function legalBid(last, q, f, wild, total) {
  if (!Number.isInteger(q) || !Number.isInteger(f) || f < 1 || f > 6 || q > total) return false;
  const m = minQty(last, f, wild, total);
  return m > 0 && q >= m;
}
/* A total order of bids that matches the rules above (ones at q sit between 2q and 2q + 1 of any other face) */
export const bidRank = (q, f, wild) => (wild && f === 1 ? 20 * q + 7 : 10 * q + f);
/* The smallest legal raise over `last` (or opening bid), or null */
export function smallestRaise(last, wild, total) {
  let best = null;
  for (let f = 1; f <= 6; f++) {
    const q = minQty(last, f, wild, total);
    if (q && (!best || bidRank(q, f, wild) < bidRank(best.q, best.f, wild))) best = { q, f };
  }
  return best;
}
/* Binomial distribution of n dice with chance r each: pmf[0..n] */
export function binom(n, r) {
  let d = [1];
  for (let i = 0; i < n; i++) {
    const e = new Array(d.length + 1).fill(0);
    for (let k = 0; k < d.length; k++) { e[k] += d[k] * (1 - r); e[k + 1] += d[k] * r; }
    d = e;
  }
  return d;
}
function conv(a, b) {
  const c = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) if (a[i]) for (let j = 0; j < b.length; j++) c[i + j] += a[i] * b[j];
  return c;
}
/* P(X ≥ k) and P(X = k) for a pmf */
export const atLeast = (pmf, k) => (k <= 0 ? 1 : pmf.slice(k).reduce((a, b) => a + b, 0));
export const exactly = (pmf, k) => (k < 0 || k >= pmf.length ? 0 : pmf[k]);
/* The chance a bid is true for someone who sees `mine` and `unknown` other dice (spectators: mine = []) */
export function chance(mine, unknown, q, f, wild) { return atLeast(binom(unknown, faceP(f, wild)), q - hits(mine, f, wild)); }
export function chanceExact(mine, unknown, q, f, wild) { return exactly(binom(unknown, faceP(f, wild)), q - hits(mine, f, wild)); }

/* ---------- State helpers ---------- */
const total = S => S.count.reduce((a, b) => a + b, 0);
const alive = S => S.count.map((c, p) => (c > 0 ? p : -1)).filter(p => p >= 0);
const lastBid = S => (S.bids.length ? S.bids[S.bids.length - 1] : null);
function nextAlive(S, p) {
  for (let k = 1; k <= S.n; k++) { const q = (p + k) % S.n; if (S.count[q] > 0) return q; }
  return -1;
}
function newRound(S, opener) {
  S.round++;
  S.bids = [];
  S.reveal = null;
  S.phase = "bid";
  S.dice = S.count.map(c => Array.from({ length: c }, () => 1 + randInt(S, 6)).sort((a, b) => a - b));
  S.opener = S.turn = opener;
  return [{ type: "round", round: S.round, opener, total: total(S),
    text: tx(`${S.round}판 — 모두 주사위를 굴렸습니다. {${opener}} 님부터`, `Round ${S.round} — everyone rolls. {${opener}} starts`) }];
}

/* ---------- AI ---------- */
/* How strongly another player's bids this round suggest they hold face f (hard AI) */
function support(S, o, f) {
  let w = 0;
  for (const b of S.bids) if (b.p === o) {
    if (b.f === f) w += b === S.bids[0] ? .55 : .45;       // an opening bid is usually on a face they hold
    else if (S.set.wild && b.f === 1 && f !== 1) w += .2;  // bidding ones hints at ones, which count for f too
  }
  return Math.min(.8, w);
}
/* Distribution of the count of face f among everyone else's dice, from p's point of view */
function othersDist(S, p, f, hard) {
  const r = faceP(f, S.set.wild);
  let dist = [1];
  for (const o of alive(S)) {
    if (o === p) continue;
    const c = S.count[o];
    let d = binom(c, r);
    if (hard) {
      const w = support(S, o, f);
      if (w > 0) {
        const d1 = binom(c - 1, r);
        d = d.map((x, i) => (1 - w) * x + w * (i > 0 ? d1[i - 1] : 0));   // with chance w they hold at least one
      }
    }
    dist = conv(dist, d);
  }
  return dist;
}
function aiAction(S, p, level, rng) {
  const wild = S.set.wild, T = total(S), last = lastBid(S), own = S.dice[p];
  const hard = level === "hard";
  const cache = {};
  const dist = f => cache[f] || (cache[f] = othersDist(S, p, f, hard));
  const P = (q, f) => atLeast(dist(f), q - hits(own, f, wild));
  const PE = (q, f) => exactly(dist(f), q - hits(own, f, wild));
  const faces = [1, 2, 3, 4, 5, 6].filter(f => minQty(last, f, wild, T));
  const liar = { t: "liar" };

  if (level === "easy") {
    // Naive: rough averages instead of odds, bids on faces it holds, challenges somewhat at random
    if (last) {
      const naive = hits(own, last.f, wild) + (T - own.length) * faceP(last.f, wild);
      const callP = last.q > naive + 1.5 ? .6 : last.q > naive + .5 ? .3 : .07;
      if (!faces.length || rng() < callP) return S.set.spot && rng() < .15 ? { t: "spot" } : liar;
    }
    const held = faces.filter(f => own.includes(f));
    const f = held.length && rng() < .8 ? held[Math.floor(rng() * held.length)] : faces[Math.floor(rng() * faces.length)];
    const m = minQty(last, f, wild, T);
    // A raise that is obviously too high scares it into calling instead (half the time)
    if (last && m > hits(own, f, wild) + (T - own.length) * faceP(f, wild) + 2 && rng() < .5) return liar;
    return { t: "bid", f, q: Math.min(T, m + (rng() < .3 ? 1 : 0)) };
  }

  if (!last) {
    // Opening: the face that supports the highest quantity at a comfortable chance (a bluff now and then)
    const theta = hard ? .62 : .68;
    let best = null;
    for (const f of faces) {
      let q = 1;
      while (q < T && P(q + 1, f) >= theta) q++;
      const s = q + hits(own, f, wild) * .01 + f * .001;
      if (!best || s > best.s) best = { q, f, s };
    }
    let { q, f } = best;
    if (rng() < (hard ? .1 : .14)) {
      const alt = faces.filter(x => x !== f);
      f = alt[Math.floor(rng() * alt.length)];
      q = 1;
      while (q < T && P(q + 1, f) >= .4) q++;
    }
    // Open a little below what the dice support — it leaves room to raise and keeps the opener out of the line of fire
    q -= hard ? (rng() < .5 ? 1 : 0) : Math.floor(rng() * 3);
    return { t: "bid", q: Math.max(1, q), f };
  }

  const pl = P(last.q, last.f);
  // Candidate raises: each face's smallest legal quantity (and one more)
  const cands = [];
  for (const f of faces) {
    const m = minQty(last, f, wild, T);
    for (let q = m; q <= Math.min(T, m + 1); q++) cands.push({ q, f, p: P(q, f), r: bidRank(q, f, wild) });
  }
  cands.sort((a, b) => b.p - a.p || a.r - b.r);
  const best = cands[0] || null;
  const risk = best ? 1 - best.p : 1;               // chance my raise is false if someone calls it
  if (S.set.spot) {
    const pe = PE(last.q, last.f);
    const gain = S.count[p] < S.set.dice ? .05 : 0;
    if (pe > .3 && 1 - pe + (hard ? -gain : .05) < Math.min(pl, risk)) return { t: "spot" };
  }
  if (!best) return liar;
  const noise = hard ? (rng() - .5) * .06 : (rng() - .5) * .18;
  // A raise might not be challenged at all, so calling needs to be clearly safer than raising
  const k = hard ? (S.count[p] === 1 ? .95 : .85) : .9;
  if (pl + noise < risk * k || pl < (hard ? .08 : .12)) return liar;
  let pickB = best;
  if (rng() < (hard ? .08 : .12)) {
    const alt = cands.filter(c => c !== best && c.p >= (hard ? .45 : .35));
    if (alt.length) pickB = alt[Math.floor(rng() * alt.length)];
  } else if (hard) {
    // Among near-equal raises, prefer the smallest step (keeps the bid low for the next player)
    const near = cands.filter(c => c.p >= best.p - .04);
    near.sort((a, b) => a.r - b.r);
    pickB = near[0];
  }
  return { t: "bid", q: pickB.q, f: pickB.f };
}

export default {
  id: "liardice",
  name,
  icon: "🤥",
  blurb: tx("컵 속 주사위로 허풍 대결! 입찰을 올리거나 \"거짓말!\"을 외치세요",
    "Bluff with dice under your cup! Raise the bid or call \"Liar!\""),
  players: { min: 2, max: 6, default: 4 },
  spectate: true,
  settings: [
    { key: "dice", label: tx("주사위 개수", "Dice each"), values: [5, 3], labels: [tx("5개", "5 dice"), tx("3개", "3 dice")], default: 5,
      note: tx("3개는 짧은 게임", "3 dice = a shorter game") },
    { key: "wild", label: tx("1은 와일드", "Ones are wild"), values: [true, false], labels: ON_OFF, default: true,
      note: tx("1은 어떤 눈으로도 셉니다 (1로 입찰할 땐 절반)", "Ones count as any face (bids on ones need half the quantity)") },
    { key: "spot", label: tx("정확히!", "Spot on"), values: [false, true], labels: OFF_ON, default: false,
      note: tx("입찰이 딱 맞다고 외치기 — 맞으면 주사위 +1, 틀리면 -1", "Claim the bid is exactly right — right: +1 die, wrong: −1") }
  ],
  rules: tx(`<ul>
    <li>모두 주사위 <b>5개</b>(설정에 따라 3개)를 컵 속에 숨겨 굴립니다. 내 주사위만 보입니다.</li>
    <li>시작하는 사람부터 돌아가며 <b>입찰</b>합니다 — "탁자 위 <b>모든</b> 주사위 중에 <b>5가 4개</b> 이상 있다".
      다음 사람은 입찰을 <b>올리거나</b> (개수를 더 많이, 또는 같은 개수에 더 높은 눈) 직전 입찰에 <b>"거짓말!"</b>을 외칩니다.
      입찰 개수는 탁자 위 주사위 수를 넘을 수 없습니다.</li>
    <li>"거짓말!"이 나오면 모든 주사위를 공개해 셉니다. 그만큼 <b>있으면</b> 외친 사람이, <b>모자라면</b> 입찰한 사람이 주사위 하나를 잃습니다.</li>
    <li>주사위를 잃은 사람이 다음 판을 시작합니다 (탈락했으면 그다음 사람). 주사위가 하나도 없으면 탈락하고,
      <b>마지막까지 주사위가 남은 사람</b>이 이깁니다. 나머지 순위는 늦게 탈락한 순서입니다.</li>
    <li><b>1은 와일드</b> (기본 켬): 1은 다른 어떤 눈으로도 셉니다. 1에 대한 입찰은 1만 셉니다.
      첫 입찰은 1로 할 수 없습니다. 1로 바꿀 때는 개수의 <b>절반(올림) 이상</b>, 1에서 다른 눈으로 돌아갈 때는 <b>두 배 + 1 이상</b>
      (예: 5가 7개 → 1이 4개 → 3이 9개). 끄면 1은 가장 낮은 평범한 눈입니다.</li>
    <li><b>정확히!</b> (기본 끔): 내 차례에 "거짓말!" 대신 직전 입찰이 <b>딱 맞다</b>고 외칠 수 있습니다.
      정확히 맞으면 주사위 하나를 되찾고 (처음 개수까지) 다음 판을 시작합니다. 틀리면 외친 사람이 하나를 잃습니다.</li>
    <li>우리 규칙: 팔리피코(주사위 1개 남은 사람의 특별 판)는 없습니다.</li>
  </ul>`, `<ul>
    <li>Everyone rolls <b>5 dice</b> (3 with the setting) hidden under a cup. You only see your own.</li>
    <li>Starting with the opener, players take turns <b>bidding</b> about <b>all</b> the dice on the table — "there are at least
      <b>four 5s</b>". The next player either <b>raises</b> (a higher quantity, or the same quantity of a higher face) or calls
      <b>"Liar!"</b> on the previous bid. A bid can't exceed the number of dice on the table.</li>
    <li>On "Liar!" every die is revealed and counted. If the bid <b>holds</b>, the caller loses a die; if it <b>falls short</b>,
      the bidder does.</li>
    <li>Whoever lost a die opens the next round (the next player if they're out). With no dice left you're out —
      <b>the last player with dice wins</b>. The others are ranked by how long they lasted.</li>
    <li><b>Ones are wild</b> (on by default): ones count as any other face. A bid on ones counts only ones. You can't open on ones.
      Switching to ones needs at least <b>half the quantity (rounded up)</b>; switching back from ones needs at least
      <b>double + 1</b> (e.g. seven 5s → four 1s → nine 3s). Turned off, ones are just the lowest face.</li>
    <li><b>Spot on</b> (off by default): on your turn, instead of "Liar!" you may claim the previous bid is <b>exactly</b> right.
      If it is, you get a die back (up to the starting number) and open the next round; if not, you lose a die.</li>
    <li>House rule: no Palifico (the special round for a player down to one die).</li>
  </ul>`),

  setup({ n, seed, settings = {} }) {
    const pickSet = (k, vals, d) => (vals.includes(settings[k]) ? settings[k] : d);
    const set = { dice: pickSet("dice", [5, 3], 5), wild: pickSet("wild", [true, false], true), spot: pickSet("spot", [false, true], false) };
    const S = { n, rs: seed >>> 0, set, count: Array(n).fill(set.dice), dice: [], out: [], phase: "bid", round: 0, turn: 0, opener: 0,
      bids: [], reveal: null, prev: null, next: 0, ended: false, winner: -1, lost: 0, gained: 0 };
    newRound(S, randInt(S, n));
    return S;
  },

  pending(S) { return S.phase === "bid" ? [{ p: S.turn, kind: "bid" }] : []; },

  validate(S, p, a) {
    if (S.phase !== "bid" || p !== S.turn) return tx("지금은 내 차례가 아닙니다", "It's not your turn");
    if (!a || typeof a !== "object") return tx("입찰하거나 \"거짓말!\"을 외치세요", "Bid or call \"Liar!\"");
    const last = lastBid(S);
    if (a.t === "bid") {
      if (!legalBid(last, a.q, a.f, S.set.wild, total(S))) {
        if (!last && S.set.wild && a.f === 1) return tx("첫 입찰은 1로 할 수 없습니다", "You can't open on ones");
        if (Number.isInteger(a.q) && a.q > total(S)) return tx("탁자 위 주사위보다 많이 부를 수 없습니다", "You can't bid more dice than are on the table");
        return tx("직전 입찰보다 높게 불러야 합니다", "Your bid must beat the previous one");
      }
      return true;
    }
    if (a.t === "liar" || a.t === "spot") {
      if (!last) return tx("아직 입찰이 없습니다 — 먼저 입찰하세요", "No bid yet — make the opening bid");
      if (a.t === "spot" && !S.set.spot) return tx("이 방에서는 \"정확히!\"를 쓰지 않습니다", "\"Spot on\" isn't used in this room");
      return true;
    }
    return tx("입찰하거나 \"거짓말!\"을 외치세요", "Bid or call \"Liar!\"");
  },

  apply(S, p, a) {
    if (a.t === "bid") {
      S.bids.push({ p, q: a.q, f: a.f });
      S.turn = nextAlive(S, p);
      return [{ type: "bid", p, q: a.q, f: a.f, text: tx(`{${p}} 님: ${bidKo(a.q, a.f)}`, `{${p}}: ${bidEn(a.q, a.f)}`) }];
    }
    // "Liar!" or "Spot on!": reveal everything and settle
    const last = lastBid(S), wild = S.set.wild;
    const count = S.dice.reduce((x, d) => x + hits(d, last.f, wild), 0);
    const R = { kind: a.t, caller: p, bidder: last.p, q: last.q, f: last.f, count, wild, dice: S.dice.map(d => d.slice()),
      loser: -1, gainer: -1, exact: false, out: -1 };
    if (a.t === "liar") R.loser = count >= last.q ? p : last.p;
    else {
      R.exact = count === last.q;
      if (!R.exact) R.loser = p;
      else if (S.count[p] < S.set.dice) R.gainer = p;
    }
    const ev = [{ type: "call", kind: a.t, p, bidder: last.p, q: last.q, f: last.f,
      text: a.t === "liar" ? tx(`{${p}} 님: "거짓말!" (${bidKo(last.q, last.f)})`, `{${p}}: "Liar!" (${bidEn(last.q, last.f)})`)
        : tx(`{${p}} 님: "정확히!" (${bidKo(last.q, last.f)})`, `{${p}}: "Spot on!" (${bidEn(last.q, last.f)})`) }];
    const what = tx(`${last.f}${JO[last.f]} ${count}개`, `${count} × ${last.f}${count === 1 ? "" : "s"}`);
    let text;
    if (R.loser >= 0) {
      S.count[R.loser]--; S.lost++;
      text = a.t === "spot" ? tx(`실제로는 ${what.ko} — 딱 맞지 않았습니다. {${p}} 님 주사위 -1`, `Actually ${what.en} — not exact. {${p}} loses a die`)
        : R.loser === p ? tx(`실제로 ${what.ko} — 입찰이 맞았습니다! {${p}} 님 주사위 -1`, `There were ${what.en} — the bid held! {${p}} loses a die`)
        : tx(`실제로는 ${what.ko} — 허풍이었습니다! {${last.p}} 님 주사위 -1`, `Only ${what.en} — a bluff! {${last.p}} loses a die`);
    } else if (R.gainer >= 0) {
      S.count[p]++; S.gained++;
      text = tx(`딱 ${what.ko}! {${p}} 님 주사위 하나를 되찾았습니다`, `Exactly ${what.en}! {${p}} gets a die back`);
    } else text = tx(`딱 ${what.ko}! (주사위가 이미 가득이라 그대로)`, `Exactly ${what.en}! (already at full dice)`);
    ev.push({ type: "result", loser: R.loser, gainer: R.gainer, exact: R.exact, count, text });
    if (R.loser >= 0 && S.count[R.loser] === 0) {
      S.out.push(R.loser); R.out = R.loser;
      const place = S.n - S.out.length + 1;
      ev.push({ type: "out", p: R.loser, place, text: tx(`{${R.loser}} 님 탈락 — 주사위가 없습니다 (${place}등)`, `{${R.loser}} is out of dice (${ord(place)})`) });
    }
    S.prev = { kind: R.kind, caller: p, bidder: last.p, q: last.q, f: last.f, count, loser: R.loser, gainer: R.gainer, exact: R.exact };
    S.next = R.exact ? p : S.count[R.loser] > 0 ? R.loser : nextAlive(S, R.loser);
    S.reveal = R;
    S.phase = "reveal";
    const left = alive(S);
    if (left.length <= 1) { S.ended = true; S.winner = left.length ? left[0] : -1; }
    return ev;
  },

  /* After the reveal: next round, or the end of the game (the final reveal stays on screen) */
  step(S) {
    if (S.phase !== "reveal") return [];
    if (S.ended) {
      S.phase = "over";
      return [{ type: "over", winner: S.winner, text: S.winner >= 0 ? tx(`{${S.winner}} 님 승리! 🎉`, `{${S.winner}} wins! 🎉`) : tx("게임 끝", "Game over") }];
    }
    return newRound(S, S.next);
  },
  /* Time to watch the reveal animation (more dice take longer to count) */
  delay(S) {
    if (S.phase !== "reveal" || !S.reveal) return 900;
    const n = S.reveal.dice.reduce((a, d) => a + d.length, 0);
    return 4600 + Math.min(1200, n * 40);
  },

  timeout(S, p) {
    const wild = S.set.wild, T = total(S), last = lastBid(S), own = S.dice[p];
    const unk = T - own.length;
    if (!last) {
      // Opening: one of my most common faces (never ones when they're wild), quantity 1
      let f = wild ? 2 : 1;
      for (let x = 1; x <= 6; x++) if (!(wild && x === 1) && hits(own, x, wild) > hits(own, f, wild)) f = x;
      return { t: "bid", q: 1, f };
    }
    const r = smallestRaise(last, wild, T);
    if (!r) return { t: "liar" };
    const pr = chance(own, unk, r.q, r.f, wild), pl = chance(own, unk, last.q, last.f, wild);
    return pr >= .5 || pl >= .5 ? { t: "bid", q: r.q, f: r.f } : { t: "liar" };
  },
  ai(S, p, { level = "normal", rng = Math.random } = {}) { return aiAction(S, p, level, rng); },
  thinkTime(S, p) { return 900 + Math.random() * 900 + (S.bids.length > 3 ? 300 : 0); },

  view(S, p) {
    const T = total(S);
    const R = S.reveal && S.phase !== "bid" ? S.reveal : null;
    let mine = [];
    if (p >= 0) mine = (R ? R.dice[p] : S.dice[p]).slice();
    let status = "";
    const last = lastBid(S);
    if (S.phase === "over") status = S.winner >= 0 ? tx(`{${S.winner}} 님 승리!`, `{${S.winner}} wins!`) : tx("게임 끝", "Game over");
    else if (S.phase === "reveal") status = R.kind === "spot" ? tx("\"정확히!\" — 모두 공개", "\"Spot on!\" — reveal") : tx("\"거짓말!\" — 모두 공개", "\"Liar!\" — reveal");
    else if (p === S.turn) status = last ? tx(`내 차례 — ${bidKo(last.q, last.f)}보다 높게, 또는 "거짓말!"`, `Your turn — beat ${bidEn(last.q, last.f)} or call "Liar!"`)
      : tx("내 차례 — 첫 입찰을 하세요", "Your turn — make the opening bid");
    else status = last ? tx(`{${S.turn}} 님 차례 · 현재 ${bidKo(last.q, last.f)}`, `{${S.turn}}'s turn · bid: ${bidEn(last.q, last.f)}`)
      : tx(`{${S.turn}} 님이 첫 입찰 중`, `{${S.turn}} is opening`);
    return {
      phase: S.phase, round: S.round, turn: S.phase === "bid" ? S.turn : -1, opener: S.opener,
      start: S.set.dice, wild: S.set.wild, spot: S.set.spot,
      counts: S.count.slice(), total: T, out: S.out.slice(), winner: S.winner,
      bids: S.bids.map(b => ({ p: b.p, q: b.q, f: b.f })),
      mine,
      reveal: R ? { kind: R.kind, caller: R.caller, bidder: R.bidder, q: R.q, f: R.f, count: R.count, wild: R.wild,
        all: R.dice.map(d => d.slice()), loser: R.loser, gainer: R.gainer, exact: R.exact, out: R.out } : null,
      prev: S.prev ? { ...S.prev } : null,
      status
    };
  },

  over(S) { return S.phase === "over"; },
  results(S) {
    const res = [];
    if (S.winner >= 0) res.push({ p: S.winner, rank: 1,
      note: tx(`주사위 ${S.count[S.winner]}개 남기고 승리`, `Won with ${S.count[S.winner]} ${S.count[S.winner] === 1 ? "die" : "dice"} left`) });
    S.out.forEach((p, i) => res.push({ p, rank: S.n - i, note: tx(`${i + 1}번째 탈락`, `Out ${ord(i + 1)}`) }));
    // Safety net: any seat not listed (cannot happen in a finished game) shares the last rank
    for (let p = 0; p < S.n; p++) if (!res.some(r => r.p === p)) res.push({ p, rank: S.n });
    return res;
  },

  /* For tests: any legal action */
  randomAction(S, p, rng) {
    const wild = S.set.wild, T = total(S), last = lastBid(S);
    if (last && rng() < .25) return S.set.spot && rng() < .3 ? { t: "spot" } : { t: "liar" };
    const faces = [1, 2, 3, 4, 5, 6].filter(f => minQty(last, f, wild, T));
    if (!faces.length) return { t: "liar" };
    const f = faces[Math.floor(rng() * faces.length)];
    const m = minQty(last, f, wild, T);
    return { t: "bid", f, q: Math.min(T, m + Math.floor(rng() * 3)) };
  },
  /* Hidden info: while bidding, no die of anyone else — and none at all for spectators — may be in the view */
  leak(S, p, v) {
    const json = JSON.stringify(v);
    if (/"rs"/.test(json)) return "the random state is in the view";
    if (S.phase === "bid") {
      if (v.reveal) return "reveal shown while bidding";
      const want = p >= 0 ? S.dice[p] : [];
      if (JSON.stringify(v.mine) !== JSON.stringify(want)) return "view.mine is not exactly my own dice";
      if (/"(dice|all)"/.test(json)) return "a dice list is in the bidding view";
    } else if (!v.reveal) return "the reveal is missing after a call";
    return true;
  },
  check(S) {
    const start = S.set.dice;
    if (S.count.length !== S.n) return "count length";
    for (let p = 0; p < S.n; p++) {
      const c = S.count[p];
      if (!Number.isInteger(c) || c < 0 || c > start) return `seat ${p} has ${c} dice`;
      if ((c === 0) !== S.out.includes(p)) return `seat ${p}: out list doesn't match the dice count`;
    }
    if (new Set(S.out).size !== S.out.length) return "a seat is out twice";
    if (total(S) !== S.n * start - S.lost + S.gained) return "dice are not conserved";
    if (S.phase === "bid") {
      for (let p = 0; p < S.n; p++) {
        if (S.dice[p].length !== S.count[p]) return `seat ${p} rolled the wrong number of dice`;
        if (S.dice[p].some(d => !Number.isInteger(d) || d < 1 || d > 6)) return "a die shows an impossible face";
      }
      if (S.count[S.turn] <= 0) return "the player to act has no dice";
      if (alive(S).length < 2) return "bidding with fewer than two players";
      const T = total(S);
      for (let i = 0; i < S.bids.length; i++) {
        const b = S.bids[i];
        if (!legalBid(i ? S.bids[i - 1] : null, b.q, b.f, S.set.wild, T)) return `illegal bid in the history: ${JSON.stringify(b)}`;
      }
    } else {
      if (!S.reveal) return "no reveal after a call";
      if (S.phase === "over" && (S.winner < 0 || S.count[S.winner] <= 0 || alive(S).length !== 1)) return "the winner doesn't hold the last dice";
    }
    return true;
  }
};
