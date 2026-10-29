// RunLab service worker: installable app + "last seen" offline copy.
// - App shell: network-first for pages, cache-first for hashed /assets.
// - API GETs: network-first; when the PC is unreachable, answer from the last copy
//   and mark it with `x-runlab-offline: 1` so the UI can say so.
const SHELL = 'runlab-shell-v1'
const API = 'runlab-api'
// Responses vary on Origin/Accept-Encoding (module scripts send Origin, precache requests don't).
const MATCH = { ignoreVary: true }
const NEVER_CACHE = ['/api/auth/', '/api/export/', '/api/sync/', '/api/garmin/', '/api/ping']
// A sleeping PC over Tailscale doesn't refuse connections, it just never answers.
// After this long, show the saved copy while the request keeps trying in the background.
const API_TIMEOUT_MS = 4000

self.addEventListener('install', (event) => {
  // Precache every screen's bundle so pages not yet opened still work offline.
  event.waitUntil(
    (async () => {
      try {
        const manifest = await fetch('/.vite/manifest.json', { cache: 'no-store' }).then((r) => r.json())
        const files = new Set(['/'])
        for (const chunk of Object.values(manifest)) {
          // Font subsets load on demand (unicode-range) and get cached as they're used.
          if (!chunk.file.endsWith('.woff2')) files.add('/' + chunk.file)
          for (const css of chunk.css ?? []) files.add('/' + css)
        }
        const cache = await caches.open(SHELL)
        await Promise.all([...files].map((f) => cache.add(f).catch(() => undefined)))
        // Drop bundles from older builds.
        for (const req of await cache.keys()) {
          const path = new URL(req.url).pathname
          if (path.startsWith('/assets/') && !path.endsWith('.woff2') && !files.has(path)) await cache.delete(req)
        }
      } catch {
        /* dev server or offline: cache lazily instead */
      }
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== SHELL && key !== API) await caches.delete(key)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  // sw.js and version.json must always come from the network so updates are noticed.
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/sw.js' || url.pathname === '/version.json') return

  if (url.pathname.startsWith('/api/')) {
    if (NEVER_CACHE.some((p) => url.pathname.startsWith(p))) return
    event.respondWith(apiFirst(req))
  } else if (req.mode === 'navigate') {
    event.respondWith(pageFirst(req))
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req))
  } else {
    event.respondWith(staleWhileRevalidate(req))
  }
})

async function apiFirst(req) {
  const cache = await caches.open(API)
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone())
    return res
  })
  network.catch(() => undefined) // may settle after we've answered from the cache
  try {
    const first = await Promise.race([network, slow()])
    if (first !== 'slow') return first
    const hit = await cache.match(req, MATCH)
    return hit ? offlineCopy(hit) : await network
  } catch {
    const hit = await cache.match(req, MATCH)
    return hit ? offlineCopy(hit) : json503()
  }
}

function offlineCopy(hit) {
  const headers = new Headers(hit.headers)
  headers.set('x-runlab-offline', '1')
  return new Response(hit.body, { status: hit.status, headers })
}

async function pageFirst(req) {
  const cache = await caches.open(SHELL)
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put('/', res.clone())
    return res
  })
  network.catch(() => undefined)
  try {
    const first = await Promise.race([network, slow()])
    if (first !== 'slow') return first
    return (await cache.match('/', MATCH)) || (await network)
  } catch {
    return (await cache.match('/', MATCH)) || Response.error()
  }
}

function slow() {
  return new Promise((resolve) => setTimeout(() => resolve('slow'), API_TIMEOUT_MS))
}

async function cacheFirst(req) {
  const cache = await caches.open(SHELL)
  const hit = await cache.match(req, MATCH)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) cache.put(req, res.clone())
  return res
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL)
  const hit = await cache.match(req, MATCH)
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone())
      return res
    })
    .catch(() => hit || Response.error())
  return hit || fresh
}

function json503() {
  return new Response(JSON.stringify({ detail: 'PC에 연결할 수 없어요.', code: 'offline' }), {
    status: 503,
    headers: { 'content-type': 'application/json', 'x-runlab-offline': '1' },
  })
}
