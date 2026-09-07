// The progress chart, with a review history made up on the spot.
//
// The honesty is the thing being tested, not the drawing: with three games it
// must refuse to call a difference a trend, and with a flat history it must
// say flat rather than find a direction in noise.
//
// AND THAT IT STAYS READABLE AS THE GAMES PILE UP. At two hundred games a mark
// per game is a solid block with the trend hidden inside it, so past a cap the
// games stop being drawn individually and the band carries their spread
// instead. That cap is the thing this checks: below it every game is a dot,
// above it none are, and either way the trend, the band, the latest game and
// the vertical scale are all still on screen.
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
  check('dots match the games', await page.$$eval('#progressOut .chart-dot', (e) => e.length), 3);

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
  say('verdict', risingText.match(/First \d+ games:[^]*?in you\./)?.[0] ?? '(not found)');

  // Mistakes-a-game is better DOWN: falling mistakes must also read as right.
  await page.evaluate(() => { Progress.measure = 'mistakes'; renderProgress(); });
  const mistakesText = await page.$eval('#progressOut', (e) => e.textContent);
  check('falling mistakes read right', mistakesText.includes('the right way'), true);

  // Games with no estimate are skipped rather than plotted as zero.
  await load([...rising.slice(0, 5).map((g) => ({ ...g, estimate: null })), ...rising.slice(5)]);
  await page.evaluate(() => { Progress.measure = 'estimate'; renderProgress(); });
  check('unscored games are dropped', await page.$$eval('#progressOut .chart-dot', (e) => e.length), 5);

  // ── the drawing, sparse and dense ────────────────────────────────────────
  const count = (sel) => page.$$eval('#progressOut ' + sel, (e) => e.length);
  const seed = (n) => Array.from({ length: n }, (_, i) =>
    game(60 + (i % 17), 3, 900 + (i % 23) * 20 + i, i + 1));

  await load(seed(24));
  await page.evaluate(() => { Progress.measure = 'estimate'; renderProgress(); });
  check('under the cap, a dot per game', await count('.chart-dot'), 24);
  check('with a trend over them', await count('.chart-trend'), 1);
  check('and the spread behind it', await count('.chart-band'), 1);
  check('the latest game is marked', await count('.chart-now'), 1);
  check('there are gridlines', await count('.chart-grid'), 3);
  check('and three scale labels', await count('.chart-yaxis span'), 3);
  // preserveAspectRatio="none" stretches the viewBox, so anything inside it is
  // stretched too. Text has to live beside the chart, never in it.
  check('none of them inside the stretched box', await count('svg text'), 0);
  // Being beside the plot instead of in it means nothing lines the labels up
  // for you. Each one has to sit on the rule it names, to the pixel.
  const drift = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.chart-yaxis span')];
    const rules = [...document.querySelectorAll('.chart-grid')];
    const mid = (e) => { const b = e.getBoundingClientRect(); return b.top + b.height / 2; };
    return Math.max(...labels.map((l, i) => Math.abs(mid(l) - mid(rules[i]))));
  });
  say('worst label-to-gridline drift', drift.toFixed(2) + 'px');
  check('every label sits on its gridline', drift < 1, true);

  await load(seed(200));
  await page.evaluate(() => { Progress.measure = 'estimate'; renderProgress(); });
  check('past the cap, no per-game dots', await count('.chart-dot'), 0);
  check('but the trend is still drawn', await count('.chart-trend'), 1);
  check('and the band, which now carries them', await count('.chart-band'), 1);
  check('and where you are now', await count('.chart-now'), 1);
  const key = await page.$eval('#progressOut .chart-key', (e) => e.textContent);
  check('and it says why the dots went', key.includes('would be one solid block'), true);
  check('and names how many games that is', key.includes('all 200'), true);

  // ── every game the same number ───────────────────────────────────────────
  //
  // Not a made-up case: a history sitting on the bottom of the strength
  // estimate looks exactly like this, and the chart used to divide by a span
  // of 1 and label the axis "300 / 301 / 300" — a scale that does not exist,
  // whose top was below its own middle.
  await load(Array.from({ length: 120 }, (_, i) => game(62, 0, 300, i + 1)));
  await page.evaluate(() => { Progress.measure = 'estimate'; renderProgress(); });
  const axis = await page.$$eval('#progressOut .chart-yaxis span', (e) => e.map((x) => x.textContent));
  say('a flat axis reads', JSON.stringify(axis));
  check('a flat run invents no scale', axis.filter(Boolean).length, 1);
  check('and labels the one number there is', axis.filter(Boolean)[0], '300');
  check('with the line down the middle', await page.$eval('#progressOut .chart-trend',
    (e) => e.getAttribute('points').split(' ').every((p) => p.endsWith(',50'))), true);
  const floored = await page.$eval('#progressOut', (e) => e.textContent);
  check('and it blames the measure, not the player', floored.includes('running out of room'), true);
  check('without saying it twice', await count('.chart-key'), 0);
  check('or naming a window that means nothing', floored.includes('line: middle of'), false);
  check('rather than calling it a flat run of form', floored.includes('That is flat:'), false);

  await load(seed(200));
  await page.evaluate(() => { Progress.measure = 'estimate'; renderProgress(); });

  // ── hovering names the game the trend line hid ───────────────────────────
  check('the tip starts hidden', await page.$eval('.chart-tip', (e) => e.hidden), true);
  const frame = await page.$eval('.chart-frame', (e) => {
    const b = e.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  await page.mouse.move(frame.x + frame.w / 2, frame.y + frame.h / 2);
  await page.waitForTimeout(120);
  const tip = await page.$eval('.chart-tip', (e) => (e.hidden ? '(hidden)' : e.textContent));
  say('hovering the middle says', tip);
  check('the tip names a game out of 200', /^Game \d+ of 200 — /.test(tip), true);
  // The middle of the frame is the middle game, give or take a pixel.
  const which = Number(tip.match(/^Game (\d+)/)[1]);
  check('and it is the game under the pointer', Math.abs(which - 100) <= 3, true);
  await page.mouse.move(frame.x + frame.w / 2, frame.y - 40);
  await page.waitForTimeout(120);
  check('and it goes away again', await page.$eval('.chart-tip', (e) => e.hidden), true);

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
