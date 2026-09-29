// Reckless on the Watch screen, driven: the download, and the game.
//
// What has to be true, and none of it can be read off the code:
//
//   1. PICKING IT STARTS NOTHING. Reckless is a 44 MB download; choosing it in
//      the list only says so, on the button that will do it.
//
//   2. A DOWNLOAD THAT STOPS KEEPS WHAT ARRIVED. The connection is cut after
//      the fifth piece: the screen says how far it got, the five pieces are
//      kept, no manifest is kept (a kept manifest means a whole engine), and
//      carrying on asks the network for the missing pieces and nothing else.
//
//   3. IT PLAYS, AND EVERY MOVE IS EXPLAINED. Stockfish against Reckless, on
//      the page's own timer: Reckless's moves called its choice and explained
//      from its own line, Stockfish's called its own, no sentence with a hole.
//
//   4. THE SAME QUESTION GETS THE SAME ANSWER, from Reckless as from Stockfish.
//
//   5. THE ENGINE OUTLIVES AN UPDATE OF THE APP. The service worker throws away
//      every cache but its own when a new version arrives; a new version is
//      published here, and Reckless's cache is still there after it.
//
//   6. IT WORKS OFFLINE once it has been downloaded.
//
//   7. WHERE IT CANNOT RUN, IT SAYS SO: in the APK, from a file, and in a build
//      without it — and in the APK it asks the network for nothing.
const { launch, serve, DIST, app, gotoSection } = require('./browser.cjs');
const fs = require('fs');
const path = require('path');

const PORT = 8302;
const BARE_PORT = 8303;
const PLIES = Number(process.env.PLIES || 24);
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 HardLinesAndroid/1.1.0';

(async () => {
  // A copy of the published kit, so the version of the service worker can be
  // changed under a running page without touching dist/; and a copy without
  // Reckless, for the build that has none.
  const site = path.join(__dirname, 'output', 'reckless-site');
  const bare = path.join(__dirname, 'output', 'reckless-bare');
  for (const dir of [site, bare]) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.cpSync(path.join(DIST, 'pwa'), dir, { recursive: true });
  }
  fs.rmSync(path.join(bare, 'reckless'), { recursive: true, force: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(site, 'reckless', 'manifest.json'), 'utf8'));
  const totalMb = (manifest.pieces.reduce((n, p) => n + p.bytes, 0) / 1e6).toFixed(1);

  const srv = serve(site, PORT);
  const srvBare = serve(bare, BARE_PORT);
  await srv.ready;
  await srvBare.ready;
  const base = `http://127.0.0.1:${PORT}/`;
  const browser = await launch();
  const say = (k, v) => console.log(String(k).padEnd(48), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got) : `${got}   <- expected ${want}`);
    if (!ok) failures.push(what);
  };
  const holes = (text) => /undefined|NaN|\bnull\b|\[object|\. \.|\s,|\(\s*\)/.test(text);
  const errors = [];
  const note = (page) => page.$eval('#watchSfNote', (e) => e.textContent);
  const button = (page) => page.$eval('#watchStockfish', (b) => ({ text: b.textContent, disabled: b.disabled }));

  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1300 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  // The service worker takes the page first, so everything below goes past it
  // the way it will on a phone.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  check('the service worker controls the page', await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true);
  await gotoSection(page, 'watch');

  // ── 1. picking it starts nothing ──────────────────────────────────────────
  const asked = [];
  await ctx.route('**/reckless/pieces/*', (route) => { asked.push(route.request().url()); return route.continue(); });
  await page.selectOption('#watchSfOpponent', 'reckless');
  await page.waitForFunction(() => !document.getElementById('watchStockfish').disabled, null, { timeout: 20000 });
  const offer = await button(page);
  say('the button offers', offer.text);
  say('and the line under it says', await note(page));
  check('it says it will download, and how much', /^Download Reckless \(\d+ MB\) and watch$/.test(offer.text), true);
  check('choosing it downloaded nothing', asked.length, 0);
  await ctx.unroute('**/reckless/pieces/*');

  // ── 2. a download that stops keeps what arrived ──────────────────────────
  const cut = new Set(manifest.pieces.slice(5).map((p) => p.file));
  const pieceOf = (url) => 'pieces/' + url.split('/pieces/')[1];
  await ctx.route('**/reckless/pieces/*', (route) =>
    (cut.has(pieceOf(route.request().url())) ? route.abort('connectionreset') : route.continue()));
  await page.click('#watchStockfish');
  await page.waitForFunction(() => /stopped/.test(document.getElementById('watchSfNote').textContent), null, { timeout: 90000 });
  const stopped = await note(page);
  say('when the connection drops, it says', stopped);
  check('how far it got', new RegExp(`The download stopped at [\\d.]+ of ${totalMb} MB`).test(stopped), true);
  check('and that what arrived is kept', /What arrived is kept/.test(stopped), true);
  check('and the button offers to carry on', (await button(page)).text, 'Carry on downloading');
  const kept = await page.evaluate(async () => {
    const cache = await caches.open('reckless-engine');
    return (await cache.keys()).map((r) => r.url.split('/reckless/')[1]);
  });
  check('the five pieces that arrived are kept', kept.filter((k) => k.startsWith('pieces/')).length, 5);
  check('and no manifest yet: kept means complete', kept.includes('manifest.json'), false);
  await ctx.unroute('**/reckless/pieces/*');

  // ── 2b. carrying on asks for the rest and nothing else ────────────────────
  asked.length = 0;
  await ctx.route('**/reckless/pieces/*', (route) => { asked.push(pieceOf(route.request().url())); return route.continue(); });
  await page.click('#watchStockfish');
  await page.waitForFunction(() => Watch.sf && (Watch.sf.white === 'reckless' || Watch.sf.black === 'reckless'), null, { timeout: 120000 });
  check('carrying on fetched only the missing pieces', [...new Set(asked)].sort().join(' '), [...cut].sort().join(' '));
  await ctx.unroute('**/reckless/pieces/*');

  // ── 3. the game ───────────────────────────────────────────────────────────
  const started = Date.now();
  await page.evaluate(() => { Watch.speed = 20; });
  await page.waitForFunction((n) => Watch.ply >= n || !Watch.playing, PLIES, { timeout: 600000 });
  await page.evaluate(() => stopWatch());
  const game = await page.evaluate(() => ({
    title: Watch.title, book: Watch.book.length, bookName: Watch.bookName, plies: Watch.sans.length,
    error: Watch.sf.error, finished: Watch.finished, subtitle: document.getElementById('watchSubtitle').textContent,
  }));
  say('game', `${game.title} · ${game.bookName} for ${game.book} plies · ${game.plies} plies in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  check('no error', game.error, null);
  check(`it played ${PLIES} plies (or finished)`, game.plies >= PLIES || game.finished !== null, true);
  check('the subtitle names both engines', /Stockfish and Reckless/.test(game.subtitle), true);

  const notes = await page.evaluate(() => {
    const out = [];
    const end = Watch.sans.length;
    for (let i = 1; i <= end; i++) {
      goToWatchPly(i);
      out.push({
        ply: i,
        san: Watch.sans[i - 1],
        side: Watch.sf[(i - 1) % 2 === 0 ? 'white' : 'black'],
        inBook: i <= Watch.book.length,
        explained: Boolean(Watch.notes[i]?.explained),
        verdict: document.getElementById('watchNote').textContent,
        why: [...document.querySelectorAll('#watchWhy p')].map((p) => p.textContent),
      });
    }
    return out;
  });
  check('every move is explained', notes.filter((n) => !n.explained).length, 0);
  const rkMoves = notes.filter((n) => n.side === 'reckless' && !n.inBook);
  const sfMoves = notes.filter((n) => n.side === 'stockfish' && !n.inBook);
  check("Reckless's moves are called its choice", rkMoves.every((n) => n.verdict.startsWith("Reckless's choice")), true);
  check("and say what Stockfish makes of them", rkMoves.every((n) => /Stockfish (agrees|would have played|sees|thinks)/.test(n.verdict)), true);
  check("most show the line Reckless expects", rkMoves.filter((n) => n.why.some((t) => t.startsWith('The line Reckless expects:'))).length >= rkMoves.length / 2, true);
  check("Stockfish's moves are called its own", sfMoves.every((n) => n.verdict.startsWith("Stockfish's choice")), true);
  const holed = notes.filter((n) => holes(n.verdict) || n.why.some(holes));
  check('no sentence has a hole in it', holed.length, 0);
  for (const n of holed.slice(0, 3)) say(`  ply ${n.ply}`, [n.verdict, ...n.why].join(' / '));
  for (const n of [...rkMoves.slice(0, 3), ...sfMoves.slice(0, 1)]) {
    console.log(`\n  ${Math.ceil(n.ply / 2)}${n.ply % 2 ? '.' : '…'} ${n.san} (${n.side})`);
    console.log(`    ${n.verdict}`);
    for (const t of n.why) console.log(`    · ${t}`);
  }
  console.log('');

  // ── 4. the same question, the same answer ────────────────────────────────
  const twice = await page.evaluate(async () => {
    const sf = Watch.sf;
    const index = Math.min(12, sf.ucis.length);
    const ask = () => recklessAnalyse(sf.fens[0], { nodes: RECKLESS_NODES, multipv: 3, moves: sf.ucis.slice(0, index) });
    const a = await ask();
    const b = await ask();
    return { same: JSON.stringify(a) === JSON.stringify(b), depth: a.depth, nodes: a.nodes, best: a.best };
  });
  say('a position Reckless searched twice', `${twice.best}, depth ${twice.depth}, ${twice.nodes} positions`);
  check('comes back the same both times', twice.same, true);

  // ── 5. the engine outlives an update of the app ──────────────────────────
  const beforeUpdate = await page.evaluate(async () => {
    const out = {};
    for (const key of await caches.keys()) {
      out[key] = (await (await caches.open(key)).keys()).map((r) => r.url);
    }
    return out;
  });
  const appCaches = Object.keys(beforeUpdate).filter((k) => k !== 'reckless-engine');
  check('the app\'s own cache holds none of Reckless',
    appCaches.every((k) => beforeUpdate[k].every((u) => !u.includes('/reckless/'))), true);
  check('Reckless\'s cache holds the whole engine', (beforeUpdate['reckless-engine'] ?? []).length, manifest.pieces.length + 2);
  const sw = fs.readFileSync(path.join(site, 'sw.js'), 'utf8');
  fs.writeFileSync(path.join(site, 'sw.js'), sw.replace(/const VERSION = '[^']+'/, "const VERSION = 'hard-lines-next-version'"));
  // Waited for until ACTIVATED, not for the controller to change: a page
  // already controlled switches to the new worker the moment it starts to
  // activate — before its activate handler has cleared anything away.
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
    const next = registration.installing ?? registration.waiting ?? registration.active;
    await new Promise((done) => {
      if (next.state === 'activated') { done(); return; }
      next.addEventListener('statechange', () => { if (next.state === 'activated') done(); });
    });
  });
  const afterUpdate = await page.evaluate(async () => {
    const out = {};
    for (const key of await caches.keys()) out[key] = (await (await caches.open(key)).keys()).length;
    return out;
  });
  say('caches after a new version of the app', JSON.stringify(afterUpdate));
  check('the old version of the app is gone', appCaches.some((k) => k in afterUpdate), false);
  check('and Reckless is still whole', afterUpdate['reckless-engine'], manifest.pieces.length + 2);

  // ── 6. offline ────────────────────────────────────────────────────────────
  await ctx.setOffline(true);
  const off = await ctx.newPage();
  off.on('pageerror', (e) => errors.push(`offline: ${e.message}`));
  await off.goto(base);
  await off.waitForSelector('#tab-today', { timeout: 20000 });
  await gotoSection(off, 'watch');
  await off.selectOption('#watchSfOpponent', 'reckless');
  await off.waitForFunction(() => !document.getElementById('watchStockfish').disabled, null, { timeout: 20000 });
  say('offline, it says', await note(off));
  check('offline, it is on this device', /on this device/.test(await note(off)), true);
  await off.click('#watchStockfish');
  await off.waitForFunction(() => Watch.sf && Watch.sans.length >= Watch.book.length + 2, null, { timeout: 120000 });
  const offGame = await off.evaluate(() => ({ plies: Watch.sans.length, error: Watch.sf.error }));
  check('and plays without a connection', offGame.error === null && offGame.plies > 0, true);
  await off.evaluate(() => stopWatch());
  await ctx.setOffline(false);

  // ── 7. where it cannot run ───────────────────────────────────────────────
  const apkCtx = await browser.newContext({ userAgent: ANDROID_UA, viewport: { width: 390, height: 844 } });
  const apkAsked = [];
  await apkCtx.route('**/reckless/**', (route) => { apkAsked.push(route.request().url()); return route.continue(); });
  const apk = await apkCtx.newPage();
  apk.on('pageerror', (e) => errors.push(`apk: ${e.message}`));
  await apk.goto(base);
  await apk.waitForSelector('#tab-today', { timeout: 20000 });
  await gotoSection(apk, 'watch');
  await apk.selectOption('#watchSfOpponent', 'reckless');
  await apk.waitForFunction(() => /website/.test(document.getElementById('watchSfNote').textContent), null, { timeout: 20000 });
  say('in the APK, it says', (await note(apk)).slice(0, 90) + '…');
  check('in the APK the button is off', (await button(apk)).disabled, true);
  check('and the APK asked the network for none of it', apkAsked.length, 0);

  const local = await ctx.newPage();
  local.on('pageerror', (e) => errors.push(`file: ${e.message}`));
  await local.goto(app());
  await local.waitForSelector('#tab-today', { timeout: 20000 });
  await gotoSection(local, 'watch');
  await local.selectOption('#watchSfOpponent', 'reckless');
  await local.waitForFunction(() => /file/.test(document.getElementById('watchSfNote').textContent), null, { timeout: 20000 });
  check('from a file, it says it cannot run there', (await button(local)).disabled, true);

  const plain = await (await browser.newContext()).newPage();
  plain.on('pageerror', (e) => errors.push(`bare: ${e.message}`));
  await plain.goto(`http://127.0.0.1:${BARE_PORT}/`);
  await plain.waitForSelector('#tab-today', { timeout: 20000 });
  await gotoSection(plain, 'watch');
  await plain.selectOption('#watchSfOpponent', 'reckless');
  await plain.waitForFunction(() => /without Reckless/.test(document.getElementById('watchSfNote').textContent), null, { timeout: 20000 });
  check('a build without it says so', (await button(plain)).disabled, true);

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  srvBare.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
