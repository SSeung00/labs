/* Engine playouts — plays hundreds of complete games per game module.
     node tests/playout.mjs            # every game
     node tests/playout.mjs poker 2000 # one game, number of games

   Checked in every game
   - each decision: validate(AI / random action) === true, and check(S) === true after apply (if the engine provides check)
   - after decisions, every player's view(S, p) survives a JSON round trip and contains no hidden info (engine's leak check)
   - the game ends within the step limit, and results ranks start at 1 for every seat
   - the timeout(S, p, kind) action is always legal
   - games that support spectators (E.spectate): the public view(S, -1) survives a JSON round trip and leaks nothing
   - replays: running the recorded moves again from the same seed ends in exactly the same state */
import { makeRng } from "../core/rng.js";
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const gamesDir = join(here, "..", "games");
const only = process.argv[2];
const GAMES_N = +(process.argv[3] || 300);

const ids = readdirSync(gamesDir, { withFileTypes: true }).filter(d => d.isDirectory() && existsSync(join(gamesDir, d.name, "engine.js"))).map(d => d.name);

let failed = 0;
for (const id of ids) {
  if (only && id !== only) continue;
  const E = (await import(pathToFileURL(join(gamesDir, id, "engine.js")).href)).default;
  const t0 = Date.now();
  let steps = 0, decisions = 0, maxSteps = 0;
  const rankHist = {};
  try {
    for (let g = 0; g < GAMES_N; g++) {
      const n = E.players.min + (g % (E.players.max - E.players.min + 1));
      const settings = {};
      for (const s of E.settings || []) settings[s.key] = s.values[g % s.values.length];
      const rng = makeRng(1000 + g);
      const S = E.setup({ n, seed: 77777 + g * 7919, settings });
      const log = [];                // as recorded by the host's runner: 0 = step, [p, action] = apply
      const levels = ["easy", "normal", "hard"];
      let k = 0;
      const LIMIT = E.stepLimit || 20000;
      while (!E.over(S)) {
        if (++k > LIMIT) throw new Error(`game ${g}: did not end within ${LIMIT} steps`);
        const pend = E.pending(S);
        if (!pend.length) { log.push(0); E.step(S); check(E, S, g, "step"); continue; }
        // several players pending at once: pick any
        const x = pend[Math.floor(rng() * pend.length)];
        const to = E.timeout(S, x.p, x.kind);
        const okT = E.validate(S, x.p, to);
        if (okT !== true) throw new Error(`game ${g}: illegal timeout action (${x.kind}): ${JSON.stringify(okT)} ${JSON.stringify(to)}`);
        const mode = (g + k) % 3;   // 0: random action, 1·2: AI
        const a = mode === 0 && E.randomAction ? E.randomAction(S, x.p, rng, x.kind) : E.ai(S, x.p, { level: levels[(g + x.p) % 3], rng });
        const ok = E.validate(S, x.p, a);
        if (ok !== true) throw new Error(`game ${g}: illegal ${mode ? "AI" : "random"} action (${x.kind}, p${x.p}): ${JSON.stringify(ok)} ${JSON.stringify(a)}`);
        log.push([x.p, JSON.parse(JSON.stringify(a))]);
        const ev = E.apply(S, x.p, a);
        if (!Array.isArray(ev)) throw new Error(`game ${g}: apply did not return an array of events`);
        for (let p = E.spectate ? -1 : 0; p < S.n; p++) for (const e of ev) {    // -1: spectators
          const f = E.filterEvent ? E.filterEvent(e, p, S) : e;
          if (f) JSON.stringify(f);
        }
        decisions++;
        check(E, S, g, "apply");
        if (k % 7 === 0) views(E, S, g);
      }
      views(E, S, g);
      replay(E, S, g, { n, seed: 77777 + g * 7919, settings, log });
      const res = E.results(S);
      const ranks = res.map(r => r.rank).sort((a, b) => a - b);
      if (res.length !== S.n || ranks[0] !== 1) throw new Error(`game ${g}: bad results ${JSON.stringify(res)}`);
      for (const r of res) rankHist[r.rank] = (rankHist[r.rank] || 0) + 1;
      steps += k; maxSteps = Math.max(maxSteps, k);
    }
    console.log(`✓ ${id.padEnd(8)} ${GAMES_N} games · ${decisions} decisions · avg ${Math.round(steps / GAMES_N)} steps/game (max ${maxSteps}) · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    failed++;
    console.log(`✗ ${id}: ${e.stack || e}`);
  }
}
process.exit(failed ? 1 : 0);

function check(E, S, g, where) {
  if (!E.check) return;
  const r = E.check(S);
  if (r !== true) throw new Error(`game ${g} (after ${where}): state check failed — ${JSON.stringify(r)}`);
}
function views(E, S, g) {
  for (let p = 0; p < S.n; p++) {
    const v = E.view(S, p);
    const back = JSON.parse(JSON.stringify(v));
    if (E.leak) { const r = E.leak(S, p, back); if (r !== true) throw new Error(`game ${g}: hidden info leaked to seat ${p} — ${JSON.stringify(r)}`); }
  }
  if (E.spectate) {
    const back = JSON.parse(JSON.stringify(E.view(S, -1)));
    if (E.leak) { const r = E.leak(S, -1, back); if (r !== true) throw new Error(`game ${g}: hidden info leaked to spectators — ${JSON.stringify(r)}`); }
  }
}
/* Replay (core/replay.js): the same seed and the same moves must give the same final state */
function replay(E, S, g, rec) {
  const R = E.setup({ n: rec.n, seed: rec.seed, settings: rec.settings });
  for (const x of rec.log) { if (x === 0) E.step(R); else E.apply(R, x[0], x[1]); }
  if (JSON.stringify(R) !== JSON.stringify(S)) throw new Error(`game ${g}: the replay ended in a different state`);
}
