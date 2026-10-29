/* Poker engine unit tests — hand evaluation · betting rules · side-pot settlement
     node games/poker/test_eval.mjs */
import E, { evalCodes, handName, bestHand } from "./engine.js";
import { deck52 } from "../../core/cards.js";

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) pass++;
  else { fail++; console.log("✗ " + label); }
}
function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), `${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
const H = s => s.split(" ");                 // "S1 H13 …" → array of card codes
const score = s => evalCodes(H(s));
const name = s => handName(score(s)).en;

/* ===================== 1. Hand names ===================== */
eq(name("S1 S13 S12 S11 S10 H2 D3"), "Royal flush", "royal flush");
eq(name("H9 H8 H7 H6 H5 S1 D1"), "Straight flush", "straight flush");
eq(name("C1 C2 C3 C4 C5 H13 D13"), "Straight flush", "A-2-3-4-5 straight flush (steel wheel)");
eq(name("S7 H7 D7 C7 S2 H3 D9"), "Four of a kind", "four of a kind");
eq(name("S7 H7 D7 C9 S9 H3 D2"), "Full house", "full house");
eq(name("S7 H7 D7 C9 S9 H9 D2"), "Full house", "two sets = full house");
eq(name("H2 H6 H9 H11 H13 S3 D4"), "Flush", "flush");
eq(name("S1 H2 D3 C4 S5 H9 D13"), "Straight", "A-2-3-4-5 wheel straight");
eq(name("S10 H11 D12 C13 S1 H2 D2"), "Straight", "ace-high straight");
eq(name("S7 H7 D7 C2 S9 H13 D4"), "Three of a kind", "three of a kind");
eq(name("S7 H7 D9 C9 S2 H13 D4"), "Two pair", "two pair");
eq(name("S7 H7 D9 C3 S2 H13 D4"), "One pair", "one pair");
eq(name("S7 H5 D9 C3 S2 H13 D11"), "High card", "high card");
eq(name("S1 H13 D12 C11 S9"), "High card", "5-card high card (not a straight)");
eq(name("S1 H13 S2 C3 D4"), "High card", "K-A-2-3-4 is not a straight");

/* ===================== 2. Hand order ===================== */
const ladder = [
  "S1 S13 S12 S11 S10 H2 D3",   // royal
  "H9 H8 H7 H6 H5 S1 D1",       // 9-high straight flush
  "C1 C2 C3 C4 C5 H13 D13",     // 5-high straight flush
  "S7 H7 D7 C7 S2 H3 D9",       // four of a kind
  "S7 H7 D7 C9 S9 H3 D2",       // full house
  "H2 H6 H9 H11 H13 S3 D4",     // flush
  "S10 H11 D12 C13 S1 H2 D2",   // ace-high straight
  "S2 H3 D4 C5 S6 H9 D13",      // 6-high straight
  "S1 H2 D3 C4 S5 H9 D13",      // wheel
  "S7 H7 D7 C2 S9 H13 D4",      // three of a kind
  "S7 H7 D9 C9 S2 H13 D4",      // two pair
  "S7 H7 D9 C3 S2 H13 D4",      // one pair
  "S7 H5 D9 C3 S2 H13 D11"      // high card
];
for (let i = 0; i + 1 < ladder.length; i++) ok(score(ladder[i]) > score(ladder[i + 1]), `order: ${ladder[i]} > ${ladder[i + 1]}`);

/* ===================== 3. Kickers · ties ===================== */
ok(score("S13 H13 D1 C9 S5 H3 D2") > score("C13 D13 S12 H9 C5 S3 H2"), "pair of kings: ace kicker > queen kicker");
ok(score("S13 H13 D1 C9 S6 H3 D2") > score("C13 D13 H1 S9 C5 S3 H2"), "pair of kings, A·9 equal, third kicker 6 > 5");
ok(score("S13 H13 D9 C9 S1 H3 D2") > score("C13 D13 H9 S9 C12 S3 H2"), "same two pair, kicker A > Q");
ok(score("C13 D13 H9 S9 C3 S3 D1") > score("S13 H13 D9 C9 S4 H4 D2"), "three pairs: the ace kicker beats the discarded pair (4)");
eq(score("S13 H13 D9 C9 S4 H4 D2"), score("C13 D13 H9 S9 C4 D4 H3"), "KK99 + 4 kicker ties (the remaining 2·3 don't matter)");
ok(score("S8 H8 D8 C1 S2 H3 D5") > score("C8 D8 H8 S13 C2 S3 H5"), "three of a kind kicker A > K");
ok(score("H1 H10 H8 H6 H3 S2 D2") > score("D1 D10 D8 D6 D2 S3 C3"), "flush: fifth card 3 > 2");
ok(score("S7 H7 D7 C7 S1 H2 D3") > score("C7 D7 H7 S7 H13 C2 D3"), "four of a kind kicker A > K");
eq(score("S7 H7 D7 C7 S13 H2 D3"), score("S7 H7 D7 C7 S13 C12 D11"), "four of a kind + K kicker: other cards don't matter");
ok(score("S9 H9 D9 C4 S4 H2 D3") > score("C8 D8 H8 S13 C13 S2 H3"), "full house: nines full > eights full");
ok(score("S9 H9 D9 C5 S5 H2 D3") > score("C9 D9 H9 S4 C4 S2 H3"), "full house: same trips, pair 5 > 4");
ok(score("S2 H3 D4 C5 S6 H9 D13") > score("S1 H2 D3 C4 S5 H9 D13"), "6-high straight > wheel");
eq(score("S1 H13 D12 C11 S10 H2 D3"), score("D1 C13 H12 S11 D10 C2 S3"), "equal straights tie");
eq(score("S1 H13 D7 C5 S3 H9 D11"), score("C1 D13 H7 S5 D3 S9 H11"), "high cards differing only in suit tie");
ok(score("S13 H12 D1 C9 S5 H3 D7") > score("C13 D12 H1 S9 C5 S3 H6"), "high card: fifth card 7 > 6");
eq(score("S13 H12 D1 C9 S5 H3 D2"), score("C13 D12 H1 S9 C5 S3 H2"), "high card: 6th and 7th cards are not compared");
// when the board plays, the pot is split
eq(score("S1 S13 S12 S11 S10 H2 D3"), score("S1 S13 S12 S11 S10 C4 C5"), "royal flush on the board: tie");
eq(score("S2 H3 D4 C5 S6 H1 D1"), score("S2 H3 D4 C5 S6 C1 C10"), "6-high straight on the board: pocket aces still tie on the straight");

/* Picking the best 5 cards */
{
  const b = bestHand(H("S1 H2 D3 C4 S5 H9 D13"));
  eq(b.best.slice().sort(), H("S1 H2 D3 C4 S5").sort(), "best 5 cards of a wheel");
  const f = bestHand(H("H2 H6 H9 H11 H13 H3 D4"));
  eq(f.best.slice().sort(), H("H6 H9 H11 H13 H3").sort(), "top 5 of a 6-card flush");
  eq(f.name.en, "Flush", "flush name");
  eq(f.name.ko, "플러시", "flush name (Korean)");
}

/* ===================== Game state helpers ===================== */
/* stacks: chips per seat, button: button seat for the first hand. Returns S with the first hand started */
function table(stacks, button = 0, opts = {}) {
  const S = E.setup({ n: stacks.length, seed: 12345, settings: { chips: 1000, blinds: "fixed", hands: 0, ...opts } });
  S.chips = stacks.slice(); S.start = stacks.slice(); S.total = stacks.reduce((a, b) => a + b, 0);
  S.button = (button + stacks.length - 1) % stacks.length;   // startHand moves it one seat
  E.step(S);
  return S;
}
/* Rig hole cards and board (rebuilds the deck so card conservation still holds) */
function rig(S, holes, board) {
  const used = new Set([...Object.values(holes).flat(), ...board]);
  const rest = deck52().filter(c => !used.has(c));
  for (let q = 0; q < S.n; q++) {
    if (!S.hole[q]) continue;
    S.hole[q] = holes[q] ? holes[q].slice() : [rest.pop(), rest.pop()];
  }
  S.deck = [...rest, ...board.slice().reverse()];          // pop order = 3 flop cards → turn → river
}
function act(S, p, a, expectOk = true) {
  const v = E.validate(S, p, a);
  if (expectOk) {
    ok(v === true, `action rejected p${p} ${JSON.stringify(a)}: ${JSON.stringify(v)}`);
    if (v !== true) throw new Error("aborted");
    const ev = E.apply(S, p, a);
    const c = E.check(S);
    ok(c === true, `check failed: ${c}`);
    return ev;
  }
  ok(v !== true, `action should have been rejected p${p} ${JSON.stringify(a)}`);
  return v;
}
/* Step until the hand ends (all-in boards run out automatically); remaining betting is check/call */
function runOut(S) {
  let guard = 0;
  while (S.phase !== "end" && S.phase !== "over" && guard++ < 50) {
    const pend = E.pending(S);
    if (pend.length) act(S, pend[0].p, { a: S.curBet > S.bet[pend[0].p] ? "call" : "check" });
    else { E.step(S); const c = E.check(S); ok(c === true, `check failed: ${c}`); }
  }
}

/* ===================== 4. Betting order · minimum raise ===================== */
{
  // 3 players: button 0, SB 1, BB 2 → preflop starts with 0 (UTG = button)
  const S = table([1000, 1000, 1000], 0);
  eq([S.button, S.sbSeat, S.bbSeat, S.turn], [0, 1, 2, 0], "3 seats: button·SB·BB·first to act");
  eq([S.bet[1], S.bet[2]], [10, 20], "blinds 10/20");
  act(S, 1, { a: "call" }, false);                            // not their turn
  act(S, 0, { a: "check" }, false);                           // must put in 20
  act(S, 0, { a: "raise", to: 30 }, false);                   // minimum 40
  act(S, 0, { a: "raise", to: 60 });                          // raised by 40 → next minimum 100
  act(S, 1, { a: "raise", to: 99 }, false);
  act(S, 1, { a: "raise", to: 100 });
  eq(E.view(S, 2).my.minTo, 140, "after a raise to 100 the minimum is 140");
  act(S, 2, { a: "fold" });
  act(S, 0, { a: "call" });
  eq([S.phase, S.street], ["deal", 0], "preflop betting over");
  E.step(S);
  eq([S.street, S.turn, S.board.length], [1, 1, 3], "flop: starts left of the button (SB)");
  act(S, 1, { a: "raise", to: 10 }, false);                   // minimum bet = BB 20
  act(S, 1, { a: "raise", to: 20 });
  act(S, 0, { a: "fold" });
  eq(S.phase, "end", "everyone folds → hand over");
  eq(S.last.showdown, false, "no showdown when the hand ends by folding");
  eq(S.last.shows, [], "no hand is shown when the hand ends by folding");
  eq(S.chips, [900, 1120, 980], "seat 1 takes the 220 pot (uncalled 20 returned)");
  const v = E.view(S, 0);
  ok(v.seats.every(s => s.cards === null), "nobody's cards are visible after a hand that ended by folding");
}
{
  // heads-up: the button is the SB and acts first preflop; the BB acts first from the flop
  const S = table([1000, 1000], 1);
  eq([S.button, S.sbSeat, S.bbSeat, S.turn], [1, 1, 0, 1], "heads-up: button = SB, button first");
  act(S, 1, { a: "call" });
  ok(S.phase === "bet" && S.turn === 0, "BB has the option after a limp");
  eq(E.view(S, 0).my.kinds, ["fold", "check", "raise", "allin"], "BB option: check or raise");
  act(S, 0, { a: "check" });
  E.step(S);
  eq(S.turn, 0, "heads-up flop: BB first");
}
{
  // a short all-in does not reopen betting for players who already acted
  const S = table([1000, 150, 1000], 0);                  // 0 button, 1 SB (150), 2 BB
  act(S, 0, { a: "raise", to: 100 });                      // raise by 80 (minimum size 80)
  act(S, 1, { a: "allin" });                               // 150 = raise by 50 (short)
  eq([S.curBet, S.minRaise], [150, 80], "short all-in: current bet 150, minimum raise size stays 80");
  eq(E.view(S, 2).my.minTo, 230, "the BB, who hasn't acted yet, can raise to 230");
  act(S, 2, { a: "call" });
  act(S, 0, { a: "raise", to: 400 }, false);
  act(S, 0, { a: "allin" }, false);
  eq(E.view(S, 0).my.kinds, ["fold", "call"], "a player who already acted may only call/fold");
  act(S, 0, { a: "call" });
  eq(S.phase, "deal", "betting over");
}
{
  // several short all-ins adding up to a full raise do reopen betting
  const S = table([1000, 1000, 170, 230], 0);              // 0 button, 1 SB, 2 BB, 3 UTG
  act(S, 3, { a: "call" });
  act(S, 0, { a: "call" });
  act(S, 1, { a: "call" });
  act(S, 2, { a: "check" });
  E.step(S);                                               // flop: seat 1 first
  act(S, 1, { a: "raise", to: 100 });                      // bet 100 (minimum size 100)
  act(S, 2, { a: "allin" });                               // 150
  act(S, 3, { a: "allin" });                               // 210 → 110 more than seat 1's 100 = a full raise
  act(S, 0, { a: "call" });
  ok(E.view(S, 1).my.kinds.includes("raise"), "stacked all-ins worth a full raise allow raising again");
  act(S, 1, { a: "raise", to: 420 });                      // minimum 210 + 100 (largest full raise size) = 310 or more
  act(S, 0, { a: "call" });
  eq(S.phase, "deal", "betting over");
}
{
  // conversely, a single short all-in does not reopen betting (same hand, 4 players)
  const S = table([1000, 1000, 170, 1000], 0);
  act(S, 3, { a: "call" });
  act(S, 0, { a: "call" });
  act(S, 1, { a: "call" });
  act(S, 2, { a: "check" });
  E.step(S);
  act(S, 1, { a: "raise", to: 100 });
  act(S, 2, { a: "allin" });                               // 150: raises by only 50
  act(S, 3, { a: "call" });
  act(S, 0, { a: "call" });
  eq(E.view(S, 1).my.kinds, ["fold", "call"], "one short all-in does not reopen betting for seat 1");
  act(S, 1, { a: "raise", to: 300 }, false);
}
{
  // folded and all-in players can't act; no raising when everyone else is all-in
  const S = table([1000, 1000, 300], 0);
  act(S, 0, { a: "fold" });
  act(S, 0, { a: "call" }, false);
  act(S, 1, { a: "call" });
  act(S, 2, { a: "allin" });
  eq(E.view(S, 1).my.kinds, ["fold", "call"], "only call/fold when every opponent is all-in");
  act(S, 1, { a: "raise", to: 600 }, false);
}

/* ===================== 5. Side pots ===================== */
/* 3 players all-in with different stacks. 0 button (100), 1 SB (300), 2 BB (600) */
function threeAllIn(holes, board) {
  const S = table([100, 300, 600], 0);
  rig(S, holes, board);
  act(S, 0, { a: "allin" });
  act(S, 1, { a: "allin" });
  act(S, 2, { a: "call" });
  ok(S.runout, "everyone all-in → hands shown, board runs out automatically");
  eq(Object.keys(S.shown).map(Number), [0, 1, 2], "all three all-in hands are shown");
  runOut(S);
  return S;
}
const BOARD = H("S1 H1 D13 C8 S4");                     // A A K 8 4
const QQ = H("S12 H12"), TT = H("S10 H10"), sixes = H("S6 H6"), aKick = H("C1 D2"), q2 = H("D12 C3"), q3 = H("C12 C2"), weak = H("D3 H2");
{
  const S = threeAllIn({ 0: aKick, 1: QQ, 2: TT }, BOARD);      // 0: trip aces, 1: AA QQ, 2: AA TT
  eq(S.chips, [300, 400, 300], "shortest stack wins: main 300 / side 400 to seat 1 / seat 2 gets its remaining 300 back");
  eq(S.last.pots.map(x => x.amount), [300, 400], "main 300 · side 400");
  eq(S.last.pots.map(x => x.label.en), ["Main pot", "Side pot 1"], "pot names");
  eq(S.last.pots.map(x => x.label.ko), ["메인 팟", "사이드 팟 1"], "pot names (Korean)");
  eq(S.out.map(o => o.p), [], "nobody busts");
}
{
  const S = threeAllIn({ 0: sixes, 1: QQ, 2: aKick }, BOARD);   // seat 2 is strongest
  eq(S.chips, [0, 0, 1000], "the biggest stack takes everything");
  eq(S.out.map(o => o.p), [0, 1], "busting in the same hand: seat 0, who started shorter, goes out first");
  const res = E.results(S);
  eq(res.map(r => [r.p, r.rank]), [[2, 1], [1, 2], [0, 3]], "ranks: survivor > bigger-stacked buster > shorter-stacked buster");
}
{
  const S = threeAllIn({ 0: TT, 1: aKick, 2: QQ }, BOARD);      // seat 1 is strongest, 0 < 2
  eq(S.chips, [0, 700, 300], "middle stack wins: main + side 700, seat 2 keeps its remaining 300");
}
{
  // seats 0 and 2 split the main pot, seat 2 takes the side pot
  const S = threeAllIn({ 0: q2, 1: weak, 2: q3 }, BOARD);       // 0·2: AA K Q 8 → equal, 1: AA K 8 4
  eq(S.last.pots[0].winners.map(w => [w.p, w.amount]), [[2, 150], [0, 150]], "seats 0·2 split the 300 main pot (left of the button first)");
  eq(S.last.pots[1].winners.map(w => [w.p, w.amount]), [[2, 400]], "side 400 goes to seat 2");
  eq(S.chips, [150, 0, 850], "chip result: seat 0 150, seat 2 150+400+remaining 300");
  eq(S.last.pots[0].hand.en, "One pair", "winning hand name");
}
{
  // when splitting, the odd chip goes to the winner closest to the button's left
  const S = table([101, 1000, 1000], 0);                // 0 button, 1 SB, 2 BB
  rig(S, { 0: H("H12 C2"), 1: H("D12 C3"), 2: H("D2 H3") }, BOARD);   // 0·1 tie with AA K Q 8, 2 has AA K 8 4
  act(S, 0, { a: "allin" });
  act(S, 1, { a: "call" });
  act(S, 2, { a: "call" });
  runOut(S);
  eq(S.last.pots[0].amount, 303, "main pot 303");
  eq(S.last.pots[0].winners.map(w => [w.p, w.amount]), [[1, 152], [0, 151]], "the odd chip goes to seat 1, left of the button");
  eq(S.chips, [151, 1051, 899], "chip result");
  ok(S.last.shows.every(s => s.p !== undefined) && S.last.shows.length === 3, "all three showdown hands shown");
}
{
  // folded hands are not shown at showdown + the uncalled bet is returned
  const S = table([1000, 1000, 1000], 0);
  rig(S, { 0: H("H12 C2"), 1: H("D12 C3"), 2: H("D2 H3") }, BOARD);
  act(S, 0, { a: "call" });
  act(S, 1, { a: "call" });
  act(S, 2, { a: "check" });
  E.step(S);
  act(S, 1, { a: "check" });
  act(S, 2, { a: "raise", to: 40 });
  act(S, 0, { a: "fold" });
  act(S, 1, { a: "call" });
  runOut(S);
  eq(S.last.shows.map(s => s.p), [1, 2], "folded seat 0 is not shown");
  const v = E.view(S, 1);
  eq(v.seats[0].cards, null, "folded seat 0's cards are not in the view either");
  eq(E.leak(S, 1, JSON.parse(JSON.stringify(v))), true, "leak check passes");
  eq(S.chips, [980, 1080, 940], "seat 1 (AA Q) beats seat 2 (AA 8 4)");
}
{
  // big blind is a short all-in → others still match the full BB (20); the excess is returned
  const S = table([1000, 1000, 5], 0);
  rig(S, { 0: H("H12 C2"), 1: H("D12 C3"), 2: H("S13 H13") }, BOARD);
  eq([S.bet[2], S.curBet], [5, 20], "BB all-in for 5, current bet 20");
  act(S, 0, { a: "fold" });
  act(S, 1, { a: "call" });
  ok(S.runout, "SB calls → nobody left to bet");
  runOut(S);
  eq(S.chips, [1000, 995, 10], "BB (all-in for 5) wins only 5 from the SB; the SB's other 15 is returned");
}

/* ===================== 6. Playing to the end · hand limit ===================== */
{
  const S = E.setup({ n: 4, seed: 7, settings: { chips: 1000, blinds: "up", hands: 20 } });
  let guard = 0;
  while (!E.over(S) && guard++ < 100000) {
    const pend = E.pending(S);
    if (!pend.length) { E.step(S); continue; }
    const p = pend[0].p;
    E.apply(S, p, E.timeout(S, p, "bet"));
  }
  eq(S.handNo, 20, "ends at the 20-hand limit");
  const res = E.results(S);
  ok(res.some(r => r.rank === 1), "there is a 1st place");
}

console.log(`${fail ? "✗" : "✓"} poker unit tests: ${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
