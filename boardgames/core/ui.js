/* Shared UI parts — storage, sound, vibration, toasts, modals. Game UI modules receive these through ctx. */
import { L } from "./i18n.js";

export const $ = id => document.getElementById(id);
export function el(tag, cls, html) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (html !== undefined) d.innerHTML = html;
  return d;
}
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Storage ---------- */
export const LS = {
  get(k) { try { return localStorage.getItem("bg." + k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem("bg." + k, v); } catch (e) { } },
  json(k, d) { try { const v = LS.get(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  put(k, v) { LS.set(k, JSON.stringify(v)); }
};

/* look: my avatar {e: emoji, c: color, m: short message} (null = initial letter); theme · back · accent · scale · motion: see core/settings.js */
export const prefs = (() => {
  const saved = LS.json("prefs", {});
  if (saved.vibe === undefined && saved.sound === false) saved.vibe = false;   // the sound switch used to mute vibration too
  return Object.assign({ name: "", sound: true, vibe: true, look: null, theme: "felt", back: "wine", accent: "orange", scale: "auto", motion: "on",
    deck: "classic", dmdeck: "classic", hwdeck: "classic" }, saved);
})();
export const savePrefs = () => LS.put("prefs", prefs);

/* ---------- Sound (synthesized effects) ---------- */
let actx = null, noiseBuf = null;
function ac() {
  if (!prefs.sound) return null;
  if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; try { actx = new AC(); } catch (e) { return null; } }
  if (actx.state === "suspended") { try { actx.resume(); } catch (e) { } }
  return actx;
}
function tone(f, dur, o = {}) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + (o.delay || 0), osc = c.createOscillator(), g = c.createGain();
  osc.type = o.type || "sine"; osc.frequency.setValueAtTime(f, t);
  if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(50, f + o.slide), t + dur);
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(o.gain || .1, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  osc.connect(g).connect(c.destination); osc.start(t); osc.stop(t + dur + .03);
}
function hit(dur, o = {}) {
  const c = ac(); if (!c) return;
  if (!noiseBuf) { noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * .4), c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const t = c.currentTime + (o.delay || 0), s = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
  s.buffer = noiseBuf; bp.type = "bandpass"; bp.frequency.value = o.f || 1600; bp.Q.value = o.q || 1;
  g.gain.setValueAtTime(o.gain || .14, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  s.connect(bp).connect(g).connect(c.destination); s.start(t); s.stop(t + dur + .03);
}
/* A worker timer: keeps ticking even when browsers throttle hidden tabs (the host's game clock, heartbeats). */
export const steadySleep = (() => {
  try {
    const src = "onmessage = e => setTimeout(() => postMessage(e.data), e.data.ms);";
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    const waits = new Map();
    let n = 0;
    w.onmessage = e => { const f = waits.get(e.data.id); if (f) { waits.delete(e.data.id); f(); } };
    return ms => new Promise(r => { const id = ++n; waits.set(id, r); w.postMessage({ id, ms }); });
  } catch (e) { return ms => new Promise(r => setTimeout(r, ms)); }
})();

export const sound = {
  wake() { ac(); },
  deal() { hit(.05, { f: 2400, q: 1.5, gain: .08 }); },
  place() { hit(.07, { f: 1500, q: .9, gain: .15 }); tone(150, .10, { type: "triangle", gain: .09 }); },
  flip() { hit(.06, { f: 3000, q: 1.2, gain: .09 }); },
  pass() { tone(250, .14, { gain: .06, slide: -70 }); },
  chip() { hit(.04, { f: 4200, q: 3, gain: .1 }); hit(.04, { f: 3600, q: 3, gain: .07, delay: .05 }); },
  turn() { tone(659, .14, { gain: .08 }); tone(880, .2, { gain: .06, delay: .1 }); },
  tick() { tone(1200, .05, { gain: .04 }); },
  good() { [659, 784].forEach((f, i) => tone(f, .22, { type: "triangle", gain: .08, delay: i * .09 })); },
  bad() { tone(220, .25, { type: "triangle", gain: .08, slide: -60 }); },
  join() { tone(523, .12, { gain: .06 }); tone(784, .16, { gain: .05, delay: .08 }); },
  pop() { tone(880, .07, { gain: .05, slide: 300 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, .34, { type: "triangle", gain: .1, delay: i * .12 })); },
  lose() { [440, 370, 311].forEach((f, i) => tone(f, .34, { type: "triangle", gain: .07, delay: i * .14 })); }
};
export const buzz = pattern => { try { if (prefs.vibe && navigator.vibrate) navigator.vibrate(pattern); } catch (e) { } };

/* ---------- Flying cards ----------
   fly(from, to): a copy of `to` (or of opt.html) starts over `from` — a player's seat, my hand — and lands on `to`, which stays
   hidden until it arrives. Use it after the screen is redrawn, e.g. from a player's name chip to the card now on the table.
   from may also be a DOMRect saved before the redraw (e.g. the card I tapped in my hand, which the redraw removed).
   opt: {html, ms, delay, scale (start size, default from the two boxes), spin (deg)}. Skipped with reduced motion. */
const calm = () => document.documentElement.dataset.motion === "calm" || matchMedia("(prefers-reduced-motion:reduce)").matches;
export function fly(from, to, opt = {}) {
  if (!from || !to || calm() || !to.isConnected || document.hidden) return null;   // hidden tabs don't animate: copies would pile up
  const a = from.getBoundingClientRect ? from.getBoundingClientRect() : from, b = to.getBoundingClientRect();
  if (!a.width || !b.width) return null;
  const z = parseFloat(getComputedStyle(document.body).zoom) || 1;      // the page may be zoomed (screen size setting)
  let ghost;
  if (opt.html) { const t = document.createElement("template"); t.innerHTML = opt.html.trim(); ghost = t.content.firstChild; }
  else ghost = to.cloneNode(true);
  ghost.classList.add("flyer");
  // the copy lives in <body>, outside the game's own CSS: take the card's sizes along
  const cs = getComputedStyle(to);
  for (const v of ["--cw", "--ch", "--hw", "--fs"]) { const x = cs.getPropertyValue(v).trim(); if (x) ghost.style.setProperty(v, x); }
  ghost.style.fontSize = cs.fontSize;
  Object.assign(ghost.style, { position: "fixed", left: b.left / z + "px", top: b.top / z + "px", width: b.width / z + "px", height: b.height / z + "px",
    margin: "0", zIndex: "160", pointerEvents: "none", transition: "none" });
  document.body.appendChild(ghost);
  to.style.visibility = "hidden";
  const dx = (a.left + a.width / 2 - b.left - b.width / 2) / z, dy = (a.top + a.height / 2 - b.top - b.height / 2) / z;
  const sc = opt.scale !== undefined ? opt.scale : Math.max(.25, Math.min(1, Math.min(a.width / b.width, a.height / b.height)));
  const anim = ghost.animate([
    { transform: `translate(${dx}px,${dy}px) scale(${sc}) rotate(${opt.spin || 0}deg)`, opacity: .85 },
    { transform: "none", opacity: 1 }
  ], { duration: opt.ms || 420, delay: opt.delay || 0, easing: "cubic-bezier(.2,.75,.25,1)", fill: "backwards" });
  let over = false;
  const done = () => { if (over) return; over = true; ghost.remove(); to.style.visibility = ""; };
  anim.onfinish = done; anim.oncancel = done;
  setTimeout(done, (opt.ms || 420) + (opt.delay || 0) + 150);     // in case the animation never runs (tab in the background)
  return anim;
}

/* ---------- Toasts ---------- */
let toastT = 0;
export function toast(text, ms = 2600) {
  const t = $("toast");
  t.classList.remove("sticky");
  t.textContent = text; t.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => { if (!t.classList.contains("sticky")) t.classList.remove("on"); }, ms);
}
export function stickyToast(text) {
  const t = $("toast");
  if (text) { t.textContent = text; t.classList.add("on", "sticky"); }
  else if (t.classList.contains("sticky")) t.classList.remove("on", "sticky");
}

/* ---------- Modals ----------
   modal((box, close) => { ... }, {dismissible}) — closing with close(value) resolves the promise with value */
const stack = [];
export function modal(build, opt = {}) {
  return new Promise(resolve => {
    const scrim = el("div", "scrim"), box = el("div", "modal");
    scrim.appendChild(box);
    $("modalHost").appendChild(scrim);
    const entry = { dismissible: opt.dismissible !== false, close };
    function close(v) {
      const i = stack.indexOf(entry); if (i < 0) return;
      stack.splice(i, 1); scrim.remove(); resolve(v);
    }
    stack.push(entry);
    if (entry.dismissible) {
      scrim.addEventListener("click", e => { if (e.target === scrim) close(null); });
      const x = el("button", "mclose", "✕"); x.setAttribute("aria-label", L("닫기", "Close")); x.onclick = () => close(null);
      box.appendChild(x);
    }
    build(box, close);
  });
}
export const topModal = () => stack[stack.length - 1];
export function closeAllModals() { while (stack.length) stack[stack.length - 1].close(null); }
export function head(box, eyebrow, title, text) {
  box.insertAdjacentHTML("beforeend", `${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ""}<h2>${title}</h2>${text ? `<p>${text}</p>` : ""}`);
}
export function buttonRow(box, buttons) {
  const row = el("div", "row");
  for (const b of buttons) {
    const x = el("button", "btn" + (b.primary ? " primary" : "") + (b.danger ? " danger" : ""), b.label);
    x.onclick = b.on; if (b.disabled) x.disabled = true;
    row.appendChild(x);
  }
  box.appendChild(row);
  return row;
}
/* Pick one: options [{value, label, note?}] → value */
export function choose(title, text, options, opt = {}) {
  return modal((box, close) => {
    head(box, opt.eyebrow || "", title, text);
    const list = el("div", "choices");
    for (const o of options) {
      const b = el("button", "choice", `<b>${o.label}</b>${o.note ? `<small>${o.note}</small>` : ""}`);
      b.onclick = () => close(o.value);
      list.appendChild(b);
    }
    box.appendChild(list);
  }, { dismissible: opt.dismissible !== false });
}

/* ---------- Avatars ----------
   People can pick an emoji and a colour (prefs.look); AI seats show their animal. Without a look, the first letter of the name
   on the seat colour. Games call avatarHTML(name, seat) — the looks of the current room are looked up by name. */
export const AVATAR_COLORS = ["#c9774a", "#5f9e6e", "#5b84c4", "#b05f9a", "#c4a24a", "#4aa3a8", "#8a6fc4", "#c45b5b", "#7a8a5a", "#a87a4a"];
export const LOOK_EMOJI = ["😀", "😎", "🤠", "🥳", "🤓", "😇", "🤩", "😴", "🤔", "😈", "👻", "🤖", "👽", "🎃", "🥷", "🧙",
  "🦁", "🐯", "🐻", "🐨", "🐶", "🐸", "🐵", "🐷", "🐮", "🦄", "🐲", "🐙", "🐳", "🦋", "🍀", "🌸", "⭐", "🔥", "⚡", "🍕", "🍩", "🎸", "⚽", "👑"];
export const LOOK_MSG_MAX = 20;
/* AI seat animals (Korean and English names, see AI_NAMES in host.js) */
const AI_FACE = { 다람쥐: "🐿️", Squirrel: "🐿️", 너구리: "🦝", Raccoon: "🦝", 부엉이: "🦉", Owl: "🦉", 고양이: "🐱", Cat: "🐱",
  여우: "🦊", Fox: "🦊", 판다: "🐼", Panda: "🐼", 수달: "🦦", Otter: "🦦", 펭귄: "🐧", Penguin: "🐧", 고슴도치: "🦔", Hedgehog: "🦔", 토끼: "🐰", Rabbit: "🐰" };
/* A look as sent by someone else: keep only known values */
export function cleanLook(x) {
  if (!x || typeof x !== "object") return null;
  const e = LOOK_EMOJI.includes(x.e) ? x.e : "", c = AVATAR_COLORS.includes(x.c) ? x.c : "";
  const m = String(x.m || "").replace(/\s+/g, " ").trim().slice(0, LOOK_MSG_MAX);
  return e || c || m ? { e, c, m } : null;
}
const looks = new Map();
/* players: [{name, kind, look}] as shown on this screen */
export function setLooks(players) {
  looks.clear();
  for (const p of players || []) {
    if (p.kind === "ai" && AI_FACE[p.name]) looks.set(p.name, { e: AI_FACE[p.name] });
    else if (p.look) looks.set(p.name, p.look);
  }
}
export const avatarColor = p => AVATAR_COLORS[p % AVATAR_COLORS.length];
export function avatarHTML(name, p, extra = "", look) {
  const lk = look !== undefined ? look : looks.get(name);
  const color = (lk && lk.c) || avatarColor(p);
  if (lk && lk.e) return `<span class="av emo ${extra}" style="--ac:${color}"><i>${lk.e}</i></span>`;
  return `<span class="av ${extra}" style="--ac:${color}">${esc([...String(name || "?")][0] || "?")}</span>`;
}
