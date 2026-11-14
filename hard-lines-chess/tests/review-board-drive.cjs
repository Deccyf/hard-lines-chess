// A review, on the board.
//
// A review used to be a page to read, with the board at the bottom and empty
// until something was tapped. It opens on the board now, at the first mistake,
// and can be stepped through; and the answer can be kept back while a better
// move is looked for.
//
// What has to be true:
//
//   A. THE BOARD COMES FIRST: above the figures and the lists, up without
//      being asked for, on the first mistake, with the move played and the
//      move wanted both drawn and the reason under them.
//
//   B. IT STEPS: Next mistake goes through your mistakes in the order they
//      were made and round again; Back and Next go a move at a time and stop
//      at the ends; the arrow keys do the same, and are left alone while
//      something is being typed.
//
//   C. THE ANSWER CAN BE KEPT BACK, AND WHAT IS TRIED IS JUDGED FAIRLY. The
//      move that was played, tried again, is told it is the move that was
//      played — and judged, it comes back with exactly the loss the review
//      gave it, which is what shows a tried move is measured the way the
//      review measured. The move wanted is told so. A move that is about as
//      good is told that too. A worse one is told what it loses, and the
//      position stays for another go.
//
//   D. A GAME OPENED AGAIN FROM THE STORE does all of that without being
//      reviewed again.
//
//   E. AND SO DOES A REVIEW BY STOCKFISH, judged by Stockfish.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');
const fs = require('fs');
const path = require('path');

const PORT = 8318;
const base = `http://127.0.0.1:${PORT}/`;
const played = fs.readFileSync(path.join(__dirname, '..', 'tools', 'rating-games.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));
const GAME = played.find((r) => r.elo === 300 && r.game === 0).pgn;

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
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForSelector('#tab-today', { timeout: 20000 });

  const review = async (judge) => {
    await gotoSection(page, 'review');
    await page.fill('#pgnInput', `[White "you"] [Black "them"]\n${GAME}`);
    await page.fill('#reviewName', 'you');
    await page.selectOption('#reviewJudge', judge);
    await page.selectOption('#reviewDepth', '7');
    await page.click('#reviewRun');
    await page.waitForFunction(() => /^Done/.test(document.getElementById('reviewStatus').textContent), null, { timeout: 180000 });
  };
  // What is on the board, and under it.
  const board = () => page.evaluate(() => ({
    up: !document.getElementById('reviewBoardWrap').hidden,
    title: document.getElementById('reviewBoardTitle').textContent,
    ply: Review.shown?.ply ?? null,
    fen: Review.view.board.fen(),
    arrows: Review.view.arrows.map((a) => a.kind).join(' '),
    note: document.getElementById('reviewBoardNote').textContent,
    why: document.getElementById('reviewBoardWhy').hidden ? '' : document.getElementById('reviewBoardWhy').textContent,
    tryNote: document.getElementById('reviewTryNote').hidden ? '' : document.getElementById('reviewTryNote').textContent,
    tryButton: document.getElementById('reviewTry').hidden ? '(hidden)' : document.getElementById('reviewTry').textContent,
    trying: Review.trying !== null,
    takesMoves: Review.view.interactive,
    back: document.getElementById('reviewPrev').disabled,
    next: document.getElementById('reviewNext').disabled,
  }));
  const mistakes = () => page.evaluate(() => reviewMistakes().map((j) => ({ ply: j.ply, san: j.san, uci: j.uci, best: j.best?.uci ?? null, bestSan: j.best?.san ?? null, loss: j.loss, kind: j.kind, fen: j.fen })));
  // Make a move on the board, as a tap or a drag ends up making one.
  const move = (uci) => page.evaluate((uci) => {
    const m = Review.view.board.legalMoves().find((x) => moveToUci(x) === uci);
    return Review.view.onMove({ move: m, san: toSan(Review.view.board, m), uci, view: Review.view });
  }, uci);
  const settled = () => page.waitForFunction(() => !Review.checking && !/^Checking /.test(document.getElementById('reviewTryNote').textContent), null, { timeout: 60000 });

  // Everything section C checks, for whichever judge reviewed the game.
  const trying = async (label, judgeWords) => {
    const mine = await mistakes();
    const first = mine[0];
    await page.evaluate(() => showJudged(reviewMistakes()[0], { scroll: false }));
    await page.click('#reviewTry');
    let b = await board();
    check(`${label}: asked for, the answer is taken off the board`, `${b.trying} ${b.takesMoves} [${b.arrows}]`, 'true true []');
    check(`${label}: and a better move is asked for`, new RegExp(`^You played \\d+\\.+ ?${first.san.replace(/[+#]/g, '\\$&')}\\. Find a better move for (White|Black)\\.$`).test(b.note), true);
    check(`${label}: with a way to see the answer after all`, b.tryButton, 'Show the answer');

    await move(first.uci);
    await settled();
    b = await board();
    check(`${label}: the move that was played is told it is the move that was played`, b.tryNote, `${first.san} is what you played. Look for something else.`);
    check(`${label}: and the question stands`, `${b.trying} ${b.fen === first.fen}`, 'true true');

    // Every legal move there, judged — the played move among them.
    const verdicts = await page.evaluate(async () => {
      const j = Review.trying;
      const at = new Board(j.fen);
      const out = [];
      for (const m of at.legalMoves()) {
        const uci = moveToUci(m);
        if (uci === j.best.uci) continue;
        const v = await judgeReviewTry(j, m, uci);
        out.push({ uci, san: toSan(at, m), ...v });
      }
      return out;
    });
    const again = verdicts.find((v) => v.uci === first.uci);
    check(`${label}: judged as a try, the move played loses exactly what the review said it lost`,
      `${again.kind} ${again.loss} ${again.good}`, `${first.kind} ${first.loss} false`);
    const worse = verdicts.filter((v) => !v.good && v.uci !== first.uci);
    const asGood = verdicts.filter((v) => v.good);
    say(`${label}: of ${verdicts.length} other moves there`, `${asGood.length} about as good, ${worse.length + 1} worse`);
    check(`${label}: there is a worse move to try`, worse.length > 0, true);

    const bad = worse.find((v) => v.kind === 'material') ?? worse[0];
    await move(bad.uci);
    await settled();
    b = await board();
    const lost = bad.kind === 'material' ? `${bad.san} loses about ${(bad.loss / 100).toFixed(1)} points against ${judgeWords}’s move. Try again.`
      : (bad.kind === 'allowed_mate' ? `${bad.san} lets them force mate. Try again.` : `There is a forced mate here, and ${bad.san} lets it go. Try again.`);
    check(`${label}: a worse move is told what it loses`, b.tryNote, lost);
    check(`${label}: and the position stays for another go, with the move tried drawn on it`, `${b.trying} ${b.fen === first.fen} [${b.arrows}]`, 'true true [user]');

    if (asGood.length) {
      await move(asGood[0].uci);
      await settled();
      b = await board();
      check(`${label}: a move about as good is told so`, b.tryNote, `${asGood[0].san} works too: ${judgeWords} makes it about as good as its own ${first.bestSan}.`);
      check(`${label}: and the answer is shown`, `${b.trying} [${b.arrows}]`, 'false [played best]');
      await page.click('#reviewTry');
    }

    await move(first.best);
    await settled();
    b = await board();
    check(`${label}: the move wanted is told so`, b.tryNote, `Yes — ${first.bestSan} is what ${judgeWords} wanted.`);
    check(`${label}: and the answer is back on the board, which takes no more moves`, `${b.trying} ${b.takesMoves} [${b.arrows}] ${b.tryButton}`, 'false false [played best] Try it yourself');

    await page.click('#reviewTry');
    await page.click('#reviewTry');
    b = await board();
    check(`${label}: asking to see the answer shows it`, `${b.trying} [${b.arrows}] ${b.tryNote}`, 'false [played best] ');
    if (mine.length > 1) {
      await page.click('#reviewTry');
      await page.click('#reviewNextMistake');
      b = await board();
      check(`${label}: moving on ends the try`, `${b.trying} ${b.ply} ${b.tryNote}`, `false ${mine[1].ply} `);
    }
  };

  // ── A. the board comes first ───────────────────────────────────────────────
  await review('app');
  const mine = await mistakes();
  say('A: the review found', `${mine.length} mistakes, at plies ${mine.map((m) => m.ply).join(' ')}`);
  check('A: with more than one mistake to step through', mine.length > 2, true);
  const first = await board();
  check('A: the board is up without being asked for', first.up, true);
  check('A: above the figures and the lists', await page.evaluate(() => Boolean(document.getElementById('reviewBoardWrap').compareDocumentPosition(document.getElementById('reviewOut')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
  check('A: on the first mistake', `${first.ply} ${first.title}`, `${mine[0].ply} Mistake 1 of ${mine.length}`);
  check('A: with the move played and the move wanted both drawn', first.arrows, 'played best');
  check('A: and the position before the move', first.fen, mine[0].fen);
  say('A: under it', `${first.note} | ${first.why}`);
  check('A: saying what the move cost and what was wanted', first.note.includes(mine[0].san) && first.note.includes(mine[0].bestSan), true);
  check('A: and the list of every move marks it', await page.evaluate(() => Number(document.querySelector('#reviewMoves .mv.on')?.dataset.ply)), mine[0].ply);

  // ── B. it steps ────────────────────────────────────────────────────────────
  const seen = [];
  for (let i = 0; i < mine.length; i++) {
    await page.click('#reviewNextMistake');
    const b = await board();
    seen.push(`${b.ply}:${b.title}`);
  }
  check('B: Next mistake goes through them in the order they were made, and round again', seen.join(' | '),
    [...mine.slice(1), mine[0]].map((m) => `${m.ply}:Mistake ${mine.indexOf(m) + 1} of ${mine.length}`).join(' | '));
  await page.click('#reviewNext');
  let b = await board();
  check('B: Next goes on one move', b.ply, mine[0].ply + 1);
  check('B: which is called a mistake only if it is one of yours', b.title, mine.some((m) => m.ply === mine[0].ply + 1) ? b.title : 'Position');
  await page.click('#reviewPrev');
  check('B: and Back comes back', (await board()).ply, mine[0].ply);
  await page.evaluate(() => showJudged(Review.result.judged[0], { scroll: false }));
  b = await board();
  check('B: at the first move there is no going back', `${b.back} ${b.next}`, 'true false');
  await page.evaluate(() => showJudged(Review.result.judged[Review.result.judged.length - 1], { scroll: false }));
  b = await board();
  check('B: and at the last, no going on', `${b.back} ${b.next}`, 'false true');
  const lastPly = b.ply;
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('ArrowLeft');
  check('B: the left arrow key goes back a move', (await board()).ply, lastPly - 1);
  await page.keyboard.press('ArrowRight');
  check('B: and the right one goes on', (await board()).ply, lastPly);
  await page.focus('#pgnInput');
  await page.keyboard.press('ArrowLeft');
  check('B: but not while something is being typed', (await board()).ply, lastPly);
  await page.evaluate(() => document.activeElement?.blur());

  // ── C. the answer kept back ────────────────────────────────────────────────
  await trying('C', 'the engine');
  await page.evaluate(() => showJudged(Review.result.judged.find((j) => !reviewMistakes().includes(j)), { scroll: false }));
  check('C: a move that was not a mistake has nothing to try again', (await board()).tryButton, '(hidden)');

  // ── D. a game opened again from the store ──────────────────────────────────
  await page.reload();
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  await page.evaluate(() => openStoredReview(App.reviews.games[0]));
  // (A game opened again has its best moves worked out as they are wanted, in a worker.)
  await page.waitForFunction(() => Review.shown?.best, null, { timeout: 30000 });
  b = await board();
  const stored = await mistakes();
  check('D: opened again, it is on the board at the first mistake, without being reviewed again',
    `${b.up} ${b.ply} ${b.title} [${b.arrows}]`, `true ${mine[0].ply} Mistake 1 of ${mine.length} [played best]`);
  check('D: with the same mistakes, wanting the same moves', JSON.stringify(stored.map((m) => [m.ply, m.loss, m.kind])), JSON.stringify(mine.map((m) => [m.ply, m.loss, m.kind])));
  check('D: and the first has its answer', stored[0].best, mine[0].best);
  await trying('D', 'the engine');

  // ── E. a review by Stockfish ───────────────────────────────────────────────
  await review('stockfish');
  const theirs = await mistakes();
  say('E: Stockfish found', `${theirs.length} mistakes`);
  b = await board();
  check('E: Stockfish\'s review opens on the board too', `${b.up} ${b.ply} ${b.title} [${b.arrows}]`, `true ${theirs[0].ply} Mistake 1 of ${theirs.length} [played best]`);
  await trying('E', 'Stockfish');

  console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
  if (errors.length) failures.push('page errors');
  await browser.close();
  srv.stop?.();
  if (failures.length) { console.log(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1); }
  console.log('ok');
  process.exit(0);
})().catch((e) => { console.error(e); console.log('FAILED'); process.exit(1); });
