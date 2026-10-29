/* Invites (QR code, share link), emoji reactions, the room's running scoreboard, confetti, my record on this device,
   and installing the site as an app. */
import { $, el, esc, LS, sound, toast, modal, head, buttonRow, avatarHTML } from "./ui.js";
import { L, loc } from "./i18n.js";

/* ---------- QR code ----------
   qrcode-generator (MIT) from cdnjs, loaded the first time a QR code is needed. Without it the code and the link still work. */
const QR_SRC = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
let qrLib = null;
function loadQR() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (!qrLib) qrLib = new Promise(res => {
    const s = document.createElement("script");
    s.src = QR_SRC; s.async = true;
    s.onload = () => res(window.qrcode || null);
    s.onerror = () => { qrLib = null; res(null); };
    document.head.appendChild(s);
  });
  return qrLib;
}
/* An <svg> QR code for text (dark modules on white, with a quiet zone) */
function qrSVG(make, text) {
  const q = make(0, "M");
  q.addData(text); q.make();
  const n = q.getModuleCount(), pad = 3, size = n + pad * 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + pad} ${r + pad}h1v1h-1z`;
  return `<svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#111"/></svg>`;
}
/* Fills box with the QR code of text */
export function drawQR(box, text) {
  box.classList.add("qr");
  box.innerHTML = `<span class="qr-wait">QR…</span>`;
  loadQR().then(make => {
    if (!make) { box.innerHTML = `<span class="qr-wait">${esc(L("QR을 불러오지 못했습니다", "Couldn't load the QR code"))}</span>`; return; }
    try { box.innerHTML = qrSVG(make, text); } catch (e) { box.innerHTML = ""; }
  });
}

/* Send the invite link (share sheet on phones, otherwise copy) */
export async function shareInvite(link, code) {
  const canShare = typeof navigator.share === "function" && matchMedia("(pointer:coarse)").matches;
  if (canShare) {
    try { await navigator.share({ title: L("보드게임 놀이방", "Game Room"), text: L(`같이 해요! 방 코드 ${code}`, `Join my game! Room code ${code}`), url: link }); return; }
    catch (e) { if (e && e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(link); toast(L("초대 링크를 복사했습니다", "Invite link copied")); }
  catch (e) { prompt(L("이 링크를 복사해 보내세요", "Copy and send this link"), link); }
}
export const shareLabel = () => (typeof navigator.share === "function" && matchMedia("(pointer:coarse)").matches
  ? L("링크 보내기", "Send link") : L("링크 복사", "Copy link"));

/* Big invite card: QR code to scan at the table, the code, and the link */
export function inviteModal(link, code) {
  modal((box, close) => {
    box.classList.add("invmodal");
    head(box, L("친구 초대", "Invite friends"), L(`방 코드 <b class="inv-code">${esc(code)}</b>`, `Room code <b class="inv-code">${esc(code)}</b>`),
      L("옆에 있는 친구는 폰 카메라로 QR을 찍으면 바로 들어옵니다. 멀리 있는 친구에게는 링크를 보내세요.",
        "Friends next to you can scan the QR code with their phone camera. Send the link to friends who are far away."));
    const q = el("div", "qr big");
    box.appendChild(q);
    drawQR(q, link);
    box.appendChild(el("div", "inv-link", esc(link)));
    buttonRow(box, [{ label: L("닫기", "Close"), on: () => close() }, { label: shareLabel(), primary: true, on: () => shareInvite(link, code) }]);
  });
}

/* ---------- Emoji reactions ----------
   Anyone in the room can send one; the host passes it on to everyone (at most one per person every 0.8 s). */
export const EMOTES = [
  { id: "👍" }, { id: "😂" }, { id: "😱" }, { id: "🔥" }, { id: "👏" }, { id: "😭" }, { id: "🤔" }, { id: "🎉" },
  { id: "p:hurry", ko: "빨리요~", en: "Hurry up~" }, { id: "p:nice", ko: "나이스!", en: "Nice!" }, { id: "p:wow", ko: "대박!", en: "Wow!" },
  { id: "p:sorry", ko: "미안해요 ㅎㅎ", en: "Sorry!" }, { id: "p:thanks", ko: "고마워요", en: "Thanks!" }, { id: "p:again", ko: "한 판 더?", en: "One more?" }
];
export const EMOTE_IDS = new Set(EMOTES.map(x => x.id));
const emoteText = id => { const x = EMOTES.find(e => e.id === id); return x ? (x.ko ? L(x.ko, x.en) : x.id) : ""; };

/* The picker under the 😀 button */
export function emotePicker(anchor, onPick) {
  const old = $("emotePick");
  if (old) { old.remove(); return; }
  const box = el("div", "emopick");
  box.id = "emotePick";
  for (const x of EMOTES) {
    const b = el("button", x.ko ? "ph" : "em", esc(emoteText(x.id)));
    b.onclick = () => { box.remove(); onPick(x.id); };
    box.appendChild(b);
  }
  document.body.appendChild(box);
  // the page is zoomed (screen size setting): screen pixels → page pixels
  const r = anchor.getBoundingClientRect(), z = parseFloat(getComputedStyle(document.body).zoom) || 1;
  box.style.top = Math.round(r.bottom / z + 6) + "px";
  box.style.right = Math.max(8, Math.round((innerWidth - r.right) / z - 40)) + "px";
  const off = e => { if (!box.contains(e.target) && e.target !== anchor) { box.remove(); document.removeEventListener("pointerdown", off, true); } };
  setTimeout(() => document.addEventListener("pointerdown", off, true), 0);
}

/* A reaction floats up on the right side of the screen. msg: {name, look, seat, e} */
export function showEmote(msg) {
  const text = emoteText(msg.e);
  if (!text) return;
  let host = $("emotes");
  if (!host) { host = el("div", "emotes"); host.id = "emotes"; document.body.appendChild(host); }
  const phrase = String(msg.e).startsWith("p:");
  const b = el("div", "emo-b" + (phrase ? " ph" : ""),
    `${avatarHTML(msg.name, msg.seat || 0, "sm", msg.look || null)}<span class="t">${esc(text)}</span><small>${esc(msg.name)}</small>`);
  host.appendChild(b);
  while (host.children.length > 5) host.firstChild.remove();
  sound.pop();
  setTimeout(() => b.remove(), 3200);
}

/* ---------- Scoreboard for the evening (kept by the host while the room lasts) ----------
   tally: [{name, look, pts, wins, games}] — 1st 3 pts, 2nd 2, 3rd 1 */
export function tallyHTML(tally, me) {
  if (!tally || !tally.length) return "";
  const rows = tally.slice().sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.games - b.games);
  let rank = 0, prev = null;
  return `<ol class="tally">` + rows.map((t, i) => {
    if (!prev || prev.pts !== t.pts || prev.wins !== t.wins) rank = i + 1;
    prev = t;
    return `<li class="${t.name === me ? "me" : ""}"><span class="medal r${rank}">${rank}</span>${avatarHTML(t.name, i, "sm", t.look || null)}` +
      `<span class="t"><b>${esc(t.name)}</b><small>${L(`${t.games}판 · 1등 ${t.wins}번`, `${t.games} game${t.games > 1 ? "s" : ""} · ${t.wins} win${t.wins === 1 ? "" : "s"}`)}</small></span>` +
      `<span class="v">${t.pts}${L("점", " pts")}</span></li>`;
  }).join("") + `</ol>`;
}

/* ---------- Confetti for the winner ---------- */
export function confetti() {
  if (document.documentElement.dataset.motion === "calm" || matchMedia("(prefers-reduced-motion:reduce)").matches) return;
  const box = el("div", "confetti");
  const colors = ["#f5dc94", "#e0794a", "#5cc489", "#4f8fd9", "#e0609a", "#ffffff", "#9b6be0"];
  for (let i = 0; i < 90; i++) {
    const p = el("i");
    p.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % colors.length]};--d:${(1.8 + Math.random() * 1.6).toFixed(2)}s;` +
      `--w:${(Math.random() * 1.2).toFixed(2)}s;--x:${Math.round(Math.random() * 160 - 80)}px;--r:${Math.round(Math.random() * 720 - 360)}deg;` +
      `width:${5 + Math.round(Math.random() * 5)}px;height:${8 + Math.round(Math.random() * 8)}px`;
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 4200);
}

/* ---------- My record on this device ---------- */
export function recordGame(gameId, runId, rank, n) {
  const st = LS.json("stats", { games: {}, seen: [] });
  if (!runId || st.seen.includes(runId)) return;
  st.seen = [...st.seen, runId].slice(-50);
  const g = st.games[gameId] || (st.games[gameId] = { played: 0, wins: 0, top3: 0 });
  g.played++;
  if (rank === 1) g.wins++;
  if (rank && rank <= Math.min(3, n - 1)) g.top3++;
  g.last = Date.now();
  LS.put("stats", st);
}
export function statsModal(games) {
  modal((box, close) => {
    head(box, L("이 기기 기록", "On this device"), L("내 전적", "My record"), "");
    const st = LS.json("stats", { games: {}, seen: [] });
    let total = 0, wins = 0, h = "";
    for (const g of games) {
      const s = st.games[g.id];
      if (!s) continue;
      total += s.played; wins += s.wins;
      h += `<tr><td>${g.engine.icon} ${esc(loc(g.engine.name))}</td><td>${s.played}</td><td>${s.wins}</td><td>${Math.round(100 * s.wins / s.played)}%</td></tr>`;
    }
    if (!total) box.appendChild(el("p", "", esc(L("아직 끝낸 게임이 없습니다. 한 판 해 보세요!", "No finished games yet. Go play one!"))));
    else {
      box.appendChild(el("div", "stat-big", `<div><b>${total}</b><small>${L("판", "games")}</small></div><div><b>${wins}</b><small>${L("1등", "wins")}</small></div>` +
        `<div><b>${Math.round(100 * wins / total)}%</b><small>${L("1등 비율", "win rate")}</small></div>`));
      box.appendChild(el("table", "stats", `<thead><tr><th>${L("게임", "Game")}</th><th>${L("판", "Played")}</th><th>${L("1등", "Wins")}</th><th>%</th></tr></thead><tbody>${h}</tbody>`));
    }
    const btns = [{ label: L("닫기", "Close"), primary: true, on: () => close() }];
    if (total) btns.unshift({ label: L("기록 지우기", "Reset"), danger: true, on: () => { LS.put("stats", { games: {}, seen: st.seen }); close(); toast(L("기록을 지웠습니다", "Record cleared")); } });
    buttonRow(box, btns);
  });
}

/* ---------- Install as an app ---------- */
let deferredInstall = null;
const installListeners = new Set();
export const onInstallChange = f => installListeners.add(f);
const installChanged = () => { for (const f of installListeners) try { f(); } catch (e) { } };
addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstall = e; installChanged(); });
addEventListener("appinstalled", () => { deferredInstall = null; installChanged(); });
const standalone = () => matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
/* "installed" | "ready" (the browser can show its install prompt) | "ios" (Safari: add to home screen by hand) | "none" */
export function installState() {
  if (standalone()) return "installed";
  if (deferredInstall) return "ready";
  if (isIOS()) return "ios";
  return "none";
}
export async function install() {
  if (!deferredInstall) return iosInstallHelp();
  const e = deferredInstall;
  deferredInstall = null;
  try { await e.prompt(); await e.userChoice; } catch (err) { }
  installChanged();
}
export function iosInstallHelp() {
  modal((box, close) => {
    head(box, L("앱으로 설치", "Install as an app"), L("홈 화면에 추가하기", "Add to the home screen"),
      L("<b>사파리</b>에서 아래쪽 <b>공유 버튼</b>(네모에 위쪽 화살표)을 누르고 <b>「홈 화면에 추가」</b>를 고르세요. 앱처럼 전체 화면으로 열립니다.",
        "In <b>Safari</b>, tap the <b>Share button</b> (a square with an arrow) and choose <b>\"Add to Home Screen\"</b>. It then opens full screen like an app."));
    buttonRow(box, [{ label: L("확인", "OK"), primary: true, on: () => close() }]);
  });
}
