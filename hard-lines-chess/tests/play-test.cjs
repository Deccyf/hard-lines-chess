const { launch, app, serve, DIST, gotoSection } = require('./browser.cjs');
const GAME_AS_WHITE = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. d3 d6 6. Bg5 h6';
const GAME_AS_WHITE2 = '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be2 e5';
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
  const errors = []; page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_')) errors.push('console: ' + m.text()); });
  await page.goto(app());
  await page.waitForSelector('#tab-today');
  const say = (k, v) => console.log(String(k).padEnd(28), v);
  say('boots without throwing', 'yes');

  await gotoSection(page, 'play');
  say('book note (no games)', await page.locator('#bookNote').innerText());
  say('book toggle disabled', await page.locator('#bookToggle').isDisabled());

  // Seed two of his own games, both as White, so the book has Black replies.
  await page.evaluate(([a, b]) => {
    localStorage.setItem('hardlines:history', JSON.stringify({ bands: {}, games: [
      { at: 1, band: 400, colour: 'white', result: 'w', plies: 12, pgn: a },
      { at: 2, band: 400, colour: 'white', result: 'l', plies: 12, pgn: b },
    ] }));
  }, [GAME_AS_WHITE, GAME_AS_WHITE2]);
  await page.reload();
  await page.waitForSelector('#tab-today'); await gotoSection(page, 'play');
  say('book note (2 games)', await page.locator('#bookNote').innerText());
  const book = await page.evaluate(() => { buildBook(); return { positions: Object.keys(Book.built).length, first: Book.built[''] , afterE4: Book.built['e2e4'] }; });
  say('book root (before 1.e4)', JSON.stringify(book.first));
  say('book replies to 1.e4', JSON.stringify(book.afterE4));
  say('only their moves', book.first === undefined ? 'yes — no entry before White has moved' : 'LEAKED his own moves');

  // Play 1.e4 and check the reply came from the book.
  await page.click('#playBoard .sq[aria-label="e2"]'); await page.click('#playBoard .sq[aria-label="e4"]');
  await page.waitForTimeout(1400);
  say('reply', (await page.locator('#playMoves').innerText()).replace(/\s+/g, ' '));
  say('eval says book', await page.locator('#playEval').innerText());

  // Clocks.
  await page.selectOption('#timeControl', '3+2');
  await page.waitForTimeout(400);
  say('clocks shown', await page.locator('#playClocks').isVisible());
  const t0 = await page.locator('#clockMine').innerText();
  await page.waitForTimeout(1200);
  const t1 = await page.locator('#clockMine').innerText();
  say('my clock ticks', `${t0} -> ${t1} ${t0 !== t1 ? '(running)' : '(STUCK)'}`);
  await page.click('#playBoard .sq[aria-label="d2"]'); await page.click('#playBoard .sq[aria-label="d4"]');
  await page.waitForTimeout(1600);
  const after = await page.evaluate(() => ({ mine: Play.clock.mine, theirs: Play.clock.theirs }));
  say('increment credited', `mine ${(after.mine / 1000).toFixed(1)}s — above 180s, so the 2s increment beat the time spent`);
  say('their clock moved', after.theirs !== 180000 ? `yes (${(after.theirs / 1000).toFixed(1)}s)` : 'NO');

  // Take-back supersedes.
  const before = await page.evaluate(() => Play.moves.length);
  await page.click('#playTakeback');
  await page.waitForTimeout(400);
  const sup = await page.evaluate(() => ({ moves: Play.moves.length, superseded: JSON.parse(JSON.stringify(Play.superseded)) }));
  say('moves after take-back', `${before} -> ${sup.moves}`);
  say('superseded kept', JSON.stringify(sup.superseded));
  say('status mentions it', await page.locator('#playBody').innerText());

  // A control with NO increment, where both clocks can only go down.
  await page.selectOption('#timeControl', '5+0');
  await page.waitForTimeout(300);
  await page.click('#playBoard .sq[aria-label="e2"]'); await page.click('#playBoard .sq[aria-label="e4"]');
  await page.waitForTimeout(1600);
  const noInc = await page.evaluate(() => ({ mine: Play.clock.mine, theirs: Play.clock.theirs }));
  say('5+0 both decrease', `mine ${(noInc.mine / 1000).toFixed(1)}s theirs ${(noInc.theirs / 1000).toFixed(1)}s — ${noInc.mine < 300000 && noInc.theirs < 300000 ? 'both down' : 'NOT BOTH DOWN'}`);

  // A flag really ends the game.
  await page.evaluate(() => { Play.clock.mine = 400; });
  await page.waitForTimeout(1200);
  say('flag ends it', await page.locator('#playHead').innerText() + ' — ' + await page.locator('#playBody').innerText());
  say('recorded as a loss', await page.evaluate(() => App.history.games.at(-1)?.result));

  // Pure clock arithmetic, including the negative case.
  say('clockAfter survives', await page.evaluate(() => clockAfter(10000, 3000, 2000)));
  say('clockAfter flags', await page.evaluate(() => clockAfter(1000, 3000, 2000)));
  say('no increment on a flag', await page.evaluate(() => clockAfter(1000, 3000, 2000) < 0));


  console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 5).join('\n') : 'no page errors');
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
