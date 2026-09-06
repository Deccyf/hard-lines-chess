// The Watch screen, driven.
//
// Three things have to be true and none of them is checkable by reading the
// code:
//
//   1. A REPLAY IS THE GAME IT SAYS IT IS, on the page rather than only in the
//      node test. famous.test.mjs replays the moves through the engine's own
//      generator; this drives the actual screen to the last ply and reads the
//      ending back off it, so a wiring mistake between the two cannot hide.
//
//   2. THE COMMENTARY IS MEASURED. The line under the board is a comparison
//      between the move played and a deeper search, so it must name a move and
//      arrive without being asked twice.
//
//   3. TWO BOT GAMES ARE NOT THE SAME GAME. This is the only claim on the
//      screen that a reader could reasonably doubt, and it is the reason the
//      pairing, the colours, the opening and the search window are all drawn.
//      So it is checked by playing several and comparing them.
const { launch, serve, DIST } = require('./browser.cjs');

(async () => {
  const srv = serve(DIST, 8274);
  await srv.ready;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1200 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const say = (k, v) => console.log(String(k).padEnd(38), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got) : `${got}   <- expected ${want}`);
    if (!ok) failures.push(what);
  };

  await page.goto('http://127.0.0.1:8274/hard-lines-chess-app.html');
  await page.waitForSelector('#tab-today', { timeout: 20000 });

  check('the Watch tab is there',
    await page.$$eval('#tabs .tab', (e) => e.map((x) => x.textContent).includes('Watch')), true);

  await page.click('#tab-watch');
  await page.waitForTimeout(200);
  check('the section shows', await page.$eval('#section-watch', (e) => !e.hidden), true);
  check('the famous games are listed',
    await page.$$eval('#watchGames .endgame-row', (rows) => rows.length),
    await page.evaluate(() => FAMOUS_GAMES.length));

  // ── 1. a famous game, replayed on the page, all the way to its ending ─────
  const opera = await page.evaluate(() => {
    const game = FAMOUS_GAMES.find((g) => g.id === 'opera');
    startWatchFamous(game);
    return { plies: Watch.sans.length, ending: game.ending, result: game.result };
  });
  say('the Opera Game is', `${opera.plies} plies, ${opera.ending}`);
  check('every ply loaded', opera.plies > 20, true);

  // Stepped, not jumped: goToWatchPly replays from the start each time, so
  // walking it move by move is the check that every one of them is legal on
  // the board the screen is showing.
  const walked = await page.evaluate(async () => {
    for (let i = 1; i <= Watch.sans.length; i++) {
      goToWatchPly(i);
      if (Watch.board.fen() === null) return { failedAt: i };
    }
    return { ply: Watch.ply, fen: Watch.board.fen(), outcome: Watch.board.outcome() };
  });
  check('it walks to the last move', walked.ply, opera.plies);
  check('and the last position is checkmate', walked.outcome, 'checkmate');
  check('and the screen says so',
    await page.$eval('#watchOutcome', (e) => e.textContent).then((t) => t.startsWith('Checkmate')), true);
  check('and names the winner',
    await page.$eval('#watchOutcome', (e) => e.textContent).then((t) => t.includes('Paul Morphy')), true);

  // ── a resignation is not dressed up as a mate ─────────────────────────────
  await page.evaluate(() => {
    startWatchFamous(FAMOUS_GAMES.find((g) => g.id === 'deep-blue'));
    goToWatchPly(Watch.sans.length);
  });
  await page.waitForTimeout(100);
  const resigned = await page.$eval('#watchOutcome', (e) => e.textContent);
  say('the ending line', resigned);
  check('a resignation says who resigned', resigned.includes('resigned here'), true);
  check('and does not claim the board proves it', resigned.includes('nothing on it proves'), true);
  check('and the position really is not mate',
    await page.evaluate(() => Watch.board.outcome()), null);

  // ── 2. the commentary is a measurement ────────────────────────────────────
  await page.evaluate(() => { startWatchFamous(FAMOUS_GAMES.find((g) => g.id === 'opera')); goToWatchPly(19); });
  await page.waitForFunction(() => Watch.notes[19]?.judged, null, { timeout: 20000 });
  const judged = await page.evaluate(() => Watch.notes[19].judged);
  say('the reference search at ply 19', `${judged.best}, ${judged.loss}cp, "${judged.evalAfter}"`);
  check('it names the move it preferred', typeof judged.best === 'string' && judged.best.length > 1, true);
  check('and the loss is a number', Number.isFinite(judged.loss), true);
  check('and the note on screen says something',
    await page.$eval('#watchNote', (e) => e.textContent).then((t) => t.length > 20 && !t.includes('Looking at it')), true);
  check('the curated note is shown too',
    await page.$eval('#watchWhy', (e) => e.textContent).then((t) => t.length > 30), true);

  // The quoted note has to be about the move on the board.
  const quoted = await page.evaluate(() => {
    const game = FAMOUS_GAMES.find((g) => g.id === 'opera');
    return game.moments.map((m) => ({ ply: m.ply, san: m.san, actual: Watch.sans[m.ply - 1] }));
  });
  const drifted = quoted.filter((q) => q.actual.replace(/[+#!?]+$/, '') !== q.san.replace(/[+#!?]+$/, ''));
  check('no note has drifted off its move', drifted.length, 0);
  if (drifted.length) say('drifted', JSON.stringify(drifted));

  // ── 3. two bot games are not the same game ───────────────────────────────
  //
  // Played the way the screen plays them — on the timer, one search at a time
  // — rather than in a loop, because the commentary defers itself to the next
  // frame and a loop that never yields never lets it run.
  const games = [];
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { startWatchBots(); Watch.speed = 30; playWatch(); });
    await page.waitForFunction(() => Watch.ply >= 16 || !Watch.playing, null, { timeout: 90000 });
    const g = await page.evaluate(() => {
      stopWatch();
      return {
        moves: Watch.sans.slice(0, 16).join(' '),
        white: Watch.bands.white.elo,
        black: Watch.bands.black.elo,
        book: Watch.bookName,
        plies: Watch.ply,
        bookNote: Watch.notes[4]?.opening ?? null,
        bookLine: Watch.notes[4]?.lines?.[0] ?? null,
      };
    });
    say(`bot game ${i + 1}`, `${g.white} v ${g.black}, ${g.book}, ${g.plies} plies`);
    games.push(g);
  }

  // ── the book explains the opening while there is a book to explain it ─────
  //
  // A bot game is forced into a drawn opening for its first eight plies, so at
  // ply four there is always a line to name and a written reason to print. (A
  // famous game may leave the app's repertoire on move two, and then the
  // honest thing on screen is nothing rather than a guess.)
  say('at ply 4 the book says', (games[0].bookLine ?? '(nothing)').slice(0, 70));
  check('the opening is named while it lasts', typeof games[0].bookNote === 'string', true);
  check('and its own note is what explains the move', (games[0].bookLine ?? '').length > 40, true);
  check('each bot game reaches sixteen plies', games.every((g) => g.plies === 16), true);
  check('and no two of them are the same moves', new Set(games.map((g) => g.moves)).size, 3);
  check('and the two bands are never equal', games.every((g) => g.white !== g.black), true);
  check('and neither side is slower than a second',
    await page.evaluate(() => Math.max(Watch.bands.white.movetime, Watch.bands.black.movetime) <= 1000), true);

  // ── stepping back and forward lands on the same position ─────────────────
  const around = await page.evaluate(() => {
    const at10 = (goToWatchPly(10), Watch.board.fen());
    stepWatch(true); stepWatch(false);
    return { at10, back: Watch.board.fen(), ply: Watch.ply };
  });
  check('back after forward is where it was', around.back, around.at10);
  check('and the ply count agrees', around.ply, 10);

  // ── leaving the screen stops the game ────────────────────────────────────
  await page.evaluate(() => { Watch.speed = 400; playWatch(); });
  check('it is playing', await page.evaluate(() => Watch.playing), true);
  await page.click('#tab-today');
  await page.waitForTimeout(150);
  check('leaving the screen stops it', await page.evaluate(() => Watch.playing), false);

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
