const { launch, app, serve, DIST } = require('./browser.cjs');
(async () => {
  const srv8199 = serve(DIST, 8199); await srv8199.ready;
  const browser = await launch();

  // 1. A normal http page with no capability: the browser download must run.
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:8199/hard-lines-chess.html');
  await page.waitForSelector('#tab-today');
  console.log('panel visible      ', await page.locator('#downloadWrap').isVisible());
  console.log('button visible     ', await page.locator('#downloadApp').isVisible());
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
    page.click('#downloadApp'),
  ]);
  await page.waitForTimeout(500);
  console.log('download fired     ', download ? download.suggestedFilename() : 'NONE');
  console.log('note               ', await page.locator('#downloadNote').innerText());
  if (download) {
    const path = await download.path();
    const fs = require('fs');
    const size = fs.statSync(path).size;
    const text = fs.readFileSync(path, 'utf8');
    console.log('saved size         ', size);
    console.log('saved is a page    ', text.startsWith('<!doctype html>') && text.includes('function boot()'));
    console.log('saved is clean     ', !text.includes('class="sq ') && !text.includes('id="puzzleBoard"><div'));
    fs.mkdirSync(require('path').join(__dirname, 'output'), { recursive: true }); fs.writeFileSync(require('path').join(__dirname, 'output', 'downloaded-copy.html'), text);
  }

  // 2. The capability path: stub window.claude and check it is preferred.
  const page2 = await ctx.newPage();
  await page2.addInitScript(() => {
    window.__saves = [];
    window.claude = { use: async (name) => name === 'downloads' ? { save: async (req) => { window.__saves.push({ filename: req.filename, size: req.data.length }); return { status: 'saved' }; } } : null };
  });
  await page2.goto('http://127.0.0.1:8199/hard-lines-chess.html');
  await page2.waitForSelector('#tab-today');
  await page2.waitForTimeout(400);
  await page2.click('#downloadApp');
  await page2.waitForTimeout(500);
  console.log('capability used    ', JSON.stringify(await page2.evaluate(() => window.__saves)));
  console.log('capability note    ', await page2.locator('#downloadNote').innerText());

  // 3. Capability that refuses HTML: the message must say what to do instead.
  const page3 = await ctx.newPage();
  await page3.addInitScript(() => {
    window.claude = { use: async (n) => n === 'downloads' ? { save: async () => { const e = new Error('no'); e.code = 'extension_not_enabled'; throw e; } } : null };
  });
  await page3.goto('http://127.0.0.1:8199/hard-lines-chess.html');
  await page3.waitForSelector('#tab-today'); await page3.waitForTimeout(400);
  await page3.click('#downloadApp'); await page3.waitForTimeout(400);
  console.log('refused note       ', await page3.locator('#downloadNote').innerText());

  // 4. Declined: no scary message, no fallback.
  const page4 = await ctx.newPage();
  await page4.addInitScript(() => {
    window.claude = { use: async (n) => n === 'downloads' ? { save: async () => { const e = new Error('no'); e.code = 'declined'; throw e; } } : null };
  });
  await page4.goto('http://127.0.0.1:8199/hard-lines-chess.html');
  await page4.waitForSelector('#tab-today'); await page4.waitForTimeout(400);
  await page4.click('#downloadApp'); await page4.waitForTimeout(400);
  console.log('declined note      ', await page4.locator('#downloadNote').innerText());

  console.log(errors.length ? 'ERRORS ' + errors.join('|') : 'no page errors');
  srv8199.stop();
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
