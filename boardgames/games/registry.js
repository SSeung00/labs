/* Game list. New game: create games/<id>/engine.js, ui.js and style.css, then add one line here. */
import oldmaid from "./oldmaid/engine.js";
import onecard from "./onecard/engine.js";
import poker from "./poker/engine.js";
import gems from "./gems/engine.js";
import mine from "./mine/engine.js";
import gostop from "./gostop/engine.js";
import dalmuti from "./dalmuti/engine.js";
import yacht from "./yacht/engine.js";
import liar from "./liar/engine.js";
import liardice from "./liardice/engine.js";
import codebreak from "./codebreak/engine.js";

const base = new URL(".", import.meta.url).href;
const entry = engine => ({ id: engine.id, engine, ui: `${base}${engine.id}/ui.js`, css: `${base}${engine.id}/style.css` });

export const GAMES = [dalmuti, oldmaid, onecard, poker, gostop, gems, mine, yacht, liar, liardice, codebreak].map(entry);
export const gameById = id => GAMES.find(g => g.id === id);
