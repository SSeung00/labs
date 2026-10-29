/* Dalmuti — game-room engine module.
   The rules are enforced by rules.js (a verbatim port of the original dalmuti/web/engine.js). This file maps the
   original online version's sequence (Host.run in online.js) onto the room runner's (core/host.js)
   pending / validate / apply / step flow.

   Flow: seat draw (step) → deal (step) → [from round 2] revolution question (candidate only, secret) → tax (tribute is
        automatic → the Dalmuti picks cards to give back) → play (one current player) → round end (show standings, step)
        → next round … → over
   Fair-play rules: no card counter · only the current trick's record is shown · other players' tax cards and the
   revolution question are visible only to those involved. */
import * as R from "./rules.js";
import * as AI from "./ai.js";
import { tx } from "../../core/i18n.js";

const { JESTER, T, ACTIONS } = R;
const CARD_KO = ["달무티", "대주교", "남작부인", "수녀원장", "기사", "재봉사", "석공", "요리사", "양치기", "채석공", "소작농", "농노"];
const CARD_EN = ["Dalmuti", "Archbishop", "Baroness", "Abbess", "Knight", "Seamstress", "Mason", "Cook", "Shepherdess", "Stonecutter", "Peasant", "Serf"];
export const CARD_NAMES = CARD_KO.map((k, i) => tx(k, CARD_EN[i]));
export const cardName = r => r === JESTER ? tx("광대", "Jester") : CARD_NAMES[r - 1];
export const TITLE_NAMES = [tx("평민", "Commoner"), tx("대달무티", "Greater Dalmuti"), tx("소달무티", "Lesser Dalmuti"),
  tx("상인", "Merchant"), tx("소농노", "Lesser Peon"), tx("대농노", "Greater Peon")];
const TITLE_SHORT = [tx("평민", "Comm."), tx("대달", "G.Dal"), tx("소달", "L.Dal"), tx("상인", "Merch."), tx("소농", "L.Peon"), tx("대농", "G.Peon")];

/* The learned policy (hard AI) is 350KB, so it is loaded separately only when the host starts a game.
   Until it has loaded, the heuristic "hard" AI is used. */
let POLICY = null, policyLoading = null;
export function loadLearned() {
  if (!policyLoading) {
    policyLoading = import("./policy.js")
      .then(m => (POLICY = AI.loadPolicy(m.default)))
      .catch(e => { console.warn("Could not load the Dalmuti learned policy", e); return null; });
  }
  return policyLoading;
}
export const policyReady = () => !!POLICY;
const HARD_TAU = 0.05;   // temperature of the original online version's "hard" level

/* ---------- Helpers ---------- */
const sizes = G => G.hands.map((_, p) => R.handSize(G, p));
const label = r => r === JESTER ? tx("광대", "Jester") : tx(`${cardName(r).ko}(${r})`, `${cardName(r).en} (${r})`);
const cardsEn = n => `${n} card${n === 1 ? "" : "s"}`;
const ordEn = n => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
const PREP_TAX = tx("세금을 걷을 준비 중…", "Preparing to collect taxes…");
const NOT_YOUR_TURN = tx("지금은 내 차례가 아닙니다", "It's not your turn");

/* Action → action id. Accepts {id}, {rank, plain, jesters} or {pass:true}; null if malformed */
function toId(a) {
  if (!a || typeof a !== "object") return null;
  if (a.pass === true) return 0;
  if (a.id !== undefined) return Number.isInteger(a.id) && a.id >= 0 && a.id < ACTIONS.length ? a.id : null;
  const r = a.rank, k = a.plain === undefined ? 0 : a.plain, j = a.jesters === undefined ? 0 : a.jesters;
  if (![r, k, j].every(Number.isInteger)) return null;
  try { return R.actionId(r, k, j); } catch (e) { return null; }
}
function revoltCandidate(S) {
  const G = S.g;
  if (G.phase !== "revolution") return -1;
  return R.revolutionCandidate(G);
}
/* Who gets the revolution question (the Greater Peon is not asked — it is always a great revolution, as in the original) */
function revoltAsk(S) {
  const c = revoltCandidate(S);
  return c >= 0 && S.g.titles[c] !== T.GP ? c : -1;
}
function curTax(S) {
  return S.tax && !S.tax.done && S.tax.stage === "return" ? S.tax.pairs[S.tax.i] : null;
}
function startTax(S) {
  const G = S.g;
  R.skipRevolution(G);
  S.tax = { pairs: R.taxPairs(G).map(x => ({ ...x, up: null, down: null })), i: 0, stage: "up", done: false };
  const ko = S.tax.pairs.map(x => `{${x.peon}} → {${x.lord}} ${x.k}장`).join(", ");
  const en = S.tax.pairs.map(x => `{${x.peon}} → {${x.lord}} ${cardsEn(x.k)}`).join(", ");
  return [{ type: "taxStart", pairs: S.tax.pairs.map(x => ({ peon: x.peon, lord: x.lord, k: x.k })),
    text: tx(`세금: ${ko || "없음"}`, `Tax: ${en || "none"}`) }];
}
function doRevolt(S, c) {
  const G = S.g;
  const { great } = R.declareRevolution(G, c);
  S.trickLog = []; S.prevTrick = null;
  return [{
    type: "revolt", p: c, great, toast: true,
    text: great ? tx(`대혁명! 대농노 {${c}} 님이 광대 2장을 펼쳤습니다 — 서열이 뒤집힙니다`,
                     `Great revolution! Greater Peon {${c}} reveals both Jesters — the ranks are reversed`)
                : tx(`혁명! {${c}} 님이 광대 2장을 펼쳤습니다 — 이번 라운드 세금 없음`,
                     `Revolution! {${c}} reveals both Jesters — no tax this round`)
  }];
}
function dealRound(S) {
  const G = S.g;
  R.deal(G);
  S.tax = null; S.trickLog = []; S.prevTrick = null;
  const ev = [{ type: "deal", round: G.round, text: tx(`라운드 ${G.round} / ${G.rounds} — 카드를 나눴습니다`, `Round ${G.round} / ${G.rounds} — cards dealt`) }];
  if (G.phase === "play") ev.push({ type: "lead", p: R.current(G) });
  return ev;
}

const E = {
  id: "dalmuti",
  name: tx("달무티", "Dalmuti"),
  icon: "👑",
  blurb: tx("계급 사회 카드 게임. 같은 숫자를 같은 장수로, 더 낮은 숫자로 덮어 먼저 털면 다음 라운드의 왕이 됩니다.",
    "A card game of social rank. Beat each play with as many cards of a lower number — empty your hand first to rule the next round."),
  players: { min: 4, max: 8, default: 6 },
  settings: [
    { key: "rounds", label: tx("라운드", "Rounds"), values: [3, 5, 8], labels: [tx("3판", "3"), tx("5판", "5"), tx("8판", "8")], default: 5,
      note: tx("라운드마다 n·n-1·…·1 점. 총점으로 순위", "Each round scores n · n-1 · … · 1 points. Total score decides the ranking") },
    { key: "passRule", label: tx("패스 규칙", "Passing"), values: ["again", "lock"],
      labels: [tx("다시 낼 수 있음", "Can play again"), tx("패스하면 그 판 끝", "Pass = out of the trick")], default: "again",
      note: tx("「패스하면 그 판 끝」: 한 번 패스한 사람은 그 판이 끝날 때까지 낼 수 없습니다",
        "\"Pass = out of the trick\": once you pass, you can't play again until the trick ends") },
    { key: "assist", label: tx("묶음 도우미", "Jester helper"), values: [true, false], labels: [tx("허용", "On"), tx("끄기", "Off")], default: true,
      note: tx("켜면 숫자 묶음을 누를 때 필요한 광대까지 알아서 붙입니다", "When on, tapping a number also adds the Jesters needed to match") }
  ],
  rules: tx(`<ul>
    <li>카드는 <b>1(달무티)부터 12(농노)까지</b> 숫자만큼 있고(1은 1장, 12는 12장) <b>광대 2장</b>을 더해 80장입니다. <b>숫자가 낮을수록 셉니다.</b></li>
    <li>첫 라운드는 한 장씩 뽑아 <b>가장 낮은 카드를 뽑은 사람</b>부터 앉고 선을 잡습니다.</li>
    <li>선은 <b>같은 숫자 여러 장</b>을 원하는 만큼 냅니다. 다음 사람은 <b>같은 장수</b>로 <b>더 낮은 숫자</b>를 내거나 패스합니다. 기본 규칙에서는 패스해도 다음 차례에 다시 낼 수 있습니다.
      <b>「패스하면 그 판 끝」</b> 규칙을 고르면 한 번 패스한 사람은 그 판이 끝날 때까지 낼 수 없습니다.</li>
    <li><b>광대</b>는 다른 숫자와 함께 내면 그 숫자로 칩니다. 광대만 내면 13(가장 약함)입니다.</li>
    <li>마지막에 낸 사람을 뺀 모두가 연달아 패스하면 (「패스하면 그 판 끝」 규칙에서는 모두 한 번씩 패스하면) 판이 끝나고, 마지막에 낸 사람이 새 판의 선이 됩니다.</li>
    <li>패를 먼저 턴 순서대로 <b>대달무티 · 소달무티 · 상인 · 소농노 · 대농노</b>가 되고, 그 순서로 다음 라운드에 앉습니다. 점수는 1등 n점, 2등 n-1점 … 꼴찌 1점.</li>
    <li><b>세금</b>(2라운드부터): 대농노는 가장 낮은 숫자 2장을 대달무티에게, 소농노는 1장을 소달무티에게 바칩니다. 달무티는 아무 카드나 같은 장수를 돌려줍니다.</li>
    <li><b>혁명</b>: 카드를 받은 뒤 광대 2장을 모두 가진 사람은 혁명을 선언할 수 있습니다 — 그 라운드 세금이 없어집니다. 대농노가 선언하면 <b>대혁명</b>: 서열이 통째로 뒤집힙니다 (대농노는 항상 선언).</li>
    <li>공정 규칙: 남의 패 · 남의 세금 내용은 보이지 않고, <b>낸 카드 기록은 판마다 지워집니다</b> (카드 카운터 없음). 혁명 질문은 당사자만 봅니다.</li>
  </ul>`, `<ul>
    <li>Each number from <b>1 (Dalmuti) to 12 (Serf)</b> has that many cards (one 1, twelve 12s), plus <b>2 Jesters</b> — 80 cards in all. <b>Lower numbers are stronger.</b></li>
    <li>In the first round everyone draws one card; seats are taken from <b>the lowest card drawn</b>, and that player leads.</li>
    <li>The leader plays <b>any number of cards of one number</b>. Each next player plays <b>the same number of cards</b> of a <b>lower number</b>, or passes. With the standard rule, passing doesn't stop you from playing on your next turn.
      With <b>"Pass = out of the trick"</b>, once you pass you can't play again until the trick ends.</li>
    <li>A <b>Jester</b> played with other cards counts as their number. Jesters played on their own count as 13 (the weakest).</li>
    <li>When everyone except the last player to play has passed in a row (with "Pass = out of the trick": once everyone else has passed), the trick ends and that player leads the next one.</li>
    <li>In the order players empty their hands they become <b>Greater Dalmuti · Lesser Dalmuti · Merchant · Lesser Peon · Greater Peon</b>, and they sit in that order next round. Scoring: 1st gets n points, 2nd n-1 … last 1.</li>
    <li><b>Tax</b> (from round 2): the Greater Peon gives their 2 lowest cards to the Greater Dalmuti, and the Lesser Peon gives 1 to the Lesser Dalmuti. The Dalmuti give back the same number of cards of their choice.</li>
    <li><b>Revolution</b>: after the deal, a player holding both Jesters may declare a revolution — there is no tax that round. If the Greater Peon declares it, it is a <b>Great Revolution</b>: the whole ranking is turned upside down (the Greater Peon always declares).</li>
    <li>Fair play: you can't see other hands or other players' tax cards, and <b>the record of played cards is cleared after every trick</b> (no card counting). Only the player concerned sees the revolution question.</li>
  </ul>`),

  setup({ n, seed, settings = {} }) {
    const rounds = [3, 5, 8].includes(settings.rounds) ? settings.rounds : 5;
    const S = {
      n, rounds, assist: settings.assist !== false,
      g: R.create({ n, rounds, seed: seed | 0, passLock: settings.passRule === "lock" }),
      draw: null,          // seat draw result {draws:[{p,rank}], order}
      tax: null,           // {pairs:[{peon,lord,k,up,down}], i, stage:"up"|"return", done}
      trickLog: [],        // what happened in the current trick — cleared when the trick ends (fair-play rule)
      prevTrick: null,     // the trick that just ended {rank,plain,jesters,count,by,leader} — shown until the next play
      history: []          // round results [{round, finish, points}]
    };
    loadLearned();         // only called on the host — there is plenty of time before the first AI turn
    return S;
  },

  pending(S) {
    const G = S.g;
    if (G.phase === "play") return [{ p: R.current(G), kind: "play" }];
    if (G.phase === "revolution") {
      const c = revoltAsk(S);
      return c >= 0 ? [{ p: c, kind: "revolt", secret: true, time: 15 }] : [];
    }
    if (G.phase === "tax") {
      const x = curTax(S);
      return x ? [{ p: x.lord, kind: "return", time: 30 }] : [];
    }
    return [];
  },

  validate(S, p, a) {
    const G = S.g;
    if (!a || typeof a !== "object") return tx("행동이 올바르지 않습니다", "Invalid action");
    if (G.phase === "play") {
      if (p !== R.current(G)) return NOT_YOUR_TURN;
      const id = toId(a);
      if (id === null) return tx("낼 카드를 고르세요", "Choose cards to play");
      if (R.isLegal(G, id)) return true;
      const A = ACTIONS[id], h = G.hands[p];
      if (A.pass) return tx("선은 패스할 수 없습니다 — 아무 조합이나 내세요", "The leader can't pass — play any set");
      if ((A.rank !== JESTER && h[A.rank] < A.plain) || h[JESTER] < A.jesters) return tx("가진 카드보다 많이 낼 수 없습니다", "You can't play more cards than you have");
      const t = G.trick;
      if (A.rank === JESTER) return tx("광대만으로는 선일 때만 낼 수 있습니다", "Jesters alone can only be played when leading");
      return tx(`${t.count}장, ${t.rank}보다 낮은 숫자를 내야 합니다`, `You must play ${cardsEn(t.count)} lower than ${t.rank}`);
    }
    if (G.phase === "revolution") {
      if (p !== revoltAsk(S)) return NOT_YOUR_TURN;
      if (typeof a.revolt !== "boolean") return tx("혁명 여부를 고르세요", "Choose whether to declare a revolution");
      return true;
    }
    if (G.phase === "tax") {
      const x = curTax(S);
      if (!x || p !== x.lord) return NOT_YOUR_TURN;
      const c = a.cards;
      if (!Array.isArray(c) || c.length !== x.k) return tx(`돌려줄 카드 ${x.k}장을 고르세요`, `Choose ${cardsEn(x.k)} to give back`);
      if (!c.every(r => Number.isInteger(r) && r >= 1 && r <= 13)) return tx("카드가 올바르지 않습니다", "Invalid cards");
      const need = new Array(14).fill(0);
      c.forEach(r => need[r]++);
      for (let r = 1; r <= 13; r++) if (need[r] > G.hands[p][r]) return tx("가진 카드만 돌려줄 수 있습니다", "You can only give back cards you hold");
      return true;
    }
    return tx("지금은 둘 차례가 아닙니다", "It's not your turn to act");
  },

  apply(S, p, a) {
    const G = S.g;
    if (G.phase === "revolution") {
      if (a.revolt) return doRevolt(S, p);
      // only the player knows they kept the Jesters hidden
      return [{ type: "revoltNo", p, only: p }, ...startTax(S)];
    }
    if (G.phase === "tax") {
      const x = curTax(S);
      R.transfer(G, x.lord, x.peon, a.cards);
      x.down = a.cards.slice();
      S.tax.i++; S.tax.stage = "up";
      return [{ type: "tax", dir: "down", from: x.lord, to: x.peon, n: x.k, ranks: a.cards.slice(),
        text: tx(`{${x.lord}} 님이 {${x.peon}} 님에게 ${x.k}장을 돌려주었습니다`, `{${x.lord}} gives ${cardsEn(x.k)} back to {${x.peon}}`) }];
    }
    // Play
    const id = toId(a), A = ACTIONS[id], before = G.trick;
    const r = R.act(G, id);
    const ev = [];
    if (A.pass) {
      S.trickLog.push({ p, pass: true });
      ev.push({ type: "pass", p });
    } else {
      S.prevTrick = null;
      S.trickLog.push({ p, rank: A.rank, plain: A.plain, jesters: A.jesters });
      ev.push({ type: "play", p, rank: A.rank, plain: A.plain, jesters: A.jesters, count: A.count, lead: !before });
    }
    if (r.finished) {
      const t = R.titleCode(r.finished - 1, G.n);
      ev.push({ type: "out", p, place: r.finished, title: t,
        text: tx(`{${p}} 님이 ${r.finished}번째로 패를 털었습니다 — ${TITLE_NAMES[t].ko}`, `{${p}} goes out ${ordEn(r.finished)} — ${TITLE_NAMES[t].en}`) });
    }
    if (r.last !== undefined) {
      ev.push({ type: "out", p: r.last, place: G.n, title: T.GP, last: true,
        text: tx(`{${r.last}} 님이 마지막까지 남았습니다 — 대농노`, `{${r.last}} is left holding cards — Greater Peon`) });
    }
    if (r.trickEnd) {
      const t = A.pass ? before : G.trick;
      S.prevTrick = t ? { rank: t.rank, plain: t.plain, jesters: t.jesters, count: t.count, by: t.by, leader: r.trickEnd.leader } : null;
      S.trickLog = [];
      ev.push({ type: "trickEnd", winner: r.trickEnd.winner, leader: r.trickEnd.leader });
    }
    if (r.roundEnd) {
      ev.push({ type: "roundEnd", round: G.round, finish: G.finish.slice(),
        text: tx(`라운드 ${G.round} 끝 — 1등 {${G.finish[0]}} 님`, `Round ${G.round} won by {${G.finish[0]}}`) });
    }
    return ev;
  },

  step(S) {
    const G = S.g;
    switch (G.phase) {
      case "draw": {
        const r = R.seatingDraw(G);
        S.draw = r;
        const lo = label(r.draws.find(d => d.p === r.order[0]).rank);
        return [{ type: "draw", draws: r.draws, order: r.order,
          text: tx(`자리 뽑기 — 가장 낮은 카드(${lo.ko})를 뽑은 {${r.order[0]}} 님이 첫 선`,
                   `Seat draw — {${r.order[0]}} drew the lowest card (${lo.en}) and leads first`) }];
      }
      case "deal": return dealRound(S);
      case "revolution": {
        const c = revoltCandidate(S);
        if (c >= 0) return doRevolt(S, c);          // the Greater Peon always declares a great revolution (not pending, so it lands here)
        return startTax(S);
      }
      case "tax": {
        const tq = S.tax;
        if (tq.i < tq.pairs.length) {
          const x = tq.pairs[tq.i];
          const up = R.tribute(G, x.peon, x.k);
          R.transfer(G, x.peon, x.lord, up);
          x.up = up; tq.stage = "return";
          return [{ type: "tax", dir: "up", from: x.peon, to: x.lord, n: x.k, ranks: up.slice(),
            text: tx(`{${x.peon}} 님이 {${x.lord}} 님에게 ${x.k}장을 바쳤습니다`, `{${x.peon}} pays ${cardsEn(x.k)} in tribute to {${x.lord}}`) }];
        }
        tq.done = true;
        R.finishTax(G);
        S.trickLog = []; S.prevTrick = null;
        return [{ type: "taxDone" }, { type: "lead", p: R.current(G) }];
      }
      case "roundEnd": {
        const sum = R.endRound(G);
        S.history.push({ round: sum.round, finish: sum.finish, points: sum.points });
        const ev = [{ type: "round", ...sum }];
        if (G.phase === "deal") ev.push(...dealRound(S));
        else ev.push({ type: "over", text: tx("게임 끝", "Game over") });
        return ev;
      }
    }
    return [];
  },

  delay(S) {
    const G = S.g;
    switch (G.phase) {
      case "draw": return 700;
      case "deal": return 4800;                                  // show the seat draw result
      case "revolution": return 1400 + Math.random() * 1200;     // similar wait with or without a candidate (hides who holds both Jesters)
      case "tax": return S.tax && S.tax.i < S.tax.pairs.length ? 1300 : 1100;
      case "roundEnd": return 5500;                              // show the round standings and new titles
    }
    return 800;
  },

  timeout(S, p, kind) {
    const G = S.g;
    if (kind === "revolt") return { revolt: false };
    if (kind === "return") { const x = curTax(S); return { cards: R.giveBackDefault(G, p, x ? x.k : 0) }; }
    // pass when following, a sensible play when leading (same as the original)
    if (G.trick) return { pass: true };
    return { id: AI.normal(G, p, () => 0.99) };
  },

  ai(S, p, { level = "normal", rng = Math.random } = {}) {
    const G = S.g;
    if (G.phase === "revolution") return { revolt: AI.revolt(G, p, rng) };
    if (G.phase === "tax") { const x = curTax(S); return { cards: R.giveBackDefault(G, p, x.k) }; }
    if (level === "hard" && POLICY) return { id: AI.learned(G, p, POLICY, HARD_TAU, rng) };
    return { id: AI.choose(G, p, level, rng) };
  },

  thinkTime(S, p, kind) {
    if (kind === "revolt") return 1400 + Math.random() * 1200;
    if (kind === "return") return 900 + Math.random() * 500;
    return 650 + Math.random() * 550;
  },

  /* p = -1 is the public view (spectators, watching screens, the public replay): an empty hand, no question,
     no tax contents and the same neutral status line as any uninvolved seat */
  view(S, p) {
    const G = S.g, phase = G.phase === "revolution" ? "tax" : G.phase;
    const me = p >= 0 && p < G.n;
    let ask = null;
    if (me && G.phase === "revolution" && revoltAsk(S) === p) ask = { kind: "revolt", title: G.titles[p] };
    const x = curTax(S);
    if (me && x && x.lord === p) ask = { kind: "return", k: x.k, peon: x.peon, received: x.up.slice() };
    const tax = S.tax ? {
      i: S.tax.i, stage: S.tax.stage, done: S.tax.done,
      pairs: S.tax.pairs.map(t => {
        const mine = me && (t.peon === p || t.lord === p);
        return { peon: t.peon, lord: t.lord, k: t.k, upDone: !!t.up, downDone: !!t.down, up: mine && t.up ? t.up.slice() : null, down: mine && t.down ? t.down.slice() : null };
      })
    } : null;
    const turn = G.phase === "play" ? R.current(G) : -1;
    return {
      me: p, n: G.n, phase, round: Math.min(G.round, G.rounds), rounds: G.rounds, assist: S.assist, passLock: !!G.passLock,
      seats: G.seats.slice(), titles: G.titles.slice(), scores: G.scores.slice(), sizes: sizes(G),
      finish: G.finish.slice(), passed: G.passed.slice(), lastAct: G.lastAct.slice(),
      trick: G.trick ? { ...G.trick } : null, prevTrick: S.prevTrick, trickLog: S.trickLog.slice(),
      turn, reveal: G.reveal, draw: S.draw, tax, ask,
      hand: me ? G.hands[p].slice() : new Array(14).fill(0),
      history: S.history,
      status: statusFor(S, p, turn, ask)
    };
  },

  /* p = -1 (spectators, the public replay view) is treated like any uninvolved seat: no private events, no tax contents */
  filterEvent(ev, p) {
    if (ev.only !== undefined && ev.only !== p) return null;
    if (ev.type === "tax" && (p < 0 || (p !== ev.from && p !== ev.to))) return { ...ev, ranks: null };
    return ev;
  },

  over(S) { return S.g.phase === "over"; },

  results(S) {
    const G = S.g, last = G.seats;   // ties: whoever placed higher in the last round comes first
    const order = [...Array(G.n).keys()].sort((a, b) => G.scores[b] - G.scores[a] || last.indexOf(a) - last.indexOf(b));
    return order.map((p, i) => {
      const ts = S.history.map(h => TITLE_SHORT[R.titleCode(h.finish.indexOf(p), G.n)]);
      return { p, rank: i + 1, score: G.scores[p],
        note: tx("라운드별: " + ts.map(t => t.ko).join(" → "), "By round: " + ts.map(t => t.en).join(" → ")) };
    });
  },

  /* ---------- For tests ---------- */
  randomAction(S, p, rng, kind) {
    const G = S.g;
    if (G.phase === "revolution") return { revolt: rng() < 0.5 };
    if (G.phase === "tax") {
      const x = curTax(S), pool = [];
      for (let r = 1; r <= 13; r++) for (let c = 0; c < G.hands[p][r]; c++) pool.push(r);
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      return { cards: pool.slice(0, x.k) };
    }
    const ids = R.legal(G), id = ids[Math.floor(rng() * ids.length)], A = ACTIONS[id], f = rng();
    if (A.pass) return f < 0.5 ? { pass: true } : { id: 0 };
    return f < 0.5 ? { id } : { rank: A.rank, plain: A.plain, jesters: A.jesters };
  },

  check(S) {
    const G = S.g;
    const dealt = G.phase !== "draw" && G.phase !== "deal";   // nobody holds cards until the deal (through the "deal" phase)
    for (let r = 1; r <= 13; r++) {
      let s = G.played[r];
      for (let p = 0; p < G.n; p++) { if (G.hands[p][r] < 0) return `negative card count p${p} r${r}`; s += G.hands[p][r]; }
      const want = dealt ? R.TOTAL(r) : 0;
      if (s !== want) return `wrong number of ${r} cards: ${s} (expected ${want})`;
    }
    let total = 0;
    for (let p = 0; p < G.n; p++) total += R.handSize(G, p);
    for (let r = 1; r <= 13; r++) total += G.played[r];
    if (total !== (dealt ? 80 : 0)) return `card total ${total}`;
    // Scores must equal the sum of the round records, and every finished round hands out n(n+1)/2 points
    const sum = new Array(G.n).fill(0);
    for (const h of S.history) {
      if (h.finish.length !== G.n || new Set(h.finish).size !== G.n) return `round ${h.round}: bad finishing order`;
      for (let i = 0; i < G.n; i++) {
        if (h.points[i] !== G.n - i) return `round ${h.round}: place ${i + 1} scored ${h.points[i]}`;
        sum[h.finish[i]] += h.points[i];
      }
    }
    if (sum.some((s, q) => s !== G.scores[q])) return `scores differ from round records ${G.scores} vs ${sum}`;
    if (S.history.length !== G.round - 1) return `round record count ${S.history.length} ≠ ${G.round - 1}`;
    const tot = G.scores.reduce((a, b) => a + b, 0);
    if (tot !== S.history.length * G.n * (G.n + 1) / 2) return `score total ${tot}`;
    if (new Set(G.finish).size !== G.finish.length) return "the same player went out twice";
    if (G.phase === "play") {
      for (const q of G.finish) if (R.handSize(G, q)) return `p${q} went out but still holds cards`;
      if (!R.handSize(G, R.current(G))) return "turn given to a player without cards";
    }
    return true;
  },

  leak(S, p, v) {
    const G = S.g;
    const ALLOWED = ["me", "n", "phase", "round", "rounds", "assist", "passLock", "seats", "titles", "scores", "sizes", "finish", "passed", "lastAct",
      "trick", "prevTrick", "trickLog", "turn", "reveal", "draw", "tax", "ask", "hand", "history", "status"];
    for (const k of Object.keys(v)) if (!ALLOWED.includes(k)) return `unknown view key ${k}`;
    if (p < 0) {
      // public view (spectators): no cards in hand, no question, no tax contents
      if (!Array.isArray(v.hand) || v.hand.some(x => x !== 0)) return "the public view holds cards";
      if (v.ask) return "the public view has a question";
      if (v.me !== -1) return "the public view claims a seat";
    } else if (JSON.stringify(v.hand) !== JSON.stringify(G.hands[p])) return "my hand differs from the view";
    if (JSON.stringify(v).includes('"hands"') || JSON.stringify(v).includes('"played"')) return "other hands / played-card counts in the view";
    if (v.tax) for (const t of v.tax.pairs) if (t.peon !== p && t.lord !== p && (t.up || t.down)) return "someone else's tax cards are visible";
    if (v.ask) {
      if (v.ask.kind === "revolt" && revoltAsk(S) !== p) return "someone else's revolution question is visible";
      if (v.ask.kind === "return" && (!curTax(S) || curTax(S).lord !== p)) return "someone else's give-back question is visible";
    }
    if (G.phase === "revolution" && (p < 0 || revoltAsk(S) !== p) && JSON.stringify(v.status) !== JSON.stringify(PREP_TAX)) return "status line reveals the revolution candidate";
    return true;
  },
  stepLimit: 30000,
  spectate: true            // view(S, -1) is the public table (no hand, no tax contents, no revolution question)
};

function statusFor(S, p, turn, ask) {
  const G = S.g, rd = `${Math.min(G.round, G.rounds)}/${G.rounds}R`;
  switch (G.phase) {
    case "draw": return tx("자리 뽑기 준비", "Getting ready to draw seats");
    case "deal": return tx("자리를 정했습니다 — 곧 카드를 나눕니다", "Seats are set — dealing soon");
    case "revolution": return ask ? tx("광대 2장! 혁명을 선언할까요?", "Both Jesters! Declare a revolution?") : PREP_TAX;
    case "tax": {
      const x = curTax(S);
      if (x) return x.lord === p ? tx(`돌려줄 카드 ${x.k}장을 고르세요`, `Choose ${cardsEn(x.k)} to give back`)
                                 : tx(`{${x.lord}} 님이 돌려줄 카드를 고르는 중`, `{${x.lord}} is choosing cards to give back`);
      return tx(`${rd} · 세금`, `${rd} · Tax`);
    }
    case "play": {
      if (turn !== p) return tx(`${rd} · {${turn}} 님 차례`, `${rd} · {${turn}}'s turn`);
      const t = G.trick;
      return t ? tx(`${rd} · 내 차례 — ${t.count}장, ${t.rank}보다 낮게`, `${rd} · Your turn — ${cardsEn(t.count)}, lower than ${t.rank}`)
               : tx(`${rd} · 내 차례 — 선 (아무 조합)`, `${rd} · Your lead (any set)`);
    }
    case "roundEnd": return tx(`라운드 ${G.round} 끝 — 1등 {${G.finish[0]}} 님`, `Round ${G.round} won by {${G.finish[0]}}`);
    case "over": return tx("게임 끝", "Game over");
  }
  return "";
}

export default E;
