/* Gold Mine — focused board-rule tests
     node games/mine/test_board.mjs                 # rule tests
     node games/mine/test_board.mjs balance 1000 5  # 1000 AI-only rounds (5 players): Miner / Traitor win rates */
import assert from "node:assert/strict";
import E, { CARDS } from "./engine.js";
import { makeRng } from "../../core/rng.js";

const rot180 = m => ((m << 2) | (m >> 2)) & 15;
const N = 1, EA = 2, SO = 4, WE = 8;
/* Korean text of a bilingual validate() error (true stays true); both languages must be present */
const ko = r => { if (r === true) return true; assert.ok(r && typeof r.ko === "string" && typeof r.en === "string", "bilingual error"); return r.ko; };

/* Take a card out of the deck, discard pile or any hand (keeps the total card count) */
function take(S, id) {
  for (const arr of [S.deck, S.discard, ...S.hands]) { const i = arr.indexOf(id); if (i >= 0) { arr.splice(i, 1); return id; } }
  throw new Error(`card ${id} not found`);
}
function onBoard(S) { return new Set(Object.values(S.board).filter(c => c.k === "p").map(c => c.id)); }
/* Id of a card matching pred — not on the board, preferably not in the current player's hand */
function cardOf(S, pred) {
  const used = onBoard(S), hand = S.hands[S.turn];
  let id = CARDS.findIndex((C, i) => pred(C) && !used.has(i) && !hand.includes(i));
  if (id < 0) id = CARDS.findIndex((C, i) => pred(C) && !used.has(i));
  assert.ok(id >= 0, "no matching card");
  return id;
}
const pathCard = (S, e, c = true) => cardOf(S, C => C.t === "path" && C.e === e && C.c === c);
/* Put a path card straight onto the board (test setup) */
function put(S, x, y, e, c = true, rot = 0) {
  const id = pathCard(S, e, c);
  take(S, id);
  S.board[`${x},${y}`] = { k: "p", id, e: rot ? rot180(e) : e, c, rot };
  return id;
}
/* Put a card into the current player's hand (hand size unchanged) */
function give(S, id) {
  const h = S.hands[S.turn];
  if (h.includes(id)) return id;
  take(S, id);
  S.deck.push(h.shift());
  h.push(id);
  return id;
}
/* East-west open path on (1,0)–(6,0) (3 horizontal straights + 3 crosses) */
function corridor(S) { for (let x = 1; x <= 6; x++) put(S, x, 0, x <= 3 ? EA | WE : 15); }
/* Fix the goal identities: index of gold among [top, middle, bottom] */
function fixGoals(S, goldAt) {
  const coal = [9, 12];
  S.goals.forEach((gl, g) => { gl.gold = g === goldAt; gl.e0 = g === goldAt ? 15 : coal.shift(); });
}
function fresh(n = 5, seed = 7) {
  const S = E.setup({ n, seed, settings: { rounds: 3 } });
  S.roles = S.roles.map(() => "m"); S.roles[1] = "s"; S.roles[2] = "s";
  S.turn = 0;
  return S;
}
function ok(S) { const r = E.check(S); assert.equal(r, true, r); }

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.stack || e}`); process.exitCode = 1; }
}

if (process.argv[2] === "balance") {
  const R = +(process.argv[3] || 1000), n = +(process.argv[4] || 5), lv = process.argv[5] || "normal";
  let mw = 0, maxMs = 0;
  const by = {};
  for (let g = 0; g < R; g++) {
    const S = E.setup({ n, seed: 4242 + g * 7919, settings: { rounds: 1 } });
    const rng = makeRng(31 + g);
    while (S.phase === "play") {
      const t = performance.now();
      const a = E.ai(S, S.turn, { level: lv, rng });
      maxMs = Math.max(maxMs, performance.now() - t);
      E.apply(S, S.turn, a);
    }
    const k = S.roles.filter(r => r === "s").length;
    by[k] = by[k] || [0, 0];
    by[k][S.res.winner === "m" ? 0 : 1]++;
    if (S.res.winner === "m") mw++;
  }
  console.log(`${n} players · AI ${lv} · ${R} rounds: Miners win ${(100 * mw / R).toFixed(1)}% · Traitors win ${(100 * (R - mw) / R).toFixed(1)}% · slowest AI move ${maxMs.toFixed(1)}ms`);
  console.log("  by number of Traitors [Miner wins, Traitor wins]:", JSON.stringify(by));
  process.exit(0);
}

console.log("Gold Mine board tests");

test("card set: 44 paths (9 dead ends) · 27 actions", () => {
  const paths = CARDS.filter(c => c.t === "path");
  assert.equal(CARDS.length, 71);
  assert.equal(paths.length, 44);
  assert.equal(paths.filter(c => !c.c).length, 9);
  assert.equal(CARDS.filter(c => c.t === "break").length, 9);
  assert.equal(CARDS.filter(c => c.t === "fix" && c.tools.length === 1).length, 6);
  assert.equal(CARDS.filter(c => c.t === "fix" && c.tools.length === 2).length, 3);
  assert.equal(CARDS.filter(c => c.t === "map").length, 6);
  assert.equal(CARDS.filter(c => c.t === "rock").length, 3);
});

test("roles · hand size", () => {
  // [players, traitor cards, miner cards, hand] — 1–2 leftover role cards (our rule: 3 · 4 · 6 · 9 players get +1 traitor card)
  for (const [n, s, m, hs] of [[3, 2, 3, 6], [4, 2, 4, 6], [5, 2, 4, 6], [6, 3, 5, 5], [7, 3, 5, 5], [8, 3, 6, 4], [9, 4, 7, 4], [10, 4, 7, 4]]) {
    const seen = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      const S = E.setup({ n, seed, settings: {} });
      const k = S.roles.filter(r => r === "s").length;
      assert.ok(k <= s && n - k <= m, `${n} players, ${k} traitors`);
      seen.add(k);
      assert.equal(S.hands[0].length, hs);
      assert.deepEqual(E.view(S, 0).roleSet, [s, m]);
      ok(S);
    }
    assert.ok(seen.size >= 2, `${n} players: traitor count never varies (${[...seen]})`);
  }
});

test("side matching: a horizontal path fits next to the entrance, a vertical one doesn't", () => {
  const S = fresh();
  const h = give(S, pathCard(S, EA | WE));
  assert.equal(E.validate(S, 0, { path: h, x: 1, y: 0, rot: 0 }), true);
  const v = give(S, pathCard(S, N | SO));
  assert.match(ko(E.validate(S, 0, { path: v, x: 1, y: 0, rot: 0 })), /맞지 않/);
  // detached cell · occupied cell
  assert.notEqual(E.validate(S, 0, { path: h, x: 3, y: 0, rot: 0 }), true);
  assert.notEqual(E.validate(S, 0, { path: h, x: 0, y: 0, rot: 0 }), true);
  ok(S);
});

test("side matching: must fit every neighbour (incl. 180° rotation)", () => {
  const S = fresh();
  put(S, 1, 0, EA | WE);          // entrance ─ (1,0)
  // ┐(S·W) on (2,0): its west side meets (1,0)'s east side → ok
  const c = give(S, pathCard(S, SO | WE));
  assert.equal(E.validate(S, 0, { path: c, x: 2, y: 0, rot: 0 }), true);
  // turned 180° it is N·E → west is closed and doesn't fit (1,0)
  assert.notEqual(E.validate(S, 0, { path: c, x: 2, y: 0, rot: 180 }), true);
  // a wall above: with a horizontal path on (2,-1), a card on (2,0) must have its north side closed
  put(S, 2, -1, EA | WE);
  const t = give(S, pathCard(S, N | EA | SO));         // ├ turned 180° → N·S·W
  assert.notEqual(E.validate(S, 0, { path: t, x: 2, y: 0, rot: 180 }), true, "open north side must not fit the south wall of the card above");
  assert.equal(E.validate(S, 0, { path: c, x: 2, y: 0, rot: 0 }), true);
  assert.equal(ko(E.validate(S, 0, { path: c, x: 2, y: 0, rot: 7 })), "카드 방향이 잘못되었습니다");
});

test("tunnels can't pass through a dead end", () => {
  const S = fresh();
  put(S, 1, 0, EA | WE, false);      // entrance ─ horizontal dead end
  const x = give(S, pathCard(S, 15));
  const r = E.validate(S, 0, { path: x, x: 2, y: 0, rot: 0 });
  assert.match(ko(r), /입구와 이어진/);
  // a dead end itself can be attached to a tunnel end
  const d = give(S, pathCard(S, N | SO, false));
  assert.equal(E.validate(S, 0, { path: d, x: 0, y: 1, rot: 0 }), true);
  ok(S);
});

test("reached coal is revealed turned towards the tunnel; gold = Miners win · scoring", () => {
  const S = fresh();
  fixGoals(S, 1);                                   // gold in the middle, coal on top (┘ N·W) and bottom (┐ S·W)
  corridor(S);
  put(S, 7, 0, EA | SO, true, 180);                 // (7,0) ┘ N·W
  put(S, 7, -1, EA | SO);                           // (7,-1) ┌ E·S
  ok(S);
  // ┘(N·W) on (8,-1) reaches the top goal (8,-2) from the south → coal ┘ is turned 180° to ┌(E·S)
  const c = give(S, pathCard(S, EA | SO));
  assert.equal(E.validate(S, 0, { path: c, x: 8, y: -1, rot: 180 }), true);
  const ev = E.apply(S, 0, { path: c, x: 8, y: -1, rot: 180 });
  const rv = ev.find(e => e.type === "reveal");
  assert.ok(rv && rv.g === 0 && rv.gold === false, "top coal revealed");
  assert.equal(S.goals[0].e, EA | SO, "turned so the reached south side is open");
  assert.equal(S.board["8,-2"].rot, 180);
  assert.equal(S.phase, "play");
  assert.equal(S.goals[1].rev, false, "middle not yet: (8,-1)'s south side is closed");
  ok(S);
  // digging can continue from revealed coal: horizontal path on (9,-2) (east of the coal)
  S.turn = 1;
  const h = give(S, pathCard(S, EA | WE));
  assert.equal(E.validate(S, 1, { path: h, x: 9, y: -2, rot: 0 }), true);
  // gold in the middle: on a new board lay (1,0)–(6,0); a horizontal path on (7,0) reaches the middle goal from the west
  const T = fresh();
  fixGoals(T, 1);
  corridor(T);
  T.turn = 3;                                       // a miner
  const fin = give(T, pathCard(T, EA | WE));
  assert.equal(ko(E.validate(T, 3, { path: fin, x: 8, y: 0, rot: 0 })), "이미 카드가 있는 자리입니다");
  assert.equal(E.validate(T, 3, { path: fin, x: 7, y: 0, rot: 0 }), true);
  const ev2 = E.apply(T, 3, { path: fin, x: 7, y: 0, rot: 0 });
  assert.ok(ev2.some(e => e.type === "reveal" && e.gold), "gold revealed");
  assert.equal(T.phase, "end");
  assert.equal(T.res.winner, "m");
  assert.equal(T.gold[3], 3, "the miner who reached gold gets 3");
  assert.equal(T.gold[0], 2, "other miners get 2");
  assert.equal(T.gold[1], 0, "traitors get 0");
  ok(T);
  // the next round starts after the player who ended this one
  E.step(T);
  assert.equal(T.round, 2);
  assert.equal(T.turn, 4);
  assert.equal(T.phase, "play");
  ok(T);
});

test("a dead end next to a goal doesn't flip it", () => {
  const S = fresh();
  fixGoals(S, 1);
  corridor(S);
  const d = give(S, pathCard(S, EA | WE, false));
  assert.equal(E.validate(S, 0, { path: d, x: 7, y: 0, rot: 0 }), true);
  const ev = E.apply(S, 0, { path: d, x: 7, y: 0, rot: 0 });
  assert.ok(!ev.some(e => e.type === "reveal"));
  assert.equal(S.goals[1].rev, false);
  assert.equal(S.phase, "play");
  ok(S);
});

test("rockfall: removes path cards only; the cut-off side can't be extended", () => {
  const S = fresh();
  put(S, 1, 0, EA | WE); put(S, 2, 0, EA | WE); put(S, 3, 0, EA | WE);
  const rock = give(S, cardOf(S, C => C.t === "rock"));
  assert.notEqual(E.validate(S, 0, { rock, x: 0, y: 0 }), true, "can't remove the entrance");
  assert.notEqual(E.validate(S, 0, { rock, x: 8, y: 0 }), true, "can't remove a goal");
  assert.notEqual(E.validate(S, 0, { rock, x: 5, y: 0 }), true, "empty cell");
  const removed = S.board["2,0"].id;
  E.apply(S, 0, { rock, x: 2, y: 0 });
  assert.equal(S.board["2,0"], undefined);
  assert.ok(S.discard.includes(rock) && S.discard.includes(removed));
  ok(S);
  // (3,0) is cut off → can't place on (4,0); refilling (2,0) works
  const p = S.turn;
  const h = give(S, pathCard(S, EA | WE));
  assert.match(ko(E.validate(S, p, { path: h, x: 4, y: 0, rot: 0 })), /입구와 이어진/);
  if (S.broken[p].length) S.broken[p] = [];
  assert.equal(E.validate(S, p, { path: h, x: 2, y: 0, rot: 0 }), true);
});

test("tools: broken = no paths, same tool can't break twice, either-of-two repair", () => {
  const S = fresh();
  const b = give(S, cardOf(S, C => C.t === "break" && C.tool === "pick"));
  assert.notEqual(E.validate(S, 0, { break: b, target: 0 }), true, "can't break my own");
  assert.equal(E.validate(S, 0, { break: b, target: 3 }), true);
  E.apply(S, 0, { break: b, target: 3 });
  assert.deepEqual(S.broken[3], ["pick"]);
  S.turn = 1;
  const b2 = give(S, cardOf(S, C => C.t === "break" && C.tool === "pick"));
  assert.match(ko(E.validate(S, 1, { break: b2, target: 3 })), /이미/);
  S.turn = 3;
  const h = give(S, pathCard(S, EA | WE));
  assert.match(ko(E.validate(S, 3, { path: h, x: 1, y: 0, rot: 0 })), /고장/);
  const v = E.view(S, 3);
  assert.equal(v.legal, null, "no legal-spot list while broken");
  const fx = give(S, cardOf(S, C => C.t === "fix" && C.tools.length === 2 && C.tools.includes("pick")));
  const other = CARDS[fx].tools.find(t => t !== "pick");
  assert.notEqual(E.validate(S, 3, { repair: fx, target: 3, tool: other }), true, "tool isn't broken");
  assert.equal(E.validate(S, 3, { repair: fx, target: 3, tool: "pick" }), true);
  E.apply(S, 3, { repair: fx, target: 3, tool: "pick" });
  assert.deepEqual(S.broken[3], []);
  ok(S);
});

test("map: only the viewer learns it, and the event is redacted", () => {
  const S = fresh();
  fixGoals(S, 2);
  const m = give(S, cardOf(S, C => C.t === "map"));
  assert.notEqual(E.validate(S, 0, { map: m, goal: 3 }), true);
  const ev = E.apply(S, 0, { map: m, goal: 1 });
  const e = ev.find(x => x.type === "map");
  assert.equal(E.filterEvent(e, 0, S).gold, false);
  assert.equal(E.filterEvent(e, 2, S).gold, undefined);
  assert.equal(E.view(S, 0).goals[1].kind, "coal");
  assert.equal(E.view(S, 0).goals[1].peek, true);
  assert.equal(E.view(S, 2).goals[1].kind, null);
  for (let p = 0; p < S.n; p++) assert.equal(E.leak(S, p, JSON.parse(JSON.stringify(E.view(S, p)))), true);
  // a goal already seen can't be looked at again
  S.turn = 0;
  const m2 = give(S, cardOf(S, C => C.t === "map"));
  assert.match(ko(E.validate(S, 0, { map: m2, goal: 1 })), /이미/);
});

test("spectators (seat -1): public table only — no hand, role, peek or map result", () => {
  const S = fresh();
  fixGoals(S, 0);
  const m = give(S, cardOf(S, C => C.t === "map"));
  const e = E.apply(S, 0, { map: m, goal: 0 }).find(x => x.type === "map");
  assert.equal(E.filterEvent(e, -1, S).gold, undefined, "map result redacted for spectators");
  const v = JSON.parse(JSON.stringify(E.view(S, -1)));
  assert.equal(E.leak(S, -1, v), true);
  assert.equal(v.role, null); assert.equal(v.roles, null); assert.equal(v.legal, null);
  assert.deepEqual(v.hand, []);
  assert.ok(v.goals.every(g => g.kind === null && !g.peek), "no goal identity or peek mark");
  assert.deepEqual(v.sizes, S.hands.map(h => h.length));
  assert.deepEqual(v.broken, S.broken);
  assert.ok(v.status.ko && v.status.en && v.status.en.includes(`{${S.turn}}`), "public turn line");
  assert.equal(E.view(S, S.turn).status, "", "the player whose turn it is gets the shell's own line");
  // leak() catches a view that shows a peek or a hand to spectators
  assert.notEqual(E.leak(S, -1, JSON.parse(JSON.stringify(E.view(S, 0)))), true);
  // round end: roles and goals become public for everyone
  S.discard.push(...S.deck.splice(0));
  for (let p = 0; p < S.n; p++) { S.discard.push(...S.hands[p]); S.hands[p] = []; }
  S.hands[S.turn] = [S.discard.pop()];
  E.apply(S, S.turn, { discard: S.hands[S.turn][0] });
  const w = E.view(S, -1);
  assert.deepEqual(w.roles, S.roles);
  assert.ok(w.goals.every(g => g.kind));
  assert.equal(E.leak(S, -1, w), true);
});

test("view hides others' roles · hands · goals (revealed at round end)", () => {
  const S = fresh();
  for (let p = 0; p < S.n; p++) {
    const v = E.view(S, p);
    assert.equal(v.roles, null);
    assert.equal(v.role, S.roles[p]);
    assert.ok(v.goals.every(g => g.kind === null));
    assert.ok(v.board.filter(c => c.k === "g").every(c => c.e === undefined && c.gold === undefined));
    assert.equal(E.leak(S, p, v), true);
  }
  // deck and hands used up → round ends, Traitors win (2 traitors get 3 each)
  S.discard.push(...S.deck.splice(0));
  for (let p = 0; p < S.n; p++) { S.discard.push(...S.hands[p]); S.hands[p] = []; }
  S.hands[0] = [S.discard.pop()];
  const ev = E.apply(S, 0, { discard: S.hands[0][0] });
  assert.ok(ev.some(e => e.type === "round" && e.winner === "s"));
  assert.equal(S.gold[1], 3); assert.equal(S.gold[2], 3); assert.equal(S.gold[0], 0);
  const v = E.view(S, 0);
  assert.deepEqual(v.roles, S.roles);
  assert.ok(v.goals.every(g => g.kind));
  assert.equal(E.delay(S), 6000);
  ok(S);
});

test("view: tunnel ends · cells left to goals · public log · legal spots on others' turns", () => {
  const S = fresh();
  let v = E.view(S, 0);
  assert.deepEqual(v.front.map(String).sort(), ["-1,0", "0,-1", "0,1", "1,0"]);
  assert.deepEqual(v.need, [9, 7, 9], "minimum cards from the tunnel ends next to the entrance to goals #1 · #2 · #3");
  corridor(S);
  v = E.view(S, 2);                                 // seat 2 previews legal spots even when it's not their turn
  assert.equal(v.need[1], 1);
  assert.ok(v.legal && Object.keys(v.legal).length === S.hands[2].filter(id => CARDS[id].t === "path").length);
  const b = give(S, cardOf(S, C => C.t === "break" && C.tool === "lamp"));
  E.apply(S, 0, { break: b, target: 3 });
  v = E.view(S, 4);
  assert.deepEqual(v.log[v.log.length - 1], { p: 0, t: "break", target: 3, tool: "lamp" });
  assert.equal(E.view(S, 3).legal, null, "no legal spots for a player with broken tools");
  assert.equal(E.leak(S, 4, JSON.parse(JSON.stringify(v))), true);
});

test("timeout and AI actions are always legal and never change S", () => {
  const rng = makeRng(5);
  for (let g = 0; g < 40; g++) {
    const S = E.setup({ n: 3 + (g % 8), seed: 1000 + g, settings: { rounds: 1 } });
    while (S.phase === "play") {
      const p = S.turn;
      assert.equal(E.validate(S, p, E.timeout(S, p, "turn")), true);
      const before = JSON.stringify(S);
      const a = E.ai(S, p, { level: ["easy", "normal", "hard"][g % 3], rng });
      assert.equal(JSON.stringify(S), before, "AI changed the state");
      assert.equal(E.validate(S, p, a), true);
      for (const e of E.apply(S, p, a)) if (e.text) assert.ok(e.text.ko && e.text.en, `event text not bilingual (${e.type})`);
      const st = E.view(S, S.turn).status;
      assert.ok(st === "" || (st.ko && st.en), "status not bilingual");
      ok(S);
    }
  }
});

test("game ends after 3 rounds · ranking", () => {
  const S = E.setup({ n: 4, seed: 3, settings: { rounds: 3 } });
  const rng = makeRng(9);
  let k = 0;
  while (!E.over(S) && k++ < 2000) {
    if (!E.pending(S).length) { E.step(S); continue; }
    E.apply(S, S.turn, E.ai(S, S.turn, { level: "normal", rng }));
  }
  assert.ok(E.over(S));
  assert.equal(S.round, 3);
  const res = E.results(S);
  assert.equal(res.length, 4);
  const best = Math.max(...S.gold);
  assert.ok(res.filter(r => r.rank === 1).every(r => S.gold[r.p] === best));
  assert.ok(res.every(r => r.note.ko.split(" · ").length === 3 && r.note.en.split(" · ").length === 3));
  assert.ok(res.every(r => /^(Miner|Traitor)( · (Miner|Traitor)){2}$/.test(r.note.en)), "English role history");
});

console.log(`${passed} passed${process.exitCode ? " — some FAILED" : ""}`);
