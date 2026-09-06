const { launch, app, serve, DIST } = require('./browser.cjs');
(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(app('hard-lines-chess.html'));
  await page.waitForSelector('#tab-board'); await page.tap('#tab-board'); await page.waitForTimeout(200);
  const b = await page.locator('#practiceBoard .sq[aria-label="b3"]').boundingBox();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + 20, y: b.y + 20 }] });
  await page.waitForTimeout(650);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(150);
  console.log('long-press b3:', await page.locator('#practiceBoard .sq[aria-label="b3"]').getAttribute('class'));
  console.log('selected after long-press:', await page.locator('#practiceBoard .sq.sel').count());
  // short tap selects e2 and moves
  await page.tap('#practiceBoard .sq[aria-label="e2"]');
  console.log('selected after tap:', await page.locator('#practiceBoard .sq.sel').count());
  await page.tap('#practiceBoard .sq[aria-label="e4"]'); await page.waitForTimeout(250);
  console.log('moves:', (await page.locator('#practiceMoves').innerText()).replace(/\s+/g, ' '));
  console.log('highlight kept after move?', await page.locator('#practiceBoard .sq.hl-1').count());
  console.log(errors.length ? errors : 'no errors');
  await browser.close();
})();
