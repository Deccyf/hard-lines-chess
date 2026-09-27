// ── re-measuring the games that were measured by a clock ───────────────────
//
// The reviewer used to be given a number of seconds and is given a number of
// positions now, so every game analysed before that change carries figures
// whose value depended on the device and the moment: the same game reviewed
// twice moved by up to 220 rating points.
//
// THERE WAS NO WAY TO REDO THEM. The walk only ever offered games flagged
// `reviewed === false`, and walking one sets that flag for good — so a history
// analysed under the old budget was stuck with it, and the button said "every
// imported game has been reviewed" to somebody whose numbers were all
// incomparable.
//
// This drives the whole path: what the queue offers, what it leaves alone,
// that a game already measured by work is NOT redone, that every game ends up
// recording the budget that measured it, and that pressing the button again
// afterwards says so rather than walking everything a second time.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');

(async () => {
  const srv = serve(DIST, 8431); await srv.ready;
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:8431/hard-lines-chess-app.html');
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  const say = (k, v) => console.log(String(k).padEnd(34), v);
  const fails = [];
  const check = (what, got, want) => {
    const ok = got === want; say(what, ok ? String(got) : `${got}   <- expected ${want}`);
    if (!ok) fails.push(what);
  };

  await page.evaluate(() => {
    const moves = FAMOUS_GAMES.find((g) => g.id === 'opera').moves;
    const pgn = `[Event "Live Chess"]\n[White "you"]\n[Black "opp"]\n[Result "1-0"]\n[TimeControl "600"]\n\n${moves}`;
    const mk = (i, kind) => {
      const g = { at: 1700000000000 + i * 86400000, white: 'you', black: 'opp', result: '1-0', side: 'white',
        plies: 33, source: 'chess.com', timeClass: 'blitz', timeControl: '600', myRating: 1000, pgn, mistakes: [] };
      if (kind === 'fresh') { g.reviewed = false; return g; }
      // Measured under the old clock: figures, but no record of the work.
      g.reviewed = true; g.accuracy = 90; g.meanLoss = 30; g.depth = 7;
      g.estimate = estimateRating(30, 7);
      if (kind === 'measured') g.nodes = 25000;   // already on a work budget
      return g;
    };
    App.reviews.games = [
      ...Array.from({ length: 3 }, (_, i) => mk(i, 'fresh')),
      ...Array.from({ length: 4 }, (_, i) => mk(10 + i, 'stale')),
      ...Array.from({ length: 2 }, (_, i) => mk(20 + i, 'measured')),
    ];
  });
  await gotoSection(page, 'review');
  await page.evaluate(() => { renderImport(); });
  await page.waitForTimeout(300);

  const q = await page.evaluate(() => { const { fresh, stale } = walkQueue(); return { fresh: fresh.length, stale: stale.length, total: unwalkedGames().length }; });
  check('never analysed, offered', q.fresh, 3);
  check('measured by the clock, offered', q.stale, 4);
  check('measured by work, left alone', q.total, 7);
  say('the note before pressing', await page.textContent('#walkNote'));
  say('the button', await page.textContent('#walkRun'));

  // Run it at the quickest setting and let it finish.
  await page.selectOption('#walkDepth', '7');
  await page.click('#walkRun');
  await page.waitForFunction(() => !Walk.running && $('walkRun').hidden === false, { timeout: 600000 });
  say('after the walk', await page.textContent('#walkNote'));

  const after = await page.evaluate(() => ({
    left: unwalkedGames().length,
    allHaveNodes: App.reviews.games.every((g) => Number.isFinite(g.nodes)),
    nodesUsed: [...new Set(App.reviews.games.map((g) => g.nodes))].sort((a, b) => a - b),
    allMeasured: App.reviews.games.every((g) => Number.isFinite(g.meanLoss)),
  }));
  check('nothing left to do', after.left, 0);
  check('every game records its budget', after.allHaveNodes, true);
  check('every game has figures', after.allMeasured, true);
  say('budgets now on record', after.nodesUsed.join(', '));

  // Pressing again must be a no-op that says so, not a second pass.
  await page.click('#walkRun');
  await page.waitForTimeout(600);
  say('pressing it again', await page.textContent('#walkNote'));
  check('and it did not start over', await page.evaluate(() => Walk.running), false);

  console.log(errors.length ? `PAGE ERRORS ${errors.join(' | ')}` : 'no page errors');
  console.log(fails.length ? `FAILED: ${fails.join(' | ')}` : 'ok');
  srv.stop(); await browser.close();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER FAILED', e.message); process.exit(1); });
