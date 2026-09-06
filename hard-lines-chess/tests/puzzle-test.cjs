const { launch, app, serve, DIST, gotoSection } = require('./browser.cjs');

const GAME = '1. e4 e5 2. Qh5 Nc6 3. Qxe5+ Be7 4. Qxg7 Bf6 5. Qg3 d6 6. Nf3 Bg4 7. Be2 Qd7 8. O-O O-O-O 9. h3 Bxf3 10. Bxf3';

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CONNECTION')) errors.push('console: ' + m.text()); });

  await page.goto(app('hard-lines-chess.html'));
  await page.waitForSelector('#tab-today');
  await page.evaluate((pgn) => {
    localStorage.setItem('hardlines:history', JSON.stringify({
      bands: { 400: { w: 0, d: 0, l: 1 } },
      games: [{ at: 1756900000000, band: 400, colour: 'black', result: 'l', plies: 19, pgn }],
    }));
  }, GAME);
  await page.reload();
  await page.waitForSelector('#tab-today');

  const say = (k, v) => console.log(String(k).padEnd(30), v);
  await gotoSection(page, 'today');
  say('today rows', (await page.locator('.task').allInnerTexts()).map((t) => t.split('\n')[1]).join(' | '));

  await gotoSection(page, 'puzzles');
  say('empty note visible', await page.locator('#puzzleEmpty').isVisible());
  say('scan button', await page.locator('#puzzleScan').innerText());
  await page.click('#puzzleScan');
  await page.waitForFunction(() => !Puzzles.scanning, null, { timeout: 180000 });
  say('scan note', await page.locator('#puzzleScanNote').innerText());
  say('stored', await page.evaluate(() => App.puzzles.items.length));
  say('items', await page.evaluate(() => App.puzzles.items.map((p) => `${p.moveNumber}${p.side === 'white' ? '.' : '...'} they=${p.theirMove} best=${p.best.san} you=${p.yourMove} found=${p.found} edge=${p.edge} mate=${p.mate} margin=${p.margin} line="${p.line}"`).join('\n' + ' '.repeat(31))));
  say('head', (await page.locator('#puzzleHead').innerText()).replace(/\n/g, ' | '));
  say('list rows', await page.locator('.puzzle-row').count());
  say('rescan offered', await page.locator('#puzzleScan').isHidden());

  // Solve one wrongly, then check scheduling
  await page.click('#puzzleStart');
  say('prompt', await page.locator('#puzzlePrompt').innerText());
  say('where', await page.locator('#puzzleWhere').innerText());
  say('arrows before answer', await page.locator('#puzzleBoard .arrows').count());
  const before = await page.evaluate(() => JSON.stringify(Puzzles.current.card));
  await page.evaluate(() => {
    const v = Puzzles.view;
    const legal = v.board.legalMoves().filter((m) => toSan(v.board, m).replace(/[+#]$/, '') !== Puzzles.current.best.san.replace(/[+#]$/, ''));
    v.play(legal[0]);
  });
  await page.waitForTimeout(400);
  say('wrong answer', await page.locator('#puzzleAnswer').innerText());
  say('arrows after', await page.locator('#puzzleBoard .arrow-head').count());
  say('card moved', before + ' -> ' + await page.evaluate(() => JSON.stringify(App.puzzles.items.find((p) => p.id === Puzzles.current.id).card)));

  await page.click('#puzzleNext');
  await page.waitForTimeout(300);
  const solveRight = async () => {
    await page.evaluate(() => { const v = Puzzles.view; v.play(sanToMove(v.board, Puzzles.current.best.san)); });
    await page.waitForTimeout(400);
    return page.locator('#puzzleAnswer').innerText();
  };
  if (await page.locator('#puzzleBoardWrap').isVisible()) {
    say('right answer', await solveRight());
    await page.click('#puzzleNext'); await page.waitForTimeout(300);
  }
  say('after queue', (await page.locator('#puzzleCount').innerText()) || '(empty)');

  // Replay from the list must not reschedule
  if (await page.locator('.puzzle-row').count()) {
    const cardBefore = await page.evaluate(() => JSON.stringify(App.puzzles.items[0].card));
    await page.locator('.puzzle-row').first().click();
    await page.waitForTimeout(200);
    say('replay note', await page.locator('#puzzleCount').innerText());
    await page.evaluate(() => { const v = Puzzles.view; v.play(sanToMove(v.board, Puzzles.current.best.san)); });
    await page.waitForTimeout(400);
    say('card unchanged', cardBefore === await page.evaluate(() => JSON.stringify(App.puzzles.items[0].card)));
  }

  // Download button present and pressable
  await gotoSection(page, 'today');
  say('download panel visible', await page.locator('#downloadWrap').isVisible());

  say('install how-to present', (await page.locator('#section-today').innerText()).includes('Add to Home Screen'));
  say('download row on file://', await page.locator('#downloadRow').isHidden() ? 'hidden' : 'VISIBLE');
  say('download note', await page.locator('#downloadNote').innerText());

  await page.setViewportSize({ width: 390, height: 844 });
  await gotoSection(page, 'puzzles'); await page.waitForTimeout(300);
  await page.screenshot({ path: 'puzzles-phone.png', fullPage: true });
  console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 6).join('\n') : 'no page errors');
  await browser.close();
})().catch((e) => { console.error('DRIVER FAILED', e.message); process.exit(1); });
