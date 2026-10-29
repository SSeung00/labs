/* Yacht Dice screen
   Portrait: players strip (totals, ranks, last move) · score sheet · dock (summary · hint · five dice · roll / confirm)
   Landscape: players and dice on the left, the sheet on the right.
   The sheet shows every player as a column when they fit (otherwise me, the player rolling and the leaders); empty cells of the
   player rolling show what the current dice would score, the suggested category gets a ★. On short screens the sheet splits
   into two halves (upper | lower) side by side; on tall ones it is one column. Tap a player for their full sheet. */
import { L } from "../../core/i18n.js";
import { CATS, CAT_NAME, ROUNDS, BONUS_AT, BONUS, scoreDice, tally, evaluator, stateOf } from "./engine.js";

const LAND_Q = "(orientation: landscape) and (min-aspect-ratio: 4/3)";
const PIPS = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const BEST_KEY = "bg.yacht.best";
const NONE = [false, false, false, false, false];
let kept = null;            // my dice holds survive a remount (language switch): {key, hold}

/* A die face drawn with CSS (size from --ds on an ancestor). f = 0: blank */
export const faceHTML = (f, cls = "") =>
  `<span class="yt-face f${f} ${cls}">${(PIPS[f] || []).map(i => `<i style="grid-area:${1 + Math.floor(i / 3)}/${1 + i % 3}"></i>`).join("")}</span>`;

const catName = c => L(CAT_NAME[c].ko, CAT_NAME[c].en);
const catShort = c => L(CAT_NAME[c].ko, ["Aces", "Twos", "Threes", "Fours", "Fives", "Sixes", "Choice", "4 of a Kind", "Full House", "S. Straight", "L. Straight", "Yacht"][c]);
const catSub = c => c < 6 ? L(`${c + 1} 눈의 합`, `Sum of ${c + 1}s`)
  : [L("5개의 합", "Sum of all"), L("4개 같음 → 합", "4 alike → sum"), L("3개+2개 → 합", "3 + 2 → sum"),
    L("4개 연속 → 15", "4 in a row → 15"), L("5개 연속 → 30", "5 in a row → 30"), L("5개 같음 → 50", "5 alike → 50")][c - 6];
const ordEn = n => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
const rankText = r => L(`${r}등`, ordEn(r));
const calm = () => document.documentElement.dataset.motion === "calm" || matchMedia("(prefers-reduced-motion:reduce)").matches;
function readBest() { try { const x = parseInt(localStorage.getItem(BEST_KEY), 10); return x > 0 ? x : 0; } catch (e) { return 0; } }
function saveBest(x) { try { localStorage.setItem(BEST_KEY, String(x)); } catch (e) { } }

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "yt");
  wrap.innerHTML = `
    <div class="yt-strip" data-r="strip"></div>
    <div class="yt-sheet" data-r="sheet"></div>
    <div class="dock yt-dock" data-r="dock">
      <div class="yt-info" data-r="info"></div>
      <div class="hint yt-hint" data-r="hint"></div>
      <div class="yt-tray" data-r="tray"></div>
      <div class="actions yt-acts" data-r="acts"></div>
    </div>
    <div class="yt-banner" data-r="banner" hidden></div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);
  const landMQ = typeof matchMedia === "function" ? matchMedia(LAND_Q) : { matches: false };

  let M = null, logEv = null;
  let hold = NONE.slice(), turnKey = "", sel = -1, sent = 0, sentT = 0;
  let tumbleT = 0, tumbleEnd = 0, tumbleFinal = null, tumbleMask = null;
  let shown = [0, 0, 0, 0, 0];             // faces on screen right now
  let bannerT = 0, best = readBest(), bestDone = false, newBest = false;
  let sheetBox = null;                      // the open "full sheet" modal: {p, box, close}
  let mode = "two", layoutKey = "";

  // Five dice, built once — the tumble animation changes them in place
  const tray = R("tray");
  const dice = [0, 1, 2, 3, 4].map(i => {
    const b = el("button", "yt-die", `${faceHTML(0)}<em class="yt-tag">${L("고정", "HOLD")}</em>`);
    b.dataset.i = i;
    b.onclick = () => toggleHold(i);
    tray.appendChild(b);
    return b;
  });
  const setFace = (b, f) => { b.firstElementChild.outerHTML = faceHTML(f); };

  const V = () => M.v;
  const nm = p => (M.players[p] ? M.players[p].name : "?");
  const myTurn = () => !!(M && !ctx.replay && ctx.myAsk() && V().turn === M.me);
  const rolling = () => tumbleT !== 0;
  const tallies = () => V().sheets.map(tally);
  function ranks(T) { return T.map(t => 1 + T.filter(o => o.total > t.total).length); }
  /* Whose sheet the summary talks about: me, or (spectators) the player rolling */
  const focus = () => (M.me >= 0 ? M.me : V().turn >= 0 ? V().turn : 0);

  /* Potential scores and the suggestion for the player rolling now */
  function live() {
    const v = V();
    if (v.phase !== "play" || !v.dice || rolling()) return null;   // not while the dice are still tumbling
    const sheet = v.sheets[v.turn], s = stateOf(v.dice), E = evaluator(sheet);
    const pot = CATS.map((_, c) => (sheet[c] === null ? scoreDice(c, v.dice) : null));
    let bestC = -1, bv = -Infinity, hiC = -1, hv = -1;
    for (const c of E.open) {
      const x = E.value(c, s);
      if (x > bv) { bv = x; bestC = c; }
      if (pot[c] > hv) { hv = pot[c]; hiC = c; }
    }
    return { p: v.turn, pot, best: bestC, hi: hv > 0 ? hiC : -1 };
  }

  /* ---------- Players strip ---------- */
  function strip() {
    const v = V(), T = tallies(), rk = ranks(T), box = R("strip");
    const over = v.phase === "over";
    let h = "";
    for (let p = 0; p < v.n; p++) {
      const pl = M.players[p] || { name: "?" }, t = T[p], last = v.last[p];
      const cls = ["yt-pl"];
      if (p === v.turn) cls.push("turn");
      if (p === M.me) cls.push("me");
      const tag = pl.kind === "ai" ? '<span class="yt-ai">AI</span>' : pl.kind === "away" ? `<span class="yt-ai away">${L("비움", "away")}</span>` : "";
      // What they did last: points of their last category (the sheet marks which one), or the dice while rolling
      const lastTxt = p === v.turn && v.rolls ? `🎲${v.rolls}` : last ? (last.pts ? "+" + last.pts : "±0") : "";
      const showRank = v.n > 1 && (over || v.turnNo >= v.n);
      const title = last ? `${catName(last.cat)} ${last.pts}` : "";
      h += `<button class="${cls.join(" ")}" data-p="${p}" title="${esc(title)}" aria-label="${esc(L(`${pl.name} 점수표 보기`, `${pl.name}'s score sheet`))}">` +
        `${showRank ? `<i class="yt-rk r${rk[p]}">${rk[p]}</i>` : ""}${tag}${avatarHTML(pl.name, p, "sm")}` +
        `<span class="yt-pi"><span class="yt-pn">${esc(pl.name)}${p === M.me ? `<i class="yt-me">${L("나", "me")}</i>` : ""}</span>` +
        `<span class="yt-pu">${t.bonus ? L(`보너스 +${BONUS} ✓`, `Bonus +${BONUS} ✓`) : L(`상단 ${t.upper}/${BONUS_AT}`, `Upper ${t.upper}/${BONUS_AT}`) + (t.canBonus ? "" : " ✗")}</span>` +
        `<span class="yt-ps"><b data-pt="${p}">${t.total}</b></span></span>` +
        (lastTxt ? `<small class="yt-lb${v.prev && v.prev.p === p ? " now" : ""}${p === v.turn && v.rolls ? " roll" : ""}">${lastTxt}</small>` : "") + "</button>";
    }
    if (v.n === 1 && M.me === 0 && !ctx.replay) {
      h += `<div class="yt-pl yt-best">🏆<span class="yt-pi"><span class="yt-pn">${L("최고 기록", "Best")}</span>` +
        `<span class="yt-ps"><b>${best || "—"}</b></span></span>${newBest ? `<small class="yt-lb now">${L("새 기록!", "New!")}</small>` : ""}</div>`;
    }
    box.innerHTML = h;
    // Sideways with room to spare (tablets, computers, TVs): a leaderboard-like column of players
    const list = isLand() && wrap.clientHeight - (M.me < 0 ? 200 : 260) >= (v.n + (v.n === 1 ? 1 : 0)) * 50 + 16;
    box.classList.toggle("list", list);
    // Sideways without room for the list, the chips wrap onto rows of ≥ 64px
    const cnt = v.n + (v.n === 1 ? 1 : 0), bw = box.clientWidth || 360;
    const per = bw / (isLand() && !list ? Math.max(1, Math.min(cnt, Math.floor(bw / 64))) : cnt);
    box.classList.toggle("many", !list && (v.n >= 5 || per < 84));
    box.classList.toggle("lots", v.n >= 7);
  }

  /* ---------- Score sheet ---------- */
  function pickCols(max) {
    const v = V(), all = [...Array(v.n).keys()];
    if (v.n <= max) return all;
    const T = tallies(), want = [];
    const add = q => { if (q !== null && q !== undefined && q >= 0 && q < v.n && !want.includes(q) && want.length < max) want.push(q); };
    add(M.me); add(v.turn); if (v.prev) add(v.prev.p);
    all.slice().sort((a, b) => T[b].total - T[a].total).forEach(add);
    return want.sort((a, b) => a - b);
  }
  function cellHTML(q, c, lv) {
    const v = V(), val = v.sheets[q][c], cls = ["yt-c"];
    if (q === v.turn) cls.push("cur");
    let inner = "";
    if (val !== null) {
      cls.push("done");
      if (!val) cls.push("zero");
      if (v.prev && v.prev.p === q && v.prev.cat === c) cls.push("just");
      inner = String(val);
    } else if (lv && lv.p === q) {
      const x = lv.pot[c];
      cls.push("pot");
      if (!x) cls.push("zero");
      if (c === lv.best) cls.push("best");
      else if (c === lv.hi) cls.push("hi");
      inner = (c === lv.best ? "<i>★</i>" : "") + x;
    }
    return `<span class="${cls.join(" ")}" data-p="${q}" data-c="${c}">${inner}</span>`;
  }
  function headRow(cols, label) {
    const v = V();
    return `<div class="yt-row yt-hd"><span class="yt-lab">${label}</span>` + cols.map(q =>
      `<span class="yt-c${q === v.turn ? " cur" : ""}${q === M.me ? " me" : ""}" data-hp="${q}">${avatarHTML(nm(q), q, "sm")}<em>${esc(nm(q))}</em></span>`).join("") + "</div>";
  }
  function catRow(c, cols, lv, can) {
    const v = V(), mine = can && v.sheets[M.me][c] === null;
    const cls = ["yt-row", "yt-cat", c < 6 ? "up" : "lo"];
    if (mine) cls.push("can");
    if (mine && sel === c) cls.push("sel");
    if (lv && lv.best === c && v.sheets[lv.p][c] === null) cls.push("rbest");
    const icon = c < 6 ? `<span class="yt-mini">${faceHTML(c + 1)}</span>` : "";
    return `<div class="${cls.join(" ")}" data-c="${c}"${mine ? ` role="button" tabindex="0" aria-label="${esc(catName(c))}"` : ""}>` +
      `<span class="yt-lab">${icon}<span class="yt-ln"><b>${esc(catShort(c))}</b><small>${esc(catSub(c))}</small></span></span>` +
      cols.map(q => cellHTML(q, c, lv)).join("") + "</div>";
  }
  function bonusRow(cols) {
    const v = V();
    return `<div class="yt-row yt-ft yt-bon"><span class="yt-lab"><span class="yt-ln"><b>${L("보너스", "Bonus")}</b><small>${BONUS_AT}↑ +${BONUS}</small></span></span>` +
      cols.map(q => {
        const t = tally(v.sheets[q]), cur = q === v.turn ? " cur" : "";
        if (t.bonus) return `<span class="yt-c${cur} ok">+${BONUS}</span>`;
        const pc = Math.min(100, Math.round(100 * t.upper / BONUS_AT));
        return `<span class="yt-c${cur}${t.canBonus ? "" : " no"}"><span class="yt-bn">${t.upper}<small>/${BONUS_AT}</small></span>` +
          `<span class="yt-bar"><i style="width:${pc}%"></i></span></span>`;
      }).join("") + "</div>";
  }
  function totalRow(cols) {
    const v = V(), T = tallies(), rk = ranks(T);
    return `<div class="yt-row yt-ft yt-tot"><span class="yt-lab"><span class="yt-ln"><b>${L("합계", "Total")}</b></span></span>` +
      cols.map(q => `<span class="yt-c${q === v.turn ? " cur" : ""}${v.n > 1 && rk[q] === 1 && T[q].total > 0 ? " lead" : ""}" data-tot="${q}">${T[q].total}</span>`).join("") + "</div>";
  }
  function sheet() {
    const v = V(), box = R("sheet"), lv = live();
    const can = myTurn() && v.rolls > 0 && !sent;
    // Width of one half (minus padding and borders); the label column takes what the player columns leave, up to its preferred size
    const W = (box.clientWidth || 340) - 12, gap = mode === "two" ? 6 : 0;
    const hw = (mode === "two" ? (W - gap) / 2 : W) - 2;
    const minCol = mode === "two" ? 25 : 34, lwMin = 62;
    const lwPref = Math.max(lwMin, Math.min(mode === "two" ? hw * .5 : hw * .4, hw - V().n * 36, 190));   // columns get ≥ 36px when possible
    const cols = pickCols(Math.max(1, Math.floor((hw - lwMin) / minCol)));
    const lw = Math.round(Math.max(lwMin, Math.min(lwPref, hw - cols.length * minCol)));
    const colW = (hw - lw) / cols.length;
    box.className = `yt-sheet ${mode}${lw >= 118 ? " wide" : ""}${colW >= 56 ? " roomy" : ""}${colW < 46 ? " narrow" : ""}${colW < 36 ? " tight" : ""}${can ? " active" : ""}`;
    box.style.setProperty("--lw", lw + "px");
    box.style.setProperty("--lf", Math.max(10.5, Math.min(16, lw / 6.1)).toFixed(1) + "px");
    // Numbers: as big as the row allows, but two digits (totals: three) must fit the column
    const rh = parseFloat(box.style.getPropertyValue("--rh")) || 44;
    box.style.setProperty("--cf", Math.max(11, Math.min(23, rh * .42, colW * .58)).toFixed(1) + "px");
    box.style.setProperty("--tf", Math.max(11, Math.min(26, rh * .46, (colW - 4) / 1.85)).toFixed(1) + "px");
    box.style.setProperty("--nc", cols.length);
    const roundLab = v.phase === "over" ? L("최종", "Final") : lw < 96 ? `${v.round}/${ROUNDS}` : L(`${v.round}/${ROUNDS} 라운드`, `Round ${v.round}/${ROUNDS}`);
    const up = [0, 1, 2, 3, 4, 5].map(c => catRow(c, cols, lv, can)).join("");
    const lo = [6, 7, 8, 9, 10, 11].map(c => catRow(c, cols, lv, can)).join("");
    if (mode === "two")
      box.innerHTML = `<div class="yt-half">${headRow(cols, roundLab)}${up}${bonusRow(cols)}</div>` +
        `<div class="yt-half">${headRow(cols, cols.length < v.n ? L(`+${v.n - cols.length}명 더 ▸`, `+${v.n - cols.length} more ▸`) : "")}${lo}${totalRow(cols)}</div>`;
    else box.innerHTML = `<div class="yt-half">${headRow(cols, roundLab)}${up}${bonusRow(cols)}${lo}${totalRow(cols)}</div>`;
    const hd = box.querySelector(".yt-half:last-child .yt-hd .yt-lab");
    if (hd && cols.length < v.n) { hd.classList.add("more"); hd.dataset.more = "1"; }
  }

  /* ---------- Dock: summary · hint · dice · buttons ---------- */
  function info() {
    const v = V(), f = focus(), T = tallies(), t = T[f], rk = ranks(T), chips = [];
    const me = f === M.me;
    if (v.n > 1) {
      const r = rk[f];
      const others = T.map(x => x.total).filter((_, q) => q !== f);
      const top = Math.max(...others);
      const gap = r === 1 ? t.total - top : t.total - Math.max(...T.map(x => x.total));
      chips.push(`<span class="yt-chip${r === 1 ? " good" : ""}">${me ? "" : esc(nm(f)) + " · "}${L(`합계 <b>${t.total}</b>`, `Total <b>${t.total}</b>`)} · ${rankText(r)}</span>`);
      if (gap !== 0 || r !== 1) chips.push(`<span class="yt-chip ${r === 1 ? "ok" : "dim"}">${r === 1 ? L(`2등과 <b>+${gap}</b>`, `Lead <b>+${gap}</b>`) : L(`1등까지 <b>${-gap}</b>`, `<b>${-gap}</b> behind 1st`)}</span>`);
    } else {
      chips.push(`<span class="yt-chip">${L(`합계 <b>${t.total}</b>`, `Total <b>${t.total}</b>`)}</span>`);
      if (newBest) chips.push(`<span class="yt-chip good">${L("🏆 새 최고 기록!", "🏆 New personal best!")}</span>`);
      else if (best && M.me === 0 && !ctx.replay) chips.push(`<span class="yt-chip ${t.total > best ? "good" : "dim"}">${t.total > best ? L("🏆 최고 기록 경신 중!", "🏆 Beating your best!") : L(`최고 기록까지 <b>${best - t.total}</b>`, `<b>${best - t.total}</b> to your best`)}</span>`);
    }
    if (t.bonus) chips.push(`<span class="yt-chip ok">${L(`보너스 +${BONUS} ✓`, `Bonus +${BONUS} ✓`)}</span>`);
    else if (!t.canBonus) chips.push(`<span class="yt-chip dim">${L("보너스 불가", "No bonus")}</span>`);
    else {
      chips.push(`<span class="yt-chip ok">${L(`보너스까지 <b>${t.need}</b>`, `<b>${t.need}</b> to bonus`)}</span>`);
      if (v.sheets[f].slice(0, 6).some(x => x !== null))
        chips.push(`<span class="yt-chip ${t.pace >= 0 ? "ok" : "bad"}" title="${esc(L("각 눈 3개씩(=63) 기준 대비", "Compared with three of each face (= 63)"))}">${L("페이스", "Pace")} <b>${t.pace >= 0 ? "+" : ""}${t.pace}</b></span>`);
    }
    R("info").innerHTML = chips.join("");
  }
  function hint() {
    const v = V(), h = R("hint");
    let t;
    if (v.phase === "over") {
      const T = tallies(), rk = ranks(T), win = [...Array(v.n).keys()].filter(q => rk[q] === 1);
      t = v.n === 1 ? (newBest ? L(`🏆 새 최고 기록 <b>${T[0].total}</b>점!`, `🏆 New best: <b>${T[0].total}</b>!`) : L(`게임 끝 — <b>${T[0].total}</b>점`, `Game over — <b>${T[0].total}</b> points`))
        : L(`게임 끝 — <b>${win.map(q => esc(nm(q))).join(", ")}</b> ${win.length > 1 ? "공동 1등" : "승리"}`, `Game over — <b>${win.map(q => esc(nm(q))).join(", ")}</b> ${win.length > 1 ? "tie for first" : "wins"}`);
    } else if (myTurn()) {
      if (sel >= 0) t = L(`<b>${esc(catName(sel))}</b> — 한 번 더 누르거나 ✔ 로 기록`, `<b>${esc(catName(sel))}</b> — tap again or ✔ to score`);
      else if (!v.rolls) t = L("<b>내 차례</b> — 주사위를 굴리세요", "<b>Your turn</b> — roll the dice");
      else if (v.rolls < 3) t = L("주사위를 눌러 <b>고정</b>하고 다시 굴리거나, 점수표에서 칸을 고르세요", "Tap dice to <b>hold</b> and roll again — or pick a category");
      else t = L("점수표에서 <b>칸을 고르세요</b> (★ 추천)", "<b>Pick a category</b> on the sheet (★ suggested)");
    } else if (v.turn === M.me && !ctx.replay) t = L("<b>내 차례</b>", "<b>Your turn</b>");
    else t = L(`<b>${esc(nm(v.turn))}</b> 님 차례`, `<b>${esc(nm(v.turn))}</b>'s turn`) +
      (v.rolls ? L(` · ${v.rolls}번 굴림`, ` · roll ${v.rolls} of 3`) : "");
    h.innerHTML = t;
  }
  function renderDice() {
    const v = V(), mine = myTurn();
    const faces = v.dice || (v.prev ? v.prev.dice : [0, 0, 0, 0, 0]);
    const heldNow = mine && v.rolls ? hold : v.dice ? v.held : NONE;
    const canHold = mine && v.rolls > 0 && v.rolls < 3 && !sent && !rolling();
    tray.classList.toggle("stale", !v.dice);
    tray.classList.toggle("can", canHold);
    dice.forEach((b, i) => {
      if (!rolling() && shown[i] !== faces[i]) { setFace(b, faces[i]); shown[i] = faces[i]; }
      b.classList.toggle("held", !!(v.dice && heldNow[i]));
      b.disabled = !canHold;
      b.setAttribute("aria-pressed", String(!!heldNow[i]));
      b.setAttribute("aria-label", faces[i] ? L(`주사위 ${faces[i]}${heldNow[i] ? " (고정)" : ""}`, `Die ${faces[i]}${heldNow[i] ? " (held)" : ""}`) : L("주사위", "Die"));
    });
  }
  function acts() {
    const v = V(), box = R("acts"), lv = live();
    if (ctx.spectator || M.me < 0) { box.innerHTML = ""; box.hidden = true; return; }
    box.hidden = false;
    if (!myTurn()) {
      if (v.phase === "over") { box.innerHTML = ""; box.classList.add("idle"); return; }
      const dots = [0, 1, 2].map(k => `<i class="${k < v.rolls ? "on" : ""}"></i>`).join("");
      box.innerHTML = `<div class="yt-watch">${avatarHTML(nm(v.turn), v.turn, "sm")}<span class="yt-rl">${dots}</span>` +
        (lv && lv.best >= 0 ? `<span>★ ${esc(catShort(lv.best))} <b>${lv.pot[lv.best]}</b></span>` : `<span>${L("굴리기 전", "Not rolled yet")}</span>`) + "</div>";
      box.classList.add("idle");
      return;
    }
    box.classList.remove("idle");
    const left = 3 - v.rolls, allHeld = v.rolls > 0 && hold.every(Boolean);
    const dots = [0, 1, 2].map(k => `<i class="${k < left ? "on" : ""}"></i>`).join("");
    const label = !left ? L("굴리기 끝", "No rolls left") : v.rolls ? L("다시 굴리기", "Roll again") : L("굴리기", "Roll");
    // With a category picked, the roll button shrinks to 🎲 + rolls left and the confirm button gets the room
    let h = `<button class="btn yt-roll${sel < 0 && left ? " primary" : " slim"}" data-a="roll"${!left || allHeld || sent || rolling() ? " disabled" : ""} aria-label="${esc(label)}">` +
      `🎲${sel < 0 ? ` <span>${label}</span>` : ""}<span class="yt-rl">${dots}</span></button>`;
    if (sel >= 0 && lv) h += `<button class="btn primary yt-ok" data-a="ok"${sent ? " disabled" : ""}>✔ ${esc(catShort(sel))} <b>${lv.pot[sel]}</b></button>`;
    box.innerHTML = h;
  }

  /* ---------- Sizes ---------- */
  function fit() {
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const land = isLand();
    wrap.classList.toggle("spec", M.me < 0);
    const dock = R("dock"), strip = R("strip"), sh = R("sheet");
    // Rows of the sheet in units of one category row: header .62, footers .9 (see style.css) + borders / padding
    const ONE = 12 + .62 + 1.8 + .45, TWO = 6 + .62 + .9 + .35;
    const TAG = 16;                                        // the HOLD tag under each die
    // The dock without the dice: summary + hint + buttons (fixed estimates, so the layout doesn't flip when a hint wraps)
    const fixed = M.me < 0 ? 66 : 118;
    const key = `${W}x${H}:${land}:${fixed}:${strip.offsetHeight}`;
    if (key !== layoutKey) {
      layoutKey = key;
      const dsW = Math.floor(Math.min(((land ? dock.clientWidth : W) - 24 - (land ? 32 : 40)) / 5, land ? 96 : 80));
      let ds;
      if (land) {
        ds = Math.min(dsW, H - strip.offsetHeight - fixed - TAG - 6);
        mode = H - 14 >= ONE * 38 ? "one" : "two";
      } else {
        // Dice as big as the width allows; one sheet column when 12 rows of ≥ 36px fit (shrinking the dice a little if needed)
        const base = H - strip.offsetHeight - fixed;
        if (base - dsW - TAG >= ONE * 36) { mode = "one"; ds = dsW; }
        else if (base - 52 - TAG >= ONE * 36) { mode = "one"; ds = base - TAG - ONE * 36; }
        else { mode = "two"; ds = Math.min(dsW, base - TAG - TWO * 40); }
      }
      ds = Math.max(36, Math.floor(ds));
      wrap.style.setProperty("--ds", ds + "px");
    }
    const avail = sh.clientHeight - 10;                     // measured after the new dice size
    const rh = Math.floor(Math.min(land ? 60 : 64, Math.max(28, avail / (mode === "one" ? ONE : TWO))));
    sh.style.setProperty("--rh", rh + "px");
  }

  function isLand() { return !!landMQ.matches && wrap.clientWidth > wrap.clientHeight * 1.15; }
  function render() {
    if (!M) return;
    wrap.classList.toggle("en", L(false, true));
    wrap.classList.toggle("land", isLand());
    strip(); info(); hint(); acts(); renderDice();
    fit();
    sheet();
    if (sheetBox) fullSheet(sheetBox.p, sheetBox.box);
  }

  /* ---------- Full score sheet (tap a player) ---------- */
  function fullSheet(p, box) {
    const v = V(), T = tallies(), rk = ranks(T);
    const cols = [...Array(v.n).keys()];
    let h = `<div class="yt-fullwrap"><table class="yt-full"><thead><tr><th></th>` +
      cols.map(q => `<th class="${q === p ? "sel" : ""}">${avatarHTML(nm(q), q, "sm")}<em>${esc(nm(q))}</em></th>`).join("") + "</tr></thead><tbody>";
    const row = (lab, f, cls = "") => `<tr class="${cls}"><th>${lab}</th>` + cols.map(q => `<td class="${q === p ? "sel" : ""}">${f(q)}</td>`).join("") + "</tr>";
    for (let c = 0; c < 12; c++) {
      if (c === 6) {
        h += row(L("상단 합", "Upper"), q => `${T[q].upper}<small>/${BONUS_AT}</small>`, "sub");
        h += row(L("보너스", "Bonus"), q => (T[q].bonus ? `+${BONUS}` : T[q].canBonus ? L(`−${T[q].need}`, `−${T[q].need}`) : "✗"), "sub");
      }
      h += row(`<span class="yt-fl">${c < 6 ? `<span class="yt-mini">${faceHTML(c + 1)}</span>` : ""}${esc(catShort(c))}</span>`, q => {
        const x = v.sheets[q][c];
        return x === null ? '<span class="yt-empty">·</span>' : x ? String(x) : '<span class="yt-z">0</span>';
      });
    }
    h += row(L("합계", "Total"), q => `<b>${T[q].total}</b>`, "tot");
    if (v.n > 1) h += row(L("순위", "Rank"), q => rankText(rk[q]), "sub");
    h += "</tbody></table></div>";
    let body = box.querySelector(".yt-fullbody");
    if (!body) { body = el("div", "yt-fullbody"); box.appendChild(body); }
    body.innerHTML = h;
  }
  function openSheet(p) {
    if (!M) return;
    ctx.modal((box, close) => {
      box.classList.add("yt-modal");
      ctx.head(box, L("점수표", "Score sheet"), esc(nm(p)), "");
      sheetBox = { p, box, close };
      fullSheet(p, box);
    }).then(() => { sheetBox = null; });
  }

  /* ---------- Actions ---------- */
  function markSent() {
    sent = Date.now();
    clearTimeout(sentT);
    sentT = setTimeout(() => { if (sent) { sent = 0; stopTumble(); render(); } }, 3000);   // the host refused (toast shown): unlock
  }
  function toggleHold(i) {
    if (!M || !myTurn() || sent || rolling()) return;
    const v = V();
    if (!v.rolls || v.rolls >= 3) return;
    hold[i] = !hold[i];
    kept = { key: turnKey, hold: hold.slice() };
    ctx.sound.flip();
    sel = -1;
    renderDice(); acts(); hint(); sheet();
  }
  function roll() {
    if (!M || !myTurn() || sent || rolling()) return;
    const v = V();
    if (v.rolls >= 3) return;
    const h = v.rolls ? hold.slice() : NONE.slice();
    if (h.every(Boolean)) { ctx.toast(L("다시 굴릴 주사위를 하나 이상 풀어 주세요", "Release at least one die to roll")); return; }
    if (!ctx.send({ roll: true, hold: h })) return;
    markSent();
    sel = -1;
    startTumble(h, null, 520);
    render();
  }
  function choose(c) {
    if (!M || !myTurn() || sent || rolling()) return;
    const v = V();
    if (!v.rolls || v.sheets[M.me][c] !== null) return;
    if (sel !== c) { sel = c; ctx.sound.tick(); render(); return; }
    if (!ctx.send({ score: CATS[c] })) return;
    markSent();
    render();
  }
  wrap.addEventListener("click", e => {
    const t = e.target.closest("[data-a],[data-c].can,[data-p].yt-pl,[data-hp],.yt-lab.more");
    if (!t) return;
    if (t.dataset.a === "roll") roll();
    else if (t.dataset.a === "ok") { if (sel >= 0) choose(sel); }
    else if (t.classList.contains("can")) choose(+t.dataset.c);
    else if (t.dataset.p !== undefined) openSheet(+t.dataset.p);
    else if (t.dataset.hp !== undefined) openSheet(+t.dataset.hp);
    else if (t.classList.contains("more")) openSheet(M.me >= 0 ? M.me : V().turn);
  });
  wrap.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-c].can")) { e.preventDefault(); choose(+e.target.dataset.c); }
  });

  /* ---------- Dice tumble ---------- */
  function startTumble(mask, final, ms) {
    if (calm()) { if (final) { tumbleFinal = final; } return; }
    tumbleMask = mask.slice();
    tumbleFinal = final;
    tumbleEnd = Date.now() + ms;
    dice.forEach((b, i) => { if (!mask[i]) b.classList.add("rolling"); else b.classList.add("held"); });
    clearInterval(tumbleT);
    let k = 0;
    tumbleT = setInterval(() => {
      if (tumbleFinal && Date.now() >= tumbleEnd) { stopTumble(); if (M) render(); return; }
      if (Date.now() > tumbleEnd + 2500) { stopTumble(); if (M) render(); return; }   // the result never came
      dice.forEach((b, i) => {
        if (tumbleMask[i]) return;
        let f = 1 + Math.floor(Math.random() * 6);
        if (f === shown[i]) f = f % 6 + 1;
        setFace(b, f); shown[i] = f;
      });
      if (k++ % 2 === 0) ctx.sound.deal();
    }, 75);
  }
  function stopTumble() {
    clearInterval(tumbleT); tumbleT = 0;
    dice.forEach(b => b.classList.remove("rolling"));
    if (tumbleFinal) {
      tumbleFinal.forEach((f, i) => { setFace(dice[i], f); shown[i] = f; });
      dice.forEach((b, i) => { if (!tumbleMask || !tumbleMask[i]) { b.classList.remove("land"); void b.offsetWidth; b.classList.add("land"); } });
      ctx.sound.place();
    }
    tumbleFinal = null; tumbleMask = null;
  }

  /* ---------- Events ---------- */
  function banner(big, small, cls = "") {
    if (calm() && !big) return;
    const b = R("banner");
    b.className = `yt-banner ${cls}`;
    b.innerHTML = `<div><b>${big}</b>${small ? `<small>${small}</small>` : ""}</div>`;
    b.hidden = false;
    void b.offsetWidth; b.classList.add("on");
    clearTimeout(bannerT);
    bannerT = setTimeout(() => { b.hidden = true; b.classList.remove("on"); }, 1800);
  }
  function events(m) {
    const after = [];
    for (const e of m.ev) {
      if (e.type === "roll") {
        if (e.p === m.me && rolling()) { tumbleFinal = e.dice.slice(); tumbleMask = e.held.slice(); }
        else after.push(() => startTumble(e.held, e.dice, 480));
      } else if (e.type === "score") {
        const from = tray.getBoundingClientRect();
        after.push(() => {
          const cell = R("sheet").querySelector(`.yt-c[data-p="${e.p}"][data-c="${e.cat}"]`) || R("strip").querySelector(`[data-pt="${e.p}"]`);
          if (cell && from.width) ctx.fly(from, cell, { html: `<div class="yt-flyv">${e.pts}</div>`, ms: 560, scale: 1.6 });
          if (cell) setTimeout(() => { cell.classList.remove("pop"); void cell.offsetWidth; cell.classList.add("pop"); }, 520);
          if (e.cat === 11 && e.pts === 50) { banner(L("요트!", "YACHT!"), "+50", "yacht"); ctx.sound.win(); ctx.buzz([40, 60, 40]); }
          else if (!e.pts) ctx.sound.pass();
          else ctx.sound.place();
          if (e.bonus) setTimeout(() => { banner(L(`보너스 +${BONUS}!`, `Bonus +${BONUS}!`), L("상단 63점 달성", "Upper section 63+"), "bonus"); ctx.sound.good(); }, e.cat === 11 ? 1900 : 450);
        });
      } else if (e.type === "over") {
        after.push(() => soloBest(m, true));
      }
    }
    return after;
  }
  /* Score attack: keep the personal best on this device */
  function soloBest(m, announce) {
    const v = m.v;
    if (bestDone || v.phase !== "over" || v.n !== 1 || m.me !== 0 || ctx.replay) return;
    bestDone = true;
    const total = tally(v.sheets[0]).total;
    if (total > best) {
      newBest = !!best || total > 0;
      best = total; saveBest(total);
      render();
      if (announce && newBest) setTimeout(() => banner(L("🏆 새 최고 기록!", "🏆 New best!"), String(total), "best"), 700);
    }
  }

  function update(m) {
    const again = m === M || m.ev === logEv;
    M = m;
    const v = m.v;
    const key = `${m.run || ""}:${v.turnNo}:${v.rolls}:${v.phase}`;
    if (key !== turnKey) {
      turnKey = key;
      hold = kept && kept.key === key ? kept.hold.slice() : v.rolls && v.held ? v.held.slice() : NONE.slice();
      sel = -1;
      if (sent) { sent = 0; clearTimeout(sentT); }
    }
    let after = [];
    if (!again) { logEv = m.ev; after = events(m); }
    render();
    for (const f of after) f();
    if (v.phase === "over") soloBest(m, false);
  }

  function onResize() { if (M) render(); }
  window.addEventListener("resize", onResize);
  if (landMQ.addEventListener) landMQ.addEventListener("change", onResize);

  return {
    update,
    ticker: false,           // the strip shows each player's last move; the log keeps the history
    landscape: true,
    destroy() {
      window.removeEventListener("resize", onResize);
      if (landMQ.removeEventListener) landMQ.removeEventListener("change", onResize);
      clearInterval(tumbleT); clearTimeout(bannerT); clearTimeout(sentT);
      if (sheetBox) sheetBox.close(null);
      root.innerHTML = "";
    }
  };
}
