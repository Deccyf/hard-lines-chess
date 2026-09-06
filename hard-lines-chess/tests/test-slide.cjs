const { launch, app, serve, DIST } = require('./browser.cjs');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(app('hard-lines-chess.html'));
  await page.waitForTimeout(600);
  await page.locator('#tab-play').click();
  await page.selectOption('#bandSelect', '0');   // fastest band: proves the floor, not the search
  await page.waitForTimeout(200);

  // Watch for the sliding class appearing at any point during the move.
  await page.evaluate(() => {
    window.__slides = 0;
    const obs = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes' && r.target.classList?.contains('sliding')) window.__slides++;
      }
    });
    obs.observe(document.getElementById('playBoard'), { subtree: true, attributes: true, attributeFilter: ['class'] });
  });

  const t0 = Date.now();
  await page.locator('#playBoard [data-sq="20"]').click();   // e2
  await page.locator('#playBoard [data-sq="52"]').click();   // e4
  // Catch the transform mid-flight.
  await page.waitForTimeout(60);
  const midFlight = await page.evaluate(() => {
    const p = document.querySelector('#playBoard .piece.sliding');
    return p ? getComputedStyle(p).transform : null;
  });
  await page.waitForTimeout(2500);
  const replyAt = await page.evaluate(() => window.__replyAt ?? null);
  const elapsed = Date.now() - t0;

  console.log('slide class applied:', await page.evaluate(() => window.__slides), 'times');
  console.log('transform seen mid-flight:', midFlight && midFlight !== 'none' ? midFlight.slice(0, 40) : 'NONE');
  console.log('moves on board:', await page.locator('#playMoves li').count());
  console.log('time from tap to reply settled:', elapsed, 'ms (floor is 420ms after the search)');
  console.log('transition on a piece:', await page.evaluate(() => {
    const p = document.querySelector('#playBoard .piece');
    p.classList.add('sliding');
    const t = getComputedStyle(p).transitionDuration;
    p.classList.remove('sliding');
    return t;
  }));
  console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors');
  await browser.close();
})();
