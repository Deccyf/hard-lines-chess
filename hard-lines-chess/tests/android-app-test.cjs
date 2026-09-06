// The page inside the Android wrapper, and the same page outside it.
//
// The wrapper serves the app over https from a real origin, so nothing about
// the address tells the page it is inside an installed app — and a page that
// cannot tell offers to install itself and to save a copy of itself, which are
// both answers to questions that copy has already answered. The wrapper stamps
// a marker into the user agent instead; this drives the page with and without
// it and checks that the marker is the only thing that changed.
//
// The marker is written in MainActivity.java and read by IN_ANDROID_APP in
// src/app-a.js. If either moves, this fails.
const { launch, serve, DIST } = require('./browser.cjs');

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 HardLinesAndroid/1.0.0';
const PLAIN_UA = ANDROID_UA.replace(' HardLinesAndroid/1.0.0', '');

const failures = [];
const say = (k, v) => console.log(String(k).padEnd(30), v);
function check(what, got, want) {
  const ok = got === want;
  say(what, ok ? `${got}` : `${got}   ← expected ${want}`);
  if (!ok) failures.push(`${what}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
}

async function read(browser, url, userAgent) {
  const ctx = await browser.newContext({ userAgent, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  // setupInstall() runs during boot; the manifest link is injected there.
  await page.waitForTimeout(600);
  const state = {
    marker: await page.evaluate(() => IN_ANDROID_APP),
    downloadRow: await page.locator('#downloadRow').isHidden() ? 'hidden' : 'visible',
    installRow: await page.locator('#installRow').isHidden() ? 'hidden' : 'visible',
    installNote: (await page.locator('#installNote').innerText()).trim() || '(empty)',
    downloadTitle: (await page.locator('#downloadTitle').innerText()).trim(),
    manifest: await page.evaluate(() => (document.querySelector('link[rel=manifest]') ? 'linked' : 'none')),
    errors,
  };
  await ctx.close();
  return state;
}

(async () => {
  // The standalone document, because that is the one the APK bundles as its
  // assets/index.html — see webApp in android/app/build.gradle. Served rather
  // than opened as a file: the page checks isSecureContext, and 127.0.0.1 is
  // one where file: is not, which is the whole reason the wrapper serves it.
  const srv = serve(DIST, 8221);
  await srv.ready;
  const browser = await launch();
  const url = 'http://127.0.0.1:8221/hard-lines-chess-app.html';

  console.log('--- inside the Android app');
  const app = await read(browser, url, ANDROID_UA);
  check('marker read', app.marker, true);
  // Already installed, so neither offer is made.
  check('install row', app.installRow, 'hidden');
  check('install note', app.installNote, 'Running as the Android app.');
  check('save-a-copy row', app.downloadRow, 'hidden');
  check('panel heading', app.downloadTitle, 'Your copy');
  // setupInstall() returns before it injects one: there is no browser here to
  // attach an installed app to, and the kit's own link is stripped by the
  // wrapper's build. A manifest at this point would be a manifest for nothing.
  check('manifest injected', app.manifest, 'none');

  console.log('\n--- the same page in a browser');
  const web = await read(browser, url, PLAIN_UA);
  check('marker read', web.marker, false);
  check('save-a-copy row', web.downloadRow, 'visible');
  check('panel heading', web.downloadTitle, 'Take it with you');
  check('manifest linked', web.manifest, 'linked');

  const errors = [...app.errors, ...web.errors];
  console.log('');
  say('page errors', errors.length ? errors.join(' | ') : 'none');
  if (errors.length) failures.push('page errors: ' + errors.join(' | '));

  srv.stop();
  await browser.close();

  if (failures.length) {
    console.log('FAILED\n  ' + failures.join('\n  '));
    process.exit(1);
  }
  console.log(`ok — 10 checks, the marker is the only difference`);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
