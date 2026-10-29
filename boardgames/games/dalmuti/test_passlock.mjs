/* "Pass = out of the trick" house rule: random and AI games, checking every move.
   node games/dalmuti/test_passlock.mjs */
import * as R from "./rules.js";
import * as AI from "./ai.js";
import { makeRng } from "../../core/rng.js";

let fails = 0, tricks = 0, moves = 0;
const fail = m => { if (fails++ < 10) console.log("  ✗ " + m); };

for (let g = 0; g < 300; g++) {
  const n = 4 + (g % 5), rng = makeRng(1234 + g);
  const G = R.create({ n, rounds: 3, seed: 999 + g * 31, passLock: true });
  R.seatingDraw(G);
  let out = new Set();                     // players who passed in the current trick
  let guard = 0;
  while (G.phase !== "over" && guard++ < 20000) {
    if (G.phase === "deal") { R.deal(G); out = new Set(); continue; }
    if (G.phase === "revolution") { R.skipRevolution(G); R.finishTax(G); out = new Set(); continue; }
    if (G.phase === "roundEnd") { R.endRound(G); continue; }
    const p = R.current(G);
    if (out.has(p)) fail(`game ${g}: p${p} got a turn after passing in this trick`);
    const ids = R.legal(G);
    const id = g % 2 ? AI.choose(G, p, "normal", rng) : ids[Math.floor(rng() * ids.length)];
    const ev = R.act(G, id);
    moves++;
    if (R.ACTIONS[id].pass) out.add(p);
    if (ev.trickEnd || ev.roundEnd) {
      // the trick ends only when everyone else still holding cards has passed
      if (ev.trickEnd) {
        const owner = ev.trickEnd.winner;
        for (const q of G.seats) if (q !== owner && R.handSize(G, q) > 0 && !out.has(q)) fail(`game ${g}: trick ended but p${q} never passed`);
      }
      out = new Set(); tricks++;
    }
  }
  if (G.phase !== "over") fail(`game ${g}: did not finish`);
}
console.log(`pass lock: 300 games · ${tricks} tricks · ${moves} moves`);
console.log(fails ? `✗ ${fails} failures` : "✓ A player who passes sits out until the trick ends");
process.exit(fails ? 1 : 0);
