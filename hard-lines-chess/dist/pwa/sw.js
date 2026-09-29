// The whole app is one HTML file with the engine, the openings and the styles
// inside it, so "offline" needs nothing clever: cache the shell on install and
// answer navigations from it.
//
// THE VERSION IS STAMPED BY build.py from a hash of the index.html it just
// wrote — this file is generated from pwa/sw.template.js and is not edited by
// hand. It was a constant once, and since nothing changed it, no browser ever
// installed a newer worker and the cached shell was served for ever:
// three reloads, a new tab and an explicit update() all showed the old page.
//
// NETWORK-FIRST FOR A NAVIGATION, cache when the network fails. A cache-first
// shell only ever changes when the worker does; a network-first one is fresh
// whenever it can be and offline whenever it must be. The version-keyed cache
// is still what lets an old shell be thrown away atomically on activate.
const VERSION = 'hard-lines-43681ff32b05';
// The engine is part of the shell: an installed app that plays Stockfish when
// it has a connection and cannot when it does not is not offline. So is the
// small script that fetches and runs Reckless — but not Reckless itself.
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png',
  './stockfish.js', './stockfish.wasm', './reckless-worker.js'];

// RECKLESS IS NOT THIS WORKER'S TO KEEP. It is 44 MB, downloaded only by the
// people who ask for it, and kept by its own worker in a cache of its own
// (see src/reckless-worker.js). This worker throws away every cache but its
// current one when a new version of the app arrives — which, applied to that
// one, would make a phone download Reckless again after every update — and
// copies whatever it fetches into the cache it is about to throw away, which
// would keep the engine twice. So that cache survives activation, and the
// files under reckless/ go past this worker untouched.
const KEEP = ['reckless-engine'];
const RECKLESS = new URL('reckless/', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Individually, so one missing optional file cannot fail the whole install
    // and leave the app permanently uninstallable.
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION && !KEEP.includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  // THE APK IS NOT PART OF THE APP AND MUST NOT BE TREATED AS IT. The Android
  // build is published beside this page, which puts it inside this worker's
  // scope, and a download is a request only the network can answer correctly:
  // a cached or substituted response here is a 1.9MB file that installs as
  // nothing. Handing it back to the browser untouched is the whole fix.
  if (new URL(request.url).pathname.endsWith('.apk')) return;
  if (request.url.startsWith(RECKLESS)) return;

  // A navigation always gets the app, online or not. Without this an install
  // that opens on a dead connection shows the browser's error page, which
  // looks exactly like the app being broken. The network is asked first and
  // a good answer refreshes the cached shell, so the next offline open is the
  // newest page this device has seen.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        // ONLY AN HTML ANSWER IS THE SHELL. This cached whatever came back
        // from any navigation, under the shell's name — so one navigation to
        // anything else on this origin replaced the app with that thing, and
        // the next opening offline served it. What made that reachable was
        // publishing the APK here; what made it a bug was never checking.
        const type = response.headers.get('Content-Type') ?? '';
        if (response.ok && type.includes('text/html')) {
          const cache = await caches.open(VERSION);
          cache.put('./index.html', response.clone());
        }
        return response;
      } catch {
        const cached = await caches.match('./index.html');
        if (cached) return cached;
        return new Response('Offline and nothing cached yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && new URL(request.url).origin === location.origin) {
        const cache = await caches.open(VERSION);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      return cached ?? Response.error();
    }
  })());
});
