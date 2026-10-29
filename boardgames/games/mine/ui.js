/* Gold Mine screen — top: name-chip grid (max 2 rows) · my info line · cells left to each goal
   middle: tunnel board (auto-fit to the free area · drag to pan · −/+) · leftover height below it shows this round's log
   bottom: my hand (spot counts · reasons a card can't be played) and buttons. The game shows its own history,
   so the one-line ticker at the top is turned off.
   Landscape (phones held sideways, computers, TVs): name chips in one row on top, the board on the left, and a side
   column with my info line, cells left to each goal, the log and my hand.
   Spectators (me = -1, watching screens): no role, hand or buttons — the board and every seat's public info get the room.
   Replays: nothing to act on (no hand selection, no buttons, no dialogs). */
import { L, loc } from "../../core/i18n.js";
import { GOAL_NAME, TOOL_ICON, TOOL_NAME, ROLE_NAME, josa, cardNameTx } from "./engine.js";

const goalN = g => loc(GOAL_NAME[g]);           // "1번" / "#1" — numbers, not positions, since the board may be turned
const toolN = t => loc(TOOL_NAME[t]);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const ZF = [1, 1.3, 1.65, 2.1];                 // zoom steps, multiplied with the fitted size
const CS_MIN = 26, CS_MAX = 72, CS_MAX_LAND = 120;   // cell size (px) — if the fit is smaller, the board is panned
const LANDQ = "(orientation: landscape) and (min-aspect-ratio: 4/3)";   // same query as the landscape CSS
const LIM = { x0: -4, x1: 12, y0: -5, y1: 5 };  // the engine's board area
const rot180 = m => ((m << 2) | (m >> 2)) & 15;
const tp = m => ((m & 1) << 3) | ((m & 2) << 1) | ((m & 4) >> 1) | ((m & 8) >> 3);   // vertical board: N↔W · E↔S (diagonal flip)
const bk = (t, big) => `<span class="mn-bk${big ? " big" : ""}" title="${L(`${TOOL_NAME[t].ko} 고장`, `${cap(TOOL_NAME[t].en)} broken`)}">${TOOL_ICON[t]}</span>`;
const roleTag = (r, icon) => (icon ? (r === "s" ? "😈 " : "⛏ ") : "") + loc(ROLE_NAME[r]);

/* Tunnel drawing — SVG on a 40×40 box. Side bits: N 1 · E 2 · S 4 · W 8. Dead ends have rubble in the middle */
const END = [[20, -3], [43, 20], [20, 43], [-3, 20]];
const STUB = [[20, 12], [28, 20], [20, 28], [12, 20]];
function tunnelSVG(e, c, extra = "") {
  let lines = "";
  for (let d = 0; d < 4; d++) if (e >> d & 1) {
    const [x2, y2] = END[d], [x1, y1] = c ? [20, 20] : STUB[d];
    lines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }
  const rocks = c ? "" : `<g class="mn-rk"><circle cx="20" cy="20" r="8"/><circle cx="14.5" cy="16" r="4.6"/><circle cx="25.5" cy="23.5" r="4.2"/><circle cx="23" cy="14" r="3"/></g>`;
  return `<svg viewBox="0 0 40 40" aria-hidden="true"><g class="mn-t0">${lines}</g><g class="mn-t1">${lines}</g>${rocks}${extra}</svg>`;
}
const COAL = `<g class="mn-coal"><circle cx="17" cy="21" r="4.2"/><circle cx="23.5" cy="18.5" r="3.6"/><circle cx="22" cy="24.5" r="3"/></g>`;
const GOLD = `<g class="mn-gold"><path d="M12 25l4-8h8l4 8z"/><path d="M15.5 18.5l2.5-5h4l2.5 5z"/></g>`;
const LADDER = `<g class="mn-lad"><path d="M15 11v18M25 11v18M15 15h10M15 20h10M15 25h10"/></g>`;

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "mn");
  wrap.innerHTML = `
    <div class="mn-seats" data-r="seats"></div>
    <div class="mn-bar">
      <button class="mn-role" data-r="role" aria-label="${L("내 역할 보기", "Show my role")}"></button>
      <span class="mn-me" data-r="me"></span>
      <button class="mn-zb" data-r="res" hidden>${L("결과", "Results")}</button>
    </div>
    <div class="mn-goals">
      <span class="mn-gl" data-r="goals"></span>
      <span class="mn-zoom"><button class="mn-zb" data-z="-1" aria-label="${L("축소", "Zoom out")}">−</button><button class="mn-zb" data-z="1" aria-label="${L("확대", "Zoom in")}">+</button></span>
    </div>
    <div class="mn-body" data-r="body">
      <div class="mn-mid" data-r="mid"><div class="mn-frame" data-r="frame"><div class="mn-grid" data-r="grid"></div></div></div>
      <div class="mn-log" data-r="log"></div>
      <div class="mn-over" data-r="over" hidden></div>
    </div>
    <div class="dock mn-dock">
      <div class="hint" data-r="hint"></div>
      <div class="mn-hand" data-r="hand"></div>
      <div class="mn-acts" data-r="acts"></div>
    </div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);

  let last = null;               // last msg
  let sel = null, rot = 0;       // selected card · path rotation (can be picked on others' turns to preview spots)
  let ghost = null;              // cell to place on (or collapse) {x, y}
  let zoomI = 0;                 // ZF step (0 = fit)
  let vert = null, vertW = 0;   // vertical board? (re-decided only when the device width changes)
  let box = null, boxRound = -1; // board area shown — only grows within a round, so the screen shakes less
  let prevGeo = null;            // for keeping the board scroll position {x0, y0, cs}
  let focusNext = null;          // cell to centre on the next draw {x, y}
  let roleOpen = false, roleT = 0;
  let overHidden = false;
  let busy = false;
  const seen = new WeakSet();    // event batches that already played sounds / animations
  let flyFrom = null;            // {rect, t} of the hand card I just played — saved before sending (the redraw removes it)
  let prevHand = null, prevDeck = null;   // my hand ids · deck size at the last update (to spot drawn cards)
  let vertLand = null;           // layout (landscape or not) when the board orientation was decided
  let curCs = 34;                // current cell size (px) — for flying cards
  const land = () => window.matchMedia(LANDQ).matches;

  /* ---------- What the selected card can do now ---------- */
  const myTurn = () => !!(last && ctx.myAsk("turn") && last.v.phase === "play");
  const selCard = () => (last && sel !== null ? last.v.hand.find(c => c.id === sel) || null : null);
  const brokenMe = v => v.broken[last.me].length > 0;
  const names = () => last.players.map(p => p.name);
  function spotsFor(v, c, r) {               // legal spots for a path card
    if (!v.legal || !v.legal[c.id]) return [];
    return v.legal[c.id].filter(s => s[2] === r);
  }
  const spotCount = (v, c) => new Set((v.legal && v.legal[c.id] || []).map(s => s[0] + "," + s[1])).size;
  function breakTargets(v, c) {
    const out = [];
    for (let p = 0; p < v.n; p++) if (p !== last.me && !v.broken[p].includes(c.tool)) out.push(p);
    return out;
  }
  function fixTargets(v, c) {                // [{p, tool}]
    const out = [];
    for (let p = 0; p < v.n; p++) for (const t of c.tools) if (v.broken[p].includes(t)) out.push({ p, tool: t });
    return out;
  }
  const mapGoals = v => [0, 1, 2].filter(g => !v.goals[g].rev && !v.goals[g].kind);
  const rockCells = v => v.board.filter(b => b.k === "p");
  /* Why a card can't be played now [short label for the card, longer text for the hint line] — null if it can
     (discarding is always allowed) */
  function why(v, c) {
    if (v.phase !== "play") return null;
    if (c.t === "path") {
      const icons = v.broken[last.me].map(t => TOOL_ICON[t]).join("");
      if (brokenMe(v)) return [L("도구 고장", "Broken"), L(`도구가 부서져 길을 놓을 수 없음 (${icons}) — 수리 카드로 고치거나 버리세요`,
        `Broken tools (${icons}) — no paths. Repair them or discard`)];
      if (!spotCount(v, c)) return [L("놓을 곳 없음", "No spot"), L("이 길 카드를 맞춰 놓을 굴 끝이 없음 — 버릴 수 있어요", "No tunnel end fits this path card — you can discard it")];
    } else if (c.t === "break" && !breakTargets(v, c).length) return [L("대상 없음", "No target"),
      L(`다른 사람의 ${josa(TOOL_NAME[c.tool].ko, "이", "가")} 모두 이미 고장 — 버릴 수 있어요`, `Everyone else's ${TOOL_NAME[c.tool].en} is already broken — you can discard it`)];
    else if (c.t === "fix" && !fixTargets(v, c).length) return [L("고칠 것 없음", "No target"),
      L(`${c.tools.map(t => TOOL_NAME[t].ko).join(" · ")} 고장 난 사람이 없음 — 버릴 수 있어요`, `Nobody has a broken ${c.tools.map(t => TOOL_NAME[t].en).join(" or ")} — you can discard it`)];
    else if (c.t === "map" && !mapGoals(v).length) return [L("볼 것 없음", "All seen"), L("더 볼 목표가 없음 — 버릴 수 있어요", "No goal left to look at — you can discard it")];
    else if (c.t === "rock" && !rockCells(v).length) return [L("길 없음", "No path"), L("무너뜨릴 길 카드가 없음 — 버릴 수 있어요", "No path card to collapse — you can discard it")];
    return null;
  }

  function send(a) {
    if (busy) return;
    const card = sel !== null ? R("hand").querySelector(`[data-id="${sel}"]`) : null;
    const rect = card ? card.getBoundingClientRect() : null;
    if (ctx.send(a)) { flyFrom = rect ? { rect, t: Date.now() } : null; busy = true; sel = null; ghost = null; setTimeout(() => { busy = false; }, 600); }
    if (last) render(last, null);
  }

  /* ---------- Action texts (name-chip badges · log) ---------- */
  const meName = () => L("나", "You");
  function actHTML(h, short) {        // short: 1 = name-chip badge, 2 = narrow name-chip badge
    const nm = p => (p === last.me ? meName() : esc(names()[p] || "?"));
    if (h.t === "path") return h.dead ? `<span class="mn-k bad">${short ? L("막힘 놓음", "Dead end") : L("막다른 길을 놓음", "Placed a dead end")}</span>`
      : `<span class="mn-k path">${short ? L("길 놓음", "Path") : L("굴을 팜", "Dug a tunnel")}</span>`;
    if (h.t === "rock") return h.gone === "dead" ? `<span class="mn-k fix">🪨 ${short ? L("막힘 치움", "Cleared") : L("낙석으로 막다른 길을 치움", "Cleared a dead end with a rockfall")}</span>`
      : `<span class="mn-k bad">🪨 ${short === 2 ? L("낙석", "Rockfall") : short ? L("길 무너뜨림", "Collapsed") : L("낙석으로 길을 무너뜨림", "Collapsed a path with a rockfall")}</span>`;
    if (h.t === "break") return `<span class="mn-k bad">${bk(h.tool)}${short === 2 ? "" : L(" 부숨", " broke")}→${nm(h.target)}</span>`;
    if (h.t === "fix") return `<span class="mn-k fix">🔧${TOOL_ICON[h.tool]}${short === 2 ? "" : L(" 고침", " fixed")}→${h.target === h.p ? L("자기", "self") : nm(h.target)}</span>`;
    if (h.t === "map") return `<span class="mn-k map">🗺 ${short ? L(`${GOAL_NAME[h.goal].ko} 봄`, `Saw ${GOAL_NAME[h.goal].en}`)
      : L(`${GOAL_NAME[h.goal].ko} 목표를 몰래 봄`, `Secretly looked at goal ${GOAL_NAME[h.goal].en}`)}</span>`;
    return `<span class="mn-k">${short ? L("버림", "Discard") : L("카드 한 장 버림", "Discarded a card")}</span>`;
  }
  const lastActOf = (v, p) => { for (let i = v.log.length - 1; i >= 0; i--) if (v.log[i].p === p) return v.log[i]; return null; };
  /* Cards nobody has seen yet (deck · other hands · face-down discards) — so players don't have to count */
  function unseen(v) {
    const t = { path: 35, dead: 9, break: 9, fix: 9, map: 6, rock: 3 };
    for (const b of v.board) if (b.k === "p") t[b.c ? "path" : "dead"]--;
    for (const h of v.log) {
      if (h.t === "rock") { t.rock--; t[h.gone]--; }
      else if (h.t === "break" || h.t === "fix" || h.t === "map") t[h.t]--;
    }
    for (const c of v.hand) t[c.t === "path" ? (c.c ? "path" : "dead") : c.t]--;
    return t;
  }
  function sabRange(v) {
    const [ns, nm] = v.roleSet;
    const lo = Math.max(0, v.n - nm), hi = Math.min(ns, v.n);
    return lo === hi ? L(`${lo}명`, `${lo}`) : L(`${lo}~${hi}명`, `${lo}–${hi}`);
  }

  /* ---------- Event effects ---------- */
  function effects(m) {
    const me = m.me, marks = { fresh: new Set(), flip: new Set(), dust: [], hit: new Set(), acted: new Set() };
    for (const e of m.ev) {
      if (e.p !== undefined) marks.acted.add(e.p);
      if (e.type === "path") { marks.fresh.add(e.x + "," + e.y); ctx.sound.place(); }
      else if (e.type === "reveal") { marks.flip.add(e.x + "," + e.y); e.gold ? ctx.sound.good() : ctx.sound.flip(); }
      else if (e.type === "break") { marks.hit.add(e.target); if (e.target === me) { ctx.sound.bad(); if (!m.replay) ctx.buzz(120); } else ctx.sound.chip(); }
      else if (e.type === "repair") { marks.hit.add(e.target); e.target === me ? ctx.sound.good() : ctx.sound.chip(); }
      else if (e.type === "rock") { marks.dust.push([e.x, e.y]); ctx.sound.pass(); }
      else if (e.type === "discard") ctx.sound.deal();
      else if (e.type === "map") {
        // only the live player gets the dialog — a replay just shows the 👁 mark on the goal
        if (e.p === me && e.gold !== undefined && !m.replay) peekModal(e.goal, e.gold);
        else ctx.sound.flip();
      } else if (e.type === "round") {
        overHidden = false;
        // after the last round the results window plays the sound
        if (e.round < m.v.rounds) me < 0 ? ctx.sound.good() : (e.roles[me] === e.winner) ? ctx.sound.win() : ctx.sound.lose();
      } else if (e.type === "newround") { roleOpen = false; overHidden = false; sel = null; ghost = null; zoomI = 0; ctx.sound.deal(); }
    }
    return marks;
  }
  function peekModal(g, gold) {
    ctx.sound.flip();
    ctx.modal((box, close) => {
      ctx.head(box, L("지도 · 나만 아는 정보", "Map · only you know"),
        L(`${GOAL_NAME[g].ko} 목표는 ${gold ? "금" : "석탄"}입니다`, `Goal ${GOAL_NAME[g].en} is ${gold ? "gold" : "coal"}`),
        L("판의 목표 카드에 👁 표시를 해 두었습니다. 다른 사람은 내가 무엇을 봤는지 모릅니다.", "The goal card on the board is marked with 👁. Nobody else knows what you saw."));
      box.appendChild(el("div", "mn-peekbig " + (gold ? "gold" : "coal"), tunnelSVG(gold ? 15 : 0, true, gold ? GOLD : COAL)));
      ctx.buttonRow(box, [{ label: L("확인", "OK"), primary: true, on: () => close() }]);
    });
  }

  /* ---------- Name chips: name · hand · gold · broken tools · last action ---------- */
  function seats(m, marks) {
    const v = m.v, box = R("seats"), c = selCard(), mt = myTurn();
    const pickable = new Set();
    if (mt && c && c.t === "break") breakTargets(v, c).forEach(p => pickable.add(p));
    if (mt && c && c.t === "fix") fixTargets(v, c).forEach(o => pickable.add(o.p));
    // Portrait: one row up to 5 players, two rows from 6. Landscape: always one row (height is what's scarce)
    const cols = land() || v.n <= 5 ? v.n : Math.ceil(v.n / 2);
    box.style.setProperty("--cols", cols);
    const tight = cols >= 5 && (box.clientWidth || 360) / cols < 110;   // narrow chips: shorter badges
    box.classList.toggle("tight", tight);
    box.innerHTML = "";
    m.players.forEach((pl, p) => {
      const broken = v.broken[p];
      const chip = el("button", "mn-chip" + (p === v.turn && v.phase === "play" ? " turn" : "") + (p === m.me ? " me" : "")
        + (broken.length ? " bkn" : "") + (pickable.has(p) ? " mn-pick" : "") + (marks && marks.hit.has(p) ? " mn-hit" : "")
        + (marks && marks.acted.has(p) ? " mn-acted" : ""));
      const tag = pl.kind === "away" ? `<i class="away" title="${L("자리 비움", "Away")}">💤</i>` : pl.kind === "ai" ? '<i class="ai">AI</i>' : "";
      let l3;
      if (v.roles) l3 = `<span class="mn-rtag ${v.roles[p]}">${roleTag(v.roles[p], !tight)}</span>` + (v.res && v.res.gains[p] ? `<b class="mn-gain">+${v.res.gains[p]}</b>` : "");
      else { const h = lastActOf(v, p); l3 = h ? actHTML(h, tight ? 2 : 1) : '<span class="mn-k none">—</span>'; }
      const tools = broken.map(t => toolN(t));
      chip.innerHTML = `<span class="l1">${avatarHTML(pl.name, p, "sm mn-av")}<b class="nm">${p === m.me ? meName() : esc(pl.name)}</b>${tag}</span>` +
        `<span class="l2"><span title="${L("손패", "Cards in hand")}">🂠${v.sizes[p]}</span><span class="mn-g" title="${L("모은 금", "Gold collected")}">💰${v.gold[p]}</span>` +
        (broken.length ? `<span class="mn-tools" title="${L("고장", "Broken")}: ${tools.join(", ")}">${broken.map(t => bk(t)).join("")}</span>` : "") + `</span>` +
        `<span class="l3">${l3}</span>`;
      chip.setAttribute("aria-label", L(`${pl.name}: 손패 ${v.sizes[p]}장, 금 ${v.gold[p]}`, `${pl.name}: ${v.sizes[p]} cards, ${v.gold[p]} gold`)
        + (broken.length ? L(`, 고장 ${tools.join(" ")}`, `, broken: ${tools.join(", ")}`) : ""));
      chip.onclick = () => (pickable.has(p) ? pickTarget(p) : playerModal(p));
      box.appendChild(chip);
    });
  }
  function pickTarget(p) {
    const v = last.v, c = selCard();
    if (!c || !myTurn()) return;
    if (c.t === "break") send({ break: c.id, target: p });
    else if (c.t === "fix") {
      const opts = fixTargets(v, c).filter(o => o.p === p);
      if (opts.length === 1) send({ repair: c.id, target: p, tool: opts[0].tool });
      else if (opts.length > 1) ctx.choose(L("어느 도구를 고칠까요?", "Which tool to repair?"), "", opts.map(o => ({ value: o.tool, label: `${TOOL_ICON[o.tool]} ${cap(toolN(o.tool))}` })))
        .then(t => { if (t) send({ repair: c.id, target: p, tool: t }); });
    }
  }
  /* Tapping a name chip: what that player did this round */
  function playerModal(p) {
    const v = last.v, pl = last.players[p], mine = v.log.filter(h => h.p === p);
    const cnt = k => mine.filter(k).length;
    const sum = [[L("굴", "Tunnels"), cnt(h => h.t === "path" && !h.dead)], [L("막힘", "Dead ends"), cnt(h => h.t === "path" && h.dead)],
      [L("낙석", "Rockfalls"), cnt(h => h.t === "rock")], [L("부숨", "Breaks"), cnt(h => h.t === "break")], [L("수리", "Repairs"), cnt(h => h.t === "fix")],
      [L("지도", "Maps"), cnt(h => h.t === "map")], [L("버림", "Discards"), cnt(h => h.t === "discard")]]
      .filter(x => x[1]).map(x => `${x[0]} <b>${x[1]}</b>`).join(" · ");
    const got = v.log.filter(h => (h.t === "break" || h.t === "fix") && h.target === p && h.p !== p);
    const bkn = v.broken[p].map(t => bk(t)).join("");
    ctx.modal(box => {
      ctx.head(box, L("이번 라운드", "This round"), `${avatarHTML(pl.name, p)} ${esc(pl.name)}${p === last.me ? L(" (나)", " (you)") : ""}`,
        L(`손패 <b>${v.sizes[p]}</b>장 · 금 <b>${v.gold[p]}</b> · 도구 ${v.broken[p].length ? bkn + " 고장" : "<b>정상</b>"}`,
          `<b>${v.sizes[p]}</b> cards · <b>${v.gold[p]}</b> gold · tools ${v.broken[p].length ? bkn + " broken" : "<b>OK</b>"}`));
      box.appendChild(el("div", "mn-psum", sum || L("아직 한 일이 없습니다", "Nothing yet this round")));
      const ul = el("ul", "mn-plist");
      mine.slice().reverse().forEach(h => ul.appendChild(el("li", "", actHTML(h, false))));
      got.slice().reverse().forEach(h => {
        const who = esc(names()[h.p]), what = h.t === "break" ? bk(h.tool) : "🔧" + TOOL_ICON[h.tool];
        ul.appendChild(el("li", "rcv", h.t === "break" ? L(`${who} 님이 ${what} 부숨`, `${who} broke ${what}`) : L(`${who} 님이 ${what} 고쳐 줌`, `${who} repaired ${what}`)));
      });
      if (mine.length || got.length) box.appendChild(ul);
    });
  }

  /* ---------- My info line · role ---------- */
  function info(m) {
    const v = m.v, rb = R("role");
    const pub = L(`<span><b>${v.round}</b>/${v.rounds}판</span><span data-r="deck">덱 <b>${v.deck}</b></span>`,
      `<span>Rd <b>${v.round}</b>/${v.rounds}</span><span data-r="deck">Deck <b>${v.deck}</b></span>`);
    if (m.me < 0) {
      // Watching: whose turn (big enough for a TV across the room) and the public counts — no role, no tools of mine
      rb.hidden = true;
      const t = v.turn, pl = m.players[t];
      const now = v.phase === "play" && pl ? `<span class="mn-now">${avatarHTML(pl.name, t, "sm mn-av")}<b>${esc(pl.name)}</b>${L(" 차례", "'s turn")}</span>` : "";
      R("me").innerHTML = now + pub + `<span>${L(`방해꾼 <b>${sabRange(v)}</b>`, `Traitors <b>${sabRange(v)}</b>`)}</span>`;
    } else {
      const mb = v.broken[m.me];
      rb.hidden = false;
      rb.className = "mn-role" + (roleOpen ? " open " + v.role : "");
      // (.mn-long words are dropped on the narrow side column of a phone held sideways — see style.css)
      rb.innerHTML = roleOpen ? roleTag(v.role, true) : L(`🎭<span class="mn-long"> 내</span> 역할`, `🎭 <span class="mn-long">My </span>role`);
      R("me").innerHTML = (mb.length ? `<span class="mn-mytools bad">${mb.map(t => bk(t)).join("")}<span class="mn-long"> ${L("고장", "broken")}</span></span>`
        : `<span class="mn-mytools ok">${L(`🛠<span class="mn-long"> 도구</span> 정상`, `🛠<span class="mn-long"> Tools</span> OK`)}</span>`) +
        `<span class="mn-g">💰<b>${v.gold[m.me]}</b></span>` + pub;
    }
    R("res").hidden = !(v.phase !== "play" && overHidden);
  }
  R("role").onclick = () => {
    roleOpen = !roleOpen;
    clearTimeout(roleT);
    if (roleOpen) roleT = setTimeout(() => { roleOpen = false; if (last) info(last); }, 4000);
    if (last) info(last);
  };
  R("res").onclick = () => { overHidden = false; if (last) render(last, null); };
  wrap.querySelectorAll("[data-z]").forEach(b => b.onclick = () => {
    const z = Math.max(0, Math.min(ZF.length - 1, zoomI + +b.dataset.z));
    if (z === zoomI) return;
    // On the first zoom-in, centre on the card just placed (or the entrance)
    if (zoomI === 0 && last) { const v = last.v; focusNext = ghost || (v.last && v.last.x !== undefined ? { x: v.last.x, y: v.last.y } : { x: 0, y: 0 }); }
    zoomI = z;
    if (last) { goalsLine(last); board(last, null); }
  });

  /* ---------- Cells left to each goal (counted for the player) ---------- */
  function goalsLine(m) {
    const v = m.v;
    // Goals that may be gold: only the one I saw as gold, otherwise those not known to be coal
    const goldKnown = v.goals.findIndex(g => g.kind === "gold");
    const cand = g => (goldKnown >= 0 ? g === goldKnown : v.goals[g].kind !== "coal");
    let best = Infinity;
    for (let g = 0; g < 3; g++) if (cand(g) && v.need[g] !== null) best = Math.min(best, v.need[g]);
    let h = `<span class="lead">${L("남은 칸", "To go")}</span>`;
    for (let g = 0; g < 3; g++) {
      const gl = v.goals[g], n = v.need[g];
      let mark = "", val;
      if (gl.rev) { mark = gl.kind === "gold" ? "💰" : "⚫"; val = gl.kind === "gold" ? L("금!", "Gold!") : L("석탄", "Coal"); }
      else {
        if (gl.peek) mark = `👁${gl.kind === "gold" ? "💰" : "⚫"}`;
        else if (gl.kind) mark = gl.kind === "gold" ? "💰" : "⚫";
        else if (goldKnown < 0 && v.goals.filter(o => o.kind === "coal").length === 2) mark = "=💰";   // the other two are coal → gold
        val = n === null ? L("막힘", "Cut") : `<b>${n}</b>`;
      }
      const cls = "mn-gp" + (!gl.rev && cand(g) && n === best ? " best" : "") + (gl.kind === "coal" ? " coal" : "") + (n === null && !gl.rev ? " cut" : "");
      const nn = n === null ? "-" : n;
      h += `<span class="${cls}" title="${L(`${GOAL_NAME[g].ko} 목표: 입구와 이어진 굴 끝에서 최소 ${nn}장`, `Goal ${GOAL_NAME[g].en}: at least ${nn} cards from a connected tunnel end`)}">${goalN(g)}${mark} ${val}</span>`;
    }
    R("goals").innerHTML = h;
    wrap.querySelector('[data-z="-1"]').disabled = zoomI === 0;
    wrap.querySelector('[data-z="1"]').disabled = zoomI === ZF.length - 1;
  }

  /* ---------- Board ---------- */
  function needBox(v) {                        // smallest area holding the entrance, goals, placed cards and tunnel ends
    let x0 = 0, x1 = 8, y0 = -2, y1 = 2;
    const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    for (const t of v.board) add(t.x, t.y);
    if (v.phase === "play") for (const [x, y] of v.front) add(x, y);
    return { x0: Math.max(LIM.x0, x0), x1: Math.min(LIM.x1, x1), y0: Math.max(LIM.y0, y0), y1: Math.min(LIM.y1, y1) };
  }
  function board(m, marks) {
    const v = m.v, frame = R("frame"), grid = R("grid"), mid = R("mid"), body = R("body");
    const nb = needBox(v);
    if (!box || boxRound !== v.round) { box = nb; prevGeo = null; }
    else box = { x0: Math.min(box.x0, nb.x0), x1: Math.max(box.x1, nb.x1), y0: Math.min(box.y0, nb.y0), y1: Math.max(box.y1, nb.y1) };
    boxRound = v.round;
    const b = box, ex = b.x1 - b.x0 + 1, ey = b.y1 - b.y0 + 1;   // columns · rows in engine orientation
    // Cell size: the largest size that fits the whole board × zoom step.
    // Orientation: on a tall screen, turning the board vertical (entrance on top, goals at the bottom) makes cells much
    // bigger. Re-decided only when the device width changes
    // Portrait: the board takes its content height and the log the rest below it. Landscape: the board fills its grid
    // area on the left (the log sits in the side column), always shown horizontally — the screen is wide
    const ld = land();
    if (ld !== vertLand) { vert = null; vertLand = ld; }
    if (ld) mid.style.height = "";
    const fw = frame.clientWidth - 4, fh = ld ? mid.clientHeight - 4 : body.clientHeight - 8;   // board border 4 + gap above the log 4
    if (vert === null && fw > 0 && fh > 0) vert = !ld && Math.min(fw / 5, fh / 10) >= 1.1 * Math.min(fw / 10, fh / 5);   // based on the round-start board (10×5)
    const cols = vert ? ey : ex, rows = vert ? ex : ey;
    const fit = fw > 0 && fh > 0 ? Math.floor(Math.min(fw / cols, fh / rows)) : 34;
    const cs = Math.round(Math.max(CS_MIN, Math.min(ld ? CS_MAX_LAND : CS_MAX, fit)) * ZF[zoomI]);
    curCs = cs;
    if (!ld) {
      const midH = Math.max(0, Math.min(body.clientHeight - 4, rows * cs + 4));
      mid.style.height = midH + "px";
      R("log").hidden = body.clientHeight - midH < 44;   // hide the log when not even one line fits (no cut-off header)
    } else R("log").hidden = false;
    // engine coordinates (x, y) → screen cell (on a vertical board x runs down and y runs right)
    const sx = (x, y) => (vert ? y - b.y0 : x - b.x0), sy = (x, y) => (vert ? x - b.x0 : y - b.y0);
    const T = e => (vert ? tp(e) : e);
    // Keep showing the same spot when the board grows left / up or the zoom changes (remember the centre cell in engine coordinates)
    let keep = null;
    if (prevGeo && (prevGeo.x0 !== b.x0 || prevGeo.y0 !== b.y0 || prevGeo.cs !== cs || prevGeo.vert !== vert)) {
      const a = (frame.scrollLeft + frame.clientWidth / 2) / prevGeo.cs, d = (frame.scrollTop + frame.clientHeight / 2) / prevGeo.cs;
      keep = prevGeo.vert ? { x: d + prevGeo.x0 - .5, y: a + prevGeo.y0 - .5 } : { x: a + prevGeo.x0 - .5, y: d + prevGeo.y0 - .5 };
    }
    prevGeo = { x0: b.x0, y0: b.y0, cs, vert };
    grid.style.setProperty("--cs", cs + "px");
    grid.style.width = cols * cs + "px";
    grid.style.height = rows * cs + "px";
    grid.classList.toggle("vert", !!vert);
    const pos = (x, y) => `left:${sx(x, y) * cs}px;top:${sy(x, y) * cs}px`;
    const c = selCard(), mt = myTurn();
    let h = "";
    // Tunnel ends: open ends connected to the entrance — path cards only go here
    if (v.phase === "play") for (const [x, y] of v.front) h += `<div class="mn-c mn-front" style="${pos(x, y)}"></div>`;
    for (const t of v.board) {
      const kk = t.x + "," + t.y;
      let cls = "mn-c mn-tile", inner = "";
      if (t.k === "s") { cls += " mn-start"; inner = tunnelSVG(15, true, LADDER) + `<i class="mn-lbl">${L("입구", "Entry")}</i>`; }
      else if (t.k === "p") { inner = tunnelSVG(T(t.e), t.c); if (!t.c) cls += " dead"; }
      else {
        const gl = v.goals[t.g];
        if (t.rev) { cls += " mn-goal rev " + (t.gold ? "gold" : "coal"); inner = tunnelSVG(T(t.e), true, t.gold ? GOLD : COAL); }
        else {
          cls += " mn-goal down" + (gl.kind ? " " + gl.kind : "");
          inner = gl.kind && !gl.peek ? `<span class="mn-q">${gl.kind === "gold" ? "💰" : "⚫"}</span>`   // round end: all revealed
            : `<span class="mn-q">?</span>` + (gl.peek ? `<span class="mn-peek">👁${gl.kind === "gold" ? "💰" : "⚫"}</span>` : "");
        }
        inner += `<i class="mn-gno">${t.g + 1}</i>`;
      }
      if (v.last && v.last.x === t.x && v.last.y === t.y && v.last.t === "path") cls += " mn-last";
      if (marks && marks.fresh.has(kk)) cls += " mn-new";
      if (marks && marks.flip.has(kk)) cls += " mn-flip";
      h += `<div class="${cls}" style="${pos(t.x, t.y)}" data-cell="${kk}">${inner}</div>`;
    }
    if (marks) for (const [x, y] of marks.dust) h += `<div class="mn-c mn-dust" style="${pos(x, y)}" data-dust="${x},${y}"></div>`;
    // Cells to tap for the selected card (a faint preview on others' turns)
    if (c && v.phase === "play") {
      const pre = mt ? "" : " pre";
      if (c.t === "path" && !brokenMe(v)) {
        const lbl = L("여기에 놓기", "Place here");
        for (const [x, y] of spotsFor(v, c, rot)) h += `<button class="mn-c mn-spot${pre}${ghost && ghost.x === x && ghost.y === y ? " on" : ""}" style="${pos(x, y)}" data-x="${x}" data-y="${y}" aria-label="${lbl}"></button>`;
        if (ghost && mt) h += `<div class="mn-c mn-tile mn-ghost${c.c ? "" : " dead"}" style="${pos(ghost.x, ghost.y)}">${tunnelSVG(T(rot ? rot180(c.e) : c.e), c.c)}</div>`;
      } else if (c.t === "rock") {
        const lbl = L("이 길 무너뜨리기", "Collapse this path");
        for (const t of rockCells(v)) h += `<button class="mn-c mn-spot rock${pre}${ghost && ghost.x === t.x && ghost.y === t.y ? " on" : ""}" style="${pos(t.x, t.y)}" data-x="${t.x}" data-y="${t.y}" aria-label="${lbl}"></button>`;
      } else if (c.t === "map") {
        for (const g of mapGoals(v)) { const gl = v.goals[g]; h += `<button class="mn-c mn-spot map${pre}" style="${pos(gl.x, gl.y)}" data-g="${g}" aria-label="${L(`${GOAL_NAME[g].ko} 목표 보기`, `Look at goal ${GOAL_NAME[g].en}`)}"></button>`; }
      }
    }
    grid.innerHTML = h;
    const center = (x, y) => {
      frame.scrollLeft = (sx(x, y) + .5) * cs - frame.clientWidth / 2;
      frame.scrollTop = (sy(x, y) + .5) * cs - frame.clientHeight / 2;
    };
    if (focusNext) { center(focusNext.x, focusNext.y); focusNext = null; }
    else if (keep) center(keep.x, keep.y);
  }
  R("grid").addEventListener("click", e => {
    const t = e.target.closest("[data-x],[data-g]");
    if (!t || !last) return;
    const c = selCard();
    if (!c) return;
    if (!myTurn()) { ctx.toast(L("내 차례가 되면 놓을 수 있어요", "You can play it on your turn")); return; }
    if (t.dataset.g !== undefined) { if (c.t === "map") send({ map: c.id, goal: +t.dataset.g }); return; }
    const x = +t.dataset.x, y = +t.dataset.y;
    if (ghost && ghost.x === x && ghost.y === y) { confirm(); return; }   // same cell tapped again → confirm
    ghost = { x, y };
    ctx.sound.tick();
    render(last, null);
  });
  function confirm() {
    const c = selCard();
    if (!c || !ghost) return;
    if (c.t === "path") send({ path: c.id, x: ghost.x, y: ghost.y, rot });
    else if (c.t === "rock") send({ rock: c.id, x: ghost.x, y: ghost.y });
  }

  /* ---------- This round's log (leftover height below the board) ---------- */
  function logPanel(m) {
    const v = m.v, box = R("log"), nm = names(), tot = v.roleSet[0] + v.roleSet[1];
    let h = `<div class="mn-lstick"><div class="mn-lhead"><span>${L(`${v.round}라운드 기록`, `Round ${v.round} log`)}</span><span>` +
      L(`방해꾼 <b>${sabRange(v)}</b> · 역할 카드 ${tot}장 중 ${v.n}장`, `Traitors <b>${sabRange(v)}</b> · ${v.n} of ${tot} role cards`) + `</span></div>`;
    const u = unseen(v);
    h += `<div class="mn-lseen" title="${L("덱 · 남의 손 · 엎어 버린 카드 중에 남은 것", "Still in the deck, other hands or face-down discards")}">` +
      L(`안 나온 카드 · 길 <b>${u.path}</b> · 막힘 <b>${u.dead}</b> · 고장 <b>${u.break}</b> · 수리 <b>${u.fix}</b> · 지도 <b>${u.map}</b> · 낙석 <b>${u.rock}</b>`,
        `Unseen · path <b>${u.path}</b> · dead <b>${u.dead}</b> · break <b>${u.break}</b> · fix <b>${u.fix}</b> · map <b>${u.map}</b> · rock <b>${u.rock}</b>`) + `</div></div>`;
    if (!v.log.length) {
      h += `<div class="mn-lempty">${L("입구에서 금까지 굴을 이으세요. 초록 점선 칸이 지금 굴 끝입니다.<br>도구가 하나라도 고장 나면 길 카드를 놓을 수 없습니다.",
        "Dig from the entrance to the gold. Green dashed cells are the current tunnel ends.<br>With any broken tool you can't place path cards.")}</div>`;
    } else {
      h += "<ol>";
      for (let i = v.log.length - 1; i >= 0; i--) {
        const x = v.log[i];
        const role = v.roles ? `<span class="mn-rtag ${v.roles[x.p]}">${roleTag(v.roles[x.p], false)}</span>` : "";
        h += `<li class="${x.p === m.me ? "me" : ""}">${avatarHTML(nm[x.p], x.p, "sm mn-av")}<b>${x.p === m.me ? meName() : esc(nm[x.p])}</b>${role}${actHTML(x, false)}</li>`;
      }
      h += "</ol>";
    }
    box.innerHTML = h;
  }

  /* ---------- Hand ---------- */
  function cardFace(c, r) {
    if (c.t === "path") return `<span class="mn-mini${c.c ? "" : " dead"}" style="transform:rotate(${r}deg)">${tunnelSVG(vert ? tp(c.e) : c.e, c.c)}</span><small>${c.c ? L("길", "Path") : L("막힘", "Dead end")}</small>`;
    if (c.t === "break") return `<span class="mn-ic">${bk(c.tool, true)}</span><small>${L("고장", "Break")}</small>`;
    if (c.t === "fix") return `<span class="mn-ic fix">🔧${c.tools.map(t => TOOL_ICON[t]).join(c.tools.length > 1 ? "<i>/</i>" : "")}</span><small>${c.tools.length > 1 ? L("하나 수리", "Fix one") : L("수리", "Repair")}</small>`;
    if (c.t === "map") return `<span class="mn-ic">🗺️</span><small>${L("지도", "Map")}</small>`;
    return `<span class="mn-ic">🪨</span><small>${L("낙석", "Rockfall")}</small>`;
  }
  function hand(m) {
    const v = m.v, box = R("hand"), mt = myTurn();
    // Card size is fixed by the starting hand size — the board doesn't jump when hands shrink after the deck runs out
    box.style.setProperty("--hn", v.n <= 5 ? 6 : v.n <= 7 ? 5 : 4);
    box.innerHTML = "";
    if (!v.hand.length) { box.innerHTML = `<span class="mn-card mn-ph"></span><div class="mn-empty">${v.phase === "play" ? L("손패가 없습니다 — 라운드가 끝나길 기다려요", "No cards left — waiting for the round to end") : ""}</div>`; return; }
    for (const c of v.hand) {
      const no = why(v, c);
      const b = el("button", "mn-card t-" + c.t + (c.id === sel ? " sel" : "") + (no ? " dim" : mt ? " can" : ""), cardFace(c, c.id === sel ? rot : 0));
      if (no) b.insertAdjacentHTML("beforeend", `<em class="mn-why">${no[0]}</em>`);
      else if (c.t === "path" && v.phase === "play") b.insertAdjacentHTML("beforeend", `<em class="mn-cnt" title="${L("놓을 수 있는 자리", "Legal spots")}">${spotCount(v, c)}</em>`);
      b.setAttribute("aria-label", loc(cardNameTx(c)) + (no ? ` — ${no[0]}` : ""));
      b.dataset.id = c.id;
      b.onclick = () => pickCard(c.id);
      box.appendChild(b);
    }
  }
  /* Landscape: the side column (info · goals · hint · hand · buttons) must fit the short height of a phone held
     sideways, even under a replay bar — shrink the hand cards by what doesn't fit */
  function fitHand() {
    const hb = R("hand");
    hb.style.removeProperty("--cwmax");
    if (!land()) return;
    const side = wrap.clientHeight - R("seats").offsetHeight;
    const used = wrap.querySelector(".mn-bar").offsetHeight + wrap.querySelector(".mn-goals").offsetHeight + wrap.querySelector(".mn-dock").offsetHeight;
    const card = hb.querySelector(".mn-card");
    if (used <= side || !card) return;
    const w = Math.floor((card.offsetHeight - (used - side) - 1) * 50 / 66);
    hb.style.setProperty("--cwmax", Math.max(28, Math.min(66, w)) + "px");
  }
  function pickCard(id) {
    if (!last || last.v.phase !== "play" || last.replay) return;   // a replay only shows the hand
    if (sel === id) { sel = null; ghost = null; }
    else {
      sel = id; ghost = null;
      const c = selCard();
      if (c && c.t === "path") rot = spotsFor(last.v, c, 0).length || !spotsFor(last.v, c, 180).length ? 0 : 180;
    }
    ctx.sound.deal();
    render(last, null);
  }

  /* ---------- Bottom buttons · hint ---------- */
  function dock(m) {
    const v = m.v, acts = R("acts"), mt = myTurn(), c = selCard(), nm = names();
    acts.innerHTML = "";
    let hint = "";
    const btn = (label, cls, on, disabled) => {
      const b = el("button", "btn small " + (cls || ""), label);
      b.onclick = on; if (disabled) b.disabled = true;
      acts.appendChild(b);
      return b;
    };
    const no = c ? why(v, c) : null;
    const ROT = L("↻ 회전", "↻ Rotate"), DIS = L("버리기", "Discard");
    acts.hidden = !!m.replay;                         // a replay has nothing to press
    if (v.phase !== "play") hint = v.phase === "end" ? L("라운드 끝 — 잠시 뒤 다음 라운드가 시작됩니다", "Round over — the next round starts shortly") : L("게임 끝", "Game over");
    else if (m.replay) {
      const who = esc(nm[v.turn]);
      hint = L(`🎬 <b>${who}</b> 님 차례`, `🎬 <b>${who}</b>'s turn`);
      if (brokenMe(v)) hint += L(" · 이 사람의 도구가 고장 나 있습니다", " · this player's tools are broken");
    } else if (!mt) {
      const who = esc(nm[v.turn]);
      hint = L(`<b>${who}</b> 님 차례`, `<b>${who}</b>'s turn`) + (c ? (no ? ` · ${no[1]}` : c.t === "path" ? L(` · 미리 보기: 놓을 자리 <b>${spotCount(v, c)}</b>곳`, ` · Preview: <b>${spotCount(v, c)}</b> spots`)
        : L(" · 카드를 골라 두었어요", " · Card selected"))
        : brokenMe(v) ? L(" · 내 도구가 고장 나 있습니다", " · Your tools are broken") : L(" · 카드를 눌러 놓을 자리를 미리 볼 수 있어요", " · Tap a card to preview where it fits"));
      btn(ROT, "", () => { rot = rot ? 0 : 180; ctx.sound.tick(); render(last, null); }, !c || c.t !== "path" || c.e === rot180(c.e) || !!no);
      btn(DIS, "", null, true);
    } else if (!c) {
      const bks = v.broken[m.me].map(t => bk(t)).join("");
      hint = brokenMe(v) ? L(`<b>내 차례</b> — 도구가 부서져 길은 못 놓아요 (${bks}). 수리 · 행동 카드를 내거나 한 장 버리세요`,
        `<b>Your turn</b> — broken tools (${bks}), no paths. Play a repair or action card, or discard one`)
        : L("<b>내 차례</b> — 카드를 골라 내거나, 한 장 버리세요", "<b>Your turn</b> — pick a card to play, or discard one");
      btn(ROT, "", null, true);
      btn(DIS, "", null, true);
    } else {
      const discard = () => send({ discard: c.id });
      if (c.t === "path") {
        const here = spotsFor(v, c, rot).length, other = spotsFor(v, c, rot ? 0 : 180).length, sym = c.e === rot180(c.e);
        hint = no ? no[1]
          : ghost ? L("미리 보기 — 같은 칸을 한 번 더 누르거나 「놓기」", "Preview — tap the same cell again or “Place”")
            : here ? L(`놓을 자리 <b>${here}</b>곳 — 초록 칸을 누르세요`, `<b>${here}</b> spot${here > 1 ? "s" : ""} — tap a green cell`)
              + (!sym && other ? L(` · 「회전」하면 ${other}곳`, ` · “Rotate” for ${other}`) : "")
              : L(`이 방향으로는 놓을 곳이 없어요 — 「회전」하면 <b>${other}</b>곳`, `No spot this way round — “Rotate” for <b>${other}</b>`);
        btn(ROT, "", () => {
          rot = rot ? 0 : 180;
          if (ghost && !spotsFor(v, c, rot).some(s => s[0] === ghost.x && s[1] === ghost.y)) ghost = null;
          ctx.sound.tick();
          render(last, null);
        }, sym || brokenMe(v));
        btn(DIS, "", discard);
        btn(L("놓기", "Place"), "primary", confirm, !ghost);
      } else if (c.t === "break") {
        const ts = breakTargets(v, c), T = TOOL_NAME[c.tool];
        hint = ts.length ? L(`${TOOL_ICON[c.tool]} ${josa(T.ko, "을", "를")} 망가뜨릴 사람을 고르세요 (이름표를 눌러도 됩니다)`,
          `Choose whose ${TOOL_ICON[c.tool]} ${T.en} to break (or tap their name chip)`) : no[1];
        btn(DIS, "mn-dis", discard);                  // first, so Discard stays visible when many targets scroll sideways
        for (const p of ts) btn(`${avatarHTML(nm[p], p, "sm")} ${esc(nm[p])}`, "mn-tg", () => send({ break: c.id, target: p }));
      } else if (c.t === "fix") {
        const os = fixTargets(v, c);
        hint = os.length ? L("고칠 도구를 고르세요", "Choose a tool to repair") : no[1];
        btn(DIS, "mn-dis", discard);
        for (const o of os) btn(`${avatarHTML(nm[o.p], o.p, "sm")} ${o.p === m.me ? meName() : esc(nm[o.p])} ${TOOL_ICON[o.tool]}`, "mn-tg", () => send({ repair: c.id, target: o.p, tool: o.tool }));
      } else if (c.t === "map") {
        const gs = mapGoals(v);
        hint = gs.length ? L("몰래 볼 목표를 고르세요 (판의 목표를 눌러도 됩니다)", "Choose a goal to peek at (or tap it on the board)") : no[1];
        btn(DIS, "mn-dis", discard);
        for (let g = 0; g < 3; g++) btn(L(`${GOAL_NAME[g].ko} 목표`, `Goal ${GOAL_NAME[g].en}`), "mn-tg", () => send({ map: c.id, goal: g }), !gs.includes(g));
      } else if (c.t === "rock") {
        hint = no ? no[1] : ghost ? L("이 길을 무너뜨릴까요? 같은 칸을 한 번 더 누르거나 「무너뜨리기」", "Collapse this path? Tap the same cell again or “Collapse”")
          : L(`무너뜨릴 길(빨간 칸 ${rockCells(v).length}곳)을 고르세요`, `Choose a path to collapse (${rockCells(v).length} red cells)`);
        btn(DIS, "", discard);
        btn(L("무너뜨리기", "Collapse"), "primary", confirm, !ghost);
      }
    }
    R("hint").innerHTML = hint;
  }

  /* ---------- Round result ---------- */
  function overlay(m) {
    const v = m.v, box = R("over");
    if (v.phase === "play" || !v.res) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = overHidden;
    if (overHidden) return;
    const r = v.res, nm = names();
    const rows = m.players.map((pl, p) => `<li class="${p === m.me ? "me" : ""}">${avatarHTML(pl.name, p, "sm")}<span class="nm">${esc(pl.name)}</span>
      <span class="mn-rtag ${v.roles[p]}">${roleTag(v.roles[p], true)}</span>
      <span class="gain">${r.gains[p] ? "+" + r.gains[p] : "·"}</span><span class="tot">💰${v.gold[p]}</span></li>`).join("");
    const fin = esc(nm[r.finisher]), gn = GOAL_NAME[r.goldAt];
    box.innerHTML = `<div class="mn-ovbox ${r.winner}">
      <div class="eyebrow">${L(`${v.round}/${v.rounds} 라운드 결과`, `Round ${v.round}/${v.rounds} result`)}</div>
      <h3>${r.winner === "m" ? L("💰 광부 승리!", "💰 Miners win!") : L("😈 방해꾼 승리!", "😈 Traitors win!")}</h3>
      <p>${r.winner === "m" ? L(`<b>${fin}</b> 님이 금맥을 열었습니다`, `<b>${fin}</b> struck gold`) : L("금에 닿기 전에 카드가 바닥났습니다", "The cards ran out before anyone reached the gold")}${L(` · 금은 <b>${gn.ko}</b> 목표에`, ` · the gold was in goal <b>${gn.en}</b>`)}</p>
      <ul>${rows}</ul>
      <div class="mn-ovfoot"><span>${v.phase === "end" ? L("곧 다음 라운드 — 역할을 새로 나눕니다", "Next round soon — roles are dealt again") : L("최종 결과", "Final result")}</span><button class="btn small" data-r="hideov">${L("판 보기", "View board")}</button></div>
    </div>`;
    box.querySelector('[data-r="hideov"]').onclick = () => { overHidden = true; render(last, null); };
  }

  /* ---------- Drawing ---------- */
  function render(m, marks) {
    const sp = m.me < 0;
    wrap.classList.toggle("spec", sp);
    wrap.classList.toggle("rp", !!m.replay);
    // Tidy the selection: drop it outside a round or if the card left the hand. On others' turns only preview (no cell pick)
    if (m.v.phase !== "play" || m.replay || sp) { sel = null; ghost = null; }
    if (!myTurn()) ghost = null;
    const c = selCard();
    if (sel !== null && !c) { sel = null; ghost = null; }
    if (c && ghost) {
      const okSpot = c.t === "path" ? spotsFor(m.v, c, rot).some(s => s[0] === ghost.x && s[1] === ghost.y)
        : c.t === "rock" ? rockCells(m.v).some(t => t.x === ghost.x && t.y === ghost.y) : false;
      if (!okSpot) ghost = null;
    }
    // The board size comes from the remaining height, so draw the top and bottom first (spectators have no hand or dock)
    seats(m, marks); info(m); goalsLine(m);
    if (!sp) { hand(m); dock(m); }
    logPanel(m);
    const was = vert;
    board(m, marks);
    if (!sp && vert !== was) hand(m);          // once the board orientation is known, draw hand tiles the same way
    if (!sp) fitHand();
    overlay(m);
    // Landscape: the log has its own row in the side column — hide it when not even its header fits
    const lg = R("log");
    lg.style.visibility = land() && lg.clientHeight < 40 ? "hidden" : "";
  }
  function update(m) {
    last = m;
    let marks = null;
    if (m.ev && m.ev.length && !seen.has(m.ev)) { seen.add(m.ev); marks = effects(m); }
    busy = false;
    render(m, marks);
    if (marks) try { flights(m); } catch (e) { console.error(e); }
    prevHand = m.v.hand.map(c => c.id);
    prevDeck = m.v.deck;
  }

  /* ---------- Flying cards (only for new events — never on re-renders or replay jumps) ----------
     a tunnel card: from the player's chip (or the card I tapped) to its cell · a map: to the goal · a rockfall: to the
     collapsed cell · broken-tool and repair cards: to the target's chip · drawn cards: from the deck to my hand
     (or face down to the player's chip) */
  const flyCard = (html, cls, size) => `<span class="mn-fc ${cls || ""}"${size ? ` style="font-size:${size}px"` : ""}>${html}</span>`;
  function toChip(src, p, html, opt = {}) {
    const chip = R("seats").children[p];
    if (!chip || !src) return;
    const pad = el("span", "mn-pad");               // invisible landing spot in the middle of the chip
    chip.appendChild(pad);
    const hit = opt.hit && chip.classList.contains("mn-hit");
    if (hit) chip.classList.remove("mn-hit");       // the chip shakes when the card lands, not before
    const a = ctx.fly(src, pad, { html, ...opt });
    const rm = () => pad.remove();
    const shake = () => { if (hit) { chip.classList.remove("mn-hit"); void chip.offsetWidth; chip.classList.add("mn-hit"); } };
    if (!a) { rm(); shake(); return; }
    a.finished.then(() => { rm(); shake(); }, rm);
  }
  function flights(m) {
    if (!ctx.fly || document.hidden) return;         // a hidden page doesn't animate: no ghosts piling up
    const me = m.me, v = m.v, grid = R("grid"), chips = R("seats").children, deck = R("deck");
    const fr = R("frame").getBoundingClientRect();
    const inFrame = t => {                          // a cell scrolled out of the board frame gets no flight
      if (!t) return false;
      const r = t.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      return cx > fr.left && cx < fr.right && cy > fr.top && cy < fr.bottom;
    };
    const mine = flyFrom && Date.now() - flyFrom.t < 5000 ? flyFrom.rect : null;
    const drew = prevDeck !== null && v.deck < prevDeck;
    const icon = Math.round(curCs * .5);
    let acted = false;
    for (const e of m.ev) {
      if (e.p === undefined || !["path", "rock", "map", "break", "repair", "discard"].includes(e.type)) continue;
      acted = true;
      const fromMe = e.p === me && mine, src = fromMe ? mine : chips[e.p];
      if (e.p === me) flyFrom = null;
      if (e.type === "path") {
        const to = grid.querySelector(`[data-cell="${e.x},${e.y}"]`);
        if (inFrame(to)) {                          // the flight replaces the pop-in animation
          to.classList.remove("mn-new");
          if (!ctx.fly(src, to)) to.classList.add("mn-new");
        }
      } else if (e.type === "rock") {
        const to = grid.querySelector(`[data-dust="${e.x},${e.y}"]`);
        if (inFrame(to)) ctx.fly(src, to, { html: flyCard("🪨", "rock", icon) });
      } else if (e.type === "map") {
        const gl = v.goals[e.goal], to = gl && grid.querySelector(`[data-cell="${gl.x},${gl.y}"]`);
        if (inFrame(to)) ctx.fly(src, to, { html: flyCard("🗺️", "map", icon) });
      } else if (e.type === "break" || e.type === "repair") {
        const html = e.type === "break" ? flyCard(bk(e.tool, true), "break") : flyCard("🔧" + TOOL_ICON[e.tool], "repair");
        toChip(src, e.target, html, { hit: true, scale: fromMe ? 2 : undefined });
      }
      // The card drawn afterwards: someone else's goes face down to their chip (mine is flown into my hand below)
      if (drew && e.p !== me && deck) toChip(deck, e.p, flyCard("", "back"), { delay: 260, ms: 380 });
    }
    // Cards that just arrived in my hand: the draw after my turn, or a fresh deal for a new round
    if (prevHand && deck && (acted || m.ev.some(e => e.type === "newround"))) {
      let k = 0;
      for (const c of v.hand) {
        if (prevHand.includes(c.id)) continue;
        const b = R("hand").querySelector(`[data-id="${c.id}"]`);
        if (b) ctx.fly(deck, b, { delay: 200 + 70 * k++, ms: 380 });
      }
    }
  }

  function onResize() {
    if (window.innerWidth !== vertW) { vertW = window.innerWidth; vert = null; }   // height changes like a hiding address bar don't flip the board
    if (last) render(last, null);
  }
  vertW = window.innerWidth;
  window.addEventListener("resize", onResize);
  // The shell may also change the page zoom (screen size) without a window resize — redraw when our area changes size
  let roT = 0, roSize = "";
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
    const sz = wrap.clientWidth + "x" + wrap.clientHeight;
    if (sz === roSize) return;
    roSize = sz;
    cancelAnimationFrame(roT);
    roT = requestAnimationFrame(() => { if (last) render(last, null); });
  }) : null;
  if (ro) ro.observe(wrap);
  return {
    update, ticker: false, landscape: true,
    destroy() { window.removeEventListener("resize", onResize); if (ro) ro.disconnect(); cancelAnimationFrame(roT); clearTimeout(roleT); root.innerHTML = ""; }
  };
}
