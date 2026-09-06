const { launch, app, serve, DIST } = require('./browser.cjs');

(async () => {
  const srv8201 = serve(DIST, 8201); await srv8201.ready;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });

  // The check has to be able to go RED, so the old fragment is measured too.
  for (const [name, file] of [['fragment (old, published form)', 'hard-lines-chess.html'], ['standalone (what gets sent)', 'hard-lines-chess-app.html']]) {
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:8201/${file}`);
    await page.waitForSelector('#tab-today', { timeout: 20000 });
    const r = await page.evaluate(() => {
      const go = document.querySelector('.task-go');
      return {
        charset: document.characterSet,
        compat: document.compatMode,
        layoutWidth: document.documentElement.clientWidth,
        arrow: go ? (go.textContent.includes('→') ? 'arrow ok' : JSON.stringify(go.textContent.slice(-4))) : 'no row',
        mojibake: document.body.innerText.includes('Â'),
        tabFits: document.querySelector('.tab').getBoundingClientRect().height,
      };
    });
    console.log(name.padEnd(32), JSON.stringify(r));
    await page.close();
  }

  // The saved-copy protocols: the button must be absent, the sentence present.
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:8201/hard-lines-chess-app.html');
  await page.waitForSelector('#tab-today');
  console.log('on http: button shown        ', await page.locator('#downloadRow').isVisible());
  const verdicts = await page.evaluate(() => ['file:', 'content:', 'blob:', 'android-app:', 'https:', 'http:']
    .map((p) => `${p}${['file:', 'content:', 'blob:', 'android-app:'].includes(p) ? 'saved' : 'offer'}`).join('  '));
  console.log('protocol rule               ', verdicts);

  // And the copy this page would save must itself be a complete document.
  const snap = await page.evaluate(() => SOURCE_SNAPSHOT.slice(0, 240));
  console.log('snapshot head               ', JSON.stringify(snap.replace(/\n/g, ' ').slice(0, 200)));
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
    page.click('#downloadApp'),
  ]);
  if (download) {
    const fs = require('fs');
    const text = fs.readFileSync(await download.path(), 'utf8');
    fs.writeFileSync('resaved.html', text);
    console.log('re-saved is a document      ', text.startsWith('<!doctype html>') && /<meta charset/i.test(text.slice(0, 1024)) && /viewport/.test(text.slice(0, 1024)));
  }
  srv8201.stop();
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
