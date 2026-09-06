const { launch, app, serve, DIST } = require('./browser.cjs');
(async () => {
  const srv8210 = serve(require('path').join(DIST, 'pwa'), 8210); await srv8210.ready;
  const srv8211 = serve(DIST, 8211); await srv8211.ready;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const say = (k, v) => console.log(String(k).padEnd(30), v);

  // localhost IS a secure context, so this is the real PWA path.
  await page.goto('http://127.0.0.1:8210/index.html');
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  say('secure context', await page.evaluate(() => window.isSecureContext));

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Page.enable');
  const m = await cdp.send('Page.getAppManifest');
  say('manifest url', m.url);
  say('manifest errors', JSON.stringify(m.errors));
  const parsed = m.data ? JSON.parse(m.data) : null;
  say('manifest name/display', parsed ? `${parsed.name} / ${parsed.display}` : 'NONE');
  say('manifest icons', parsed ? parsed.icons.map((i) => i.sizes + ':' + i.purpose).join(' ') : 'NONE');
  say('start_url / scope', parsed ? `${parsed.start_url} | ${parsed.scope}` : 'NONE');

  try {
    const errs = await cdp.send('Page.getInstallabilityErrors');
    say('installability errors', JSON.stringify(errs));
  } catch (e) { say('installability api', 'unavailable: ' + e.message.split('\n')[0]); }

  await page.waitForFunction(() => navigator.serviceWorker.controller !== null || navigator.serviceWorker.getRegistration().then(r => !!r), null, { timeout: 15000 }).catch(() => {});
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? { scope: reg.scope, active: !!reg.active, state: reg.active?.state ?? reg.installing?.state } : null;
  });
  say('service worker', JSON.stringify(sw));

  // Offline: the whole point of the worker.
  await page.waitForTimeout(1500);
  await ctx.setOffline(true);
  const page2 = await ctx.newPage();
  const offlineErrors = [];
  page2.on('pageerror', (e) => offlineErrors.push(e.message));
  await page2.goto('http://127.0.0.1:8210/index.html').catch((e) => say('offline nav threw', e.message.split('\n')[0]));
  const ok = await page2.locator('#tab-today').count().catch(() => 0);
  say('offline: app loads', ok ? 'yes' : 'NO');
  if (ok) {
    say('offline: openings', await page2.locator('.opening').count().then((n) => n, () => 0) || await page2.evaluate(() => OPENINGS.length));
    await page2.click('#tab-board');
    await page2.click('#practiceSuggest');
    await page2.waitForFunction(() => document.querySelectorAll('#practiceLines .line-row').length > 0, null, { timeout: 20000 });
    say('offline: engine runs', (await page2.locator('#practiceLines .line-row').first().innerText()).replace(/\s+/g, ' '));
  }
  await ctx.setOffline(false);

  // And the single-file build: manifest injected at runtime, no second file.
  const page3 = await ctx.newPage();
  await page3.goto('http://127.0.0.1:8211/hard-lines-chess-app.html').catch(() => {});
  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  srv8210.stop();
  srv8211.stop();
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
