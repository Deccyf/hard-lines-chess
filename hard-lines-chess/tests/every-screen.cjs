// Every screen, opened with real data in the store, watching for anything the
// page throws.
//
// WHAT THIS IS FOR that the other drivers are not. Each of them knows the
// screen it came to test and drives it deliberately. None of them opens all
// fourteen in one session with a store that already has games, reviews,
// puzzles, drills and endgame results in it — which is the state the app is
// actually in after a week of use, and the state in which a render function
// that assumes an empty list falls over. A page error in a single-file app is
// not a broken panel: the exception stops the rest of the handler, so the
// symptom is usually a screen that does nothing at all.
//
// The bar is zero. Any uncaught error, any failed console assertion, on any
// screen, with or without data, fails this.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');

// A game the engine really played, so review has something legal to walk.
const PGN = require('fs').readFileSync('selfplay.json', 'utf8');

(async () => {
  const srv = serve(DIST, 8279);
  await srv.ready;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [], console_errors = [], badRequests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') console_errors.push(m.text()); });
  // WITH THE URL, because "404" on its own does not say whether the app asked
  // for something it should have shipped or the throwaway server simply has no
  // favicon. Only requests the PAGE makes are the app's problem; a browser's
  // own automatic favicon fetch is not, and is the one thing excused here.
  page.on('response', (r) => { if (r.status() >= 400) badRequests.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', (r) => badRequests.push(`${r.failure()?.errorText ?? 'failed'} ${r.url()}`));
  //
  // TWO REQUESTS ARE ALLOWED TO FAIL. The browser's own favicon fetch is not
  // the app's, and the Google Fonts stylesheet is a deliberate enhancement:
  // every font it supplies has a real fallback stack behind it in head.html,
  // so the page has to render correctly without it — which is what the checks
  // above establish on a machine that cannot reach it. Anything else the page
  // asks for and does not get is a fault.
  const appsFault = (line) => !/\/favicon\.ico/.test(line) && !/fonts\.(googleapis|gstatic)\.com/.test(line);
  const say = (k, v) => console.log(String(k).padEnd(34), v);
  const failures = [];

  await page.goto('http://127.0.0.1:8279/hard-lines-chess-app.html');
  await page.waitForSelector('#tab-today', { timeout: 20000 });

  // ── round one: every screen, with nothing stored ─────────────────────────
  const sections = await page.evaluate(() => SECTIONS.map(([id]) => id));
  for (const id of sections) {
    await gotoSection(page, id);
    await page.waitForTimeout(120);
    const shown = await page.$eval('#section-' + id, (e) => !e.hidden);
    if (!shown) failures.push(`${id} did not open (empty store)`);
  }
  say('empty store: screens opened', `${sections.length}, errors ${errors.length}`);
  if (errors.length) failures.push('errors on an empty store: ' + errors.join(' | '));

  // ── round two: the same, with a week of use behind it ────────────────────
  await page.evaluate((pgnJson) => {
    const pgn = JSON.parse(pgnJson).pgn;
    const now = Date.now();
    const day = 86400000;
    App.history.games = [0, 1, 2, 3, 4].map((i) => ({
      at: now - i * day, band: 800 + i * 100, colour: i % 2 ? 'black' : 'white',
      result: ['w', 'd', 'l'][i % 3], plies: 40, takebacks: i, control: 'none', pgn,
    }));
    App.history.bands = { 800: { w: 2, d: 1, l: 1 }, 1200: { w: 0, d: 0, l: 3 } };
    App.reviews.games = [0, 1, 2].map((i) => ({
      at: now - i * day, white: 'You', black: 'Them', result: '1-0', side: 'white',
      accuracy: 70 + i, meanLoss: 60 - i * 5, plies: 40, elo: 900, pgn,
      mistakes: [{ ply: 9, san: 'Qh5', kind: 'material', loss: 320, cls: 'blunder', best: { san: 'Nf3', uci: 'g1f3' }, fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2' }],
    }));
    App.puzzles.items = [{
      fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
      best: { uci: 'a1a8', san: 'Ra8#' }, mate: 1, label: 'the 1200 band', line: 'Ra8#',
      card: { interval: 0, ease: 2.5, due: 0, lapses: 0, seen: 0 },
    }];
    App.drills.items = [{
      fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
      best: { uci: 'g1f3', san: 'Nf3' }, played: 'Qh5', loss: 320,
      card: { interval: 0, ease: 2.5, due: 0, lapses: 0, seen: 0 },
    }];
    App.openings.cards = { 'italian-game': { interval: 1, ease: 2.5, due: 0, lapses: 0, seen: 3 } };
    Endgames.results = { 'two-rooks': { passed: true, moves: 8, at: now } };
    Storm.best = { score: 7, at: now, solved: 7, missed: 2, streak: 4 };
    Vision.best = { 'mixed:white': 19 };
  }, PGN);

  errors.length = 0;
  for (const id of sections) {
    await gotoSection(page, id);
    await page.waitForTimeout(200);
    const shown = await page.$eval('#section-' + id, (e) => !e.hidden);
    if (!shown) failures.push(`${id} did not open (with data)`);
    if (errors.length) { failures.push(`${id}: ${errors.join(' | ')}`); errors.length = 0; }
  }
  say('with data: screens opened', `${sections.length}`);

  // ── and the panels that only render when asked ───────────────────────────
  await page.evaluate(() => { renderToday(); renderProgress(); renderPuzzles(); renderDrills(); renderOpenings(); renderEndgames(); renderWatchList(); renderNotationLessons(); renderStorm(); renderVision(); renderSettings(); });
  await page.waitForTimeout(300);
  say('every render function ran', errors.length === 0 ? 'clean' : errors.join(' | '));
  if (errors.length) failures.push('render: ' + errors.join(' | '));

  // A couple of counts, so this is not only an error watch: a Today list that
  // renders zero rows with five games stored is a silent failure.
  const today = await page.$$eval('#todayList .task, #todayList > *', (r) => r.length);
  say('Today has rows', String(today));
  if (today === 0) failures.push('Today rendered nothing with data in the store');
  const progress = await page.evaluate(() => document.getElementById('section-progress').innerText.length);
  say('Progress has text', String(progress));
  if (progress < 200) failures.push('Progress rendered almost nothing with data in the store');

  say('requests that failed', badRequests.length ? badRequests.join(' | ') : 'none');
  const ours = badRequests.filter(appsFault);
  if (ours.length) failures.push('the page asked for something it did not get: ' + ours.join(' | '));
  // Console errors that are not one of those requests being reported twice.
  const realConsole = console_errors.filter((line) => !/Failed to load resource/.test(line));
  say('console errors', realConsole.length ? realConsole.join(' | ') : 'none');
  if (realConsole.length) failures.push('console errors');

  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
