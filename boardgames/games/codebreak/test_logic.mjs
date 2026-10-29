/* Secret Numbers — checks for the shared deduction (logic.js) and the AI levels.
     node games/codebreak/test_logic.mjs
   1. Soundness: in many random games, for every seat (and the public view) and every tile hidden from it, the tile's real
      number is always among the numbers the deduction calls possible, and odds add up to 1.
   2. Strength: harder AI levels should beat easier ones head to head. */
import E from "./engine.js";
import { analyze, numOf } from "./logic.js";
import { makeRng } from "../../core/rng.js";

let fails = 0;
const fail = msg => { fails++; if (fails < 10) console.log("✗ " + msg); };

/* 1. Soundness */
let checked = 0, exactRuns = 0;
for (let g = 0; g < 300; g++) {
  const n = 2 + (g % 3), jokers = g % 2 === 1;
  const S = E.setup({ n, seed: 1234 + g * 31, settings: { jokers } });
  const rng = makeRng(99 + g);
  let k = 0;
  while (!E.over(S) && k++ < 500) {
    const pend = E.pending(S);
    if (!pend.length) { E.step(S); continue; }
    for (const p of [-1, ...Array(n).keys()]) {
      const v = JSON.parse(JSON.stringify(E.view(S, p)));
      const an = analyze(v, { exact: g % 3 === 0 });
      if (an.exact) exactRuns++;
      S.rows.forEach((row, q) => row.forEach((t, i) => {
        const a = an.tiles[q][i];
        if (t.up || q === p) { if (a) fail(`game ${g}: known tile ${q}:${i} analysed for seat ${p}`); return; }
        checked++;
        if (!a) return fail(`game ${g}: hidden tile ${q}:${i} not analysed for seat ${p}`);
        if (!a.nums.includes(numOf(t.k))) fail(`game ${g}: seat ${p} ruled out the real number ${numOf(t.k)} of tile ${q}:${i} (${a.nums})`);
        const sum = a.nums.reduce((s, x) => s + a.p[x], 0);
        if (Math.abs(sum - 1) > 1e-6) fail(`game ${g}: odds add up to ${sum}`);
      }));
      if (S.drawn !== null && p !== S.turn && an.drawn && !an.drawn.includes(numOf(S.drawn))) fail(`game ${g}: drawn tile ruled out for seat ${p}`);
    }
    const x = pend[0];
    const a = E.ai(S, x.p, { level: ["easy", "normal", "hard"][(g + k) % 3], rng });
    if (E.validate(S, x.p, a) !== true) { fail(`game ${g}: illegal AI action`); break; }
    E.apply(S, x.p, a);
  }
}
console.log(`soundness: ${checked} hidden tiles checked (${exactRuns} exact analyses) — ${fails ? "FAILED" : "ok"}`);

/* 2. Strength: two levels head to head (2 players, both orders), plus timing */
function duel(a, b, games) {
  let winsA = 0, t0 = performance.now(), maxMs = 0;
  for (let g = 0; g < games; g++) {
    const S = E.setup({ n: 2, seed: 777 + g * 13, settings: { jokers: g % 4 === 3 } });
    const lv = g % 2 ? [a, b] : [b, a];
    const rng = makeRng(5 + g);
    while (!E.over(S)) {
      const pend = E.pending(S);
      if (!pend.length) { E.step(S); continue; }
      const p = pend[0].p, t = performance.now();
      E.apply(S, p, E.ai(S, p, { level: lv[p], rng }));
      maxMs = Math.max(maxMs, performance.now() - t);
    }
    if (lv[S.winner] === a) winsA++;
  }
  console.log(`${a} vs ${b}: ${a} wins ${Math.round(100 * winsA / games)}% of ${games} · ${((performance.now() - t0) / games).toFixed(1)} ms/game · slowest move ${maxMs.toFixed(1)} ms`);
  return winsA / games;
}
const r1 = duel("normal", "easy", 400), r2 = duel("hard", "normal", 400), r3 = duel("hard", "easy", 400);
if (r1 < 0.6 || r3 < 0.6 || r2 < 0.5) fail("a harder level doesn't beat an easier one");
process.exit(fails ? 1 : 0);
