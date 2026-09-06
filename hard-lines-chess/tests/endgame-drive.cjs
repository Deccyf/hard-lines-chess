// The endgame trainer, driven. Checks the two things that matter and that no
// unit test can see: that the screen wires up at all, and that the running
// verdict changes on the move the win actually goes.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');

(async () => {
  const srv = serve(DIST, 8241);
  await srv.ready;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const say = (k, v) => console.log(String(k).padEnd(30), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got) : `${got}   <- expected ${want}`);
    if (!ok) failures.push(`${what}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  };

  await page.goto('http://127.0.0.1:8241/hard-lines-chess-app.html');
  await page.waitForSelector('#tab-today', { timeout: 20000 });

  // Both screens are reachable through the nav — which since the strip went to
  // two levels means opening the group and then the screen, not scrolling a row
  // of fourteen.
  await gotoSection(page, 'endgames');
  check('the Endgames tab opens it', await page.$eval('#section-endgames', (e) => !e.hidden), true);
  await gotoSection(page, 'vision');
  check('the Vision tab opens it', await page.$eval('#section-vision', (e) => !e.hidden), true);

  await page.evaluate(() => show('endgames'));
  await page.waitForTimeout(200);
  // Every endgame in the data is on the screen. Asserting a fixed number here
  // meant that removing one — the rook ending the app could not referee — read
  // as a rendering fault rather than as the deletion it was.
  const listed = await page.$$eval('#endgameList .endgame-row', (els) => els.length);
  const inData = await page.evaluate(() => ENDGAMES.length);
  check(`all ${inData} endgames are listed`, listed, inData);
  check('and there are some', inData > 4, true);

  // ── the opposition ending, played wrongly on purpose ──────────────────────
  await page.evaluate(() => startEndgame(ENDGAMES.find((e) => e.id === 'opposition-fifth')));
  await page.waitForTimeout(400);
  check('starts winning', await page.$eval('#endgameVerdict', (e) => e.textContent.startsWith('Still winning')), true);
  say('verdict at the start', await page.$eval('#endgameVerdict', (e) => e.textContent));

  // e5-e6?? is the move that looks obvious and throws the win away: the KING
  // has to go to the sixth, not the pawn. Six of the eight moves here draw,
  // and this is the one a human plays.
  const threw = await page.evaluate(() => {
    const move = Endgames.view.board.legalMoves().find((m) => moveToUci(m) === 'e5e6');
    if (!move) return 'no such move';
    onEndgameMove({ move });
    return 'played';
  });
  check('the pawn push is legal here', threw, 'played');
  await page.waitForTimeout(300);
  say('verdict after e6', await page.$eval('#endgameVerdict', (e) => e.textContent));
  check('the win is called gone', await page.$eval('#endgameVerdict', (e) => e.textContent).then((t) => t.includes('draw')), true);
  check('and the move is named', await page.$eval('#endgameOutcome', (e) => e.textContent).then((t) => t.includes('the win went')), true);

  // Take it back and the win comes back with it.
  await page.click('#endgameTakeBack');
  await page.waitForTimeout(200);
  check('take-back restores the win', await page.$eval('#endgameVerdict', (e) => e.textContent).then((t) => t.startsWith('Still winning')), true);

  // ── the correct move keeps it ─────────────────────────────────────────────
  await page.evaluate(() => {
    const move = Endgames.view.board.legalMoves().find((m) => moveToUci(m) === 'd5e6');
    if (move) onEndgameMove({ move });
  });
  await page.waitForTimeout(1400);
  say('verdict after Ke6', await page.$eval('#endgameVerdict', (e) => e.textContent));
  check('Ke6 keeps the win', await page.$eval('#endgameVerdict', (e) => e.textContent).then((t) => t.startsWith('Still winning')), true);

  // ── play one all the way through to the queen ─────────────────────────────
  //
  // The table gives the shortest win, so following it must reach a promotion
  // inside the budget and be reported as one. This is the check that the goal
  // is detected at all: a trainer that never says "you did it" is a trainer
  // nobody finishes.
  await page.evaluate(() => startEndgame(ENDGAMES.find((e) => e.id === 'king-on-the-sixth')));
  await page.waitForTimeout(300);
  for (let i = 0; i < 12; i++) {
    const done = await page.evaluate(() => {
      if (Endgames.finished) return true;
      if (Endgames.thinking || Endgames.view.locked) return false;
      const best = bestPawnMove(Endgames.view.board);
      if (!best) return true;
      const move = Endgames.view.board.legalMoves()
        .find((m) => moveFrom(m) === best.from && moveTo(m) === best.to);
      if (!move) return true;
      onEndgameMove({ move });
      return false;
    });
    if (done) break;
    await page.waitForTimeout(700);
  }
  say('outcome', await page.$eval('#endgameOutcome', (e) => e.textContent));
  check('the win is reached and reported', await page.evaluate(() => Endgames.finished), 'passed');
  check('and recorded against the position',
    await page.evaluate(() => Endgames.results['king-on-the-sixth']?.passed), true);
  check('the list shows it done',
    await page.$$eval('#endgameList .tag.good', (e) => e.length > 0), true);

  // ── vision ────────────────────────────────────────────────────────────────
  await page.evaluate(() => show('vision'));
  await page.waitForTimeout(200);
  check('vision board built', await page.$$eval('#visionBoard .sq', (e) => e.length), 64);
  await page.evaluate(() => { Vision.seconds = 3; startVision(); });
  await page.waitForTimeout(300);
  const prompt = await page.$eval('#visionPrompt', (e) => e.textContent);
  say('a question is asked', prompt);
  check('the question is real', /Tap [a-h][1-8]|Which square|light or dark/.test(prompt), true);
  // Answer whatever is asked, correctly, straight from the model.
  const scored = await page.evaluate(() => {
    const q = Vision.question;
    if (q.kind === 'find') answerVision({ square: q.square });
    else if (q.kind === 'name') answerVision({ name: 'abcdefgh'[q.square & 7] + ((q.square >> 4) + 1) });
    else answerVision({ light: (((q.square & 7) + (q.square >> 4)) % 2) === 1 });
    return Vision.score;
  });
  check('a right answer scores', scored, 1);
  await page.waitForTimeout(3200);
  check('the round ends by itself', await page.$eval('#visionStart', (e) => !e.hidden), true);
  say('summary', await page.$eval('#visionSummary', (e) => e.textContent));

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
