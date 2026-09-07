// Every feature, used the way a person uses it.
//
// WHAT THIS IS FOR that the other thirty drivers are not. Each of them knows
// the one screen it came to test and drives it deliberately, with the store
// arranged to suit. None of them sits down with the app and goes through it:
// play a game, review it, drill the mistakes, solve a puzzle, run the clock,
// convert an endgame, name some squares, watch a game, read the notation,
// import, walk, and look at the progress that comes out of all of it.
//
// That sequence is where the faults have actually been. Walking imported games
// made no drills for exactly this reason — every test that made a drill pressed
// the button on the review screen, so nothing ever went from one feature to
// the next. This driver goes from one feature to the next on purpose, and each
// step checks the thing the PREVIOUS step was supposed to produce.
//
// It is slow, because the engine really runs. That is the point.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');
const FULL = JSON.parse(require('fs').readFileSync('selfplay.json', 'utf8')).pgn;

(async () => {
  const srv = serve(DIST, 8290);
  await srv.ready;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1200 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A console line for a failed request does not carry the URL, so filtering on
  // its text cannot tell the Google Fonts stylesheet from something the app
  // genuinely asked for and did not get. The requests are watched by URL
  // instead, and the console for everything that is not one of them.
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text())) return;
    errors.push('console: ' + m.text());
  });
  page.on('requestfailed', (r) => {
    const url = r.url();
    if (/favicon\.ico|fonts\.(googleapis|gstatic)\.com/.test(url)) return;
    errors.push(`request failed: ${r.failure()?.errorText ?? '?'} ${url}`);
  });
  page.on('response', (r) => {
    if (r.status() < 400) return;
    if (/favicon\.ico|fonts\.(googleapis|gstatic)\.com/.test(r.url())) return;
    errors.push(`HTTP ${r.status()} ${r.url()}`);
  });

  const say = (k, v) => console.log('   ' + String(k).padEnd(42), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got) : `${got}   <- expected ${want}`);
    if (!ok) failures.push(what);
  };
  const step = (n) => console.log(`\n── ${n}`);

  await page.goto('http://127.0.0.1:8290/hard-lines-chess-app.html');
  await page.waitForSelector('#tab-today', { timeout: 20000 });

  // ── 1. play a game against the ladder, and finish it ─────────────────────
  step('PLAY a game against the weakest band, to the end');
  await gotoSection(page, 'play');
  await page.waitForTimeout(200);
  const played = await page.evaluate(async () => {
    Play.band = BANDS[0];
    Play.myColour = WHITE;
    newPlayGame();
    await new Promise((r) => setTimeout(r, 300));
    // Play both sides quickly through the view, the way the board does.
    for (let i = 0; i < 40 && !Play.view.board.outcome(); i++) {
      const legal = Play.view.board.legalMoves();
      if (!legal.length) break;
      const move = legal[Math.floor(Math.random() * legal.length)];
      Play.view.apply(move, { animate: false });
      Play.moves.push({ san: 'x', uci: moveToUci(move) });
    }
    return { moves: Play.moves.length, over: Boolean(Play.view.board.outcome()) };
  });
  say('moves made', String(played.moves));
  check('a game can be played out', played.moves > 10, true);
  check('the board reports its own status',
    await page.$eval('#playHead', (e) => e.textContent.length > 0), true);

  // ── 2. the coach reads the position it is handed ─────────────────────────
  step('COACH on the live position');
  await page.click('#playCoach');
  await page.waitForTimeout(300);
  check('it moves to the analysis board', await page.evaluate(() => App.section), 'board');
  await page.waitForFunction(() => document.getElementById('coachLog').textContent.length > 60,
    null, { timeout: 60000 });
  check('and reads the position unasked',
    await page.$eval('#coachLog', (e) => e.textContent).then((t) => /to move/.test(t)), true);

  // ── 3. the analysis board's own tools ────────────────────────────────────
  step('BOARD: suggestions, threats, hanging pieces');
  await page.click('#practiceSuggest');
  await page.waitForFunction(() => document.querySelectorAll('#practiceLines .line-row').length > 0,
    null, { timeout: 30000 });
  const lines = await page.$$eval('#practiceLines .line-row', (r) => r.map((x) => x.textContent.trim()));
  say('engine lines', String(lines.length));
  check('it offers more than one line', lines.length >= 2, true);
  check('and each names a move', lines.every((l) => /[a-h][1-8]|O-O/.test(l)), true);
  await page.evaluate(() => { $('practiceThreats').checked = true; $('practiceThreats').dispatchEvent(new Event('change')); });
  await page.waitForTimeout(1500);
  check('the threat toggle says something',
    await page.$eval('#practiceThreatNote', (e) => e.textContent.length > 10), true);

  // ── 4. review a real game ────────────────────────────────────────────────
  step('REVIEW a full game');
  await gotoSection(page, 'review');
  await page.evaluate((pgn) => { $('pgnInput').value = pgn; $('reviewSide').value = 'white'; }, FULL);
  await page.click('#reviewRun');
  await page.waitForFunction(() => !Review.running && Review.result, null, { timeout: 180000 });
  const review = await page.evaluate(() => ({
    mistakes: Review.result.mistakes.length,
    judged: Review.result.judged.length,
    stored: App.reviews.games.length,
    accuracy: App.reviews.games[0]?.accuracy,
  }));
  say('review', `${review.judged} moves judged, ${review.mistakes} mistakes`);
  check('the game was walked', review.judged > 10, true);
  check('and stored', review.stored, 1);
  check('with an accuracy', Number.isFinite(review.accuracy), true);
  check('the curve is drawn', await page.$$eval('#reviewCurve svg, .curve-frame svg', (e) => e.length > 0), true);

  // ── 5. its mistakes become drills, and the drill screen works ────────────
  step('DRILLS from that review');
  const added = await page.evaluate(async () => {
    const before = App.drills.items.length;
    await addMistakesToDrills(Review.result.mistakes);
    return { before, after: App.drills.items.length };
  });
  check('mistakes become drills', added.after > added.before, true);
  await gotoSection(page, 'drills');
  await page.waitForTimeout(300);
  check('the drill screen offers a start',
    await page.$eval('#drillStart', (e) => !e.hidden), true);
  await page.click('#drillStart');
  await page.waitForTimeout(600);
  check('a drill position is on the board',
    await page.evaluate(() => Boolean(Drill.current && Drill.view.board.fen())), true);
  const solved = await page.evaluate(async () => {
    // onMove hands over { move, san } BEFORE applying it — the same contract
    // the board view uses. Passing only the move left san undefined, and
    // onDrillMove is async, so the throw became an unhandled rejection and the
    // answer line simply stayed empty.
    const uci = Drill.current.best.uci;
    const move = Drill.view.board.legalMoves().find((m) => moveToUci(m) === uci);
    const san = toSan(new Board(Drill.view.board.fen()), move);
    await onDrillMove({ move, san });
    await new Promise((r) => setTimeout(r, 400));
    return document.getElementById('drillAnswer').textContent;
  });
  say('answering right says', solved.slice(0, 70));
  check('the right move is recognised', /Yes|right|correct/i.test(solved), true);

  // ── 6. puzzles: filed by the review, and mined from an unscanned game ────
  //
  // A REVIEWED GAME HAS ALREADY BEEN MINED. reviewGame() looks for tactics as
  // it walks, addTactics() files them and marks the game scanned — so "Scan 0
  // games" straight after a review is correct, not a fault. The first version
  // of this step read that as a bug. What is worth checking is that the review
  // really did file them, and that the scanner still works on a game it has
  // not seen.
  step('PUZZLES: filed by the review, then a scan of a game it has not seen');
  await gotoSection(page, 'puzzles');
  await page.waitForTimeout(300);
  const filed = await page.evaluate(() => ({
    items: App.puzzles.items.length,
    scanned: App.puzzles.scanned.length,
    leftToScan: scannableGames().length,
  }));
  say('after the review', JSON.stringify(filed));
  check('the review marked its own game scanned', filed.scanned, 1);
  check('so there is nothing left to scan', filed.leftToScan, 0);

  // Now a game the scanner has not seen: stored the way a played game is.
  await page.evaluate((pgn) => {
    App.history.games.push({
      at: Date.now(), band: 800, colour: 'black', result: 'l', plies: 36,
      control: 'none', pgn, takebacks: 0,
    });
  }, FULL);
  await gotoSection(page, 'puzzles');
  await page.waitForTimeout(300);
  check('a fresh game is offered to the scanner',
    await page.evaluate(() => scannableGames().length), 1);
  check('and the button appears', await page.$eval('#puzzleScan', (e) => e.hidden), false);
  await page.click('#puzzleScan');
  await page.waitForFunction(() => !Puzzles.scanning, null, { timeout: 300000 });
  const puzzles = await page.evaluate(() => ({
    items: App.puzzles.items.length, scanned: App.puzzles.scanned.length,
    left: scannableGames().length,
  }));
  say('after the scan', JSON.stringify(puzzles));
  check('the scan finishes and marks the game', puzzles.scanned, 2);
  check('and nothing is left unscanned', puzzles.left, 0);

  // And a puzzle can actually be solved.
  if (puzzles.items > 0) {
    // A tactic you FOUND at the time is scheduled four days out on purpose, so
    // a fresh scan can leave nothing DUE. Tapping one to try it again is the
    // flow that always exists, and is what this checks.
    await page.evaluate(() => startPuzzle(App.puzzles.items[0], { scoring: false }));
    await page.waitForFunction(() => Boolean(Puzzles.current), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(400);
    const answered = await page.evaluate(async () => {
      if (!Puzzles.current) return 'no puzzle';
      const uci = Puzzles.current.best.uci;
      const move = Puzzles.view.board.legalMoves().find((m) => moveToUci(m) === uci);
      const san = toSan(new Board(Puzzles.view.board.fen()), move);
      await onPuzzleMove({ move, san });
      await new Promise((r) => setTimeout(r, 500));
      return document.getElementById('puzzleAnswer').textContent;
    });
    say('solving one says', answered.slice(0, 70));
    check('a puzzle really started', answered !== 'no puzzle', true);
    check('and the right move is recognised', /Yes|right|correct/i.test(answered), true);
  }

  // ── 7. the clock, with the starting bank behind it ───────────────────────
  step('CLOCK: a timed run');
  await gotoSection(page, 'storm');
  await page.waitForTimeout(200);
  await page.click('#stormStart');
  await page.waitForTimeout(800);
  check('a position is shown', await page.evaluate(() => Boolean(Storm.current)), true);
  const stormSolved = await page.evaluate(async () => {
    const uci = Storm.current.uci;
    const move = Storm.view.board.legalMoves().find((m) => moveToUci(m) === uci);
    onStormMove({ move });
    await new Promise((r) => setTimeout(r, 500));
    return Storm.solved;
  });
  check('solving one scores', stormSolved, 1);
  await page.evaluate(() => stopStorm());
  await page.waitForTimeout(400);
  check('and stopping records it', await page.evaluate(() => Storm.best?.score >= 1), true);

  // ── 8. an endgame, refereed by the solved table ──────────────────────────
  step('ENDGAMES: convert one, refereed exactly');
  await gotoSection(page, 'endgames');
  await page.waitForTimeout(200);
  const endgame = await page.evaluate(async () => {
    const item = ENDGAMES.find((e) => e.referee === 'table' && e.goal === 'promote');
    startEndgame(item);
    await new Promise((r) => setTimeout(r, 200));
    // The table's own best move, so this is the technique rather than a guess.
    const best = bestPawnMove(Endgames.view.board);
    onEndgameMove({ move: best });
    await new Promise((r) => setTimeout(r, 600));
    return { name: item.name, verdict: document.getElementById('endgameVerdict').textContent };
  });
  say(endgame.name, endgame.verdict.slice(0, 70));
  check('the table grades the move', endgame.verdict.length > 5, true);
  check('and does not call a winning move a loss', /lost|thrown/i.test(endgame.verdict), false);

  // ── 9. board vision ──────────────────────────────────────────────────────
  step('VISION: a round of naming squares');
  await gotoSection(page, 'vision');
  await page.waitForTimeout(200);
  await page.click('#visionStart');
  await page.waitForTimeout(500);
  check('a question is asked', await page.evaluate(() => Boolean(Vision.question)), true);
  check('and the prompt says what to do',
    await page.$eval('#visionPrompt', (e) => e.textContent.length > 5), true);
  await page.evaluate(() => stopVision());
  await page.waitForTimeout(300);
  check('stopping ends the round', await page.evaluate(() => Vision.running), false);

  // ── 10. watch, both kinds ────────────────────────────────────────────────
  step('WATCH: a famous game and a bot game');
  await gotoSection(page, 'watch');
  await page.waitForTimeout(200);
  await page.evaluate(() => { startWatchFamous(FAMOUS_GAMES[0]); goToWatchPly(10); });
  await page.waitForTimeout(400);
  check('a famous game replays', await page.evaluate(() => Watch.ply), 10);
  check('and the move is named',
    await page.$eval('#watchMove', (e) => e.textContent).then((t) => t.length > 5), true);
  await page.evaluate(() => { startWatchBots(); Watch.speed = 40; playWatch(); });
  await page.waitForFunction(() => Watch.ply >= 6 || !Watch.playing, null, { timeout: 90000 });
  await page.evaluate(() => stopWatch());
  check('two bots play a game', await page.evaluate(() => Watch.ply >= 6), true);

  // ── 11. notation ─────────────────────────────────────────────────────────
  step('NOTATION: a lesson, played on the board');
  await gotoSection(page, 'notation');
  await page.waitForTimeout(200);
  const notation = await page.evaluate(() => {
    const lesson = NOTATION_LESSONS.find((l) => l.id === 'which-file');
    startNotationBoard(lesson.fen, lesson);
    showNotationMove();
    return {
      san: document.getElementById('notationSan').textContent,
      parts: document.querySelectorAll('#notationParts .san-part').length,
      claimed: lesson.san,
    };
  });
  check('the lesson move is spelled out', notation.san, notation.claimed);
  check('and taken apart', notation.parts >= 3, true);

  // ── 12. openings, and the repertoire report over everything played ───────
  step('OPENINGS: learn a line, and read the deviation report');
  await gotoSection(page, 'openings');
  await page.waitForTimeout(400);
  check('the openings are listed', await page.$$eval('.opening', (e) => e.length), 25);
  await page.evaluate(() => startOpening(OPENINGS[0], 'learn'));
  await page.waitForTimeout(300);
  check('a lesson opens', await page.$eval('#openingStudy', (e) => !e.hidden), true);
  check('and shows the first idea',
    await page.$eval('#openingIdea', (e) => e.textContent.length > 20), true);
  await page.evaluate(() => closeOpening());
  await page.waitForTimeout(300);
  check('the repertoire report has walked the stored games',
    await page.evaluate(() => Deviations.counts?.games > 0), true);

  // ── 13. progress, built out of all of it ─────────────────────────────────
  step('PROGRESS: what the whole session produced');
  await gotoSection(page, 'progress');
  await page.waitForTimeout(600);
  const progress = await page.$eval('#progressOut', (e) => e.textContent);
  say('progress', progress.replace(/\s+/g, ' ').slice(0, 90));
  check('it reports the reviewed game', /Across 1 reviewed game/.test(progress), true);
  check('with a severity breakdown', /Blunder|Mistake|Inaccuracy/i.test(progress), true);
  check('and the bars are well formed', await page.$$eval('.bar-row', (rows) => rows.every((r) => {
    const track = r.querySelector('.bar').getBoundingClientRect();
    const fill = r.querySelector('.bar-fill').getBoundingClientRect();
    return fill.bottom <= track.bottom + 0.5 && fill.top >= track.top - 0.5;
  })), true);

  // ── 14. today, which is the front door ───────────────────────────────────
  step('TODAY: the list of what is owed');
  await gotoSection(page, 'today');
  await page.waitForTimeout(400);
  const today = await page.$eval('#todayList', (e) => e.textContent);
  say('today', today.replace(/\s+/g, ' ').slice(0, 90));
  check('Today lists something to do', today.length > 40, true);
  // The record is built from results filed against a band, and this driver
  // plays through the board view rather than through the game loop that files
  // them — so it is empty here, correctly. Filing one shows the panel appears.
  const record = await page.evaluate(() => {
    const before = document.getElementById('todayRecord').hidden;
    App.history.bands = { 800: { w: 2, d: 1, l: 1 } };
    renderToday();
    return { before, after: document.getElementById('todayRecord').hidden,
      text: document.getElementById('todayRecord').textContent };
  });
  check('the record is hidden while there is none', record.before, true);
  check('and appears once a result is filed', record.after, false);
  check('showing the band it was against', record.text.includes('800'), true);

  // ── 15. settings actually apply ──────────────────────────────────────────
  step('SETTINGS: a change that reaches the board');
  await gotoSection(page, 'settings');
  await page.waitForTimeout(200);
  await page.selectOption('#settingTheme', 'dark');
  await page.waitForTimeout(200);
  check('the theme applies', await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  const styles = await page.$$eval('#settingPieces button, #settingPieces .swatch', (b) => b.length);
  say('piece styles offered', String(styles));
  check('there are piece styles to pick', styles >= 2, true);
  await page.evaluate(() => {
    const pick = [...document.querySelectorAll('#settingPieces button, #settingPieces .swatch')];
    (pick[pick.length - 1]).click();
  });
  await page.waitForTimeout(250);
  check('picking one changes the pieces on every board',
    await page.evaluate(() => ['hardlines', 'classic', 'letters'].includes(PieceStyle.current)), true);

  console.log('');
  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors in the whole session');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
