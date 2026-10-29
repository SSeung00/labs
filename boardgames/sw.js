/* Offline copy of the site. Network first: when online every file is fetched fresh (so a new version never mixes with old
   files); the copy is only used without a connection, e.g. to play solo offline. Online rooms still need the internet.
   deploy.py rewrites FILES (every published file) and CACHE (a hash of their contents) in the published copy. */
const CACHE = "bg-site-v2";
const FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "og.png",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
  "core/app.js",
  "core/cards.js",
  "core/host.js",
  "core/i18n.js",
  "core/net.js",
  "core/replay.js",
  "core/rng.js",
  "core/settings.js",
  "core/social.js",
  "core/style.css",
  "core/ui.js",
  "games/codebreak/engine.js",
  "games/codebreak/logic.js",
  "games/codebreak/style.css",
  "games/codebreak/ui.js",
  "games/dalmuti/ai.js",
  "games/dalmuti/cards.js",
  "games/dalmuti/engine.js",
  "games/dalmuti/policy.js",
  "games/dalmuti/rules.js",
  "games/dalmuti/style.css",
  "games/dalmuti/ui.js",
  "games/gems/engine.js",
  "games/gems/style.css",
  "games/gems/ui.js",
  "games/gostop/cards.js",
  "games/gostop/engine.js",
  "games/gostop/style.css",
  "games/gostop/ui.js",
  "games/liar/engine.js",
  "games/liar/style.css",
  "games/liar/ui.js",
  "games/liar/words.js",
  "games/liardice/engine.js",
  "games/liardice/style.css",
  "games/liardice/ui.js",
  "games/mine/engine.js",
  "games/mine/style.css",
  "games/mine/ui.js",
  "games/oldmaid/engine.js",
  "games/oldmaid/style.css",
  "games/oldmaid/ui.js",
  "games/onecard/engine.js",
  "games/onecard/style.css",
  "games/onecard/ui.js",
  "games/poker/engine.js",
  "games/poker/style.css",
  "games/poker/ui.js",
  "games/registry.js",
  "games/yacht/engine.js",
  "games/yacht/style.css",
  "games/yacht/ui.js"
];
const CDN = /^(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)$/;

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(new Request(f, { cache: "no-cache" })).catch(() => { })))));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url), same = url.origin === location.origin;
  if (!same && !CDN.test(url.hostname)) return;          // signalling, TURN credentials etc. are never cached
  const net = () => fetch(req, same ? { cache: "no-cache" } : undefined);
  const cached = () => caches.match(req, { ignoreSearch: true });
  e.respondWith(
    net()
      // GitHub Pages sometimes answers 503 for a moment: try once more, then use the saved copy if there is one
      .then(res => (res.status >= 500 ? new Promise(r => setTimeout(r, 400)).then(net) : res))
      .then(res => {
        if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; }
        return cached().then(hit => hit || res);
      })
      .catch(() => cached().then(hit => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});
