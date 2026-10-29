/* Dalmuti port test — do rules.js · ai.js · engine.js in this folder match the original (C:\Users\user\dalmuti\web\engine.js · ai.js)?
     node games/dalmuti/test_port.mjs [games=200]

   A. rules.js ↔ original engine.js: play games side by side with the same seed and random choices, comparing the legal-move
      list and the whole state at every step
   B. room engine.js (runner flow) ↔ original: drive the room engine with random and AI actions, make the original do the same,
      and compare states
   C. AI: with the same state and random sequence, do easy / normal / hard / learned policy / revolution choice pick the same move?
   D. Hidden info: do tax contents and the revolution question reach only the players involved? */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import * as R from "./rules.js";
import * as A from "./ai.js";
import HUB, { loadLearned } from "./engine.js";
import { makeRng } from "../../core/rng.js";

const SRC = "C:/Users/user/dalmuti/web/";
const require = createRequire(import.meta.url);
const O = require(SRC + "engine.js");
const OA = require(SRC + "ai.js");
const GAMES = +(process.argv[2] || 200);

let fails = 0;
const fail = (where, msg) => { fails++; if (fails <= 20) console.log(`  ✗ ${where}: ${msg}`); };
const J = x => JSON.stringify(x);
function fnv(s, h = 0x811c9dc5) {
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
const stateKey = G => J({ hands: G.hands, played: G.played, titles: G.titles, scores: G.scores, seats: G.seats, trick: G.trick,
  turn: G.turn, phase: G.phase, finish: G.finish, passed: G.passed, rs: G.rs, round: G.round, reveal: G.reveal, lastAct: G.lastAct });

/* ---------- Basic constants ---------- */
if (J(R.ACTIONS) !== J(O.ACTIONS)) fail("constants", "ACTIONS list differs");
if (R.ACTIONS.length !== 237) fail("constants", `action count ${R.ACTIONS.length}`);
if (J(R.T) !== J(O.T) || R.OBS !== O.OBS || R.ACT !== O.ACT || R.JESTER !== O.JESTER) fail("constants", "T/OBS/ACT/JESTER differ");
{ const g1 = { rs: -123456 }, g2 = { rs: -123456 };
  for (let i = 0; i < 10000; i++) if (R.rand(g1) !== O.rand(g2)) { fail("rng", `value #${i} differs`); break; } }

/* ---------- A. rules.js ↔ original ---------- */
let hashA = 0x811c9dc5, stepsA = 0;
{
  const t0 = Date.now();
  for (let g = 0; g < GAMES; g++) {
    const n = 4 + (g % 5), rounds = [3, 5, 8][g % 3], seed = (g * 2654435761) | 0;
    const P = R.create({ n, rounds, seed }), Q = O.create({ n, rounds, seed });
    const rng = makeRng(9000 + g);
    const same = (what, a, b) => { if (J(a) !== J(b)) { fail(`A game ${g} ${what}`, `${J(a).slice(0, 120)} ≠ ${J(b).slice(0, 120)}`); return false; } return true; };
    let k = 0;
    while (P.phase !== "over") {
      if (++k > 20000) { fail(`A game ${g}`, "did not end"); break; }
      const ph = P.phase;
      if (ph === "draw") same("seatingDraw", R.seatingDraw(P), O.seatingDraw(Q));
      else if (ph === "deal") { R.deal(P); O.deal(Q); }
      else if (ph === "revolution") {
        const c = R.revolutionCandidate(P);
        same("candidate", c, O.revolutionCandidate(Q));
        if (c >= 0 && (P.titles[c] === R.T.GP || rng() < 0.5)) same("revolution", R.declareRevolution(P, c), O.declareRevolution(Q, c));
        else { R.skipRevolution(P); O.skipRevolution(Q); }
      } else if (ph === "tax") {
        const pairs = R.taxPairs(P);
        same("taxPairs", pairs, O.taxPairs(Q));
        for (const t of pairs) {
          const up = R.tribute(P, t.peon, t.k);
          same("tribute", up, O.tribute(Q, t.peon, t.k));
          R.transfer(P, t.peon, t.lord, up); O.transfer(Q, t.peon, t.lord, up);
          const def = R.giveBackDefault(P, t.lord, t.k);
          same("giveBackDefault", def, O.giveBackDefault(Q, t.lord, t.k));
          // half default give-back, half random cards
          let back = def;
          if (rng() < 0.5) {
            const pool = []; for (let r = 1; r <= 13; r++) for (let c = 0; c < P.hands[t.lord][r]; c++) pool.push(r);
            back = []; while (back.length < t.k) back.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
          }
          R.transfer(P, t.lord, t.peon, back); O.transfer(Q, t.lord, t.peon, back);
        }
        R.finishTax(P); O.finishTax(Q);
      } else if (ph === "play") {
        const L1 = R.legal(P), L2 = O.legal(Q);
        if (!same("legal", L1, L2)) break;
        // isLegal must agree exactly with the legal list (all 237 actions)
        for (let id = 0; id < 237; id++) if (R.isLegal(P, id) !== O.isLegal(Q, id) || R.isLegal(P, id) !== L1.includes(id)) { fail(`A game ${g}`, `isLegal(${id}) mismatch`); break; }
        const p = R.current(P);
        if (k % 5 === 0) { same("encodeObs", R.encodeObs(P, p), O.encodeObs(Q, p)); same("encodeAct", R.encodeAct(P, p, L1[0]), O.encodeAct(Q, p, L1[0])); }
        const id = L1[Math.floor(rng() * L1.length)];
        same("act", R.act(P, id), O.act(Q, id));
        hashA = fnv(String(id), hashA);
      } else if (ph === "roundEnd") same("endRound", R.endRound(P), O.endRound(Q));
      if (!same(`state(${ph})`, stateKey(P), stateKey(Q))) break;
      if (J(P) !== J(Q)) { fail(`A game ${g}`, "full state (JSON) differs"); break; }
      hashA = fnv(stateKey(P), hashA);
      stepsA++;
    }
  }
  console.log(`A  rules.js ↔ original engine.js: ${GAMES} games · ${stepsA} steps · state hash ${hashA.toString(16)} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

/* ---------- Learned policy (the original policy.js has the form window.DALMUTI_POLICY = {...};) ---------- */
const rawPolicy = (() => {
  const s = readFileSync(SRC + "policy.js", "utf8"), key = "window.DALMUTI_POLICY = ";
  let b = s.slice(s.indexOf(key) + key.length).trim(); if (b.endsWith(";")) b = b.slice(0, -1);
  return JSON.parse(b);
})();
const OPOL = OA.loadPolicy(rawPolicy);
const MYPOL = A.loadPolicy((await import("./policy.js")).default);
if (!OPOL || !MYPOL) fail("policy", "could not load the policy");
if (J([...MYPOL.layers[0].w.slice(0, 50)]) !== J([...OPOL.layers[0].w.slice(0, 50)])) fail("policy", "weights differ from the original");
await loadLearned();   // the room engine's "hard" AI uses the learned policy too

/* ---------- C. AI comparison (on sampled states during B) ---------- */
let aiChecks = 0;
function compareAI(G, p, where) {
  // The original advances G.rs via E.rand(G) → give our AI, as rnd, the rand of a copy starting from the same G.rs
  const pairs = [
    ["easy", g => OA.easy(g, p), (g, rnd) => A.easy(g, p, rnd)],
    ["normal", g => OA.normal(g, p), (g, rnd) => A.normal(g, p, rnd)],
    ["hard", g => OA.hard(g, p), (g, rnd) => A.hard(g, p, rnd)],
    ["learned τ0", g => OA.learned(g, p, OPOL, 0), (g, rnd) => A.learned(g, p, MYPOL, 0, rnd)],
    ["learned τ.05", g => OA.learned(g, p, OPOL, 0.05), (g, rnd) => A.learned(g, p, MYPOL, 0.05, rnd)]
  ];
  for (const [name, orig, mine] of pairs) {
    const g1 = O.clone(G), g2 = R.clone(G), g3 = R.clone(G);
    const a = orig(g1), b = mine(g2, () => R.rand(g3));
    if (a !== b) fail(where, `AI ${name}: original ${a} ≠ port ${b}`);
    if (J(g2) !== J(G)) fail(where, `AI ${name} changed the state`);
    aiChecks++;
  }
}

/* ---------- B. room engine ↔ original ---------- */
let hashB = 0x811c9dc5, decisions = 0, revolts = 0, greatRevolts = 0, returnsCustom = 0, privacyChecks = 0;
{
  const t0 = Date.now();
  const levels = ["easy", "normal", "hard"];
  for (let g = 0; g < GAMES; g++) {
    const n = 4 + (g % 5), rounds = [3, 5, 8][(g >> 1) % 3], seed = (g * 40503 + 17) | 0;
    const S = HUB.setup({ n, seed, settings: { rounds, assist: g % 2 === 0 } });
    const Q = O.create({ n, rounds, seed });
    const rng = makeRng(31337 + g);
    const where = () => `B game ${g} R${S.g.round} ${S.g.phase}`;
    const sync = what => {
      if (J(S.g) !== J(Q)) { fail(where(), `state differs from the original after ${what}`); return false; }
      hashB = fnv(stateKey(Q), hashB); return true;
    };
    let k = 0, ok = true;
    while (ok && !HUB.over(S)) {
      if (++k > 30000) { fail(where(), "did not end"); break; }
      const pend = HUB.pending(S);
      if (!pend.length) {
        const ph = S.g.phase;
        // make the original do the same
        const cand = ph === "revolution" ? O.revolutionCandidate(Q) : -1;
        const evs = HUB.step(S);
        if (ph === "draw") { const r = O.seatingDraw(Q); const e = evs.find(e => e.type === "draw"); if (J({ draws: e.draws, order: e.order }) !== J(r)) fail(where(), "seat draw result differs"); }
        else if (ph === "deal") O.deal(Q);
        else if (ph === "revolution") {
          if (cand >= 0) { if (Q.titles[cand] !== O.T.GP) fail(where(), "skipped asking a candidate who is not the Greater Peon"); O.declareRevolution(Q, cand); greatRevolts++; }
          else O.skipRevolution(Q);
        } else if (ph === "tax") {
          const e = evs.find(e => e.type === "tax");
          if (e) {
            const up = O.tribute(Q, e.from, e.n);
            if (J(up) !== J(e.ranks)) fail(where(), "tribute cards differ from the original tribute");
            const pr = O.taxPairs(Q).find(x => x.peon === e.from);
            if (!pr || pr.lord !== e.to || pr.k !== e.n) fail(where(), "tax pair differs from the original");
            O.transfer(Q, e.from, e.to, up);
          } else O.finishTax(Q);
        } else if (ph === "roundEnd") {
          const sum = O.endRound(Q), e = evs.find(e => e.type === "round");
          if (J({ round: e.round, finish: e.finish, points: e.points }) !== J(sum)) fail(where(), "round scoring differs");
          if (Q.phase === "deal") O.deal(Q);
        }
        const c = HUB.check(S); if (c !== true) fail(where(), "check: " + c);
        ok = sync("step " + ph);
        continue;
      }
      const x = pend[0];
      if (pend.length !== 1) fail(where(), "several players pending at once");
      // D. Hidden info — revolution question · tax contents
      if (x.kind === "revolt") {
        if (!x.secret) fail(where(), "revolution question is not secret");
        for (let q = 0; q < n; q++) {
          const v = HUB.view(S, q);
          if (q === x.p ? !(v.ask && v.ask.kind === "revolt") : v.ask) fail(where(), `bad revolution-question view (p${q})`);
          if (q !== x.p && J(v.status) !== J(HUB.view(S, (x.p + 1) % n).status)) fail(where(), "status lines differ among non-candidates");
          privacyChecks++;
        }
      }
      if (S.g.phase === "play" && S.g.trick === null && k % 3 === 0) compareAI(S.g, R.current(S.g), where());
      if (S.g.phase === "play" && S.g.trick && k % 4 === 0) compareAI(S.g, R.current(S.g), where());
      if (x.kind === "revolt") {
        const oa = OA.revolt(O.clone(Q), x.p), g3 = R.clone(Q);
        if (oa !== A.revolt(R.clone(Q), x.p, () => R.rand(g3))) fail(where(), "revolution choice differs from the original");
      }
      // pick an action: random / AI (mixed levels)
      const mode = (g + k) % 3;
      const a = mode === 0 ? HUB.randomAction(S, x.p, rng, x.kind) : HUB.ai(S, x.p, { level: levels[(g + x.p + k) % 3], rng });
      const v = HUB.validate(S, x.p, a);
      if (v !== true) { fail(where(), `action rejected ${J(a)}: ${J(v)}`); break; }
      // wrong actions must be rejected
      if (x.kind === "play" && S.g.trick && HUB.validate(S, x.p, { rank: S.g.trick.rank, plain: 1, jesters: 0 }) === true) fail(where(), "accepted the same number");
      if (x.kind === "play" && (x.p + 1) % n !== x.p && HUB.validate(S, (x.p + 1) % n, a) === true && R.current(S.g) !== (x.p + 1) % n) fail(where(), "accepted a move out of turn");
      const before = S.g.phase;
      const evs = HUB.apply(S, x.p, a);
      decisions++;
      // same action on the original
      if (before === "play") {
        const id = a.pass ? 0 : a.id !== undefined ? a.id : O.actionId(a.rank, a.plain, a.jesters);
        O.act(Q, id); hashB = fnv("p" + id, hashB);
      } else if (before === "revolution") {
        if (a.revolt) { O.declareRevolution(Q, x.p); revolts++; } else O.skipRevolution(Q);
        if (!a.revolt) for (let q = 0; q < n; q++) {
          const f = evs.map(e => HUB.filterEvent(e, q, S)).filter(Boolean);
          if (q !== x.p && f.some(e => e.type === "revoltNo")) fail(where(), "declining the revolution was revealed to others");
          privacyChecks++;
        }
      } else if (before === "tax") {
        const pr = O.taxPairs(Q).find(t => t.lord === x.p);
        if (J(a.cards.slice().sort()) !== J(O.giveBackDefault(Q, x.p, pr.k).slice().sort())) returnsCustom++;
        O.transfer(Q, x.p, pr.peon, a.cards);
        for (let q = 0; q < n; q++) {
          const f = evs.map(e => HUB.filterEvent(e, q, S)).filter(Boolean).find(e => e.type === "tax");
          const mine = q === pr.peon || q === pr.lord;
          if (mine ? J(f.ranks) !== J(a.cards) : f.ranks !== null) fail(where(), `give-back contents visible to the wrong players (p${q})`);
          privacyChecks++;
        }
      }
      const c = HUB.check(S); if (c !== true) fail(where(), "check: " + c);
      ok = sync("apply " + x.kind);
      if (ok && S.g.phase === "play") {
        if (J(R.legal(S.g)) !== J(O.legal(Q))) { fail(where(), "legal move list differs"); ok = false; }
      }
      if (k % 9 === 0) for (let q = 0; q < n; q++) { const r = HUB.leak(S, q, JSON.parse(J(HUB.view(S, q)))); if (r !== true) fail(where(), "leak: " + r); }
    }
    if (ok && J(S.g.scores) !== J(Q.scores)) fail(`B game ${g}`, "final scores differ");
    const res = HUB.results(S);
    if (res.length !== n || res[0].rank !== 1 || res.some((r, i) => i && res[i - 1].score < r.score)) fail(`B game ${g}`, "bad results");
  }
  console.log(`B  room engine.js ↔ original: ${GAMES} games · ${decisions} decisions · ${revolts} revolutions declared · ${greatRevolts} great revolutions (automatic) · ${returnsCustom} hand-picked give-backs · state hash ${hashB.toString(16)} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`C  ${aiChecks} AI comparisons (easy · normal · hard · learned τ0 · learned τ0.05 · revolution choice)`);
  console.log(`D  ${privacyChecks} hidden-info checks`);
}

if (fails) { console.log(`✗ ${fails} failures`); process.exit(1); }
console.log("✓ Identical to the original");
