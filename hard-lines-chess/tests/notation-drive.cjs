// The notation screen, driven.
//
// The claim this screen makes is unusual for a teaching screen: that nothing
// on it was written out by hand. The notation beside each lesson, and the
// reason under each character of it, are produced from the position by the
// same code that writes the moves in your own games. So the checks here are
// about that claim rather than about the prose:
//
//   1. Every lesson's move is legal in its position, and the notation the app
//      writes for it is the notation the lesson says it is.
//   2. The characters of the explanation, joined back together, ARE the move.
//      An explanation that has drifted from the move it explains is the one
//      failure that would teach somebody the wrong rule.
//   3. A move that is not the one asked for is still named. Refusing to name a
//      legal move would be this screen failing at the only thing it is for.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');

(async () => {
  const srv = serve(DIST, 8277);
  await srv.ready;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1200 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const say = (k, v) => console.log(String(k).padEnd(40), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got) : `${got}   <- expected ${want}`);
    if (!ok) failures.push(what);
  };

  await page.goto('http://127.0.0.1:8277/hard-lines-chess-app.html');
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  await gotoSection(page, 'notation');
  check('the section opens', await page.$eval('#section-notation', (e) => !e.hidden), true);

  // ── 1 and 2: every lesson, checked against the engine ────────────────────
  const audit = await page.evaluate(() => NOTATION_LESSONS.map((lesson) => {
    const board = new Board(lesson.fen);
    const move = board.legalMoves().find((m) => moveToUci(m) === lesson.uci);
    if (!move) return { id: lesson.id, legal: false };
    const written = toSan(new Board(lesson.fen), move);
    const spelled = spellMove(new Board(lesson.fen), move);
    return {
      id: lesson.id,
      legal: true,
      written,
      claimed: lesson.san,
      joined: spelled.parts.map((p) => p.text).join(''),
      parts: spelled.parts.length,
      reasoned: spelled.parts.every((p) => p.label && p.why && p.why.length > 25),
    };
  }));
  for (const a of audit) say(`  ${a.id}`, a.legal ? `${a.written}  (${a.parts} parts)` : 'ILLEGAL MOVE');
  check('every lesson move is legal', audit.every((a) => a.legal), true);
  check('the app writes what the lesson claims', audit.every((a) => a.written === a.claimed), true);
  check('the explanation joins back into the move', audit.every((a) => a.joined === a.written), true);
  check('and every character has a reason under it', audit.every((a) => a.reasoned), true);
  check('there are fourteen of them', audit.length, 14);

  // The explanation is DERIVED, so it has to change when the position does.
  // Two knights that can reach d2 make it Nbd2; one knight makes it Nd2, and
  // the b disappears along with the reason for it.
  const derived = await page.evaluate(() => {
    const twoKnights = '4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1';
    const oneKnight = '4k3/8/8/8/8/8/8/1N2K3 w - - 0 1';
    const spell = (fen) => {
      const board = new Board(fen);
      const move = board.legalMoves().find((m) => moveToUci(m) === 'b1d2');
      return spellMove(new Board(fen), move);
    };
    const two = spell(twoKnights), one = spell(oneKnight);
    return { two: two.san, one: one.san, why: two.parts.find((p) => p.label === 'which one')?.why ?? '' };
  });
  say('with a second knight', derived.two);
  say('without it', derived.one);
  check('the disambiguation appears only when it is needed', `${derived.two}/${derived.one}`, 'Nbd2/Nd2');
  check('and the reason names the piece that forced it', derived.why.includes('f3'), true);

  // ── the lesson list, and playing one on the board ────────────────────────
  check('every lesson is listed',
    await page.$$eval('#notationLessons .endgame-row', (r) => r.length), 14);
  // The tag on each row is the notation, written at render time rather than
  // read out of the file.
  const tags = await page.$$eval('#notationLessons .tag', (t) => t.map((x) => x.textContent));
  say('the tags', tags.join(' '));
  check('the list is tagged with the notation itself', tags.includes('Nbd2') && tags.includes('exd6'), true);

  await page.evaluate(() => {
    startNotationBoard(NOTATION_LESSONS.find((l) => l.id === 'which-file').fen,
      NOTATION_LESSONS.find((l) => l.id === 'which-file'));
  });
  await page.waitForTimeout(120);
  check('the lesson asks in words, not in notation',
    await page.$eval('#notationPrompt', (e) => e.textContent).then((t) => t.includes('knight on b1') && !t.includes('Nbd2')), true);
  check('and the square to move from is ringed',
    await page.evaluate(() => Notation.view.marks.length), 1);

  // Play the wrong knight: still named, still explained, and told apart.
  await page.evaluate(() => {
    const move = Notation.board.legalMoves().find((m) => moveToUci(m) === 'f3d2');
    onNotationMove({ move });
  });
  await page.waitForTimeout(120);
  check('a move that was not asked for is still named',
    await page.$eval('#notationSan', (e) => e.textContent), 'Nfd2');
  check('and it says it was not the one', 
    await page.$eval('#notationFeedback', (e) => e.textContent).then((t) => t.includes('not the one this lesson is about')), true);
  check('and it is broken into its parts',
    await page.$$eval('#notationParts .san-part', (r) => r.length), 3);

  await page.click('#notationTakeBack');
  await page.waitForTimeout(120);
  check('taking it back restores the position',
    await page.evaluate(() => Notation.board.fen()),
    await page.evaluate(() => NOTATION_LESSONS.find((l) => l.id === 'which-file').fen));

  await page.click('#notationShow');
  await page.waitForTimeout(150);
  check('showing it plays the right one',
    await page.$eval('#notationSan', (e) => e.textContent), 'Nbd2');
  check('and says so', 
    await page.$eval('#notationFeedback', (e) => e.textContent).then((t) => t.includes('That is the move')), true);
  const partTexts = await page.$$eval('#notationParts .san-part-text', (r) => r.map((x) => x.textContent));
  say('the parts on screen', partTexts.join(' | '));
  check('the parts on screen spell the move', partTexts.join(''), 'Nbd2');

  // ── a free board names whatever you play on it ───────────────────────────
  await page.click('#notationFree');
  await page.waitForTimeout(120);
  check('starting again is the starting position',
    await page.evaluate(() => Notation.board.fen().startsWith('rnbqkbnr/pppppppp')), true);
  await page.evaluate(() => {
    for (const uci of ['e2e4', 'e7e5', 'g1f3', 'b8c6']) {
      const move = Notation.board.legalMoves().find((m) => moveToUci(m) === uci);
      onNotationMove({ move });
    }
  });
  await page.waitForTimeout(150);
  const played = await page.$$eval('#notationMoves .mv', (r) => r.map((x) => x.textContent));
  say('a free game', played.join(' '));
  check('every move made is written down', played.join(' '), 'e4 e5 Nf3 Nc6');

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
