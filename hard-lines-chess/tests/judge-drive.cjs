// Choosing who judges a game — this app's engine, Stockfish or Reckless — driven.
//
// What has to be true:
//
//   1. THE CHOICE IS ONE PREFERENCE, in two places. Picked on Review, it is
//      what the walk uses; it survives a reload; the line under it says what
//      the judge is.
//
//   2. THE REVIEW IS THAT JUDGE'S. Stockfish's verdicts, named as Stockfish's,
//      stored with the game — and a different judge's review of the same game
//      is a different curve, or the choice changed nothing. It takes the place
//      of the earlier review rather than being counted beside it.
//
//   3. THE SAME QUESTION GETS THE SAME ANSWER from the new judges too: the
//      same game reviewed twice by Stockfish stores the same curve and marks.
//
//   4. A REOPENED GAME ASKS ITS OWN JUDGE for the move it wanted, not this
//      app's engine.
//
//   5. THE WALK RE-JUDGES. Games judged by one judge are offered, and said to
//      be offered, when another is picked; walking them puts every game on the
//      picked judge, with its curve kept so it can be reopened.
//
//   6. PROGRESS SAYS WHEN ITS GAMES HAD DIFFERENT JUDGES, rather than
//      averaging two scales as one.
//
//   7. RECKLESS JUDGES TOO, downloading itself first where it is not already
//      here — and in the APK it says it cannot, and asks the network for none
//      of it.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');
const path = require('path');

const PORT = 8305;
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 HardLinesAndroid/1.1.0';
// The Opera Game: short, decisive, with a mate at the end.
const OPERA = '[White "Morphy"] [Black "Allies"]\n1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 '
  + '8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 '
  + '16. Qb8+ Nxb8 17. Rd8#';
// A second game, so that two judges can each have one of them.
const TRAP = '[White "Morphy"] [Black "Someone"]\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3#';
const IMPORTED = [
  '1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 h6 7. Bh4 b6 8. cxd5 Nxd5 9. Bxe7 Qxe7 10. Nxd5 exd5 11. Rc1 Be6 12. Qa4 c5 13. Qa3 Rc8 14. Bb5 a6',
  '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 e5 7. Nb3 Be6 8. f3 Be7 9. Qd2 O-O 10. O-O-O Nbd7 11. g4 b5 12. g5 b4 13. Ne2 Ne8 14. f4 a5',
];

(async () => {
  const srv = serve(path.join(DIST, 'pwa'), PORT);
  await srv.ready;
  const base = `http://127.0.0.1:${PORT}/`;
  const browser = await launch();
  const say = (k, v) => console.log(String(k).padEnd(50), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got) : `${got}   <- expected ${want}`);
    if (!ok) failures.push(what);
  };
  const errors = [];

  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1300 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  await gotoSection(page, 'review');

  // ── 1. the choice ─────────────────────────────────────────────────────────
  check('the judges on offer', await page.$$eval('#reviewJudge option', (o) => o.map((x) => x.value).join(' ')), 'app stockfish reckless');
  check('this app\'s engine by default', await page.$eval('#reviewJudge', (s) => s.value), 'app');
  await page.selectOption('#reviewJudge', 'stockfish');
  await page.waitForFunction(() => /Stockfish 19/.test(document.getElementById('reviewJudgeNote').textContent));
  say('with Stockfish picked, the line says', await page.$eval('#reviewJudgeNote', (e) => e.textContent.slice(0, 80) + '…'));
  check('the walk\'s choice follows', await page.$eval('#walkJudge', (s) => s.value), 'stockfish');
  check('and it is kept as a preference', await page.evaluate(() => App.prefs.judge), 'stockfish');

  // ── 2 and 3. a review by Stockfish, twice ────────────────────────────────
  const review = async (pgn = OPERA) => {
    await page.fill('#pgnInput', pgn);
    await page.fill('#reviewName', 'Morphy');
    await page.selectOption('#reviewDepth', '7');
    await page.click('#reviewRun');
    await page.waitForFunction(() => /^Done/.test(document.getElementById('reviewStatus').textContent)
      || /failed|cannot/.test(document.getElementById('reviewStatus').textContent), null, { timeout: 300000 });
    return page.evaluate((black) => {
      // Wherever it is stored: a game reviewed again keeps its place.
      const g = App.reviews.games.find((x) => (x.pgn ?? '').includes(`[Black "${black}"]`));
      return {
        stored: App.reviews.games.length,
        status: document.getElementById('reviewStatus').textContent,
        judge: g.judge, curve: JSON.stringify(g.curve), marks: g.marks, meanLoss: g.meanLoss,
        estimate: Boolean(g.estimate), calibrated: Boolean(RATING_FIT?.judges?.[g.judge]) || g.judge === 'app',
        summary: document.querySelector('#reviewOut .panel .note')?.textContent ?? '',
        mistakes: [...document.querySelectorAll('#reviewOut .mistake-note')].map((e) => e.textContent),
      };
    }, /\[Black "([^"]+)"\]/.exec(pgn)[1]);
  };
  const byStockfish = await review();
  say('Stockfish\'s review', byStockfish.status.slice(0, 90));
  check('the stored game says Stockfish judged it', byStockfish.judge, 'stockfish');
  check('the summary names the judge and its budget', /judged by Stockfish, looking at 25,000 positions a move/.test(byStockfish.summary), true);
  check('the mistakes say what Stockfish wanted', byStockfish.mistakes.length > 0 && byStockfish.mistakes.every((t) => !/wanted/.test(t) || /Stockfish wanted/.test(t)), true);
  check('an estimate exactly when Stockfish is calibrated', byStockfish.meanLoss === null || byStockfish.estimate === byStockfish.calibrated, true);
  const again = await review();
  check('the same game twice, the same curve', again.curve, byStockfish.curve);
  check('and the same marks', again.marks, byStockfish.marks);
  check('and it is still one stored game, not two', again.stored, 1);

  // ── 4. a reopened game asks its own judge ────────────────────────────────
  const reopened = await page.evaluate(async () => {
    const game = App.reviews.games.find((g) => g.judge === 'stockfish');
    openStoredReview(game);
    // A move that was not the judge's own, so there is a move it wanted.
    const j = Review.result.judged.find((x) => x.cls !== 'best' && !x.mates);
    showJudged(j);
    for (let i = 0; i < 100 && !j.best; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 100));
    // What Stockfish itself says about that position, asked the same way.
    const start = new Board(Review.parsed.startFen ?? undefined).fen();
    const moves = Review.parsed.plies.slice(0, j.ply - 1).map((p) => p.uci);
    const own = await stockfishAnalyse(start, { nodes: Review.result.nodes, multipv: 1, moves });
    return { best: j.best?.uci ?? null, san: j.best?.san ?? null, stockfish: own.best, note: document.getElementById('reviewBoardNote').textContent };
  });
  say('a reopened Stockfish review, tapped', reopened.note);
  check('the move it names is the one Stockfish wants there', reopened.best !== null && reopened.best === reopened.stockfish, true);
  check('and the note under the board says it', reopened.san !== null && reopened.note.includes(reopened.san), true);

  // ── 2, again: another judge's review of the same game replaces it ────────
  await gotoSection(page, 'review');
  await page.selectOption('#reviewJudge', 'app');
  const byApp = await review();
  check('this app\'s engine judged it next', byApp.judge, 'app');
  check('and saw the game differently', byApp.curve !== byStockfish.curve, true);
  check('in place of Stockfish\'s review, not beside it', byApp.stored, 1);
  // And a different game by Stockfish, so two judges share the history.
  await page.selectOption('#reviewJudge', 'stockfish');
  const trap = await review(TRAP);
  check('a second game, judged by Stockfish', `${trap.judge} ${trap.stored}`, 'stockfish 2');

  // ── 6. Progress says when the judges differ ──────────────────────────────
  await gotoSection(page, 'progress');
  await page.waitForTimeout(300);
  const progress = await page.$eval('#section-progress', (e) => e.textContent);
  check('Progress says its games had different judges', /judged by more than one judge/.test(progress), true);

  // ── 5. the walk re-judges ────────────────────────────────────────────────
  await gotoSection(page, 'review');
  await page.evaluate(async (pgns) => {
    const now = Date.now();
    pgns.forEach((pgn, i) => App.reviews.games.push({
      at: now + i, white: 'Me', black: 'Them', result: '*', side: 'white', plies: 28, reviewed: false,
      accuracy: null, mistakes: [], pgn, source: 'chess.com', url: `judge-${i}`,
    }));
    await Store.set('reviews', App.reviews);
    renderImport();
  }, IMPORTED);
  await page.selectOption('#walkJudge', 'stockfish');
  await page.waitForTimeout(200);
  const offered = await page.$eval('#walkNote', (e) => e.textContent);
  say('with Stockfish picked, the walk offers', offered);
  check('the new games, and the one this app\'s engine judged', /2 games have not been analysed/.test(offered) && /judged by this app's engine, and will be judged again by Stockfish/.test(offered), true);
  await page.evaluate(() => walkImported());
  const walked = await page.evaluate(() => App.reviews.games.map((g) => ({ judge: g.judge ?? 'app', curve: Array.isArray(g.curve), marks: typeof g.marks === 'string', nodes: g.nodes })));
  check('every game is now Stockfish\'s', walked.every((g) => g.judge === 'stockfish'), true);
  check('and every one kept its curve, to reopen', walked.every((g) => g.curve && g.marks), true);
  check('the walk has nothing left for Stockfish', await page.evaluate(() => walkWaiting()), null);
  await page.selectOption('#walkJudge', 'app');
  await page.waitForTimeout(200);
  const back = await page.$eval('#walkNote', (e) => e.textContent);
  say('switched back, the walk offers', back);
  check('to judge them all again with this app\'s engine', /4 were judged by Stockfish, and will be judged again by this app's engine/.test(back), true);

  // ── 1, again: the choice survives a reload ───────────────────────────────
  await page.selectOption('#reviewJudge', 'reckless');
  await page.reload();
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  await gotoSection(page, 'review');
  await page.waitForFunction(() => document.getElementById('reviewJudge').value === 'reckless', null, { timeout: 10000 }).catch(() => {});
  check('the choice survives a reload', await page.$eval('#reviewJudge', (s) => s.value), 'reckless');

  // ── 7. Reckless, downloaded first ────────────────────────────────────────
  await page.waitForFunction(() => /download|on this device/.test(document.getElementById('reviewJudgeNote').textContent), null, { timeout: 20000 });
  say('with Reckless picked, the line says', await page.$eval('#reviewJudgeNote', (e) => e.textContent.slice(0, 90) + '…'));
  const sawDownload = page.waitForFunction(() => /Downloading Reckless/.test(document.getElementById('reviewStatus').textContent), null, { timeout: 120000 })
    .then(() => true, () => false);
  const byReckless = await review();
  check('it said it was downloading Reckless', await sawDownload, true);
  check('then Reckless judged the game', byReckless.judge, 'reckless');
  check('named as Reckless', /judged by Reckless/.test(byReckless.summary), true);

  // ── 7b. not in the APK ───────────────────────────────────────────────────
  const apkCtx = await browser.newContext({ userAgent: ANDROID_UA, viewport: { width: 390, height: 844 } });
  const apkAsked = [];
  await apkCtx.route('**/reckless/**', (route) => { apkAsked.push(route.request().url()); return route.continue(); });
  const apk = await apkCtx.newPage();
  apk.on('pageerror', (e) => errors.push(`apk: ${e.message}`));
  await apk.goto(base);
  await apk.waitForSelector('#tab-today', { timeout: 20000 });
  await gotoSection(apk, 'review');
  await apk.selectOption('#reviewJudge', 'reckless');
  await apk.waitForFunction(() => /website/.test(document.getElementById('reviewJudgeNote').textContent), null, { timeout: 20000 });
  await apk.fill('#pgnInput', OPERA);
  await apk.click('#reviewRun');
  await apk.waitForFunction(() => /website/.test(document.getElementById('reviewStatus').textContent), null, { timeout: 20000 });
  check('in the APK, Reckless says it is website-only', /website version/.test(await apk.$eval('#reviewStatus', (e) => e.textContent)), true);
  check('and nothing was reviewed or stored', await apk.evaluate(() => App.reviews.games.length), 0);
  check('and the network was asked for none of it', apkAsked.length, 0);

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
