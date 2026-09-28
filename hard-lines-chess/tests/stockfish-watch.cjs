// Stockfish on the Watch screen, driven with the real engine.
//
// What has to be true, and none of it can be read off the code:
//
//   1. IT PLAYS. The worker starts from the files the build ships, a game
//      against a level runs on the page's own timer, and every move on the
//      board is legal and in the list.
//
//   2. EVERY MOVE IS EXPLAINED, from Stockfish's own analysis: a verdict on
//      each one, Stockfish's own moves called its choice, the level's judged
//      against it, and no sentence with a hole in it — no "undefined", no
//      "NaN", no ". ." where a number or a word failed to arrive.
//
//   3. THE SAME QUESTION GETS THE SAME ANSWER. A position analysed twice by
//      the worker comes back with the same move, score and line — the promise
//      the node budget makes, checked on the real engine.
//
//   4. THE READER CAN MOVE WHILE IT THINKS. Back pressed during a wait is
//      where the board stays; the late move does not drag it forward.
//
//   5. AGAINST ITSELF, both sides are Stockfish and both are explained as its
//      choices once the book is done.
//
//   6. AND WHERE IT CANNOT RUN, IT SAYS SO. A copy opened straight from a file
//      cannot start a worker; the screen says that instead of hanging.
const { launch, serve, DIST, app, gotoSection } = require('./browser.cjs');

const PORT = 8297;
const PLIES = Number(process.env.PLIES || 30);

(async () => {
  const srv = serve(DIST, PORT);
  await srv.ready;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1300 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const say = (k, v) => console.log(String(k).padEnd(44), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got) : `${got}   <- expected ${want}`);
    if (!ok) failures.push(what);
  };
  // ". ." is a sentence whose middle failed to arrive; "...Nxe4" is how the
  // opening notes write a Black move, and is not a hole.
  const holes = (text) => /undefined|NaN|\bnull\b|\[object|\. \.|\s,|\(\s*\)/.test(text);

  await page.goto(`http://127.0.0.1:${PORT}/hard-lines-chess-app.html`);
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  await gotoSection(page, 'watch');

  // ── the opponent list ─────────────────────────────────────────────────────
  const options = await page.$$eval('#watchSfOpponent option', (o) => o.map((x) => x.textContent));
  check('the first opponent is Stockfish itself', options[0], 'Stockfish — itself');
  check('and every level follows', options.length, await page.evaluate(() => BANDS.length + 1));
  check('the default is level 1500',
    await page.$eval('#watchSfOpponent', (s) => s.options[s.selectedIndex].textContent.startsWith('Level 1500')), true);

  // ── 1 and 2. a game against 1500, played by the screen ───────────────────
  const started = Date.now();
  await page.click('#watchStockfish');
  await page.evaluate(() => { Watch.speed = 20; });
  await page.waitForFunction((n) => Watch.ply >= n || !Watch.playing, PLIES, { timeout: 600000 });
  await page.evaluate(() => stopWatch());
  const seconds = (Date.now() - started) / 1000;
  const game = await page.evaluate(() => ({
    title: Watch.title,
    white: Watch.sf.white,
    black: Watch.sf.black,
    book: Watch.book.length,
    bookName: Watch.bookName,
    sans: Watch.sans.slice(),
    ply: Watch.ply,
    finished: Watch.finished,
    error: Watch.sf.error,
    name: Stockfish.name,
  }));
  say('engine', game.name);
  say('game', `${game.title} · ${game.bookName} for ${game.book} plies · ${game.ply} plies in ${seconds.toFixed(0)} s`);
  check('Stockfish started, and no error', game.error, null);
  check(`it played ${PLIES} plies (or finished)`, game.ply >= PLIES || game.finished !== null, true);
  check('one side is Stockfish and one the level',
    [game.white, game.black].sort().join(' '), 'level stockfish');

  // Walk it: every move legal on the board the screen shows.
  const walked = await page.evaluate(() => {
    for (let i = 1; i <= Watch.sans.length; i++) {
      goToWatchPly(i);
      if (Watch.ply !== i) return { stuckAt: i };
    }
    return { ply: Watch.ply };
  });
  check('every move replays', walked.ply, game.sans.length);

  // Every explanation, as the screen shows it.
  const notes = await page.evaluate(() => {
    const out = [];
    for (let i = 1; i <= Watch.sans.length; i++) {
      goToWatchPly(i);
      const n = Watch.notes[i];
      out.push({
        ply: i,
        san: Watch.sans[i - 1],
        side: Watch.sf[(i - 1) % 2 === 0 ? 'white' : 'black'],
        inBook: i <= Watch.book.length,
        explained: Boolean(n?.explained),
        verdict: document.getElementById('watchNote').textContent,
        why: [...document.querySelectorAll('#watchWhy p')].map((p) => p.textContent),
        loss: n?.explained?.facts?.loss ?? null,
      });
    }
    return out;
  });
  const unexplained = notes.filter((n) => !n.explained);
  check('every move has an explanation', unexplained.length, 0);
  if (unexplained.length) say('  unexplained plies', unexplained.map((n) => n.ply).join(' '));
  const ownOut = notes.filter((n) => n.side === 'stockfish' && !n.inBook && !n.verdict.startsWith("Stockfish's choice"));
  check("Stockfish's own moves are called its choice", ownOut.length, 0);
  const levelMoves = notes.filter((n) => n.side === 'level' && !n.inBook);
  const judged = levelMoves.filter((n) => /^(Stockfish agrees|Slightly worse|Inaccuracy|Mistake|Blunder)/.test(n.verdict));
  check("the level's moves are judged against it", judged.length, levelMoves.length);
  const holed = notes.filter((n) => holes(n.verdict) || n.why.some(holes));
  check('no sentence has a hole in it', holed.length, 0);
  for (const n of holed.slice(0, 3)) say(`  ply ${n.ply}`, [n.verdict, ...n.why].join(' / '));
  // A mate carried as a score is a number past anything a position is worth;
  // printed as points it came out as "983.4 points worse".
  const absurd = notes.filter((n) => /about (\d+(\.\d)?) points/.test(n.verdict)
    && Number(n.verdict.match(/about (\d+(\.\d)?) points/)[1]) > 60);
  check('no verdict counts a mate as points', absurd.length, 0);
  for (const n of absurd.slice(0, 2)) say(`  ply ${n.ply}`, n.verdict);
  const lines = notes.filter((n) => n.why.some((t) => t.startsWith('The line Stockfish expects:')));
  check('most moves show the line Stockfish expects', lines.length >= notes.length / 2, true);

  // A few, printed, because reading them is the real test.
  for (const n of notes.filter((x) => !x.inBook).slice(0, 6)) {
    console.log(`\n  ${Math.ceil(n.ply / 2)}${n.ply % 2 ? '.' : '…'} ${n.san} (${n.side})`);
    console.log(`    ${n.verdict}`);
    for (const t of n.why) console.log(`    · ${t}`);
  }
  const worst = [...levelMoves].sort((a, b) => b.loss - a.loss)[0];
  if (worst) {
    console.log(`\n  the level's worst: ${Math.ceil(worst.ply / 2)}${worst.ply % 2 ? '.' : '…'} ${worst.san}`);
    console.log(`    ${worst.verdict}`);
    for (const t of worst.why) console.log(`    · ${t}`);
  }
  console.log('');

  // ── 3. the same position, the same answer ───────────────────────────────
  const twice = await page.evaluate(async () => {
    const fen = Watch.sf.fens[Math.min(12, Watch.sf.fens.length - 1)];
    const a = await stockfishAnalyse(fen, { nodes: STOCKFISH_NODES, multipv: 3 });
    const b = await stockfishAnalyse(fen, { nodes: STOCKFISH_NODES, multipv: 3 });
    return { a: JSON.stringify(a), b: JSON.stringify(b), depth: a.depth, nodes: a.nodes };
  });
  say('a position searched twice', `depth ${twice.depth}, ${twice.nodes} positions`);
  check('comes back the same both times', twice.a, twice.b);

  // ── 4. Back while it thinks ──────────────────────────────────────────────
  const backed = await page.evaluate(async () => {
    goToWatchPly(Watch.sans.length);
    const at = Watch.ply;
    // Forget the look-ahead, so the next step has to wait for a search.
    Watch.sf.prep.delete(at + 1);
    const step = stepWatchStockfish();
    const thinking = document.getElementById('watchProgress').textContent;
    stepWatch(false);
    const shown = await step;
    return { at, ply: Watch.ply, shown, thinking };
  });
  say('while it thinks, the line under the board says', backed.thinking);
  check('the late move is dropped', backed.shown, false);
  check('and the board stays where Back put it', backed.ply, backed.at - 1);
  check('and the line says Stockfish is thinking', /Stockfish is thinking/.test(backed.thinking), true);
  check('then Next goes forward again', await page.evaluate(async () => {
    const at = Watch.ply;
    await stepWatchStockfish();
    return Watch.ply === at + 1;
  }), true);

  // ── 5. against itself ────────────────────────────────────────────────────
  await page.selectOption('#watchSfOpponent', 'stockfish');
  await page.click('#watchStockfish');
  await page.evaluate(() => { Watch.speed = 20; });
  await page.waitForFunction(() => Watch.ply >= Watch.book.length + 6 || !Watch.playing, null, { timeout: 300000 });
  await page.evaluate(() => stopWatch());
  const self = await page.evaluate(() => {
    const out = {
      title: Watch.title, white: Watch.sf.white, black: Watch.sf.black, book: Watch.book.length, verdicts: [],
      ply: Watch.ply, error: Watch.sf.error, finished: Watch.finished, sans: Watch.sans.join(' '),
    };
    // The end is read once: goToWatchPly moves Watch.ply, and a loop bounded
    // by it stops after the first step.
    const end = Watch.ply;
    for (let i = Watch.book.length + 1; i <= end; i++) {
      goToWatchPly(i);
      out.verdicts.push(document.getElementById('watchNote').textContent);
    }
    return out;
  });
  say('self-play', `${self.title}, book ${self.book} plies, then ${self.verdicts.length} of its own`);
  check('it played six moves of its own', self.verdicts.length >= 6 || self.finished !== null, true);
  if (self.verdicts.length < 6) say('  stopped', JSON.stringify({ error: self.error, finished: self.finished, sans: self.sans }));
  check('and no error', self.error, null);
  check('both sides are Stockfish', `${self.white} ${self.black}`, 'stockfish stockfish');
  check('and every move after the book is its choice',
    self.verdicts.every((v) => v.startsWith("Stockfish's choice")), true);

  // ── 6. a copy opened from a file ─────────────────────────────────────────
  const local = await ctx.newPage();
  local.on('pageerror', (e) => errors.push(`file:// ${e.message}`));
  await local.goto(app());
  await local.waitForSelector('#tab-today', { timeout: 20000 });
  await gotoSection(local, 'watch');
  await local.click('#watchStockfish');
  await local.waitForFunction(() => !document.getElementById('watchSfNote').hidden, null, { timeout: 20000 });
  const said = await local.$eval('#watchSfNote', (e) => e.textContent);
  say('opened from a file, it says', said.slice(0, 90) + '…');
  check('that it cannot start here', /cannot start/.test(said), true);
  check('and it is not playing', await local.evaluate(() => Watch.playing), false);

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
