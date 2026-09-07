// A game reviewed once, opened again from storage.
//
// WHAT IS ACTUALLY BEING TESTED is that a review survives being put away. The
// curve, the move list and the board used to live only in the variable the
// review left behind, so leaving the screen threw away minutes of searching
// and the history became rows you could read and not open.
//
// A game now stores two small things — the evaluation after every move, and
// one character per move saying what the reviewer called it — and everything
// else is replayed from the moves it already had. So this reviews a game,
// reads what is on screen, RELOADS THE PAGE so nothing can survive in memory,
// and opens the same game from the history: the curve has to come back, the
// move list has to match move for move, and the classes have to be the same
// ones the engine chose, not ones re-derived and rounded differently.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');

// The Opera Game, taken from the app's own list rather than typed here: every
// ply of it is replayed through the move generator by tests/famous.test.mjs,
// so a game that does not survive parsing fails there first and this test is
// never left quietly reviewing half a game.
const PLIES = 33;

(async () => {
  const srv = serve(DIST, 8296);
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

  const URL = 'http://127.0.0.1:8296/hard-lines-chess-app.html';
  await page.goto(URL);
  await page.waitForSelector('#tab-today', { timeout: 20000 });

  // ── review it once, at the quickest setting ──────────────────────────────
  await gotoSection(page, 'review');
  const parsedPlies = await page.evaluate(() => {
    const game = FAMOUS_GAMES.find((g) => g.id === 'opera');
    const pgn = `[Event "Opera"]\n[White "Morphy"]\n[Black "Duke"]\n[Result "1-0"]\n\n${game.moves}`;
    document.getElementById('pgnInput').value = pgn;
    document.getElementById('reviewDepth').value = '7';
    document.getElementById('reviewSide').value = 'white';
    return parsePgn(pgn).plies.length;
  });
  check('the game parses whole', parsedPlies, PLIES);
  await page.click('#reviewRun');
  await page.waitForFunction(() => !document.getElementById('reviewOut').hidden, null, { timeout: 180000 });
  await page.waitForTimeout(400);

  const fresh = await page.evaluate(() => ({
    moves: [...document.querySelectorAll('#reviewMoves .mv')].map((b) => `${b.textContent}:${b.dataset.class}`),
    curve: document.querySelectorAll('#reviewOut .curve-line').length,
    accuracy: document.querySelector('#reviewOut .readout .v')?.textContent ?? null,
  }));
  say('fresh review: moves listed', fresh.moves.length);
  check('fresh review draws the curve', fresh.curve, 1);
  check('and lists every ply', fresh.moves.length, PLIES);

  // ── what got stored ──────────────────────────────────────────────────────
  const stored = await page.evaluate(() => {
    const g = App.reviews.games[App.reviews.games.length - 1];
    return { curve: g.curve?.length ?? 0, marks: g.marks ?? '', bytes: JSON.stringify({ curve: g.curve, marks: g.marks }).length };
  });
  say('stored curve points / marks', `${stored.curve} / ${stored.marks}`);
  say('bytes added per game', stored.bytes);
  check('the curve is one longer than the moves', stored.curve, PLIES + 1);
  check('a mark for every move', stored.marks.length, PLIES);
  // The whole point of the format: it has to be small enough that two hundred
  // games fit in the five megabytes local storage gives you.
  check('and it stays under a kilobyte a game', stored.bytes < 1024, true);
  check('and the accuracy is a number, not a dash', /^\d+%$/.test(fresh.accuracy), true);

  // ── RELOAD, so nothing can survive in memory ─────────────────────────────
  await page.reload();
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  await page.waitForFunction(() => (App?.reviews?.games ?? []).length > 0, null, { timeout: 20000 });
  await gotoSection(page, 'progress');
  await page.waitForTimeout(400);

  const rows = await page.$$('#progressOut .record-open');
  check('the history row is something you can open', rows.length > 0, true);
  await rows[0].click();
  await page.waitForTimeout(600);

  const again = await page.evaluate(() => ({
    section: App.section,
    moves: [...document.querySelectorAll('#reviewMoves .mv')].map((b) => `${b.textContent}:${b.dataset.class}`),
    curve: document.querySelectorAll('#reviewOut .curve-line').length,
    accuracy: document.querySelector('#reviewOut .readout .v')?.textContent ?? null,
  }));
  check('it opens the review screen', again.section, 'review');
  check('the curve comes back', again.curve, 1);
  check('and every move with it', again.moves.length, fresh.moves.length);
  // Move for move, class for class. A class re-derived from the curve alone
  // would disagree on the engine's own moves and on the mate ones.
  const same = again.moves.every((m, i) => m === fresh.moves[i]);
  check('each one judged exactly as before', same, true);
  if (!same) {
    for (let i = 0; i < again.moves.length; i++) {
      if (again.moves[i] !== fresh.moves[i]) say(`  ply ${i + 1}`, `${fresh.moves[i]} -> ${again.moves[i]}`);
    }
  }
  check('and the accuracy is the one it measured', again.accuracy, fresh.accuracy);
  // The Opera Game ends in mate, and a reopened game has to know that: without
  // it the last move was described as "the engine's own move", which is true
  // and is not what anybody wants told about a checkmate.
  const mate = await page.evaluate(() => {
    const last = Review.result.judged[Review.result.judged.length - 1];
    return { san: last.san, mates: last.mates, said: describeJudged(last) };
  });
  say('the last move reads', `${mate.san} — ${mate.said}`);
  check('the mating move is known to be mate', mate.mates, true);
  check('and is described as one', /checkmate/.test(mate.said), true);

  // ── the engine's move is filled in when you ask for it ───────────────────
  const before = await page.evaluate(() => Review.result.judged.filter((j) => j.best).length);
  check('a reopened game stores no engine moves', before, 0);
  await page.click('#reviewMoves .mv:nth-of-type(6)');
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => ({
    filled: Review.result.judged.filter((j) => j.best).length,
    note: document.getElementById('reviewBoardNote').textContent,
    shown: !document.getElementById('reviewBoardWrap').hidden,
  }));
  check('tapping one works it out', after.filled, 1);
  check('the board comes up', after.shown, true);
  say('and it says', after.note);
  check('without falling back to "something else"', /something else/.test(after.note), false);

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
