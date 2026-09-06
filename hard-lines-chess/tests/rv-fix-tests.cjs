// Pins for the fixes: a game ends once; take-back restores the clocks; the band select starts a game.
const GAME = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. d3 d6';
(async () => {
  const { browser, page, errors, say } = await require('./rv-lib.cjs')();
  let fails = 0;
  const check = (k, ok, v) => { say(k, (ok ? 'ok   ' : 'FAIL ') + v); if (!ok) fails++; };

  // 1a. finishPlay twice: one row.
  await page.click('#playBoard .sq[aria-label="e2"]'); await page.click('#playBoard .sq[aria-label="e4"]');
  await page.waitForFunction(() => !Play.thinking);
  const twice = await page.evaluate(() => { finishPlay('resigned'); finishPlay('flagged_them'); return { rows: App.history.games.length, key: Play.over.key, bands: JSON.stringify(App.history.bands) }; });
  check('finishPlay twice -> rows', twice.rows === 1, `${twice.rows} row, key ${twice.key}, bands ${twice.bands}`);

  // 1b. A reply in flight when the game ends is dropped: no move after Play.over.
  for (const variant of ['engine', 'book']) {
    await page.evaluate((pgn) => { App.history = { bands: {}, games: [] }; if (pgn) App.history.games.push({ at: 1, band: 400, colour: 'white', result: 'w', plies: 12, pgn }); }, variant === 'book' ? GAME : null);
    await page.selectOption('#bandSelect', '0');
    await page.evaluate(() => newPlayGame());
    await page.selectOption('#timeControl', '5+0');
    await page.waitForTimeout(100);
    await page.evaluate(() => { Play.clock.theirs = 250; });
    await page.click('#playBoard .sq[aria-label="e2"]'); await page.click('#playBoard .sq[aria-label="e4"]');
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => ({ over: Play.over?.key, moves: Play.moves.length, rows: App.history.games.length, bands: JSON.stringify(App.history.bands) }));
    check(`flag during ${variant} reply`, r.rows === (variant === 'book' ? 2 : 1) && r.moves === 1, `over ${r.over}, moves on board ${r.moves}, rows ${r.rows} (incl. seed), bands ${r.bands}`);
  }

  // 3. Four take-backs leave both clocks at or below the initial.
  await page.selectOption('#timeControl', '3+2');
  await page.waitForTimeout(100);
  for (let i = 0; i < 4; i++) {
    await page.click('#playBoard .sq[aria-label="e2"]'); await page.click('#playBoard .sq[aria-label="e4"]');
    await page.waitForFunction(() => !Play.thinking && Play.moves.length === 2);
    await page.click('#playTakeback'); await page.waitForTimeout(100);
  }
  const c = await page.evaluate(() => ({ mine: Play.clock.mine, theirs: Play.clock.theirs, moves: Play.moves.length, sup: Play.superseded.length }));
  check('four take-backs', c.mine <= 180000 && c.theirs <= 180000 && c.sup === 4, `mine ${c.mine} theirs ${c.theirs} superseded ${c.sup}`);
  // and after a real exchange the clocks return to what they read after the last standing move
  await page.click('#playBoard .sq[aria-label="e2"]'); await page.click('#playBoard .sq[aria-label="e4"]');
  await page.waitForFunction(() => !Play.thinking && Play.moves.length === 2);
  await page.click('#playBoard .sq[aria-label="d2"]'); await page.click('#playBoard .sq[aria-label="d4"]');
  await page.waitForFunction(() => !Play.thinking && Play.moves.length === 4);
  const snap = await page.evaluate(() => JSON.stringify(Play.moves[1].clock));
  await page.click('#playTakeback'); await page.waitForTimeout(100);
  const back = await page.evaluate(() => JSON.stringify({ mine: Play.clock.mine, theirs: Play.clock.theirs }));
  check('take-back restores the snapshot', snap === back, `${snap} -> ${back}`);

  // 2. Band select: cancel keeps the game and the select; accept starts a new one under the new band.
  page.once('dialog', (d) => d.dismiss());
  await page.selectOption('#bandSelect', '2100'); await page.waitForTimeout(100);
  const cancelled = await page.evaluate(() => ({ band: Play.game.band.elo, select: $('bandSelect').value, moves: Play.moves.length }));
  check('band change cancelled', cancelled.band === 0 && cancelled.select === '0' && cancelled.moves === 2, JSON.stringify(cancelled));
  page.once('dialog', (d) => d.accept());
  await page.selectOption('#bandSelect', '2100'); await page.waitForTimeout(100);
  const accepted = await page.evaluate(() => ({ band: Play.game.band.elo, moves: Play.moves.length }));
  check('band change accepted', accepted.band === 2100 && accepted.moves === 0, JSON.stringify(accepted));

  // 8. Set-up PGN numbering from the FEN's move number and side.
  await page.evaluate(() => { Play.myColour = BLACK; newPlayGame('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3'); });
  await page.waitForFunction(() => !Play.thinking);
  await page.evaluate(() => { Play.moves = [{ san: 'Nf6', uci: 'g8f6' }, { san: 'Ng5', uci: 'f3g5' }, { san: 'd5', uci: 'd7d5' }]; finishPlay('resigned'); });
  const pgn = await page.evaluate(() => App.history.games.at(-1).pgn);
  check('set-up pgn numbering', pgn === '3... Nf6 4. Ng5 d5', pgn);
  const parsed = await page.evaluate(() => { const g = App.history.games.at(-1); return parsePgn(`[FEN "${g.from}"]\n[SetUp "1"]\n${g.pgn}`).plies.map((p) => p.san).join(' '); });
  check('scan still parses it', parsed === 'Nf6 Ng5 d5', parsed);

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await browser.close();
})();
