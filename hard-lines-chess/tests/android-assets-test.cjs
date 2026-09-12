// What the Android wrapper actually serves the page, checked in a browser.
//
// The APK holds no internet permission, so every request the page makes has to
// be answerable from inside it. This stands in for MainActivity: the bundled
// document is served from assets/, the Google Fonts stylesheet the page links
// is answered with the same CSS the Java builds, the faces come from
// assets/fonts/, and EVERYTHING ELSE IS REFUSED — which is what the wrapper
// does, and what makes "it needs no connection" a fact rather than a hope.
//
// It catches the two failures that are invisible until you are holding a
// phone: a woff2 that does not decode or is named for a family the stylesheet
// never asks for (the app opens in fallback type and nothing says why), and a
// request the page makes that nobody noticed (in the app it simply fails).
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
  await ctx.route('**', (route) => {
    refused.push(route.request().url());
    return route.fulfill({ status: 404, contentType: 'text/plain', body: '' });
  });
  await ctx.route('**://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: FONT_CSS }));
  await ctx.route(`**://${DOMAIN}/assets/**`, (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\/assets\//, '');
    if (rel === 'index.html') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(document, 'utf8') });
    }
    const file = path.join(ASSETS, rel);
    if (!file.startsWith(ASSETS) || !fs.existsSync(file)) {
      refused.push(route.request().url());
      return route.fulfill({ status: 404, contentType: 'text/plain', body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(file) });
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`https://${DOMAIN}/assets/index.html`);
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);

  for (const { family, weight } of FACES) {
    const status = await page.evaluate(([f, w]) =>
      ([...document.fonts].find((x) => x.family === f && String(x.weight) === String(w))?.status ?? 'absent'),
      [family, weight]);
    check(`${family} ${weight}`, status, 'loaded');
  }
  // Not just loaded — actually the face the interface resolves to.
  check('h1 is set in', await page.evaluate(() =>
    getComputedStyle(document.querySelector('h1')).fontFamily.split(',')[0].replace(/"/g, '')), 'Inter');

  // THE POINT OF THE WHOLE THING. Anything here is a request the app cannot
  // make, so it would fail silently on a phone.
  say('refused requests', refused.length ? refused.join(', ') : 'none');
  if (refused.length) failures.push('the page asked for something the APK cannot serve: ' + refused.join(', '));

  say('page errors', errors.length ? errors.join(' | ') : 'none');
  if (errors.length) failures.push('page errors: ' + errors.join(' | '));

  await browser.close();
  if (failures.length) {
    console.log('FAILED\n  ' + failures.join('\n  '));
    process.exit(1);
  }
  console.log('ok — the app runs with nothing but the APK behind it');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
