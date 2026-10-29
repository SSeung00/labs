/* Liar Game word data checks:  node games/liar/test_words.mjs
   - every word: Korean has 2+ syllables, words are unique, at least 4 hints
   - no hint contains its own word; no vague hint contains a word of its category; no universal hint contains any word
   - hint lengths: Korean <= 14, English <= 24 characters
   - containsWord() behaves as intended on a few hand-made cases */
import { CATS, UNIVERSAL, MAX_AI_KO, MAX_AI_EN, containsWord, hintLen, normHint } from "./words.js";

let bad = 0;
const fail = m => { bad++; console.log("✗ " + m); };
const all = [];
const seen = new Set();
for (const c of CATS) {
  if (c.words.length < 12) fail(`${c.id}: only ${c.words.length} words`);
  if (c.vague.length < 6) fail(`${c.id}: only ${c.vague.length} vague hints`);
  for (const { w, h } of c.words) {
    all.push(w);
    for (const k of [w.ko, w.en]) { if (seen.has(k)) fail(`duplicate word ${k}`); seen.add(k); }
    if (hintLen(w.ko) < 2) fail(`${c.id}: one-syllable word ${w.ko}`);
    if (h.length < 4 || h.length > 6) fail(`${w.ko}: ${h.length} hints`);
    for (const x of h) {
      if (containsWord(x.ko, w) || containsWord(x.en, w)) fail(`${w.ko}: hint "${x.ko} / ${x.en}" contains the word`);
      if (hintLen(x.ko) > MAX_AI_KO || hintLen(x.en) > MAX_AI_EN) fail(`${w.ko}: hint too long "${x.ko} / ${x.en}"`);
      if (normHint(x.ko) !== x.ko || normHint(x.en) !== x.en || !x.ko || !x.en) fail(`${w.ko}: hint not normalised "${x.ko} / ${x.en}"`);
    }
  }
  for (const x of c.vague) {
    for (const { w } of c.words) if (containsWord(x.ko, w) || containsWord(x.en, w)) fail(`${c.id}: vague hint "${x.ko} / ${x.en}" contains ${w.ko}`);
    if (hintLen(x.ko) > MAX_AI_KO || hintLen(x.en) > MAX_AI_EN) fail(`${c.id}: vague hint too long "${x.ko} / ${x.en}"`);
  }
}
for (const x of UNIVERSAL) for (const w of all) if (containsWord(x.ko, w) || containsWord(x.en, w)) fail(`universal hint "${x.ko}" contains ${w.ko}`);

const W = (ko, en) => ({ ko, en });
const cases = [
  ["피자 좋아", W("피자", "Pizza"), true], ["피 자", W("피자", "Pizza"), true], ["PIZZA!", W("피자", "Pizza"), true],
  ["pizzas", W("피자", "Pizza"), true], ["catch mice", W("고양이", "Cat"), false], ["two cats", W("고양이", "Cat"), true],
  ["icecream", W("아이스크림", "Ice cream"), true], ["ice-cream cone", W("아이스크림", "Ice cream"), true], ["ice cold", W("아이스크림", "Ice cream"), false],
  ["elephant", W("개미", "Ant"), false], ["drum", W("드럼", "Drums"), true], ["치즈", W("피자", "Pizza"), false]
];
for (const [t, w, want] of cases) if (containsWord(t, w) !== want) fail(`containsWord("${t}", ${w.en}) should be ${want}`);

const nW = CATS.reduce((a, c) => a + c.words.length, 0), nH = CATS.reduce((a, c) => a + c.words.reduce((b, x) => b + x.h.length, 0), 0);
console.log(bad ? `✗ ${bad} problem(s)` : `✓ liar words: ${CATS.length} categories · ${nW} words · ${nH} hints`);
process.exit(bad ? 1 : 0);
