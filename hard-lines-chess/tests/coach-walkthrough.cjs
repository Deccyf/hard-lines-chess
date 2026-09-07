// The coach talking you through a position you did not ask a question about.
//
// Everything else the coach does answers a question. Most of the time you do
// not have one — you have a position and no idea where to start, which is the
// state a coach is actually for. The walkthrough reads it in the order somebody
// sitting next to you would: material, anything loose, what they are about to
// do, what to play and what it does.
//
// WHAT IS CHECKED IS THAT EVERY LINE OF IT IS MEASURED. The walkthrough
// chooses an order; it must not invent a sentence. So each claim is matched
// against the bundle field it came from, and a position with a loose piece in
// it has to produce the loose sentence with that piece named — while the
// starting position, where nothing is loose, has to say so instead.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');

(async () => {
  const srv = serve(DIST, 8289);
  await srv.ready;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1200 } });
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

  await page.goto('http://127.0.0.1:8289/hard-lines-chess-app.html');
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  await gotoSection(page, 'board');
  await page.waitForTimeout(300);

  // A position with something plainly loose: Black's knight on e5 is attacked
  // by the knight on f3 and defended by nothing.
  const LOOSE = 'r1bqkb1r/pppp1ppp/5n2/4n3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 5';

  const read = await page.evaluate(async (fen) => {
    const bundle = await buildCoachBundle(new Board(fen), 'Talk me through this position');
    return { bundle, text: narrateCoach(bundle, 'Talk me through this position') };
  }, LOOSE);
  console.log('');
  for (const line of read.text.split('\n\n')) console.log('   ' + line);
  console.log('');

  const t = read.text;
  check('it says whose move it is', /^White to move/.test(t), true);
  check('and the material count', t.includes(read.bundle.material.slice(0, 20)), true);
  check('the engine read is in moves, not plies', /moves ahead/.test(t) && !/pl(y|ies)/.test(t), true);
  check('it names the loose piece', t.includes('knight on e5'), true);
  check('and says whose it is', /Theirs too/.test(t), true);
  check('it says what they would play if passed', t.includes(read.bundle.threat?.san ?? 'NOTHREAT'), true);
  check('and what the engine would play', t.includes(read.bundle.lines[0].san), true);
  check('it never calls a number a pawn', /\d[\d.]* pawns?\b/.test(t), false);
  // "White is 1 points up" was on screen until this line was written.
  check('and counts one point as a point', /\b1 points\b/.test(t), false);

  const quiet = await page.evaluate(async () => {
    const b = await buildCoachBundle(new Board(), 'Talk me through this position');
    return narrateCoach(b, 'Talk me through this position');
  });
  check('and a quiet position says nothing is loose',
    quiet.includes('Nothing is hanging on either side'), true);
  check('rather than inventing one', /Loose:/.test(quiet), false);

  // ── the chip is there and asks for it ────────────────────────────────────
  const chips = await page.$$eval('#coachSuggestions .chip', (c) => c.map((x) => x.textContent));
  say('chips', chips.join(' | '));
  check('the first chip talks you through it', chips[0], 'Talk me through this position');

  // ── and a live game has a way into it ────────────────────────────────────
  await gotoSection(page, 'play');
  await page.waitForTimeout(200);
  check('the game has a coach button', await page.$eval('#playCoach', (e) => Boolean(e)), true);
  await page.evaluate(() => {
    for (const uci of ['e2e4', 'e7e5']) {
      const m = Play.view.board.legalMoves().find((x) => moveToUci(x) === uci);
      if (m) Play.view.apply(m, { animate: false });
    }
  });
  const before = await page.evaluate(() => Play.view.board.fen());
  await page.click('#playCoach');
  await page.waitForTimeout(400);
  check('it opens the analysis board', await page.evaluate(() => App.section), 'board');
  check('with the game position on it', await page.evaluate(() => Practice.view.board.fen()), before);
  await page.waitForFunction(() => document.getElementById('coachLog').textContent.length > 80,
    null, { timeout: 60000 });
  const logged = await page.$eval('#coachLog', (e) => e.textContent);
  say('the coach said', logged.replace(/\s+/g, ' ').slice(0, 110));
  check('and it has already spoken, unasked', logged.includes('to move'), true);

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
