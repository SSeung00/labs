/* Liar Game rule checks:  node games/liar/test_rules.mjs
   validate() rejections, scoring of every outcome, ties, the fool-liar variant and who sees what. */
import E from "./engine.js";
import { CATS } from "./words.js";

let bad = 0;
const ok = (c, m) => { if (!c) { bad++; console.log("✗ " + m); } };
const isErr = r => r !== true && r && typeof r.ko === "string";

/* A 5-player game in its hint phase */
function game(settings = {}, n = 5, seed = 42) {
  const S = E.setup({ n, seed, settings: { rounds: 3, passes: 1, fool: 0, time: 1, ...settings } });
  E.step(S);
  return S;
}
const word = S => CATS[S.cat].words[S.wi].w;
/* Everyone gives a harmless hint in turn */
function hints(S) { while (S.phase === "hint") { const p = E.pending(S)[0].p; E.apply(S, p, { hint: "흠" + p }); } }
function voteAll(S, target) { for (let p = 0; p < S.n; p++) if (S.phase === "vote") E.apply(S, p, { vote: target(p) }); }

/* ---------- validate ---------- */
{
  const S = game();
  const t = E.pending(S)[0].p, other = (t + 1) % S.n;
  const W = word(S);
  const citizen = t !== S.liar;
  ok(isErr(E.validate(S, other, { hint: "안녕" })), "hint out of turn accepted");
  ok(isErr(E.validate(S, t, { hint: "" })), "empty hint accepted");
  ok(isErr(E.validate(S, t, { hint: "   " })), "blank hint accepted");
  ok(isErr(E.validate(S, t, { hint: "123456789012345" })), "15-character hint accepted");
  ok(E.validate(S, t, { hint: "12345678901234" }) === true, "14-character hint rejected");
  ok(isErr(E.validate(S, t, {})), "missing hint accepted");
  ok(isErr(E.validate(S, t, { hint: 5 })), "number hint accepted");
  ok(isErr(E.validate(S, t, { hint: ["a"] })), "array hint accepted");
  ok(isErr(E.validate(S, t, { hint: { ko: "가" } })), "half bilingual hint accepted");
  ok(isErr(E.validate(S, t, { vote: other })), "vote during the hint phase accepted");
  ok(isErr(E.validate(S, t, null)), "null action accepted");
  if (citizen) {
    ok(isErr(E.validate(S, t, { hint: W.ko })), "the word itself accepted");
    ok(isErr(E.validate(S, t, { hint: `큰 ${W.ko}!` })), "the word inside a hint accepted");
    ok(isErr(E.validate(S, t, { hint: W.en.toUpperCase() })), "the English word accepted");
    ok(isErr(E.validate(S, t, { hint: [...W.ko].join(" ") })), "the spaced-out word accepted");
    ok(isErr(E.validate(S, t, { hint: { ko: "좋아", en: W.en + "s" } })), "the plural English word accepted");
  }
  hints(S);
  ok(S.phase === "vote", "no vote phase after the hints");
  ok(E.pending(S).length === S.n && E.pending(S).every(x => x.secret && x.kind === "vote"), "votes aren't pending for everyone as secret");
  ok(isErr(E.validate(S, 0, { vote: 0 })), "vote for oneself accepted");
  ok(isErr(E.validate(S, 0, { vote: S.n })), "vote out of range accepted");
  ok(isErr(E.validate(S, 0, { vote: 1.5 })), "fractional vote accepted");
  ok(isErr(E.validate(S, 0, { hint: "또" })), "hint during the vote accepted");
  E.apply(S, 0, { vote: 1 });
  ok(isErr(E.validate(S, 0, { vote: 2 })), "second vote accepted");
  ok(E.view(S, 1).votes === null && E.view(S, 1).myVote === -1 && E.view(S, 0).myVote === 1, "votes visible before everyone voted");
}

/* ---------- outcomes and points ---------- */
{
  // nobody accused (tie) → liar +3
  const S = game({}, 4);
  hints(S);
  voteAll(S, p => (p + 1) % 4);            // everyone gets one vote: a tie
  ok(S.accused === -1 && S.phase === "tally", "a tie should accuse nobody");
  E.step(S);
  ok(S.phase === "result" && S.winner === "liar" && S.scores[S.liar] === 3 && S.scores.reduce((a, b) => a + b) === 3, "tie: liar should get +3");
}
{
  // wrong person accused → liar +3
  const S = game();
  hints(S);
  const wrong = (S.liar + 1) % S.n;
  voteAll(S, p => (p === wrong ? S.liar : wrong));
  E.step(S);
  ok(S.accused === wrong && !S.caught && S.winner === "liar" && S.scores[S.liar] === 3, "wrong accusation: liar should get +3");
}
{
  // caught, right guess → liar +2; caught, wrong guess → every citizen +1
  for (const right of [true, false]) {
    const S = game();
    hints(S);
    voteAll(S, p => (p === S.liar ? (p + 1) % S.n : S.liar));
    E.step(S);
    ok(S.phase === "guess" && E.pending(S)[0].p === S.liar, "caught liar should guess");
    ok(S.opts.length === 9 && S.opts.includes(S.wi) && new Set(S.opts).size === 9, "nine distinct options with the answer");
    ok(isErr(E.validate(S, (S.liar + 1) % S.n, { pick: 0 })), "a citizen's guess accepted");
    ok(isErr(E.validate(S, S.liar, { pick: 9 })), "guess out of range accepted");
    const i = S.opts.indexOf(S.wi), pick = right ? i : (i + 1) % 9;
    const sp = E.view(S, -1), lv = E.view(S, S.liar);
    ok(sp.answer === null && lv.answer === null && sp.liar === S.liar, "answer shown during the guess");
    E.apply(S, S.liar, { pick });
    const total = S.scores.reduce((a, b) => a + b, 0);
    if (right) ok(S.winner === "liar" && S.scores[S.liar] === 2 && total === 2, "right guess: liar should get +2");
    else ok(S.winner === "citizens" && S.scores[S.liar] === 0 && total === S.n - 1, "wrong guess: every citizen +1");
    ok(E.view(S, -1).answer.ko === word(S).ko, "answer not revealed after the round");
  }
}
{
  // full game: three rounds, then over; ranks share ties
  const S = game({ rounds: 3 }, 3);
  for (let r = 0; r < 3; r++) {
    hints(S);
    voteAll(S, p => (p + 1) % 3);
    E.step(S);                               // tie → result
    E.step(S);                               // next round / over
  }
  ok(E.over(S), "game not over after the last round");
  const res = E.results(S);
  ok(res.length === 3 && res.every(x => x.rank === 1 + S.scores.filter(s => s > x.score).length), "ranks wrong");
  ok(new Set(S.usedCats).size === 3, "categories repeated");
}

/* ---------- who sees what ---------- */
{
  const S = game({ fool: 1 }, 6, 7);
  const L = S.liar, c = (L + 1) % 6;
  const lv = E.view(S, L), cv = E.view(S, c), sv = E.view(S, -1);
  ok(S.fi >= 0 && S.fi !== S.wi, "fool liar has no different word");
  ok(lv.word && lv.word.ko === CATS[S.cat].words[S.fi].w.ko && !lv.liarMe, "fool liar should see the fake word and not know");
  ok(cv.word.ko === word(S).ko && !cv.liarMe, "citizen should see the word");
  ok(sv.word === null && sv.liar === -1 && !JSON.stringify(sv).includes(JSON.stringify(word(S).ko)), "spectator sees the word or the liar");
  for (let p = -1; p < 6; p++) ok(E.leak(S, p, E.view(S, p)) === true, `leak check fails for seat ${p}`);
  hints(S);
  voteAll(S, p => (p === L ? (p + 1) % 6 : L));
  E.step(S);
  ok(E.view(S, L).liarMe && E.view(S, -1).liar === L, "liar not revealed after the unmasking");
  ok(!S.opts.includes(S.fi), "fool liar's own word among the options");
}
{
  const S = game({ fool: 0 }, 5, 9);
  const lv = E.view(S, S.liar);
  ok(lv.word === null && lv.liarMe === true, "liar should know they are the liar and see no word");
  // the liar has no word to give away: only length and emptiness are checked for them
  const t = E.pending(S)[0].p;
  if (t === S.liar) ok(E.validate(S, t, { hint: word(S).ko }) === true, "the liar can't be blocked by the word they don't know");
}

console.log(bad ? `✗ ${bad} problem(s)` : "✓ liar rules");
process.exit(bad ? 1 : 0);
