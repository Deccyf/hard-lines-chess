const { launch, app, serve, DIST } = require('./browser.cjs');
// A game with SEVERAL missed mates in a row, which is exactly the shape that
// used to take every slot in the mistake list.
const REAL = "[White \"Me\"] [Black \"Them\"]\n1. Nf3 Nc6 2. d4 d5 3. Nc3 Nf6 4. Be3 e6 5. Nd2 Ng4 6. Bh6 Nxh6 7. Rb1 Nxd4 8. e4 dxe4 9. Ndxe4 c6 10. f4 Nhf5 11. Nc5 Bxc5 12. Bd3 Qh4+ 13. g3 Nxg3 14. hxg3 Qxh1+ 15. Bf1 Qh2 16. Qc1 Nf3+ 17. Kd1 Qf2 18. Ne4 Qxf1#";

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1200 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(app());
  await page.waitForSelector('#tab-review');
  const say = (k, v) => console.log(String(k).padEnd(26), v);
  await page.click('#tab-review');
  await page.fill('#pgnInput', REAL);
  await page.fill('#reviewName', 'Me');
  await page.selectOption('#reviewDepth', '7');
  await page.click('#reviewRun');
  await page.waitForFunction(() => document.getElementById('reviewStatus').textContent.startsWith('Done'), null, { timeout: 240000 });
  await page.waitForTimeout(400);

  say('status', await page.locator('#reviewStatus').innerText());
  const res = await page.evaluate(() => ({
    capped: Review.result.capped,
    kinds: Review.result.mistakes.map((m) => m.kind),
    curvePoints: Review.result.whiteCp.length,
  }));
  say('capped', JSON.stringify(res.capped));
  say('mate kinds listed', res.kinds.filter((k) => k !== 'material').join(',') || '(none)');
  say('at most one of each', res.kinds.filter((k) => k === 'allowed_mate').length <= 1 && res.kinds.filter((k) => k === 'missed_mate').length <= 1);
  say('capped sentence', (await page.locator('#reviewOut .panel .note').allInnerTexts()).find((t) => t.includes('also')) ?? '(none — was anything capped?)');
  say('curve drawn', await page.locator('svg.curve').count());
  say('curve points', res.curvePoints);
  say('curve polyline pts', await page.locator('svg.curve polyline').getAttribute('points').then((p) => p.split(' ').length));
  say('mistake dots', await page.locator('svg.curve circle').count());
  say('curve heading', await page.locator('#reviewOut h3').allInnerTexts().then((t) => t.join(' | ')));
  const geo = await page.evaluate(() => { const r = document.querySelector('svg.curve').getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; });
  say('curve size', geo);
  await page.locator('#reviewMoves .mv').nth(6).click();
  await page.waitForTimeout(300);
  say('plain eval line', await page.locator('#reviewBoardEval').innerText());
  say('ask-why button', await page.locator('#reviewAskWhy').isHidden() ? 'hidden (no coach here)' : 'shown');
  await page.locator('#reviewOut').screenshot({ path: 'review-curve.png' }).catch(() => {});
  console.log(errors.length ? 'ERRORS ' + errors.slice(0, 3).join(' | ') : 'no page errors');
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
