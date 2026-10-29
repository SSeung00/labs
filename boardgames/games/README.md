# Writing a game module

One game = three files in `games/<id>/`. Reference implementation: `games/oldmaid/` (Old Maid).

| File | Job | Runs on |
|---|---|---|
| `engine.js` | rules, AI, per-player views. Pure JS without DOM (ES module) | host browser, Node tests |
| `ui.js` | draws the screen. Exports a single `mount(root, ctx)` | every player's browser |
| `style.css` | styles for this game only. Prefix class names with the game (`.pk-…`). Game CSS stays loaded after switching games, so never restyle shared classes such as `.modal` globally — add your own prefixed class to scope rules | browser |

Add one import line to `games/registry.js` to list the game.

Look and size: players pick a table theme, a card back and a screen size (core/settings.js). Use the theme variables —
`.felt` (or `--felt1..3`) for the table, `--bg`, `--bg2`, `--panel`, `--panel2` for dark surfaces, `--bk` / `--bk-edge` /
`--bk-in` for card backs — instead of fixed colours. The whole page may be drawn with CSS `zoom`: measure with
`clientWidth` / `offsetHeight` (layout pixels), not `getBoundingClientRect()`, and divide viewport units by `var(--zoom)`.
Avatars: `ctx.avatarHTML(name, seat)` already shows each person's chosen emoji and colour (and AI animals).

## Language (Korean / English)

Every user-facing string exists in both languages; players switch with the 🌐 button (see `core/i18n.js`).
- **ui.js**: `L("한국어", "English")` (also `ctx.L`), evaluated at render time. After a language switch the shell remounts the
  UI and calls `update` again, so everything built from `L()` follows automatically.
- **engine.js**: the engine runs on the host, whose language may differ from each viewer's. Every text it produces —
  event `text`, `view.status`, `validate` errors, `results` notes, `name`, `blurb`, `rules`, setting `label`/`labels`/`note` —
  is a bilingual object `tx("한국어", "English")` (import from `core/i18n.js`). The shell and UIs resolve it with `loc(x)`
  (also `ctx.loc`); `ctx.nameText(x)` resolves and fills in player names.
- Plain strings are still accepted (language-neutral things like numbers or card symbols).
- Code comments are English.

## How it runs

The host's browser runs the game with `engine.js` and sends each person only the result of `view(S, p)` (P2P, no server).
The host's runner (`Runner` in `core/host.js`) does:

```
while (!over(S)):
  pend = pending(S)                     # who must decide now: [{p, kind}]
  if pend is empty: wait delay(S) ms, then step(S)      # next round, automatic progress
  else: ask humans on screen (timeout(S,p,kind) when time runs out), AI uses ai(S,p,{level,rng})
        the first action to arrive is validated → applied → everyone gets their view plus the events
```
Several players can be pending at once (first come, first served — simultaneous choices, "anyone can press" buttons, etc.).

## engine.js — the default export

```js
export default {
  id: "poker",                     // same as the folder name
  name: tx("포커", "Texas Hold'em"), // shown name (never a commercial trademark)
  icon: "♠️",                       // one emoji
  blurb: tx("한 줄 소개", "One-line intro"),
  players: { min: 2, max: 8, default: 4 },
  settings: [                       // per-game settings the host picks in the lobby ([] if none)
    { key: "chips", label: tx("시작 칩", "Starting chips"), values: [500, 1000], labels: ["500", "1000"], default: 1000,
      note: tx("설명", "Explanation") }
  ],
  rules: tx(`<ul><li>…</li></ul>`, `<ul><li>…</li></ul>`),   // rules as HTML; state house rules clearly

  setup({ n, seed, settings }) → S  // S is a plain JSON-serializable object; randomness lives in S.rs (core/rng.js)
  pending(S) → [{ p, kind, time?, secret? }]
       // kind: what the player decides (e.g. "bet", "play", "discard", "choose")
       // time: a separate time limit (seconds) for this decision; 0 = unlimited
       // secret: true hides even the fact that this player is deciding
  validate(S, p, a) → true | tx(...)                 // every human action goes through here (anti-cheat)
  apply(S, p, a) → [events]                          // only validated actions arrive here; mutates S
  step(S) → [events]                                  // automatic progress while pending is empty (round end → next round)
  delay(S) → ms                                        // wait before step (time to show round results, etc.)
  timeout(S, p, kind) → action                         // a sensible action when time runs out (must always validate)
  ai(S, p, { level, rng }) → action                    // level: "easy" | "normal" | "hard"; rng() ∈ [0,1); never mutate S
  thinkTime(S, p, kind) → ms                           // (optional) how long the AI pretends to think; default 700–1400ms
  view(S, p) → object                                  // only what p may see; never other players' hidden cards
  filterEvent(ev, p, S) → ev | redacted copy | null    // (optional) hide secret info inside events
  over(S) → bool
  results(S) → [{ p, rank, score?, note? }]            // every seat; ranks start at 1 (ties share a rank)

  // for tests (tests/playout.mjs)
  randomAction(S, p, rng, kind) → any legal action     // random testing, to reach paths the AI never takes
  check(S) → true | "problem"                          // state invariants (card / chip conservation, …)
  leak(S, p, view) → true | "problem"                  // did hidden info get into the view?
  stepLimit: 50000                                      // (optional) max steps per game (default 20000)
}
```

### Events
Arrays of objects returned by `apply` / `step`. The UI uses them for animation, sound and messages.
- The game defines `type`. A `text` (bilingual) goes into the one-line ticker and the log window.
- **The engine doesn't know player names.** Write `{3}` and it becomes seat 3's name, in both languages:
  `` tx(`{${p}} 님이 콜했습니다`, `{${p}} calls`) ``
- `type: "notice"` or `toast: true` also shows a short toast.
- Events that carry hidden info (a drawn card, …) are redacted with `filterEvent`.

### view conventions
- `status`: (optional) short bilingual line for the status bar at the top (`{3}` placeholders allowed). Default: "X's turn".
- `quietAsk: true` suppresses the turn sound / vibration (for very frequent decisions).
- Anything else is up to the game, but it must be JSON and contain no hidden info.

### Randomness
`import { rand, randInt, shuffle } from "../../core/rng.js"` — all take `S` and advance `S.rs`. Same seed, same game.
AI must not change `S`, so it only uses the `rng()` it is given (`shuffleWith(rng, arr)` and `pick(rng, arr)` exist too).

### Playing cards
`core/cards.js`: codes `"S1"` (♠A) … `"C13"` (♣K), jokers `"JB"` (black-and-white) · `"JC"` (colour). `deck52()`, `suitOf`, `rankOf`,
`isJoker`, `cardName` (UI language), `cardNameTx` (bilingual, for engines), `cardHTML(c, extra)` (screen).
`cardHTML` makes a `.pc` element. Sizes: default 52×74, `sm` 34×48, `lg` 64×92 (or set `--cw/--ch`). State classes `sel`, `dim`, `can`.

## ui.js — `export function mount(root, ctx) → { update(msg), destroy(), ticker?: false, landscape?: true }`

`root` is the whole area below the header. Portrait phones first: 360–430px wide, 600–900px high.
`update(msg)` is called whenever the state changes:

```js
msg = {
  v,            // view(S, me)
  ev,           // events that just happened (after filterEvent)
  me,           // my seat
  players,      // [{name, kind: "human"|"ai"|"away", host}] — by seat; AI names already in the viewer's language
  pending,      // [{p, kind, id, ms, total}] who we're waiting for (ms: time left, total: full time limit)
  settings,     // {level, timer, opts: per-game settings}
  over, results
}
```

What `ctx` provides:
- `ctx.send(action)` — send my action (returns false when it's not my turn). Illegal actions are rejected by the host with a toast.
- `ctx.myAsk(kind?)` — `{p, kind, id, ms}` if I must decide now, else null.
- `ctx.L(ko, en)`, `ctx.loc(x)`, `ctx.lang`, `ctx.nameText(x)` (resolves `{3}` names, accepts bilingual objects)
- `ctx.el(tag, cls, html)`, `ctx.esc(text)`, `ctx.avatarHTML(name, p, "sm"|"lg")`, `ctx.avatarColor(p)`
- `ctx.sound.{deal, place, flip, pass, chip, turn, tick, good, bad, win, lose}()`, `ctx.buzz(ms)`, `ctx.toast(text)`
- `ctx.modal((box, close) => …)`, `ctx.choose(title, text, [{value, label, note}])` → Promise, `ctx.head(box, eyebrow, title, text)`, `ctx.buttonRow(box, [{label, primary, on}])`
- `ctx.spectator` (watching, `me === -1`), `ctx.replay` (a replay is on screen), `ctx.fly(from, to, opt)` (flying cards, see below)

Shared CSS in `core/style.css`: `.btn` `.btn.primary` `.btn.small`, `.felt` (green felt), `.seatrow` + `.seatchip` (name chips;
`.turn` `.me` `.out`, inside `.nm` `.sub` `.ai` `.away`), `.dock` (bottom controls, includes the iPhone home-bar inset) + `.actions` + `.hint`,
`.pc` (playing cards), `.av` (avatar), colour variables `--gold --gold2 --red --blue --green --accent --muted --line`.

Screen basics
- One-handed portrait use. Tap targets at least 40px. No horizontal page scroll (shrink, or scroll only that area).
- Always show who is doing what and what I can do (`.hint`).
- Dim cards that can't be played; mark the ones that can. Add a confirmation step for easy-to-mistap big decisions (bets, …).
- On other players' turns, use short animations and sounds from events so the screen never looks frozen.
- No external images, fonts or libraries. Draw with CSS, SVG and emoji.
- `update` must cope with being called several times with the same msg (re-rendering everything is fine).

## Spectators, TV screens and replays

Three things show a game to someone who isn't playing a seat. All use the **public view** `view(S, -1)`:
- **Watching screens** — a TV or tablet joins with "📺 Open as a watching screen" and shows the shared table.
- **People waiting** for the next game watch the current one.
- **Solo watch mode** — "Watch the AI" in the solo lobby (handy for testing: `BG.room.setSetting("watch", true); BG.room.start()`).

Engine (`engine.js`):
- Set `spectate: true` in the default export once `view(S, -1)` works. Without it, spectators get a plain waiting screen.
- `view(S, -1)` must contain only public information — no hand, no secret role, no private choice of any seat.
- `filterEvent(ev, -1, S)` must redact private info the same way it does for another seat.
- `leak(S, -1, v)` must check the public view (tests/playout.mjs calls it for every game with `spectate`).

UI (`ui.js`):
- `msg.me === -1` and `ctx.spectator === true` for spectators. Nothing to act on, so no hand area, no buttons, no dialogs.
  Show every seat's public info instead, and let the table use the freed space.
- The spectator layout also works on large landscape screens (a TV at 1920×1080 is drawn at about 1350×760 because of the screen-size zoom).

Replays (`core/replay.js`):
- The host records `log` = every `step()` (0) and `apply()` (`[p, action]`) plus the seed. After the game anyone can replay it
  from any seat's view (or `-1`). The engine must therefore be **deterministic**: all randomness in `S.rs` (setup, apply, step).
  `tests/playout.mjs` replays every test game and compares the final state.
- In a replay `msg.replay === true`, `msg.pending` is empty and `ctx.myAsk()` returns null — never open dialogs or show "your turn".
  The shell may jump backwards; it then mounts the UI again and calls `update` with `ev: []`.

## Landscape

Every game screen also works in landscape: `@media (orientation: landscape) and (min-aspect-ratio: 4/3)`.
That covers phones held sideways (the shell's header becomes one line; the stage is about 844×350, small phones 740×330),
tablets, computers and TVs. Typical arrangement: other players in a column or row at the side, the table in the middle,
my hand and buttons at the bottom or on the right. JS sizing (measured heights) must handle the short, wide stage too.
Return `landscape: true` from `mount` — otherwise phones held sideways get a "turn your phone upright" card instead.

## Flying cards

`ctx.fly(from, to, opt)` animates a copy of `to` from `from` (an element, or a `DOMRect` saved before re-rendering) to `to`.
Call it right after `update` drew the new state, for what just happened:
- a card someone played: from their seat chip to the card on the table;
- my own play: from the rect of the card I tapped (save `getBoundingClientRect()` before sending) to the table;
- a card drawn: from the pile to the hand; chips: from a seat to the pot …
Use the events (`msg.ev`) to know what moved; skip it when `ev` is empty (re-render, replay jumps). Keep it short (≈ 400 ms).
`fly` does nothing with reduced motion or in a background tab.
The flying copy is attached to `<body>`, so rules scoped to your game's root (`.om .pc …`) don't reach it: put the classes and
sizes it needs (`--cw`, a game class on the card itself) on the element, or pass `opt.html`.

## Card designs

Players choose face designs in the settings. Playing cards from `core/cards.js` (`cardHTML`) get `d-<design>`
(classic, jumbo, four, vintage, neon, minimal); Dalmuti cards `dd-<design>` (games/dalmuti/cards.js); hwatu `hd-<design>`
(games/gostop/cards.js). Don't hard-code a design: size cards with `--cw` / `--ch` and leave colours, fonts and backgrounds
to the design classes. The shell redraws the game (mount + update) when the design changes.

## UX principles (from real players' complaints)

> "Too much empty space", "I have to keep calculating things in my head", "It's hard to see my and my opponents' info at a glance"

1. **No dead space.** The table (felt) must never be bigger than its content; spare height makes cards and info bigger. Fit 360×640
   up to 430×932 without scrolling, and grow on bigger screens (measure the available height, or use `clamp()` / flex).
2. **The screen does the math.** Precompute everything a player would otherwise count: playable cards, my current hand rank,
   points still needed to win, cards left to complete a set, missing resources per card, what I can buy now,
   call amount and pot odds, danger warnings (bak penalties, …).
3. **At a glance.** Each opponent's key public info (cards left, score, status, last action) is visible without tapping.
   A one-line summary of my own state is always visible. Details (captured cards, …) open on tap.
4. **What just happened** shows as a badge next to that player plus a short animation. If the game shows its own history,
   return `ticker: false` from `mount` to hide the one-line ticker and use its height.
5. With many players (6–10) the name chips must not eat vertical space: one horizontally scrolling row or a dense grid.

## Tests

```bash
node tests/playout.mjs <id> 1000      # engine: 1000 complete games with AI and random actions
node --check games/<id>/ui.js         # UI module syntax
```
`playout` checks validate, check and leak at every decision. Every game must pass.
