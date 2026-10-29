/* Seeded random numbers (mulberry32). The 32-bit state lives in the game state as S.rs — same seed, same game.
   AI must not touch the state, so it uses the separate rng() function it is given. */

export function rand(S) {
  const a = (S.rs = (S.rs + 0x6D2B79F5) >>> 0);
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const randInt = (S, n) => Math.floor(rand(S) * n);

export function shuffle(S, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(S, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* A standalone random function, independent of any game state (tests pass it to the AI) */
export function makeRng(seed) {
  const S = { rs: seed >>> 0 };
  return () => rand(S);
}

/* Shuffle / pick with rng() — for AI code */
export function shuffleWith(rng, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export const pick = (rng, a) => a[Math.floor(rng() * a.length)];
