// Your own rating, which is the one number in this app it did not invent.
//
// The app's strength estimate compares a game with two games apiece of its own
// bots, on a ladder whose rungs above 1200 are not even in order. A player who
// has imported their games has something far better in them: the rating
// Chess.com gave them, on the day, for that game.
//
// WHAT MATTERS HERE IS THE HONESTY, not the arithmetic. An estimate built from
// your own games is only worth anything while there are enough of them, while
// the game being asked about resembles them, and while losing less per move
// really does go with being rated higher for you. Each of those three has to
// be SAID when it fails — a number that keeps printing confidently as its
// evidence runs out is worse than no number.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');

(async () => {
  const srv = serve(DIST, 8295);
  await srv.ready;
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 1400 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const say = (k, v) => console.log(String(k).padEnd(46), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got) : `${got}   <- expected ${want}`);
    if (!ok) failures.push(what);
  };

  await page.goto('http://127.0.0.1:8295/hard-lines-chess-app.html');
  await page.waitForSelector('#tab-today', { timeout: 20000 });

  // A history where losing less really does go with being rated higher, which
  // is what the estimate assumes and what it has to check.
  const load = (n, opts = {}) => page.evaluate(({ count, o }) => {
    let s = 7;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    App.reviews.games = Array.from({ length: count }, (_, i) => {
      const rating = 900 + Math.round((i / Math.max(1, count - 1)) * 200);
      // Loss falls as rating rises, with noise on top — unless the test asks
      // for the two to have nothing to do with each other.
      const loss = o.scrambled
        ? 30 + rnd() * 40
        : Math.max(8, 90 - (rating - 900) * 0.3 + (rnd() - 0.5) * 12);
      return {
        at: 1000 + i, white: 'you', black: 'them', result: '1-0', side: 'white',
        plies: 60, reviewed: true, accuracy: Math.round(100 - loss / 3), meanLoss: loss,
        depth: 7, pgn: '1. e4 e5', mistakes: [], source: 'chess.com',
        myRating: o.noRatings ? null : rating,
        estimate: estimateRating(loss, 7),
      };
    });
    show('progress');
  }, { count: n, o: opts });

  // ── too little to say anything ───────────────────────────────────────────
  await load(4);
  await page.waitForTimeout(400);
  let text = await page.$eval('#progressOut', (e) => e.textContent);
  check('four games is not enough to estimate from', text.includes('needs 8 that have both'), true);
  check('and it says so rather than printing a number', /You were rated about/.test(text), false);

  // ── enough, and the two agree ────────────────────────────────────────────
  await load(60);
  await page.waitForTimeout(500);
  text = await page.$eval('#progressOut', (e) => e.textContent);
  check('sixty games gives an answer', text.includes('You were rated about'), true);
  check('built from your games, not a ladder', text.includes('No ladder and no curve'), true);
  check('and it reports the link is real', text.includes('Worth trusting'), true);

  const near = await page.evaluate(() => ratingNear(30, App.reviews.games));
  say('a 0.30-a-move game looks like', `${near.elo} (${near.lo}–${near.hi}) from ${near.n} of ${near.pool}`);
  // Losing 0.30 a move is near the good end of that history, so the games it
  // finds must be the higher-rated ones, not the middle of the pile.
  check('a good game finds your good games', near.elo > 1050, true);
  const bad = await page.evaluate(() => ratingNear(88, App.reviews.games));
  say('and a 0.88-a-move game looks like', `${bad.elo} (${bad.lo}–${bad.hi})`);
  check('and a bad one finds your bad games', bad.elo < 960, true);
  check('which is the whole point: they differ', near.elo > bad.elo, true);

  // ── a game unlike anything in the history ────────────────────────────────
  const wild = await page.evaluate(() => ratingNear(900, App.reviews.games));
  check('a game nothing like yours is flagged faint', wild.faint, true);
  check('and it still answers, with the nearest it has', Number.isFinite(wild.elo), true);

  // ── when loss and rating have nothing to do with each other ──────────────
  await load(60, { scrambled: true });
  await page.waitForTimeout(500);
  text = await page.$eval('#progressOut', (e) => e.textContent);
  check('a scrambled history is called out', text.includes('no clear link'), true);
  check('and warns the ladder is no better', text.includes("describing the moves, not you"), true);

  // ── how much evidence it takes depends on how many games there are ───────
  //
  // The same correlation means different things at different sample sizes, so
  // this asks the judgement directly rather than trying to manufacture data
  // with a correlation in it: -0.5 sounds strong and is cleared by chance
  // about one time in five on eight games, while -0.105 sounds like something
  // and is cleared about half the time on sixty.
  const verdicts = await page.evaluate(() => ({
    weakOnMany: agreementVerdict(-0.105, 60),
    halfOnFew: agreementVerdict(-0.5, 8),
    halfOnMany: agreementVerdict(-0.5, 60),
    perfectOnFew: agreementVerdict(-1, 8),
    positive: agreementVerdict(0.6, 60),
    nothing: agreementVerdict(-0.9, 2),
  }));
  say('verdicts', JSON.stringify(verdicts));
  check('-0.105 over 60 games is no evidence', verdicts.weakOnMany, 'none');
  check('-0.5 over 8 games is no evidence either', verdicts.halfOnFew, 'none');
  check('but -0.5 over 60 games is worth trusting', verdicts.halfOnMany, 'trust');
  check('and a perfect link over 8 clears its own bar', verdicts.perfectOnFew, 'trust');
  // Losing MORE per move while rated higher is not a link, it is a warning.
  check('a link the wrong way round is not a link', verdicts.positive, 'none');
  check('and two games say nothing at all', verdicts.nothing, 'none');

  // ── the rating chart itself ──────────────────────────────────────────────
  await load(60);
  await page.waitForTimeout(400);
  const labels = await page.$$eval('#progressOut .row .btn', (b) => b.map((x) => x.textContent));
  say('measures offered', labels.join(' | '));
  check('"Your rating" is one of the measures', labels.includes('Your rating'), true);
  await page.evaluate(() => { Progress.measure = 'rating'; renderProgress(); });
  await page.waitForTimeout(400);
  const chart = await page.evaluate(() => ({
    trend: document.querySelectorAll('#progressOut .chart-trend').length,
    axis: [...document.querySelectorAll('#progressOut .chart-yaxis span')].map((e) => e.textContent),
    note: document.querySelector('#progressOut .chart-scale span')?.textContent,
  }));
  say('rating axis', chart.axis.filter(Boolean).join(' / '));
  check('it draws the rating over time', chart.trend, 1);
  check('over the real span of it', chart.axis[0], '1100');
  // THE REVIEW SETTING HAS NOTHING TO DO WITH YOUR RATING. The verdict under
  // the chart warned that "a change of setting shows up here as a change in
  // you", which is true of the three measures the engine produces and is
  // nonsense about a number Chess.com gave you.
  const ratingText = await page.$eval('#progressOut', (e) => e.textContent);
  check('it does not blame the review setting', ratingText.includes('change of setting shows up here'), false);
  check('and says whose numbers these are', ratingText.includes('Chess.com’s numbers rather than this app’s'), true);
  await page.evaluate(() => { Progress.measure = 'accuracy'; renderProgress(); });
  await page.waitForTimeout(300);
  const accText = await page.$eval('#progressOut', (e) => e.textContent);
  check('while accuracy still carries that warning', accText.includes('change of setting shows up here'), true);

  // An unreviewed game still has a rating, and the rating chart must use it —
  // your rating moved on every game, not only the walked ones.
  await page.evaluate(() => {
    for (let i = 0; i < 40; i++) {
      App.reviews.games.push({ at: 5000 + i, white: 'you', black: 'them', result: '1-0',
        side: 'white', plies: 40, reviewed: false, accuracy: null, meanLoss: null,
        mistakes: [], pgn: '1. e4 e5', source: 'chess.com', myRating: 1100 + i });
    }
    renderProgress();
  });
  await page.waitForTimeout(400);
  const withUnwalked = await page.$eval('#progressOut .chart-scale span', (e) => e.textContent);
  say('rating chart counts', withUnwalked);
  check('unwalked games are on the rating chart', withUnwalked.startsWith('100 games'), true);
  // ...and are still kept off the ones that need a review.
  await page.evaluate(() => { Progress.measure = 'accuracy'; renderProgress(); });
  await page.waitForTimeout(300);
  const acc = await page.$eval('#progressOut .chart-scale span', (e) => e.textContent);
  check('but stay off the ones that need one', acc.startsWith('60 games'), true);

  // ── no ratings at all: the state every user starts in ────────────────────
  await load(30, { noRatings: true });
  await page.evaluate(() => { Progress.measure = 'rating'; renderProgress(); });
  await page.waitForTimeout(400);
  const none = await page.$eval('#progressOut', (e) => e.textContent);
  check('with no ratings it says what is missing', none.includes('0 of your 30 games have a rating to plot'), true);

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
