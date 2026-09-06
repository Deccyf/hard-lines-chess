const { launch, app, serve, DIST } = require('./browser.cjs');
// Black to move, and the bishop on h5 looks free to take the queen: ...Bxd1??
// loses to Bxf7+ and Nd5#. The classic Légal trap, verified by the finder's
// own tests; here it is run through the real screen.
const LEGAL = 'r2qkbnr/ppp2ppp/2np4/4N2b/2B1P3/2N4P/PPPP1PP1/R1BQK2R b KQkq - 0 6';
const QUIET = 'r1bqkb1r/pp3ppp/2n1pn2/2ppP3/3P4/2P2N2/PP3PPP/RNBQKB1R w KQkq - 0 7';
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1200 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(app());
  await page.waitForSelector('#tab-play');
  const say = (k, v) => console.log(String(k).padEnd(30), v);
  await page.click('#tab-play');

  say('box hidden when off', await page.locator('#teachBox').isHidden());
  await page.check('#teachToggle');
  await page.waitForTimeout(300);
  say('box shown when on', await page.locator('#teachBox').isVisible());
  say('idle wording', (await page.locator('#teachBody').innerText()).slice(0, 60));

  // Opening gate: ply 0, nothing may be set even on a trap position.
  const gate = await page.evaluate((fen) => { Play.myColour = BLACK; Play.view.orientation = BLACK; Play.view.setFen(fen); Play.moves = []; return trapGate(Play.view.board, 0, null, {}); }, LEGAL);
  say('opening gate', gate ? 'blocks: ' + gate.slice(0, 40) : 'DID NOT BLOCK');

  // Past the opening, on the real position: the finder must set the problem.
  await page.evaluate((fen) => {
    Play.moves = Array.from({ length: 12 }, (_, i) => ({ san: 'x', uci: 'a1a1' }));
    Play.view.setFen(fen); Play.view.interactive = true;
    considerProblem();
  }, LEGAL);
  say('while looking', await page.locator('#teachHead').innerText());
  say('board locked while looking', await page.evaluate(() => Play.view.locked));
  await page.waitForFunction(() => !Teach.looking, null, { timeout: 15000 });
  const set = await page.evaluate(() => Teach.problem && { intent: Teach.problem.intent, mistake: Teach.problem.expectedMistake.san, best: Teach.problem.bestMove.san, refute: Teach.problem.refutation?.san, cp: Teach.problem.trappiness, said: Teach.problem.said });
  say('problem set', JSON.stringify(set));
  say('announced', await page.locator('#teachHead').innerText() + ' — ' + await page.locator('#teachBody').innerText());
  say('answer NOT on screen', !(await page.locator('#teachBox').innerText()).includes(set?.best ?? '@@') && !(await page.locator('#teachBox').innerText()).includes(set?.mistake ?? '@@'));
  say('board unlocked', await page.evaluate(() => !Play.view.locked));

  // Fall into it: Bxd1.
  await page.evaluate(() => { const v = Play.view; const m = sanToMove(v.board, 'Bxd1'); resolveProblem(moveToUci(m)); });
  say('resolved', await page.locator('#teachHead').innerText() + ' — ' + (await page.locator('#teachBody').innerText()).slice(0, 110));
  say('list row', (await page.locator('#teachList').innerText()).replace(/\s+/g, ' '));

  // Re-arm on take-back: the same problem, no new search.
  await page.evaluate(() => { Play.moves.length = 12; rearmProblem(); });
  say('re-armed', await page.evaluate(() => Teach.problem ? 'yes: ' + Teach.problem.said.slice(0, 30) : 'NO'));

  // Avoid it this time.
  await page.evaluate(() => { const v = Play.view; const m = sanToMove(v.board, 'Nf6'); resolveProblem(moveToUci(m)); });
  say('avoided wording', (await page.locator('#teachBody').innerText()).slice(0, 80));

  // A quiet position sets nothing, and says so.
  await page.evaluate((fen) => { Play.myColour = WHITE; Play.moves = Array.from({ length: 30 }, () => ({ uci: 'a1a1' })); Teach.lastProblemPly = 0; Play.view.setFen(fen); considerProblem(); }, QUIET);
  await page.waitForFunction(() => !Teach.looking, null, { timeout: 15000 });
  say('quiet position', await page.evaluate(() => Teach.problem === null) + ' — ' + (await page.locator('#teachBody').innerText()).slice(0, 50));

  // A teaching game never reaches the record or the puzzle scan.
  await page.evaluate(() => { Play.over = null; Play.moves = [{ san: 'e4', uci: 'e2e4' }]; });
  await page.evaluate(() => finishPlay('resigned'));
  await page.waitForTimeout(300);
  say('record untouched', await page.evaluate(() => Object.keys(App.history.bands).length === 0 && App.history.games.length === 0));
  say('teaching stored', await page.evaluate(() => App.teaching.games.length + ' game(s), problems ' + App.teaching.games[0].problems.length));
  say('scan sees it?', await page.evaluate(() => scannableGames().length === 0 ? 'no (correct)' : 'YES (wrong)'));
  say('end note', (await page.locator('#playAfterText').innerText()).slice(0, 90));

  console.log(errors.length ? 'ERRORS ' + errors.slice(0, 3).join(' | ') : 'no page errors');
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
