// Whose lines the analysis board shows.
//
// The analysis board's top three lines were this app's own engine's, and it
// searched for them on the page's own thread. There is now a choice — this
// app's engine, or Stockfish — and either is searched in a worker.
//
// What has to be true:
//
//   A. THIS APP'S ENGINE GIVES THE LINES IT ALWAYS GAVE — the same three
//      moves, scores and lines as a search done on the page — without
//      holding the page still while it finds them.
//
//   B. STOCKFISH, CHOSEN, GIVES STOCKFISH'S: the lines under the board are
//      what Stockfish answers for the game so far, the sentence says whose
//      they are, a line can still be played by pressing it, and the choice
//      is kept.
//
//   C. WHERE STOCKFISH CANNOT RUN — a copy opened from a file — the choice
//      says so, and asking still gets lines: this app's engine's, said to be.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');
const path = require('path');

const PORT = 8319;
const base = `http://127.0.0.1:${PORT}/`;
// A middlegame with something in it: an Italian, both sides developed.
const FEN = 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQ1RK1 w - - 0 7';

(async () => {
  const srv = serve(path.join(DIST, 'pwa'), PORT);
  await srv.ready;
  const browser = await launch();
  const say = (k, v) => console.log(String(k).padEnd(66), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got).slice(0, 110) : `${String(got).slice(0, 400)}   <- expected ${String(want).slice(0, 400)}`);
    if (!ok) failures.push(what);
  };
  const errors = [];
  const open = async (url = base) => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForSelector('#tab-today', { timeout: 20000 });
    await gotoSection(page, 'board');
    await page.fill('#practiceFenIn', FEN);
    await page.click('#practiceLoad');
    return page;
  };
  // Ask for lines, and wait for them — measuring the longest the page went without a turn meanwhile.
  const suggest = (page) => page.evaluate(async () => {
    let last = performance.now();
    let longest = 0;
    const ticking = setInterval(() => { const now = performance.now(); longest = Math.max(longest, now - last); last = now; }, 10);
    await suggestPractice();
    clearInterval(ticking);
    return {
      held: Math.round(longest),
      verdict: document.getElementById('practiceVerdict').textContent,
      lines: JSON.stringify(Practice.lastLines.lines.map((l) => [moveToUci(l.move), l.score, l.line.map(moveToUci).join(' ')])),
      shown: document.querySelectorAll('#practiceLines .line-row').length,
      arrows: Practice.view.arrows.map((a) => a.kind).join(' '),
    };
  });

  // ── A. this app's engine ───────────────────────────────────────────────────
  const page = await open();
  check('A: to begin with the lines are this app\'s engine\'s', await page.$eval('#practiceEngine', (e) => e.value), 'app');
  await page.evaluate(() => { App.prefs.think = 'deep'; });
  const mine = await suggest(page);
  const onPage = await page.evaluate((fen) => {
    const budget = THINK.deep;
    App.engine.reset();
    const r = App.engine.search(new Board(fen), { nodes: budget.nodes, maxDepth: budget.depth, lines: 3 });
    return JSON.stringify(r.lines.map((l) => [moveToUci(l.move), l.score, l.line.map(moveToUci).join(' ')]));
  }, FEN);
  say('A: its three', JSON.parse(mine.lines).map((l) => `${l[0]} ${l[1]}`).join(', '));
  check('A: the three lines are the ones a search on the page gives, to the move and the score', mine.lines, onPage);
  check('A: shown as three rows and three arrows, the first one green', `${mine.shown} ${mine.arrows}`, '3 best user user');
  check('A: and said to be its choice', /^\S+ is its choice\. Scores are from White's side, in points \(looked about \d+ moves ahead\)\.$/.test(mine.verdict), true);
  say('A: the longest the page was held while it looked', `${mine.held} ms`);
  check('A: without holding the page still', mine.held < 250, true);

  // ── B. Stockfish ───────────────────────────────────────────────────────────
  await page.selectOption('#practiceEngine', 'stockfish');
  await page.waitForFunction(() => /Stockfish 19/.test(document.getElementById('practiceEngineNote').textContent));
  check('B: choosing Stockfish says what it is', await page.$eval('#practiceEngineNote', (e) => e.textContent),
    "Stockfish 19. Far stronger than this app's engine, so it finds mistakes that one misses.");
  check('B: and clears the lines that were the other engine\'s', await page.evaluate(() => `${document.querySelectorAll('#practiceLines .line-row').length} [${Practice.view.arrows.map((a) => a.kind).join(' ')}]`), '0 []');
  const theirs = await suggest(page);
  const direct = await page.evaluate(async (fen) => {
    const a = await stockfishAnalyse(fen, { nodes: THINK.deep.nodes, multipv: 3 });
    return JSON.stringify(a.lines.map((l) => l.move));
  }, FEN);
  say('B: Stockfish\'s three', JSON.parse(theirs.lines).map((l) => `${l[0]} ${l[1]}`).join(', '));
  check('B: the three moves are the ones Stockfish answers with', JSON.stringify(JSON.parse(theirs.lines).map((l) => l[0])), direct);
  check('B: and are said to be Stockfish\'s', /^\S+ is Stockfish’s choice\. Scores are from White's side, in points \(looked about \d+ moves ahead\)\.$/.test(theirs.verdict), true);
  check('B: they are not this app\'s engine\'s lines under another name', theirs.lines !== mine.lines, true);
  const best = JSON.parse(theirs.lines)[0][0];
  await page.click('#practiceLines .line-row');
  check('B: pressing a line plays it', await page.evaluate(() => Practice.moves[Practice.moves.length - 1]?.uci), best);
  // After a move the game so far is what Stockfish is told, not the position alone.
  const next = await suggest(page);
  const told = await page.evaluate(async ([fen, uci]) => {
    const a = await stockfishAnalyse(fen, { nodes: THINK.deep.nodes, multipv: 3, moves: [uci] });
    return a.lines[0].move;
  }, [FEN, best]);
  check('B: after a move, it is asked about the game so far', JSON.parse(next.lines)[0][0], told);
  await page.reload();
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  check('B: the choice is kept', await page.$eval('#practiceEngine', (e) => e.value), 'stockfish');
  await page.close();

  // ── C. a copy opened from a file ───────────────────────────────────────────
  const copy = await open(`file://${path.join(DIST, 'hard-lines-chess-app.html')}`);
  await copy.selectOption('#practiceEngine', 'stockfish');
  await copy.waitForFunction(() => /opened from a file/.test(document.getElementById('practiceEngineNote').textContent));
  check('C: in a copy opened from a file, the choice says Stockfish cannot run there', await copy.$eval('#practiceEngineNote', (e) => e.className), 'note judge-note bad-note');
  await copy.evaluate(() => { App.prefs.think = 'fast'; });
  const fallen = await suggest(copy);
  check('C: asking still gets three lines', fallen.shown, 3);
  check('C: said to be this app\'s engine\'s, and why',
    /is its choice\..* These are this app's engine's lines: Stockfish could not be used here\. Stockfish runs in a background worker, and a copy of the page opened straight from a file cannot start one\./.test(fallen.verdict), true);

  console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
  if (errors.length) failures.push('page errors');
  await browser.close();
  srv.stop?.();
  if (failures.length) { console.log(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1); }
  console.log('ok');
  process.exit(0);
})().catch((e) => { console.error(e); console.log('FAILED'); process.exit(1); });
