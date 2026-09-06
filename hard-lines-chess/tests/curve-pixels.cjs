const { launch, app, serve, DIST } = require('./browser.cjs');
const REAL = require('fs').readFileSync('selfplay.json', 'utf8');
(async () => {
  const pgn = '[White "Me"] [Black "Them"]\n' + JSON.parse(REAL).pgn;
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1200 } });
  await page.goto(app());
  await page.waitForSelector('#tab-review'); await page.click('#tab-review');
  await page.fill('#pgnInput', pgn); await page.fill('#reviewName', 'Me');
  await page.selectOption('#reviewDepth', '7'); await page.click('#reviewRun');
  await page.waitForFunction(() => document.getElementById('reviewStatus').textContent.startsWith('Done'), null, { timeout: 300000 });
  await page.waitForTimeout(400);
  const say = (k, v) => console.log(String(k).padEnd(26), v);

  // Sample the chart down a column where the chance is known, and check the
  // shading really does reach the floor and stop at the line.
  const probe = await page.evaluate(() => {
    const svg = document.querySelector('svg.curve');
    // elementFromPoint answers in VIEWPORT coordinates and returns null for a
    // point below the fold; the chart sits under two panels of prose and its
    // lower half was off-screen at 1200px, which read as "no shading".
    svg.scrollIntoView({ block: 'center' });
    const box = svg.getBoundingClientRect();
    const d = svg.querySelector('.curve-fill').getAttribute('d');
    const chance = Review.result.whiteCp.map((cp) => { const s = Math.abs(cp) > 29000 ? (cp > 0 ? 1 : 0) : winChance(cp); return Review.side === 'white' ? s : 1 - s; });
    // The fattest column, so there is room to sample inside and outside.
    let i = 0; chance.forEach((c, k) => { if (c > chance[i]) i = k; });
    const x = box.left + (i / (chance.length - 1)) * box.width;
    const hit = (frac) => document.elementFromPoint(x, box.top + Math.min(box.height - 1, box.height * frac))?.getAttribute('class') ?? 'none';
    const c = chance[i];
    return {
      best: c.toFixed(2),
      startsAtFloor: d.startsWith('M0,100'),
      endsAtFloor: /,100 Z$/.test(d),
      insideFill: hit(1 - c / 2),      // between the line and the floor
      aboveLine: hit((1 - c) / 2),     // above the line, should be empty
    };
  });
  say('fattest column chance', probe.best);
  say('path starts at floor', probe.startsAtFloor);
  say('path ends at floor', probe.endsAtFloor);
  say('inside the shading', probe.insideFill);
  say('above the line', probe.aboveLine);
  say('shading is below only', probe.insideFill === 'curve-fill' && probe.aboveLine !== 'curve-fill');

  // Tapping the chart selects a move.
  const box = await page.locator('.curve-frame').boundingBox();
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height / 2);
  await page.waitForTimeout(300);
  say('tap selects a move', await page.locator('#reviewBoardNote').innerText().then((t) => t.slice(0, 46)));
  say('board shown', await page.locator('#reviewBoardWrap').isVisible());
  await page.locator('#reviewOut .panel').nth(1).screenshot({ path: 'curve-only.png' });
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
