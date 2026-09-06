// The coach with no model to ask — which is every installed copy of this app.
//
// A plain browser has no window.claude, so this is the phone's case exactly.
// What is checked is that the answers are made of the ENGINE's facts: the
// evaluation it returned, the move it preferred, the refutation of a move the
// question named, and a line the board can actually replay.
const { launch, serve, DIST } = require('./browser.cjs');

(async () => {
  const srv = serve(DIST, 8261);
  await srv.ready;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1100 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const say = (k, v) => console.log(String(k).padEnd(30), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got) : `${got}   <- expected ${want}`);
    if (!ok) failures.push(what);
  };

  await page.goto('http://127.0.0.1:8261/hard-lines-chess-app.html');
  await page.waitForSelector('#tab-today', { timeout: 20000 });

  check('no model is reachable', await page.evaluate(() => Coach.onDevice), true);
  check('the coach is shown anyway', await page.$eval('#coachPanel', (e) => !e.hidden), true);
  check('the absent panel is not', await page.$eval('#coachAbsent', (e) => e.hidden), true);
  say('how it says it works', (await page.$eval('#coachHow', (e) => e.textContent)).slice(0, 60) + '…');

  const ask = async (fen, question) => {
    await page.evaluate((f) => { show('board'); resetPractice(f); }, fen);
    await page.waitForTimeout(200);
    await page.fill('#coachQuestion', question);
    await page.click('#coachAsk');
    await page.waitForFunction(() => !Coach.busy, { timeout: 30000 });
    await page.waitForTimeout(150);
    return page.$eval('#coachLog', (e) => e.textContent);
  };

  // ── a move the question names is searched on its own ──────────────────────
  const scholars = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
  const why = await ask(scholars, 'why not Ng5?');
  say('answer to "why not Ng5?"', why.replace(/\s+/g, ' ').slice(0, 150) + '…');
  check('it names the move asked about', why.includes('Ng5'), true);
  check('and says what answers it', /After it,/.test(why), true);
  check('and says it is on-device', why.includes('No model was asked'), true);
  check('a line is playable', await page.$$eval('#coachLog .coach-line', (e) => e.length > 0), true);

  // ── a move that cannot be played is said to be so ─────────────────────────
  const illegal = await ask(scholars, 'what about Qh6?');
  say('answer to an illegal move', illegal.replace(/\s+/g, ' ').slice(0, 130) + '…');
  check('illegal moves are named as such', /not a legal move/.test(illegal), true);

  // ── an assessment question gets the evaluation and the material ───────────
  const assess = await ask(scholars, 'am I winning?');
  check('an assessment gives material', assess.includes('Material:'), true);
  check('and a best move', assess.includes('Best is'), true);

  // ── the threat is measured, not read off the engine's own line ────────────
  //
  // Found by passing the turn — the same thing the board's Insight mode draws
  // in blue. Before this the coach answered "what is the threat?" with the
  // second move of its OWN best line, which is a reply to a move you have not
  // made yet.
  const threatened = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';
  const threat = await ask(threatened, 'what is he threatening?');
  say('answer to "threatening?"', threat.replace(/\s+/g, ' ').slice(0, 140) + '…');
  check('a threat is named as a move', /threatening [A-Za-z][a-h1-8#+=x-]+/.test(threat), true);
  check('and it is not hedged as a line', /it is the line, not a list/.test(threat), false);

  // In check there is nothing to pass the turn on, and it says so rather than
  // inventing one.
  const inCheck = await ask('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', 'what is the threat?');
  say('threat while in check', inCheck.replace(/\s+/g, ' ').slice(-90));

  // ── hanging pieces come from the board ────────────────────────────────────
  const hanging = await ask('rnbqkbnr/ppp2ppp/8/3pp3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3', 'am I winning?');
  say('assessment mentions hanging', /attacked and undefended/.test(hanging) ? 'yes' : 'no');
  check('an assessment reports what hangs', /attacked and undefended/.test(hanging), true);

  // ── a bad move is given a reason with a name ──────────────────────────────
  const named = await ask(scholars, 'why not Ng5?');
  const hasReason = /pin|fork|hang|skewer|undefended|loses|trap|back rank/i.test(named);
  say('a named move gets a reason', hasReason ? 'yes' : 'no');
  check('the reason is classified, not just scored', hasReason, true);

  // ── a finished position is stated, not analysed ───────────────────────────
  const mated = await ask('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', 'what should I play?');
  say('answer on a mated board', mated.replace(/\s+/g, ' ').slice(-120));
  check('a finished game says so', /game is over/.test(mated), true);

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
