// The progress chart, with a review history made up on the spot.
//
// The honesty is the thing being tested, not the drawing: with three games it
// must refuse to call a difference a trend, and with a flat history it must
// say flat rather than find a direction in noise.
const { launch, serve, DIST } = require('./browser.cjs');

const game = (accuracy, mistakes, elo, at) => ({
  at, white: 'You', black: 'Them', result: '1-0', side: 'white',
  accuracy, plies: 60, mistakes: Array.from({ length: mistakes }, (_, i) => ({ kind: 'material', severity: 'blunder', ply: i })),
  pgn: '1. e4 e5', tactics: 0, meanLoss: 40, depth: 9,
  estimate: elo === null ? null : { elo, ceilingHit: false },
});

(async () => {
  const srv = serve(DIST, 8251);
  await srv.ready;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1100 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const say = (k, v) => console.log(String(k).padEnd(26), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got) : `${got}   <- expected ${want}`);
    if (!ok) failures.push(what);
  };

  await page.goto('http://127.0.0.1:8251/hard-lines-chess-app.html');
  await page.waitForSelector('#tab-today', { timeout: 20000 });

  const load = (games) => page.evaluate((gs) => {
    App.reviews.games = gs;
    show('progress');
    renderProgress();
    return document.querySelectorAll('#progressOut .panel').length;
  }, games);

  // ── nothing to plot ──────────────────────────────────────────────────────
  await load([game(80, 2, 1200, 1)]);
  const thin = await page.$eval('#progressOut', (e) => e.textContent);
  check('one game refuses a line', thin.includes('Three are needed'), true);

  // ── three games: a difference, not a trend ───────────────────────────────
  await load([game(70, 4, 1000, 1), game(75, 3, 1100, 2), game(90, 1, 1400, 3)]);
  const three = await page.$eval('#progressOut', (e) => e.textContent);
  check('three games draw a chart', await page.$$eval('#progressOut .curve', (e) => e.length), 1);
  check('three games say "not a trend"', three.includes('that is a difference, not a trend'), true);
  check('dots match the games', await page.$$eval('#progressOut .curve-dot', (e) => e.length), 3);

  // ── ten flat games: say flat ─────────────────────────────────────────────
  const flat = Array.from({ length: 10 }, (_, i) => game(80 + (i % 2), 3, 1200, i + 1));
  await load(flat);
  const flatText = await page.$eval('#progressOut', (e) => e.textContent);
  check('a flat history reads flat', flatText.includes('That is flat'), true);

  // ── ten improving games ──────────────────────────────────────────────────
  const rising = Array.from({ length: 10 }, (_, i) => game(60 + i * 4, 6 - Math.floor(i / 2), 1000 + i * 60, i + 1));
  await load(rising);
  const risingText = await page.$eval('#progressOut', (e) => e.textContent);
  check('a rising history reads right', risingText.includes('the right way'), true);
  say('verdict', risingText.match(/[\d.]+% across the first[^.]*\./)?.[0] ?? '(not found)');

  // Mistakes-a-game is better DOWN: falling mistakes must also read as right.
  await page.evaluate(() => { Progress.measure = 'mistakes'; renderProgress(); });
  const mistakesText = await page.$eval('#progressOut', (e) => e.textContent);
  check('falling mistakes read right', mistakesText.includes('the right way'), true);

  // Games with no estimate are skipped rather than plotted as zero.
  await load([...rising.slice(0, 5).map((g) => ({ ...g, estimate: null })), ...rising.slice(5)]);
  await page.evaluate(() => { Progress.measure = 'estimate'; renderProgress(); });
  check('unscored games are dropped', await page.$$eval('#progressOut .curve-dot', (e) => e.length), 5);

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
