/* Old Maid — 53 cards (52 + one joker). Pairs of the same rank are discarded; each turn you draw one card from the next player's hand.
   Players are ranked in the order they run out of cards; whoever is left holding the joker loses (the Old Maid). */
import { shuffle } from "../../core/rng.js";
import { deck52, rankOf, isJoker, rankLabel } from "../../core/cards.js";
import { tx } from "../../core/i18n.js";

const name = tx("도둑잡기", "Old Maid");
const ord = n => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");

function nextWithCards(S, p) {
  for (let k = 1; k <= S.n; k++) { const q = (p + k) % S.n; if (S.hands[q].length) return q; }
  return -1;
}
/* Discard every pair from a hand → list of discarded ranks */
function dropPairs(hand) {
  const by = new Map();
  hand.forEach((c, i) => { if (!isJoker(c)) { const r = rankOf(c); (by.get(r) || by.set(r, []).get(r)).push(i); } });
  const drop = new Set(), ranks = [];
  for (const [r, idx] of by) for (let k = 0; k + 1 < idx.length; k += 2) { drop.add(idx[k]); drop.add(idx[k + 1]); ranks.push(r); }
  const kept = hand.filter((_, i) => !drop.has(i));
  hand.length = 0; hand.push(...kept);
  return ranks;
}
function settle(S, ev) {
  for (let p = 0; p < S.n; p++) if (!S.hands[p].length && !S.out.includes(p)) {
    S.out.push(p);
    const k = S.out.length;
    ev.push({ type: "out", p, place: k, text: tx(`{${p}} 님이 패를 다 털었습니다 (${k}등)`, `{${p}} is out of cards (${ord(k)})`) });
  }
  const left = S.hands.map((h, p) => h.length ? p : -1).filter(p => p >= 0);
  if (left.length <= 1) {
    S.phase = "over";
    S.loser = left.length ? left[0] : null;
    if (S.loser !== null) S.out.push(S.loser);
    ev.push({ type: "over", loser: S.loser, text: S.loser !== null
      ? tx(`{${S.loser}} 님이 도둑! 조커를 끝까지 들고 있었습니다`, `{${S.loser}} is the Old Maid! They held the joker to the end`)
      : tx("게임 끝", "Game over") });
    return;
  }
}

export default {
  id: "oldmaid",
  name,
  icon: "🃏",
  blurb: tx("짝을 버리고 옆 사람 패를 한 장씩 뽑아요. 마지막까지 조커를 든 사람이 도둑!",
    "Discard pairs and draw one card at a time from your neighbour. Whoever ends up with the joker is the Old Maid!"),
  players: { min: 2, max: 8, default: 4 },
  settings: [],
  spectate: true,          // view(S, -1) is the public table: card counts, the current draw, discarded pairs
  rules: tx(`<ul>
    <li>카드 52장에 <b>조커 1장</b>을 섞어 모두 나눠 줍니다.</li>
    <li>손에 같은 숫자 두 장이 있으면 짝으로 버립니다 (자동).</li>
    <li>내 차례에는 <b>다음 사람</b>의 패에서 안 보이는 카드 한 장을 뽑습니다. 짝이 맞으면 버립니다.</li>
    <li>패를 먼저 다 없앤 순서대로 순위가 정해지고, <b>마지막까지 조커를 든 사람</b>이 집니다.</li>
  </ul>`, `<ul>
    <li>52 cards plus <b>one joker</b> are shuffled and all dealt out.</li>
    <li>Any two cards of the same rank in your hand are discarded as a pair (automatically).</li>
    <li>On your turn, draw one unseen card from the <b>next player's</b> hand. If it makes a pair, the pair is discarded.</li>
    <li>Players are ranked in the order they run out of cards; <b>whoever is left holding the joker</b> loses.</li>
  </ul>`),

  setup({ n, seed }) {
    const S = { n, rs: seed >>> 0, hands: [], out: [], phase: "play", turn: 0, loser: null, discards: 0, gone: Array(14).fill(0), last: null, round: 0 };
    const deck = shuffle(S, [...deck52(), "JC"]);
    for (let p = 0; p < n; p++) S.hands.push([]);
    deck.forEach((c, i) => S.hands[i % n].push(c));
    for (const h of S.hands) for (const r of dropPairs(h)) { S.discards += 2; S.gone[r] += 2; }
    S.turn = Math.floor(S.rs % n);
    const ev = [];
    settle(S, ev);
    if (S.phase === "play" && !S.hands[S.turn].length) S.turn = nextWithCards(S, S.turn);
    for (const h of S.hands) shuffle(S, h);
    return S;
  },

  pending(S) {
    if (S.phase !== "play") return [];
    return [{ p: S.turn, kind: "draw" }];
  },

  validate(S, p, a) {
    if (S.phase !== "play" || p !== S.turn) return tx("지금은 내 차례가 아닙니다", "It's not your turn");
    const v = nextWithCards(S, p);
    if (!a || !Number.isInteger(a.i) || a.i < 0 || a.i >= S.hands[v].length) return tx("뽑을 카드를 고르세요", "Choose a card to draw");
    return true;
  },

  apply(S, p, a) {
    const v = nextWithCards(S, p);
    const [card] = S.hands[v].splice(a.i, 1);
    const hand = S.hands[p];
    hand.push(card);
    const ranks = dropPairs(hand);
    S.discards += ranks.length * 2;
    for (const r of ranks) S.gone[r] += 2;
    S.last = { from: v, to: p, paired: ranks.length ? ranks[0] : null };
    const pr = ranks.length ? rankLabel(ranks[0]) : "";
    const ev = [{ type: "draw", from: v, to: p, i: a.i, card, paired: ranks.length ? ranks[0] : null, joker: isJoker(card),
      text: tx(`{${p}} 님이 {${v}} 님의 카드를 뽑았습니다` + (pr ? ` — 짝! (${pr})` : ""),
        `{${p}} draws a card from {${v}}` + (pr ? ` — a pair! (${pr})` : "")) }];
    settle(S, ev);
    if (S.phase === "play") {
      S.turn = nextWithCards(S, p);
      shuffle(S, S.hands[nextWithCards(S, S.turn)]);   // the hand about to be drawn from is always freshly shuffled
    }
    return ev;
  },

  /* Only the drawer and the player drawn from see the drawn card (ranks of discarded pairs are public).
     Spectators (p = -1) are neither, so they get the redacted copy too. */
  filterEvent(ev, p) {
    if (ev.type === "draw" && p !== ev.from && p !== ev.to) return { ...ev, card: null, joker: null };
    return ev;
  },

  timeout(S, p) { return { i: 0 }; },
  ai(S, p, { rng }) {
    const v = nextWithCards(S, p);
    return { i: Math.floor(rng() * S.hands[v].length) };
  },
  thinkTime() { return 600 + Math.random() * 600; },

  /* p = -1 is the public view (watching screens, replays from the spectator seat): everything except the hands */
  view(S, p) {
    const victim = S.phase === "play" ? nextWithCards(S, S.turn) : -1;
    const mine = p >= 0 ? S.hands[p].slice().sort((a, b) => (isJoker(a) ? 99 : rankOf(a)) - (isJoker(b) ? 99 : rankOf(b)) || a.localeCompare(b)) : [];
    return {
      phase: S.phase, turn: S.turn, victim, sizes: S.hands.map(h => h.length), out: S.out.slice(), loser: S.loser,
      discards: S.discards, gone: S.gone.slice(), last: S.last, hand: mine,   // gone[rank]: cards of that rank discarded in pairs (public)
      // No "your turn" here: views are replayed later, when nobody can act. The shell shows "Your turn" from the pending list.
      status: S.phase === "over" ? tx("게임 끝", "Game over") : ""
    };
  },

  over(S) { return S.phase === "over"; },
  results(S) {
    return S.out.map((p, i) => ({ p, rank: i + 1,
      note: p === S.loser ? tx("도둑 (조커)", "Old Maid (joker)") : tx(`${i + 1}번째로 탈출`, `Went out ${ord(i + 1)}`) }));
  },

  /* For tests: any legal action */
  randomAction(S, p, rng) { return this.ai(S, p, { rng }); },
  leak(S, p, v) {
    const mine = (p >= 0 ? S.hands[p] : []).slice().sort().join();   // spectators (p = -1) hold nothing
    if (v.hand.slice().sort().join() !== mine) return "view.hand differs from my hand";
    const others = new Set(S.hands.flatMap((h, q) => q === p ? [] : h));
    if (JSON.stringify(v).match(/"[SHDC]\d{1,2}"|"JC"/g)?.some(c => others.has(c.slice(1, -1)))) return "another player's card is in the view";
    return true;
  },
  check(S) {
    const total = S.hands.reduce((a, h) => a + h.length, 0) + S.discards;
    if (total !== 53) return `card count is off: ${total}`;
    if (S.gone.reduce((a, b) => a + b, 0) !== S.discards) return "discarded-pair record doesn't add up";
    for (const h of S.hands) {
      const seen = new Set();
      for (const c of h) if (!isJoker(c)) { const r = rankOf(c); if (seen.has(r)) return "a pair is left in a hand"; seen.add(r); }
    }
    return true;
  }
};
