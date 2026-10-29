/* Yacht Dice — the classic dice game (12 categories, as in the popular Clubhouse Games version).
   Each turn: roll 5 dice up to 3 times, holding any dice between rolls, then fill exactly one empty category (0 is allowed).
   12 rounds; upper section (Aces–Sixes) total ≥ 63 earns +35. Highest total wins; ties share a rank.

   Actions: {roll: true, hold: [bool × 5]}  — hold mask applied before rolling (ignored on the first roll of a turn)
            {score: "full"}                 — fill a category (after at least one roll)
   Everything is public, except the RNG state (S.rs), which would let a viewer predict the dice.

   Named exports (CATS, scoreDice, tally, evaluator, …) are shared with ui.js so the screen can show potential scores
   and the AI's recommendation with exactly the engine's rules. */
import { randInt } from "../../core/rng.js";
import { tx } from "../../core/i18n.js";

export const ROUNDS = 12;
export const BONUS_AT = 63, BONUS = 35;
export const CATS = ["ones", "twos", "threes", "fours", "fives", "sixes", "choice", "four", "full", "small", "large", "yacht"];
export const CAT_NAME = [
  tx("에이스", "Aces"), tx("듀스", "Twos"), tx("트리플", "Threes"), tx("쿼드", "Fours"), tx("파이브", "Fives"), tx("식스", "Sixes"),
  tx("초이스", "Choice"), tx("포카드", "Four of a Kind"), tx("풀하우스", "Full House"),
  tx("스몰 스트레이트", "Small Straight"), tx("라지 스트레이트", "Large Straight"), tx("요트", "Yacht")
];
const NC = CATS.length;

/* ---------- Scoring ---------- */
function countsOf(dice) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return c;
}
function scoreCounts(cat, c) {
  let sum = 0, max = 0;
  for (let f = 1; f <= 6; f++) { sum += c[f] * f; if (c[f] > max) max = c[f]; }
  if (cat < 6) return c[cat + 1] * (cat + 1);
  switch (cat) {
    case 6: return sum;
    case 7: return max >= 4 ? sum : 0;
    case 8: return max === 5 || (max === 3 && c.includes(2)) ? sum : 0;
    case 9: return (c[1] && c[2] && c[3] && c[4]) || (c[2] && c[3] && c[4] && c[5]) || (c[3] && c[4] && c[5] && c[6]) ? 15 : 0;
    case 10: return c[2] && c[3] && c[4] && c[5] && (c[1] || c[6]) ? 30 : 0;
    case 11: return max === 5 ? 50 : 0;
  }
  return 0;
}
/* Score of a category (index or id) for five dice */
export function scoreDice(cat, dice) {
  const k = typeof cat === "string" ? CATS.indexOf(cat) : cat;
  return scoreCounts(k, countsOf(dice));
}
/* A score sheet is an array of 12 (number | null) in CATS order */
export function tally(sheet) {
  let upper = 0, lower = 0, upOpen = 0;
  for (let c = 0; c < NC; c++) {
    const v = sheet[c];
    if (c < 6) { if (v === null) upOpen += 5 * (c + 1); else upper += v; }
    else if (v !== null) lower += v;
  }
  const bonus = upper >= BONUS_AT ? BONUS : 0;
  return { upper, lower, bonus, total: upper + lower + bonus, need: Math.max(0, BONUS_AT - upper),
    canBonus: upper + upOpen >= BONUS_AT,                                  // still reachable (or already earned)
    pace: sheet.slice(0, 6).reduce((a, v, c) => a + (v === null ? 0 : v - 3 * (c + 1)), 0) };   // vs. three of each face
}

/* ---------- Dice multisets (for the AI and the screen's recommendations) ----------
   A multiset of dice is a count vector; key = Σ count[f] · 6^(f-1) (counts ≤ 5), so keys simply add up. */
const POW = [0, 1, 6, 36, 216, 1296, 7776];
const keyOf = c => c[1] + 6 * c[2] + 36 * c[3] + 216 * c[4] + 1296 * c[5] + 7776 * c[6];
const FACT = [1, 1, 2, 6, 24, 120];
const MS = [[], [], [], [], [], []];                  // MS[k]: every multiset of k dice {c, key, p (chance of rolling it)}
for (let k = 0; k <= 5; k++) (function gen(f, left, c) {
  if (f > 6) {
    if (left) return;
    let w = FACT[k];
    for (let i = 1; i <= 6; i++) w /= FACT[c[i]];
    MS[k].push({ c: c.slice(), key: keyOf(c), p: w / Math.pow(6, k) });
    return;
  }
  for (let x = 0; x <= left; x++) { c[f] = x; gen(f + 1, left - x, c); }
  c[f] = 0;
})(1, k, [0, 0, 0, 0, 0, 0, 0]);
const STATES = MS[5];                                  // 252 possible results of five dice
const SIDX = new Int16Array(46656).fill(-1);
STATES.forEach((s, i) => { SIDX[s.key] = i; });
const KEEPS = [].concat(...MS);                        // 462 multisets of 0–5 dice that can be kept
const KIDX = new Int16Array(46656).fill(-1);
KEEPS.forEach((k, i) => { KIDX[k.key] = i; k.size = k.c.reduce((a, b) => a + b, 0); });
/* For every keep: the states it can become, with their chances */
const NEXT = KEEPS.map(k => MS[5 - k.size].map(o => [SIDX[k.key + o.key], o.p]));
/* For every state: the keeps it allows (each sub-multiset once) */
const SUBS = STATES.map(s => {
  const out = [];
  (function rec(f, key) {
    if (f > 6) { out.push(KIDX[key]); return; }
    for (let x = 0; x <= s.c[f]; x++) rec(f + 1, key + x * POW[f]);
  })(1, 0);
  return out;
});
const SCORE = Array.from({ length: NC }, (_, cat) => STATES.map(s => scoreCounts(cat, s.c)));
export const stateOf = dice => SIDX[keyOf(countsOf(dice))];

/* ---------- Valuing a placement ----------
   value(cat, state) = points now − what the category is worth if kept open (its "par") + 35 × chance of the upper bonus after it.
   Pars move from a whole-game average (many turns left to fill it) to the single-turn expectation (no flexibility left). */
const PAR_GAME = [3.4, 5.0, 8.2, 11.6, 15.0, 15.5, 26, 13.5, 15.5, 13.5, 23, 16];   // tuned by self-play
const PAR_TURN = [2.1, 2.7, 6.3, 8.4, 10.5, 12.6, 20.3, 5.8, 6.5, 9.2, 8.0, 2.3];
function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
export function evaluator(sheet) {
  const open = [];
  for (let c = 0; c < NC; c++) if (sheet[c] === null) open.push(c);
  const w = Math.max(0, (open.length - 1) / (NC - 1));
  const par = PAR_GAME.map((g, c) => PAR_TURN[c] + (g - PAR_TURN[c]) * w);
  let U = 0;
  for (let c = 0; c < 6; c++) if (sheet[c] !== null) U += sheet[c];
  const ups = open.filter(c => c < 6);
  const pBonus = (u, list) => {
    if (u >= BONUS_AT) return 1;
    let m = 0, v = 0, mx = 0;
    for (const c of list) { m += par[c]; v += (c + 1) * (c + 1); mx += 5 * (c + 1); }
    if (u + mx < BONUS_AT) return 0;
    return phi((u + m - (BONUS_AT - .5)) / Math.sqrt(v));
  };
  const base = BONUS * pBonus(U, ups);
  const after = [];
  for (const c of ups) {
    const rest = ups.filter(x => x !== c);
    after[c] = [0, 1, 2, 3, 4, 5].map(k => BONUS * pBonus(U + k * (c + 1), rest));
  }
  const value = (c, s) => {
    const sc = SCORE[c][s];
    return sc - par[c] + (c < 6 ? after[c][sc / (c + 1)] : base);
  };
  return { open, par, value };
}

/* Best category to fill now for dice in state s → {cat, val} */
function bestCat(E, s) {
  let cat = -1, val = -Infinity;
  for (const c of E.open) { const v = E.value(c, s); if (v > val) { val = v; cat = c; } }
  return { cat, val };
}
/* Expected value of each keep when the next roll is followed by `then[state]` */
function keepValues(then) {
  const K = new Float64Array(KEEPS.length);
  for (let k = 0; k < KEEPS.length; k++) {
    let e = 0;
    for (const [s, p] of NEXT[k]) e += p * then[s];
    K[k] = e;
  }
  return K;
}
/* Plan for the current dice: score now or keep some dice and roll again (depth = rolls looked ahead) */
function plan(sheet, dice, rollsLeft, depth) {
  const E = evaluator(sheet), s0 = stateOf(dice);
  const V0 = new Float64Array(STATES.length);
  for (let s = 0; s < STATES.length; s++) V0[s] = bestCat(E, s).val;
  const now = bestCat(E, s0);
  if (!rollsLeft) return { score: now.cat };
  let then = V0;
  if (depth >= 2 && rollsLeft >= 2) {                  // the roll after next: best of scoring or keeping again
    const K1 = keepValues(V0), V1 = new Float64Array(STATES.length);
    for (let s = 0; s < STATES.length; s++) {
      let b = V0[s];
      for (const k of SUBS[s]) if (K1[k] > b) b = K1[k];
      V1[s] = b;
    }
    then = V1;
  }
  let best = -1, bv = -Infinity;
  const full = KIDX[STATES[s0].key];
  for (const k of SUBS[s0]) {
    if (k === full) continue;                          // keeping all five = scoring now
    let e = 0;
    for (const [s, p] of NEXT[k]) e += p * then[s];
    if (e > bv) { bv = e; best = k; }
  }
  if (best < 0 || now.val >= bv - 1e-9) return { score: now.cat };
  return { keep: KEEPS[best].c };
}
/* Hold mask for the actual dice that keeps the counts `keep` */
function maskFor(dice, keep) {
  const left = keep.slice();
  return dice.map(d => (left[d] > 0 ? (left[d]--, true) : false));
}

/* ---------- Game ---------- */
const nameOf = c => CAT_NAME[c];
const curP = S => (S.first + S.turnNo) % S.n;
const roundOf = S => Math.min(ROUNDS, Math.floor(S.turnNo / S.n) + 1);
const NO_HOLD = [false, false, false, false, false];
function results(S) {
  const T = S.sheets.map(tally);
  return T.map((t, p) => ({ p, rank: 1 + T.filter(o => o.total > t.total).length, score: t.total,
    note: tx(`상단 ${t.upper}${t.bonus ? " +35" : ""} · 하단 ${t.lower}` + (S.sheets[p][11] === 50 ? " · 요트!" : ""),
      `Upper ${t.upper}${t.bonus ? " +35" : ""} · Lower ${t.lower}` + (S.sheets[p][11] === 50 ? " · Yacht!" : "")) }));
}

export default {
  id: "yacht",
  name: tx("요트 다이스", "Yacht Dice"),
  icon: "🎲",
  blurb: tx("주사위 5개를 세 번까지 굴려 족보를 채우는 주사위 게임. 혼자서 최고 기록 도전도 OK!",
    "Roll five dice up to three times and fill the score sheet. Play solo for a high score too!"),
  players: { min: 1, max: 8, default: 4 },
  settings: [],
  spectate: true,
  rules: tx(`<ul>
    <li><b>12 라운드</b>. 내 차례에 주사위 5개를 <b>최대 3번</b> 굴립니다. 굴린 뒤 원하는 주사위를 눌러 <b>고정</b>하고 나머지만 다시 굴릴 수 있어요.</li>
    <li>굴린 뒤에는 언제든 점수표의 <b>빈 칸 하나</b>를 골라 기록합니다 (0점도 가능). 칸은 한 번씩만 쓸 수 있어요.</li>
    <li>가장 높은 총점이 이깁니다. 동점이면 같은 순위입니다.</li>
  </ul>
  <h4>점수표</h4>
  <ul>
    <li><b>에이스 · 듀스 · 트리플 · 쿼드 · 파이브 · 식스</b>: 그 눈이 나온 주사위의 합 (예: 4 4 4 2 1 → 쿼드 12)</li>
    <li><b>보너스</b>: 위 여섯 칸의 합이 <b>63 이상</b>이면 +35 (각 눈 3개씩이면 딱 63)</li>
    <li><b>초이스</b>: 주사위 5개의 합</li>
    <li><b>포카드</b>: 같은 눈 4개 이상이면 주사위 5개의 합</li>
    <li><b>풀하우스</b>: 같은 눈 3개 + 2개면 주사위 5개의 합 (5개가 모두 같아도 인정)</li>
    <li><b>스몰 스트레이트</b>: 4개 연속 (1-2-3-4, 2-3-4-5, 3-4-5-6) → 15점</li>
    <li><b>라지 스트레이트</b>: 5개 연속 (1-2-3-4-5, 2-3-4-5-6) → 30점</li>
    <li><b>요트</b>: 5개가 모두 같은 눈 → 50점</li>
  </ul>
  <p>화면이 계산을 대신해 줍니다: 빈 칸마다 지금 주사위로 받을 점수가 보이고, 추천 칸은 ★ 로 표시돼요. 플레이어를 누르면 전체 점수표가 열립니다.
  혼자 하면 최고 기록 도전 모드입니다.</p>`, `<ul>
    <li><b>12 rounds</b>. On your turn roll five dice <b>up to 3 times</b>. After a roll, tap dice to <b>hold</b> them and roll only the rest.</li>
    <li>After any roll, fill <b>one empty category</b> on your sheet (a score of 0 is allowed). Each category is used once.</li>
    <li>Highest total wins. Ties share a rank.</li>
  </ul>
  <h4>Score sheet</h4>
  <ul>
    <li><b>Aces · Twos · Threes · Fours · Fives · Sixes</b>: the sum of the dice showing that face (e.g. 4 4 4 2 1 → Fours 12)</li>
    <li><b>Bonus</b>: +35 when those six add up to <b>63 or more</b> (three of each face is exactly 63)</li>
    <li><b>Choice</b>: the sum of all five dice</li>
    <li><b>Four of a Kind</b>: at least four alike → the sum of all five dice</li>
    <li><b>Full House</b>: three alike + two alike → the sum of all five dice (five alike counts too)</li>
    <li><b>Small Straight</b>: four in a row (1-2-3-4, 2-3-4-5, 3-4-5-6) → 15</li>
    <li><b>Large Straight</b>: five in a row (1-2-3-4-5, 2-3-4-5-6) → 30</li>
    <li><b>Yacht</b>: all five alike → 50</li>
  </ul>
  <p>The screen does the math: every empty category shows what the current dice would score, and the suggested one has a ★.
  Tap a player to see the full score sheet. Playing alone is a high-score challenge.</p>`),

  setup({ n, seed }) {
    const S = { n, rs: seed >>> 0, first: 0, turnNo: 0, dice: null, rolls: 0, held: NO_HOLD.slice(),
      sheets: Array.from({ length: n }, () => Array(NC).fill(null)), last: Array(n).fill(null), prev: null, phase: "play" };
    S.first = randInt(S, n);
    return S;
  },

  pending(S) {
    if (S.phase !== "play") return [];
    return [{ p: curP(S), kind: S.rolls ? "turn" : "roll" }];
  },

  validate(S, p, a) {
    if (S.phase !== "play" || p !== curP(S)) return tx("지금은 내 차례가 아닙니다", "It's not your turn");
    if (!a || typeof a !== "object") return tx("주사위를 굴리거나 칸을 고르세요", "Roll the dice or pick a category");
    if (a.roll === true) {
      if (S.rolls >= 3) return tx("세 번 모두 굴렸습니다 — 칸을 고르세요", "No rolls left — pick a category");
      if (a.hold !== undefined && (!Array.isArray(a.hold) || a.hold.length !== 5 || a.hold.some(h => typeof h !== "boolean")))
        return tx("고정할 주사위가 올바르지 않습니다", "Invalid dice to hold");
      if (S.rolls > 0 && a.hold && a.hold.every(Boolean)) return tx("다시 굴릴 주사위를 하나 이상 남겨 두세요", "Release at least one die to roll");
      return true;
    }
    if (a.score !== undefined) {
      const c = CATS.indexOf(a.score);
      if (c < 0) return tx("없는 칸입니다", "No such category");
      if (!S.rolls) return tx("먼저 주사위를 굴리세요", "Roll the dice first");
      if (S.sheets[p][c] !== null) return tx("이미 채운 칸입니다", "That category is already filled");
      return true;
    }
    return tx("주사위를 굴리거나 칸을 고르세요", "Roll the dice or pick a category");
  },

  apply(S, p, a) {
    if (a.roll === true) {
      const hold = S.rolls > 0 && a.hold ? a.hold.slice() : NO_HOLD.slice();
      const dice = [];
      for (let i = 0; i < 5; i++) dice.push(hold[i] ? S.dice[i] : randInt(S, 6) + 1);
      S.dice = dice;
      S.held = hold;
      S.rolls++;
      return [{ type: "roll", p, dice: dice.slice(), held: hold.slice(), rolls: S.rolls }];
    }
    const c = CATS.indexOf(a.score);
    const before = tally(S.sheets[p]);
    const pts = scoreDice(c, S.dice);
    S.sheets[p][c] = pts;
    const after = tally(S.sheets[p]);
    S.last[p] = { cat: c, pts };
    S.prev = { p, cat: c, pts, dice: S.dice.slice() };
    const bonus = !before.bonus && !!after.bonus;
    const ev = [{ type: "score", p, cat: c, pts, dice: S.dice.slice(), bonus, total: after.total,
      text: tx(`{${p}} 님: ${nameOf(c).ko} ${pts}점` + (bonus ? " · 보너스 +35!" : ""), `{${p}}: ${nameOf(c).en} ${pts}` + (bonus ? " · bonus +35!" : "")) }];
    S.turnNo++;
    S.dice = null; S.rolls = 0; S.held = NO_HOLD.slice();
    if (S.turnNo >= ROUNDS * S.n) {
      S.phase = "over";
      const res = results(S), top = res.filter(r => r.rank === 1).map(r => r.p);
      const best = tally(S.sheets[top[0]]).total;
      ev.push({ type: "over", winners: top, text: S.n === 1 ? tx(`게임 끝 — ${best}점`, `Game over — ${best} points`)
        : top.length > 1 ? tx(`게임 끝 — ${top.map(q => `{${q}}`).join(", ")} 님 공동 1등 (${best}점)`, `Game over — ${top.map(q => `{${q}}`).join(", ")} tie for first (${best})`)
        : tx(`게임 끝 — {${top[0]}} 님 승리 (${best}점)`, `Game over — {${top[0]}} wins (${best})`) });
    }
    return ev;
  },

  step() { return []; },
  delay() { return 600; },

  timeout(S, p) {
    if (!S.rolls) return { roll: true, hold: NO_HOLD.slice() };
    return { score: CATS[plan(S.sheets[p], S.dice, 0, 1).score] };
  },

  ai(S, p, { level, rng }) {
    if (!S.rolls) return { roll: true, hold: NO_HOLD.slice() };
    const sheet = S.sheets[p], left = 3 - S.rolls;
    if (level === "easy") {
      // A casual player: often keeps the most common face (or a straight run) instead of planning, sometimes stops early,
      // and picks the category by feel (the value of each placement plus noise)
      const E = evaluator(sheet), s = stateOf(S.dice);
      const pickScore = () => {
        let cat = E.open[0], bv = -Infinity;
        for (const c of E.open) { const v = E.value(c, s) + rng() * 9; if (v > bv) { bv = v; cat = c; } }
        return { score: CATS[cat] };
      };
      if (!left || rng() < .12) return pickScore();
      if (rng() < .5) {
        const r = plan(sheet, S.dice, left, 1);
        return r.score !== undefined ? pickScore() : { roll: true, hold: maskFor(S.dice, r.keep) };
      }
      const c = countsOf(S.dice);
      let hold;
      const run = [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6], [1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]].find(r => r.every(f => c[f]));
      if (run && (sheet[9] === null || sheet[10] === null) && rng() < .7) {
        const want = new Set(run);
        hold = S.dice.map(d => (want.has(d) ? (want.delete(d), true) : false));
      } else {
        let face = 6;
        for (let f = 6; f >= 1; f--) if (c[f] > c[face]) face = f;
        hold = S.dice.map(d => d === face);
      }
      if (hold.every(Boolean)) return pickScore();
      return { roll: true, hold };
    }
    const r = plan(sheet, S.dice, left, level === "hard" ? 2 : 1);
    if (r.score !== undefined) return { score: CATS[r.score] };
    return { roll: true, hold: maskFor(S.dice, r.keep) };
  },

  thinkTime(S) { return S.rolls ? 1050 + Math.random() * 500 : 550 + Math.random() * 350; },

  view(S, p) {
    const t = curP(S), round = roundOf(S), playing = S.phase === "play";
    const v = {
      phase: S.phase, n: S.n, turn: playing ? t : -1, first: S.first, round, rounds: ROUNDS, turnNo: S.turnNo,
      dice: S.dice ? S.dice.slice() : null, rolls: S.rolls, held: S.held.slice(),
      sheets: S.sheets.map(s => s.slice()), last: S.last.map(x => (x ? { ...x } : null)), prev: S.prev ? { ...S.prev, dice: S.prev.dice.slice() } : null,
      quietAsk: playing && S.rolls > 0                  // the turn sound only at the start of a turn, not after every roll
    };
    if (!playing) v.status = tx("게임 끝", "Game over");
    else if (S.n === 1) v.status = tx(`${round}/${ROUNDS} 라운드 · 최고 기록 도전`, `Round ${round}/${ROUNDS} · high-score run`);
    else if (p === t) v.status = tx(`${round}/${ROUNDS} 라운드 · 내 차례`, `Round ${round}/${ROUNDS} · your turn`);
    else v.status = tx(`${round}/${ROUNDS} 라운드 · {${t}} 님 차례`, `Round ${round}/${ROUNDS} · {${t}}'s turn`);
    return v;
  },

  over(S) { return S.phase === "over"; },
  results,

  /* ---------- For tests ---------- */
  stepLimit: 5000,
  randomAction(S, p, rng) {
    if (!S.rolls) return { roll: true, hold: NO_HOLD.slice() };
    if (S.rolls < 3 && rng() < .5) {
      const hold = [0, 1, 2, 3, 4].map(() => rng() < .5);
      if (hold.every(Boolean)) hold[Math.floor(rng() * 5)] = false;
      return { roll: true, hold };
    }
    const open = CATS.filter((_, c) => S.sheets[p][c] === null);
    return { score: open[Math.floor(rng() * open.length)] };
  },
  leak(S, p, v) {
    if (JSON.stringify(v).includes('"rs"')) return "the RNG state is in the view";
    if (JSON.stringify(v.dice) !== JSON.stringify(S.dice)) return "view.dice differs from the dice";
    if (JSON.stringify(v.sheets) !== JSON.stringify(S.sheets)) return "view.sheets differs from the sheets";
    return true;
  },
  check(S) {
    if (S.phase === "play" && S.turnNo >= ROUNDS * S.n) return "the game should be over";
    if (S.rolls < 0 || S.rolls > 3) return `rolls out of range: ${S.rolls}`;
    if ((S.dice === null) !== (S.rolls === 0)) return "dice and roll count disagree";
    if (S.dice && (S.dice.length !== 5 || S.dice.some(d => !Number.isInteger(d) || d < 1 || d > 6))) return "bad dice";
    for (let p = 0; p < S.n; p++) {
      const filled = S.sheets[p].filter(v => v !== null).length;
      const order = (p - S.first + S.n) % S.n;
      const want = Math.floor(S.turnNo / S.n) + (order < S.turnNo % S.n ? 1 : 0);
      if (filled !== want) return `seat ${p} filled ${filled} categories, expected ${want}`;
      for (let c = 0; c < NC; c++) {
        const v = S.sheets[p][c];
        if (v === null) continue;
        const ok = c < 6 ? v % (c + 1) === 0 && v <= 5 * (c + 1) && v >= 0
          : c === 6 ? v >= 5 && v <= 30 : c === 7 || c === 8 ? v === 0 || (v >= 5 && v <= 30)
          : c === 9 ? v === 0 || v === 15 : c === 10 ? v === 0 || v === 30 : v === 0 || v === 50;
        if (!ok) return `seat ${p}: impossible ${CATS[c]} score ${v}`;
      }
    }
    return true;
  }
};
