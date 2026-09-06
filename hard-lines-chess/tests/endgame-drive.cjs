// The endgame trainer, driven. Checks the two things that matter and that no
// unit test can see: that the screen wires up at all, and that the running
// verdict changes on the move the win actually goes.
const { launch, serve, DIST } = require('./browser.cjs');

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

  // The tab exists and opens.
  const tabs = await page.$$eval('#tabs .tab', (els) => els.map((e) => e.textContent));
  check('Endgames tab present', tabs.includes('Endgames'), true);
  check('Vision tab present', tabs.includes('Vision'), true);

  await page.evaluate(() => show('endgames'));
  await page.waitForTimeout(200);
  const listed = await page.$$eval('#endgameList .endgame-row', (els) => els.length);
  check('endgames listed', listed, 8);

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
