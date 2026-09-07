// Two faults a person found by using the app, and neither was catchable by
// reading the code.
//
// 1. A BAR THAT DREW ITSELF WRONG. The severity fills carried the severity as
//    a bare class — "bar-fill mistake" — and `.mistake` is the review list's
//    row style: a grid with nine pixels of padding and a bottom border. The
//    mistake bar inherited all of it and drew twenty pixels tall inside an
//    eleven pixel track. Blunder and inaccuracy have no such rule and looked
//    fine, so one bar in three was malformed, which reads as data rather than
//    as a bug. The check is geometric: every fill has to be exactly as tall as
//    the track it sits in, whatever it is called.
//
// 2. DRILLS THAT WERE NEVER CREATED. addMistakesToDrills() had exactly one
//    caller — a button on the single-game review screen — so importing and
//    walking thirty-six games produced two hundred and thirty-one mistakes and
//    not one drill. Nothing tested the path from a walked game to a drill,
//    because every test that made a drill pressed the button.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');
const FULL = JSON.parse(require('fs').readFileSync('selfplay.json', 'utf8')).pgn;

(async () => {
  const srv = serve(DIST, 8287);
  await srv.ready;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
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

  await page.goto('http://127.0.0.1:8287/hard-lines-chess-app.html');
  await page.waitForSelector('#tab-today', { timeout: 20000 });

  // ── 1. every bar fill fits its track ─────────────────────────────────────
  await page.evaluate(() => {
    const mk = (sev, n) => Array.from({ length: n }, (_, i) => ({
      ply: i + 1, san: 'Qh5', kind: 'material', loss: 300, severity: sev, themes: [],
      fen: `8/8/8/8/8/8/${i}p6/K6k w - - 0 1`,
    }));
    App.reviews.games = [{
      at: 1, white: 'a', black: 'b', result: '1-0', side: 'white', plies: 60, reviewed: true,
      accuracy: 70, meanLoss: 90, depth: 7, pgn: '1. e4 e5',
      mistakes: [...mk('blunder', 61), ...mk('mistake', 56), ...mk('inaccuracy', 114)],
    }];
    show('progress');
  });
  await page.waitForTimeout(400);

  const bars = await page.$$eval('.bar-row', (rows) => rows.map((r) => {
    const track = r.querySelector('.bar').getBoundingClientRect();
    const fill = r.querySelector('.bar-fill').getBoundingClientRect();
    const border = parseFloat(getComputedStyle(r.querySelector('.bar')).borderTopWidth) || 0;
    return {
      label: r.querySelector('.bar-label').textContent,
      inner: +(track.height - border * 2).toFixed(1),
      fillH: +fill.height.toFixed(1),
      overflows: fill.bottom > track.bottom + 0.5 || fill.top < track.top - 0.5,
      wider: fill.width > track.width + 0.5,
    };
  }));
  for (const b of bars) say(`  ${b.label}`, `track inner ${b.inner}px, fill ${b.fillH}px`);
  check('there are bars to check', bars.length >= 3, true);
  check('every fill is exactly as tall as its track', bars.every((b) => Math.abs(b.fillH - b.inner) < 0.5), true);
  check('and none of them spills out of it', bars.some((b) => b.overflows || b.wider), false);

  // ── 2. walking a game turns its mistakes into drills ─────────────────────
  const before = await page.evaluate((FULL_PGN) => {
    App.drills.items = [];
    App.reviews.games = [{
      // WHITE, not black: selfplay.json is a weak band against the strongest
      // one, and the strong side barely errs. Reviewing from the side that
      // played well produces a game with nothing to drill, which is a true
      // result about that game and a useless one for this test.
      at: 5000, white: 'Someone', black: 'You', result: '0-1', side: 'white',
      pgn: FULL_PGN, reviewed: false, accuracy: null, mistakes: [], source: 'chess.com', url: 'x1',
    }];
    return App.drills.items.length;
  }, FULL);
  check('no drills to start with', before, 0);

  await gotoSection(page, 'review');
  await page.waitForTimeout(200);
  check('the game is queued for walking', await page.evaluate(() => unwalkedGames().length), 1);
  await page.click('#walkRun');
  await page.waitForFunction(() => !Walk.running && Walk.done > 0, null, { timeout: 180000 });

  const after = await page.evaluate(() => ({
    walked: Walk.done,
    made: Walk.drills,
    drills: App.drills.items.length,
    mistakes: App.reviews.games[0].mistakes.length,
    inaccuracies: App.reviews.games[0].mistakes.filter((m) => m.severity === 'inaccuracy').length,
    worst: App.reviews.games[0].mistakes.filter((m) => m.severity !== 'inaccuracy').length,
    note: document.getElementById('walkNote').textContent,
    haveCards: App.drills.items.every((d) => d.card && Number.isFinite(d.card.ease)),
    haveBest: App.drills.items.every((d) => d.best && d.fen),
  }));
  say('the walk', `${after.walked} game, ${after.mistakes} mistakes (${after.worst} worth drilling), ${after.drills} drills`);
  say('it said', after.note.slice(0, 90));
  check('the game was walked', after.walked, 1);
  check('and its mistakes became drills', after.drills > 0, true);
  check('as many as there were worth drilling', after.drills, after.worst);
  check('inaccuracies were left out of the bulk add', after.drills, after.mistakes - after.inaccuracies);
  check('every drill has a position and a best move', after.haveBest, true);
  check('and a fresh scheduling card', after.haveCards, true);
  check('and the summary says how many', after.note.includes('added to your drills'), true);

  // ── they are on the Drills screen, and due ───────────────────────────────
  await gotoSection(page, 'drills');
  await page.waitForTimeout(300);
  const drills = await page.$eval('#section-drills', (e) => e.textContent);
  say('drills screen', drills.replace(/\s+/g, ' ').slice(0, 90));
  check('the Drills screen is no longer empty',
    await page.$eval('#drillEmpty', (e) => e.hidden), true);
  check('and it counts them', /\d+ due of \d+ stored|\d+ due/.test(drills), true);

  // ── CATCHING UP GAMES ALREADY REVIEWED ───────────────────────────────────
  //
  // The situation a real user is in after the bug: thirty-six games walked,
  // two hundred and thirty-one mistakes recorded, no drills — and nothing
  // would ever walk them again, because they are already marked reviewed. So
  // the fix has to reach backwards, from the mistakes already stored.
  const caught = await page.evaluate(async () => {
    const mistake = (i) => ({
      ply: i, san: 'Qh5', kind: 'material', loss: 400, severity: i % 3 === 0 ? 'inaccuracy' : 'blunder',
      themes: [], fen: `8/8/8/8/8/8/${i}P6/K6k w - - 0 1`, uci: 'a1a2',
      best: { san: 'Nf3', uci: 'g1f3' },
    });
    App.drills.items = [];
    App.reviews.games = [{
      at: 6000, white: 'x', black: 'y', result: '1-0', side: 'white', plies: 60,
      reviewed: true, accuracy: 70, meanLoss: 90, depth: 7, pgn: '1. e4 e5',
      mistakes: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(mistake),
    }];
    show('drills');
    const owedBefore = drillsOwed().length;
    const buttonShown = !document.getElementById('drillCatchUp').hidden;
    const label = document.getElementById('drillCatchUp').textContent;
    await catchUpDrills();
    return {
      owedBefore, buttonShown, label,
      drills: App.drills.items.length,
      owedAfter: drillsOwed().length,
      hiddenAfter: document.getElementById('drillCatchUp').hidden,
      note: document.getElementById('drillCatchUpNote').textContent,
      noInaccuracies: App.drills.items.every((d) => d.severity !== 'inaccuracy'),
    };
  });
  say('catch-up', `${caught.owedBefore} owed -> ${caught.drills} drills; "${caught.note}"`);
  check('a reviewed game with no drills is noticed', caught.owedBefore, 6);
  check('and the button offers them', caught.buttonShown, true);
  check('saying how many', caught.label, 'Add 6 from reviewed games');
  check('pressing it makes the drills', caught.drills, 6);
  check('inaccuracies stay out', caught.noInaccuracies, true);
  check('nothing is owed afterwards', caught.owedAfter, 0);
  check('and the button goes away', caught.hiddenAfter, true);
  check('with a sentence, not a bare number', caught.note.includes('already reviewed'), true);

  // Reset for the duplication check below.
  await page.evaluate((FULL_PGN2) => {
    App.drills.items = [];
    App.reviews.games = [{
      at: 5000, white: 'Someone', black: 'You', result: '0-1', side: 'white',
      pgn: FULL_PGN2, reviewed: false, accuracy: null, mistakes: [], source: 'chess.com', url: 'x1',
    }];
  }, FULL);
  await gotoSection(page, 'review');
  await page.click('#walkRun');
  await page.waitForFunction(() => !Walk.running && Walk.done > 0, null, { timeout: 180000 });

  // ── walking again does not duplicate them ────────────────────────────────
  const twice = await page.evaluate(async () => {
    const was = App.drills.items.length;
    App.reviews.games[0].reviewed = false;
    await walkImported();
    return { was, now: App.drills.items.length };
  });
  check('walking the same game again adds no duplicates', twice.now, twice.was);

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
