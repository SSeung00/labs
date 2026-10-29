/* Host side: the room (lobby, connections) and the game runner.
   The host's browser runs the rules engine and sends each person only their own view.

   Game engine contract (default export of games/<id>/engine.js) — full description in games/README.md
     setup({n, seed, settings}) → state S (plain JSON-serializable object)
     pending(S) → [{p, kind, time?, secret?}]  who must decide now (empty = automatic progress)
     validate(S, p, a) → true | error text (bilingual tx object or string)
     apply(S, p, a) → events
     step(S) → events                    when pending is empty (next round, etc.)
     delay(S) → ms                       wait before step
     timeout(S, p, kind) → action        when the time limit runs out
     ai(S, p, {level, rng}) → action
     view(S, p) → what that person may see
     filterEvent(ev, p, S) → ev | redacted copy | null   (optional)
     over(S) → bool,  results(S) → [{p, rank, score, note}]

   Staying in the room (nothing is lost unless the host presses "Close room"):
   - Everything is saved in the host's localStorage after every change. If the host's page closes or reloads,
     opening the same link (or the home screen's "Reopen" card) restores the room and the game where it left off.
   - People are identified by a per-tab token; someone who returns from another browser gets their seat back by name.
   - A disconnected player keeps their seat for a grace period before the AI plays for them — or, with the "wait" setting,
     the game waits until they come back or the host hands their seat to the AI.
   - People who arrive during a game wait and join from the next game — meanwhile they watch it (spectator view).
   - Watchers (a TV or tablet showing the table, "watch" in the hello) see the public view only and never get a seat.
   - The room keeps a scoreboard of the evening (tally) until it is closed.
   - Every game records its seed and moves (log) so anyone can replay it afterwards (core/replay.js).
   - One guest (the heir) keeps a copy of the saved room. If the host never comes back, the heir reopens the room with
     the same code and everyone reconnects to them (app.js / net.js take over). */
import { GAMES, gameById } from "../games/registry.js";
import { LS, toast, sound, steadySleep as hostSleep, cleanLook } from "./ui.js";
import { EMOTE_IDS } from "./social.js";
import { L, tx } from "./i18n.js";

/* AI seat names. The host picks the Korean name; each viewer's screen shows it in their own language (see aiName). */
export const AI_NAMES = [["다람쥐", "Squirrel"], ["너구리", "Raccoon"], ["부엉이", "Owl"], ["고양이", "Cat"], ["여우", "Fox"],
  ["판다", "Panda"], ["수달", "Otter"], ["펭귄", "Penguin"], ["고슴도치", "Hedgehog"], ["토끼", "Rabbit"]];
const AI_EN = new Map(AI_NAMES);
export const aiName = (name, lang) => (lang === "en" && AI_EN.has(name) ? AI_EN.get(name) : name);

const GRACE_DROP = 20000;      // a dropped player's seat waits this long before the AI takes over
const GRACE_REOPEN = 60000;    // after the host reopens the room, everyone gets longer to reconnect
const SILENT = 15000;          // a guest that sends nothing (not even a ping) for this long counts as disconnected
const SAVE_TTL = 12 * 3600 * 1000;
const EMOTE_GAP = 800;         // at most one reaction per person in this time
const MAX_WATCH = 3;           // TV / tablet screens per room (the host's browser handles only so many connections well)
export const MAX_ROOM = Math.max(...GAMES.map(g => g.engine.players.max));


export const cleanName = s => (String(s || "").replace(/\s+/g, " ").trim().slice(0, 10)) || L("손님", "Guest");

/* The saved room of this device (host side), if recent */
export function savedRoom(code) {
  const s = LS.json("host", null);
  if (!s || !s.code || Date.now() - s.at > SAVE_TTL) return null;
  return !code || s.code === code ? s : null;
}
export function forgetSavedRoom() { LS.set("host", ""); }

export class Room {
  /* deliver(player, msg): send a message to a person (app.js handles connection vs. local delivery) */
  constructor({ name, look, token, code, deliver, saved }) {
    this.code = code;              // null = solo (AI only)
    this.deliver = deliver;
    this.waiting = [];             // people who arrived during a game: {name, token, conn, online}
    this.watchers = [];            // TV / tablet screens: {name, look, token, conn, online} (or my own screen, local, in solo watch mode)
    this.runner = null;
    this.alive = true;
    this.tally = [];               // scoreboard of the evening: [{name, look, pts, wins, games}]
    this.heir = null;              // the guest holding the backup copy
    if (code) this.watch();
    if (saved) return this.restore(saved, name, token, look);
    this.self = { name: cleanName(name), look: cleanLook(look), token, kind: "human", local: true, online: true, conn: null };
    this.players = [this.self];
    const pref = LS.json("room", {});
    this.settings = Object.assign({ game: GAMES[0].id, level: "normal", timer: 30, away: "ai", opts: {} }, pref);
    // Online rooms start in "auto" (AI only fills up to the game's minimum); solo play starts with the game's usual size
    this.settings.seats = code ? "auto" : 0;
    if (!gameById(this.settings.game)) this.settings.game = GAMES[0].id;
    this.fixSettings();
  }
  get engine() { return gameById(this.settings.game).engine; }
  humans() { return this.players.filter(p => p.kind === "human"); }
  /* My own seat (-1 while I only watch) */
  mySeat() { return this.players.findIndex(p => p.local); }
  /* humans who will take part in the next game: seated humans still around + people waiting */
  nextHumans() { return [...this.humans().filter(p => p.local || p.online), ...this.waiting.filter(w => w.online)]; }

  /* settings.seats: "auto" (= max(humans, game minimum)) or a fixed total number of seats */
  seatsFor(nHumans) {
    const E = this.engine, st = this.settings;
    if (st.seats === "auto") return Math.max(nHumans, E.players.min);
    return Math.max(st.seats, nHumans, E.players.min);
  }
  fixSettings() {
    const E = this.engine, st = this.settings, h = this.runner ? this.nextHumans().length : this.humans().length;
    if (st.seats !== "auto") {
      if (!st.seats || st.seats < E.players.min || st.seats > E.players.max) st.seats = this.code ? "auto" : E.players.default;
      else if (st.seats < h) st.seats = Math.min(E.players.max, h);
    }
    st.opts = st.opts || {};
    const o = {};
    for (const s of E.settings || []) o[s.key] = s.values.includes(st.opts[s.key]) ? st.opts[s.key] : s.default;
    st.opts = o;
  }

  /* ----- Persistence (host device) ----- */
  save() {
    if (!this.code || !this.alive) return;
    try {
      const r = this.runner;
      this.snap = JSON.parse(JSON.stringify({
        code: this.code, at: Date.now(), settings: this.settings, tally: this.tally,
        players: this.players.map(p => ({ name: p.name, look: p.look || null, token: p.token, kind: p.kind, handed: !!p.handed })),
        waiting: this.waiting.map(w => ({ name: w.name, look: w.look || null, token: w.token })),
        game: r && r.alive ? { id: r.E.id, S: r.S, runId: r.runId, seq: r.seq, settings: r.settings, finished: r.finished, recorded: !!r.recorded,
          seed: r.seed, log: r.log } : null
      }));
      LS.put("host", this.snap);
    } catch (e) { console.error("save failed", e); }
    this.scheduleBackup();
  }
  /* The heir (the first guest still connected) gets a copy of the saved room a moment after each change */
  scheduleBackup() {
    if (!this.code || this.backupT) return;
    this.backupT = setTimeout(() => { this.backupT = 0; this.sendBackup(); }, 1500);
  }
  sendBackup() {
    if (!this.alive || !this.code) return;
    const heir = this.players.find(p => p.kind === "human" && !p.local && p.online && p.conn) || null;
    if (this.heir && this.heir !== heir && this.heir.conn) try { this.heir.conn.send({ t: "backup", data: null }); } catch (e) { }
    this.heir = heir;
    if (heir && this.snap) try { heir.conn.send({ t: "backup", data: this.snap }); } catch (e) { }
  }
  restore(s, name, token, look) {
    this.settings = Object.assign({ away: "ai" }, s.settings);
    this.tally = s.tally || [];
    const grace = Date.now() + GRACE_REOPEN;
    // My seat: the one with my token — seat 0 when I made the room, another seat when I take over as the heir
    let mine = s.players.findIndex(p => p.kind === "human" && p.token === token);
    if (mine < 0) mine = 0;
    this.players = s.players.map((p, i) => i === mine
      ? { name: cleanName(p.name || name), look: cleanLook(look), token, kind: "human", local: true, online: true, conn: null }
      : { ...p, local: false, online: p.kind === "ai", conn: null, graceUntil: p.kind === "human" ? grace : 0 });
    this.self = this.players[mine];
    this.waiting = (s.waiting || []).map(w => ({ ...w, conn: null, online: false }));
    if (s.game && gameById(s.game.id)) {
      this.runner = new Runner(this, gameById(s.game.id).engine, s.game.settings, s.game);
      this.runner.run();
    } else {
      // lobby: people who don't come back within the grace period are removed
      hostSleep(GRACE_REOPEN).then(() => {
        if (this.runner) return;
        const before = this.players.length;
        this.players = this.players.filter(p => p.local || p.kind !== "human" || p.online);
        if (this.players.length !== before) { this.fixSettings(); this.lobby(); }
      });
      this.lobby();
    }
    return this;
  }

  /* ----- Connections ----- */
  /* Guests ping every few seconds. WebRTC itself can take half a minute or more to notice a closed tab, a phone that
     went to sleep or a lost network, so a silent connection is treated as dropped. */
  async watch() {
    while (this.alive) {
      await hostSleep(3000);
      const now = Date.now();
      for (const x of [...this.players, ...this.waiting, ...this.watchers]) {
        if (x.conn && x.online && x.conn.pinged && now - x.conn.seen > SILENT) this.drop(x.conn);
      }
    }
  }
  drop(conn) { try { conn.close(); } catch (e) { } this.onClose(conn); }
  /* This page stops hosting (the room stays saved) */
  stop() { this.alive = false; if (this.runner) this.runner.stop(); }
  onData(conn, msg) {
    if (!msg || !msg.t || !this.alive) return;
    conn.seen = Date.now();
    if (msg.t === "ping") { conn.pinged = true; try { conn.send({ t: "pong" }); } catch (e) { } return; }
    if (msg.t === "gone") return this.drop(conn);              // their page is closing or reloading
    if (msg.t === "hello") return this.hello(conn, msg);
    const p = this.players.findIndex(x => x.conn === conn);
    if (p >= 0) return this.receive(p, msg);
    const w = this.waiting.find(x => x.conn === conn);
    if (w && msg.t === "bye") { this.waiting.splice(this.waiting.indexOf(w), 1); this.save(); }
    const wt = this.watchers.find(x => x.conn === conn);
    if (wt && msg.t === "bye") this.watchers.splice(this.watchers.indexOf(wt), 1);
  }
  hello(conn, msg) {
    const name = cleanName(msg.name), look = cleanLook(msg.look);
    if (msg.watch) return this.helloWatch(conn, msg, name, look);
    const attach = (pl, p) => {
      if (pl.conn && pl.conn !== conn) try { pl.conn.close(); } catch (e) { }
      pl.conn = conn; pl.online = true; pl.token = msg.token; pl.graceUntil = 0; pl.handed = false; pl.look = look;
      if (this.runner) this.runner.presence(p, tx(`{${p}} 님이 다시 들어왔습니다`, `{${p}} is back`));
      else this.lobby();
      this.save();
      this.replayTo(pl);
    };
    // 1) same tab coming back (token)  2) an empty human seat with the same name (another browser or a new tab)
    let p = this.players.findIndex(x => !x.local && x.kind === "human" && x.token === msg.token);
    if (p < 0) p = this.players.findIndex(x => !x.local && x.kind === "human" && !x.online && x.name === name);
    if (p >= 0) return attach(this.players[p], p);
    let w = this.waiting.find(x => x.token === msg.token) || (this.runner && this.waiting.find(x => !x.online && x.name === name));
    if (w) {
      if (w.conn && w.conn !== conn) try { w.conn.close(); } catch (e) { }
      w.conn = conn; w.online = true; w.token = msg.token; w.look = look;
      this.sendWait(w);
      this.replayTo(w);
      return;
    }
    const reject = text => { try { conn.send({ t: "reject", text }); } catch (e) { } setTimeout(() => { try { conn.close(); } catch (e) { } }, 600); };
    const count = this.humans().length + this.waiting.length;
    if (count >= MAX_ROOM) return reject(tx(`방이 꽉 찼습니다 (최대 ${MAX_ROOM}명).`, `The room is full (max ${MAX_ROOM}).`));
    const unique = this.uniqueName(name);
    if (this.runner) {
      // A game is running (or its results are on screen): wait and join from the next game
      w = { name: unique, look, token: msg.token, conn, online: true };
      this.waiting.push(w);
      this.sendWait(w);
      toast(L(`${unique} 님이 들어왔습니다 — 다음 판부터 함께합니다`, `${unique} joined — they'll play from the next game`)); sound.join();
      if (this.runner.finished) this.runner.broadcast(); else this.save();
      return;
    }
    this.players.push({ name: unique, look, token: msg.token, kind: "human", conn, local: false, online: true });
    this.fixSettings();
    toast(L(`${unique} 님이 들어왔습니다`, `${unique} joined`)); sound.join();
    this.lobby();
  }
  /* A TV / tablet screen: public view only, no seat */
  helloWatch(conn, msg, name, look) {
    let w = this.watchers.find(x => !x.local && x.token === msg.token);
    if (!w) {
      this.watchers = this.watchers.filter(x => x.local || x.online);         // screens that went away make room
      if (this.watchers.filter(x => !x.local).length >= MAX_WATCH) {
        try { conn.send({ t: "reject", text: tx(`관전 화면은 ${MAX_WATCH}개까지 열 수 있습니다.`, `At most ${MAX_WATCH} watching screens per room.`) }); } catch (e) { }
        return;
      }
      w = { token: msg.token };
      this.watchers.push(w);
      toast(L(`${name} 님이 관전 화면을 열었습니다`, `${name} opened a watching screen`));
    }
    if (w.conn && w.conn !== conn) try { w.conn.close(); } catch (e) { }
    Object.assign(w, { name, look, conn, online: true });
    if (this.runner) this.runner.broadcast(); else this.lobby();
    this.replayTo(w);
  }
  uniqueName(name, self) {
    const taken = new Set([...this.humans(), ...this.waiting].filter(p => p !== self).map(p => p.name));
    if (!taken.has(name)) return name;
    for (let k = 2; ; k++) if (!taken.has(name.slice(0, 8) + k)) return name.slice(0, 8) + k;
  }
  sendWait(w) {
    const E = this.runner ? this.runner.E : this.engine;
    try { w.conn.send({ t: "wait", code: this.code, game: E.id, players: this.publicPlayers(), waiting: this.waiting.map(x => x.name) }); } catch (e) { }
  }
  onClose(conn, bye) {
    if (!this.alive) return;
    const wt = this.watchers.find(x => x.conn === conn);
    if (wt) { wt.conn = null; wt.online = false; if (bye) this.watchers.splice(this.watchers.indexOf(wt), 1); return; }
    const w = this.waiting.find(x => x.conn === conn);
    if (w) { w.conn = null; w.online = false; if (bye) this.waiting.splice(this.waiting.indexOf(w), 1); this.save(); return; }
    const p = this.players.findIndex(x => x.conn === conn);
    if (p < 0) return;
    const pl = this.players[p];
    pl.conn = null; pl.online = false;
    if (!this.runner) {
      this.players.splice(p, 1);
      this.fixSettings();
      toast(L(`${pl.name} 님이 나갔습니다`, `${pl.name} left`));
      this.lobby();
      return;
    }
    pl.graceUntil = bye ? 0 : Date.now() + GRACE_DROP;
    if (bye) pl.handed = true;         // left on purpose: no need to wait for them
    this.runner.presence(p, bye
      ? tx(`{${p}} 님이 나갔습니다 — AI 가 대신 둡니다 (같은 이름으로 다시 들어오면 자리를 되찾습니다)`, `{${p}} left — AI plays for them (rejoin with the same name to take the seat back)`)
      : this.runner.settings.away === "wait"
        ? tx(`{${p}} 님의 연결이 끊겼습니다 — 돌아올 때까지 기다립니다`, `{${p}} disconnected — waiting for them to come back`)
        : tx(`{${p}} 님의 연결이 끊겼습니다 — ${GRACE_DROP / 1000}초 기다린 뒤 AI 가 대신 둡니다`, `{${p}} disconnected — AI takes over after ${GRACE_DROP / 1000}s`));
    this.save();
    if (this.heir === pl) this.sendBackup();          // pick a new heir at once
  }
  sendTo(p, msg) {
    const pl = this.players[p];
    if (pl && pl.kind === "human") this.deliver(pl, msg);
  }
  /* A message from a seated person (p), or from my own screen (fromHost: also while I only watch) */
  receive(p, msg, fromHost) {
    if (!msg || !msg.t) return;
    const isHost = fromHost || !!(this.players[p] && this.players[p].local);
    if (msg.t === "act") { if (this.runner) this.runner.receive(p, msg); return; }
    if (msg.t === "bye") { if (!isHost) this.onClose(this.players[p].conn, true); return; }
    if (msg.t === "emote") return this.emote(p, msg.e);
    if (msg.t === "profile") return this.profile(p, msg);
    if (!isHost) return;
    if (msg.t === "takeover") return this.takeover(msg.p);
    if (msg.t === "setting") return this.setSetting(msg.key, msg.value);
    if (msg.t === "start") return this.start();
    if (msg.t === "again") return this.start();
    if (msg.t === "lobby") return this.backToLobby();
  }

  /* ----- Reactions · profiles · seats handed to the AI ----- */
  emote(p, e) {
    const pl = this.players[p], now = Date.now();
    if (!pl || pl.kind !== "human" || !EMOTE_IDS.has(e) || now - (pl.lastEmote || 0) < EMOTE_GAP) return;
    pl.lastEmote = now;
    const msg = { t: "emote", name: pl.name, look: pl.look || null, seat: p, e };
    for (const h of [...this.humans(), ...this.watchers]) if (h.local || h.online) this.deliver(h, msg);
  }
  /* Someone changed their name or avatar */
  profile(p, msg) {
    const pl = this.players[p];
    if (!pl || pl.kind !== "human") return;
    const name = this.uniqueName(cleanName(msg.name), pl), old = pl.name;
    pl.look = cleanLook(msg.look);
    if (name !== old) {
      const t = this.tally.find(x => x.name === old);
      if (t && !this.tally.some(x => x.name === name)) t.name = name;
      pl.name = name;
    }
    if (pl.local) Object.assign(this.self, { name: pl.name, look: pl.look });
    const t = this.tally.find(x => x.name === pl.name);
    if (t) t.look = pl.look;
    if (this.runner) this.runner.broadcast(); else this.lobby();
  }
  takeover(p) {
    const pl = this.players[p];
    if (!this.runner || !pl || pl.kind !== "human" || pl.local || pl.online || pl.handed) return;
    pl.handed = true;
    this.runner.presence(p, tx(`{${p}} 님 자리는 AI 가 대신 둡니다 (돌아오면 자리를 되찾습니다)`, `AI plays for {${p}} (they get the seat back when they return)`));
    this.save();
  }
  /* Scoreboard of the evening: 1st 3 points, 2nd 2, 3rd 1 */
  recordResults(r) {
    if (r.recorded) return;
    r.recorded = true;
    let res = [];
    try { res = r.E.results(r.S) || []; } catch (e) { return; }
    for (const x of res) {
      const pl = this.players[x.p];
      if (!pl || pl.kind !== "human") continue;
      let t = this.tally.find(y => y.name === pl.name);
      if (!t) this.tally.push(t = { name: pl.name, look: pl.look || null, pts: 0, wins: 0, games: 0 });
      t.look = pl.look || null;
      t.games++;
      t.pts += Math.max(0, 4 - x.rank);
      if (x.rank === 1) t.wins++;
    }
  }

  /* The finished game's seed and moves, for replays (core/replay.js) */
  sendReplay(r) {
    if (!r.log) return;
    r.replayData = { game: r.E.id, run: r.runId, seed: r.seed, n: this.players.length, opts: r.settings.opts, log: r.log, at: Date.now(),
      players: this.publicPlayers().map(({ name, look, kind }) => ({ name, look, kind: kind === "ai" ? "ai" : "human" })) };
    for (const h of [...this.humans(), ...this.watchers, ...this.waiting]) if (h.local || h.online) this.replayTo(h);
  }
  /* The replay of the finished game to one person (also to someone who reconnects while the results are on screen) */
  replayTo(h) {
    const r = this.runner;
    if (!r || !r.finished || !r.replayData || !(h.local || (h.online && h.conn))) return;
    const msg = { t: "replay", data: r.replayData };
    try { if (h.local) this.deliver(h, msg); else h.conn.send(msg); } catch (e) { }
  }
  /* Who sees the public view: watching screens, people waiting for the next game */
  spectators() {
    return [...this.watchers.filter(w => w.local || (w.online && w.conn)).map(w => ({ ent: w, waiting: false })),
            ...this.waiting.filter(w => w.online && w.conn).map(w => ({ ent: w, waiting: true }))];
  }

  /* ----- Lobby ----- */
  publicPlayers() {
    return this.players.map(pl => ({ name: pl.name, look: pl.look || null, kind: pl.kind === "ai" ? "ai" : (pl.online || pl.local ? "human" : "away"),
      host: !!pl.local && pl.kind === "human", handed: !!pl.handed }));
  }
  lobby() {
    const humans = this.humans();
    const list = humans.map(pl => ({ name: pl.name, look: pl.look || null, host: !!pl.local, away: !pl.local && !pl.online }));
    const n = this.seatsFor(humans.length);
    const base = { t: "lobby", code: this.code, players: list, settings: this.settings, seats: n, tally: this.tally,
      watchers: this.watchers.filter(w => !w.local && w.online).map(w => w.name) };
    humans.forEach((pl, i) => this.deliver(pl, { ...base, you: i }));
    for (const w of this.watchers) if (!w.local && w.online) this.deliver(w, { ...base, you: -1, watching: true });
    this.save();
  }
  setSetting(key, value) {
    if (this.runner) return;
    if (key === "game") { if (!gameById(value)) return; this.settings.game = value; this.settings.opts = {}; if (this.settings.seats !== "auto") this.settings.seats = 0; }
    else if (key === "seats" || key === "level" || key === "timer") this.settings[key] = value;
    else if (key === "away") this.settings.away = value === "wait" ? "wait" : "ai";
    else if (key === "watch") this.settings.watch = !this.code && !!value;   // solo: watch the AI play
    else if (key.startsWith("opt.")) this.settings.opts[key.slice(4)] = value;
    this.fixSettings();
    const { seats, ...pref } = this.settings;
    LS.put("room", pref);
    this.lobby();
  }
  start() {
    if (this.runner && !this.runner.finished) return;
    const E = this.engine;
    let humans = this.nextHumans().map(h => ({ name: h.name, look: h.look || null, token: h.token, kind: "human", conn: h.conn, local: !!h.local, online: h.local ? true : !!h.online }));
    if (!humans.some(h => h.local)) humans.unshift(this.self);
    // Solo "watch" mode: my screen becomes a watcher and every seat is AI
    this.watchers = this.watchers.filter(w => !w.local);
    if (!this.code && this.settings.watch && E.spectate) { humans = []; this.watchers.push({ ...this.self }); }
    if (humans.length > E.players.max) { toast(L(`이 게임은 최대 ${E.players.max}명입니다`, `This game allows at most ${E.players.max} players`)); return; }
    this.waiting = [];
    this.fixSettings();
    const n = this.seatsFor(humans.length);
    const taken = new Set(humans.map(h => h.name));
    const pool = AI_NAMES.map(x => x[0]).filter(x => !taken.has(x)).sort(() => Math.random() - .5);
    this.players = humans;
    for (let i = 0; this.players.length < n; i++) this.players.push({ name: pool[i] || `AI ${i + 1}`, kind: "ai", online: true });
    if (this.runner) this.runner.stop();
    this.runner = new Runner(this, E, this.settings);
    this.runner.run();
  }
  backToLobby() {
    if (this.runner) this.runner.stop();
    this.runner = null;
    const merged = this.nextHumans().map(h => ({ name: h.name, look: h.look || null, token: h.token, kind: "human", conn: h.conn, local: !!h.local, online: h.local ? true : !!h.online }));
    if (!merged.some(h => h.local)) merged.unshift(this.self);
    this.watchers = this.watchers.filter(w => !w.local);
    this.players = merged;
    this.waiting = [];
    this.fixSettings();
    this.lobby();
  }
  /* The host ends the room on purpose: tell everyone and forget the saved room */
  close() {
    const msg = { t: "closed" };
    for (const pl of this.humans()) if (!pl.local) this.deliver(pl, msg);
    for (const w of [...this.waiting, ...this.watchers]) try { if (w.conn) w.conn.send(msg); } catch (e) { }
    this.stop();
    this.runner = null;
    forgetSavedRoom();
  }
}

/* One game: pending → (ask the person | AI) → apply → send each person their view */
class Runner {
  constructor(room, engine, settings, restore) {
    this.room = room; this.E = engine; this.settings = JSON.parse(JSON.stringify(settings));
    if (restore) {
      this.S = restore.S; this.seq = restore.seq || 0; this.runId = restore.runId; this.recorded = !!restore.recorded;
      this.seed = restore.seed; this.log = restore.log || null;          // games saved before replays existed have no log
    } else {
      const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
      this.S = engine.setup({ n: room.players.length, seed, settings: this.settings.opts });
      this.seed = seed; this.log = [];                                    // 0 = step(), [p, action] = apply()
      this.seq = 0;
      this.runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);   // lets clients redraw on "play again"
    }
    this.askSeq = Math.floor(Math.random() * 1e6) * 100; this.asks = new Map(); this.alive = true; this.finished = false;
    this.kick = null; this.outbox = [];
  }
  stop() { this.alive = false; for (const a of this.asks.values()) a.cancel(); this.asks.clear(); if (this.kick) this.kick({ kick: true }); }

  /* Presence changed: rebuild that person's question (human ↔ grace wait ↔ AI stand-in) */
  presence(p, text) {
    const a = this.asks.get(p);
    if (a) { a.cancel(); this.asks.delete(p); }
    if (text) this.outbox.push({ type: "notice", text });
    if (this.finished) this.broadcast();
    if (this.kick) this.kick({ kick: true });
  }

  receive(p, msg) {
    const a = this.asks.get(p);
    if (!a || !a.human || a.id !== msg.id) { this.room.sendTo(p, { t: "error", text: tx("지금은 둘 차례가 아닙니다", "It's not your turn"), stale: true }); return; }
    const bad = tx("규칙에 맞지 않는 수입니다", "That move isn't allowed");
    let ok;
    try { ok = this.E.validate(this.S, p, msg.a); } catch (e) { ok = bad; }
    if (ok !== true) { this.room.sendTo(p, { t: "error", text: ok || bad }); return; }
    a.resolve({ p, id: a.id, action: msg.a });
  }

  makeAsk(x) {
    const id = ++this.askSeq, pl = this.room.players[x.p];
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    const ask = { id, p: x.p, kind: x.kind, secret: !!x.secret, promise, deadline: 0, total: 0, human: false, away: false, cancelled: false };
    ask.resolve = v => { if (!ask.cancelled) { ask.cancelled = true; resolve(v); } };
    ask.cancel = () => { ask.cancelled = true; };
    const level = this.settings.level;
    const aiMove = () => {
      if (ask.cancelled) return;
      let a;
      try { a = this.E.ai(this.S, x.p, { level, rng: Math.random }); }
      catch (e) { console.error(e); a = this.E.timeout(this.S, x.p, x.kind); }
      ask.resolve({ p: x.p, id, action: a, ai: true });
    };
    if (pl.kind === "human" && (pl.online || pl.local)) {
      ask.human = true;
      const sec = x.time !== undefined ? x.time : this.settings.timer;
      if (sec) {
        ask.deadline = Date.now() + sec * 1000; ask.total = sec * 1000;
        hostSleep(sec * 1000).then(() => {
          if (ask.cancelled) return;
          let a;
          try { a = this.E.timeout(this.S, x.p, x.kind); } catch (e) { a = this.E.ai(this.S, x.p, { level: "easy", rng: Math.random }); }
          ask.resolve({ p: x.p, id, action: a, timeout: true });
        });
      }
    } else {
      const think = x.think !== undefined ? x.think : (this.E.thinkTime ? this.E.thinkTime(this.S, x.p, x.kind) : 700 + Math.random() * 700);
      // "wait": a disconnected human's turn waits until they return (presence() rebuilds the question) or the host hands it over
      if (pl.kind === "human" && !pl.handed && this.settings.away === "wait" && !x.secret) { ask.away = true; return ask; }
      // otherwise the seat is kept for a grace period before the AI plays for them (secret decisions: at least that long)
      let grace = pl.kind === "human" && !pl.handed ? Math.max(0, (pl.graceUntil || 0) - Date.now()) : 0;
      if (pl.kind === "human" && !pl.handed && x.secret && this.settings.away === "wait") grace = Math.max(grace, GRACE_DROP);
      if (grace) { ask.away = true; ask.deadline = Date.now() + grace; ask.total = grace; }
      hostSleep(grace + think).then(aiMove);
    }
    return ask;
  }

  syncAsks(pend) {
    const want = new Map(pend.map(x => [x.p, x]));
    for (const [p, a] of this.asks) if (!want.has(p) || want.get(p).kind !== a.kind) { a.cancel(); this.asks.delete(p); }
    for (const x of pend) if (!this.asks.has(x.p)) this.asks.set(x.p, this.makeAsk(x));
  }

  broadcast() {
    const evs = this.outbox; this.outbox = [];
    this.seq++;
    const over = this.E.over(this.S);
    const results = over ? this.E.results(this.S) : null;
    if (over) this.room.recordResults(this);
    const asks = [...this.asks.values()].map(a => ({ p: a.p, kind: a.kind, id: a.id, secret: a.secret, away: a.away, total: a.total, ms: a.deadline ? Math.max(0, a.deadline - Date.now()) : 0 }));
    const players = this.room.publicPlayers();
    const waiting = this.room.waiting.map(w => w.name);
    this.room.players.forEach((pl, p) => {
      if (pl.kind !== "human") return;
      const v = this.E.view(this.S, p);
      const ev = evs.map(e => (this.E.filterEvent ? this.E.filterEvent(e, p, this.S) : e)).filter(Boolean);
      const pending = asks.filter(a => !a.secret || a.p === p).map(({ secret, ...a }) => a);
      this.room.sendTo(p, { t: "state", run: this.runId, seq: this.seq, game: this.E.id, me: p, v, ev, pending, players, waiting, settings: this.settings, over, results,
        tally: over ? this.room.tally : undefined });
    });
    // Spectators: the public view (me = -1) for games that support it
    const specs = this.E.spectate ? this.room.spectators() : [];
    if (specs.length) {
      let v = null;
      try { v = this.E.view(this.S, -1); } catch (e) { console.error("spectator view failed", e); }
      if (v) {
        let ev = [];
        try { ev = evs.map(e => (this.E.filterEvent ? this.E.filterEvent(e, -1, this.S) : e)).filter(Boolean); } catch (e) { console.error("spectator events failed", e); }
        const pending = asks.filter(a => !a.secret).map(({ secret, ...a }) => a);
        for (const s of specs) this.room.deliver(s.ent, { t: "state", run: this.runId, seq: this.seq, game: this.E.id, me: -1, v, ev, pending, players, waiting,
          settings: this.settings, over, results, tally: over ? this.room.tally : undefined, spectator: true, waitingSeat: s.waiting });
      }
    }
    if (over) for (const w of this.room.waiting) if (w.conn) this.room.sendWait(w);
    this.room.save();
  }

  async run() {
    try {
      while (this.alive && !this.E.over(this.S)) {
        const pend = this.E.pending(this.S);
        if (!pend.length) {
          this.syncAsks([]);
          this.broadcast();
          await hostSleep(this.E.delay ? this.E.delay(this.S) : 1200);
          if (!this.alive) return;
          if (!this.E.pending(this.S).length && !this.E.over(this.S)) {
            if (this.log) this.log.push(0);
            this.outbox.push(...(this.E.step(this.S) || []));
          }
          continue;
        }
        this.syncAsks(pend);
        this.broadcast();
        const kick = new Promise(r => { this.kick = r; });
        const r = await Promise.race([kick, ...[...this.asks.values()].map(a => a.promise)]);
        this.kick = null;
        if (!this.alive) return;
        if (r.kick) continue;
        const a = this.asks.get(r.p);
        if (!a || a.id !== r.id) continue;
        this.asks.delete(r.p);
        let ok = true;
        try { ok = this.E.validate(this.S, r.p, r.action); } catch (e) { ok = String(e); }
        if (ok !== true) {                              // an AI / timeout action was illegal: engine bug. Log it and fall back.
          console.error("illegal automatic action", this.E.id, r, ok);
          r.action = this.E.timeout(this.S, r.p, a.kind);
          if (this.E.validate(this.S, r.p, r.action) !== true) throw new Error(`${this.E.id}: fallback action is illegal too`);
        }
        if (this.log) this.log.push([r.p, JSON.parse(JSON.stringify(r.action))]);
        const evs = this.E.apply(this.S, r.p, r.action) || [];
        if (r.timeout) this.outbox.push({ type: "notice", text: tx(`{${r.p}} 님 시간 초과`, `{${r.p}} ran out of time`) });
        this.outbox.push(...evs);
      }
      if (!this.alive) return;
      this.finished = true;
      this.syncAsks([]);
      this.broadcast();
      this.room.sendReplay(this);
    } catch (e) {
      console.error(e);
      this.outbox.push({ type: "notice", text: tx("게임 진행 중 오류가 났습니다: " + (e.message || e), "Something went wrong in the game: " + (e.message || e)) });
      this.finished = true;
      this.broadcast();
    }
  }
}
