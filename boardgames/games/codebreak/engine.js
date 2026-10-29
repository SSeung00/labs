/* Secret Numbers — a deduction game with 24 number tiles (0–11 in black and in white), optionally two jokers ("−").
   Each player keeps a row of face-down tiles in ascending order (equal numbers: black left of white). Tile colours are
   public, numbers are not. On your turn you draw a tile, then point at an opponent's hidden tile and name its number.
   Right: it is revealed and you may guess again or stop (your drawn tile joins your row hidden). Wrong: your drawn tile
   joins your row face up (empty pool: reveal one of your own hidden tiles). A player whose tiles are all revealed is out;
   the last player with a hidden tile wins.

   State tiles are keys (see logic.js): number n of colour c = n * 2 + c, jokers 24 (black) / 25 (white). */
import { shuffle, randInt } from "../../core/rng.js";
import { tx } from "../../core/i18n.js";
import { JOKER, keyOf, numOf, colOf, keyCount, analyze, simpleNums } from "./logic.js";

const name = tx("숫자 암호", "Secret Numbers");
const ord = n => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
const colKo = c => (c ? "흰색" : "검은색"), colEn = c => (c ? "white" : "black");
const numTxt = n => (n === JOKER ? "−" : String(n));
/* "black 7" / "white −" in both languages */
const tileKo = (c, n) => `${c ? "흰" : "검은"} ${numTxt(n)}`;
const tileEn = (c, n) => `${colEn(c)} ${numTxt(n)}`;

const hiddenCount = (S, p) => S.rows[p].reduce((a, t) => a + (t.up ? 0 : 1), 0);
const active = S => [...Array(S.n).keys()].filter(p => !S.out.includes(p));
function nextActive(S, p) {
  for (let k = 1; k <= S.n; k++) { const q = (p + k) % S.n; if (!S.out.includes(q)) return q; }
  return p;
}
/* Where a numbered tile goes: right after the last numbered tile with a smaller key (jokers stay where they are) */
function slotFor(row, k) {
  let at = 0;
  row.forEach((t, i) => { if (t.k < 24 && t.k < k) at = i + 1; });
  return at;
}
/* Put a tile into p's row → its index */
function insert(S, p, k, up, at) {
  const row = S.rows[p];
  const i = k >= 24 ? (Number.isInteger(at) && at >= 0 && at <= row.length ? at : row.length) : slotFor(row, k);
  row.splice(i, 0, { k, up, no: [] });
  S.lastPlaced = { p, i };
  return i;
}
function eliminate(S, q, ev) {
  S.out.push(q);
  const place = S.n - S.out.length + 1;
  ev.push({ type: "out", p: q, place, text: tx(`{${q}} 님 탈락 — 타일이 모두 공개되었습니다`, `{${q}} is out — all tiles revealed`) });
}
/* One player left with hidden tiles → game over */
function settle(S, ev) {
  const left = active(S);
  if (left.length > 1) return false;
  if (S.drawn !== null) { insert(S, S.turn, S.drawn, false); S.drawn = null; }
  S.phase = "over";
  S.winner = left.length ? left[0] : null;
  if (S.winner !== null) ev.push({ type: "over", winner: S.winner, text: tx(`{${S.winner}} 님 승리! 마지막까지 숫자를 지켰습니다`, `{${S.winner}} wins — the last secret standing!`) });
  return true;
}

/* What seat p may see (p = -1: the public view for spectators) */
function makeView(S, p) {
  const end = S.phase === "over";                // after the game every secret is shown
  const rows = S.rows.map((row, q) => row.map(t => ({ c: colOf(t.k), n: t.up || q === p || end ? numOf(t.k) : null, up: t.up, no: t.no.slice() })));
  const drawn = S.drawn === null ? null : { c: colOf(S.drawn), n: p === S.turn ? numOf(S.drawn) : null };
  let poolB = 0;
  for (const k of S.pool) if (!colOf(k)) poolB++;
  const t = S.turn;
  let status;
  if (S.phase === "over") status = S.winner !== null ? tx(`게임 끝 — {${S.winner}} 님 승리`, `Game over — {${S.winner}} wins`) : tx("게임 끝", "Game over");
  else if (p === t && S.phase === "guess") status = tx("내 차례 — 상대 타일의 숫자를 맞히세요", "Your turn — name a hidden tile");
  else if (p === t && S.phase === "more") status = tx("정답! 한 번 더 맞히거나 멈추세요", "Correct! Guess again or stop");
  else if (p === t && S.phase === "reveal") status = tx("틀렸습니다 — 내 타일 하나를 공개하세요", "Wrong — reveal one of your tiles");
  else if (S.phase === "begin") status = tx("타일을 나눠 받았습니다", "Tiles dealt");
  else if (S.phase === "next") {
    const nx = nextActive(S, t);
    status = nx === p ? tx("곧 내 차례입니다", "Your turn is next") : tx(`다음은 {${nx}} 님 차례`, `{${nx}} is next`);
  } else status = tx(`{${t}} 님 차례`, `{${t}}'s turn`);
  return {
    phase: S.phase, turn: t, jokers: S.jokers, rows, drawn, pool: S.pool.length, poolB, poolW: S.pool.length - poolB,
    out: S.out.slice(), winner: S.winner, last: S.last ? { ...S.last } : null, streak: S.streak,
    hits: S.hits.slice(), miss: S.miss.slice(), placed: S.lastPlaced ? { ...S.lastPlaced } : null, status
  };
}

/* ---------- AI helpers (they only read the player's own view) ---------- */
/* Which own tile to give away after a miss with an empty pool: the one the table can most easily work out anyway */
function revealPick(S, p) {
  const hid = S.rows[p].map((t, i) => (t.up ? -1 : i)).filter(i => i >= 0);
  const an = analyze(makeView(S, -1));
  let pick = hid[0], size = 99;
  for (const i of hid) { const a = an.tiles[p][i]; const s = a ? a.size : 99; if (s < size) { size = s; pick = i; } }
  return pick;
}
function guessOptions(v, me, an) {
  const out = [];
  v.rows.forEach((row, q) => {
    if (q === me || v.out.includes(q)) return;
    const hidden = row.reduce((a, t) => a + (t.up ? 0 : 1), 0);
    row.forEach((t, i) => {
      const a = an.tiles[q][i];
      if (t.up || !a) return;
      for (const n of a.nums) out.push({ q, i, n, p: a.p[n], size: a.size, hidden });
    });
  });
  return out;
}
const best = (opts, rng) => {
  let top = -1, list = [];
  for (const o of opts) {
    const s = o.p + (o.hidden === 1 ? 0.02 : 0) - o.size * 0.0005;   // ties: finish a player off, then the tightest tile
    if (s > top + 1e-9) { top = s; list = [o]; } else if (Math.abs(s - top) <= 1e-9) list.push(o);
  }
  return list[rng ? Math.floor(rng() * list.length) : 0];
};

export default {
  id: "codebreak",
  name,
  icon: "🔢",
  blurb: tx("상대의 숨은 숫자 타일을 추리해서 맞혀요. 마지막까지 숫자를 지킨 사람이 승리!",
    "Deduce and name your opponents' hidden number tiles. The last player with a secret left wins!"),
  players: { min: 2, max: 4, default: 3 },
  spectate: true,
  settings: [
    { key: "jokers", label: tx("조커 (−)", "Jokers (−)"), values: [false, true], labels: [tx("없음", "Off"), tx("넣기", "On")], default: false,
      note: tx("검은 −, 흰 − 타일 2개를 더합니다. 줄의 아무 자리에나 놓을 수 있고, 맞힐 때는 「−」라고 부릅니다",
        "Adds a black and a white − tile. They may sit anywhere in a row; to guess one, name \"−\"") }
  ],
  rules: tx(`<ul>
    <li>타일은 <b>0~11 숫자가 검은색과 흰색으로 하나씩</b>, 모두 24개입니다. 2~3명은 4개씩, 4명은 3개씩 받습니다.</li>
    <li>내 타일은 <b>작은 수부터 오른쪽으로</b> 늘어놓습니다. 같은 숫자면 <b>검은색이 왼쪽</b>입니다. 타일 색은 모두가 보지만 숫자는 나만 봅니다.</li>
    <li>내 차례: 가운데 더미에서 타일 1개를 뽑습니다 (더미가 비면 안 뽑음). 그리고 <b>반드시</b> 상대의 숨은 타일 하나를 골라 숫자를 부릅니다.</li>
    <li><b>맞히면</b> 그 타일이 공개됩니다. <b>한 번 더</b> 맞히거나 <b>멈출</b> 수 있습니다. 멈추면 뽑은 타일은 숨긴 채 내 줄의 제자리에 들어갑니다.</li>
    <li><b>틀리면</b> 뽑은 타일이 공개된 채로 내 줄에 들어가고 차례가 넘어갑니다. 뽑은 타일이 없으면 내 숨은 타일 하나를 골라 공개합니다.</li>
    <li>타일이 모두 공개된 사람은 탈락합니다. <b>마지막까지 숨은 타일을 가진 사람이 승리</b>, 나머지는 늦게 탈락한 순서로 순위가 정해집니다.</li>
    <li>조커 설정(선택): 검은 −, 흰 − 타일이 더해집니다. 처음 받은 조커는 줄의 아무 자리에나(무작위) 놓이고, 나중에 뽑은 조커는 멈출 때 놓을 자리를 직접 고릅니다. 틀려서 공개되는 조커는 줄 끝에 놓입니다.</li>
    <li>🔍 「가능한 숫자 보기」를 켜 두면 화면이 추리를 도와줍니다: 정렬 순서, 공개된 타일, 내 타일, 틀린 추측(≠)으로 남은 후보만 보여 줍니다.</li>
  </ul>`, `<ul>
    <li>There are 24 tiles: <b>the numbers 0–11, once in black and once in white</b>. With 2–3 players everyone gets 4 tiles; with 4 players, 3.</li>
    <li>Your row is kept in <b>ascending order from left to right</b>; with equal numbers <b>black goes left</b>. Everyone sees the tile colours, only you see your numbers.</li>
    <li>Your turn: draw a tile from the pool (none if it is empty). Then you <b>must</b> point at an opponent's hidden tile and name its number.</li>
    <li><b>Right:</b> that tile is revealed. You may <b>guess again</b> or <b>stop</b>. When you stop, your drawn tile joins your row hidden, in its sorted place.</li>
    <li><b>Wrong:</b> your drawn tile joins your row face up and your turn ends. If you drew nothing, reveal one of your own hidden tiles instead.</li>
    <li>A player whose tiles are all revealed is out. <b>The last player with a hidden tile wins</b>; the others rank by how long they lasted.</li>
    <li>Jokers (optional): a black and a white − tile are added. A joker in your starting tiles is placed anywhere in your row (at random); a joker drawn later is placed where you choose when you stop. A joker revealed by a wrong guess goes to the end of the row.</li>
    <li>🔍 With "Show possible numbers" on, the screen does the deduction for you: only numbers that still fit the order, the revealed tiles, your own tiles and earlier wrong guesses (≠) are offered.</li>
  </ul>`),

  setup({ n, seed, settings }) {
    const J = !!(settings && settings.jokers);
    const S = { n, rs: seed >>> 0, jokers: J, rows: [], pool: [], drawn: null, turn: 0, phase: "begin", out: [], winner: null,
      last: null, streak: 0, hits: Array(n).fill(0), miss: Array(n).fill(0), lastPlaced: null };
    const tiles = shuffle(S, [...Array(keyCount(J)).keys()]);
    const per = n >= 4 ? 3 : 4;
    for (let p = 0; p < n; p++) {
      const hand = tiles.splice(0, per);
      const row = hand.filter(k => k < 24).sort((a, b) => a - b).map(k => ({ k, up: false, no: [] }));
      for (const k of hand.filter(k => k >= 24)) row.splice(randInt(S, row.length + 1), 0, { k, up: false, no: [] });
      S.rows.push(row);
    }
    S.pool = tiles;
    S.turn = randInt(S, n);
    return S;
  },

  pending(S) {
    if (S.phase === "guess" || S.phase === "more" || S.phase === "reveal") return [{ p: S.turn, kind: S.phase }];
    return [];
  },

  /* begin / next: the turn passes and the new player draws */
  step(S) {
    if (S.phase === "next") S.turn = nextActive(S, S.turn);
    else if (S.phase !== "begin") return [];
    const p = S.turn, ev = [];
    S.streak = 0; S.last = null; S.lastPlaced = null;
    if (S.pool.length) {
      S.drawn = S.pool.pop();
      const c = colOf(S.drawn);
      ev.push({ type: "draw", p, c, n: numOf(S.drawn), left: S.pool.length,
        text: tx(`{${p}} 님이 ${colKo(c)} 타일을 뽑았습니다`, `{${p}} draws a ${colEn(c)} tile`) });
    } else {
      S.drawn = null;
      ev.push({ type: "nodraw", p, text: tx(`더미가 비었습니다 — {${p}} 님은 뽑지 않고 맞힙니다`, `The pool is empty — {${p}} guesses without drawing`) });
    }
    S.phase = "guess";
    return ev;
  },
  delay(S) {
    if (S.phase === "begin") return 900;
    return S.last && !S.last.ok ? 1700 : 1000;
  },

  validate(S, p, a) {
    if (!["guess", "more", "reveal"].includes(S.phase) || p !== S.turn) return tx("지금은 내 차례가 아닙니다", "It's not your turn");
    if (!a || typeof a !== "object") return tx("행동을 고르세요", "Choose an action");
    if (S.phase === "reveal") {
      if (a.t !== "reveal") return tx("공개할 내 타일을 고르세요", "Choose one of your tiles to reveal");
      const t = Number.isInteger(a.i) ? S.rows[p][a.i] : null;
      if (!t || t.up) return tx("숨어 있는 내 타일을 고르세요", "Choose one of your hidden tiles");
      return true;
    }
    if (a.t === "stop") {
      if (S.phase !== "more") return tx("먼저 한 번은 맞혀야 합니다", "You must guess at least once first");
      if (a.at !== undefined && (!Number.isInteger(a.at) || a.at < 0 || a.at > S.rows[p].length)) return tx("놓을 자리가 올바르지 않습니다", "That spot isn't in your row");
      return true;
    }
    if (a.t !== "guess") return tx("행동을 고르세요", "Choose an action");
    if (!Number.isInteger(a.q) || a.q < 0 || a.q >= S.n || a.q === p || S.out.includes(a.q)) return tx("상대를 고르세요", "Choose an opponent");
    const t = Number.isInteger(a.i) ? S.rows[a.q][a.i] : null;
    if (!t || t.up) return tx("숨어 있는 타일을 고르세요", "Choose a hidden tile");
    if (!Number.isInteger(a.n) || a.n < 0 || a.n > (S.jokers ? JOKER : 11)) return tx("숫자를 고르세요", "Choose a number");
    return true;
  },

  apply(S, p, a) {
    const ev = [];
    if (a.t === "guess") {
      const { q, i, n } = a, tile = S.rows[q][i], c = colOf(tile.k), ok = numOf(tile.k) === n;
      S.last = { p, q, i, n, ok };
      const pos = i + 1;
      ev.push({ type: "guess", p, q, i, n, c, ok,
        text: ok ? tx(`{${p}} → {${q}} 님의 왼쪽 ${pos}번째 타일은 ${tileKo(c, n)}? 정답!`, `{${p}} → {${q}}'s tile ${pos}: ${tileEn(c, n)}? Correct!`)
          : tx(`{${p}} → {${q}} 님의 왼쪽 ${pos}번째 타일은 ${tileKo(c, n)}? 틀렸습니다`, `{${p}} → {${q}}'s tile ${pos}: ${tileEn(c, n)}? Wrong`) });
      if (ok) {
        tile.up = true;
        S.hits[p]++; S.streak++;
        if (!hiddenCount(S, q)) eliminate(S, q, ev);
        if (!settle(S, ev)) S.phase = "more";
      } else {
        S.miss[p]++;
        if (!tile.no.includes(n)) tile.no.push(n);
        if (S.drawn !== null) {
          const k = S.drawn, at = insert(S, p, k, true);
          S.drawn = null;
          ev.push({ type: "place", p, i: at, up: true, c: colOf(k), n: numOf(k),
            text: tx(`{${p}} 님의 뽑은 타일 ${tileKo(colOf(k), numOf(k))} 공개`, `{${p}}'s drawn tile is revealed: ${tileEn(colOf(k), numOf(k))}`) });
          S.phase = "next";
        } else S.phase = "reveal";
      }
    } else if (a.t === "stop") {
      if (S.drawn !== null) {
        const k = S.drawn, at = insert(S, p, k, false, a.at);
        S.drawn = null;
        ev.push({ type: "place", p, i: at, up: false, c: colOf(k), n: numOf(k), stop: true,
          text: tx(`{${p}} 님이 멈추고 뽑은 타일을 숨겼습니다`, `{${p}} stops and hides the drawn tile`) });
      } else ev.push({ type: "place", p, i: -1, up: false, stop: true, text: tx(`{${p}} 님이 멈췄습니다`, `{${p}} stops`) });
      S.phase = "next";
    } else if (a.t === "reveal") {
      const t = S.rows[p][a.i];
      t.up = true;
      S.lastPlaced = { p, i: a.i };
      ev.push({ type: "reveal", p, i: a.i, c: colOf(t.k), n: numOf(t.k),
        text: tx(`{${p}} 님이 자기 타일(${tileKo(colOf(t.k), numOf(t.k))})을 공개했습니다`, `{${p}} reveals their own ${tileEn(colOf(t.k), numOf(t.k))}`) });
      if (!hiddenCount(S, p)) eliminate(S, p, ev);
      if (!settle(S, ev)) S.phase = "next";
    }
    return ev;
  },

  /* A drawn tile and a tile hidden into a row are only known to their owner */
  filterEvent(ev, p) {
    if ((ev.type === "draw" || (ev.type === "place" && !ev.up)) && p !== ev.p) return { ...ev, n: null };
    return ev;
  },

  timeout(S, p, kind) {
    if (S.phase === "more") return S.drawn !== null && S.drawn >= 24 ? { t: "stop", at: S.rows[p].length } : { t: "stop" };
    if (S.phase === "reveal") return { t: "reveal", i: revealPick(S, p) };
    const v = makeView(S, p), o = best(guessOptions(v, p, analyze(v)), null);
    return { t: "guess", q: o.q, i: o.i, n: o.n };
  },

  ai(S, p, { level, rng }) {
    if (S.phase === "reveal") {
      const hid = S.rows[p].map((t, i) => (t.up ? -1 : i)).filter(i => i >= 0);
      return { t: "reveal", i: level === "easy" ? hid[Math.floor(rng() * hid.length)] : revealPick(S, p) };
    }
    const v = makeView(S, p);
    const stop = () => (S.drawn !== null && S.drawn >= 24 ? { t: "stop", at: Math.floor(rng() * (S.rows[p].length + 1)) } : { t: "stop" });
    const more = S.phase === "more";
    if (level === "easy") {
      if (more && rng() < 0.6) return stop();
      const tiles = [];
      v.rows.forEach((row, q) => { if (q !== p && !v.out.includes(q)) row.forEach((t, i) => { if (!t.up) tiles.push({ q, i }); }); });
      const t = tiles[Math.floor(rng() * tiles.length)];
      let nums = simpleNums(v, t.q, t.i);
      if (!nums.length) nums = [...Array(S.jokers ? 13 : 12).keys()];
      return { t: "guess", q: t.q, i: t.i, n: nums[Math.floor(rng() * nums.length)] };
    }
    const an = analyze(v, { exact: level === "hard" });
    const opts = guessOptions(v, p, an);
    if (level === "normal") {
      // the tile with the fewest possibilities (ties weighted at random), then its most likely number
      const minSize = Math.min(...opts.map(o => o.size));
      const sure = opts.filter(o => o.p >= 0.999);
      if (more && !sure.length && !(rng() < 0.25 && opts.some(o => o.p >= 0.5))) return stop();
      if (sure.length) { const o = sure[Math.floor(rng() * sure.length)]; return { t: "guess", q: o.q, i: o.i, n: o.n }; }
      const tight = opts.filter(o => o.size <= minSize + (rng() < 0.3 ? 1 : 0));
      const tiles = [...new Set(tight.map(o => o.q + ":" + o.i))];
      const key = tiles[Math.floor(rng() * tiles.length)];
      const o = best(tight.filter(x => x.q + ":" + x.i === key), rng);
      return { t: "guess", q: o.q, i: o.i, n: o.n };
    }
    // hard: exact odds when small; keep going only while the risk is worth it
    const o = best(opts, rng);
    if (more && o.p < 0.999) {
      const myHidden = S.rows[p].reduce((a, t) => a + (t.up ? 0 : 1), 0);
      const foes = active(S).filter(q => q !== p);
      const wins = o.hidden === 1 && foes.length === 1, kills = o.hidden === 1;
      // thresholds tuned by simulation against the normal level: pressing on pays off more often than not
      let need = S.drawn !== null ? 0.45 : (myHidden <= 1 ? 0.9 : 0.65);
      if (S.drawn !== null && myHidden >= 5) need -= 0.06;
      if (kills) need -= 0.15;
      if (wins) need = Math.min(need, S.drawn !== null ? 0.4 : 0.6);
      if (o.p < need) return stop();
    }
    return { t: "guess", q: o.q, i: o.i, n: o.n };
  },
  thinkTime(S, p, kind) {
    if (kind === "guess") return 1100 + Math.random() * 900;
    if (kind === "more") return 750 + Math.random() * 600;
    return 900 + Math.random() * 400;
  },

  view(S, p) { return makeView(S, p); },

  over(S) { return S.phase === "over"; },
  results(S) {
    const res = [];
    if (S.winner !== null) {
      const h = hiddenCount(S, S.winner);
      res.push({ p: S.winner, rank: 1, note: tx(`끝까지 숨긴 타일 ${h}개 · 맞힘 ${S.hits[S.winner]}번`, `${h} tile${h === 1 ? "" : "s"} still hidden · ${S.hits[S.winner]} correct`) });
    }
    S.out.forEach((p, k) => res.push({ p, rank: S.n - k, note: tx(`${k + 1}번째 탈락 · 맞힘 ${S.hits[p]}번`, `Out ${ord(k + 1)} · ${S.hits[p]} correct`) }));
    for (let p = 0; p < S.n; p++) if (!res.some(r => r.p === p)) res.push({ p, rank: 1 });
    return res.sort((a, b) => a.rank - b.rank);
  },

  /* ---------- for tests ---------- */
  randomAction(S, p, rng) {
    if (S.phase === "reveal") {
      const hid = S.rows[p].map((t, i) => (t.up ? -1 : i)).filter(i => i >= 0);
      return { t: "reveal", i: hid[Math.floor(rng() * hid.length)] };
    }
    if (S.phase === "more" && rng() < 0.4) return { t: "stop", at: Math.floor(rng() * (S.rows[p].length + 1)) };
    const tiles = [];
    S.rows.forEach((row, q) => { if (q !== p && !S.out.includes(q)) row.forEach((t, i) => { if (!t.up) tiles.push({ q, i }); }); });
    const t = tiles[Math.floor(rng() * tiles.length)];
    // mostly random numbers, sometimes the right one (to reach long correct streaks and eliminations)
    const right = numOf(S.rows[t.q][t.i].k);
    const n = rng() < 0.35 ? right : Math.floor(rng() * (S.jokers ? 13 : 12));
    return { t: "guess", q: t.q, i: t.i, n };
  },
  check(S) {
    const all = [...S.pool];
    for (const row of S.rows) for (const t of row) all.push(t.k);
    if (S.drawn !== null) all.push(S.drawn);
    all.sort((a, b) => a - b);
    const K = keyCount(S.jokers);
    if (all.length !== K || all.some((k, i) => k !== i)) return `tiles don't add up: ${all.join(",")}`;
    for (let p = 0; p < S.n; p++) {
      let last = -1;
      for (const t of S.rows[p]) if (t.k < 24) { if (t.k <= last) return `row ${p} is out of order`; last = t.k; }
      const h = hiddenCount(S, p);
      if (S.out.includes(p) ? h !== 0 : h === 0) return `seat ${p}: hidden tiles ${h} but out=${S.out.includes(p)}`;
    }
    if (S.drawn !== null && S.phase !== "guess" && S.phase !== "more") return `a drawn tile is left over in phase ${S.phase}`;
    if (S.phase === "over" && (S.winner === null || active(S).length !== 1)) return "game over without one winner";
    if (new Set(S.out).size !== S.out.length) return "a seat is out twice";
    return true;
  },
  leak(S, p, v) {
    const ok = new Set(["c", "n", "up", "no"]);
    if (!Array.isArray(v.rows) || v.rows.length !== S.n) return "rows missing";
    for (let q = 0; q < S.n; q++) {
      if (v.rows[q].length !== S.rows[q].length) return `row ${q} has the wrong length`;
      for (let i = 0; i < S.rows[q].length; i++) {
        const t = S.rows[q][i], x = v.rows[q][i];
        if (Object.keys(x).some(k => !ok.has(k))) return `unexpected tile field in row ${q}`;
        if (x.c !== colOf(t.k)) return `colour mismatch at ${q}:${i}`;
        const may = t.up || q === p || S.phase === "over";
        if (may ? x.n !== numOf(t.k) : x.n !== null) return `tile ${q}:${i} shows ${x.n} to seat ${p}`;
      }
    }
    if (S.drawn !== null) {
      if (!v.drawn || v.drawn.c !== colOf(S.drawn)) return "drawn tile colour missing";
      if (p !== S.turn && v.drawn.n !== null) return `the drawn tile is visible to seat ${p}`;
    } else if (v.drawn) return "a drawn tile appears from nowhere";
    if (/"k":/.test(JSON.stringify(v))) return "tile keys in the view";
    return true;
  }
};
