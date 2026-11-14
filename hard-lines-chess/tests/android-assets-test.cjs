// What the Android wrapper actually serves the page, checked in a browser.
//
// Every request the page makes has to be answerable from inside the APK, with
// one exception. This stands in for MainActivity: the bundled document is
// served from assets/, the Google Fonts stylesheet the page links is answered
// with the same CSS the Java builds, the faces come from assets/fonts/, a
// read of Chess.com's public archive of a player's games is let out, and
// EVERYTHING ELSE IS REFUSED — which is what the wrapper does, and what makes
// "it needs no connection" a fact rather than a hope. Everything it serves
// carries the rule MainActivity attaches about where the page may connect.
//
// THE ONE THING LET OUT is checked from both sides: the import works in the
// app, and a request to anywhere else — the same host off the archive,
// another site, a socket — does not get out. tests/android-bridge.test.mjs
// runs MainActivity's own rule against a list of near misses; what this adds
// is the page, in a browser, under that rule and the policy together.
//
// It catches the failures that are invisible until you are holding a phone: a
// woff2 that does not decode or is named for a family the stylesheet never
// asks for (the app opens in fallback type and nothing says why), a request
// the page makes that nobody noticed (in the app it simply fails), and
// Stockfish not starting — its worker script and its .wasm are the two files
// the build copies in beside the page, and the .wasm needs the MIME type
// MainActivity gives it or the engine will not compile.
const { launch } = require('./browser.cjs');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'android/app/src/main/assets');
const DOMAIN = 'appassets.androidplatform.net';

// What MainActivity appends to the WebView's user agent, and what
// IN_ANDROID_APP in src/app-a.js reads.
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 HardLinesAndroid/1.1.0';

// Kept in step with MainActivity.fontStylesheet(). If the two drift, the faces
// below stay "unloaded" and this fails.
const FACES = [
  { file: 'inter-400', family: 'Inter', weight: 400 },
  { file: 'inter-500', family: 'Inter', weight: 500 },
  { file: 'inter-600', family: 'Inter', weight: 600 },
  { file: 'inter-700', family: 'Inter', weight: 700 },
  { file: 'jetbrains-mono-400', family: 'JetBrains Mono', weight: 400 },
  { file: 'jetbrains-mono-600', family: 'JetBrains Mono', weight: 600 },
];
const FONT_CSS = FACES.map(({ file, family, weight }) =>
  `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;`
  + `src:url(https://${DOMAIN}/assets/fonts/${file}.woff2) format('woff2')}`).join('\n');

// See android/app/build.gradle (stockfishFiles) and MainActivity.asset().
const STOCKFISH = { 'stockfish.js': 'application/javascript', 'stockfish.wasm': 'application/wasm' };
// And the puzzles the Weak spots screen chooses from (puzzlePackAbout and
// puzzlePack there): the description always, the pack when the build has one.
const PUZZLES = { 'puzzle-pack.json': 'application/json', 'puzzle-pack.txt': 'text/plain' };

// Kept in step with PAGE_POLICY, ARCHIVE_HOST and ARCHIVE_PATH in MainActivity.
const POLICY = { 'Content-Security-Policy': "connect-src 'self' https://api.chess.com" };
const ARCHIVE = 'https://api.chess.com/pub/player/';
// Chess.com, for the one request that goes out.
const MOVES = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O O-O';
const theirGame = (id, end) => ({
  url: `https://www.chess.com/game/live/${id}`, end_time: end, rules: 'chess', time_class: 'rapid', time_control: '600', rated: true,
  pgn: `[Event "Live Chess"]\n[White "hardliner"]\n[Black "someone"]\n[Result "1-0"]\n\n${MOVES} 1-0`,
  white: { username: 'hardliner', rating: 901, result: 'win' }, black: { username: 'someone', rating: 899, result: 'resigned' },
});

const failures = [];
const say = (k, v) => console.log(String(k).padEnd(26), v);
function check(what, got, want) {
  const ok = got === want;
  say(what, ok ? String(got) : `${got}   ← expected ${want}`);
  if (!ok) failures.push(`${what}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
}

(async () => {
  // The file the APK bundles as assets/index.html; see webApp in
  // android/app/build.gradle.
  const document = path.join(ROOT, 'dist/hard-lines-chess-app.html');
  if (!fs.existsSync(document)) throw new Error(`${document} is missing — run python3 build.py`);

  const browser = await launch();
  // THE MARKER MATTERS HERE, not only in the panel it rewrites. Without it the
  // page registers a service worker, which asks for an sw.js the APK does not
  // bundle and should not: the assets are the cache, and a worker layered over
  // them could only ever serve an older app than the one installed. That
  // request 404s on every launch, and nothing on screen says so — which is why
  // this drives the page as the wrapper presents it rather than as a browser.
  const ctx = await browser.newContext({
    userAgent: ANDROID_UA,
    viewport: { width: 390, height: 844 },
  });

  // Registered first, because Playwright matches the most recently registered
  // route: the two below take precedence over this one.
  const refused = [];
  const letOut = [];
  await ctx.route('**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    // MainActivity.isGameArchive(): https, that host, the ordinary port,
    // under that path, and only to read. This stands in for Chess.com too.
    if (request.url().startsWith(ARCHIVE) && url.port === '' && request.method() === 'GET') {
      letOut.push(request.url().slice(ARCHIVE.length));
      const body = request.url().endsWith('/archives')
        ? { archives: [`${ARCHIVE}hardliner/games/2026/11`] }
        : { games: [theirGame(1, 1794000000), theirGame(2, 1794003600)] };
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
    }
    refused.push(request.url());
    return route.fulfill({ status: 404, contentType: 'text/plain', body: '' });
  });
  await ctx.route('**://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: FONT_CSS }));
  await ctx.route(`**://${DOMAIN}/assets/**`, (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\/assets\//, '');
    if (rel === 'index.html') {
      return route.fulfill({ status: 200, contentType: 'text/html', headers: POLICY, body: fs.readFileSync(document, 'utf8') });
    }
    // The two files syncWebApp copies from dist/ into the APK's assets, with
    // the types the WebView gives them: the asset loader's guess for the
    // script, and MainActivity's explicit application/wasm for the engine.
    if (STOCKFISH[rel]) {
      return route.fulfill({ status: 200, contentType: STOCKFISH[rel], headers: POLICY, body: fs.readFileSync(path.join(ROOT, 'dist', rel)) });
    }
    if (PUZZLES[rel] && fs.existsSync(path.join(ROOT, 'dist', rel))) {
      return route.fulfill({ status: 200, contentType: PUZZLES[rel], headers: POLICY, body: fs.readFileSync(path.join(ROOT, 'dist', rel)) });
    }
    const file = path.join(ASSETS, rel);
    if (!file.startsWith(ASSETS) || !fs.existsSync(file)) {
      refused.push(route.request().url());
      return route.fulfill({ status: 404, contentType: 'text/plain', body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'font/woff2', headers: POLICY, body: fs.readFileSync(file) });
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`https://${DOMAIN}/assets/index.html`);
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  // A face the current screen does not render stays "unloaded" however well
  // it is bundled — the monospace faces are only used on move lists and
  // notation, and the page opens on Today. Asking for each one outright makes
  // the browser fetch and decode it, which is the thing being checked.
  await page.evaluate((faces) => Promise.all(faces.map(([f, w]) => document.fonts.load(`${w} 12px "${f}"`))),
    FACES.map(({ family, weight }) => [family, weight]));

  for (const { family, weight } of FACES) {
    const status = await page.evaluate(([f, w]) =>
      ([...document.fonts].find((x) => x.family === f && String(x.weight) === String(w))?.status ?? 'absent'),
      [family, weight]);
    check(`${family} ${weight}`, status, 'loaded');
  }
  // Not just loaded — actually the face the interface resolves to.
  check('h1 is set in', await page.evaluate(() =>
    getComputedStyle(document.querySelector('h1')).fontFamily.split(',')[0].replace(/"/g, '')), 'Inter');

  // Stockfish, started the way the Watch screen starts it, and asked for two
  // moves: proof the worker ran, the .wasm compiled and the engine answered.
  await page.evaluate(() => { show('watch'); startWatchStockfish('stockfish'); });
  const played = await page.evaluate(async () => {
    for (let i = 0; i < 2; i++) await stepWatchStockfish();
    return { ply: Watch.ply, error: Watch.sf.error, name: Stockfish.name };
  });
  say('Stockfish in the app', played.error ?? `${played.name}, ${played.ply} moves`);
  check('Stockfish starts', played.error, null);
  check('and plays', played.ply, 2);

  // This app's own engine, in workers started from the page's own text — which
  // is how every review is searched now. In the app that has to work under
  // the rule about connecting, or reviews fall back to the page's own thread.
  check('this app\'s engine starts in workers', await page.evaluate(async () => (await ownEngineLanes()) === engineLanes()), true);

  // The puzzles for the Weak spots screen are two more files beside the page,
  // read under the same rule about connecting. A build with a pack has to be
  // able to choose from it in the app; a build without one has to say so,
  // and in neither case may the page ask for a file the APK does not hold.
  const about = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/puzzle-pack.json'), 'utf8'));
  await page.evaluate(() => show('weak'));
  if (about.count > 0) {
    await page.waitForFunction(() => Weak.pack || Weak.failed, null, { timeout: 20000 });
    check('the puzzle pack is read in the app', await page.evaluate(() => Weak.failed ?? Weak.pack.count), about.count);
  } else {
    await page.waitForFunction(() => Weak.about !== undefined, null, { timeout: 20000 });
    check('a build with no puzzle pack says so in the app', await page.$eval('#weakNote', (e) => e.textContent),
      'This build of the app was made without the puzzle pack, so there is nothing to choose from here.');
  }

  // THE ONE THING THAT GOES OUT: your games, from Chess.com.
  await page.evaluate(() => show('review'));
  await page.fill('#importUser', 'hardliner');
  await page.click('#importRun');
  await page.waitForFunction(() => !Import.running, null, { timeout: 20000 });
  const imported = await page.evaluate(() => ({ note: document.getElementById('importNote').textContent, games: App.reviews.games.length, name: App.prefs.chessComUser }));
  say('importing in the app', imported.note.slice(0, 80));
  check('the import works in the app', imported.games, 2);
  check('and says so', /^2 games imported from 1 month\./.test(imported.note), true);
  check('asking Chess.com for the months and for one month, and nothing else', letOut.join(' '), 'hardliner/games/archives hardliner/games/2026/11');
  check('the name is remembered for next time', imported.name, 'hardliner');

  // THE POINT OF THE WHOLE THING. Anything here is a request the app cannot
  // make, so it would fail silently on a phone.
  say('refused requests', refused.length ? refused.join(', ') : 'none');
  if (refused.length) failures.push('the page asked for something the APK cannot serve: ' + refused.join(', '));

  // AND NOTHING ELSE GETS OUT, asked for on purpose. The policy stops the page
  // before a request is made; what it lets through, the app itself refuses.
  const escapes = await page.evaluate(async () => {
    const stopped = [];
    document.addEventListener('securitypolicyviolation', (e) => stopped.push(e.blockedURI));
    const tried = async (url, options) => {
      try { const r = await fetch(url, options); return `answered ${r.status}`; } catch { return 'not sent'; }
    };
    const socket = (url) => new Promise((resolve) => {
      let ws;
      try { ws = new WebSocket(url); } catch { resolve('not opened'); return; }
      ws.onopen = () => { resolve('opened'); ws.close(); };
      ws.onerror = () => resolve('not opened');
      setTimeout(() => resolve('not opened'), 3000);
    });
    const out = {
      elsewhere: await tried('https://example.net/collect?everything=1'),
      sent: await tried('https://example.net/collect', { method: 'POST', body: 'your games' }),
      offArchive: await tried('https://api.chess.com/pub/leaderboards'),
      written: await tried('https://api.chess.com/pub/player/hardliner/games/archives', { method: 'POST', body: 'x' }),
      socket: await socket('wss://example.net/listen'),
      beacon: navigator.sendBeacon ? navigator.sendBeacon('https://example.net/beacon', 'x') : false,
    };
    await new Promise((r) => setTimeout(r, 300));
    return { ...out, stopped: [...new Set(stopped.map((u) => new URL(u).host))].sort().join(' ') };
  });
  check('a request to another site is not sent', escapes.elsewhere, 'not sent');
  check('nor is anything posted to one', escapes.sent, 'not sent');
  check('nor a socket opened to one', escapes.socket, 'not opened');
  check('and the policy is what stopped them', escapes.stopped, 'example.net');
  check('Chess.com, off the archive, is refused by the app itself', escapes.offArchive, 'answered 404');
  check('and so is writing to the archive', escapes.written === 'answered 404' || escapes.written === 'not sent', true);
  check('none of which reached anywhere but the app\'s own refusal', refused.every((u) => u.startsWith('https://api.chess.com/')), true);

  say('page errors', errors.length ? errors.join(' | ') : 'none');
  if (errors.length) failures.push('page errors: ' + errors.join(' | '));

  await browser.close();
  if (failures.length) {
    console.log('FAILED\n  ' + failures.join('\n  '));
    process.exit(1);
  }
  console.log('ok — the app runs with nothing but the APK behind it, and reaches nothing but the archive');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
