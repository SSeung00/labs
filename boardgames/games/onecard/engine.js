/* One Card — 52 cards + black and colour jokers = 54. Play one card at a time matching the top card's suit or rank.
   Attack cards (2 · A · ♠A · jokers) stack a penalty; whoever can't answer draws all of it.
   J skip · Q reverse · K play again · 7 change suit. With one card left you must call "One card!". */
import { shuffle, randInt } from "../../core/rng.js";
import { deck52, suitOf, rankOf, isJoker, cardNameTx, SUITS, SUIT_SYMBOL } from "../../core/cards.js";
import { tx } from "../../core/i18n.js";

const name = tx("원카드", "One Card");
const TOTAL = 54;
const MAX_MOVES = 3000;                                   // past this, rank by cards left and end (guards against endless games)
const NEED_LABEL = { S: "♠", H: "♥", D: "♦", C: "♣", B: "♠ · ♣", R: "♥ · ♦" };
const NEED_SET = { S: ["S"], H: ["H"], D: ["D"], C: ["C"], B: ["S", "C"], R: ["H", "D"] };
const CALL_P = {
  owner: { easy: .6, normal: .85, hard: .97 },            // chance the player with one card calls it
  other: { easy: .2, normal: .4, hard: .6 }               // chance someone else tries to catch them
};

/* ---------- Card properties ---------- */
/* Attack value: 2 → 2, A → 3, ♠A → 5, black joker → 5, colour joker → 7. 0 for non-attack cards */
function power(c) {
  if (c === "JB") return 5;
  if (c === "JC") return 7;
  const r = rankOf(c);
  if (r === 2) return 2;
  if (r === 1) return c === "S1" ? 5 : 3;
  return 0;
}
const isPlain = c => !isJoker(c) && [3, 4, 5, 6, 8, 9, 10].includes(rankOf(c));
const top = S => S.discard[S.discard.length - 1];
const nk = c => cardNameTx(c).ko;                         // card name for the Korean / English half of a text
const ne = c => cardNameTx(c).en;
const ord = n => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
const cards = n => `${n} card${n === 1 ? "" : "s"}`;

/* ---------- Seats · turns ---------- */
const alive = (S, q) => S.st[q] === "in";
const aliveList = S => S.st.map((s, q) => (s === "in" ? q : -1)).filter(q => q >= 0);
function nextAlive(S, p, dir = S.dir) {
  for (let k = 1; k <= S.n; k++) { const q = ((p + dir * k) % S.n + S.n) % S.n; if (alive(S, q)) return q; }
  return -1;
}

/* Can c be played right now? (whether it is in hand is checked separately) */
function canPlay(S, c) {
  const t = top(S);
  if (S.attack > 0) {
    if (S.set.three && !isJoker(t) && rankOf(t) === 2 && !isJoker(c) && rankOf(c) === 3 && suitOf(c) === suitOf(t)) return true;
    const v = power(c);
    if (!v || v < power(t)) return false;
    return isJoker(c) || (!isJoker(t) && (suitOf(c) === suitOf(t) || rankOf(c) === rankOf(t)));
  }
  if (isJoker(c)) return true;
  if (S.need) return NEED_SET[S.need].includes(suitOf(c));
  return suitOf(c) === suitOf(t) || rankOf(c) === rankOf(t);
}
const legalCards = (S, p) => S.hands[p].filter(c => canPlay(S, c));
const needsSuit = c => !isJoker(c) && rankOf(c) === 7;

/* "One card" window: everyone (all seats) who hasn't decided yet */
function callWaiting(S) {
  if (!S.call) return [];
  const out = [];
  for (let q = 0; q < S.n; q++) if (!S.call.skip.includes(q)) out.push(q);
  return out;
}

/* ---------- Moving cards ---------- */
/* When the deck is empty, shuffle the discards (all but the top card) into a new deck */
function refill(S, ev) {
  if (S.discard.length <= 1) return;
  const t = S.discard.pop();
  S.deck = shuffle(S, S.discard).concat(S.deck);
  S.discard = [t];
  // Shuffled-in cards are hidden again — drop them from the recent strip and last actions too
  S.recent = S.recent.filter(r => r.c === t);
  S.act = S.act.map(a => (a && a.c && a.c !== t ? null : a));
  ev.push({ type: "shuffle", text: tx("버린 카드를 섞어 새 더미를 만들었습니다", "The discards were shuffled into a new deck") });
}
/* p draws n cards — only as many as there are. Returns the drawn cards */
function drawCards(S, p, n, ev) {
  const got = [];
  for (let i = 0; i < n; i++) {
    if (!S.deck.length) refill(S, ev);
    if (!S.deck.length) break;
    got.push(S.deck.pop());
  }
  S.hands[p].push(...got);
  return got;
}

/* ---------- Ranking · end ---------- */
function finish(S, p, ev) {
  S.st[p] = "done";
  S.done.push(p);
  S.place[p] = S.done.length;
  const k = S.place[p];
  S.note[p] = S.set.end === "first" ? tx("1등 — 카드를 다 냄", "1st — played all cards") : tx(`${k}등 — 카드를 다 냄`, `${ord(k)} — played all cards`);
  if (S.set.end === "first") { endGame(S, ev, tx(`{${p}} 님이 카드를 다 냈습니다! 1등 🎉`, `{${p}} played all their cards! 1st place 🎉`)); return; }
  ev.push({ type: "out", p, place: k, text: tx(`{${p}} 님이 카드를 다 냈습니다 (${k}등)`, `{${p}} played all their cards (${ord(k)})`) });
  if (aliveList(S).length <= 1) endGame(S, ev);
}
/* Bust: a hand at or over the limit is out — last among those still in. Its cards go under the deck */
function bustCheck(S, p, ev) {
  if (!S.set.bust || S.hands[p].length < S.set.bust || !alive(S, p)) return false;
  const k = S.hands[p].length;
  S.st[p] = "bust";
  S.busted.push(p);
  S.place[p] = S.n - S.busted.length + 1;
  S.note[p] = tx(`파산 (${k}장)`, `Bust (${k} cards)`);
  S.deck = shuffle(S, S.hands[p].splice(0)).concat(S.deck);
  ev.push({ type: "bust", p, n: k, text: tx(`{${p}} 님 파산! (${k}장) — 탈락`, `{${p}} goes bust! (${k} cards) — out`) });
  if (aliveList(S).length <= 1) endGame(S, ev);
  else if (S.turn === p) { S.turn = nextAlive(S, p); S.again = false; }
  return true;
}
/* Game over: players still in are ranked by fewest cards (ties share a rank) */
function endGame(S, ev, text) {
  S.phase = "over";
  S.call = null;
  S.again = false;
  const rest = aliveList(S), base = S.done.length + 1;
  for (const q of rest) {
    S.place[q] = base + rest.filter(o => S.hands[o].length < S.hands[q].length).length;
    const h = S.hands[q].length;
    S.note[q] = rest.length === 1 && base === 1 ? tx("1등 — 끝까지 살아남음", "1st — last one standing") : tx(`남은 카드 ${h}장`, `${cards(h)} left`);
  }
  if (!text) {
    if (rest.length === 1 && base === 1) text = tx(`{${rest[0]}} 님만 남았습니다 — 1등 🎉`, `Only {${rest[0]}} is left — 1st place 🎉`);
    else if (rest.length === 1) text = tx(`게임 끝 — {${rest[0]}} 님이 마지막까지 남았습니다`, `Game over — {${rest[0]}} was left until the end`);
    else text = tx("게임 끝", "Game over");
  }
  ev.push({ type: "over", text });
}

/* Repetition check: with the deck empty, the same position (hands · discards · turn) three times means an endless loop */
function repeated(S) {
  if (S.deck.length) { S.seen = {}; return false; }
  const sig = S.hands.map(h => h.slice().sort().join("")).join("|") + "/" + S.discard.join("") + "/" + [S.turn, S.dir, S.attack, S.need, S.again].join(",");
  let h = 2166136261;
  for (let i = 0; i < sig.length; i++) h = Math.imul(h ^ sig.charCodeAt(i), 16777619);
  const key = (h >>> 0).toString(36);
  if (Object.keys(S.seen).length > 400) S.seen = {};
  S.seen[key] = (S.seen[key] || 0) + 1;
  return S.seen[key] >= 3;
}

/* ---------- Actions ---------- */
function doPlay(S, p, a, ev) {
  const c = a.card, hand = S.hands[p];
  hand.splice(hand.indexOf(c), 1);
  const wasAttack = S.attack > 0, before = aliveList(S).length;
  S.discard.push(c);
  if (!isJoker(c)) S.miss[p] = S.miss[p].filter(s => s !== suitOf(c));
  const r = isJoker(c) ? 0 : rankOf(c), v = power(c);
  const e = { type: "play", p, card: c, attack: 0, text: null };
  if (wasAttack && r === 3) {                                   // block a 2 with a 3 — the whole penalty is cancelled
    S.attack = 0; S.need = null;
    e.block = true;
    e.text = tx(`{${p}} 님이 ${nk(c)}(으)로 공격을 막았습니다! 🛡️`, `{${p}} blocks the attack with ${ne(c)}! 🛡️`);
  } else if (v) {
    S.attack += v;
    S.need = c === "JB" ? "B" : c === "JC" ? "R" : null;
    e.attack = S.attack;
    e.text = wasAttack
      ? tx(`{${p}} 님이 ${nk(c)}(으)로 받아쳤습니다! (누적 ${S.attack}장)`, `{${p}} hits back with ${ne(c)}! (stack: ${S.attack})`)
      : tx(`{${p}} 님이 ${nk(c)} 공격! (누적 ${S.attack}장)`, `{${p}} attacks with ${ne(c)}! (stack: ${S.attack})`);
  } else {
    S.need = r === 7 ? a.suit : null;
    if (r === 7) {
      e.suit = a.suit;
      e.text = tx(`{${p}} 님이 ${nk(c)} — 무늬를 ${SUIT_SYMBOL[a.suit]}(으)로 바꿨습니다`, `{${p}} plays ${ne(c)} — suit changed to ${SUIT_SYMBOL[a.suit]}`);
    }
    else e.text = tx(`{${p}} 님이 ${nk(c)}을(를) 냈습니다`, `{${p}} plays ${ne(c)}`);
  }
  const add = (ko, en) => { e.text.ko += ko; e.text.en += en; };
  ev.push(e);
  S.recent.push(r === 7 ? { p, c, s: a.suit } : { p, c });
  if (S.recent.length > 6) S.recent.shift();
  S.act[p] = { c };
  if (!hand.length) { finish(S, p, ev); if (S.phase !== "play") return; }

  // Next turn
  if (r === 13 && alive(S, p)) {
    S.again = true; S.turn = p;
    add(" — 한 장 더!", " — play again!");
  } else {
    S.again = false;
    if (r === 12) { S.dir = -S.dir; e.reverse = true; }
    let t = nextAlive(S, p);
    if (r === 11 || (r === 12 && before <= 2)) {
      e.skip = t;
      if (r === 11) add(` — {${t}} 님 건너뜀`, ` — {${t}} is skipped`);
      t = nextAlive(S, t);
    }
    if (r === 12) before <= 2 ? add(" — 방향 바꿈 (둘이라 한 번 더)", " — reverse (two players: go again)") : add(" — 방향이 바뀝니다", " — direction reversed");
    S.turn = t;
  }
  // One card left: open the "One card!" call window
  if (S.set.call && hand.length === 1 && alive(S, p)) {
    S.call = { p, skip: [] };
    ev.push({ type: "callOpen", p });
  }
}

function doDraw(S, p, ev) {
  const pen = S.attack, want = pen > 0 ? pen : 1;
  if (!pen) for (const s of NEED_SET[S.need] || [suitOf(top(S))]) if (SUITS.includes(s) && !S.miss[p].includes(s)) S.miss[p].push(s);
  const got = drawCards(S, p, want, ev);
  if (pen >= 3) S.miss[p] = [];
  S.attack = 0;
  S.again = false;
  let text;
  if (!got.length) text = tx(`{${p}} 님이 넘겼습니다 (받을 카드가 없음)`, `{${p}} passes (no cards left to draw)`);
  else if (pen) text = tx(`{${p}} 님이 공격을 받아 ${got.length}장을 가져갔습니다`, `{${p}} takes the attack and draws ${cards(got.length)}`);
  else text = tx(`{${p}} 님이 카드를 한 장 받았습니다`, `{${p}} draws a card`);
  ev.push({ type: "draw", p, n: got.length, cards: got, reason: pen ? "penalty" : "pass", text });
  S.act[p] = { d: got.length, pen: pen > 0 };
  bustCheck(S, p, ev);
  if (S.phase === "play") S.turn = nextAlive(S, p);
}

function doCall(S, p, a, ev) {
  const o = S.call.p;
  if (a.call) {
    S.call = null;
    if (p === o) { ev.push({ type: "call", p, owner: o, safe: true, text: tx(`{${o}} 님: "원카드!" 📣`, `{${o}}: "One card!" 📣`) }); return; }
    const got = drawCards(S, o, 1, ev);
    ev.push({ type: "call", p, owner: o, safe: false,
      text: tx(`{${p}} 님이 {${o}} 님을 잡았습니다! {${o}} 님 ${got.length}장 추가`, `{${p}} caught {${o}}! {${o}} draws ${cards(got.length)}`) });
    ev.push({ type: "draw", p: o, n: got.length, cards: got, reason: "catch" });
    S.act[o] = { d: got.length, pen: true, catch: true };
    bustCheck(S, o, ev);
    return;
  }
  S.call.skip.push(p);
  if (!callWaiting(S).length) {
    S.call = null;
    ev.push({ type: "call", p: -1, owner: o, safe: null, text: tx(`원카드 — 아무도 {${o}} 님을 잡지 못했습니다`, `One card — nobody caught {${o}}`) });
  }
}

/* ---------- AI ---------- */
function suitCounts(cards) {
  const k = { S: 0, H: 0, D: 0, C: 0 };
  for (const c of cards) if (!isJoker(c)) k[suitOf(c)]++;
  return k;
}
/* Suit to name with a 7: the suit I hold most of (hard: small bonus for a suit the next player seems to lack) */
function bestSuit(S, p, rest, level, rng, nx) {
  const k = suitCounts(rest);
  let best = SUITS[Math.floor(rng() * 4)], bs = -1;
  for (const s of SUITS) {
    let sc = k[s] * 2 + rng() * .5;
    if (level === "hard" && nx >= 0 && S.miss[nx].includes(s)) sc += 1.5;
    if (sc > bs) { bs = sc; best = s; }
  }
  return best;
}

/* Hard only — card counting: assume q holds h cards drawn from the cards I haven't seen (others' hands + deck);
   the chance that q holds none of the m cards that could answer */
const ALL = [...deck52(), "JB", "JC"];
function unseenOf(S, p) {
  const seen = new Set(S.hands[p].concat(S.discard));
  return ALL.filter(c => !seen.has(c));
}
function pNone(U, m, h) {
  let pr = 1;
  for (let i = 0; i < h && pr > 0; i++) pr *= U - i > 0 ? Math.max(0, U - m - i) / (U - i) : 0;
  return pr;
}
/* Cards the next player could play after c (for an attack: cards that hit back) */
function answers(unseen, c, suit, attack, three) {
  if (power(c)) {
    const v = power(c);
    return unseen.filter(x => (power(x) >= v && (isJoker(x) || (!isJoker(c) && (suitOf(x) === suitOf(c) || rankOf(x) === rankOf(c))))) ||
      (three && !isJoker(c) && rankOf(c) === 2 && !isJoker(x) && rankOf(x) === 3 && suitOf(x) === suitOf(c))).length;
  }
  const need = isJoker(c) ? null : rankOf(c) === 7 ? suit : null;
  return unseen.filter(x => isJoker(x) || (need ? suitOf(x) === need : suitOf(x) === suitOf(c) || rankOf(x) === rankOf(c))).length;
}
const urgency = h => (h <= 1 ? 4 : h <= 2 ? 2.5 : h <= 4 ? 1.4 : 1);

function aiPlay(S, p, level, rng) {
  const hand = S.hands[p];
  const plays = legalCards(S, p);
  const nx = nextAlive(S, p);
  const nxN = nx >= 0 ? S.hands[nx].length : 99;
  const hard = level === "hard";
  const unseen = hard ? unseenOf(S, p) : null;
  const suitFor = c => (level === "easy" ? SUITS[Math.floor(rng() * 4)] : bestSuit(S, p, hand.filter(x => x !== c), level, rng, nx));
  const act = (c, suit) => (needsSuit(c) ? { card: c, suit: suit || suitFor(c) } : { card: c });
  /* Hard: expected cards the next player is forced to draw if I play c (weighted up when they are nearly out) */
  const squeeze = (c, suit) => {
    if (!hard || nx < 0) return 0;
    const v = power(c), A = S.attack + v;
    const pr = pNone(unseen.length, answers(unseen, c, suit, A, S.set.three), nxN);
    let g = pr * (v ? A : 1) * urgency(nxN);
    if (v && aliveList(S).length === 2) g -= (1 - pr) * A * .4;      // with two players a blocked attack comes back to me
    return g;
  };

  // Under attack: block or draw
  if (S.attack > 0) {
    if (!plays.length) return { draw: true };
    if (level === "easy") return rng() < .5 ? act(plays[Math.floor(rng() * plays.length)]) : { draw: true };
    const block = plays.find(c => !isJoker(c) && rankOf(c) === 3);
    const hits = plays.filter(c => power(c) > 0);
    if (!hits.length) return act(block);
    if (hard && block && hand.length > 1 && aliveList(S).length === 2 && S.attack >= 4) return act(block);   // with two players a passed attack comes back — cut it
    if (!hard && block && hand.length > 1 && rng() < .3) return act(block);
    if (hard && nxN <= 2) {                                    // someone nearly out gets the hardest card to answer
      hits.sort((a, b) => squeeze(b) - squeeze(a));
      return act(hits[0]);
    }
    hits.sort((a, b) => power(a) - power(b) || (isJoker(a) - isJoker(b)));   // pass it on with the weakest card, keep strong ones
    return act(hits[0]);
  }

  if (!plays.length) return { draw: true };
  if (level === "easy") return act(plays[Math.floor(rng() * plays.length)]);

  const k = suitCounts(hand);
  const prev = nextAlive(S, p, -S.dir);
  const prevN = prev >= 0 ? S.hands[prev].length : 99;
  let best = plays[0], bestSuit7 = null, bs = -Infinity;
  for (const c of plays) {
    const r = isJoker(c) ? 0 : rankOf(c), v = power(c), rest = hand.filter(x => x !== c);
    let s = isJoker(c) ? 0 : k[suitOf(c)];                 // shed the suit I hold most of first
    let suit7 = null;
    if (r === 7) {                                           // 7: pick the suit to name at the same time
      suit7 = suitFor(c);
      if (hard) {
        const kr = suitCounts(rest);
        let b = -Infinity;
        for (const su of SUITS) { const x = kr[su] * 1.2 + squeeze(c, su) * 2; if (x > b) { b = x; suit7 = su; } }
      }
    }
    // Hard: chance the next player holds an answer (for J it's the player after, for K I play again)
    if (hard && !v && r !== 13 && r !== 11 && !(r === 12 && aliveList(S).length > 2)) s += squeeze(c, suit7) * 2;
    if (v) {                                                 // keep attack cards and jokers for blocking
      s -= isJoker(c) ? 8 : v * 1.2;
      if (nxN <= 2) s += 10 + v;                             // attack when the next player is nearly out
      else if (nxN <= 4) s += 2;
      if (hand.length <= 3) s += 3;
    }
    if (r === 13) {                                          // K: worth it if I have a follow-up
      const follow = rest.filter(x => isJoker(x) || suitOf(x) === suitOf(c) || rankOf(x) === 13);
      s += follow.length ? 6 : -1;
    }
    if (r === 7 && hand.length > 2) s -= 3;                  // save 7s for when I'm stuck
    if (rest.length === 1 && isJoker(rest[0])) s += 6;       // keep a joker as the last card
    if (rest.length === 1 && isJoker(c)) s -= 8;
    if (hard) {
      if (!isJoker(c) && r !== 7 && S.miss[nx] && S.miss[nx].includes(suitOf(c))) s += 3;  // a suit the next player lacks
      if (r === 11) s += nxN <= 2 ? 8 : nxN <= 4 ? 2 : 0;    // J: skip someone nearly out
      if (r === 12) s += prevN > nxN + 1 ? 4 : prevN + 1 < nxN ? -3 : 0;   // Q: send the turn towards the bigger hand
      if (v && nxN <= 2 && power(c) >= 5) s += 3;
      // Don't hand over an easy suit: avoid the suit the next player just played (they likely hold more)
      if (!isJoker(c) && S.lastSuit[nx] === suitOf(c) && r !== 7) s -= 1.5;
    }
    s += rng() * .6;
    if (s > bs) { bs = s; best = c; bestSuit7 = suit7; }
  }
  return act(best, bestSuit7);
}

/* ---------- Rules ---------- */
const rules = tx(`<ul>
  <li>카드 52장에 <b>흑백 조커 · 컬러 조커</b>를 더한 54장. 처음에 7장(또는 5장)씩 나누고, 더미에서 한 장을 펼칩니다 (3·4·5·6·8·9·10 이 나올 때까지 넘깁니다). 첫 차례는 무작위.</li>
  <li>내 차례에는 맨 위 카드와 <b>무늬나 숫자가 같은 카드</b> 한 장을 냅니다. <b>조커</b>는 공격받는 중이 아니면 아무 때나 낼 수 있습니다.</li>
  <li>낼 카드가 없거나 내고 싶지 않으면 <b>1장 받고</b> 차례를 넘깁니다 (받은 카드는 그 차례에 낼 수 없음).</li>
</ul>
<h4>공격 카드</h4>
<ul>
  <li><b>2</b> → 2장 · <b>A</b> → 3장 · <b>♠A</b> → 5장 · <b>흑백 조커</b> → 5장 · <b>컬러 조커</b> → 7장. 내면 벌칙이 그만큼 쌓입니다.</li>
  <li>공격받은 사람은 <b>맨 위 공격 카드보다 값이 같거나 큰 공격 카드</b>로 받아칠 수 있습니다 — 단 맨 위 카드와 <b>무늬나 숫자가 같거나 조커</b>여야 합니다. 벌칙이 더해져 다음 사람에게 넘어갑니다.</li>
  <li>예: ♥2 위에 ♥A·♠2·조커 가능 / A 위에 2 는 불가 / 흑백 조커 위에는 컬러 조커만 / 컬러 조커는 못 막음.</li>
  <li><b>3으로 2 막기</b>(설정): 맨 위가 2일 때 <b>같은 무늬의 3</b>을 내면 쌓인 벌칙이 모두 사라지고 그 3 위에서 평소처럼 이어갑니다.</li>
  <li>막지 못하거나 막지 않으면 <b>쌓인 장수를 모두 받고</b> 차례가 끝납니다.</li>
  <li>흑백 조커 다음에는 <b>♠·♣</b>, 컬러 조커 다음에는 <b>♥·♦</b> 카드만 낼 수 있습니다 (숫자 상관없음, 조커는 가능).</li>
</ul>
<h4>특수 카드</h4>
<ul>
  <li><b>7</b> 무늬 바꾸기: 다음 사람이 낼 무늬를 정합니다 (그 무늬나 조커만 낼 수 있음).</li>
  <li><b>J</b> 다음 사람 건너뛰기 · <b>Q</b> 방향 바꾸기 (둘이 할 때는 J 와 같음) · <b>K</b> 한 장 더 내기 (낼 카드가 없으면 1장 받고 끝).</li>
</ul>
<h4>원카드 · 파산 · 끝</h4>
<ul>
  <li><b>원카드 외치기</b>(설정): 카드가 <b>한 장</b> 남으면 모두에게 「원카드!」 버튼이 4초 동안 뜹니다. 본인이 먼저 누르면 무사, <b>다른 사람이 먼저 누르면 잡혀서 1장</b>을 받습니다. 아무도 안 누르면 그냥 넘어갑니다.</li>
  <li>더미가 떨어지면 버린 카드(맨 위 한 장 빼고)를 섞어 새 더미를 만듭니다. 그래도 없으면 받을 수 있는 만큼만 받습니다.</li>
  <li><b>파산</b>(설정): 손패가 15장(또는 20장) 이상이 되면 탈락 — 남은 사람 중 꼴찌가 되고 카드는 더미 밑으로 갑니다.</li>
  <li><b>끝</b>(설정): 「1등이 나오면 끝」이면 누군가 카드를 다 내는 순간 끝나고, 나머지는 남은 카드가 적은 순 (같으면 같은 순위). 「꼴찌까지」면 한 명만 남을 때까지 계속합니다.</li>
  <li>마지막 카드가 특수 · 공격 카드여도 다 낸 것으로 칩니다 (공격은 다음 사람에게 넘어감).</li>
  <li>더미가 바닥난 채 <b>똑같은 판이 세 번 되풀이</b>되거나 판이 너무 길어지면(3000수), 그 자리에서 남은 카드 수로 순위를 정합니다.</li>
</ul>`, `<ul>
  <li>52 cards plus a <b>black joker and a colour joker</b> — 54 in all. Everyone is dealt 7 cards (or 5) and one card is turned up from the deck (cards are turned until a 3, 4, 5, 6, 8, 9 or 10 shows). The first player is random.</li>
  <li>On your turn, play one card that <b>matches the top card's suit or rank</b>. A <b>joker</b> can be played at any time unless you are under attack.</li>
  <li>If you can't or don't want to play, <b>draw 1 card</b> and your turn ends (you can't play the drawn card that turn).</li>
</ul>
<h4>Attack cards</h4>
<ul>
  <li><b>2</b> → 2 cards · <b>A</b> → 3 · <b>♠A</b> → 5 · <b>black joker</b> → 5 · <b>colour joker</b> → 7. Playing one adds that many cards to the penalty.</li>
  <li>The player under attack can hit back with an <b>attack card of equal or higher value than the top one</b> — but it must <b>match the top card's suit or rank, or be a joker</b>. The penalty grows and passes to the next player.</li>
  <li>Examples: on ♥2 you may play ♥A, ♠2 or a joker / a 2 can't answer an A / only the colour joker answers the black joker / nothing answers the colour joker.</li>
  <li><b>Block 2 with a 3</b> (setting): when the top card is a 2, playing <b>the 3 of the same suit</b> cancels the whole penalty and play continues normally on that 3.</li>
  <li>If you can't or won't answer, you <b>draw the whole penalty</b> and your turn ends.</li>
  <li>After the black joker only <b>♠ · ♣</b> cards may be played, after the colour joker only <b>♥ · ♦</b> (any rank; jokers are allowed).</li>
</ul>
<h4>Special cards</h4>
<ul>
  <li><b>7</b> changes the suit: you name the suit the next player must play (only that suit or a joker).</li>
  <li><b>J</b> skips the next player · <b>Q</b> reverses direction (with two players it acts like a J) · <b>K</b> lets you play another card (if you can't, draw 1 and your turn ends).</li>
</ul>
<h4>One card · bust · end</h4>
<ul>
  <li><b>"One card!" call</b> (setting): when someone is down to <b>one card</b>, everyone gets a "One card!" button for 4 seconds. If that player presses it first they are safe; <b>if someone else presses first they are caught and draw 1</b>. If nobody presses, play goes on.</li>
  <li>When the deck runs out, the discards (except the top card) are shuffled into a new deck. If there still aren't enough, you draw only what is left.</li>
  <li><b>Bust</b> (setting): reach 15 (or 20) cards in hand and you are out — you take last place among those still playing, and your cards go under the deck.</li>
  <li><b>End</b> (setting): with "First one out" the game ends the moment someone plays their last card, and everyone else is ranked by fewest cards left (ties share a rank). With "Until one left" play continues until only one player remains.</li>
  <li>A special or attack card as your last card still counts as going out (the attack passes to the next player).</li>
  <li>If, with the deck empty, <b>the same position repeats three times</b>, or the game runs too long (3000 moves), players are ranked by cards left on the spot.</li>
</ul>`);

const ON_OFF = [tx("켬", "On"), tx("끔", "Off")];

export default {
  id: "onecard",
  name,
  icon: "☝️",
  blurb: tx("무늬나 숫자를 맞춰 내고, 공격 카드로 벌칙을 떠넘겨요. 한 장 남으면 원카드!",
    "Match suit or rank and push penalties on with attack cards. Down to one? Call \"One card!\""),
  players: { min: 2, max: 6, default: 4 },
  settings: [
    { key: "hand", label: tx("시작 장수", "Starting hand"), values: [5, 7], labels: [tx("5장", "5 cards"), tx("7장", "7 cards")], default: 7 },
    { key: "three", label: tx("3으로 2 막기", "Block 2 with a 3"), values: [true, false], labels: ON_OFF, default: true,
      note: tx("2 위에 같은 무늬 3을 내면 공격이 사라집니다", "A 3 of the same suit on a 2 cancels the attack") },
    { key: "call", label: tx("원카드 외치기", "\"One card!\" call"), values: [true, false], labels: ON_OFF, default: true,
      note: tx("한 장 남았을 때 먼저 누르기 — 남이 먼저 누르면 1장", "With one card left, press first — if someone beats you, draw 1") },
    { key: "bust", label: tx("파산", "Bust limit"), values: [0, 15, 20], labels: [tx("끔", "Off"), tx("15장", "15 cards"), tx("20장", "20 cards")], default: 20,
      note: tx("손패가 이만큼 되면 탈락", "Holding this many cards knocks you out") },
    { key: "end", label: tx("끝나는 때", "Game ends"), values: ["first", "all"], labels: [tx("1등이 나오면", "First one out"), tx("꼴찌까지", "Until one left")], default: "first",
      note: tx("꼴찌까지는 한 명만 남을 때까지 — 사람이 많으면 꽤 오래 걸립니다", "\"Until one left\" plays on until one player remains — long with many players") }
  ],
  rules,
  stepLimit: 60000,
  spectate: true,                                         // view(S, -1) is the public table (no hands, no drawn cards)

  setup({ n, seed, settings = {} }) {
    const pickSet = (k, vals, d) => (vals.includes(settings[k]) ? settings[k] : d);
    const set = {
      hand: pickSet("hand", [5, 7], 7), three: pickSet("three", [true, false], true), call: pickSet("call", [true, false], true),
      bust: pickSet("bust", [0, 15, 20], 20), end: pickSet("end", ["first", "all"], "first")
    };
    const S = {
      n, rs: seed >>> 0, set, deck: [], discard: [], hands: [], st: [], place: [], note: [], miss: [], lastSuit: [],
      done: [], busted: [], recent: [], act: [], dir: 1, turn: 0, attack: 0, need: null, again: false, call: null, phase: "play", moves: 0, last: "", seen: {}
    };
    S.deck = shuffle(S, [...deck52(), "JB", "JC"]);
    for (let p = 0; p < n; p++) { S.hands.push([]); S.st.push("in"); S.place.push(0); S.note.push(""); S.miss.push([]); S.lastSuit.push(null); S.act.push(null); }
    for (let i = 0; i < set.hand; i++) for (let p = 0; p < n; p++) S.hands[p].push(S.deck.pop());
    do S.discard.push(S.deck.pop()); while (!isPlain(top(S)) && S.deck.length);
    S.recent.push({ p: -1, c: top(S) });                  // the first card (p: -1)
    S.turn = randInt(S, n);
    S.last = tx(`첫 카드 ${nk(top(S))} — {${S.turn}} 님부터`, `First card ${ne(top(S))} — {${S.turn}} starts`);
    return S;
  },

  pending(S) {
    if (S.phase !== "play") return [];
    if (S.call) return callWaiting(S).map(p => ({ p, kind: "call", time: 4 }));
    return [{ p: S.turn, kind: "play" }];
  },

  validate(S, p, a) {
    if (S.phase !== "play") return tx("게임이 끝났습니다", "The game is over");
    if (!a || typeof a !== "object") return tx("행동을 고르세요", "Choose an action");
    if (S.call) {
      if (!callWaiting(S).includes(p)) return tx("원카드 결과를 기다리는 중입니다", "Waiting for the \"One card!\" call to resolve");
      if (typeof a.call !== "boolean") return tx("「원카드!」 버튼을 누르세요", "Press the \"One card!\" button");
      return true;
    }
    if (p !== S.turn) return tx("지금은 내 차례가 아닙니다", "It's not your turn");
    if (a.draw === true) return true;
    if (typeof a.card !== "string") return tx("낼 카드를 고르세요", "Choose a card to play");
    if (!S.hands[p].includes(a.card)) return tx("내 손에 없는 카드입니다", "That card isn't in your hand");
    if (!canPlay(S, a.card)) {
      if (S.attack > 0) return tx(`공격 중입니다 — 막을 수 있는 카드만 낼 수 있습니다 (아니면 ${S.attack}장 받기)`,
        `You're under attack — only a card that answers it can be played (or draw ${S.attack})`);
      if (S.need) return tx(`지금은 ${NEED_LABEL[S.need]} 무늬(또는 조커)만 낼 수 있습니다`, `Only ${NEED_LABEL[S.need]} (or a joker) can be played now`);
      return tx("맨 위 카드와 무늬나 숫자가 같아야 합니다", "The card must match the top card's suit or rank");
    }
    if (needsSuit(a.card) && !SUITS.includes(a.suit)) return tx("바꿀 무늬를 고르세요", "Choose the new suit");
    return true;
  },

  apply(S, p, a) {
    const ev = [];
    if (S.call) doCall(S, p, a, ev);
    else {
      S.moves++;
      if (a.draw) doDraw(S, p, ev);
      else { doPlay(S, p, a, ev); if (!isJoker(a.card)) S.lastSuit[p] = suitOf(a.card); }
      if (S.phase === "play" && S.moves >= MAX_MOVES) endGame(S, ev, tx("너무 길어져서 남은 카드 수로 순위를 정합니다", "The game ran too long — ranked by cards left"));
      else if (S.phase === "play" && !S.call && repeated(S)) endGame(S, ev, tx("같은 판이 계속 되풀이되어 남은 카드 수로 순위를 정합니다", "The same position keeps repeating — ranked by cards left"));
    }
    const t = ev.filter(e => e.text).pop();
    if (t) S.last = t.text;
    return ev;
  },

  step() { return []; },
  delay() { return 600; },

  /* Drawn cards are seen only by the player who drew them (spectators, p = -1, never see them) */
  filterEvent(ev, p) {
    if (ev.type === "draw" && ev.p !== p) return { ...ev, cards: null };
    return ev;
  },

  timeout(S, p, kind) {
    if (kind === "call" || S.call) return { call: false };
    return { draw: true };
  },
  ai(S, p, { level = "normal", rng = Math.random } = {}) {
    if (S.call) {
      const P = (p === S.call.p ? CALL_P.owner : CALL_P.other)[level] ?? .5;
      return { call: rng() < P };
    }
    return aiPlay(S, p, level, rng);
  },
  thinkTime(S, p, kind) {
    if (kind === "call" && S.call) return p === S.call.p ? 500 + Math.random() * 1500 : 900 + Math.random() * 2600;
    if (S.attack > 0) return 800 + Math.random() * 700;
    return 650 + Math.random() * 650;
  },

  view(S, p) {
    const me = p >= 0 && p < S.n ? p : -1;
    const myTurn = S.phase === "play" && !S.call && S.turn === me;
    const order = c => (isJoker(c) ? 400 + (c === "JC" ? 1 : 0) : SUITS.indexOf(suitOf(c)) * 100 + (rankOf(c) === 1 ? 14 : rankOf(c)));
    const hand = me >= 0 ? S.hands[me].slice().sort((a, b) => order(a) - order(b)) : [];
    let status = "";
    if (S.phase === "over") status = tx("게임 끝", "Game over");
    else if (S.call) status = S.call.p === me ? tx("한 장 남았습니다 — 원카드!", "One card left — call it!")
      : me < 0 ? tx(`{${S.call.p}} 님이 한 장 — 원카드!`, `{${S.call.p}} is down to one card — "One card!"`)
      : callWaiting(S).includes(me) ? tx("원카드 — 먼저 누르면 잡습니다!", "One card — press first to catch them!") : tx("원카드 — 결과를 기다리는 중", "One card — waiting for the result");
    else if (myTurn) status = S.attack > 0 ? tx(`공격 +${S.attack} — 막거나 받으세요`, `Attack +${S.attack} — answer or draw`)
      : S.again ? tx("K — 한 장 더 내세요", "K — play another card") : tx("내 차례 — 낼 카드를 고르세요", "Your turn — play a card");
    else if (me >= 0 && S.st[me] === "done") status = tx("카드를 다 냈습니다 — 구경 중", "You're out of cards — watching");
    else if (me >= 0 && S.st[me] === "bust") status = tx("파산 — 구경 중", "Bust — watching");
    return {
      phase: S.phase, turn: S.turn, dir: S.dir, top: top(S), under: S.discard.slice(-4, -1),
      need: S.need, attack: S.attack, again: S.again, deck: S.deck.length, pile: S.discard.length,
      sizes: S.hands.map(h => h.length), st: S.st.slice(), place: S.place.slice(), hand,
      legal: myTurn ? legalCards(S, me) : [],
      call: S.call ? { p: S.call.p, waiting: callWaiting(S).includes(me) } : null,
      recent: S.recent.map(r => ({ ...r })),          // recently played cards (oldest first; cleared when reshuffled)
      act: S.act.map(a => (a ? { ...a } : null)),      // each player's last action: {c} played · {d, pen, catch?} drew
      last: S.last, set: { ...S.set }, status
    };
  },

  over(S) { return S.phase === "over"; },
  results(S) {
    return S.place.map((rank, p) => ({ p, rank, note: S.note[p] }));
  },

  /* ---------- For tests ---------- */
  randomAction(S, p, rng, kind) {
    if (S.call) return { call: rng() < .3 };
    const plays = legalCards(S, p);
    if (plays.length && rng() < .85) {
      const c = plays[Math.floor(rng() * plays.length)];
      return needsSuit(c) ? { card: c, suit: SUITS[Math.floor(rng() * 4)] } : { card: c };
    }
    return { draw: true };
  },
  check(S) {
    const all = [...S.deck, ...S.discard, ...S.hands.flat()];
    if (all.length !== TOTAL) return `card count is off: ${all.length} (deck ${S.deck.length} · discard ${S.discard.length})`;
    if (new Set(all).size !== TOTAL) return "a card appears twice";
    if (!S.discard.length) return "discard pile is empty";
    if (!Number.isInteger(S.attack) || S.attack < 0) return `bad penalty value ${S.attack}`;
    const t = top(S);
    if (S.attack > 0 && !power(t)) return `under attack but the top card is not an attack card: ${t}`;
    if (isJoker(t) ? S.need !== (t === "JB" ? "B" : "R") : rankOf(t) === 7 ? !SUITS.includes(S.need) : S.need !== null) return `bad suit requirement ${t} ${S.need}`;
    for (let q = 0; q < S.n; q++) if (S.st[q] !== "in" && S.hands[q].length) return `seat ${q} is finished but still holds cards`;
    if (S.phase === "play") {
      if (!alive(S, S.turn)) return `turn (${S.turn}) belongs to a player who is out`;
      if (aliveList(S).length < 2) return "fewer than two players left but still playing";
      if (S.again && S.attack) return "attack during a K extra turn";
      if (S.call && (S.hands[S.call.p].length !== 1 || !alive(S, S.call.p))) return "call-window owner does not hold exactly one card";
      if (S.set.end === "first" && S.done.length) return "someone finished first but the game didn't end";
    } else {
      const ranks = S.place.filter(r => r < 1 || r > S.n);
      if (ranks.length) return `bad ranks ${S.place}`;
    }
    if (S.set.bust) for (let q = 0; q < S.n; q++) if (alive(S, q) && S.hands[q].length >= S.set.bust) return `seat ${q} should have gone bust`;
    return true;
  },
  leak(S, p, v) {
    const hidden = new Set(S.deck);
    S.hands.forEach((h, q) => { if (q !== p) h.forEach(c => hidden.add(c)); });
    const bad = [];
    (function walk(x) {
      if (typeof x === "string") { if (hidden.has(x)) bad.push(x); }
      else if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") Object.values(x).forEach(walk);
    })(v);
    if (bad.length) return `hidden cards exposed: ${bad.slice(0, 5).join(",")}`;
    if (p < 0) {                                          // spectators: no hand, nothing to play, no private call state
      if (v.hand.length || v.legal.length) return "spectator view contains a hand";
      if (v.call && v.call.waiting) return "spectator view asks for a call";
      return true;
    }
    if (v.hand.length !== S.hands[p].length) return "my hand size differs";
    return true;
  }
};
