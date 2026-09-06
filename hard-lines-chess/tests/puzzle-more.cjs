const { launch, app, serve, DIST } = require('./browser.cjs');

// One game he WON with a tactic he actually found (Black hangs the queen to a
// fork he plays), and one that ends in a mate the opponent walked into.
const FOUND = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3#';
const MATE  = '1. e4 e5 2. Bc4 Bc5 3. Qh5 Nf6 4. Qxf7#';

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(app('hard-lines-chess.html'));
  await page.waitForSelector('#tab-puzzles');
  await page.evaluate(([a, b]) => {
    localStorage.setItem('hardlines:history', JSON.stringify({ bands: {}, games: [
      { at: 1756900000001, band: 800, colour: 'black', result: 'w', plies: 14, pgn: a },
      { at: 1756900000002, band: 300, colour: 'white', result: 'w', plies: 7, pgn: b },
    ] }));
  }, [FOUND, MATE]);
  await page.reload();
  await page.waitForSelector('#tab-puzzles');
  await page.click('#tab-puzzles');
  await page.click('#puzzleScan');
  await page.waitForFunction(() => !Puzzles.scanning, null, { timeout: 240000 });
  const say = (k, v) => console.log(String(k).padEnd(24), v);
  say('scan note', await page.locator('#puzzleScanNote').innerText());
  say('items', await page.evaluate(() => App.puzzles.items.map((p) => `${p.moveNumber}${p.side === 'white' ? '.' : '...'} they=${p.theirMove} best=${p.best.san} you=${p.yourMove} found=${p.found} mate=${p.mate} edge=${p.edge}`).join('\n' + ' '.repeat(25))));
  say('head', (await page.locator('#puzzleHead').innerText()).replace(/\n/g, ' | '));
  say('due now', await page.evaluate(() => duePuzzles().length + ' of ' + App.puzzles.items.length));
  say('found cards deferred', await page.evaluate(() => App.puzzles.items.filter((p) => p.found).every((p) => p.card.due > Date.now())));
  const mate = await page.evaluate(() => App.puzzles.items.find((p) => p.mate !== null && p.mate !== undefined) ?? null);
  if (mate) {
    await page.evaluate((id) => startPuzzle(App.puzzles.items.find((p) => p.id === id), { scoring: false }), mate.id);
    say('mate prompt', await page.locator('#puzzlePrompt').innerText());
    await page.evaluate(() => { const v = Puzzles.view; v.play(sanToMove(v.board, Puzzles.current.best.san)); });
    await page.waitForTimeout(300);
    say('mate answer', await page.locator('#puzzleAnswer').innerText());
  } else say('mate puzzle', 'none found');
  const never = await page.evaluate(() => App.puzzles.items.filter((p) => p.found === null).length);
  say('never-asked count', never);
  say('list flags', (await page.locator('.puzzle-flag').allInnerTexts()).join(' | '));
  console.log(errors.length ? 'ERRORS ' + errors.join('|') : 'no page errors');
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
