// The clock mode, driven with a known position so the flow can be checked
// without waiting on the bank generator.
//
// What matters here is the arithmetic and the honesty: a right move scores and
// moves on, a wrong one costs ten seconds and names the move, and the screen
// says which of the two sources each position came from.
const { launch, serve, DIST } = require('./browser.cjs');

// Back-rank mate, verified on the board: Ra8 is the only mate in one.
const MATE = { fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', uci: 'a1a8', san: 'Ra8#' };

(async () => {
  const srv = serve(DIST, 8271);
  await srv.ready;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1100 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const say = (k, v) => console.log(String(k).padEnd(30), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got) : `${got}   <- expected ${want}`);
    if (!ok) failures.push(what);
  };

  await page.goto('http://127.0.0.1:8271/hard-lines-chess-app.html');
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  check('Clock tab present', await page.$$eval('#tabs .tab', (e) => e.map((x) => x.textContent).includes('Clock')), true);

  // Two copies of the same mate, filed as the player's own tactics.
  await page.evaluate((m) => {
    App.puzzles.items = [
      { fen: m.fen, best: { uci: m.uci, san: m.san }, mate: 1, label: 'the 1200 band', line: m.san },
      { fen: m.fen, best: { uci: m.uci, san: m.san }, mate: 1, label: 'the 1200 band', line: m.san },
    ];
    show('storm');
    renderStorm();
  }, MATE);
  await page.waitForTimeout(150);
  say('source line', await page.$eval('#stormSource', (e) => e.textContent));
  check('own tactics are counted', await page.$eval('#stormSource', (e) => e.textContent).then((t) => t.includes('2 of your own')), true);

  await page.click('#stormStart');
  await page.waitForTimeout(250);
  check('a position is shown', await page.$eval('#stormPrompt', (e) => e.textContent).then((t) => t.includes('Mate in 1')), true);
  check('it says where it came from', await page.$eval('#stormWhere', (e) => e.textContent).then((t) => t.includes('your own game')), true);

  // ── a wrong move costs time and names the answer ──────────────────────────
  const before = await page.evaluate(() => Storm.endsAt);
  await page.evaluate(() => {
    const move = Storm.view.board.legalMoves().find((m) => moveToUci(m) === 'g1h1');
    onStormMove({ move });
  });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => Storm.endsAt);
  check('a wrong move costs ten seconds', Math.round((before - after) / 1000), 10);
  check('and names the move', await page.$eval('#stormFeedback', (e) => e.textContent).then((t) => t.includes('Ra8#')), true);
  check('and scores nothing', await page.evaluate(() => Storm.solved), 0);
  check('and breaks the streak', await page.evaluate(() => Storm.streak), 0);

  // ── a right move scores and moves on ──────────────────────────────────────
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const move = Storm.view.board.legalMoves().find((m) => moveToUci(m) === 'a1a8');
    onStormMove({ move });
  });
  await page.waitForTimeout(400);
  check('a right move scores', await page.evaluate(() => Storm.solved), 1);

  // Two puzzles, both attempted: the run ends because it runs out.
  await page.waitForTimeout(400);
  check('the run ends when it runs out', await page.evaluate(() => Storm.running), false);
  say('summary', await page.$eval('#stormSummary', (e) => e.textContent));
  check('the best is recorded', await page.evaluate(() => Storm.best?.score), 1);

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
