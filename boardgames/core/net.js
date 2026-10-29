/* Networking — PeerJS (WebRTC). The host's browser and the guests connect directly, without a server.
   Host: hostRoom() → room code (or hostRoom(code) to reopen a saved room). Guest: joinRoom(code).
   Guests reconnect automatically after a drop and keep waiting while the host reopens the room. */
import { LS, prefs, stickyToast, toast, steadySleep } from "./ui.js";
import { L, tx } from "./i18n.js";

const PREFIX = "bg-kr-v1-";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const net = {
  peer: null, role: null, code: null, hostConn: null, joined: false,
  watch: false,          // joined as a watching screen (TV / tablet): public view, no seat
  backup: null,          // the saved room, when the host picked me as heir
  /* filled in by app.js. takeover(): become the host from the backup (true if it started); supplanted(code): someone
     else now hosts my room (I took too long to come back) */
  on: { hostReady() { }, connection() { }, message() { }, hostLost() { }, entryError() { }, busy() { }, takeover() { return false; }, supplanted() { } }
};

/* Identity: one token per browser tab. A reload keeps it (sessionStorage), a new tab or another browser is a new person.
   (A browser-wide token made several tabs — or one phone opening the link twice — look like the same player.)
   People who come back from another browser are matched by name on the host. */
export const token = (() => {
  try {
    let t = sessionStorage.getItem("bg.tab");
    if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem("bg.tab", t); }
    return t;
  } catch (e) { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
})();

/* The last room this device was in, for the "rejoin" card on the home screen */
const ROOM_TTL = 12 * 3600 * 1000;
export function rememberRoom(code, role) { LS.put("last", { code, role, at: Date.now() }); }
export function lastRoom() {
  const r = LS.json("last", null);
  return r && r.code && Date.now() - r.at < ROOM_TTL ? r : null;
}
export function forgetRoom() { LS.set("last", ""); }
/* This tab is the one that was hosting `code` (survives a reload, not a new tab) */
export function hostingHere(code) { try { return sessionStorage.getItem("bg.hosting") === code; } catch (e) { return false; } }

function makeCode() { let s = ""; for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; }
export const shareLink = code => location.href.split("#")[0] + "#" + code;
/* ICE servers. PeerJS's built-in TURN relays (eu-0/us-0.turn.peerjs.com) no longer exist, so without a relay of our own
   two devices only connect when their networks allow a direct path - often not the case on mobile data or company /
   school Wi-Fi. TURN_URL: a credentials URL from metered.ca ("https://<app>.metered.live/api/v1/turn/credentials?apiKey=...")
   that returns an iceServers list; empty = STUN only. */
const TURN_URL = "";
const STUN = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"] },
              { urls: "stun:stun.cloudflare.com:3478" }];
let iceList = null;
async function iceServers() {
  if (iceList) return iceList;
  if (!TURN_URL) return (iceList = STUN);
  const cached = LS.json("ice", null);
  if (cached && cached.url === TURN_URL && Date.now() - cached.at < 6 * 3600 * 1000) return (iceList = cached.list);
  try {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 5000);
    const list = await (await fetch(TURN_URL, { signal: ctl.signal })).json();
    if (Array.isArray(list) && list.length) {
      iceList = [...STUN, ...list];
      LS.put("ice", { url: TURN_URL, at: Date.now(), list: iceList });
      return iceList;
    }
  } catch (e) { nlog("relay: couldn't get TURN credentials (" + (e.name || e) + ")"); }
  return STUN;
}
const hasRelay = list => list.some(s => [].concat(s.urls).some(u => /^turns?:/.test(u)));
const peerOptions = ice => ({ debug: 0, config: { iceServers: ice } });

/* Connection log: what happened while connecting, kept across reloads so a failed attempt can be looked at
   (home screen -> "Connection log"). */
export function nlog(text) {
  const log = LS.json("netlog", []);          // re-read: other tabs of this browser may have written since
  log.push(new Date().toTimeString().slice(0, 8) + " " + text);
  LS.put("netlog", log.slice(-200));
}
export const netLog = () => LS.json("netlog", []);
function device() {
  const c = navigator.connection;
  return (c ? `${c.type || "?"}/${c.effectiveType || "?"} · ` : "") + navigator.userAgent.replace(/^Mozilla\/5\.0 /, "").slice(0, 140);
}
/* Log a WebRTC connection's progress: my address types, ICE states, and the path that was used (direct or relay). */
function watchPc(conn, who, onState) {
  const pc = conn.peerConnection;
  if (!pc) { nlog(who + ": no peer connection"); return; }
  const mine = new Set();
  pc.addEventListener("icecandidate", e => {
    if (e.candidate && e.candidate.candidate) mine.add(e.candidate.candidate.split(" ")[7]);
    else nlog(`${who}: my addresses ${[...mine].join(", ") || "none"}`);
  });
  pc.addEventListener("iceconnectionstatechange", () => {
    const st = pc.iceConnectionState;
    nlog(`${who}: ice ${st}`);
    if (onState) onState(st);
    if (st === "connected") pc.getStats().then(stats => {
      let pair = null;
      stats.forEach(r => { if (r.type === "transport" && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId); });
      if (!pair) stats.forEach(r => { if (r.type === "candidate-pair" && r.state === "succeeded" && r.nominated) pair = r; });
      const l = pair && stats.get(pair.localCandidateId), r = pair && stats.get(pair.remoteCandidateId);
      if (l && r) nlog(`${who}: path ${l.candidateType} <-> ${r.candidateType} (${l.candidateType === "relay" || r.candidateType === "relay" ? "relay" : "direct"})`);
    }).catch(() => { });
  });
}

export function peerOK() {
  if (typeof window.Peer === "function") return true;
  net.on.entryError(tx("연결 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침하세요.", "Couldn't load the connection module. Check your internet connection and reload."));
  return false;
}

/* reopen: the code of a saved room. Its id may still be held by the signalling server for a minute after the old page
   closed, so keep retrying instead of picking a new code. */
export async function hostRoom(reopen, tries = 0) {
  if (!peerOK()) return;
  net.on.busy(true);
  const code = reopen || makeCode();
  const ice = await iceServers();
  if (!tries) nlog(`host: ${reopen ? "reopen" : "create"} ${code} · relay ${hasRelay(ice) ? "on" : "off"} · ${device()}`);
  const peer = new Peer(PREFIX + code, peerOptions(ice));
  peer.on("open", () => {
    nlog("host: room open " + code);
    net.peer = peer; net.role = "host"; net.code = code;
    history.replaceState(null, "", "#" + code);
    stickyToast(null);
    rememberRoom(code, "host");
    try { sessionStorage.setItem("bg.hosting", code); } catch (e) { }
    net.on.busy(false);
    net.on.hostReady(code, !!reopen);
  });
  peer.on("connection", conn => {
    const who = "guest " + String(conn.peer).slice(0, 6);
    nlog(who + ": knocking");
    watchPc(conn, who);
    conn.on("open", () => nlog(who + ": connected"));
    conn.on("close", () => nlog(who + ": closed"));
    net.on.connection(conn);
  });
  peer.on("disconnected", () => { nlog("host: lost the signalling server, reconnecting"); try { peer.reconnect(); } catch (e) { } });
  peer.on("error", err => {
    nlog("host: error " + (err.type || err.message));
    if (err.type === "unavailable-id") {
      peer.destroy();
      // I was hosting and the code went to someone else (the heir took over while I was away): join them instead
      if (net.role === "host" && net.peer === peer) { nlog("host: room taken over by someone else"); return net.on.supplanted(code); }
      if (!reopen) return hostRoom(null);
      if (tries >= 45) {
        stickyToast(null); net.on.busy(false);
        net.on.entryError(tx(`방 ${code} 을(를) 다시 열지 못했습니다. 다른 창에서 이미 열려 있을 수 있습니다.`, `Couldn't reopen room ${code}. It may already be open in another window.`));
        return;
      }
      stickyToast(L(`방 ${code} 을(를) 다시 여는 중… (최대 2분)`, `Reopening room ${code}… (up to 2 min)`));
      // The code is still taken: either my old page hasn't let go yet, or someone else hosts it now (the heir) — in that
      // case joining works, so try that every other time
      setTimeout(() => (tries % 2
        ? joinRoom(code, false, net.name, () => hostRoom(reopen, tries + 1))
        : hostRoom(reopen, tries + 1)), 3000);
      return;
    }
    if (net.role === "host") { toast(L("연결 서버와 잠시 끊겼습니다. 이미 들어온 사람과의 게임은 계속됩니다.", "Lost the signalling server for a moment. Games with people already in the room continue.")); return; }
    net.on.busy(false); net.on.entryError(tx("방을 만들지 못했습니다: " + (err.type || err.message), "Couldn't create the room: " + (err.type || err.message)));
  });
}

/* quiet: a silent reconnection attempt after a drop.
   onMissing: called instead of showing an error when nobody is hosting the room (used to reopen my own saved room).
   opt.watch: join as a watching screen (TV / tablet) */
export async function joinRoom(code, quiet, name, onMissing, opt = {}) {
  if (!peerOK()) return;
  code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 5) { net.on.entryError(tx("방 코드는 다섯 글자입니다.", "Room codes have five characters.")); return; }
  if (!quiet) { net.on.busy(true); net.watch = !!opt.watch; }
  if (name) net.name = name;
  const ice = await iceServers(), relay = hasRelay(ice);
  nlog(`guest: ${quiet ? "rejoin" : "join"} ${code} · relay ${relay ? "on" : "off"}${quiet ? "" : " · " + device()}`);
  const peer = new Peer(undefined, peerOptions(ice));
  let opened = false, failed = false;
  const fail = (text, missing) => {
    if (opened || failed) return;
    failed = true;
    try { peer.destroy(); } catch (e) { }
    if (quiet) Rejoin.later(missing);
    else if (missing && onMissing) { net.peer = null; net.role = null; net.hostConn = null; onMissing(); }
    else { net.on.busy(false); net.on.entryError(text); }
  };
  /* Why it failed decides the message: the host never answered (screen off, app in the background) vs. the answer came
     but no network path worked (needs a relay). */
  const noAnswer = tx("방장의 화면이 응답하지 않습니다. 방장이 게임 화면을 켜 두었는지 확인하고 다시 눌러 주세요.",
                      "The host's screen isn't responding. Make sure the host has the game open on screen, then try again.");
  const blocked = relay
    ? tx("방장 기기와 연결하지 못했습니다. 잠시 뒤 다시 눌러 주세요.", "Couldn't connect to the host's device. Try again in a moment.")
    : tx("방장 기기와 직접 연결이 막혔습니다. 모바일 데이터나 회사·학교 와이파이에서 자주 생깁니다. 다른 와이파이로 바꾸거나 (또는 와이파이를 끄고) 다시 눌러 주세요.",
         "The direct connection to the host's device is blocked. This is common on mobile data or company / school Wi-Fi. Switch to another Wi-Fi (or turn Wi-Fi off) and try again.");
  peer.on("open", () => {
    nlog("guest: signalling server ok, asking the host");
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: "json" });
    if (net.peer && net.peer !== peer) try { net.peer.destroy(); } catch (e) { }
    net.peer = peer; net.role = "guest"; net.code = code; net.hostConn = conn;
    watchPc(conn, "guest", st => { if (st === "failed") { nlog("guest: no network path to the host"); fail(blocked); } });
    setTimeout(() => {
      if (opened || failed) return;
      const pc = conn.peerConnection, answered = !!pc && pc.signalingState !== "have-local-offer";
      nlog(`guest: gave up (${answered ? "host answered, ice " + pc.iceConnectionState : "no answer from the host"})`);
      fail(answered ? blocked : noAnswer, !answered);
    }, quiet ? 8000 : 15000);
    conn.on("open", () => {
      if (failed) return;
      nlog("guest: connected to " + code);
      opened = true; net.joined = true; net.seen = Date.now();
      net.backup = null;                 // a backup from before is stale; the host sends a fresh one if I'm (still) the heir
      Rejoin.done();
      net.on.busy(false);
      history.replaceState(null, "", "#" + code);
      rememberRoom(code, net.watch ? "watch" : "guest");
      try { if (sessionStorage.getItem("bg.hosting") === code) sessionStorage.removeItem("bg.hosting"); } catch (e) { }   // someone else hosts it now
      conn.send({ t: "hello", name: net.name, look: prefs.look, token, watch: net.watch || undefined });
    });
    conn.on("data", msg => {
      if (net.hostConn !== conn) return;
      net.seen = Date.now();
      if (msg && msg.t === "pong") return;
      if (msg && msg.t === "hostgone") return Rejoin.start();     // the host's page is reloading or closing
      net.on.message(msg);
    });
    conn.on("close", () => { if (opened && net.hostConn === conn) Rejoin.start(); });
  });
  peer.on("disconnected", () => { if (opened) try { peer.reconnect(); } catch (e) { } });
  peer.on("error", err => {
    nlog("guest: error " + (err.type || err.message));
    // "gone": the signalling server knows no such room — nobody hosts it any more (the heir may take over)
    if (err.type === "peer-unavailable") return fail(tx(`${code} 방을 찾지 못했습니다. 코드를 확인하거나, 방장이 방을 열어 두었는지 확인하세요.`, `Room ${code} not found. Check the code, or make sure the host still has the room open.`), "gone");
    if (opened) return;
    fail(tx("연결 오류: " + (err.type || err.message), "Connection error: " + (err.type || err.message)));
  });
}

/* Guest auto-reconnect. Quick tries first (a phone that switched apps), then a slow phase that keeps waiting while the
   host reopens the room (their page may have reloaded), for up to 10 minutes. */
export const Rejoin = {
  active: false, tries: 0, timer: 0, since: 0,
  QUICK: [300, 1000, 2000, 3000, 5000, 5000],
  SLOW: 8000, LIMIT: 10 * 60 * 1000,
  TAKEOVER: 20000,       // the heir reopens the room itself after the host has been gone this long
  start() {
    if (net.role !== "guest" || this.active) return;
    this.active = true; this.tries = 0; this.since = Date.now();
    net.hostConn = null;
    try { if (net.peer) net.peer.destroy(); } catch (e) { }
    this.later();
  },
  later(missing) {
    if (!this.active) return;
    clearTimeout(this.timer);
    // Only when the room itself is gone: if the host still holds the code, the problem is my own connection
    if (net.backup && missing === "gone" && Date.now() - this.since > this.TAKEOVER) {
      nlog(`guest: host gone for ${Math.round((Date.now() - this.since) / 1000)}s${missing ? " (room missing)" : ""} — I hold the backup`);
      if (net.on.takeover()) { this.active = false; return; }
    }
    if (Date.now() - this.since > this.LIMIT) { this.active = false; stickyToast(null); net.on.hostLost(); return; }
    const quick = this.tries < this.QUICK.length;
    stickyToast(quick
      ? L(`연결이 끊겨 다시 연결하는 중…${this.tries ? ` (${this.tries + 1}번째)` : ""}`, `Connection lost — reconnecting…${this.tries ? ` (try ${this.tries + 1})` : ""}`)
      : L("방장을 기다리는 중… 방장이 방을 다시 열면 자동으로 이어집니다", "Waiting for the host… you'll rejoin automatically when the room reopens"));
    this.timer = setTimeout(() => { this.tries++; joinRoom(net.code, true); }, quick ? this.QUICK[this.tries] : this.SLOW);
  },
  now() {
    if (!this.active) return this.start();
    clearTimeout(this.timer);
    joinRoom(net.code, true);
  },
  done() {
    if (this.active) toast(L("다시 연결되었습니다", "Reconnected"));
    this.active = false; this.tries = 0; clearTimeout(this.timer); stickyToast(null);
  },
  stop() { this.active = false; clearTimeout(this.timer); stickyToast(null); }
};

export function sendConn(conn, msg) { try { if (conn && conn.open) conn.send(msg); } catch (e) { } }
export function sendToHost(msg) { if (net.hostConn && net.hostConn.open) net.hostConn.send(msg); }

/* bye: tell the host this was on purpose (frees the lobby seat at once instead of waiting for a timeout) */
export function leaveNet(bye) {
  Rejoin.stop();
  net.backup = null;
  const peer = net.peer;
  if (bye && net.role === "guest") sendToHost({ t: "bye" });
  setTimeout(() => { try { if (peer) peer.destroy(); } catch (e) { } }, bye ? 250 : 0);
  try { sessionStorage.removeItem("bg.hosting"); } catch (e) { }
  net.peer = null; net.role = null; net.hostConn = null; net.joined = false; net.code = null;
  history.replaceState(null, "", location.pathname + location.search);
}

/* Heartbeat: guests ping the host every few seconds (the host drops silent guests), and reconnect when the host has
   been silent too long. Pages also say goodbye when they close or reload, so nobody waits for WebRTC to notice. */
(async () => {
  for (;;) {
    await steadySleep(3000);
    if (net.role !== "guest" || !net.joined || Rejoin.active) continue;
    sendToHost({ t: "ping" });
    if (Date.now() - (net.seen || 0) > 15000) Rejoin.start();
  }
})();
window.addEventListener("pagehide", () => {
  if (net.role === "guest") sendToHost({ t: "gone" });
  else if (net.role === "host" && net.peer) for (const c of Object.values(net.peer.connections || {}).flat()) sendConn(c, { t: "hostgone" });
});

/* Keep the screen awake in the lobby and during games — if the host's phone locks, the game pauses */
export const Awake = {
  lock: null, want: false,
  async set(on) {
    this.want = on;
    try {
      if (on && !this.lock && navigator.wakeLock && document.visibilityState === "visible") {
        this.lock = await navigator.wakeLock.request("screen");
        this.lock.addEventListener("release", () => { this.lock = null; });
      } else if (!on && this.lock) { await this.lock.release(); this.lock = null; }
    } catch (e) { this.lock = null; }
  }
};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (Awake.want) Awake.set(true);
  if (net.role === "guest" && net.joined && !(net.hostConn && net.hostConn.open)) Rejoin.now();
  if (net.role === "host" && net.peer && net.peer.disconnected) try { net.peer.reconnect(); } catch (e) { }
});
