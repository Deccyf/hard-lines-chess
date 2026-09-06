// The bottom of the rating scale, and the sentence that has to be there.
//
// WHAT WENT WRONG. estimateRating() clamps to the lowest band the calibration
// played, which is 0 — so a game worse than anything measured came back as elo
// 0, and the Progress page printed "looked like 0" beside it. Read on a phone
// that is not a strength, it is a missing value. The review panel described the
// identical estimate correctly as "under 300", because two places turned the
// same object into words and only one of them knew the floor existed.
//
// AND THE DEEPER PROBLEM THE WORDING WAS HIDING. At the quick setting the
// weakest opponent this app has measured loses about 0.95 pawns a move. A
// player losing more than that lands below the whole scale, so every one of
// their games reads the same and the figure tells them nothing. That is a real
// limit of the measurement and the screen now says so, with the measured
// number in it rather than an adjective.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');

(async () => {
  const srv = serve(DIST, 8285);
  await srv.ready;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const say = (k, v) => console.log(String(k).padEnd(46), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got) : `${got}   <- expected ${want}`);
    if (!ok) failures.push(what);
  };

  await page.goto('http://127.0.0.1:8285/hard-lines-chess-app.html');
  await page.waitForSelector('#tab-today', { timeout: 20000 });

  // ── the estimate never becomes a bare number it does not mean ────────────
  const words = await page.evaluate(() => [800, 300, 93, 60, 40, 20, 8, 3].map((loss) => {
    const est = estimateRating(loss, 7);
    return { loss, elo: est.elo, floor: est.floorHit, ceiling: est.ceilingHit,
      short: estimateWords(est, { short: true }), long: estimateWords(est) };
  }));
  for (const w of words) say(`  ${w.loss}cp`, `elo ${w.elo} — "${w.short}" / "${w.long}"`);
  check('no reading is ever the bare string "0"', words.some((w) => w.short === '0' || w.long === '0'), false);
  check('a game below the scale says it is under the floor',
    words.filter((w) => w.floor).every((w) => w.short.startsWith('under ')), true);
  check('a game above it says or above',
    words.filter((w) => w.ceiling).every((w) => w.long.endsWith('or above')), true);
  check('and one inside it is a number', words.find((w) => !w.floor && !w.ceiling)?.short.match(/^\d+$/) !== null, true);

  // ── the floor loss reached the page from the calibration ─────────────────
  const floorLoss = await page.evaluate(() => estimateRating(500, 7).floorLoss);
  say('the weakest measured band loses', `${floorLoss}cp a move at depth 7`);
  check('the measured floor loss is on the page', Number.isFinite(floorLoss) && floorLoss > 0, true);
  check('and it is the calibration figure, not a typed one',
    await page.evaluate(() => RATING_FIT.losses['7'][String(RATING_FIT.bands[0])]), floorLoss);

  // ── the Games-reviewed row, which is where it was seen ───────────────────
  await page.evaluate((loss) => {
    const rough = (n) => ({
      at: n, white: 'Someone', black: 'You', result: '0-1', side: 'black', plies: 60,
      reviewed: true, accuracy: 69, meanLoss: loss, depth: 7, mistakes: [],
      estimate: estimateRating(loss, 7), pgn: '1. e4 e5',
    });
    App.reviews.games = [1, 2, 3, 4, 5].map((n) => rough(93 + n));
    show('progress');
  }, 93);
  await page.waitForTimeout(400);
  const progress = await page.$eval('#progressOut', (e) => e.textContent);
  say('the row now reads', (progress.match(/looked like [^·\n]*/) ?? ['(none)'])[0].trim().slice(0, 40));
  check('the row no longer says "looked like 0"', progress.includes('looked like 0'), false);
  check('it says under the floor instead', progress.includes('looked like under 300'), true);

  // ── and the panel explains why there is no number ────────────────────────
  check('the scale says it has run out', progress.includes('The scale has run out below you'), true);
  check('with the measured loss in it', progress.includes(`${(floorLoss / 100).toFixed(2)} pawns a move`), true);
  check('and points at the measure that still works', progress.includes('Mistakes a game, above'), true);
  check('the middle readout is not a bare zero', progress.includes('Middle of your last 5under 300') || progress.includes('under 300'), true);

  check('a range of one thing is not said twice', progress.includes('under 300 to under 300'), false);
  check('it says they were all the same instead', progress.includes('all under 300'), true);
  // AND NO BAND IS RECOMMENDED FROM A FLOORED ESTIMATE. The nearest rung to
  // elo 0 is the band that plays a random move three times in five, which is
  // not what these games say anybody should play.
  check('no band button off a floored estimate',
    await page.$$eval('#progressOut button', (b) => b.map((x) => x.textContent).some((t) => /^Play the /.test(t))), false);
  check('and it says why, pointing at the real record',
    progress.includes('pick the band by your record against it'), true);

  // ── a player inside the scale still gets a number, and no lecture ────────
  await page.evaluate(() => {
    App.reviews.games = [1, 2, 3, 4, 5].map((n) => ({
      at: n, white: 'Someone', black: 'You', result: '0-1', side: 'black', plies: 60,
      reviewed: true, accuracy: 88, meanLoss: 35, depth: 7, mistakes: [],
      estimate: estimateRating(35, 7), pgn: '1. e4 e5',
    }));
    show('progress');
  });
  await page.waitForTimeout(400);
  const inside = await page.$eval('#progressOut', (e) => e.textContent);
  say('inside the scale', (inside.match(/looked like [^·\n]*/) ?? ['(none)'])[0].trim().slice(0, 30));
  check('a measurable game gets a number', /looked like \d/.test(inside), true);
  check('and is not told the scale ran out', inside.includes('The scale has run out'), false);
  check('and does get a band to play',
    await page.$$eval('#progressOut button', (b) => b.map((x) => x.textContent).some((t) => /^Play the /.test(t))), true);

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
