/* Liar Game screen
   Portrait: round + phase steps · my secret card (category, my word or "you are the liar") · the players with their hints ·
   the dock (what to do now, the hint input, vote confirmation, the liar's word choices, the round history at the end).
   Landscape: the card and the dock on the left, the players on the right.
   Spectators (me = -1, a TV everybody can see) and replays: no input; the card shows only the category until the reveal.
   The hint input is never rebuilt while the game runs, so typing (and the phone keyboard) survives every update. */
import { L, loc } from "../../core/i18n.js";
import { MAX_HINT, normHint, hintLen, containsWord } from "./words.js";

const LANDSCAPE = "(orientation: landscape) and (min-aspect-ratio: 4/3)";   // same query as style.css
let DRAFT = { key: "", text: "" };      // my unsent hint survives a remount (language switch)
let HIDE = false;                       // my secret card covered (people looking over my shoulder)

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "lr");
  wrap.innerHTML = `
    <div class="lr-top" data-r="top"></div>
    <div class="lr-card" data-r="card"></div>
    <div class="lr-main felt" data-r="main">
      <div class="lr-strip" data-r="strip" hidden></div>
      <div class="lr-board" data-r="board"></div>
    </div>
    <div class="dock lr-dock" data-r="dock">
      <div class="lr-msg" data-r="msg"></div>
      <div class="lr-form" data-r="form" hidden>
        <div class="lr-inw"><input class="lr-in" data-r="in" type="text" maxlength="40" enterkeyhint="send" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
          <span class="lr-cnt" data-r="cnt"></span></div>
        <button class="btn primary lr-send" data-r="send" type="button"></button>
      </div>
      <div class="lr-err" data-r="err" hidden></div>
      <div class="lr-ctl" data-r="ctl"></div>
    </div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);
  const input = R("in"), sendBtn = R("send");
  let M = null, lastEv = null, sel = -1, selOpt = -1, selKey = "", sending = 0, composing = false, sendAfterIme = false;
  let flies = [], dramaT = 0, errT = 0;

  const nm = p => esc((M && M.players[p] ? M.players[p].name : "?"));
  const hintText = h => (typeof h === "string" ? h : loc(h));
  const wordText = w => (w ? loc(w) : "");
  const isLand = () => matchMedia(LANDSCAPE).matches;
  const myHintAsk = () => ctx.myAsk("hint");

  /* ---------- Top: round · phase steps ---------- */
  function top() {
    const v = M.v, ph = v.phase;
    const step = ph === "hint" ? 0 : ph === "vote" ? 1 : ["tally", "guess", "result"].includes(ph) ? 2 : -1;
    const pass = ph === "hint" && v.passes > 1 ? ` ${v.pass + 1}/${v.passes}` : "";
    const steps = [L("✍️ 힌트", "✍️ Hints") + pass, L("🗳️ 투표", "🗳️ Vote"), L("🕵️ 공개", "🕵️ Reveal")];
    let h = `<span class="lr-rnd">${ph === "over" ? L("최종", "Final") : L(`<b>${v.round || 1}</b>/${v.rounds} 라운드`, `Round <b>${v.round || 1}</b>/${v.rounds}`)}</span>`;
    if (ph !== "over") h += `<span class="lr-steps">${steps.map((s, i) => `<i class="${i === step ? "on" : i < step ? "done" : ""}">${s}</i>`).join("")}</span>`;
    if (v.fool) h += `<span class="lr-fool" title="${esc(L("바보 라이어", "Fool liar"))}">🤪</span>`;
    R("top").innerHTML = h;
  }

  /* ---------- My secret card ---------- */
  function card() {
    const v = M.v, me = M.me, box = R("card");
    const spec = me < 0;
    let cat = v.cat ? `<div class="lr-cat"><span class="lr-ci">${v.icon}</span><span><small>${L("주제", "Category")}</small><b>${esc(loc(v.cat))}</b></span></div>` : "";
    let sec;
    if (v.phase === "over") sec = `<div class="lr-sec done"><b>🏁 ${L("게임 끝", "Game over")}</b><small>${L(`${v.rounds}라운드를 모두 마쳤습니다`, `All ${v.rounds} rounds played`)}</small></div>`;
    else if (v.answer && (spec || v.liarMe)) sec = `<div class="lr-sec word"><small>${L("제시어", "The word")}</small><b>${esc(wordText(v.answer))}</b></div>`;
    else if (spec) sec = `<div class="lr-sec spec"><span class="lr-big">🤐</span><span><b>${L("제시어는 비밀", "The word is secret")}</b><small>${L("라운드가 끝나면 공개돼요", "Revealed at the end of the round")}</small></span></div>`;
    else if (v.liarMe) sec = `<div class="lr-sec liar"><span class="lr-big">🤫</span><span><b>${L("당신은 라이어입니다", "You are the liar")}</b><small>${v.phase === "guess" ? L("들켰어요 — 제시어를 맞혀 역전하세요!", "Caught — guess the word to win anyway!") : v.word ? L(`내가 받은 단어: ${esc(wordText(v.word))} (가짜!)`, `Your word was fake: ${esc(wordText(v.word))}`) : L("주제만 알아요 — 들키지 마세요", "You only know the category — don't get caught")}</small></span></div>`;
    else if (v.word) sec = `<div class="lr-sec word"><small>${L("내 제시어", "Your word")}</small><b>${esc(wordText(v.word))}</b></div>`;
    else sec = `<div class="lr-sec"><b>${L("곧 시작합니다", "Starting…")}</b></div>`;
    const peek = !spec && v.phase !== "over" && v.round ? `<button class="lr-peek" data-r="peek" aria-label="${esc(L("제시어 가리기", "Cover my card"))}">${HIDE ? "🙈" : "👁"}</button>` : "";
    box.innerHTML = cat + sec + peek;
    box.classList.toggle("hide", HIDE && !spec && v.phase !== "over");
    const pk = R("peek");
    if (pk) pk.onclick = () => { HIDE = !HIDE; card(); };
  }

  /* ---------- The players (seat order; the speaking order is numbered during the hints) ---------- */
  function board() {
    const v = M.v, me = M.me, ph = v.phase, n = M.players.length, box = R("board");
    const canVote = ph === "vote" && !!ctx.myAsk("vote");
    const shown = ["tally", "guess", "result"].includes(ph);
    const maxS = Math.max(...v.scores), rank = p => 1 + v.scores.filter(x => x > v.scores[p]).length;
    let h = "";
    for (let p = 0; p < n; p++) {
      const pl = M.players[p] || { name: "?" };
      const cls = ["lr-p"];
      if (p === me) cls.push("me");
      if (ph === "hint" && p === v.turn) cls.push("turn");
      if (canVote && p !== me) cls.push("can");
      if (canVote && p === sel) cls.push("sel");
      if (ph === "vote" && p === v.myVote) cls.push("myv");
      if (v.liar === p) cls.push("liar");
      if (shown && v.accused === p) cls.push("acc");
      if (ph === "result" && v.gains && v.gains[p]) cls.push("won");
      // badges on the avatar
      let badge = "";
      if (v.liar === p) badge = `<i class="lr-bd liar">🕵️</i>`;
      else if (ph === "hint" && p === v.turn) badge = `<i class="lr-bd turn">✍️</i>`;
      else if (ph === "vote" && v.voted[p]) badge = `<i class="lr-bd ok">✓</i>`;
      const ordN = ph === "hint" ? v.order.indexOf(p) + 1 : 0;
      const tag = pl.kind === "ai" ? `<span class="lr-tag">AI</span>` : pl.kind === "away" ? `<span class="lr-tag away">${L("비움", "away")}</span>` : "";
      const meTag = p === me ? `<span class="lr-metag">${L("나", "me")}</span>` : "";
      const sc = ph === "over" ? `<span class="lr-sc fin">${rank(p) === 1 ? "👑 " : ""}${v.scores[p]}<small>${L("점", "pt")}</small></span>`
        : `<span class="lr-sc">${v.scores[p]}<small>${L("점", "pt")}</small></span>`;
      // hints: the ones given, the one being written, empty slots for the rest
      const hs = v.hints[p] || [];
      let hh = hs.map((x, i) => `<q class="lr-h" data-i="${i}">${esc(hintText(x))}</q>`).join("");
      if (ph === "hint") {
        if (p === v.turn) hh += `<span class="lr-h wait"><i></i><i></i><i></i></span>`;
        for (let k = hs.length + (p === v.turn ? 1 : 0); k < v.passes; k++) hh += `<span class="lr-h slot"></span>`;
      }
      if (ph === "over") hh = `<span class="lr-fin">${L(`${rank(p)}등`, `#${rank(p)}`)}${maxS > 0 && v.scores[p] === maxS ? " 🏆" : ""}</span>`;
      // votes received (after everyone voted): one small avatar per voter
      let vt = "";
      if (shown && v.votes) {
        const from = v.votes.map((t, q) => (t === p ? q : -1)).filter(q => q >= 0);
        const show = from.slice(0, 4);
        if (from.length) vt = `<span class="lr-vt"><b>${from.length}</b>${show.map(q => `<span class="lr-tk" data-v="${q}">${avatarHTML(M.players[q].name, q, "lr-mini")}</span>`).join("")}` +
          `${from.length > show.length ? `<small>+${from.length - show.length}</small>` : ""}</span>`;
      }
      const gain = ph === "result" && v.gains && v.gains[p] ? `<em class="lr-gain">+${v.gains[p]}</em>` : "";
      const mine = ph === "vote" && p === v.myVote ? `<em class="lr-mine">${L("내 표", "my vote")}</em>` : "";
      const tagName = canVote && p !== me ? "button" : "div";
      h += `<${tagName} class="${cls.join(" ")}" data-p="${p}"${tagName === "button" ? ` type="button" aria-label="${esc(L(`${pl.name} 님에게 투표`, `Vote for ${pl.name}`))}"` : ""}>` +
        `<span class="lr-ph"><span class="lr-av" data-av="${p}">${avatarHTML(pl.name, p)}${badge}</span>` +
        `<span class="lr-nmw"><span class="lr-nm">${esc(pl.name)}</span>${meTag}${tag}</span>${ordN ? `<span class="lr-ord">${ordN}</span>` : ""}${mine}${gain}${sc}</span>` +
        `<span class="lr-hb"><span class="lr-hs">${hh}</span>${vt}</span></${tagName}>`;
    }
    box.innerHTML = h;
    if (canVote) for (const b of box.querySelectorAll("button.lr-p")) b.onclick = () => {
      const p = +b.dataset.p;
      sel = sel === p ? -1 : p;
      ctx.sound.flip();
      board(); dock(); fit();
    };
  }

  /* ---------- Strip above the players: vote result · unmasked liar · round result · final ---------- */
  function strip() {
    const v = M.v, ph = v.phase, box = R("strip");
    let h = "", cls = "";
    if (ph === "tally") {
      h = v.accused >= 0 ? `🗳️ ${L(`<b>${nm(v.accused)}</b> 님이 <b>${v.tally[v.accused]}표</b>로 지목됐습니다`, `<b>${nm(v.accused)}</b> is accused with <b>${v.tally[v.accused]}</b> vote${v.tally[v.accused] === 1 ? "" : "s"}`)} — ${L("과연 라이어일까요…?", "is it the liar…?")}`
        : `🗳️ ${L("<b>동점!</b> 아무도 지목되지 않았습니다", "<b>A tie!</b> Nobody is accused")}`;
      cls = "tally";
    } else if (ph === "guess") {
      h = `🕵️ ${L(`라이어는 <b>${nm(v.liar)}</b> 님! 들켰습니다 — 제시어를 맞히면 역전`, `The liar is <b>${nm(v.liar)}</b>! Caught — but a right guess still wins`)}`;
      cls = "guess";
    } else if (ph === "result") {
      const lw = v.winner === "liar";
      const how = !v.caught ? (v.accused >= 0 ? L(`엉뚱한 사람(${nm(v.accused)})이 지목됐어요`, `the wrong person (${nm(v.accused)}) was accused`) : L("동점이라 아무도 지목 안 됨", "nobody was accused (tie)"))
        : (lw ? L(`들켰지만 「${esc(wordText(v.opts[v.pick]))}」 정답!`, `caught, but guessed "${esc(wordText(v.opts[v.pick]))}"!`) : L(`추측 「${esc(wordText(v.opts[v.pick]))}」 땡!`, `guessed "${esc(wordText(v.opts[v.pick]))}" — wrong!`));
      h = `<span class="lr-win">${lw ? L("🕵️ 라이어 승리", "🕵️ The liar wins") : L("🎉 시민 승리", "🎉 Citizens win")}</span>` +
        `<span class="lr-res">${L("제시어", "Word")} <b>${esc(wordText(v.answer))}</b> · ${L("라이어", "Liar")} <b>${nm(v.liar)}</b> · ${how}` +
        (v.fake ? ` · ${L(`라이어의 단어 「${esc(wordText(v.fake))}」`, `liar's word "${esc(wordText(v.fake))}"`)}` : "") + `</span>`;
      cls = lw ? "result lw" : "result cw";
    } else if (ph === "over") {
      const top = Math.max(...v.scores), win = v.scores.map((s, p) => (s === top ? p : -1)).filter(p => p >= 0);
      h = `🏆 ${L(`우승: <b>${win.map(nm).join(", ")}</b> (${top}점)`, `Winner${win.length > 1 ? "s" : ""}: <b>${win.map(nm).join(", ")}</b> (${top} pt)`)}`;
      cls = "over";
    }
    box.hidden = !h;
    box.className = "lr-strip " + cls;
    box.innerHTML = h;
  }

  /* ---------- Dock: message · hint input · vote confirm · word choices · history ---------- */
  function hintError(t) {
    if (!t) return L("힌트를 적어 주세요", "Type a hint");
    if (hintLen(t) > MAX_HINT) return L(`${MAX_HINT}자까지만 쓸 수 있어요`, `At most ${MAX_HINT} characters`);
    if (M.v.word && containsWord(t, M.v.word)) return L("제시어는 힌트에 쓸 수 없어요", "You can't use the word itself");
    return "";
  }
  function counter() {
    const t = normHint(input.value), n = hintLen(t);
    const c = R("cnt");
    c.textContent = `${n}/${MAX_HINT}`;
    c.classList.toggle("over", n > MAX_HINT);
    const mine = !!myHintAsk();
    sendBtn.disabled = !mine || !t || n > MAX_HINT || Date.now() < sending;
  }
  function showErr(t) {
    const e = R("err");
    e.textContent = t; e.hidden = !t;
    clearTimeout(errT);
    if (t) errT = setTimeout(() => { e.hidden = true; }, 3500);
  }
  function trySend() {
    if (!M || !myHintAsk() || Date.now() < sending) return;
    const t = normHint(input.value), err = hintError(t);
    if (err) { showErr(err); ctx.sound.bad(); ctx.buzz(40); return; }
    if (ctx.send({ hint: t })) { sending = Date.now() + 1500; showErr(""); input.blur(); counter(); setTimeout(counter, 1600); }
  }
  input.addEventListener("input", () => { DRAFT.text = input.value; counter(); if (!R("err").hidden) showErr(""); });
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; if (sendAfterIme) { sendAfterIme = false; setTimeout(trySend, 0); } counter(); });
  input.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (e.isComposing || composing) { sendAfterIme = true; return; }
    if (myHintAsk()) trySend(); else input.blur();
  });
  input.addEventListener("focus", () => { wrap.classList.add("typing"); setTimeout(onResize, 50); setTimeout(onResize, 400); });
  input.addEventListener("blur", () => { setTimeout(() => { if (document.activeElement !== input && wrap.classList.contains("typing")) { wrap.classList.remove("typing"); fit(); } }, 120); });
  sendBtn.addEventListener("pointerdown", e => e.preventDefault());     // keep the keyboard up until the hint is sent
  sendBtn.addEventListener("click", trySend);

  function draftKey() { const v = M.v; return `${M.run || ""}|${v.round}|${(v.hints[M.me] || []).length}`; }

  function dock() {
    const v = M.v, me = M.me, ph = v.phase, spec = me < 0;
    const msg = R("msg"), form = R("form"), ctl = R("ctl");
    const hintAsk = myHintAsk(), voteAsk = ctx.myAsk("vote"), guessAsk = ctx.myAsk("guess");
    // Hint input: shown while I still owe a hint this round (type ahead), sendable on my turn
    const owe = ph === "hint" && me >= 0 && !M.replay && !spec && (v.hints[me] || []).length < v.passes;
    form.hidden = !owe;
    if (owe) {
      const key = draftKey();
      if (DRAFT.key !== key) { DRAFT = { key, text: "" }; input.value = ""; }
      else if (input.value !== DRAFT.text && document.activeElement !== input) input.value = DRAFT.text;
      input.placeholder = hintAsk ? L("힌트 한두 단어", "1–2 word hint") : L("미리 적어 두기", "Type ahead");
      sendBtn.textContent = hintAsk ? L("보내기", "Send") : L("대기", "Wait");
      counter();
    } else if (document.activeElement === input) input.blur();
    if (!owe) showErr("");

    let t = "";
    ctl.innerHTML = "";
    ctl.className = "lr-ctl";
    if (ph === "start") t = L("곧 첫 라운드가 시작됩니다…", "The first round is about to start…");
    else if (ph === "hint") {
      if (hintAsk) t = v.liarMe ? L("<b>내 차례!</b> 아는 척 그럴듯한 힌트를 적으세요 🤫", "<b>Your turn!</b> Bluff — type a hint that sounds right 🤫")
        : L("<b>내 차례!</b> 제시어를 설명하는 힌트를 적으세요 (너무 쉬우면 라이어가 눈치채요)", "<b>Your turn!</b> Describe the word (too obvious and the liar catches on)");
      else t = L(`✍️ <b>${nm(v.turn)}</b> 님이 힌트를 생각하는 중…`, `✍️ <b>${nm(v.turn)}</b> is thinking of a hint…`) +
        (owe ? ` <small>${L(`내 차례까지 ${turnsUntil(me)}명`, `${turnsUntil(me)} before you`)}</small>` : "");
    } else if (ph === "vote") {
      const k = v.voted.filter(Boolean).length, N = v.voted.length;
      if (voteAsk) {
        if (sel >= 0 && sel !== me) {
          t = L(`<b>${nm(sel)}</b> 님이 라이어라고 생각하나요?`, `Do you think <b>${nm(sel)}</b> is the liar?`);
          ctl.className = "lr-ctl lr-row";
          const no = el("button", "btn lr-cancel", L("취소", "Cancel"));
          no.onclick = () => { sel = -1; render(); };
          const yes = el("button", "btn primary lr-go", `🗳️ ${L(`${nm(sel)} 님에게 투표`, `Vote for ${nm(sel)}`)}`);
          yes.onclick = () => { if (ctx.myAsk("vote") && sel >= 0) { const s = sel; if (ctx.send({ vote: s })) { ctx.sound.chip(); sel = -1; yes.disabled = true; } } };
          ctl.append(no, yes);
        } else t = (v.liarMe ? L("🤫 <b>라이어도 투표합니다</b> — 다른 사람에게 의심을 돌리세요. ", "🤫 <b>The liar votes too</b> — point at someone else. ")
          : L("🗳️ <b>누가 라이어일까요?</b> ", "🗳️ <b>Who is the liar?</b> ")) + L("의심 가는 사람을 누르세요", "Tap the player you suspect") + ` <small>(${k}/${N})</small>`;
      } else if (spec || M.replay) t = L(`🗳️ 모두 투표하는 중… <b>${k}/${N}</b>`, `🗳️ Everyone is voting… <b>${k}/${N}</b>`);
      else t = v.myVote >= 0 ? L(`✓ <b>${nm(v.myVote)}</b> 님에게 투표했습니다 · 다른 사람 기다리는 중 <b>${k}/${N}</b>`, `✓ You voted for <b>${nm(v.myVote)}</b> · waiting for the others <b>${k}/${N}</b>`)
        : L(`🗳️ 투표 중 <b>${k}/${N}</b>`, `🗳️ Voting <b>${k}/${N}</b>`);
    } else if (ph === "tally") t = L("🥁 라이어를 공개합니다…", "🥁 Unmasking the liar…");
    else if (ph === "guess" || ph === "result") {
      if (ph === "guess") t = guessAsk ? L("<b>제시어를 맞혀 보세요!</b> 맞히면 라이어 역전승", "<b>Guess the word!</b> A right guess wins the round")
        : L(`🤔 <b>${nm(v.liar)}</b> 님이 제시어를 고르는 중…`, `🤔 <b>${nm(v.liar)}</b> is picking the word…`);
      else t = resultLine();
      if (v.opts) options(ctl, !!guessAsk);
    } else if (ph === "over") {
      t = L("🏁 게임 끝 — 라운드 기록", "🏁 Game over — the rounds");
      history(ctl);
    }
    msg.innerHTML = t;
  }
  function turnsUntil(p) {
    const v = M.v, n = v.order.length;
    const a = v.order.indexOf(v.turn), b = v.order.indexOf(p);
    return (b - a + n) % n;
  }
  function resultLine() {
    const v = M.v, me = M.me;
    if (me < 0) return v.winner === "liar" ? L("🕵️ 라이어 승리! 다음 라운드 준비 중…", "🕵️ The liar wins! Next round coming up…") : L("🎉 시민 승리! 다음 라운드 준비 중…", "🎉 The citizens win! Next round coming up…");
    const won = !!(v.gains && v.gains[me]);
    const g = won ? v.gains[me] : 0;
    return (won ? L(`🎉 이겼습니다! <b>+${g}점</b>`, `🎉 You won the round! <b>+${g}</b>`) : L("😢 이번 라운드는 졌습니다", "😢 You lost this round")) +
      ` <small>${v.round < v.rounds ? L("다음 라운드 준비 중…", "Next round coming up…") : L("마지막 라운드였습니다", "That was the last round")}</small>`;
  }
  /* The liar's word choices: tappable for the liar, shown to everyone (the answer marked only for those who know it) */
  function options(ctl, mine) {
    const v = M.v, ph = v.phase, know = (M.me >= 0 && !v.liarMe && v.word) || ph === "result";
    const ans = ph === "result" ? v.answer : know ? v.word : null;
    const key = `${v.round}|${M.run || ""}`;
    if (selKey !== key) { selKey = key; selOpt = -1; }
    const grid = el("div", "lr-opts" + (mine ? " mine" : ""));
    v.opts.forEach((w, i) => {
      const b = el("button", "lr-opt", esc(wordText(w)));
      b.type = "button";
      b.dataset.i = i;
      if (ans && w.ko === ans.ko) b.classList.add("ans");
      if (ph === "result" && i === v.pick) b.classList.add(v.answer && w.ko === v.answer.ko ? "hit" : "miss");
      if (mine && i === selOpt) b.classList.add("sel");
      b.disabled = !mine;
      b.onclick = () => { selOpt = selOpt === i ? -1 : i; ctx.sound.flip(); dock(); fit(); };
      grid.appendChild(b);
    });
    ctl.appendChild(grid);
    if (mine) {
      const go = el("button", "btn primary lr-go wide", selOpt >= 0 ? L(`「${esc(wordText(v.opts[selOpt]))}」(으)로 확정`, `Guess "${esc(wordText(v.opts[selOpt]))}"`) : L("보기를 하나 고르세요", "Pick one"));
      go.disabled = selOpt < 0;
      go.onclick = () => { if (selOpt >= 0 && ctx.myAsk("guess")) { if (ctx.send({ pick: selOpt })) go.disabled = true; } };
      ctl.appendChild(go);
    }
  }
  function history(ctl) {
    const v = M.v;
    const ul = el("div", "lr-hist");
    v.past.forEach((r, i) => {
      const lw = r.winner === "liar";
      ul.insertAdjacentHTML("beforeend", `<div class="lr-hr ${lw ? "lw" : "cw"}"><span class="lr-hn">${i + 1}</span><span class="lr-hc">${r.icon}</span>` +
        `<span class="lr-hw"><b>${esc(wordText(r.word))}</b>${r.fake ? ` <small>(${esc(wordText(r.fake))})</small>` : ""}</span>` +
        `<span class="lr-hl">🕵️ ${nm(r.liar)}</span><span class="lr-hv">${lw ? L("라이어 승", "liar") : L("시민 승", "citizens")}${r.caught && r.guess ? (lw ? " ✓" : " ✗") : ""}</span></div>`);
    });
    ctl.appendChild(ul);
  }

  /* ---------- Fitting: the players fill the space that is left ---------- */
  function fit() {
    if (!M) return;
    const box = R("board"), n = M.players.length;
    box.style.gridAutoRows = "";
    const W = box.clientWidth, H = box.clientHeight;
    if (!W || !H) return;
    const gap = 6, land = isLand(), passes = M.v.passes || 1;
    const minH = wrap.classList.contains("typing") ? 40 : 48 + (passes > 1 ? 8 : 0);
    let best = null;
    for (let cols = 1; cols <= 4; cols++) {
      const rows = Math.ceil(n / cols);
      const tw = (W - gap * (cols - 1)) / cols, th = (H - gap * (rows - 1)) / rows;
      if (cols > 1 && tw < (land ? 135 : 150)) break;
      const sc = Math.min(tw / (land ? 2.1 : 2.4), th);
      if (!best || sc > best.sc + 2) best = { cols, rows, tw, th, sc };
      if (rows === 1) break;
    }
    const maxH = Math.min(190, 70 + H / 4);
    const th = Math.max(minH, Math.min(best.th, maxH));
    box.style.gridTemplateColumns = `repeat(${best.cols}, minmax(0, 1fr))`;
    box.style.gridAutoRows = th + "px";
    box.classList.toggle("scroll", best.th < minH);
    const k = Math.max(.8, Math.min(1.9, th / 62, best.tw / 175));
    box.style.setProperty("--k", k.toFixed(3));
    box.classList.toggle("wide", best.tw >= 250 && th < 58 * k);      // too short for two lines: name and hints side by side
    box.classList.toggle("tall", th > 88 * k);                          // room for a second line of hints
  }

  /* ---------- Drama: the liar is unmasked / the guess lands ---------- */
  function drama(html, cls, ms) {
    const main = R("main");
    main.querySelectorAll(".lr-drama").forEach(x => x.remove());
    const d = el("div", "lr-drama " + cls, `<div class="lr-dr-in">${html}</div>`);
    d.onclick = () => d.remove();
    main.appendChild(d);
    clearTimeout(dramaT);
    dramaT = setTimeout(() => d.remove(), ms);
  }

  /* ---------- Events: sounds, flying tokens, drama ---------- */
  function events(m) {
    const me = m.me;
    flies = [];
    for (const e of m.ev) {
      if (e.type === "round") { ctx.sound.flip(); sel = -1; selOpt = -1; R("card").classList.remove("pop"); void R("card").offsetWidth; R("card").classList.add("pop"); }
      else if (e.type === "hint") {
        ctx.sound.place();
        if (e.p === me) { DRAFT.text = ""; input.value = ""; sending = 0; }
        flies.push(() => {
          const t = R("board").querySelector(`.lr-p[data-p="${e.p}"] .lr-h[data-i="${(m.v.hints[e.p] || []).length - 1}"]`);
          const f = R("board").querySelector(`.lr-p[data-p="${e.p}"] .lr-av`);
          if (t && f) ctx.fly(f, t, { ms: 380 });
          if (t) t.classList.add("new");
        });
      } else if (e.type === "vote") { sel = -1; }
      else if (e.type === "voted") {
        if (e.p !== me) ctx.sound.chip();
        flies.push(() => { const b = R("board").querySelector(`.lr-p[data-p="${e.p}"] .lr-bd.ok`); if (b) b.classList.add("pop"); });
      } else if (e.type === "votes") {
        flies.push(() => {
          const B = R("board"), gap = Math.max(70, Math.min(170, 1500 / e.votes.length));
          e.votes.forEach((t, q) => {
            const tile = B.querySelector(`.lr-p[data-p="${t}"]`), f = B.querySelector(`.lr-p[data-p="${q}"] .lr-av`);
            const to = tile && (tile.querySelector(`.lr-tk[data-v="${q}"]`) || tile.querySelector(".lr-vt b"));
            const delay = 150 + q * gap;
            if (f && to) ctx.fly(f, to, { ms: 520, delay, scale: 1.8 });
            setTimeout(() => ctx.sound.deal(), delay + 480);
          });
        });
      } else if (e.type === "unmask") {
        const pl = m.players[e.liar] || { name: "?" };
        const res = m.ev.find(x => x.type === "result");
        const iAmLiar = e.liar === me;
        const word = res && m.v.answer ? `<div class="lr-dr-word">${L("제시어", "The word")} <b>${esc(wordText(m.v.answer))}</b></div>` : "";
        const good = iAmLiar ? !e.caught : e.caught;          // good news for whoever is looking (spectators: the catch)
        const line = iAmLiar ? (e.caught ? L("들켰다! 😱 제시어를 맞히면 역전", "Caught! 😱 Guess the word to win") : L("완벽하게 속였다! 😎", "You fooled them all! 😎"))
          : me < 0 ? (e.caught ? L("딱 걸렸다! 🎯", "Caught! 🎯") : L("아무도 못 찾았다! 😎", "Got away with it! 😎"))
          : (e.caught ? L("딱 걸렸다! 🎯", "Caught! 🎯") : L("놓쳤다… 😵", "It got away… 😵"));
        drama(`<small>${L("라이어는…", "The liar is…")}</small><div class="lr-dr-who">${avatarHTML(pl.name, e.liar, "xl")}<b>${esc(pl.name)}${iAmLiar ? L(" (나)", " (me)") : ""}</b></div>` +
          `<em>${line}</em>${word}`, good || me < 0 ? "good" : "bad", 4200);
        ctx.sound.flip();
        setTimeout(() => {
          if (me < 0) ctx.sound.good();
          else if (iAmLiar) (e.caught ? ctx.sound.bad() : ctx.sound.good());
          else (e.caught ? ctx.sound.good() : ctx.sound.bad());
        }, 1000);
      } else if (e.type === "guess") {
        const w = m.v.opts && m.v.opts[e.pick];
        const liarMe = e.p === me, good = liarMe ? e.right : !e.right;
        const line = liarMe ? (e.right ? L("정답! 역전승 🎉", "Correct! You win the round 🎉") : L("땡! 아깝다 😢", "Wrong — so close 😢"))
          : (e.right ? L("정답! 라이어 역전승 🕵️", "Correct! The liar wins 🕵️") : L("땡! 시민 승리 🎉", "Wrong! The citizens win 🎉"));
        drama(`<small>${L("라이어의 추측", "The liar's guess")}</small><div class="lr-dr-g">${esc(wordText(w))}</div>` +
          `<em>${line}</em><div class="lr-dr-word">${L("제시어", "The word")} <b>${esc(wordText(m.v.answer))}</b></div>`, (good || me < 0 ? "good" : "bad") + " now", 3600);
        if (me < 0) ctx.sound.good(); else if (liarMe === e.right) ctx.sound.good(); else ctx.sound.bad();
        flies.push(() => {
          const t = R("ctl").querySelector(`.lr-opt[data-i="${e.pick}"]`), f = R("board").querySelector(`.lr-p[data-p="${e.p}"] .lr-av`);
          if (t && f) ctx.fly(f, t, { ms: 450 });
        });
      }
    }
  }

  function render() {
    if (!M) return;
    wrap.classList.toggle("spec", M.me < 0);
    wrap.classList.toggle("en", L(false, true));
    wrap.dataset.phase = M.v.phase;
    top(); card(); strip(); board(); dock();
    fit();
  }
  function update(m) {
    const again = m === M || m.ev === lastEv;
    if (M && m.v.phase !== M.v.phase && m.v.phase !== "vote") sel = -1;
    M = m;
    if (M.v.phase !== "vote" || !ctx.myAsk("vote")) sel = -1;
    if (!again) { lastEv = m.ev; events(m); }
    render();
    if (!again && m.ev.length) { const f = flies; flies = []; requestAnimationFrame(() => f.forEach(x => { try { x(); } catch (e) { console.error(e); } })); }
  }
  let rzT = 0;
  function onResize() { clearTimeout(rzT); rzT = setTimeout(() => { if (M) fit(); }, 60); }
  window.addEventListener("resize", onResize);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize);

  return {
    update,
    ticker: false,           // the board shows every hint and the dock says what's happening
    landscape: true,
    destroy() {
      window.removeEventListener("resize", onResize);
      if (window.visualViewport) window.visualViewport.removeEventListener("resize", onResize);
      clearTimeout(dramaT); clearTimeout(errT); clearTimeout(rzT);
      root.innerHTML = "";
    }
  };
}
