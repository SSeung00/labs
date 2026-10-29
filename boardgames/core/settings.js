/* Device settings: look of the app (table theme, card faces and backs, button colour, screen size, motion), sound, and my profile
   (name, avatar emoji / colour, short message). Everything is stored in prefs (localStorage) and applied at once. */
import { el, esc, prefs, savePrefs, sound, modal, head, buttonRow, avatarHTML, AVATAR_COLORS, LOOK_EMOJI, LOOK_MSG_MAX, cleanLook } from "./ui.js";
import { L, lang, setLang } from "./i18n.js";
import { installState, install, iosInstallHelp } from "./social.js";
import { cardHTML } from "./cards.js";
import { dmCardHTML } from "../games/dalmuti/cards.js";
import { hwHTML } from "../games/gostop/cards.js";

/* Card face designs — the games draw every card with the chosen design's class (see core/cards.js and the cards.js of Dalmuti and Go-Stop) */
export const DECK_FACES = {
  deck: {
    ko: "트럼프 (원카드 · 포커 · 도둑잡기)", en: "Playing cards (One Card · Poker · Old Maid)",
    items: { classic: ["클래식", "Classic"], jumbo: ["큰 글자", "Big index"], four: ["4색", "Four colours"], vintage: ["빈티지", "Vintage"],
      neon: ["네온", "Neon"], minimal: ["미니멀", "Minimal"] },
    sample: d => cardHTML("S1", "", d) + cardHTML("D12", "", d)
  },
  dmdeck: {
    ko: "달무티", en: "Dalmuti",
    items: { classic: ["클래식", "Classic"], royal: ["왕실", "Royal"], number: ["숫자 크게", "Big number"], minimal: ["단색", "Flat colour"],
      parchment: ["양피지", "Parchment"] },
    sample: d => dmCardHTML(1, "", d) + dmCardHTML(9, "", d)
  },
  hwdeck: {
    ko: "화투 (고스톱)", en: "Hwatu (Go-Stop)",
    items: { classic: ["클래식", "Classic"], trad: ["전통", "Traditional"], night: ["밤", "Night"], big: ["월 크게", "Big month"], flat: ["단색", "Flat colour"] },
    sample: d => hwHTML("1a", "", d) + hwHTML("6b", "", d)
  }
};
/* The previews need the games' own card styles */
function previewCSS() {
  for (const href of ["games/dalmuti/style.css", "games/gostop/style.css"]) {
    if (document.querySelector(`link[href="${href}"]`)) continue;
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href;
    document.head.appendChild(l);
  }
}
/* Screens that draw cards redraw when a look setting changes (app.js listens) */
const lookListeners = new Set();
export const onLookChange = f => lookListeners.add(f);

/* Table themes: colours of the page, panels, dialogs and the felt */
export const THEMES = {
  felt:   { ko: "초록 펠트", en: "Green felt", v: ["#0f1a15", "#142219", "#1a2a21", "#213429", "#1f6b45", "#174f34", "#0f3523", "#1d3326", "#22362b", "#18271f", "12,20,16"] },
  navy:   { ko: "밤바다", en: "Night sea", v: ["#0c1320", "#101a2b", "#16223a", "#1c2b47", "#285a96", "#1d4475", "#112a4d", "#1a2b48", "#1f2f4d", "#152238", "10,16,28"] },
  wine:   { ko: "와인 바", en: "Wine bar", v: ["#1a0d12", "#22111a", "#2c1720", "#371c28", "#86283c", "#661d2e", "#42111d", "#3a1621", "#3d1d29", "#28121b", "26,12,17"] },
  wood:   { ko: "원목 테이블", en: "Wooden table", v: ["#16100a", "#1e160e", "#281d13", "#322419", "#8a5c34", "#6b4526", "#452b16", "#33251a", "#3a2a1c", "#271c12", "24,17,10"] },
  purple: { ko: "보라 라운지", en: "Purple lounge", v: ["#130e1c", "#1a1327", "#221933", "#2b2041", "#563489", "#422769", "#2a1745", "#2a1d40", "#2f2348", "#201733", "19,14,28"] },
  mono:   { ko: "먹색", en: "Charcoal", v: ["#0e0f10", "#141618", "#1b1e20", "#23272a", "#3a4045", "#2c3135", "#1b1f22", "#23272b", "#262a2e", "#1a1d20", "14,15,16"] }
};
const THEME_VARS = ["--bg", "--bg2", "--panel", "--panel2", "--felt1", "--felt2", "--felt3", "--glow", "--modal1", "--modal2", "--toastrgb"];

/* Card backs (the shared playing cards; Go-Stop keeps its own red hwatu back) */
export const BACKS = {
  wine:  { ko: "와인 줄무늬", en: "Wine stripes", bk: "repeating-linear-gradient(45deg,#7b2f3a 0 5px,#5c2029 5px 10px)", edge: "#e9d7a8", inn: "#4a171f" },
  navy:  { ko: "남색 줄무늬", en: "Navy stripes", bk: "repeating-linear-gradient(45deg,#2f4f8a 0 5px,#203a69 5px 10px)", edge: "#e9d7a8", inn: "#16284a" },
  green: { ko: "초록 줄무늬", en: "Green stripes", bk: "repeating-linear-gradient(45deg,#2f7a52 0 5px,#215c3c 5px 10px)", edge: "#e9d7a8", inn: "#143d27" },
  gold:  { ko: "검정과 금색", en: "Black & gold", bk: "repeating-linear-gradient(45deg,#2a2622 0 5px,#1a1714 5px 10px)", edge: "#d9b25a", inn: "#0d0b09" },
  dots:  { ko: "분홍 물방울", en: "Pink dots", bk: "radial-gradient(circle,#f6cddb 0 1.6px,transparent 2.2px) 0 0/8px 8px,#b8406e", edge: "#fff0f5", inn: "#8a2a50" },
  plaid: { ko: "하늘 체크", en: "Sky plaid", bk: "repeating-linear-gradient(0deg,rgba(255,255,255,.14) 0 3px,transparent 3px 9px),repeating-linear-gradient(90deg,rgba(255,255,255,.14) 0 3px,transparent 3px 9px),#3a6f8f", edge: "#f0e6c8", inn: "#234459" }
};

/* Colour of the main buttons and selected options */
export const ACCENTS = {
  orange: { ko: "주황", en: "Orange", v: ["#e0794a", "#c35c2f"] },
  blue:   { ko: "파랑", en: "Blue", v: ["#4f8fd9", "#2f68b0"] },
  green:  { ko: "초록", en: "Green", v: ["#3fae6e", "#2a8450"] },
  pink:   { ko: "분홍", en: "Pink", v: ["#e0609a", "#b8407a"] },
  purple: { ko: "보라", en: "Purple", v: ["#9b6be0", "#7446b8"] },
  gold:   { ko: "금색", en: "Gold", v: ["#d6a43a", "#a67a18"] }
};

/* Screen size. "auto" enlarges everything on big screens (tablets, unfolded phones, computers) */
export const SCALES = ["auto", 0.9, 1, 1.15, 1.3];
function zoomFor(s) {
  if (s !== "auto") return +s || 1;
  const w = innerWidth, h = innerHeight;
  // the layouts are made for about 430 × 760; only ever enlarge, never shrink
  return Math.round(Math.max(1, Math.min(1.6, w / 430, h / 760)) * 100) / 100;
}

/* Apply every look setting to the page */
export function applyLook() {
  const root = document.documentElement, st = root.style;
  const t = THEMES[prefs.theme] || THEMES.felt;
  THEME_VARS.forEach((k, i) => st.setProperty(k, t.v[i]));
  const b = BACKS[prefs.back] || BACKS.wine;
  st.setProperty("--bk", b.bk); st.setProperty("--bk-edge", b.edge); st.setProperty("--bk-in", b.inn);
  const a = ACCENTS[prefs.accent] || ACCENTS.orange;
  st.setProperty("--accent", a.v[0]); st.setProperty("--accent2", a.v[1]);
  st.setProperty("--zoom", String(zoomFor(prefs.scale)));
  root.dataset.motion = prefs.motion === "calm" ? "calm" : "on";
  for (const k of Object.keys(DECK_FACES)) root.dataset[k] = DECK_FACES[k].items[prefs[k]] ? prefs[k] : "classic";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t.v[0];
}
let resizeT = 0;
addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (prefs.scale === "auto") applyLook(); }, 150); });

/* ---------- Settings dialog ---------- */
function section(box, title) { box.appendChild(el("div", "set-h", esc(title))); }
function swatches(box, items, current, draw, onPick) {
  const row = el("div", "swatches");
  for (const [key, item] of Object.entries(items)) {
    const b = el("button", "swatch", `${draw(item)}<small>${esc(L(item.ko, item.en))}</small>`);
    b.setAttribute("aria-pressed", String(key === current));
    b.onclick = () => { onPick(key); for (const x of row.children) x.setAttribute("aria-pressed", String(x === b)); };
    row.appendChild(b);
  }
  box.appendChild(row);
}
function seg(box, values, current, fmt, onPick) {
  const s = el("div", "seg");
  for (const v of values) {
    const b = el("button", "", esc(fmt(v)));
    b.setAttribute("aria-pressed", String(v === current));
    b.onclick = () => { onPick(v); for (const x of s.children) x.setAttribute("aria-pressed", String(x === b)); };
    s.appendChild(b);
  }
  box.appendChild(s);
}

export function openSettings(onChange = () => { }) {
  previewCSS();
  modal((box, close) => {
    box.classList.add("setmodal");
    head(box, L("설정", "Settings"), L("꾸미기와 소리", "Look & sound"), L("이 기기에만 적용됩니다. 바꾸면 바로 보입니다.", "Applies to this device only. Changes show right away."));
    const set = (k, v) => { prefs[k] = v; savePrefs(); applyLook(); onChange(k); for (const f of lookListeners) try { f(k); } catch (e) { console.error(e); } };

    section(box, L("테이블 테마", "Table theme"));
    swatches(box, THEMES, prefs.theme, t => `<span class="sw-table" style="--a:${t.v[4]};--b:${t.v[6]};--p:${t.v[3]}"></span>`, k => set("theme", k));
    section(box, L("카드 디자인", "Card designs"));
    for (const [k, fam] of Object.entries(DECK_FACES)) {
      box.appendChild(el("div", "set-sub", esc(L(fam.ko, fam.en))));
      const row = el("div", "swatches decks");
      for (const [d, nm] of Object.entries(fam.items)) {
        const b = el("button", "swatch deckpick", `<span class="deck-sample">${fam.sample(d)}</span><small>${esc(L(nm[0], nm[1]))}</small>`);
        b.setAttribute("aria-pressed", String((prefs[k] || "classic") === d));
        b.onclick = () => { set(k, d); for (const x of row.children) x.setAttribute("aria-pressed", String(x === b)); };
        row.appendChild(b);
      }
      box.appendChild(row);
    }
    section(box, L("카드 뒷면", "Card back"));
    swatches(box, BACKS, prefs.back, b => `<span class="sw-back" style="background:${b.bk};border-color:${b.edge};box-shadow:inset 0 0 0 1.5px ${b.inn}"></span>`, k => set("back", k));
    section(box, L("버튼 색", "Button colour"));
    swatches(box, ACCENTS, prefs.accent, a => `<span class="sw-dot" style="background:linear-gradient(180deg,${a.v[0]},${a.v[1]})"></span>`, k => set("accent", k));

    section(box, L("화면 크기", "Screen size"));
    seg(box, SCALES, prefs.scale, v => v === "auto" ? L("자동", "Auto") : Math.round(v * 100) + "%", v => set("scale", v));
    box.appendChild(el("small", "set-note", esc(L("자동: 태블릿·펼친 폴드·컴퓨터처럼 큰 화면에서 카드와 글자를 키웁니다.", "Auto: bigger cards and text on large screens (tablets, unfolded phones, computers)."))));
    section(box, L("움직임", "Motion"));
    seg(box, ["on", "calm"], prefs.motion === "calm" ? "calm" : "on", v => v === "on" ? L("켜기", "On") : L("줄이기", "Reduced"), v => set("motion", v));
    section(box, L("소리 · 진동", "Sound · vibration"));
    const sv = el("div", "set-two");
    box.appendChild(sv);
    seg(sv, [true, false], !!prefs.sound, v => v ? L("소리 켜기", "Sound on") : L("소리 끄기", "Sound off"), v => { set("sound", v); if (v) sound.join(); });
    seg(sv, [true, false], !!prefs.vibe, v => v ? L("진동 켜기", "Vibrate on") : L("진동 끄기", "Vibrate off"), v => { set("vibe", v); if (v && navigator.vibrate) navigator.vibrate(40); });
    section(box, L("언어", "Language"));
    seg(box, ["ko", "en"], lang, v => v === "ko" ? "한국어" : "English", v => { close(); setLang(v); });

    // App: install, full screen
    const app = el("div", "set-app");
    const inst = installState();
    if (inst !== "installed") {
      const b = el("button", "btn small", L("📲 앱으로 설치", "📲 Install as an app"));
      b.onclick = () => (inst === "ready" ? install() : iosInstallHelp());
      if (inst === "ready" || inst === "ios") app.appendChild(b);
    }
    if (document.fullscreenEnabled && inst !== "installed") {
      const b = el("button", "btn small", document.fullscreenElement ? L("전체 화면 끄기", "Exit full screen") : L("⛶ 전체 화면", "⛶ Full screen"));
      b.onclick = () => { close(); (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => { }); };
      app.appendChild(b);
    }
    if (app.children.length) { section(box, L("앱", "App")); box.appendChild(app); }
    buttonRow(box, [{ label: L("완료", "Done"), primary: true, on: () => close() }]);
  });
}

/* ---------- My profile: name, avatar, short message ----------
   onSave(name, look) is called with the cleaned values. */
export function openProfile(onSave, opt = {}) {
  let look = { e: "", c: "", m: "", ...(prefs.look || {}) };
  modal((box, close) => {
    box.classList.add("profmodal");
    head(box, L("내 프로필", "My profile"), L("이름과 얼굴 꾸미기", "Name and avatar"),
      L("다른 사람에게 이렇게 보입니다. 이 기기에 저장되어 다음 방에서도 그대로 쓰입니다.", "This is how others see you. Saved on this device for the next rooms too."));
    const prev = el("div", "prof-prev");
    box.appendChild(prev);
    const nameIn = el("input", "inp");
    nameIn.maxLength = 10; nameIn.value = opt.name !== undefined ? opt.name : prefs.name; nameIn.placeholder = L("다른 사람에게 보일 이름", "Name others will see");
    nameIn.setAttribute("aria-label", L("이름", "Name"));
    const msgIn = el("input", "inp");
    msgIn.maxLength = LOOK_MSG_MAX; msgIn.value = look.m || ""; msgIn.placeholder = L("한마디 (예: 오늘은 내가 이긴다!)", "A short line (e.g. Feeling lucky!)");
    msgIn.setAttribute("aria-label", L("한마디", "Short message"));
    const draw = () => {
      const lk = cleanLook(look);
      prev.innerHTML = `${avatarHTML(nameIn.value || "?", opt.seat || 0, "xl", lk)}<div><b>${esc(nameIn.value || L("이름 없음", "No name"))}</b>` +
        `${lk && lk.m ? `<small>“${esc(lk.m)}”</small>` : ""}</div>`;
    };
    nameIn.oninput = draw; msgIn.oninput = () => { look.m = msgIn.value; draw(); };
    box.appendChild(el("div", "set-h", esc(L("이름", "Name"))));
    box.appendChild(nameIn);

    box.appendChild(el("div", "set-h", esc(L("얼굴", "Face"))));
    const faces = el("div", "faces");
    const faceBtn = (e, label) => {
      const b = el("button", "face", label);
      b.setAttribute("aria-pressed", String((look.e || "") === e));
      b.onclick = () => { look.e = e; for (const x of faces.children) x.setAttribute("aria-pressed", String(x === b)); draw(); };
      faces.appendChild(b);
    };
    faceBtn("", `<span class="face-letter">${esc(L("가", "A"))}</span>`);
    for (const e of LOOK_EMOJI) faceBtn(e, e);
    box.appendChild(faces);

    box.appendChild(el("div", "set-h", esc(L("색", "Colour"))));
    const cols = el("div", "colors");
    const colBtn = (c) => {
      const b = el("button", "colorbtn" + (c ? "" : " auto"), c ? "" : esc(L("자동", "Auto")));
      if (c) b.style.background = c;
      b.setAttribute("aria-label", c || L("자리 색", "Seat colour"));
      b.setAttribute("aria-pressed", String((look.c || "") === c));
      b.onclick = () => { look.c = c; for (const x of cols.children) x.setAttribute("aria-pressed", String(x === b)); draw(); };
      cols.appendChild(b);
    };
    colBtn("");
    for (const c of AVATAR_COLORS) colBtn(c);
    box.appendChild(cols);

    box.appendChild(el("div", "set-h", esc(L("한마디", "Short message"))));
    box.appendChild(msgIn);
    draw();
    const err = el("div", "err");
    box.appendChild(err);
    buttonRow(box, [{ label: L("취소", "Cancel"), on: () => close() },
      { label: L("저장", "Save"), primary: true, on: () => {
        const name = nameIn.value.replace(/\s+/g, " ").trim().slice(0, 10);
        if (!name) { err.textContent = L("이름을 적어 주세요.", "Enter a name."); nameIn.focus(); return; }
        const lk = cleanLook(look);
        prefs.name = name; prefs.look = lk; savePrefs();
        close();
        onSave(name, lk);
      } }]);
  });
}

export const myLookAvatar = (extra = "") => avatarHTML(prefs.name || "?", 0, extra, cleanLook(prefs.look));
