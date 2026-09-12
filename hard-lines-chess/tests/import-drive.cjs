// Bringing games in from Chess.com, with Chess.com stood in for.
//
// THE REAL API IS NOT CALLED HERE, and that is deliberate rather than
// convenient: a test that fetched somebody's actual games would pass or fail
// on whether a stranger played chess this month, would be different every run,
// and would make the suite depend on a website being up. The stub answers with
// the shapes the API really returns — including the ones that break things: a
// Chess960 game, a game with no moves, a game the named player is not in, and
// a month that has already been imported.
//
// What is being checked is everything between the response and the store:
// which games are kept, which are refused and why, that a second import of the
// same month adds nothing, that a 404 is a sentence rather than a stack trace,
// and that the repertoire report can see the games the moment they land.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');
// A real, complete game the app's own engine played, so the walk has something
// long enough to earn an accuracy. A twelve-ply opening fragment cannot: the
// reviewer refuses to score fewer than ten of your moves rather than handing
// out a percentage an empty sample would earn, which is correct and is why the
// short stubs below come back with no score.
const FULL = JSON.parse(require('fs').readFileSync('selfplay.json', 'utf8')).pgn;

(async () => {
  const srv = serve(DIST, 8283);
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

  // ── the stub, installed before the page runs ─────────────────────────────
  await page.addInitScript((full) => {
    const ITALIAN = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O O-O';
    const game = (over) => ({
      url: 'https://www.chess.com/game/live/1', pgn: `[Event "Live Chess"]\n[Result "1-0"]\n\n${ITALIAN} 1-0`,
      end_time: 1700000000, rules: 'chess', time_class: 'blitz', rated: true,
      white: { username: 'testuser', result: 'win' }, black: { username: 'someone', result: 'checkmated' },
      ...over,
    });
    window.__served = [];
    window.__fetchStub = {
      archives: ['https://api.chess.com/pub/player/testuser/games/2024/01',
                 'https://api.chess.com/pub/player/testuser/games/2024/02'],
      byMonth: {
        '2024/01': [
          game({ url: 'g1' }),
          game({ url: 'g2', end_time: 1700000100, white: { username: 'someone', result: 'checkmated' }, black: { username: 'testuser', result: 'win' } }),
          game({ url: 'g3', end_time: 1700000200, rules: 'chess960' }),                       // refused: not chess
          game({ url: 'g4', end_time: 1700000300, pgn: '   ' }),                              // refused: no moves
          game({ url: 'g5', end_time: 1700000400, white: { username: 'a' }, black: { username: 'b' } }), // refused: not my game
        ],
        '2024/02': [
          game({ url: 'g6', end_time: 1700100000 }),
          game({ url: 'g7', end_time: 1700100100, pgn: `[Event "Live Chess"]\n[Result "0-1"]\n\n${full} 0-1` }),
        ],
      },
      status: 200,
    };
    const real = window.fetch;
    window.fetch = async (url, options) => {
      const href = String(url);
      window.__served.push(href);
      const S = window.__fetchStub;
      if (!href.includes('api.chess.com')) return real(url, options);
      if (S.status !== 200) return new Response('', { status: S.status });
      if (href.endsWith('/archives')) return new Response(JSON.stringify({ archives: S.archives }), { status: 200 });
      const key = href.slice(-7);
      return new Response(JSON.stringify({ games: S.byMonth[key] ?? [] }), { status: 200 });
    };
  }, FULL);

  await page.goto('http://127.0.0.1:8283/hard-lines-chess-app.html');
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  await gotoSection(page, 'review');
  await page.waitForTimeout(200);

  // ── a username that is not there ─────────────────────────────────────────
  await page.evaluate(() => { window.__fetchStub.status = 404; });
  await page.fill('#importUser', 'nobodyhere');
  await page.click('#importRun');
  await page.waitForFunction(() => !Import.running, null, { timeout: 20000 });
  const missing = await page.$eval('#importNote', (e) => e.textContent);
  say('a missing player', missing.slice(0, 90));
  check('404 is a sentence, not a crash', missing.includes('no public player called'), true);
  check('and it names what was typed', missing.includes('nobodyhere'), true);

  // ── the real import ──────────────────────────────────────────────────────
  await page.evaluate(() => { window.__fetchStub.status = 200; window.__served.length = 0; });
  await page.fill('#importUser', 'TestUser');
  await page.click('#importRun');
  await page.waitForFunction(() => !Import.running, null, { timeout: 30000 });

  const after = await page.evaluate(() => ({
    stored: App.reviews.games.length,
    sides: App.reviews.games.map((g) => g.side),
    urls: App.reviews.games.map((g) => g.url),
    reviewed: App.reviews.games.map((g) => g.reviewed),
    accuracy: App.reviews.games.map((g) => g.accuracy),
    served: window.__served,
    note: document.getElementById('importNote').textContent,
  }));
  say('requests made', after.served.map((u) => u.slice(-8)).join(' '));
  say('summary', after.note.slice(0, 110));
  check('four usable games were kept', after.stored, 4);
  check('and the unusable ones were not', after.urls.join(','), 'g1,g2,g6,g7');
  check('the colour is read off the headers', after.sides.join(','), 'white,black,white,white');
  check('a username is matched case-insensitively', after.sides[0], 'white');
  check('imported is not reviewed', after.reviewed.every((r) => r === false), true);
  check('and carries no accuracy nobody measured', after.accuracy.every((a) => a === null), true);
  // THE NUMBERS HAVE TO ADD UP, and this is the check that matters. The first
  // version of the summary rolled "already here" and "not usable" into one
  // subtraction, so a first-ever import on a device that had never held a game
  // announced that three of them were already here. Asserting the wording
  // ("includes skipped") passed happily through that; asserting the arithmetic
  // does not.
  const counted = await page.evaluate(() => ({ ...Import }));
  say('counts', JSON.stringify({ found: counted.found, added: counted.added, dup: counted.duplicate, bad: counted.unusable }));
  check('found is added plus duplicate plus unusable',
    counted.found, counted.added + counted.duplicate + counted.unusable);
  check('nothing was a duplicate on a first import', counted.duplicate, 0);
  check('and three were refused as unusable', counted.unusable, 3);
  check('the summary does not claim games were already here',
    after.note.includes('already here'), false);
  check('and it does say what was skipped', after.note.includes('3 skipped'), true);

  // ── a second import adds nothing ─────────────────────────────────────────
  await page.click('#importRun');
  await page.waitForFunction(() => !Import.running, null, { timeout: 30000 });
  const again = await page.evaluate(() => ({
    stored: App.reviews.games.length, note: document.getElementById('importNote').textContent,
  }));
  say('after importing twice', `${again.stored} stored — ${again.note.slice(0, 80)}`);
  check('importing the same months again adds nothing', again.stored, 4);
  check('and it says nothing was new', again.note.includes('Nothing new'), true);
  check('and that four were already here', again.note.includes('4 were already here'), true);
  const twice = await page.evaluate(() => ({ ...Import }));
  check('the second run counts four duplicates', twice.duplicate, 4);
  check('and its numbers add up too', twice.found, twice.added + twice.duplicate + twice.unusable);

  // ── the games are usable the moment they land ────────────────────────────
  const usable = await page.evaluate(() => {
    const parsed = parsePgn(App.reviews.games[0].pgn);
    return { plies: parsed.plies.length, first: parsed.plies[0]?.san };
  });
  check('the stored PGN parses', usable.plies, 12);
  check('and starts with the move it should', usable.first, 'e4');

  // The repertoire report reads them without anything else being done.
  await gotoSection(page, 'openings');
  await page.waitForTimeout(400);
  const walked = await page.evaluate(() => Deviations.counts);
  say('the repertoire report', JSON.stringify(walked));
  check('the imported games reach the repertoire report', walked.games, 4);
  check('and the two Italian games are seen as following it', walked.followed >= 2, true);

  // ── IMPORTED IS NOT REVIEWED, and the statistics have to know it ─────────
  //
  // The whole point of the reviewed flag. Three games are stored and none has
  // been walked, so Progress must not report three reviews with an accuracy
  // nobody measured, and Today must still say there is reviewing to do.
  await gotoSection(page, 'progress');
  await page.waitForTimeout(300);
  const progress = await page.$eval('#progressOut', (e) => e.textContent);
  say('progress', progress.replace(/\s+/g, ' ').slice(0, 120));
  check('Progress does not count imports as reviews',
    progress.includes('reviewed game'), false);
  check('and says how many are waiting to be walked',
    progress.includes('none of them has been reviewed'), true);

  await gotoSection(page, 'today');
  await page.waitForTimeout(300);
  const today = await page.$eval('#todayList', (e) => e.textContent);
  say('today', today.replace(/\s+/g, ' ').slice(0, 120));
  check('Today still asks for a review', today.includes('none reviewed yet'), true);

  // And once one IS reviewed, it counts.
  await page.evaluate(() => {
    App.reviews.games[0].reviewed = true;
    App.reviews.games[0].accuracy = 71;
    App.reviews.games[0].mistakes = [{ ply: 9, san: 'Qh5', kind: 'material', loss: 320, severity: 'blunder' }];
    show('progress');
  });
  await page.waitForTimeout(300);
  const after1 = await page.$eval('#progressOut', (e) => e.textContent);
  say('after one review', after1.replace(/\s+/g, ' ').slice(0, 120));
  check('a walked game counts as one review', after1.includes('Across 1 reviewed game'), true);
  check('and the others are named as waiting', after1.includes('3 imported and not yet reviewed'), true);

  await gotoSection(page, 'review');

  // ── WALKING THE IMPORTED GAMES ───────────────────────────────────────────
  //
  // The engine really runs here — three short games at the quick setting — so
  // this is slower than the rest of the file and worth it: it is the only
  // check that an imported game can go all the way from a JSON response to an
  // accuracy on the Progress page.
  await page.evaluate(() => { App.reviews.games.forEach((g) => { g.reviewed = false; g.accuracy = null; g.mistakes = []; }); });
  await gotoSection(page, 'review');
  await page.waitForTimeout(150);
  check('four games are waiting to be walked', await page.evaluate(() => unwalkedGames().length), 4);
  await page.click('#walkRun');
  await page.waitForFunction(() => !Walk.running && Walk.done > 0, null, { timeout: 180000 });
  const bulk = await page.evaluate(() => ({
    done: Walk.done, failed: Walk.failed, left: unwalkedGames().length,
    reviewed: App.reviews.games.filter((g) => g.reviewed === true).length,
    stored: App.reviews.games.length,
    scored: App.reviews.games.filter((g) => Number.isFinite(g.accuracy)).length,
    haveDepth: App.reviews.games.every((g) => g.depth === 7 || g.walkFailed),
    note: document.getElementById('walkNote').textContent,
  }));
  say('walk', `${bulk.done} done, ${bulk.failed} failed, ${bulk.left} left — ${bulk.note.slice(0, 60)}`);
  check('all four were walked', bulk.done, 4);
  check('none of them failed', bulk.failed, 0);
  check('none is left in the queue', bulk.left, 0);
  check('and they are marked reviewed', bulk.reviewed, 4);
  check('WITHOUT being duplicated in the store', bulk.stored, 4);
  // A game long enough to score gets one; the twelve-ply fragments do not, and
  // that is the reviewer refusing to invent a percentage rather than a fault.
  check('the full-length game earned an accuracy', bulk.scored, 1);
  check('and the short ones were left unscored rather than given one', bulk.stored - bulk.scored, 3);
  check('and the depth it was walked at', bulk.haveDepth, true);

  await gotoSection(page, 'progress');
  await page.waitForTimeout(300);
  check('Progress now counts all four',
    await page.$eval('#progressOut', (e) => e.textContent).then((t) => t.includes('Across 4 reviewed games')), true);
  check('and no longer says any are waiting',
    await page.$eval('#progressOut', (e) => e.textContent).then((t) => t.includes('not yet walked')), false);
  await gotoSection(page, 'review');

  // ── a network that never answers ─────────────────────────────────────────
  await page.evaluate(() => {
    window.fetch = async () => { throw new Error('Failed to fetch'); };
    App.reviews.games = [];
  });
  await gotoSection(page, 'review');
  await page.fill('#importUser', 'testuser');
  await page.click('#importRun');
  await page.waitForFunction(() => !Import.running, null, { timeout: 20000 });
  const dead = await page.$eval('#importNote', (e) => e.textContent);
  say('an unreachable network', dead.slice(0, 90));
  check('a dead network is explained, not thrown', dead.includes('Could not reach Chess.com'), true);
  check('and it points at what still works', dead.includes('Pasting below always works'), true);

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
