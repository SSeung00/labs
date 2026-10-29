/* Liar Game — everyone gets the same secret word except the liar, who only knows the category.
   Flow of a round: hints in turn order (1 or 2 passes) → everyone votes at once (secret) → the votes are shown (step) →
   the liar is unmasked (step) → if caught, the liar guesses the word from 9 options → result (step) → next round.
   "Fool liar" variant: the liar gets a different word of the same category instead and isn't told they are the liar.
   Hidden information: the word never reaches the liar or spectators before the round result; the liar's identity stays
   hidden until the unmasking; votes stay hidden until everyone has voted. */
import { randInt, shuffle } from "../../core/rng.js";
import { tx } from "../../core/i18n.js";
import { CATS, UNIVERSAL, MAX_HINT, MAX_AI_KO, MAX_AI_EN, normHint, hintLen, containsWord, hintIn, wordFeats, relatedTo } from "./words.js";

const TIME = { hint: 45, vote: 30, guess: 20 };    // seconds, times the "time" setting
const N_OPTS = 9;                                 // choices for the liar's guess

const wordOf = (S, wi) => CATS[S.cat].words[wi].w;
const realWord = S => wordOf(S, S.wi);
const fakeWord = S => (S.fi >= 0 ? wordOf(S, S.fi) : null);
const unmasked = S => ["guess", "result", "over"].includes(S.phase) && S.liar >= 0;
const decided = S => S.phase === "result" || S.phase === "over";
/* The word seat p sees on their card (null: the liar without a word, spectators) */
function seenIdx(S, p) {
  if (p < 0 || p >= S.n || S.liar < 0) return -1;
  if (p === S.liar) return S.fool ? S.fi : -1;
  return S.wi;
}
const turnOf = S => (S.phase === "hint" ? S.order[S.k % S.n] : -1);
const passOf = S => Math.floor(S.k / S.n);
/* Cheap per-state pseudo random number for timeouts (they must not touch S.rs) */
const hashPick = (S, p, n) => (((S.rs ^ Math.imul(p + 7, 0x9e3779b1) ^ Math.imul(S.k + S.round * 31, 0x85ebca6b)) >>> 0) % n);

function newRound(S) {
  S.round++;
  const free = CATS.map((_, i) => i).filter(i => !S.usedCats.includes(i));
  const pool = free.length ? free : CATS.map((_, i) => i);
  S.cat = pool[randInt(S, pool.length)];
  S.usedCats.push(S.cat);
  const nW = CATS[S.cat].words.length;
  S.wi = randInt(S, nW);
  S.fi = S.fool ? (S.wi + 1 + randInt(S, nW - 1)) % nW : -1;
  const cand = [...Array(S.n).keys()].filter(q => q !== S.lastLiar);   // random, but never the same liar twice in a row
  S.liar = cand[randInt(S, cand.length)];
  S.lastLiar = S.liar;
  const first = (S.first0 + S.round - 1) % S.n;
  S.order = [...Array(S.n).keys()].map(i => (first + i) % S.n);
  S.k = 0;
  S.hints = Array.from({ length: S.n }, () => []);
  S.votes = Array(S.n).fill(-1);
  S.tally = null; S.accused = -1; S.caught = null;
  S.opts = null; S.pick = -1; S.right = null; S.winner = null; S.gains = null;
  S.phase = "hint";
  const C = CATS[S.cat];
  return [{ type: "round", round: S.round, rounds: S.rounds, text: tx(`${S.round}라운드 — 주제: ${C.icon} ${C.name.ko}`, `Round ${S.round} — category: ${C.icon} ${C.name.en}`) }];
}

function finish(S, winner, ev) {
  const gains = Array(S.n).fill(0);
  if (winner === "liar") gains[S.liar] = S.caught ? 2 : 3;
  else for (let q = 0; q < S.n; q++) if (q !== S.liar) gains[q] = 1;
  for (let q = 0; q < S.n; q++) S.scores[q] += gains[q];
  S.winner = winner; S.gains = gains; S.phase = "result";
  S.liarRounds[S.liar]++;
  if (winner === "liar") S.liarWins[S.liar]++;
  S.past.push({ cat: S.cat, wi: S.wi, fi: S.fi, liar: S.liar, accused: S.accused, caught: S.caught, pick: S.pick >= 0 ? S.opts[S.pick] : -1, winner });
  const w = realWord(S);
  ev.push({ type: "result", winner, liar: S.liar, gains,
    text: winner === "liar" ? tx(`제시어는 「${w.ko}」 — 라이어 {${S.liar}} 님 승리! 🕵️`, `The word was "${w.en}" — the liar {${S.liar}} wins! 🕵️`)
      : tx(`제시어는 「${w.ko}」 — 시민 승리! 🎉`, `The word was "${w.en}" — the citizens win! 🎉`) });
}

/* ---------- Hints ---------- */
/* A hint action → { h: its stored form } or { err: bilingual message } */
function readHint(S, p, h) {
  const own = seenIdx(S, p) >= 0 ? wordOf(S, seenIdx(S, p)) : null;
  const check = (s, max) => {
    if (typeof s !== "string") return { err: tx("힌트를 적어 주세요", "Type a hint") };
    const t = normHint(s);
    if (!t) return { err: tx("힌트를 적어 주세요", "Type a hint") };
    if (hintLen(t) > max) return { err: tx(`힌트는 ${max}자까지입니다`, `Hints are at most ${max} characters`) };
    if (own && containsWord(t, own)) return { err: tx("힌트에 제시어를 넣으면 안 됩니다", "Your hint can't contain the word itself") };
    return { h: t };
  };
  if (typeof h === "string") return check(h, MAX_HINT);
  if (h && typeof h === "object" && !Array.isArray(h)) {
    const ko = check(h.ko, MAX_AI_KO);
    if (ko.err) return ko;
    const en = check(h.en, MAX_AI_EN);
    if (en.err) return en;
    return { h: { ko: ko.h, en: en.h } };
  }
  return { err: tx("힌트를 적어 주세요", "Type a hint") };
}

const allHints = S => S.hints.flat();
const unused = (S, list) => list.filter(x => !hintIn(x, allHints(S)));

/* ---------- AI ----------
   The AI only uses what its seat knows: its own word (if any) and the public hints. It "understands" a hint only some of the
   time (SKILL by level), so it misreads now and then like a person would. */
const SKILL = { easy: .5, normal: .7, hard: .88 };
const skillOf = level => SKILL[level] || SKILL.normal;
/* How well hint h seems to fit word wi to this AI: 2 clearly, 1 loosely, 0 no idea */
function fit(S, h, wi, sk, rng) {
  if (hintIn(h, CATS[S.cat].words[wi].h)) return rng() < sk ? 2 : 0;
  if (relatedTo(h, wordFeats(S.cat, wi))) return rng() < sk ? 1 : 0;
  return 0;
}

/* Which word of the category do the other players' hints point to? → [{wi, s}] best first */
function inferWord(S, p, sk, rng, exclude = []) {
  const out = [];
  CATS[S.cat].words.forEach((W, wi) => {
    if (exclude.includes(wi)) return;
    let s = 0;
    S.hints.forEach((hs, q) => { if (q !== p) for (const h of hs) s += fit(S, h, wi, sk, rng); });
    out.push({ wi, s: s + rng() * .5 });
  });
  return out.sort((a, b) => b.s - a.s);
}

/* The hint an AI gives: citizens (and a fool liar) describe their word — a fresh hint if one is left, else they echo one;
   the liar stays vague or, now and then, imitates the word the others seem to describe */
function aiHint(S, p, level, rng) {
  const C = CATS[S.cat], seen = seenIdx(S, p);
  const pick = list => list[Math.floor(rng() * list.length)];
  if (seen >= 0) {
    const own = unused(S, C.words[seen].h);
    if (own.length) return pick(own);
    const notMine = C.words[seen].h.filter(x => !hintIn(x, S.hints[p]));     // all used: echo someone else's, not my own
    return pick(notMine.length ? notMine : C.words[seen].h);
  }
  const bold = level === "hard" ? .6 : level === "normal" ? .35 : .1;
  if (rng() < bold) {
    const g = inferWord(S, p, skillOf(level), rng);
    if (g.length && g[0].s >= 2 && g[0].s >= (g[1] ? g[1].s : 0) + 1) {
      const own = unused(S, C.words[g[0].wi].h);
      if (own.length) return pick(own);
    }
  }
  const vague = unused(S, C.vague);
  if (vague.length) return pick(vague);
  const uni = unused(S, UNIVERSAL);
  return pick(uni.length ? uni : C.vague);
}

/* How suspicious each seat looks to p, using only what p knows */
function suspicion(S, p, sk, rng) {
  const C = CATS[S.cat];
  let known = seenIdx(S, p);
  if (known < 0) {                                  // the liar: judge as if the most likely word were the real one
    const g = inferWord(S, p, sk, rng);
    known = g.length && g[0].s >= 1 ? g[0].wi : -1;
  }
  return S.hints.map((hs, q) => {
    if (q === p) return -Infinity;
    let s = 0;
    for (const h of hs) {
      const f = known >= 0 ? fit(S, h, known, sk, rng) : 0;
      if (f) s -= f;
      else if (hintIn(h, C.vague) || hintIn(h, UNIVERSAL)) s += 1.2;
      else if (C.words.some((W, wi) => wi !== known && fit(S, h, wi, sk, rng))) s += 1.5;
      else s += .3;
    }
    return s / Math.max(1, hs.length);
  });
}

export default {
  id: "liar",
  name: tx("라이어 게임", "Liar Game"),
  icon: "🕵️",
  blurb: tx("모두 같은 제시어를 받지만 한 명만 몰라요. 힌트로 라이어를 찾아내세요!",
    "Everyone gets the same secret word — except the liar. Find them from their hints!"),
  players: { min: 3, max: 10, default: 5 },
  spectate: true,
  settings: [
    { key: "rounds", label: tx("라운드", "Rounds"), values: [3, 5, 7], labels: [tx("3라운드", "3 rounds"), tx("5라운드", "5 rounds"), tx("7라운드", "7 rounds")], default: 5,
      note: tx("라운드마다 주제와 라이어가 바뀝니다", "Every round has a new category and a new liar") },
    { key: "passes", label: tx("힌트 바퀴", "Hint passes"), values: [1, 2], labels: [tx("한 바퀴", "One each"), tx("두 바퀴", "Two each")], default: 1,
      note: tx("한 라운드에 한 사람이 주는 힌트 수", "How many hints each player gives per round") },
    { key: "fool", label: tx("바보 라이어", "Fool liar"), values: [0, 1], labels: [tx("끄기", "Off"), tx("켜기", "On")], default: 0,
      note: tx("켜면 라이어도 (다른) 제시어를 받고, 자기가 라이어인 줄 모릅니다", "When on, the liar gets a different word and doesn't know they are the liar") },
    { key: "time", label: tx("생각할 시간", "Time to think"), values: [1, 2, 0], labels: [tx("보통", "Normal"), tx("넉넉히", "Relaxed"), tx("제한 없음", "No limit")], default: 1,
      note: tx("보통: 힌트 45초 · 투표 30초 · 추측 20초 (넉넉히는 두 배)", "Normal: 45 s per hint · 30 s to vote · 20 s to guess (Relaxed doubles it)") }
  ],
  rules: tx(`<ul>
    <li>라운드마다 <b>주제</b>(음식, 동물…)와 <b>제시어</b>가 정해집니다. 모두 제시어를 받지만, 무작위로 뽑힌 <b>라이어</b> 한 명은 주제만 압니다.</li>
    <li><b>힌트</b>: 차례대로 제시어를 설명하는 짧은 힌트(한두 단어, 14자까지)를 적습니다. 제시어 자체는 쓸 수 없어요.
      너무 쉬우면 라이어가 눈치채고, 너무 어려우면 내가 라이어로 몰립니다. 라이어는 아는 척 둘러대세요.</li>
    <li><b>투표</b>: 힌트가 다 나오면 모두 동시에 라이어라고 생각하는 사람에게 투표합니다 (자기 자신은 안 됨). 모두 투표할 때까지 표는 비밀입니다.</li>
    <li>가장 많은 표를 받은 사람이 라이어면 <b>들킨 것</b>입니다 (동점이면 아무도 지목되지 않아 라이어 승리).
      들킨 라이어는 보기 9개 중에서 <b>제시어를 맞히면</b> 역전승합니다.</li>
    <li><b>점수</b>: 시민이 이기면 시민 모두 +1 · 라이어가 안 들키면 +3 · 들켰지만 제시어를 맞히면 +2. 모든 라운드가 끝나고 점수가 가장 높은 사람이 우승 (동점은 공동 순위).</li>
    <li><b>바보 라이어</b> (설정): 라이어도 같은 주제의 <b>다른 제시어</b>를 받고, 자기가 라이어인 줄 모릅니다. 힌트가 혼자 어긋나면 들통!</li>
    <li>시간이 다 되면 힌트는 주제에 어울리는 평범한 말로, 투표와 추측은 무작위로 정해집니다.</li>
  </ul>`, `<ul>
    <li>Each round has a <b>category</b> (food, animals…) and a <b>secret word</b>. Everyone gets the word except one randomly chosen <b>liar</b>, who only knows the category.</li>
    <li><b>Hints</b>: in turn, each player types a short hint (one or two words, up to 14 characters) about the word — never the word itself.
      Too easy and the liar works it out; too vague and you look like the liar. The liar has to bluff.</li>
    <li><b>Vote</b>: after the hints, everyone votes at the same time for who they think the liar is (not themselves). Votes stay secret until everyone has voted.</li>
    <li>If the player with <b>the most votes</b> is the liar, the liar is <b>caught</b> (a tie means nobody is accused and the liar wins).
      A caught liar can still win by <b>guessing the word</b> from 9 choices.</li>
    <li><b>Points</b>: citizens win → every citizen +1 · liar not caught → +3 · caught but guessed the word → +2. Highest total after the last round wins (ties share a place).</li>
    <li><b>Fool liar</b> (setting): the liar gets a <b>different word</b> from the same category and doesn't know they are the liar. Their hints give them away!</li>
    <li>When time runs out, a hint becomes a plain category-level remark; a vote or guess is picked at random.</li>
  </ul>`),

  setup({ n, seed, settings = {} }) {
    const S = {
      n, rs: seed >>> 0,
      rounds: [3, 5, 7].includes(settings.rounds) ? settings.rounds : 5,
      passes: settings.passes === 2 ? 2 : 1,
      fool: settings.fool === 1 || settings.fool === true ? 1 : 0,
      tmul: [0, 1, 2].includes(settings.time) ? settings.time : 1,
      round: 0, phase: "start", usedCats: [], lastLiar: -1, first0: 0,
      cat: 0, wi: 0, fi: -1, liar: -1, order: [], k: 0, hints: [], votes: [], tally: null, accused: -1, caught: null,
      opts: null, pick: -1, right: null, winner: null, gains: null,
      scores: Array(n).fill(0), liarRounds: Array(n).fill(0), liarWins: Array(n).fill(0), past: []
    };
    S.first0 = randInt(S, n);
    return S;
  },

  pending(S) {
    const t = k => (S.tmul ? TIME[k] * S.tmul : 0);
    if (S.phase === "hint") return [{ p: turnOf(S), kind: "hint", time: t("hint") }];
    if (S.phase === "vote") return S.votes.map((v, p) => (v < 0 ? { p, kind: "vote", time: t("vote"), secret: true } : null)).filter(Boolean);
    if (S.phase === "guess") return [{ p: S.liar, kind: "guess", time: t("guess") }];
    return [];
  },

  validate(S, p, a) {
    if (!a || typeof a !== "object") return tx("규칙에 맞지 않는 수입니다", "That move isn't allowed");
    if (S.phase === "hint") {
      if (p !== turnOf(S)) return tx("지금은 내 차례가 아닙니다", "It's not your turn");
      const r = readHint(S, p, a.hint);
      return r.err || true;
    }
    if (S.phase === "vote") {
      if (S.votes[p] >= 0) return tx("이미 투표했습니다", "You have already voted");
      if (!Number.isInteger(a.vote) || a.vote < 0 || a.vote >= S.n) return tx("투표할 사람을 고르세요", "Choose someone to vote for");
      if (a.vote === p) return tx("자기 자신에게는 투표할 수 없습니다", "You can't vote for yourself");
      return true;
    }
    if (S.phase === "guess") {
      if (p !== S.liar) return tx("라이어만 제시어를 추측합니다", "Only the liar guesses the word");
      if (!Number.isInteger(a.pick) || a.pick < 0 || a.pick >= S.opts.length) return tx("보기 중에서 고르세요", "Pick one of the choices");
      return true;
    }
    return tx("지금은 할 수 있는 일이 없습니다", "Nothing to do right now");
  },

  apply(S, p, a) {
    const ev = [];
    if (S.phase === "hint") {
      const h = readHint(S, p, a.hint).h;
      const pass = passOf(S);
      S.hints[p].push(h);
      S.k++;
      const [ko, en] = typeof h === "string" ? [h, h] : [h.ko, h.en];
      ev.push({ type: "hint", p, hint: h, pass, text: tx(`{${p}}: “${ko}”`, `{${p}}: “${en}”`) });
      if (S.k >= S.n * S.passes) {
        S.phase = "vote";
        ev.push({ type: "vote", text: tx("힌트 끝! 누가 라이어일까요? 모두 투표하세요 🗳️", "All hints are in! Who is the liar? Everyone votes 🗳️") });
      }
      return ev;
    }
    if (S.phase === "vote") {
      S.votes[p] = a.vote;
      ev.push({ type: "voted", p });
      if (S.votes.every(v => v >= 0)) {
        const tally = Array(S.n).fill(0);
        for (const v of S.votes) tally[v]++;
        const max = Math.max(...tally), tops = tally.map((c, q) => (c === max ? q : -1)).filter(q => q >= 0);
        S.tally = tally;
        S.accused = tops.length === 1 ? tops[0] : -1;
        S.phase = "tally";
        ev.push({ type: "votes", votes: S.votes.slice(), tally: tally.slice(), accused: S.accused,
          text: S.accused >= 0 ? tx(`투표 결과: {${S.accused}} 님이 ${max}표로 지목됐습니다`, `Vote result: {${S.accused}} is accused with ${max} vote${max === 1 ? "" : "s"}`)
            : tx("투표 결과: 동점 — 아무도 지목되지 않았습니다", "Vote result: a tie — nobody is accused") });
      }
      return ev;
    }
    if (S.phase === "guess") {
      S.pick = a.pick;
      S.right = S.opts[a.pick] === S.wi;
      const g = wordOf(S, S.opts[a.pick]);
      ev.push({ type: "guess", p, pick: a.pick, right: S.right,
        text: S.right ? tx(`{${p}} 님의 추측 「${g.ko}」 — 정답!`, `{${p}} guesses "${g.en}" — correct!`)
          : tx(`{${p}} 님의 추측 「${g.ko}」 — 틀렸습니다`, `{${p}} guesses "${g.en}" — wrong`) });
      finish(S, S.right ? "liar" : "citizens", ev);
      return ev;
    }
    return ev;
  },

  step(S) {
    if (S.phase === "start") return newRound(S);
    if (S.phase === "tally") {
      const ev = [];
      S.caught = S.accused === S.liar;
      ev.push({ type: "unmask", liar: S.liar, accused: S.accused, caught: S.caught,
        text: S.caught ? tx(`{${S.liar}} 님이 라이어였습니다! 🕵️ 제시어를 맞히면 역전승`, `{${S.liar}} was the liar! 🕵️ Guessing the word still wins`)
          : tx(`라이어는 {${S.liar}} 님이었습니다! 🕵️`, `The liar was {${S.liar}}! 🕵️`) });
      if (S.caught) {
        const others = CATS[S.cat].words.map((_, i) => i).filter(i => i !== S.wi && i !== S.fi);
        shuffle(S, others);
        S.opts = shuffle(S, [S.wi, ...others.slice(0, N_OPTS - 1)]);
        S.phase = "guess";
      } else finish(S, "liar", ev);
      return ev;
    }
    if (S.phase === "result") {
      if (S.round < S.rounds) return newRound(S);
      S.phase = "over";
      return [{ type: "over", text: tx("게임 끝!", "Game over!") }];
    }
    return [];
  },

  delay(S) {
    if (S.phase === "start") return 500;
    if (S.phase === "tally") return 3800;
    if (S.phase === "result") return 6500;
    return 1000;
  },

  timeout(S, p, kind) {
    if (kind === "vote" || S.phase === "vote") {
      const others = [...Array(S.n).keys()].filter(q => q !== p);
      return { vote: others[hashPick(S, p, others.length)] };
    }
    if (kind === "guess" || S.phase === "guess") return { pick: hashPick(S, p, S.opts ? S.opts.length : 1) };
    const C = CATS[S.cat];
    const list = unused(S, C.vague);
    const pool = list.length ? list : C.vague;
    return { hint: pool[hashPick(S, p, pool.length)] };
  },

  ai(S, p, { level = "normal", rng = Math.random } = {}) {
    if (S.phase === "hint") return { hint: aiHint(S, p, level, rng) };
    if (S.phase === "vote") {
      const noise = level === "easy" ? 3 : level === "hard" ? .8 : 1.6;
      const sus = suspicion(S, p, skillOf(level), rng);
      let best = -1, bv = -Infinity;
      sus.forEach((s, q) => { if (q === p) return; const v = s + rng() * noise; if (v > bv) { bv = v; best = q; } });
      return { vote: best >= 0 ? best : (p + 1) % S.n };
    }
    if (S.phase === "guess") {
      // Read the hints, then a skill roll: the clearer the hints, the likelier the AI trusts its best reading
      const g = inferWord(S, p, skillOf(level), rng, S.fi >= 0 ? [S.fi] : []).filter(x => S.opts.includes(x.wi));
      const lead = g.length > 1 ? g[0].s - g[1].s : 0;
      const sure = Math.min(.7, (level === "easy" ? .15 : level === "hard" ? .45 : .3) + .02 * lead);
      const alt = g.slice(1, 4);
      const wi = rng() < sure || !alt.length ? g[0].wi : alt[Math.floor(rng() * alt.length)].wi;
      return { pick: S.opts.indexOf(wi) };
    }
    return {};
  },

  thinkTime(S, p, kind) {
    if (kind === "hint") return 2000 + Math.random() * 2000;
    if (kind === "guess") return 2500 + Math.random() * 1500;
    return 1500 + Math.random() * 2500;
  },

  view(S, p) {
    const me = p >= 0 && p < S.n ? p : -1;
    const sidx = seenIdx(S, me);
    const open = unmasked(S);
    const C = CATS[S.cat];
    const ph = S.phase, turn = turnOf(S);
    const nVoted = S.votes.filter(v => v >= 0).length;
    let status = "";
    if (ph === "start") status = tx("곧 시작합니다", "Starting…");
    else if (ph === "hint") status = turn === me ? tx("내 차례 — 힌트를 적어 주세요", "Your turn — type a hint") : tx(`{${turn}} 님이 힌트를 생각하는 중`, `{${turn}} is thinking of a hint`);
    else if (ph === "vote") status = me >= 0 && S.votes[me] < 0 ? tx(`라이어에게 투표하세요 (${nVoted}/${S.n})`, `Vote for the liar (${nVoted}/${S.n})`) : tx(`투표 중 (${nVoted}/${S.n})`, `Voting (${nVoted}/${S.n})`);
    else if (ph === "tally") status = tx("투표 결과 공개", "The votes are in");
    else if (ph === "guess") status = me === S.liar ? tx("들켰다! 제시어를 맞혀 보세요", "Caught! Guess the word") : tx(`{${S.liar}} 님이 제시어를 추측하는 중`, `{${S.liar}} is guessing the word`);
    else if (ph === "result") status = S.winner === "liar" ? tx("라이어 승리!", "The liar wins!") : tx("시민 승리!", "The citizens win!");
    else if (ph === "over") status = tx("게임 끝", "Game over");
    return {
      phase: ph, round: S.round, rounds: S.rounds, passes: S.passes, pass: ph === "hint" ? passOf(S) : -1, fool: S.fool,
      cat: S.round ? C.name : null, icon: S.round ? C.icon : "",
      word: S.round && sidx >= 0 && ph !== "over" ? wordOf(S, sidx) : null,         // what is on my card
      liarMe: me >= 0 && me === S.liar && (!S.fool || open),
      order: S.order.slice(), turn,
      hints: S.hints.map(hs => hs.slice()),
      voted: S.votes.map(v => v >= 0),
      myVote: me >= 0 && S.votes[me] >= 0 ? S.votes[me] : -1,
      votes: ["tally", "guess", "result"].includes(ph) ? S.votes.slice() : null,
      tally: ["tally", "guess", "result"].includes(ph) ? S.tally.slice() : null,
      accused: ["tally", "guess", "result"].includes(ph) ? S.accused : -1,
      liar: open && ph !== "over" ? S.liar : -1,
      caught: open && ph !== "over" ? S.caught : null,
      opts: S.opts && (ph === "guess" || ph === "result") ? S.opts.map(i => wordOf(S, i)) : null,
      pick: ph === "result" ? S.pick : -1,
      answer: ph === "result" ? realWord(S) : null,
      fake: ph === "result" && S.fi >= 0 ? fakeWord(S) : null,
      winner: ph === "result" ? S.winner : null,
      gains: ph === "result" ? S.gains.slice() : null,
      scores: S.scores.slice(),
      past: S.past.map(r => ({ cat: CATS[r.cat].name, icon: CATS[r.cat].icon, word: CATS[r.cat].words[r.wi].w,
        fake: r.fi >= 0 ? CATS[r.cat].words[r.fi].w : null, liar: r.liar, caught: r.caught, guess: r.pick >= 0 ? CATS[r.cat].words[r.pick].w : null, winner: r.winner })),
      status
    };
  },

  over(S) { return S.phase === "over"; },
  results(S) {
    return S.scores.map((s, p) => ({ p, score: s, rank: 1 + S.scores.filter(x => x > s).length,
      note: S.liarRounds[p] ? tx(`라이어 ${S.liarRounds[p]}번 (${S.liarWins[p]}번 승리)`, `Liar ${S.liarRounds[p]}× (won ${S.liarWins[p]})`) : tx("라이어 안 함", "Never the liar") }));
  },

  /* ---------- For tests ---------- */
  randomAction(S, p, rng, kind) {
    if (S.phase === "hint") {
      const C = CATS[S.cat], r = rng();
      const typed = ["음…", "잘 모르겠어요", "That one!", "12345678901234", "  여러   칸  ", "🍕🍕", "흠 {0}", "<b>hi</b>", "ㅋㅋㅋ", "글쎄"];
      let h;
      if (r < .4) h = typed[Math.floor(rng() * typed.length)];
      else if (r < .7) { const W = C.words[Math.floor(rng() * C.words.length)]; const x = W.h[Math.floor(rng() * W.h.length)]; h = rng() < .5 ? x.ko : x; }
      else h = C.vague[Math.floor(rng() * C.vague.length)];
      return readHint(S, p, h).err ? this.timeout(S, p, "hint") : { hint: h };
    }
    if (S.phase === "vote") {
      const others = [...Array(S.n).keys()].filter(q => q !== p);
      return { vote: others[Math.floor(rng() * others.length)] };
    }
    if (S.phase === "guess") return { pick: Math.floor(rng() * S.opts.length) };
    return {};
  },

  leak(S, p, v) {
    const real = realWord(S), fake = fakeWord(S);
    const done = decided(S), open = unmasked(S);
    const has = (x, w) => w && JSON.stringify(x).includes(`"ko":${JSON.stringify(w.ko)},"en":${JSON.stringify(w.en)}`);
    const core = { ...v, hints: null, opts: null, past: null, status: null };
    if (S.round && !done) {
      if (p < 0 || p === S.liar) {
        if (has(core, real)) return "the secret word is in the view of the liar / a spectator";
        if (v.answer) return "answer shown before the result";
      }
      if (fake && p !== S.liar && has(core, fake)) return "the fool liar's word reached someone else";
      if (p === S.liar && S.fool && v.word && (v.word.ko !== fake.ko)) return "fool liar sees the wrong word";
      if (p >= 0 && p !== S.liar && (!v.word || v.word.ko !== real.ko)) return "citizen doesn't see the word";
    }
    if (!open && v.liar !== -1) return "liar identity shown before the unmasking";
    if (!open && (v.liarMe !== (p >= 0 && p === S.liar && !S.fool))) return "liarMe wrong before the unmasking";
    if (!open && v.caught !== null) return "caught shown early";
    if (S.phase === "vote" && (v.votes || v.tally)) return "votes visible while voting";
    if (v.myVote !== (p >= 0 && S.votes[p] >= 0 ? S.votes[p] : -1)) return "myVote is not my own vote";
    if (S.phase === "vote" && v.accused !== -1) return "accused shown while voting";
    if (JSON.stringify(v).match(/"(wi|fi|rs|usedCats|lastLiar)"/)) return "internal state in the view";
    return true;
  },

  check(S) {
    if (S.scores.length !== S.n) return "scores length";
    const want = S.past.reduce((a, r) => a + (r.winner === "liar" ? (r.caught ? 2 : 3) : S.n - 1), 0);
    if (S.scores.reduce((a, b) => a + b, 0) !== want) return "score total doesn't match the rounds played";
    if (S.past.length !== S.round - (["result", "over"].includes(S.phase) ? 0 : 1) && S.phase !== "start") return "round history count is off";
    if (S.phase === "start") return S.round === 0 ? true : "start phase after round 1";
    if (S.liar < 0 || S.liar >= S.n) return "liar seat out of range";
    const C = CATS[S.cat];
    if (S.wi < 0 || S.wi >= C.words.length) return "word index out of range";
    if (S.fool ? (S.fi < 0 || S.fi === S.wi || S.fi >= C.words.length) : S.fi !== -1) return "fool word is wrong";
    const given = S.hints.reduce((a, h) => a + h.length, 0);
    if (given !== S.k) return "hint count differs from the hint counter";
    if (S.phase === "hint" && S.k >= S.n * S.passes) return "hint phase should be over";
    if (S.phase !== "hint" && S.phase !== "over" && S.k !== S.n * S.passes) return "not every hint was given";
    for (let i = 0; i < S.k; i++) {                   // hints follow the turn order
      const q = S.order[i % S.n];
      if (S.hints[q].length < Math.floor(i / S.n) + 1) return "hints out of order";
    }
    for (let q = 0; q < S.n; q++) if (S.votes[q] === q) return "a vote for oneself";
    if (["tally", "guess", "result"].includes(S.phase) && S.votes.some(v => v < 0)) return "missing votes after voting";
    if (S.phase === "guess" && (!S.opts || !S.opts.includes(S.wi) || S.opts.length !== Math.min(N_OPTS, C.words.length - (S.fi >= 0 ? 1 : 0)))) return "guess options wrong";
    if (S.phase === "guess" && !S.caught) return "guessing without being caught";
    if (S.rounds < S.round) return "too many rounds";
    return true;
  }
};
