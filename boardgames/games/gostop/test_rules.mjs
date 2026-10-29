/* Go-Stop rule tests — set up a situation by hand and check it move by move.
     node games/gostop/test_rules.mjs
   ppeok · jjok · ttadak · sseul · bomb · shake · bonus pi · pi stealing · scoring · gukjin · pibak/gwangbak/meongbak ·
   go multipliers · gobak · nagari · chongtong · go/stop flow · bilingual texts · public (spectator) view */
import E, { scoreOf, settle } from "./engine.js";
import { DECK48, BONUS } from "./cards.js";
import { makeRng } from "../../core/rng.js";

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`✓ ${name}`); }
  catch (e) { fail++; console.log(`✗ ${name}\n    ${e.message}`); }
}
function eq(a, b, what = "") {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${what} expected ${B}, got ${A}`);
}
function ok(c, what) { if (!c) throw new Error(what || "condition failed"); }
const has = (arr, ids) => ids.every(id => arr.includes(id));
const sameSet = (a, b) => JSON.stringify(a.slice().sort()) === JSON.stringify(b.slice().sort());
const isTx = x => x && typeof x === "object" && typeof x.ko === "string" && typeof x.en === "string" && x.ko && x.en;

/* Build a round: set hands · floor · captured cards; deck lists the next flips in order. The other cards go under the pile. */
function make({ n = 2, hands, floor = [], deck = [], caps, turn = 0, bonus = 2, totals }) {
  const S = E.setup({ n, seed: 12345, settings: { bonus, rounds: 5 } });
  const z = () => Array.from({ length: n }, () => 0);
  S.hands = hands.map(h => h.slice());
  S.floor = floor.slice();
  S.caps = (caps || hands.map(() => [])).map(c => c.slice());
  const used = new Set([...S.hands.flat(), ...S.floor, ...S.caps.flat(), ...deck]);
  const rest = DECK48.filter(c => !used.has(c));
  S.deck = [...rest, ...deck.slice().reverse()];
  // Bonus pi without a set place go to the very bottom of the pile (never flipped)
  for (const b of bonus ? BONUS : []) if (!used.has(b)) S.deck.unshift(b);
  S.turn = turn; S.phase = "play"; S.leader = turn;
  S.go = z(); S.goScore = z(); S.flips = z(); S.shook = hands.map(() => []);
  S.ppeok = {}; S.tp = null; S.ch = null; S.last = null; S.result = null; S.shown = [];
  S.totals = totals ? totals.slice() : z(); S.wins = z(); S.nagari = 1; S.round = 1;
  return S;
}
function act(S, p, a) {
  const v = E.validate(S, p, a);
  if (v !== true) throw new Error(`rejected as illegal: ${JSON.stringify(v)} ${JSON.stringify(a)}`);
  return E.apply(S, p, a);
}
const combos = ev => (ev.find(e => e.type === "turn") || { combos: [] }).combos;
const PI10 = ["1c", "1d", "2c", "2d", "3c", "3d", "4c", "4d", "5c", "5d"];

/* ---------------- Pairing and special cases ---------------- */
test("basic pair: played card pairs with 1 floor card, flipped card pairs too", () => {
  const S = make({ hands: [["1a", "12a"], ["11a", "10a"]], floor: ["1c", "7c", "6a"], deck: ["7d"] });
  const ev = act(S, 0, { card: "1a" });
  ok(sameSet(S.caps[0], ["1a", "1c", "7d", "7c"]), "captured " + S.caps[0]);
  eq(S.floor, ["6a"], "floor");
  eq(S.turn, 1, "next turn"); eq(S.phase, "play");
  eq(combos(ev), []);
});

test("a month not on the floor is laid down", () => {
  const S = make({ hands: [["2a", "12a"], ["11a", "10a"]], floor: ["1c"], deck: ["7d"] });
  act(S, 0, { card: "2a" });
  ok(sameSet(S.floor, ["1c", "2a", "7d"]), "floor " + S.floor);
  eq(S.caps[0], []);
});

test("ppeok: paired the played card but the flip is the same month → 3 cards stay on the floor", () => {
  const S = make({ hands: [["3a", "12a"], ["3d", "10a"]], floor: ["3b", "7c"], deck: ["3c", "9c"], caps: [["1c"], ["2c"]] });
  const ev = act(S, 0, { card: "3a" });
  eq(combos(ev), ["ppeok"]);
  ok(has(S.floor, ["3a", "3b", "3c"]), "3 ppeok cards on the floor");
  eq(S.ppeok, { 3: 0 }, "ppeok marker");
  eq(S.caps[0], ["1c"], "captured nothing");
  // The opponent takes the ppeok with the 4th card → 4 cards + steals 1 pi
  const ev2 = act(S, 1, { card: "3d" });
  eq(combos(ev2), ["ppeokTake"]);
  ok(has(S.caps[1], ["3a", "3b", "3c", "3d", "1c"]), "4 ppeok cards + stolen pi " + S.caps[1]);
  eq(S.caps[0], [], "pi was stolen");
  eq(S.ppeok, {}, "ppeok marker cleared");
});

test("self-ppeok: taking my own ppeok", () => {
  const S = make({ hands: [["3a", "3d", "12a"], ["10a", "11a"]], floor: ["3b", "7c"], deck: ["3c", "9c", "8c"], caps: [[], ["2c"]] });
  act(S, 0, { card: "3a" });
  act(S, 1, { card: "10a" });
  const ev = act(S, 0, { card: "3d" });
  eq(combos(ev), ["selfPpeok"]);
  ok(S.caps[0].includes("2c"), "pi stolen");
});

test("three of a month dealt to the floor: taking them steals nothing", () => {
  const S = make({ hands: [["2a", "12a"], ["10a", "11a"]], floor: ["2b", "2c", "2d"], deck: ["9c"], caps: [[], ["1c"]] });
  const ev = act(S, 0, { card: "2a" });
  ok(has(S.caps[0], ["2a", "2b", "2c", "2d"]), "4 cards");
  eq(S.caps[1], ["1c"], "no steal");
  eq(combos(ev), []);
});

test("jjok: flipping the same month as the card just laid → 2 cards + 1 pi from each", () => {
  const S = make({ hands: [["5a", "12a"], ["10a", "11a"]], floor: ["1a"], deck: ["5c"], caps: [[], ["11b", "6c"]] });
  const ev = act(S, 0, { card: "5a" });
  eq(combos(ev), ["jjok"]);
  ok(has(S.caps[0], ["5a", "5c", "6c"]), "jjok 2 cards + plain pi stolen first " + S.caps[0]);
  eq(S.caps[1], ["11b"], "double pi kept");
});

test("ttadak: play the 3rd onto 2 floor cards and flip the 4th → 4 cards + 1 pi from each", () => {
  const S = make({ hands: [["6a", "12a"], ["10a", "11a"]], floor: ["6c", "6d", "1a"], deck: ["6b"], caps: [[], ["7c"]] });
  const ev = act(S, 0, { card: "6a" });   // both June floor cards are plain pi → no choice needed
  eq(S.phase === "choose", false, "no choice");
  eq(combos(ev), ["ttadak"]);
  ok(has(S.caps[0], ["6a", "6b", "6c", "6d", "7c"]), "4 cards + pi " + S.caps[0]);
});

test("two different floor cards → choose, take the chosen one (play stage)", () => {
  const S = make({ hands: [["11c", "12a"], ["10a", "5a"]], floor: ["11a", "11b", "1a"], deck: ["9c"] });
  act(S, 0, { card: "11c" });
  eq(S.phase, "choose"); eq(E.pending(S), [{ p: 0, kind: "choose" }]);
  eq(S.ch.options.slice().sort(), ["11a", "11b"]);
  ok(E.validate(S, 0, { take: "1a" }) !== true, "card outside the options is rejected");
  ok(E.validate(S, 1, { take: "11a" }) !== true, "someone else's choice is rejected");
  eq(E.check(S), true, "state check during the choice");
  act(S, 0, { take: "11b" });
  ok(has(S.caps[0], ["11c", "11b"]), "chosen double pi");
  ok(S.floor.includes("11a"), "gwang left behind");
  eq(S.turn, 1);
});

test("ttadak takes all 4 even after a choice", () => {
  const S = make({ hands: [["11c", "12a"], ["10a", "5a"]], floor: ["11a", "11b"], deck: ["11d"], caps: [[], ["1c"]] });
  act(S, 0, { card: "11c" });
  act(S, 0, { take: "11a" });
  ok(has(S.caps[0], ["11a", "11b", "11c", "11d", "1c"]), "4 cards + pi");
});

test("flipped card matching 2 floor cards → choose (flip stage)", () => {
  const S = make({ hands: [["1a", "12a"], ["10a", "5a"]], floor: ["1c", "12b", "12c"], deck: ["12d"] });
  act(S, 0, { card: "1a" });
  eq(S.phase, "choose"); eq(S.ch.stage, "flip");
  act(S, 0, { take: "12b" });
  ok(sameSet(S.caps[0], ["1a", "1c", "12d", "12b"]), "played pair + flipped pair " + S.caps[0]);
  eq(S.floor, ["12c"]);
});

test("sseul: empty floor after my turn → 1 pi from each", () => {
  const S = make({ hands: [["4d", "12a"], ["10a", "5a"]], floor: ["4c", "9c"], deck: ["9d"], caps: [[], ["1c", "2c"]] });
  const ev = act(S, 0, { card: "4d" });
  eq(combos(ev), ["sseul"]);
  eq(S.floor, []);
  eq(S.caps[1].length, 1, "1 pi stolen");
});

test("no sseul on the round's last turn", () => {
  const S = make({ hands: [["4d"], []], floor: ["4c", "9c"], deck: ["9d"], caps: [[], ["1c"]] });
  const ev = act(S, 0, { card: "4d" });
  eq(combos(ev), []);
  eq(S.caps[1], ["1c"]);
});

/* ---------------- Bomb · shake ---------------- */
test("bomb: 3 cards + 1 floor card → 4 cards, 1 pi from each, ×2 marker, 2 flip-only turns", () => {
  const S = make({ hands: [["8a", "8b", "8c", "1a"], ["10a", "5a", "6a", "7a"]], floor: ["8d", "2a"], deck: ["9c", "9d", "11c"], caps: [[], ["3c"]] });
  ok(E.validate(S, 0, { card: "8a", bomb: true }) === true);
  ok(E.validate(S, 0, { card: "1a", bomb: true }) !== true, "no bomb without 3 cards");
  ok(E.validate(S, 0, { card: "8a", bomb: true, shake: true }) !== true, "no bomb + shake");
  const v = E.view(S, 0);
  eq(v.can.bomb, [8]);
  const ev = act(S, 0, { card: "8a", bomb: true });
  ok(ev.some(e => e.type === "bomb"), "bomb event");
  ok(has(S.caps[0], ["8a", "8b", "8c", "8d", "3c"]), "4 cards + pi");
  eq(S.hands[0], ["1a"]);
  eq(S.flips[0], 2, "flip-only turns");
  eq(S.shook[0], [{ m: 8, bomb: true }]);
  act(S, 1, { card: "10a" });
  ok(E.validate(S, 0, { flip: true }) === true, "flip only");
  ok(E.validate(S, 1, { flip: true }) !== true);
  const before = S.hands[0].length;
  act(S, 0, { flip: true });
  eq(S.hands[0].length, before, "hand unchanged");
  eq(S.flips[0], 1);
});

test("shake: 3 of a month, none on the floor → ×2 if they win", () => {
  const S = make({ hands: [["10a", "10b", "10c", "2a"], ["5a", "6a", "7a", "11a"]], floor: ["1a"], deck: ["9c"] });
  ok(E.validate(S, 0, { card: "10a", shake: true }) === true);
  ok(E.validate(S, 0, { card: "2a", shake: true }) !== true, "month without 3 cards");
  const ev = act(S, 0, { card: "10a", shake: true });
  const sh = ev.find(e => e.type === "shake");
  ok(sh && sameSet(sh.cards, ["10a", "10b", "10c"]), "shows the 3 cards");
  eq(S.shook[0], [{ m: 10, bomb: false }]);
  eq(E.leak(S, 1, JSON.parse(JSON.stringify(E.view(S, 1)))), true, "shown cards are not hidden info");
  // ×2 on a win
  S.caps[0] = ["1a", "3a", "8a"]; S.caps[1] = ["1c"];
  const R = settle(S, 0);
  eq(R.pts, 3); eq(R.shakes, 1);
  eq(R.losers[0].mul, 4, "shake ×2 · gwangbak ×2"); eq(R.losers[0].pay, 12);
});

/* ---------------- Bonus pi ---------------- */
test("bonus pi from the hand: becomes pi, draw a card, still my turn", () => {
  const S = make({ hands: [["B2", "1a"], ["10a", "5a"]], floor: ["2c"], deck: ["7c", "9c"] });
  const ev = act(S, 0, { bonus: "B2" });
  eq(S.caps[0], ["B2"]);
  ok(sameSet(S.hands[0], ["1a", "7c"]), "drawn card " + S.hands[0]);
  eq(S.turn, 0); eq(S.phase, "play");
  eq(E.filterEvent(ev[0], 1).drew, null, "drawn card hidden from others");
  eq(E.filterEvent(ev[0], 0).drew, "7c");
  eq(scoreOf(["B2", "B3", ...PI10.slice(0, 5)]).pi, 10, "double 2 + triple 3 + 5 pi = 10");
});

test("flipped bonus pi: becomes mine and I flip again", () => {
  const S = make({ hands: [["1a", "12a"], ["10a", "5a"]], floor: ["7c"], deck: ["B3", "7d"] });
  const ev = act(S, 0, { card: "1a" });
  ok(has(S.caps[0], ["B3", "7c", "7d"]), "bonus + flipped pair " + S.caps[0]);
  eq(ev.filter(e => e.type === "flip").map(e => e.card), ["B3", "7d"]);
});

test("stealing order: plain pi → double pi → triple pi", () => {
  const S = make({ hands: [["5a", "12a"], ["10a", "11a"]], floor: ["1a"], deck: ["5c"], caps: [[], ["B3", "11b"]] });
  act(S, 0, { card: "5a" });   // jjok
  ok(S.caps[0].includes("11b") && S.caps[1].includes("B3"), "double pi first " + S.caps[0]);
});

/* ---------------- Scoring ---------------- */
test("scoring: gwang · ribbons · animals · pi", () => {
  eq(scoreOf(["1a", "3a", "8a"]).gp, 3, "3 gwang");
  eq(scoreOf(["1a", "3a", "12a"]).gp, 2, "3 gwang with rain");
  eq(scoreOf(["1a", "3a", "8a", "12a"]).gp, 4, "4 gwang");
  eq(scoreOf(["1a", "3a", "8a", "11a", "12a"]).gp, 15, "5 gwang");
  eq(scoreOf(["1b", "2b", "3b"]).tp, 3, "hongdan");
  eq(scoreOf(["6b", "9b", "10b"]).tp, 3, "cheongdan");
  eq(scoreOf(["4b", "5b", "7b"]).tp, 3, "chodan");
  eq(scoreOf(["1b", "2b", "4b", "5b", "12c"]).tp, 1, "5 ribbons (rain ribbon included)");
  eq(scoreOf(["1b", "2b", "3b", "4b", "5b", "6b"]).tp, 3 + 2, "hongdan + 6 ribbons");
  eq(scoreOf(["2a", "4a", "8b"]).yp, 5, "godori");
  eq(scoreOf(["5a", "6a", "7a", "10a", "12b"]).yp, 1, "5 animals");
  eq(scoreOf(["2a", "4a", "8b", "5a", "6a", "7a"]).yp, 5 + 2, "godori + 6 animals");
  eq(scoreOf(PI10).pp, 1, "10 pi");
  eq(scoreOf([...PI10.slice(0, 8), "11b"]).pp, 1, "double pi counts 2");
  eq(scoreOf([...PI10, "12d", "B3"]).pp, 6, "15 pi");
});

test("score items carry a bilingual label and a key", () => {
  const s = scoreOf(["1a", "3a", "12a", "1b", "2b", "3b", "2a", "4a", "8b", ...PI10]);
  eq(s.items.map(x => x[2]), ["rain3", "hong", "go", "pi"]);
  ok(s.items.every(x => isTx(x[0]) && typeof x[1] === "number"), JSON.stringify(s.items));
});

test("gukjin: counted the higher-scoring way automatically", () => {
  const a = scoreOf(["9a", "5a", "6a", "7a", "10a", "1c", "1d", "2c", "2d", "3c", "3d", "4c", "4d", "5c"]);   // 5 animals or 11 pi
  eq(a.guk, "p", "as double pi (11 pi 2 points > 5 animals 1 point)"); eq(a.total, 2);
  const b = scoreOf(["9a", "5a", "6a", "7a", "10a", "1c"]);
  eq(b.guk, "y", "as animal"); eq(b.total, 1);
  const c = scoreOf(["9a", "1c"]);
  eq(c.guk, "y", "animal on a tie"); eq(c.total, 0);
  // A loser's gukjin counts toward avoiding pibak: 4 pi + gukjin = 6
  const S = make({ hands: [["12a"], ["11a"]] });
  S.caps[0] = [...PI10, "1a"]; S.caps[1] = ["9a", "6c", "6d", "7c", "7d"];
  eq(settle(S, 0).losers[0].pibak, false, "gukjin avoids pibak");
  S.caps[1] = ["6c", "6d", "7c", "7d", "8c"];
  eq(settle(S, 0).losers[0].pibak, true, "5 pi is pibak");
});

/* ---------------- Settlement ---------------- */
test("pibak · gwangbak · meongbak", () => {
  const S = make({ n: 3, hands: [["12a"], ["11a"], ["10a"]] });
  S.caps[0] = ["1a", "3a", "8a", ...PI10];                      // 3 gwang 3 + pi 1 = 4 points
  S.caps[1] = ["6c", "6d", "7c", "7d", "8c"];                   // 5 pi, 0 gwang → pibak · gwangbak
  S.caps[2] = ["11a", "6a", "11b", "11c", "11d", "12d", "9c"];  // 7 pi (double pi counts 2), 1 gwang
  const R = settle(S, 0);
  eq(R.pts, 4);
  const [l1, l2] = R.losers;
  eq([l1.pibak, l1.gwangbak, l1.mul, l1.pay], [true, true, 4, 16], "seat 1");
  eq([l2.pibak, l2.gwangbak, l2.mul, l2.pay], [false, false, 1, 4], "seat 2");
  eq(R.deltas, [20, -16, -4]);
  // Meongbak: winner has 7 animals
  S.caps[0] = ["2a", "4a", "8b", "5a", "6a", "7a", "10a"];    // godori 5 + 7 animals 3 = 8 points
  S.caps[1] = PI10.slice(0, 6); S.caps[2] = PI10.slice(6).concat(["11c", "11d"]);
  const M = settle(S, 0);
  eq(M.pts, 8); ok(M.losers.every(l => l.meongbak && l.mul === 2), "meongbak ×2"); eq(M.deltas[0], 32);
  // No pi points → no pibak
  S.caps[0] = ["1a", "3a", "8a"]; S.caps[1] = []; S.caps[2] = ["1c"];
  const N2 = settle(S, 0);
  ok(N2.losers.every(l => !l.pibak && l.gwangbak), "no pibak · gwangbak only");
});

test("go points: 1 Go +1 · 2 Go +2 · 3 Go ×2 · 4 Go ×4 · 5 Go ×8", () => {
  const S = make({ hands: [["12a"], ["11a"]] });
  S.caps[0] = ["2a", "4a", "8b", "1b", "2b", "3b", "6c"];   // godori 5 + hongdan 3 = 8 points
  S.caps[1] = PI10.slice(0, 6);
  const base = scoreOf(S.caps[0]).total;
  eq(base, 8);
  const want = { 0: 8, 1: 9, 2: 10, 3: 22, 4: 48, 5: 104 };
  for (const g of [0, 1, 2, 3, 4, 5]) { S.go[0] = g; eq(settle(S, 0).pts, want[g], `${g} Go`); }
});

test("gobak (3 players): the loser who called Go pays both shares", () => {
  const S = make({ n: 3, hands: [["12a"], ["11a"], ["10a"]] });
  S.caps[0] = ["1a", "3a", "8a"];                // 3 points
  S.caps[1] = ["11a", ...PI10.slice(0, 6)];
  S.caps[2] = ["12a", ...PI10.slice(6)];
  S.go[1] = 1;
  const R = settle(S, 0);
  const l1 = R.losers.find(l => l.p === 1), l2 = R.losers.find(l => l.p === 2);
  ok(l1.gobak && l1.pay === 6 && l2.pay === 0 && l2.covered, JSON.stringify(R.losers));
  eq(R.deltas, [6, -6, 0]);
  // Matgo has no gobak
  const T = make({ hands: [["12a"], ["11a"]] });
  T.caps[0] = [...PI10.slice(0, 5), "1a", "3a", "8a", "11a"]; T.caps[1] = ["12a", ...PI10.slice(5)]; T.go[1] = 1;
  ok(!settle(T, 0).losers[0].gobak);
});

/* ---------------- Go / Stop flow ---------------- */
test("scoring out asks go/stop → Go: next player, asked again only on a higher score", () => {
  // Seat 0 is just short of 7: 2 gwang + 2 godori birds → the Aug gwang this turn makes 3 gwang + godori = 8 points
  const S = make({ hands: [["8a", "1d", "5a"], ["10a", "11c", "6a"]], floor: ["8b", "9c"], deck: ["7c", "6c", "9d"],
    caps: [["1a", "3a", "2a", "4a"], ["2c"]] });
  act(S, 0, { card: "8a" });
  eq(scoreOf(S.caps[0]).total, 8);
  eq(S.phase, "gostop"); eq(E.pending(S), [{ p: 0, kind: "gostop" }]);
  ok(E.view(S, 0).preview && E.view(S, 0).preview.deltas[0] > 0, "stop preview");
  eq(E.view(S, 1).preview, null, "no preview for others");
  ok(E.validate(S, 0, { go: "yes" }) !== true);
  act(S, 0, { go: true });
  eq([S.go[0], S.goScore[0], S.turn, S.phase], [1, 8, 1, "play"]);
  act(S, 1, { card: "10a" });
  act(S, 0, { card: "1d" });         // same score → not asked again
  eq(S.phase, "play"); eq(S.turn, 1);
});

test("stop: round ends, totals updated, next leader", () => {
  const S = make({ hands: [["8a", "1d"], ["10a", "11c"]], floor: ["8b", "9c"], deck: ["7c"],
    caps: [["1a", "3a", "2a", "4a"], ["2c"]] });
  act(S, 0, { card: "8a" });
  const ev = act(S, 0, { go: false });
  eq(S.phase, "roundEnd");
  ok(ev.some(e => e.type === "roundEnd"));
  eq(S.result.winner, 0);
  eq(S.totals[0], S.result.deltas[0]); eq(S.totals[0] + S.totals[1], 0);
  eq(S.leader, 0);
  eq(E.pending(S), []);
  ok(E.delay(S) >= 4000, "time to show the result");
  E.step(S);
  eq([S.round, S.phase, S.turn], [2, "play", 0], "winner leads the next round");
  eq(E.check(S), true);
});

test("scoring out with the last card stops automatically", () => {
  const S = make({ hands: [["8a"], []], floor: ["8b"], deck: ["7c"], caps: [["1a", "3a", "2a", "4a"], []] });
  const ev = act(S, 0, { card: "8a" });
  eq(S.phase, "roundEnd"); eq(S.result.how, "auto");
  ok(ev.some(e => e.type === "roundEnd"));
});

test("3 players win from 3 points", () => {
  const S = make({ n: 3, hands: [["8a", "5a"], ["10a", "11c"], ["6a", "7a"]], floor: ["8b"], deck: ["7c"], caps: [["1a", "3a"], [], []] });
  act(S, 0, { card: "8a" });
  eq(S.phase, "gostop");
});

test("nagari: nobody scores → no points, next round ×2 (×4 if repeated)", () => {
  const S = make({ hands: [["1c"], ["2c"]], floor: ["5c"], deck: ["7c", "8c"] });
  act(S, 0, { card: "1c" });
  const ev = act(S, 1, { card: "2c" });
  ok(ev.some(e => e.type === "nagari"), "nagari event");
  eq([S.phase, S.result.kind, S.nagari], ["roundEnd", "nagari", 2]);
  eq(S.totals, [0, 0]);
  const lead = S.leader;
  E.step(S);
  eq(S.leader, lead, "same leader");
  eq(S.nagari, 2);
  S.caps[0] = ["1a", "3a", "8a", ...PI10]; S.caps[1] = ["11a", "6c", "6d", "7c", "7d", "9c", "9d"];   // no pibak · gwangbak
  S.go = [0, 0]; S.shook = [[], []];
  const R = settle(S, 0);
  eq(R.losers[0].mul, 2, "nagari ×2"); eq(R.pts * 2, R.losers[0].pay);
  S.nagari = 4;
  eq(settle(S, 0).losers[0].mul, 4, "repeated nagari ×4");
});

test("chongtong: all four of a month in hand → 10 points at once", () => {
  let found = null;
  for (let seed = 1; seed < 20000 && !found; seed++) {
    const S = E.setup({ n: 2, seed, settings: {} });
    if (S.result && S.result.kind === "chongtong") found = S;
  }
  ok(found, "no seed with a chongtong found");
  const S = found, w = S.result.winner;
  eq(S.phase, "roundEnd");
  eq(S.result.cards.length, 4);
  ok(S.result.cards.every(c => S.hands[w].includes(c)), "chongtong 4 cards");
  eq(S.totals[w], 10); eq(S.totals[1 - w], -10);
  eq(E.leak(S, 1 - w, JSON.parse(JSON.stringify(E.view(S, 1 - w)))), true, "revealed chongtong cards are not hidden info");
  eq(E.check(S), true);
});

/* ---------------- Other ---------------- */
test("someone else's turn · card not in hand are rejected", () => {
  const S = make({ hands: [["1a", "2a"], ["3a", "4a"]], floor: ["5c"], deck: ["7c"] });
  ok(E.validate(S, 1, { card: "3a" }) !== true);
  ok(E.validate(S, 0, { card: "3a" }) !== true);
  ok(E.validate(S, 0, { card: "zz" }) !== true);
  ok(E.validate(S, 0, { flip: true }) !== true);
  ok(E.validate(S, 0, { bonus: "B2" }) !== true);
  ok(E.validate(S, 0, null) !== true);
});

test("tampered actions: mixed fields are only handled the way validate read them", () => {
  const S = make({ hands: [["1a", "2a"], ["3a", "4a"]], floor: ["5c"], deck: ["7c", "8c", "9c"] });
  S.flips[0] = 1;
  const a = { flip: true, bonus: "B3", card: "1a", bomb: true };
  eq(E.validate(S, 0, a), true);
  act(S, 0, a);
  eq(S.hands[0].slice().sort(), ["1a", "2a"], "hand unchanged (flip only)");
  ok(!S.caps[0].includes("B3"), "can't sneak in a bonus not held");
  eq(S.flips[0], 0);
  const T = make({ hands: [["1a", "2a"], ["3a", "4a"]], floor: ["5c"], deck: ["7c"] });
  ok(E.validate(T, 0, { bonus: "B3", card: "1a" }) !== true, "bonus not in hand");
  ok(E.validate(T, 0, { card: "1a", shake: true }) !== true, "not a shake situation");
  ok(E.validate(T, 0, { take: "5c" }) !== true, "not choosing now");
  ok(E.validate(T, 0, { go: true }) !== true, "not a go/stop decision");
});

test("validate errors are bilingual", () => {
  const S = make({ hands: [["1a", "2a"], ["3a", "4a"]], floor: ["5c"], deck: ["7c"] });
  for (const [p, a] of [[1, { card: "3a" }], [0, null], [0, { card: "3a" }], [0, { flip: true }], [0, { bonus: "B2" }], [0, { card: "1a", shake: true }]]) {
    const r = E.validate(S, p, a);
    ok(isTx(r), `${JSON.stringify(a)} → ${JSON.stringify(r)}`);
  }
});

test("timeout · AI actions are always legal (hand-made situations)", () => {
  const S = make({ hands: [["11c", "8a", "8b", "8c"], ["10a", "5a", "6a", "7a"]], floor: ["11a", "11b", "8d"], deck: ["9c", "9d"] });
  for (const lv of ["easy", "normal", "hard"]) eq(E.validate(S, 0, E.ai(S, 0, { level: lv, rng: makeRng(3) })), true, lv);
  eq(E.validate(S, 0, E.timeout(S, 0, "play")), true);
  act(S, 0, { card: "11c" });
  eq(E.validate(S, 0, E.timeout(S, 0, "choose")), true);
  eq(E.timeout(S, 0, "choose").take, "11a", "on timeout take the more valuable gwang");
  for (const lv of ["easy", "normal", "hard"]) eq(E.validate(S, 0, E.ai(S, 0, { level: lv, rng: makeRng(4) })), true, lv);
});

/* ---------------- Spectators (public view, p = -1) ---------------- */
test("spectator view: no hand, no private preview, bonus draw redacted, leak check", () => {
  ok(E.spectate === true, "spectate flag");
  const S = make({ n: 3, hands: [["B2", "1a"], ["10a", "5a"], ["3a", "4a"]], floor: ["2c"], deck: ["7c", "9c", "11c"] });
  const ev = act(S, 0, { bonus: "B2" });
  eq(E.filterEvent(ev[0], -1).drew, null, "drawn card hidden from spectators");
  const v = JSON.parse(JSON.stringify(E.view(S, -1)));
  eq(v.hand, []); eq(v.can, null); eq(v.preview, null);
  eq(v.sizes, [2, 2, 2], "hand sizes are public");
  eq(E.leak(S, -1, v), true, "public view passes the leak check");
  eq(E.leak(S, -1, { ...v, hand: ["1a"] }) !== true, true, "a hand in the public view is caught");
  // Go/Stop decision: the public view shows who decides, but no preview
  S.caps[0] = ["1a", "3a", "8a"]; S.phase = "gostop"; S.turn = 0; S.hands[0] = ["7c"];
  const g = E.view(S, -1);
  eq(g.preview, null);
  ok(isTx(g.status) && g.status.en.includes("{0}"), "spectator status names the deciding player");
});

test("lastBy: each player's latest turn this round is public (screens remounted mid-round can show it)", () => {
  const S = make({ n: 2, hands: [["1a", "2a"], ["5a", "6a"]], floor: ["1c", "9d"], deck: ["7c", "8c", "10c", "11c"] });
  S.lastBy = [null, null];
  act(S, 0, { card: "1a" });
  act(S, 1, { card: "5a" });
  const v = E.view(S, -1);
  eq(v.lastBy[0].played, ["1a"]); eq(v.lastBy[1].played, ["5a"]);
  eq(E.leak(S, -1, JSON.parse(JSON.stringify(v))), true);
});

test("AI does not change the state", () => {
  const S = E.setup({ n: 3, seed: 99, settings: {} });
  const before = JSON.stringify(S);
  for (const lv of ["easy", "normal", "hard"]) E.ai(S, S.turn, { level: lv, rng: makeRng(1) });
  E.timeout(S, S.turn, "play");
  eq(JSON.stringify(S), before);
});

test("results: ranked by total · ties share a rank", () => {
  const S = make({ n: 3, hands: [[], [], []] });
  S.totals = [30, -15, -15]; S.wins = [2, 1, 0];
  const r = E.results(S);
  eq(r.map(x => [x.p, x.rank, x.score]), [[0, 1, 30], [1, 2, -15], [2, 2, -15]]);
  eq(r[0].note, { ko: "+30점 · 2승", en: "+30 pts · 2 wins" });
  eq(r[1].note.en, "-15 pts · 1 win");
});

test("whole games: card count · score sum conserved, all texts bilingual (Matgo · Go-Stop, bonus on/off)", () => {
  for (const n of [2, 3]) for (const bonus of [0, 2]) for (let g = 0; g < 40; g++) {
    const S = E.setup({ n, seed: 7 + g * 13 + bonus, settings: { bonus, rounds: 5 } });
    const rng = makeRng(g);
    let k = 0;
    const texts = ev => { for (const e of ev) if (e.text !== undefined && !isTx(e.text)) throw new Error(`event text not bilingual: ${JSON.stringify(e)}`); };
    while (!E.over(S)) {
      if (++k > 3000) throw new Error("did not end");
      const pend = E.pending(S);
      if (!pend.length) { texts(E.step(S)); continue; }
      const x = pend[0];
      const v = E.view(S, x.p);
      if (v.status && !isTx(v.status)) throw new Error(`status not bilingual: ${JSON.stringify(v.status)}`);
      const a = k % 2 ? E.randomAction(S, x.p, rng) : E.ai(S, x.p, { level: "hard", rng });
      texts(act(S, x.p, a));
      const c = E.check(S);
      if (c !== true) throw new Error(`n=${n} bonus=${bonus} g=${g}: ${c}`);
    }
    eq(S.round, 5);
  }
});

test("engine meta texts are bilingual", () => {
  ok(isTx(E.name) && isTx(E.blurb) && isTx(E.rules), "name / blurb / rules");
  for (const s of E.settings) ok(isTx(s.label) && isTx(s.note) && s.labels.every(isTx), s.key);
});

console.log(`\n${fail ? "✗" : "✓"} Go-Stop rule tests: ${pass} passed${fail ? `, ${fail} failed` : ""}`);
process.exit(fail ? 1 : 0);
