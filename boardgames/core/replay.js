/* Replays. The host records each game's seed and every move (Runner.log in core/host.js: 0 = step(), [p, action] = apply()).
   Because the engines are deterministic (all randomness lives in S.rs), running the same moves from the same seed rebuilds
   every position. Frames are views from one seat's point of view (or -1, the public view), so a replay shows what that
   person saw; after the game any seat's view can be chosen.
   Recent replays are kept on this device (localStorage "replays"). */
import { LS } from "./ui.js";

const KEEP = 6;

/* data: {game, run, seed, n, opts, log, players, at}. me: the seat to view from. Returns [{v, ev, step, over, results}] */
export function buildFrames(E, data, me) {
  const S = E.setup({ n: data.n, seed: data.seed, settings: data.opts || {} });
  const frames = [];
  const viewOf = ev => {
    const over = E.over(S);
    const evs = (ev || []).map(e => (E.filterEvent ? E.filterEvent(e, me, S) : e)).filter(Boolean);
    // The header line: the engine's status is written for the seat ("Your turn …"), so replays use the public view's line
    // (games with spectators) or simply whose turn it is
    let status = null;
    if (E.spectate) try { status = E.view(S, -1).status || null; } catch (e) { }
    const pend = over ? [] : E.pending(S).filter(x => !x.secret);
    return { v: JSON.parse(JSON.stringify(E.view(S, me))), ev: evs, over, results: over ? E.results(S) : null, status, turn: pend.length ? pend[0].p : -1 };
  };
  frames.push({ ...viewOf([]), step: true });
  for (const x of data.log) {
    let ev;
    if (x === 0) ev = E.step(S) || [];
    else ev = E.apply(S, x[0], x[1]) || [];
    frames.push({ ...viewOf(ev), step: x === 0 });
  }
  return frames;
}

export function saveReplay(data) {
  if (!data || !data.log) return;
  try {
    const list = LS.json("replays", []).filter(r => r.run !== data.run);
    list.unshift(data);
    // localStorage is small: keep the newest few, and drop the oldest if it still doesn't fit
    for (let k = Math.min(list.length, KEEP); k > 0; k--) {
      try { localStorage.setItem("bg.replays", JSON.stringify(list.slice(0, k))); return; } catch (e) { }
    }
  } catch (e) { }
}
export const savedReplays = () => LS.json("replays", []);
