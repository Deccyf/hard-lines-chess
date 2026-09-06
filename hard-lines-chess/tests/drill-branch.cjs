const { launch, app, serve, DIST, gotoSection } = require('./browser.cjs');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(app('hard-lines-chess.html'));
  await page.waitForSelector('#tab-today'); await gotoSection(page, 'openings');
  await page.locator('.opening .btn:has-text("Test me")').first().click();
  await page.waitForTimeout(100);
  await page.locator('#openingBranches .branch').nth(1).click(); // Two Knights branch in drill mode
  await page.waitForTimeout(700);
  const state = await page.evaluate(() => ({ ply: Openings.ply, line: Openings.line, who: document.getElementById('openingWho').textContent, mode: Openings.mode, chips: document.querySelectorAll('#openingChips .chip').length }));
  console.log('after picking branch in drill:', JSON.stringify(state));
  // play the line: student moves via sanToMove
  const playSan = async (san) => page.evaluate((san) => { const v = Openings.view; const m = sanToMove(v.board, san); v.play(m); }, san);
  // wrong move first
  await playSan('a3');
  console.log('wrong prompt:', await page.locator('#openingPromptText').innerText());
  for (let guard = 0; guard < 20; guard++) {
    const s = await page.evaluate(() => ({ ply: Openings.ply, len: Openings.line.length, mine: openingStudentToMove() }));
    if (s.ply >= s.len) break;
    if (s.mine) { const san = await page.evaluate(() => Openings.line[Openings.ply]); await playSan(san); }
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(400);
  console.log('result:', await page.locator('#openingResult').innerText());
  console.log('card (branch):', await page.evaluate(() => JSON.stringify(App.openings.cards[openingCardKey(Openings.current, Openings.branch)])));
  console.log('card (main untouched):', await page.evaluate(() => JSON.stringify(App.openings.cards[Openings.current.id] ?? null)));
  // Back mid-drill: start again, then Back while an opponent reply is pending
  await page.click('#openingFinish');
  await page.locator('.opening .btn:has-text("Test me")').nth(1).click();
  await page.waitForTimeout(50);
  await page.click('#openingClose');
  await page.waitForTimeout(800);
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})();
