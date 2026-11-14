// New games, brought in and analysed without being asked for.
//
// Importing used to be four steps every time: open Game review, type the name
// again, press Import, press Analyse. The app now remembers the name from the
// first import and, whenever it is opened, asks Chess.com for anything newer
// than the newest game already here, brings that in, and analyses it.
//
// CHESS.COM IS STOOD IN FOR, as in import-drive.cjs and for the same reason.
// The stand-in is told which day it is — what the archive holds — through a
// flag that survives a reload, because catching up happens when the page
// opens; and it keeps a list of everything it was asked, because how little
// it is asked is part of what is being checked.
//
// What has to be true:
//
//   - the name is remembered once Chess.com has answered for it, and is there
//     after a reload;
//   - opening the app within three hours of asking does not ask again;
//   - with nothing new, it asks for the list of months and the newest month,
//     says nothing, and notes that it asked;
//   - with new games, it brings in exactly those that finished after the
//     newest one already here — not an older game that was never imported —
//     and analyses exactly those, with the judge and depth picked, leaving
//     games that were waiting to be analysed waiting;
//   - Today says what happened, in numbers that are true;
//   - Chess.com not answering, or not being reachable, says nothing, changes
//     nothing, and is tried again next time;
//   - it can be stopped, and says how far it got;
//   - and it can be turned off.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');
const fs = require('fs');
const path = require('path');

const PORT = 8317;
const base = `http://127.0.0.1:${PORT}/`;
const played = fs.readFileSync(path.join(__dirname, '..', 'tools', 'rating-games.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));
const pgnOf = (elo, g) => played.find((r) => r.elo === elo && r.game === g).pgn;
// Eight games: three there to begin with, one never imported, and four that arrive later.
const MOVES = [[300, 0], [300, 1], [600, 1], [0, 3], [600, 0], [900, 0], [900, 1], [300, 2]].map(([e, g]) => pgnOf(e, g));

// Chess.com, as far as the page can tell.
const CHESSCOM = (moves) => {
  const DAY = 86400;
  const when = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d, 12) / 1000);
  const game = (id, end, text) => ({
    url: `https://www.chess.com/game/live/${id}`, end_time: end, rules: 'chess', time_class: 'rapid', time_control: '600', rated: true,
    pgn: `[Event "Live Chess"]\n[White "hardliner"]\n[Black "opponent_${id}"]\n[Result "*"]\n\n${text} *`,
    white: { username: 'hardliner', rating: 900 + id, result: 'win' }, black: { username: `opponent_${id}`, rating: 910, result: 'resigned' },
  });
  // What the archive holds on each "day".
  const september = [game(1, when(2026, 9, 10), moves[0]), game(2, when(2026, 9, 20), moves[1])];
  const october = [game(3, when(2026, 10, 5), moves[2])];
  const DAYS = {
    // The day of the first import.
    first: { '2026/09': september, '2026/10': october },
    // Later: an old game Chess.com had all along and nobody imported turns up
    // in September's list, October has gained one, and November has begun.
    later: {
      '2026/09': [game(0, when(2026, 9, 1), moves[3]), ...september],
      '2026/10': [...october, game(4, when(2026, 10, 28), moves[4])],
      '2026/11': [game(5, when(2026, 11, 2), moves[5]), game(6, when(2026, 11, 9), moves[6])],
    },
    // Later still: one more.
    latest: {
      '2026/09': [game(0, when(2026, 9, 1), moves[3]), ...september],
      '2026/10': [...october, game(4, when(2026, 10, 28), moves[4])],
      '2026/11': [game(5, when(2026, 11, 2), moves[5]), game(6, when(2026, 11, 9), moves[6]), game(7, when(2026, 11, 12), moves[7])],
    },
  };
  const flag = (name, fallback) => localStorage.getItem(`test:${name}`) ?? fallback;
  const real = window.fetch;
  window.fetch = async (url, options) => {
    const href = String(url);
    if (!href.includes('api.chess.com')) return real(url, options);
    const asked = JSON.parse(flag('asked', '[]'));
    asked.push(href.replace('https://api.chess.com/pub/player/', ''));
    localStorage.setItem('test:asked', JSON.stringify(asked));
    if (flag('chesscom', 'up') === 'unreachable') throw new TypeError('Failed to fetch');
    if (flag('chesscom', 'up') === 'down') return new Response('', { status: 503 });
    const months = DAYS[flag('day', 'first')];
    if (href.endsWith('/archives')) {
      return new Response(JSON.stringify({ archives: Object.keys(months).map((m) => `https://api.chess.com/pub/player/hardliner/games/${m}`) }), { status: 200 });
    }
    return new Response(JSON.stringify({ games: months[href.slice(-7)] ?? [] }), { status: 200 });
  };
};

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
  await page.addInitScript(CHESSCOM, MOVES);

  const up = async () => {
    await page.waitForSelector('#tab-today', { timeout: 20000 });
    // Catching up starts once the page is up, and is over when nothing is running.
    await page.waitForFunction(() => typeof CatchUp !== 'undefined' && !CatchUp.running && !Walk.running, null, { timeout: 180000 });
  };
  const reload = async () => { await page.reload(); await up(); };
  const flag = (name, value) => page.evaluate(([n, v]) => {
    if (v === null) localStorage.removeItem(`test:${n}`); else localStorage.setItem(`test:${n}`, v);
  }, [name, value]);
  const asked = () => page.evaluate(() => JSON.parse(localStorage.getItem('test:asked') ?? '[]'));
  const forget = () => page.evaluate(() => localStorage.removeItem('test:asked'));
  // Three hours and more go by.
  const later = () => page.evaluate(async () => {
    App.prefs.chessComChecked = Date.now() - 4 * 60 * 60 * 1000;
    await Store.set('prefs', App.prefs);
    return App.prefs.chessComChecked;
  });
  const stored = () => page.evaluate(() => App.reviews.games.map((g) => `${g.url.split('/').pop()}:${g.reviewed === false ? 'waiting' : `${g.judge}/${g.depth}`}`).join(' '));
  const today = () => page.evaluate(() => ({ shown: !document.getElementById('catchUp').hidden, text: document.getElementById('catchUpNote').textContent,
    stop: !document.getElementById('catchUpStop').hidden }));

  await page.goto(base);
  await up();
  check('nothing is asked of Chess.com before there is a name', (await asked()).length, 0);
  await gotoSection(page, 'review');
  check('and the setting says how to give it one', await page.$eval('#catchUpState', (e) => e.textContent), 'Import once, and the app will remember the name.');

  // ── the first import ───────────────────────────────────────────────────────
  await page.fill('#importUser', 'Hardliner');
  await page.click('#importRun');
  await page.waitForFunction(() => !Import.running && /imported/.test(document.getElementById('importNote').textContent), null, { timeout: 20000 });
  check('three games imported', await stored(), '1:waiting 2:waiting 3:waiting');
  check('the name is remembered', await page.evaluate(() => App.prefs.chessComUser), 'Hardliner');
  check('and the setting says whose games it will ask about', /^Asks Chess\.com about Hardliner’s new games when the app is opened — last asked \d+ \w+ at \d\d:\d\d\.$/.test(await page.$eval('#catchUpState', (e) => e.textContent)), true);
  await forget();
  await reload();
  await gotoSection(page, 'review');
  check('after a reload the name is in the box', await page.$eval('#importUser', (e) => e.value), 'Hardliner');
  check('opening the app straight after an import does not ask again', (await asked()).length, 0);

  // ── three hours on, and nothing new ────────────────────────────────────────
  const before = await later();
  await reload();
  check('three hours on it asks: the list of months, and the newest month', (await asked()).join(' '), 'hardliner/games/archives hardliner/games/2026/10');
  check('with nothing new, nothing is said', (await today()).shown, false);
  check('nothing is added', await stored(), '1:waiting 2:waiting 3:waiting');
  check('and it notes that it asked', await page.evaluate((b) => App.prefs.chessComChecked > b, before), true);
  await forget();
  await reload();
  check('so opening it again does not ask', (await asked()).length, 0);

  // ── new games ──────────────────────────────────────────────────────────────
  await flag('day', 'later');
  await gotoSection(page, 'review');
  await page.selectOption('#walkDepth', '9');
  await later();
  await reload();
  check('it asks back only as far as there is something new', (await asked()).join(' '),
    'hardliner/games/archives hardliner/games/2026/11 hardliner/games/2026/10 hardliner/games/2026/09');
  check('the three that are newer than the newest one here come in, analysed at the depth picked — and only those are analysed',
    await stored(), '1:waiting 2:waiting 3:waiting 4:app/9 5:app/9 6:app/9');
  check('an older game that was never imported is not reached back for', (await stored()).includes('0:'), false);
  const told = await today();
  say('Today says', told.text);
  const made = await page.evaluate(() => ({ drills: App.drills.items.length, puzzles: App.puzzles.items.length, depth: document.getElementById('walkDepth').value }));
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const madeWords = [made.drills ? n(made.drills, 'new drill', 'new drills') : '', made.puzzles ? n(made.puzzles, 'new puzzle', 'new puzzles') : ''].filter(Boolean).join(' and ');
  check('Today says what arrived and what came of it, in numbers that are true', told.text, `3 new games from Chess.com, analysed: ${madeWords}.`);
  check('with something to show for it', made.drills > 0, true);
  check('and nothing left to stop', `${told.shown} ${told.stop}`, 'true false');
  check('the depth picked is still the depth picked', made.depth, '9');
  check('the drills are on Today', await page.evaluate(() => /drill|position/i.test(document.getElementById('todayList').textContent)), true);

  // ── Chess.com not answering, and not reachable ─────────────────────────────
  for (const [state, what] of [['down', 'not answering'], ['unreachable', 'out of reach']]) {
    await flag('day', 'latest');
    await flag('chesscom', state);
    await forget();
    const was = await later();
    await reload();
    check(`Chess.com ${what}: it was asked`, (await asked()).length, 1);
    check(`Chess.com ${what}: nothing is said`, (await today()).shown, false);
    check(`Chess.com ${what}: nothing is added`, (await stored()).includes('7:'), false);
    check(`Chess.com ${what}: and it does not note that it asked, so it will ask again`, await page.evaluate(() => App.prefs.chessComChecked), was);
  }
  await flag('chesscom', null);

  // ── turned off ─────────────────────────────────────────────────────────────
  await gotoSection(page, 'review');
  await page.uncheck('#catchUpOn');
  check('turned off, the setting says so', await page.$eval('#catchUpState', (e) => e.textContent), 'Not asking Chess.com about Hardliner’s new games.');
  await forget();
  await later();
  await reload();
  check('and nothing is asked', (await asked()).length, 0);
  await gotoSection(page, 'review');
  check('it stays off after a reload', await page.$eval('#catchUpOn', (e) => e.checked), false);
  await page.check('#catchUpOn');

  // ── stopped partway ────────────────────────────────────────────────────────
  //
  // One new game is too quick to stop, so the three that are waiting from the
  // first import are given back their newness: with nothing from Chess.com
  // analysed or stored but the first, everything after it is new.
  await page.evaluate(async () => {
    App.reviews.games = App.reviews.games.filter((g) => g.url.endsWith('/1'));
    await Store.set('reviews', App.reviews);
  });
  await gotoSection(page, 'review');
  await page.selectOption('#walkDepth', '12');
  await forget();
  await later();
  await page.reload();
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  await page.waitForFunction(() => /Analysing 1 of 6/.test(document.getElementById('catchUpNote').textContent), null, { timeout: 60000 });
  check('while it works, Today says how far it has got, with a way to stop it', (await today()).stop, true);
  await page.click('#catchUpStop');
  await up();
  const halted = await today();
  say('stopped, Today says', halted.text);
  check('stopped, it says how many it had analysed and where the rest are',
    /^6 new games from Chess\.com\. \d analysed before it was stopped; the rest are waiting in Game review\.$/.test(halted.text), true);
  const afterStop = await page.evaluate(() => ({ all: App.reviews.games.length, done: App.reviews.games.filter((g) => g.reviewed !== false).length }));
  check('all six are stored, and the ones it did not reach are waiting', afterStop.all === 7 && afterStop.done >= 1 && afterStop.done < 6, true);
  check('and the walk on Game review offers the rest', await page.evaluate(() => /have not been analysed|has not been analysed/.test(walkWaiting() ?? '')), true);

  console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
  if (errors.length) failures.push('page errors');
  await browser.close();
  srv.stop?.();
  if (failures.length) { console.log(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1); }
  console.log('ok');
  process.exit(0);
})().catch((e) => { console.error(e); console.log('FAILED'); process.exit(1); });
