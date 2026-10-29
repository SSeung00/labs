# Board-game hub (놀이방 / Game Room)

Static site on GitHub Pages (`SSeung00/boardgames`, https://sseung00.github.io/boardgames/). No server: the host's browser runs the
rules engine and sends each player only their own view (PeerJS / WebRTC). Games: Dalmuti, Old Maid, One Card, Poker, Go-Stop,
Gem Merchant, Gold Mine, Yacht Dice, Liar Game, Liar's Dice, Secret Numbers. Contract for game modules: `games/README.md`.

## Language rules

- **Chat with the user in Korean.**
- **Everything pushed to GitHub is English**: code comments, docs (README, games/README.md), commit messages, repo description.
- **In-game text is bilingual Korean / English with a language toggle** (🌐 button; default = device language, Korean for `ko*`,
  English otherwise; remembered per device). Never ship a user-facing string in only one language.
  - UI code (`ui.js`, `core/app.js`): `L("한국어", "English")` from `core/i18n.js` — evaluated at render time, so re-rendering
    after a toggle switches the language.
  - Engine code (`engine.js`) runs on the host, whose language may differ from each viewer's. Any text it produces
    (event `text`, `view.status`, `validate` errors, `results` notes, `rules`, `blurb`, setting labels, game `name`) must be
    a bilingual object made with `tx("한국어", "English")`; the shell and UIs resolve it with `loc(x)` for the viewer.
  - Player names are still inserted with `{3}`-style placeholders inside both languages.
- Trademarked commercial games keep our own names in both languages (Gem Merchant, Gold Mine), never "Splendor"/"Saboteur".

## Checks before deploying

```bash
node tests/playout.mjs            # every game, AI + random moves, validate / check / leak each step
node games/poker/test_eval.mjs
node games/gostop/test_rules.mjs
node games/mine/test_board.mjs
node games/dalmuti/test_port.mjs  # must match the original Dalmuti engine
node games/dalmuti/test_passlock.mjs
node games/codebreak/test_logic.mjs  # Secret Numbers deduction (the AI and the "possible numbers" helper)
node games/liar/test_words.mjs
node games/liar/test_rules.mjs
```
Then look at the game on phone-sized viewports (360×640, 390×844, 430×932), sideways (844×390) and as a spectator, in both languages.
Deploy with `python deploy.py` (English commit message; site files only).
