// The deviation report, driven with games in the store.
//
// deviation.test.mjs proves the finder against the repertoire in node. This
// proves the SCREEN: that stored games reach it, that a game deliberately made
// to leave the book on a known move is reported on that move, that repeating
// it four times makes one row saying four, and that the cost beside it is a
// number the engine produced rather than a label.
//
// It also checks the thing a report like this is most likely to get wrong,
// which is blaming you for a game you did not play: a game that follows a line
// to the end must produce no row at all.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');

(async () => {
  const srv = serve(DIST, 8281);
  await srv.ready;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1200 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const say = (k, v) => console.log(String(k).padEnd(42), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got) : `${got}   <- expected ${want}`);
    if (!ok) failures.push(what);
  };

  await page.goto('http://127.0.0.1:8281/hard-lines-chess-app.html');
  await page.waitForSelector('#tab-today', { timeout: 20000 });

  // ── nothing stored: the panel is not there at all ────────────────────────
  await gotoSection(page, 'openings');
  await page.waitForTimeout(200);
  check('with no games, the panel is hidden', await page.$eval('#deviationPanel', (e) => e.hidden), true);

  // ── a game that follows a line to its end produces no row ────────────────
  const followed = await page.evaluate(() => {
    const opening = OPENINGS.find((o) => o.side === 'white');
    const pgn = opening.line.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + s).join(' ');
    App.history.games = [{ at: 1000, band: 800, colour: 'white', result: 'w', plies: opening.line.length, control: 'none', pgn }];
    App.reviews.games = [];
    Deviations.built = false; Deviations.parsed.clear(); Deviations.costs = {};
    renderDeviations();
    return { name: opening.name, rows: Deviations.rows.length, counts: Deviations.counts };
  });
  say('a game played straight from the book', followed.name);
  check('following the line makes no row', followed.rows, 0);
  check('and it is counted as followed', followed.counts.followed, 1);
  check('and the panel says so',
    await page.$eval('#deviationList', (e) => e.textContent).then((t) => t.includes('did not leave your own preparation')), true);

  // ── four games leaving on the same move make one row saying four ─────────
  const left = await page.evaluate(() => {
    const opening = OPENINGS.find((o) => o.side === 'white');
    // A White ply, and a replacement no line in the repertoire plays there, so
    // the game genuinely leaves rather than transposing into something else.
    const at = 4;
    const board = new Board();
    for (let i = 0; i < at; i++) board.make(sanToMove(board, opening.line[i]));
    const bookHere = new Set();
    for (const entry of repertoireLines(OPENINGS)) {
      let n = 0;
      const prefix = opening.line.slice(0, at);
      while (n < prefix.length && n < entry.line.length && prefix[n] === entry.line[n]) n++;
      if (n === prefix.length && n < entry.line.length) bookHere.add(entry.line[n]);
    }
    const other = board.legalMoves()
      .map((m) => toSan(new Board(board.fen()), m))
      .find((san) => !bookHere.has(san));
    const sans = [...opening.line.slice(0, at), other, ...opening.line.slice(at + 1)];
    const pgn = sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + s).join(' ');

    App.history.games = [1, 2, 3, 4].map((n) => ({
      at: n * 1000, band: 800, colour: 'white', result: 'l', plies: sans.length, control: 'none', pgn,
    }));
    Deviations.built = false; Deviations.parsed.clear(); Deviations.costs = {};
    renderDeviations();
    return { played: other, book: opening.line[at], rows: Deviations.rows.length, row: Deviations.rows[0] };
  });
  say('the swapped move', `${left.book} -> ${left.played}`);
  check('four identical games make one row', left.rows, 1);
  check('and it counts four', left.row?.times, 4);
  check('and it quotes the move played', left.row?.played, left.played);
  check('and the move the book plays', left.row?.book, left.book);
  check('and it names move 3 (ply 5)', left.row?.moveNumber, 3);

  const shown = await page.$eval('#deviationList', (e) => e.textContent);
  say('on screen', shown.replace(/\s+/g, ' ').slice(0, 150));
  check('the screen quotes both moves',
    shown.includes(`you played ${left.played}`) && shown.includes(`the book plays ${left.book}`), true);
  check('and says how many times', shown.includes('4 times'), true);

  // ── the cost is a measurement that arrives ───────────────────────────────
  await page.waitForFunction(() => Object.keys(Deviations.costs).length > 0, null, { timeout: 30000 });
  const cost = await page.evaluate(() => Deviations.costs[Deviations.rows[0].key]);
  say('measured', cost ? `yours ${cost.yours}cp, book ${cost.book}cp, difference ${cost.loss}cp` : 'null');
  check('a cost was measured', cost !== null && Number.isFinite(cost.loss), true);
  check('and it is the difference of the two', cost && cost.loss === cost.book - cost.yours, true);
  await page.waitForTimeout(300);
  check('and the row stops saying it is measuring',
    await page.$eval('#deviationList', (e) => e.textContent).then((t) => !t.includes('Measuring what it cost')), true);

  // ── the opponent leaving is not filed against you ────────────────────────
  const theirs = await page.evaluate(() => {
    const opening = OPENINGS.find((o) => o.side === 'white');
    const at = 3;   // a Black ply
    const board = new Board();
    for (let i = 0; i < at; i++) board.make(sanToMove(board, opening.line[i]));
    const bookHere = new Set();
    for (const entry of repertoireLines(OPENINGS)) {
      let n = 0;
      const prefix = opening.line.slice(0, at);
      while (n < prefix.length && n < entry.line.length && prefix[n] === entry.line[n]) n++;
      if (n === prefix.length && n < entry.line.length) bookHere.add(entry.line[n]);
    }
    const other = board.legalMoves().map((m) => toSan(new Board(board.fen()), m)).find((san) => !bookHere.has(san));
    const sans = [...opening.line.slice(0, at), other];
    const pgn = sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + s).join(' ');
    App.history.games = [{ at: 5000, band: 800, colour: 'white', result: 'd', plies: sans.length, control: 'none', pgn }];
    Deviations.built = false; Deviations.parsed.clear(); Deviations.costs = {};
    renderDeviations();
    return { rows: Deviations.rows.length, counts: Deviations.counts };
  });
  check('their move out of the book makes no row for you', theirs.rows, 0);
  check('and is counted as a gap in the repertoire', theirs.counts.theyLeft, 1);
  check('and the summary says whose it was',
    await page.$eval('#deviationSummary', (e) => e.textContent).then((t) => t.includes('gap in the repertoire rather than in you')), true);

  // ── a game from a set-up position is left out entirely ───────────────────
  const setup = await page.evaluate(() => {
    App.history.games = [{ at: 6000, band: 800, colour: 'white', result: 'w', plies: 4, control: 'none',
      from: '8/8/8/4k3/8/8/4P3/4K3 w - - 0 1', pgn: '1. Kd2 Kd4 2. Ke2' }];
    Deviations.built = false; Deviations.parsed.clear(); Deviations.costs = {};
    renderDeviations();
    return Deviations.counts;
  });
  check('a set-up game is not walked at all', setup.games, 0);
  check('and the panel goes away with it', await page.$eval('#deviationPanel', (e) => e.hidden), true);

  // ── A NEW GAME REACHES THE REPORT ────────────────────────────────────────
  //
  // The report is cached, so the failure mode is the panel showing what it
  // showed last time — which means the game you just played, the one you came
  // to look at, is the one it does not know about. forgetDeviations() is called
  // wherever a game is stored; this checks the cache really does clear.
  const refreshed = await page.evaluate(() => {
    const opening = OPENINGS.find((o) => o.side === 'white');
    const board = new Board();
    for (let i = 0; i < 4; i++) board.make(sanToMove(board, opening.line[i]));
    const other = board.legalMoves().map((m) => toSan(new Board(board.fen()), m))
      .find((san) => san !== opening.line[4] && san !== 'Nc3');
    const sans = [...opening.line.slice(0, 4), other, ...opening.line.slice(5)];
    const pgn = sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + s).join(' ');

    App.history.games = [{ at: 7000, band: 800, colour: 'white', result: 'l', plies: sans.length, control: 'none', pgn }];
    Deviations.built = false; Deviations.parsed.clear(); Deviations.costs = {};
    renderDeviations();
    const before = Deviations.rows[0]?.times ?? 0;

    // A second game exactly like it, stored the way the app stores one.
    App.history.games.push({ at: 8000, band: 800, colour: 'white', result: 'l', plies: sans.length, control: 'none', pgn });
    forgetDeviations();
    renderDeviations();
    return { before, after: Deviations.rows[0]?.times ?? 0 };
  });
  check('the report counted one game', refreshed.before, 1);
  check('and a newly stored game reaches it', refreshed.after, 2);

  // ── the Today row, and the button that opens the line ────────────────────
  await page.evaluate(() => {
    const opening = OPENINGS.find((o) => o.side === 'white');
    const at = 4;
    const board = new Board();
    for (let i = 0; i < at; i++) board.make(sanToMove(board, opening.line[i]));
    const other = board.legalMoves().map((m) => toSan(new Board(board.fen()), m))
      .find((san) => san !== opening.line[at] && san !== 'Nc3');
    const sans = [...opening.line.slice(0, at), other, ...opening.line.slice(at + 1)];
    const pgn = sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + s).join(' ');
    App.history.games = [1, 2].map((n) => ({ at: n * 100, band: 800, colour: 'white', result: 'l', plies: sans.length, control: 'none', pgn }));
    Deviations.built = false; Deviations.parsed.clear(); Deviations.costs = {};
    show('today');
  });
  await page.waitForTimeout(300);
  const today = await page.$eval('#todayList', (e) => e.textContent);
  say('today', today.replace(/\s+/g, ' ').slice(0, 130));
  check('Today carries the row when it repeats', today.includes('You keep leaving the'), true);

  await gotoSection(page, 'openings');
  await page.waitForTimeout(300);
  await page.click('#deviationList button');
  await page.waitForTimeout(400);
  check('"Learn this line" opens the lesson', await page.$eval('#openingStudy', (e) => !e.hidden), true);
  check('and it starts near the move that went wrong',
    await page.evaluate(() => Openings.ply >= 2), true);

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
