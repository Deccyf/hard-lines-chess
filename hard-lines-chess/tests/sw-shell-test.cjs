// The service worker's shell cache, and what is allowed to become the shell.
//
// The worker answers navigations network-first and keeps the answer under
// './index.html' so the next opening without a signal is the newest page this
// device has seen. It used to keep EVERY successful navigation under that
// name, whatever came back — so one navigation to anything else on the origin
// replaced the app in the cache with that thing, and the next offline open
// served it. Nothing on screen said so until the app was needed offline.
//
// Publishing the Android APK beside the page is what made this reachable: the
// download sits inside the worker's scope. So there are two rules now, and
// this checks both — a non-HTML answer is never the shell, and a .apk is not
// the worker's business at all.
const { launch, serve, DIST } = require('./browser.cjs');
const fs = require('fs');
const path = require('path');

const failures = [];
const say = (k, v) => console.log(String(k).padEnd(30), v);
function check(what, got, want) {
  const ok = got === want;
  say(what, ok ? String(got) : `${got}   ← expected ${want}`);
  if (!ok) failures.push(`${what}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
}

(async () => {
  // A copy of the published kit, plus the two things that are served beside it
  // but are not it. Built in a scratch directory so dist/ is left alone.
  const site = path.join(__dirname, 'output', 'sw-shell-site');
  fs.rmSync(site, { recursive: true, force: true });
  fs.mkdirSync(site, { recursive: true });
  fs.cpSync(path.join(DIST, 'pwa'), site, { recursive: true });
  // Stands in for the APK: a zip, served as an ordinary file. The real one is
  // 1.9MB; the bytes do not matter here, the routing does.
  fs.writeFileSync(path.join(site, 'hard-lines-chess.apk'), Buffer.from('PK\x03\x04hard lines', 'binary'));
  // A non-HTML navigation that a browser renders rather than downloads, which
  // is the same code path with none of the download machinery in the way.
  fs.writeFileSync(path.join(site, 'notes.txt'), 'not the app');

  const srv = serve(site, 8231);
  await srv.ready;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const base = 'http://127.0.0.1:8231/';

  await page.goto(base);
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // The worker takes the shell on its first navigation through it, so reload
  // once it is controlling the page.
  await page.reload();
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  await page.waitForTimeout(400);

  // Read the cache from WHATEVER PAGE IS OPEN. Reading it after navigating
  // back to the app is reading it after the app has repaired it: a successful
  // navigation to the app re-caches the app, so the damage is invisible one
  // step later. The first version of this test did exactly that and passed
  // against the broken worker.
  const shell = async () => page.evaluate(async () => {
    for (const key of await caches.keys()) {
      const hit = await (await caches.open(key)).match('./index.html');
      if (hit) return { type: hit.headers.get('Content-Type') ?? '', body: (await hit.text()).slice(0, 400) };
    }
    return { type: 'ABSENT', body: '' };
  });

  const before = await shell();
  check('shell cached to begin with', before.type.includes('text/html'), true);
  check('shell is the app', before.body.includes('<title>Hard Lines Chess</title>'), true);

  // ── the navigation that used to overwrite it ───────────────────────────
  await page.goto(base + 'notes.txt');
  await page.waitForTimeout(600);
  const after = await shell();
  check('shell survives a text nav', after.type.includes('text/html'), true);
  check('shell is still the app', after.body.includes('<title>Hard Lines Chess</title>'), true);
  check('shell is not the text file', after.body.includes('not the app'), false);

  // ── the APK is never the worker's business ─────────────────────────────
  //
  // cache.put() is not awaited inside the worker, so a check that runs the
  // instant fetch() resolves races it and finds nothing cached whether or not
  // the worker cached it. Give it a moment before asking.
  const apk = await page.evaluate(async (url) => {
    const r = await fetch(url);
    const text = await r.text();
    await new Promise((done) => setTimeout(done, 500));
    let cached = false;
    for (const key of await caches.keys()) {
      if (await (await caches.open(key)).match(url)) cached = true;
    }
    return { ok: r.ok, starts: text.slice(0, 2), cached };
  }, base + 'hard-lines-chess.apk');
  check('apk fetched from network', apk.ok, true);
  check('apk arrives intact', apk.starts, 'PK');
  check('apk is never cached', apk.cached, false);

  // ── what the whole thing is for ────────────────────────────────────────
  //
  // The symptom a person would actually meet: open the app on a phone with no
  // signal, having at some point tapped a download link, and get the download
  // back instead of the app. This is that, without the phone.
  await ctx.setOffline(true);
  await page.goto(base).catch(() => {});
  const offlineBody = await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => '');
  const offline = await page.locator('#tab-today').isVisible().catch(() => false);
  check('app still loads offline', offline, true);
  check('offline is not the text file', offlineBody.includes('not the app'), false);
  await ctx.setOffline(false);

  say('page errors', errors.length ? errors.join(' | ') : 'none');
  if (errors.length) failures.push('page errors: ' + errors.join(' | '));

  srv.stop();
  await browser.close();
  if (failures.length) {
    console.log('FAILED\n  ' + failures.join('\n  '));
    process.exit(1);
  }
  console.log('ok — only the app is ever cached as the app');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
