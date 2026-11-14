// The human-like opponent on the Play screen, in a browser, against the real
// networks.
//
// tests/maia.test.mjs holds the sums and the drawing to their rules. This is
// the page: that the opponent it offers is the network it names, shown the
// game that is actually on the board — all of it, not just the position — and
// that a game against it is recorded as what it was.
//
// EVERY REPLY IS CHECKED AGAINST THE SAME NETWORK RUN HERE, outside the page,
// on the moves the page says were played. The page could answer with a legal,
// sensible move from the wrong network, or from the right one shown only the
// last position, and nothing on the screen would look wrong; a reply that is
// the one the network gives for this game, at this draw, is the only thing
// that rules both out. One check below exists to prove that it would: it
// finds a move where the history changes the answer.
//
// What has to be true:
//
//   - where there are networks beside the page, the list of levels has two
//     groups, the ladder first; the first choice is still a ladder level; and
//     the notes say what the new levels are and what their number is not;
//   - choosing one fetches its network, says so while it does, and starts a
//     game; the panel beside the board stops calling itself an evaluation;
//   - its reply is the network's, for the game so far and the draw it was
//     given — at the likeliest end of the draw and at the other — and the
//     panel says what share of such players make that move; it does not come
//     before the player's own piece has arrived; and a reply, or a failure,
//     that belongs to a game since replaced is not delivered to the new one;
//   - from a set-up position, and after a take-back, it is shown the game
//     that is now on the board;
//   - as Black, it moves first;
//   - a finished game is saved as against that level, counted in a record of
//     its own and never in the ladder's, and named as what it was on Today
//     and on Progress; a set-up game is saved and not counted; a coach game
//     is kept with the coach's games;
//   - changing the level in the middle of a game asks first, and saying no
//     leaves the list showing the opponent still being played;
//   - a network that cannot be fetched, or is not a network, is said — the
//     board is not left locked, and the next game tries again; one that is
//     only slow is said to be on its way, not to be thinking;
//   - with no networks beside the page there is no such group and no such
//     note, and a game played against one, restored from a backup, is still
//     named;
//   - a backup carries the record, and one whose record is not a record is
//     refused;
//   - a copy of the page opened from a file, which has nothing beside it, is
//     the ladder alone;
//   - and the installed website keeps a network once it has fetched it — in a
//     cache of its own, not the app's — so that it is there with no
//     connection and is still there after the app has been updated.
const { launch, serve, app, DIST, gotoSection } = require('./browser.cjs');
const fs = require('fs');
const path = require('path');

const PORT = 8345;
const base = `http://127.0.0.1:${PORT}/`;
const ROOT = path.resolve(__dirname, '..');

// The same text the page runs, run here.
const src = ['src/engine/bundle.js', 'src/notation.js', 'src/pgn.js', 'src/maia-net.js', 'src/maia.js']
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const S = new Function('window', 'localStorage', src
  + '; return { Board, moveToUci, toSan, maiaUnpack, maiaReadNet, maiaForward, maiaPlanes, maiaChances, maiaChoose };')({}, undefined);
const nets = {};
const netFor = async (level) => (nets[level] ??= S.maiaReadNet(await S.maiaUnpack(fs.readFileSync(path.join(ROOT, 'vendor/maia', `maia-${level}.pb.gz`)))));
/** The positions of a game, from its start and its moves. */
const positions = (from, ucis) => {
  const board = new S.Board(from ?? undefined);
  const fens = [board.fen()];
  for (const uci of ucis) { board.make(board.legalMoves().find((m) => S.moveToUci(m) === uci)); fens.push(board.fen()); }
  return { board, fens };
};
/** What the network of this level plays in this game, at this draw; `bare` shows it the last position alone. */
const reply = async (level, from, ucis, draw, { bare = false } = {}) => {
  const { board, fens } = positions(from, ucis);
  const chances = S.maiaChances(board, S.maiaForward(await netFor(level), S.maiaPlanes(bare ? fens.slice(-1) : fens)));
  const chosen = S.maiaChoose(chances, () => draw);
  return { uci: chosen.uci, share: `${Math.max(1, Math.round(chosen.chance * 100))}%`, among: chosen.among, likeliest: chances[0].uci };
};

const MID = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
// Progress says nothing until a game has been analysed, so there is one.
const ANALYSED = { at: 5, white: 'You', black: 'Them', result: '1-0', side: 'white', accuracy: 80, plies: 60, meanLoss: 40, depth: 7, judge: 'app',
  pgn: '1. d4 d5', tactics: 0, estimate: null, mistakes: [] };

(async () => {
  const srv = serve(path.join(DIST, 'pwa'), PORT);
  await srv.ready;
  const browser = await launch();
  const say = (k, v) => console.log(String(k).padEnd(78), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    say(what, ok ? String(typeof got === 'string' ? got : JSON.stringify(got)).slice(0, 120)
      : `${JSON.stringify(got).slice(0, 600)}   <- expected ${JSON.stringify(want).slice(0, 600)}`);
    if (!ok) failures.push(what);
  };
  const errors = [];

  /** A page with the draw in the test's hands, and every dialog answered as `answers.confirm` says. */
  const open = async (setUp = async () => {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 1300 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const answers = { confirm: true, asked: [] };
    page.on('dialog', (d) => { answers.asked.push(d.message()); return answers.confirm ? d.accept() : d.dismiss(); });
    await page.addInitScript(() => { window.__draw = 0; Math.random = () => window.__draw; });
    await setUp(page);
    await page.goto(base);
    await page.waitForSelector('#tab-today', { timeout: 20000 });
    await page.waitForFunction(() => typeof Human !== 'undefined' && Human.about !== undefined, null, { timeout: 20000 });
    await gotoSection(page, 'play');
    return { page, ctx, answers };
  };
  const draw = (page, value) => page.evaluate((v) => { window.__draw = v; }, value);
  const played = (page) => page.evaluate(() => Play.moves.map((m) => m.uci));
  /** Make a move on the board and wait for the answer to it. Comes back with the moves before the answer, and the answer. */
  const move = async (page, from, to) => {
    const before = await page.evaluate(() => Play.moves.length);
    await page.click(`#playBoard .sq[aria-label="${from}"]`);
    // Timed in the page, from the move being made to the answer being on the board.
    await page.evaluate((n) => {
      window.__answered = null;
      const began = performance.now();
      const watch = () => { if (Play.moves.length >= n + 2) window.__answered = performance.now() - began; else if (!Play.fault && !Play.over) requestAnimationFrame(watch); };
      const start = () => { if (Play.moves.length >= n + 1) watch(); else requestAnimationFrame(start); };
      start();
    }, before);
    await page.click(`#playBoard .sq[aria-label="${to}"]`);
    await page.waitForFunction((n) => (Play.moves.length === n + 2 && !Play.thinking) || Play.fault || Play.over, before, { timeout: 30000 });
    const all = await played(page);
    return { mine: all.slice(0, before + 1), theirs: all[before + 1] ?? null, readout: await page.$eval('#playEval', (e) => e.textContent), ms: await page.evaluate(() => window.__answered) };
  };
  const groups = (page) => page.$$eval('#bandSelect optgroup', (g) => g.map((x) => `${x.label}: ${x.children.length}`));

  // ── A: the list ──────────────────────────────────────────────────────────
  let { page, ctx, answers } = await open();
  check('A: with networks beside the page the list has two groups, the ladder first', await groups(page),
    ['The ladder: this app\'s engine: 22', 'Plays like a person: 9']);
  check('A: the nine are named for the players they learned from', await page.$$eval('#bandSelect optgroup:nth-child(2) option', (o) => o.map((x) => `${x.value}=${x.textContent}`)),
    [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900].map((l) => `human-${l}=Human-like ${l}`));
  check('A: the level chosen to begin with is still one of the ladder\'s', await page.evaluate(() => [document.getElementById('bandSelect').value, Play.band.maia ?? null]), ['400', null]);
  check('A: "About the levels" says what the new ones are, and whose', await page.$eval('#humanAbout', (e) => [e.hidden, e.textContent.includes('Maia project'), e.textContent.includes('not a Chess.com number'), e.textContent.includes('GPL-3.0')]),
    [false, true, true, true]);
  check('A: against the ladder the panel beside the board is the engine\'s evaluation', await page.$eval('#playEvalTitle', (e) => e.textContent), 'Evaluation');
  check('A: nothing has been fetched that was not asked for', await page.evaluate(() => [...Human.state.keys()]), []);

  // ── B: choosing one ──────────────────────────────────────────────────────
  // Held back a moment, so that "Fetching it…" is there to be read.
  await ctx.route('**/maia-1100.bin', async (route) => { await new Promise((r) => setTimeout(r, 500)); await route.continue(); });
  await page.selectOption('#bandSelect', 'human-1100');
  check('B: choosing a human-like level makes it the opponent of a new game', await page.evaluate(() => [Play.band.maia, Play.game.band.maia, Play.moves.length]), [1100, 1100, 0]);
  check('B: the note says what it is, what its number is not, and that it is being fetched', await page.$eval('#bandNote', (e) => e.textContent),
    'Plays the moves that players rated about 1100 on Lichess play — it learned from their games, mistakes included, and does not calculate. The number is theirs, on Lichess\'s scale, not a strength measured for it. Fetching it…');
  await page.waitForFunction(() => Human.state.get(1100) === 'ready', null, { timeout: 20000 });
  check('B: and stops saying so when it has been', (await page.$eval('#bandNote', (e) => e.textContent)).endsWith('not a strength measured for it.'), true);
  check('B: the panel beside the board is no longer called an evaluation', await page.evaluate(() => ['playEvalTitle', 'playEvalKey', 'playEval'].map((id) => document.getElementById(id).textContent)),
    ['Its last move', 'Players like it who play that move', '—']);
  check('B: and says why', (await page.$eval('#playEvalNote', (e) => e.textContent)).startsWith('This opponent does not weigh the position up, so there is no evaluation.'), true);
  check('B: only the network asked for was fetched', await page.evaluate(() => [...Human.state.keys()]), [1100]);
  check('B: the list drawn again still shows it chosen', await page.evaluate(() => { renderBandPicker(); return document.getElementById('bandSelect').value; }), 'human-1100');

  // ── C: its replies are the network's ─────────────────────────────────────
  let m = await move(page, 'e2', 'e4');
  let want = await reply(1100, null, m.mine, 0);
  check('C: at the likeliest end of the draw, the reply to 1.e4 is the network\'s likeliest move', [m.theirs, want.uci === want.likeliest], [want.uci, true]);
  check('C: which for players of 1100 is the king\'s pawn', m.theirs, 'e7e5');
  check('C: and the panel says what share of them play it', m.readout, want.share);
  say('   (the reply came after)', `${Math.round(m.ms)} ms`);
  check('C: the reply does not come before the player\'s own piece has arrived', m.ms >= 400, true);
  check('C: the status names the opponent while it waits', await page.evaluate(() => { Play.thinking = true; renderPlayStatus(); const t = document.getElementById('playBody').textContent; Play.thinking = false; renderPlayStatus(); return t; }),
    'Human-like 1100 is choosing a move.');

  m = await move(page, 'g1', 'f3');
  want = await reply(1100, null, m.mine, 0);
  check('C: the reply to the next move is the network\'s too', [m.theirs, m.readout], [want.uci, want.share]);

  await draw(page, 0.999);
  m = await move(page, 'f1', 'c4');
  want = await reply(1100, null, m.mine, 0.999);
  check('C: at the other end of the draw it is the last of the likely moves, and not the likeliest', [m.theirs, m.readout, want.uci !== want.likeliest, want.among > 1],
    [want.uci, want.share, true, true]);

  // The history is part of what the network is shown. Somewhere in these few
  // moves, showing it the last position alone gives a different answer — or
  // this test could not tell a page that did that from one that did not.
  await draw(page, 0);
  let historyMatters = false;
  for (const [from, to] of [['d2', 'd3'], ['b1', 'c3'], ['c1', 'g5'], ['e1', 'g1']]) {
    m = await move(page, from, to);
    if (!m.theirs) break;
    want = await reply(1100, null, m.mine, 0);
    const bare = await reply(1100, null, m.mine, 0, { bare: true });
    if (bare.uci !== want.uci || bare.share !== want.share) historyMatters = true;
    check(`C: after ${m.mine.length} moves the reply is the network's for the whole game so far`, [m.theirs, m.readout], [want.uci, want.share]);
  }
  check('C: (and for at least one of those, the game so far gives a different answer from the position alone)', historyMatters, true);

  // ── D: a take-back, and a set-up position ────────────────────────────────
  await page.click('#playTakeback');
  const afterBack = await played(page);
  m = await move(page, 'h2', 'h3');
  want = await reply(1100, null, m.mine, 0);
  check('D: after a take-back it is shown the game as it now stands', [m.mine.length, m.mine.slice(0, -1), m.theirs, m.readout], [afterBack.length + 1, afterBack, want.uci, want.share]);

  await page.evaluate((fen) => newPlayGame(fen), MID);
  m = await move(page, 'd2', 'd3');
  want = await reply(1100, MID, m.mine, 0);
  const asIfFromTheStart = await reply(1100, null, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'd2d3'], 0);
  check('D: from a set-up position the reply is the network\'s for that game', [m.theirs, m.readout], [want.uci, want.share]);
  say('   (the same position reached by its moves would have been answered)', `${asIfFromTheStart.uci} ${asIfFromTheStart.share}`);

  // ── E: as Black, it moves first ──────────────────────────────────────────
  answers.confirm = true;
  await page.click('#asBlack');
  await page.waitForFunction(() => Play.moves.length === 1 && !Play.thinking, null, { timeout: 30000 });
  want = await reply(1100, null, [], 0);
  check('E: as Black, the opponent opens — with the network\'s first move', [await played(page), await page.$eval('#playEval', (e) => e.textContent)], [[want.uci], want.share]);
  check('E: which is the king\'s pawn', want.uci, 'e2e4');
  await page.click('#asWhite');

  // A reply already on its way when a new game is started belongs to the old one.
  await page.click('#playBoard .sq[aria-label="e2"]');
  await page.click('#playBoard .sq[aria-label="e4"]');
  await page.click('#playNew');
  await page.waitForTimeout(1200);
  check('E: a reply that was on its way when a new game was started is not played onto the new board',
    await page.evaluate(() => [Play.moves.length, Play.thinking, document.getElementById('playHead').textContent]), [0, false, 'Your move']);

  // ── F: a finished game is recorded as what it was ────────────────────────
  await page.evaluate(() => { App.history.bands[800] = { w: 2, d: 0, l: 1 }; });
  await move(page, 'e2', 'e4');
  await page.click('#playResign');
  await page.waitForFunction(() => Play.over, null, { timeout: 10000 });
  await page.waitForTimeout(200);
  const kept = await page.evaluate(() => { const g = App.history.games.at(-1); return { maia: g.maia, band: 'band' in g, result: g.result, plies: g.plies, colour: g.colour, pgn: g.pgn }; });
  check('F: a game against it is saved as against that level, and not as against any level of the ladder', kept,
    { maia: 1100, band: false, result: 'l', plies: 2, colour: 'white', pgn: '1. e4 e5' });
  check('F: it is counted in a record of its own, and the ladder\'s record is as it was',
    await page.evaluate(() => [App.history.maia, App.history.bands]), [{ 1100: { w: 0, d: 0, l: 1 } }, { 800: { w: 2, d: 0, l: 1 } }]);
  await gotoSection(page, 'today');
  check('F: Today\'s record lists it under its own name, after the ladder',
    await page.$$eval('#todayRecord .record-row', (rows) => rows.map((r) => r.textContent.replace(/\s+/g, ' ').trim())), ['800–900 2W 0D 1L', 'Human-like 1100 0W 0D 1L']);
  await page.evaluate((g) => { App.reviews.games = [g]; }, ANALYSED);
  await gotoSection(page, 'progress');
  const listed = await page.$$eval('#progressOut .panel', (panels) => {
    const p = panels.find((x) => x.querySelector('h3')?.textContent === 'Games against the computer');
    return p ? p.querySelector('.record-row').textContent.replace(/\s+/g, ' ').trim() : null;
  });
  check('F: and Progress names it', / · the human-like 1100 · as white Lost · 1 moves$/.test(listed ?? ''), true);

  check('F: and so do the two other places a game against the computer is named',
    await page.evaluate(() => {
      App.history.games.push({ at: 77, maia: 1100, colour: 'white', result: 'w', plies: 8, from: null, takebacks: 0, control: 'none', pgn: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6' });
      const out = [scannableGames().find((g) => g.at === 77)?.label, deviationGames().find((g) => g.at === 77)?.label];
      App.history.games.pop();
      return out;
    }), ['the human-like 1100 opponent', 'against the human-like 1100']);

  // THE GAME JUST SAVED IS NOW ONE OF "YOUR OWN GAMES", and with the book on
  // the next reply to 1.e4 would come out of it — 1...e5, "from your games" —
  // whoever the opponent was. That is the book doing its job; it is turned
  // off here so that what answers below is the opponent.
  await gotoSection(page, 'play');
  check('F: (the saved game has gone into the book of your own games, which is then turned off for what follows)',
    await page.evaluate(() => [document.getElementById('bookToggle').disabled, Play.useBook]), [false, true]);
  await page.uncheck('#bookToggle');

  // A set-up game is saved, and not counted.
  await page.evaluate((fen) => newPlayGame(fen), MID);
  await move(page, 'd2', 'd3');
  await page.click('#playResign');
  await page.waitForFunction(() => Play.over, null, { timeout: 10000 });
  await page.waitForTimeout(200);
  check('F: a game from a set-up position is saved as against that level, and not counted',
    await page.evaluate((fen) => { const g = App.history.games.at(-1); return [g.maia, g.from === fen, App.history.maia[1100]]; }, MID), [1100, true, { w: 0, d: 0, l: 1 }]);

  // A coach game is kept with the coach's games.
  await page.check('#teachToggle');
  await move(page, 'e2', 'e4');
  await page.click('#playResign');
  await page.waitForFunction(() => Play.over, null, { timeout: 10000 });
  await page.waitForTimeout(200);
  check('F: a coach game against it is kept with the coach\'s games, as against that level, and not counted',
    await page.evaluate(() => { const g = App.teaching.games.at(-1); return [g.maia, 'band' in g, App.history.maia[1100]]; }), [1100, false, { w: 0, d: 0, l: 1 }]);
  await page.uncheck('#teachToggle');

  // ── G: changing the level in the middle of a game ────────────────────────
  await move(page, 'd2', 'd4');
  answers.confirm = false;
  answers.asked.length = 0;
  await page.selectOption('#bandSelect', '1500');
  check('G: changing the level mid-game asks first', answers.asked.length, 1);
  check('G: and saying no leaves the list showing the opponent still being played',
    await page.evaluate(() => [document.getElementById('bandSelect').value, Play.game.band.maia, Play.band.maia, Play.moves.length]), ['human-1100', 1100, 1100, 2]);
  answers.confirm = true;
  await page.selectOption('#bandSelect', '1500');
  check('G: saying yes goes back to the ladder, panel and all',
    await page.evaluate(() => [Play.game.band.elo, Play.game.band.maia ?? null, document.getElementById('playEvalTitle').textContent, document.getElementById('bandNote').textContent.startsWith('looks ')]),
    [1500, null, 'Evaluation', true]);
  m = await move(page, 'e2', 'e4');
  check('G: and the ladder\'s level answers as it always did, with an evaluation', [m.theirs !== null, /^[+-]?\d|mate|blundered/.test(m.readout)], [true, true]);
  await page.click('#playResign');
  await page.waitForFunction(() => Play.over, null, { timeout: 10000 });
  await page.waitForTimeout(200);
  check('G: a game against the ladder is kept and counted as it always was, and the human-like record is left alone',
    await page.evaluate(() => { const g = App.history.games.at(-1); return [g.band, 'maia' in g, App.history.bands[1500], App.history.maia]; }),
    [1500, false, { w: 0, d: 0, l: 1 }, { 1100: { w: 0, d: 0, l: 1 } }]);

  // ── H: a network that cannot be had ──────────────────────────────────────
  let serve1300 = 'missing';
  await ctx.route('**/maia-1300.bin', (route) => {
    if (serve1300 === 'missing') return route.fulfill({ status: 404, body: '' });
    if (serve1300 === 'slow') return new Promise((done) => setTimeout(done, 700)).then(() => route.fulfill({ status: 404, body: '' }));
    if (serve1300 === 'noise') return route.fulfill({ status: 200, body: Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 31 + 7) % 256)) });
    return route.continue();
  });
  await page.selectOption('#bandSelect', 'human-1300');
  await page.waitForFunction(() => Human.state.get(1300) === 'failed', null, { timeout: 20000 });
  check('H: a network that cannot be fetched is said under the list', (await page.$eval('#bandNote', (e) => e.textContent)).endsWith(' It could not be fetched just now; starting a game tries again.'), true);
  await move(page, 'e2', 'e4');
  check('H: a move that needs it says what happened, by name',
    await page.evaluate(() => [document.getElementById('playHead').textContent, document.getElementById('playBody').textContent]),
    ['The opponent could not move', 'Human-like 1300 could not be made ready: its file could not be fetched (the answer was 404). Start a new game to try again, or choose a level from the ladder.']);
  check('H: and the board is not left locked or waiting', await page.evaluate(() => [Play.thinking, Play.view.locked, Play.moves.length]), [false, false, 1]);

  // A failure already on its way when a new game is started belongs to the old one.
  serve1300 = 'slow';
  await page.click('#playNew');
  await page.waitForFunction(() => Human.state.get(1300) === 'failed', null, { timeout: 20000 });
  await page.click('#playBoard .sq[aria-label="e2"]');
  await page.click('#playBoard .sq[aria-label="e4"]');
  await page.click('#playNew');
  await page.waitForFunction(() => Human.state.get(1300) === 'failed', null, { timeout: 20000 });
  await page.waitForTimeout(300);
  check('H: a failure that was on its way when a new game was started is not blamed on the new one',
    await page.evaluate(() => [Play.fault, Play.moves.length, document.getElementById('playHead').textContent]), [null, 0, 'Your move']);

  serve1300 = 'noise';
  await page.click('#playNew');
  await move(page, 'e2', 'e4');
  check('H: a file that is not a network is refused as one', (await page.$eval('#playBody', (e) => e.textContent)).startsWith('Human-like 1300 could not be made ready: not a network this app can run'), true);

  serve1300 = 'real';
  await page.click('#playNew');
  m = await move(page, 'e2', 'e4');
  want = await reply(1300, null, m.mine, 0);
  check('H: and the next game tries again, and plays', [m.theirs, m.readout, await page.evaluate(() => Human.state.get(1300))], [want.uci, want.share, 'ready']);

  // A network that is slow to arrive is not "thinking". The first time a level
  // is used on the website its file is still on its way when the first move
  // is made, and the status says that rather than counting seconds of thought.
  await ctx.route('**/maia-1700.bin', async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.continue(); });
  await page.selectOption('#bandSelect', 'human-1700');
  await page.click('#playBoard .sq[aria-label="e2"]');
  await page.click('#playBoard .sq[aria-label="e4"]');
  await page.waitForFunction(() => Play.thinking && Play.thinkingFor >= 1, null, { timeout: 10000 });
  check('H: a move made while the network is still on its way says it is being fetched, not that it is thinking',
    await page.evaluate(() => [Human.state.get(1700), document.getElementById('playHead').textContent, document.getElementById('playBody').textContent]),
    ['fetching', 'Fetching', 'Human-like 1700 is being fetched; it will move as soon as it is here.']);
  await page.waitForFunction(() => Play.moves.length === 2 && !Play.thinking, null, { timeout: 30000 });
  want = await reply(1700, null, ['e2e4'], 0);
  check('H: and it moves when it arrives', [(await played(page))[1], await page.$eval('#playEval', (e) => e.textContent), await page.$eval('#playHead', (e) => e.textContent)], [want.uci, want.share, 'Your move']);

  // ── I: a backup carries the record ───────────────────────────────────────
  const backup = await page.evaluate(() => {
    const made = buildBackup();
    const back = readBackup(made.text);
    const spoiled = JSON.parse(made.text);
    const history = Store.unwrap(spoiled.areas.history).payload;
    history.maia = 7;
    return { ok: back.ok, maia: Store.unwrap(back.file.areas.history).payload.maia, games: Store.unwrap(back.file.areas.history).payload.games.filter((g) => g.maia).length,
      spoiled: readBackup(JSON.stringify(spoiled)).why ?? 'accepted', text: made.text };
  });
  check('I: a backup carries the human-like record and the games against it', [backup.ok, backup.maia, backup.games], [true, { 1100: { w: 0, d: 0, l: 1 } }, 2]);
  check('I: and one whose record is not a record is refused', backup.spoiled, 'That backup is damaged: its history are not in the shape this app writes. Nothing was changed.');
  await ctx.close();

  // ── J: no networks beside the page ───────────────────────────────────────
  for (const [how, answer] of [['a list with nothing on it', { status: 200, contentType: 'application/json', body: '{"format": 1, "levels": []}' }], ['no list at all', { status: 404, body: '' }],
    ['a list that is not one', { status: 200, contentType: 'application/json', body: '{"format": 2, "levels": [{"level": 1500, "file": "maia-1500.bin"}]}' }],
    ['a list naming a file somewhere else', { status: 200, contentType: 'application/json', body: '{"format": 1, "levels": [{"level": 1500, "file": "../elsewhere/maia-1500.bin"}]}' }]]) {
    ({ page, ctx, answers } = await open(async (p) => { await p.context().route('**/maia.json', (route) => route.fulfill(answer)); }));
    check(`J: with ${how}, the list is the ladder alone, under no heading`,
      [await groups(page), await page.$$eval('#bandSelect > option', (o) => o.length), await page.$eval('#humanAbout', (e) => e.hidden)], [[], 22, true]);
    if (how === 'a list with nothing on it') {
      // A history made where there were networks, restored here.
      const restored = await page.evaluate(([text, analysed]) => {
        const back = readBackup(text);
        App.history = Store.unwrap(back.file.areas.history).payload;
        App.reviews.games = [analysed];
        renderToday();
        show('progress');
        const panel = [...document.querySelectorAll('#progressOut .panel')].find((x) => x.querySelector('h3')?.textContent === 'Games against the computer');
        return { today: [...document.querySelectorAll('#todayRecord .record-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
          rows: [...panel.querySelectorAll('.record-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim().replace(/^\S+ · /, '')) };
      }, [backup.text, ANALYSED]);
      check('J: games played against a network elsewhere are still named here', [restored.today.includes('Human-like 1100 0W 0D 1L'), restored.rows.filter((r) => r.startsWith('the human-like 1100 · ')).length], [true, 2]);
      check('J: a value from the list that names a level this copy does not have falls back to the ladder', await page.evaluate(() => [opponentFor('human-1500').elo, opponentFor('human-x').elo, opponentFor('700').elo]), [0, 0, 700]);
    }
    await ctx.close();
  }

  // A list out of order is put in order: the list on the screen climbs.
  ({ page, ctx, answers } = await open(async (p) => {
    await p.context().route('**/maia.json', (route) => route.fulfill({ status: 200, contentType: 'application/json',
      body: '{"format": 1, "levels": [{"level": 1500, "file": "maia-1500.bin"}, {"level": 1100, "file": "maia-1100.bin"}, {"level": "1300", "file": "maia-1300.bin"}]}' }));
  }));
  check('J: a list out of order, with an entry that is not a level, is the levels it can read, lowest first',
    await page.$$eval('#bandSelect option[value^="human-"]', (o) => o.map((x) => x.value)), ['human-1100', 'human-1500']);
  await ctx.close();

  // ── K: opened from a file ────────────────────────────────────────────────
  {
    const fileCtx = await browser.newContext({ viewport: { width: 1100, height: 1300 } });
    const filePage = await fileCtx.newPage();
    filePage.on('pageerror', (e) => errors.push(e.message));
    await filePage.goto(app());
    await filePage.waitForSelector('#tab-today', { timeout: 20000 });
    await filePage.waitForFunction(() => Human.about !== undefined, null, { timeout: 20000 });
    check('K: a copy opened from a file has the ladder alone, and asks for nothing', await filePage.evaluate(() => [Human.about, document.querySelectorAll('#bandSelect optgroup').length, document.querySelectorAll('#bandSelect option').length]), [null, 0, 22]);
    await fileCtx.close();
  }

  // ── L: the installed website keeps a network it has fetched ──────────────
  {
    // A copy of the kit, so that its worker can be given a new version
    // without touching dist/. Not Reckless: 44 MB that this has no use for.
    const site = path.join(__dirname, 'output', 'maia-site');
    fs.rmSync(site, { recursive: true, force: true });
    fs.mkdirSync(site, { recursive: true });
    fs.cpSync(path.join(DIST, 'pwa'), site, { recursive: true, filter: (from) => !from.includes(`${path.sep}reckless`) || from.endsWith('reckless-worker.js') });
    // An ordinary file the worker has never seen, to see where it puts one.
    fs.writeFileSync(path.join(site, 'notes.txt'), 'not a network');
    const kit = serve(site, PORT + 1);
    await kit.ready;
    const kitBase = `http://127.0.0.1:${PORT + 1}/`;
    const kitCtx = await browser.newContext({ viewport: { width: 1100, height: 1300 } });
    const kitPage = await kitCtx.newPage();
    kitPage.on('pageerror', (e) => errors.push(e.message));
    const up = async () => {
      await kitPage.waitForSelector('#tab-today', { timeout: 20000 });
      await kitPage.waitForFunction(() => typeof Human !== 'undefined' && Human.about !== undefined, null, { timeout: 20000 });
      await gotoSection(kitPage, 'play');
    };
    const kept = () => kitPage.evaluate(async () => {
      const out = {};
      for (const key of await caches.keys()) out[key] = (await (await caches.open(key)).keys()).map((r) => new URL(r.url).pathname.slice(1)).sort();
      return out;
    });
    await kitPage.goto(kitBase);
    await kitPage.evaluate(() => navigator.serviceWorker.ready);
    // Again, so that the worker is in charge of this page's requests.
    await kitPage.reload();
    await up();
    await kitPage.selectOption('#bandSelect', 'human-1200');
    await kitPage.waitForFunction(() => Human.state.get(1200) === 'ready', null, { timeout: 20000 });
    await kitPage.waitForFunction(async () => (await caches.keys()).includes('human-like-networks') && (await (await caches.open('human-like-networks')).keys()).length === 1, null, { timeout: 20000 });
    await kitPage.evaluate(() => fetch('notes.txt').then((r) => r.text()));
    await kitPage.waitForFunction(async () => { for (const key of await caches.keys()) if (await (await caches.open(key)).match('notes.txt')) return true; return false; }, null, { timeout: 20000 });
    const before = await kept();
    const appCache = Object.keys(before).find((k) => k.startsWith('hard-lines-'));
    check('L: a network that has been fetched is kept in a cache of its own, which holds nothing else', before['human-like-networks'], ['maia-1200.bin']);
    check('L: and the app\'s own cache has the list of levels, and no network', before[appCache].filter((n) => n.startsWith('maia')), ['maia.json']);
    check('L: (which is where the rest of the app is, and where any other file it fetches goes)', ['index.html', 'stockfish.wasm', 'notes.txt'].every((n) => before[appCache].includes(n)), true);

    await kitCtx.setOffline(true);
    await kitPage.reload();
    await up();
    await kitPage.selectOption('#bandSelect', 'human-1200');
    await kitPage.waitForFunction(() => Human.state.get(1200) !== 'fetching', null, { timeout: 20000 });
    check('L: with no connection the levels are still listed, and the network already fetched is still there',
      await kitPage.evaluate(() => [document.querySelectorAll('#bandSelect option[value^="human-"]').length, Human.state.get(1200)]), [9, 'ready']);
    await kitPage.selectOption('#bandSelect', 'human-1500');
    await kitPage.waitForFunction(() => Human.state.get(1500) !== 'fetching', null, { timeout: 20000 });
    check('L: and one that never was is said to be out of reach', [await kitPage.evaluate(() => Human.state.get(1500)), (await kitPage.$eval('#bandNote', (e) => e.textContent)).endsWith('It could not be fetched just now; starting a game tries again.')],
      ['failed', true]);
    await kitCtx.setOffline(false);

    // A new version of the app: the worker throws its old cache away.
    const sw = fs.readFileSync(path.join(site, 'sw.js'), 'utf8');
    fs.writeFileSync(path.join(site, 'sw.js'), sw.replace(/const VERSION = '[^']+'/, "const VERSION = 'hard-lines-next-version'"));
    await kitPage.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration.update();
      const next = registration.installing ?? registration.waiting ?? registration.active;
      await new Promise((done) => {
        if (next.state === 'activated') { done(); return; }
        next.addEventListener('statechange', () => { if (next.state === 'activated') done(); });
      });
    });
    const after = await kept();
    check('L: after an update of the app its old cache is gone', [appCache in after, 'hard-lines-next-version' in after], [false, true]);
    check('L: and the network is still kept, and does not have to be fetched again', after['human-like-networks'], ['maia-1200.bin']);
    await kitCtx.close();
    kit.stop();
  }

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
