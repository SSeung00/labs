# Game Room (보드게임 놀이방)

Board games to play with friends on your phone. A static site on GitHub Pages: there is no server — the host's browser runs
the game and the other players connect to it directly (PeerJS / WebRTC). The interface is Korean / English with a 🌐 toggle.

| Game | Folder | Players | Notes |
|---|---|---|---|
| Dalmuti (달무티) | `games/dalmuti` | 4–8 | titles, tax, revolution, several rounds; port of the original Dalmuti engine; optional "pass = out of the trick" rule |
| Old Maid (도둑잡기) | `games/oldmaid` | 2–8 | reference implementation of the module contract |
| One Card (원카드) | `games/onecard` | 2–6 | attacks, suit change on 7, "one card!" call, bust limit |
| Texas Hold'em (포커) | `games/poker` | 2–8 | no-limit, side pots, rising blinds |
| Go-Stop (고스톱) | `games/gostop` | 2–3 | 2 players = Matgo, 3 = Go-Stop; ppeok, jjok, ttadak, bombs, shaking, bak penalties |
| Gem Merchant (보석 상인) | `games/gems` | 2–4 | gem-collecting engine builder (our own card set) |
| Gold Mine (금광 탐험) | `games/mine` | 3–10 | hidden saboteurs, tunnel building |
| Yacht Dice (요트 다이스) | `games/yacht` | 1–8 | 12 categories, upper bonus; solo score attack with a personal best |
| Liar Game (라이어 게임) | `games/liar` | 3–10 | text hints, secret votes, the liar's guess; "fool liar" variant; 160 bilingual words |
| Liar's Dice (거짓말 주사위) | `games/liardice` | 2–6 | Perudo-style bidding, ones wild, optional "spot on" |
| Secret Numbers (숫자 암호) | `games/codebreak` | 2–4 | number-tile deduction with a "possible numbers" helper; optional jokers |

## Playing online

- **Create room** → send the invite link (or the 5-letter code). Up to 10 people can be in a room; each game has its own limit.
- **Players**: "Auto" seats only the people in the room, adding AI just up to the game's minimum. Pick a number to have AI
  fill the remaining seats (for example 3 people + 6 → 3 AI).
- **Leaving and coming back**: the room lasts until the host presses "Close room".
  - A guest who drops out keeps the seat for 20 s, then AI plays for them. Opening the link again (same tab, a new tab or
    another browser with the same name) takes the seat back.
  - If the host's page closes or reloads, everything is saved on the host's device. Opening the link again (or "Reopen room"
    on the home screen) resumes the room and the game where it stopped; guests reconnect automatically for up to 10 minutes.
  - People who arrive during a game watch it and join from the next game.
  - **Host handover**: one guest (the heir) keeps a copy of the room. If the host hasn't come back after about 20 s, the heir
    reopens the room under the same code and everyone reconnects to them; the old host can rejoin as a guest.
  - **If someone drops out** (lobby setting): AI plays for them after 20 s, or the game waits at their turn until they come
    back — the host can press "Let AI play" at any time.
- **Inviting**: the lobby shows a QR code (tap it for a big one) next to the code and the link; "Invite friends" in the game
  menu (☰) shows the same card, so late arrivals can scan it too. Shared links show a preview card (`og.png`).
- **Profile**: tap the avatar next to the name field (or "Edit" on your card in the lobby) to change your name and pick an
  emoji face, a colour and a short message. AI seats show their animal.
- **Reactions**: 😀 sends an emoji or a short phrase that floats up on everyone's screen.
- **Watching screen (TV / tablet)**: enter the code and choose "📺 Open as a watching screen". It shows the shared table with
  public information only; everyone's own cards stay on their phones. Solo play can also just watch the AI play.
- **Replays**: every finished game can be replayed from the results ("🎬 Replay") or the home screen ("🎬 Replays"), from any
  seat's point of view. The host records the seed and the moves; the engines are deterministic, so the replay rebuilds every position.
- **Tonight's scoreboard**: the room adds up points (1st 3, 2nd 2, 3rd 1) until the host closes it; shown in the lobby and
  on the results after the second game. "My record" on the home screen keeps games and wins on this device.

## Settings (⚙️)

Per device: table theme (green felt, night sea, wine bar, wooden table, purple lounge, charcoal), card face designs
(playing cards: classic, big index, four colours, vintage, neon, minimal · Dalmuti: classic, royal, big number, flat colour,
parchment · hwatu: classic, traditional, night, big month, flat colour), card back, button colour, screen size (Auto enlarges
everything on tablets, unfolded phones and computers), reduced motion, sound and vibration, language, install as an app,
full screen. Game screens work in portrait and landscape (phones held sideways, tablets, computers, TVs).

After the first visit the site also works offline for solo play (`sw.js`, network first so online visits always get the
newest files).

## Run locally

```bash
python -m http.server 8770
```
Open <http://localhost:8770>. "Solo (vs AI)" works offline; "Create room" needs the internet (public PeerJS signalling server).

## Structure

- `core/app.js` — shell (home, lobby, game screen, results); `core/host.js` — the host's room and game runner;
  `core/net.js` — connections, auto-reconnect, screen wake lock; `core/i18n.js` — Korean / English texts.
- `core/settings.js` — themes, card designs and backs, screen size, profile editor; `core/social.js` — QR invites,
  reactions, scoreboard, confetti, my record, app install; `core/replay.js` — replays; `sw.js` — offline copy.
- `games/<id>/engine.js` — rules, AI and per-player views; `ui.js` — screen; `style.css`.
- Module contract and UX principles: [games/README.md](games/README.md). Project conventions: [CLAUDE.md](CLAUDE.md).

## Tests

```bash
node tests/playout.mjs            # every game: hundreds of full games with AI and random moves, spectator views, replays
node games/poker/test_eval.mjs    # hand ranking, side pots
node games/gostop/test_rules.mjs  # ppeok, jjok, ttadak, bombs, bak penalties, go multipliers
node games/mine/test_board.mjs    # tunnel connectivity, goal reveal, rockfall
node games/dalmuti/test_port.mjs  # identical to the original Dalmuti engine
node games/dalmuti/test_passlock.mjs  # the "pass = out of the trick" house rule
node games/codebreak/test_logic.mjs   # Secret Numbers: deduction never rules out the true number; AI levels
node games/liar/test_words.mjs        # Liar Game word lists (bilingual, hints, no duplicates)
node games/liar/test_rules.mjs        # Liar Game hint checks, scoring, hidden word and liar
```

## Deploy

`python deploy.py -m "English commit message"` (first time: `--init`). Copies the site files into `.pages/` and pushes them.
