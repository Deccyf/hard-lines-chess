// Puzzles aimed at what goes wrong in your games, driven in a real browser.
//
// The choosing and the judging are held to their rules in node
// (weak-spots.test.mjs). This is the rest: the pack being found, fetched and
// believed; a set of ten going across a board by clicks; what is said and
// stored after each answer; and the same after the page is opened again.
//
// THE PACK IS STOOD IN FOR. The real one is fifty thousand puzzles chosen at
// random, and a test that depended on which of them came up would be testing
// the dice. So the page is handed a small pack made here — positions that are
// what their themes say, at known ratings — through the same two requests it
// makes for the real one, and a flag says which pack, or which fault, it gets.
//
// What has to be true:
//
//   - with no pack beside the page there is no offer on Today, and the screen
//     says why instead of offering a button; a copy opened from a file does
//     not even ask;
//   - with nothing analysed, a set is ten of the mix, near the level, and the
//     screen says that is why;
//   - with games analysed, the aims are the ones the games show — counted the
//     way the Progress page counts them, an unanalysed game saying nothing —
//     and seven of the ten are of those kinds, each really having its theme;
//   - the move that set a puzzle up is played in front of you;
//   - a right move goes on to their reply and your next; a wrong one counts
//     the puzzle as missed and leaves it there; the answer can be asked for;
//     a second way to give mate is as right as the one recorded;
//   - the level goes up for a solve and down for a miss, and only for puzzles
//     met for the first time;
//   - a solved puzzle is never offered again, and a missed one comes back when
//     it is due — first in the set, said to be one missed before — and is
//     finished with after being solved twice running;
//   - all of it is still there after a reload, and is in a backup;
//   - a pack that cannot be fetched, or is not the one its description is of,
//     is said to be so, and asked for again next time.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');
const path = require('path');

const PORT = 8331;
const base = `http://127.0.0.1:${PORT}/`;

// ── packs, as tools/make-puzzle-pack.mjs writes them ───────────────────────
const CODES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const THEMES = ['fork', 'hangingPiece', 'pin', 'mateIn1', 'mateIn2', 'backRankMate', 'sacrifice', 'attackingF2F7', 'mate', 'opening', 'endgame'];
const code = (names) => names.map((n) => CODES[THEMES.indexOf(n)]).join('');
const POSITIONS = {
  // One move each.
  fool: ['rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2', 'g2g4 d8h4', ['mateIn1', 'mate', 'opening']],
  scholar: ['r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3', 'g8f6 h5f7', ['mateIn1', 'mate', 'opening', 'attackingF2F7']],
  backrank: ['r5k1/5ppp/8/8/8/8/5PPP/1R4K1 b - - 0 1', 'a8a2 b1b8', ['backRankMate', 'mateIn1', 'mate', 'endgame']],
  hang: ['4k3/8/8/8/3q4/8/8/3RK3 b - - 0 1', 'e8e7 d1d4', ['hangingPiece', 'endgame']],
  pinned: ['4k3/8/8/8/3q4/8/8/3RK3 b - - 0 1', 'e8f7 d1d4', ['pin', 'endgame']],
  // Two moves each.
  legal: ['rn1qkbnr/ppp2p1p/3p2p1/4N3/2B1P1b1/2N5/PPPP1PPP/R1BQK2R b KQkq - 0 5', 'g4d1 c4f7 e8e7 c3d5', ['mateIn2', 'mate', 'opening', 'sacrifice']],
  fork: ['r3k3/p7/8/3N4/8/8/8/4K3 b - - 0 1', 'a7a6 d5c7 e8e7 c7a8', ['fork', 'endgame']],
  // Two ways to give mate; the pack records Ra8.
  two: ['6k1/5ppp/8/n7/8/8/1Q3PPP/R5K1 b - - 0 1', 'a5c4 a1a8', ['mateIn1', 'mate', 'backRankMate']],
};
const row = (id, rating, key) => { const [fen, moves, themes] = POSITIONS[key]; return `${id}\t${rating}\t${code(themes)}\t${fen}\t${moves}`; };
const makePack = (rows) => {
  const sorted = [...rows].sort((a, b) => Number(a.split('\t')[1]) - Number(b.split('\t')[1]) || (a < b ? -1 : 1));
  const text = ['# a pack for the tests', `# themes ${THEMES.join(' ')}`, ...sorted].join('\n') + '\n';
  return { text, about: { format: 1, count: sorted.length, bytes: Buffer.byteLength(text) } };
};
// The usual one: every position at every twenty points from 500 to 1900.
const usual = [];
for (const [i, key] of ['fool', 'scholar', 'backrank', 'hang', 'pinned', 'legal', 'fork'].entries()) {
  for (let rating = 500; rating <= 1900; rating += 20) usual.push(row(`${'abcdefg'[i]}${rating}`.padEnd(5, 'x'), rating, key));
}
const PACKS = {
  usual: makePack(usual),
  // Only the position with two mates in it.
  two: makePack(Array.from({ length: 30 }, (_, i) => row(`t${String(i).padStart(4, '0')}`, 700 + i * 10, 'two'))),
  // Three puzzles, to run out of.
  tiny: makePack([row('tiny1', 880, 'hang'), row('tiny2', 900, 'fool'), row('tiny3', 920, 'scholar')]),
};

// The two requests the page makes, answered from here.
const STAND_IN = (packs) => {
  const flag = (name, fallback) => { try { return localStorage.getItem(`test:${name}`) ?? fallback; } catch { return fallback; } };
  const real = window.fetch;
  window.fetch = async (url, options) => {
    const href = String(url);
    const which = /puzzle-pack\.(json|txt)$/.exec(href)?.[1];
    if (!which) return real(url, options);
    try {
      const asked = JSON.parse(flag('asked', '[]'));
      asked.push(which);
      localStorage.setItem('test:asked', JSON.stringify(asked));
    } catch { /* a page with nowhere to note it */ }
    const state = flag('pack', 'usual');
    if (state === 'unreachable') throw new TypeError('Failed to fetch');
    if (state === 'none') return which === 'json' ? new Response('{"format": 1, "count": 0}', { status: 200 }) : new Response('', { status: 404 });
    if (state === 'no-file') return which === 'json' ? new Response(JSON.stringify(packs.usual.about), { status: 200 }) : new Response('', { status: 404 });
    if (state === 'other') return which === 'json' ? new Response(JSON.stringify(packs.usual.about), { status: 200 }) : new Response(packs.tiny.text, { status: 200 });
    const pack = packs[state];
    return which === 'json' ? new Response(JSON.stringify(pack.about), { status: 200 }) : new Response(pack.text, { status: 200 });
  };
};

(async () => {
  const srv = serve(path.join(DIST, 'pwa'), PORT);
  await srv.ready;
  const browser = await launch();
  const say = (k, v) => console.log(String(k).padEnd(70), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    say(what, ok ? String(typeof got === 'string' ? got : JSON.stringify(got)).slice(0, 110)
      : `${JSON.stringify(got).slice(0, 500)}   <- expected ${JSON.stringify(want).slice(0, 500)}`);
    if (!ok) failures.push(what);
  };
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(STAND_IN, PACKS);

  // ── helpers ──────────────────────────────────────────────────────────────
  const flag = (name, value) => page.evaluate(([n, v]) => {
    if (v === null) localStorage.removeItem(`test:${n}`); else localStorage.setItem(`test:${n}`, v);
  }, [name, value]);
  const up = async () => {
    await page.waitForSelector('#tab-today', { timeout: 20000 });
    await page.waitForFunction(() => typeof Weak !== 'undefined' && Weak.about !== undefined, null, { timeout: 20000 });
    // The same shuffle and the same picks every run.
    await page.evaluate(() => { let seed = 5; Weak.rng = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; });
  };
  const open = async (pack) => { await flag('pack', pack); await page.reload(); await up(); };
  const todayRow = () => page.evaluate(() => {
    const row = [...document.querySelectorAll('#todayList .task')].find((t) => t.querySelector('.task-kind').textContent === 'Weak spots');
    return row ? { title: row.querySelector('.task-title').textContent, note: row.querySelector('.task-note').textContent } : null;
  });
  const text = (id) => page.$eval('#' + id, (e) => e.textContent.replace(/\s+/g, ' ').trim());
  const shown = (id) => page.$eval('#' + id, (e) => !e.hidden);
  const cur = () => page.evaluate(() => {
    const c = Weak.current;
    if (!c) return null;
    return { id: c.opened.id, kind: c.kind, aim: c.aim, themes: c.opened.themes, rating: c.opened.rating, side: c.opened.side,
      step: c.step, line: c.opened.line.map((s) => s.uci), sans: c.opened.line.map((s) => s.san), their: c.opened.theirSan,
      start: c.opened.start, before: c.opened.before, moves: c.opened.moves.join(' '), missed: c.missed, over: c.over, at: Weak.set.at };
  });
  const stored = () => page.evaluate(() => JSON.parse(JSON.stringify(App.weak)));
  const ready = () => page.waitForFunction(() => Weak.current && !Weak.current.over && Weak.view.interactive, null, { timeout: 10000 });
  const click = async (uci) => {
    await page.click(`#weakBoard .sq[aria-label="${uci.slice(0, 2)}"]`);
    await page.click(`#weakBoard .sq[aria-label="${uci.slice(2, 4)}"]`);
  };
  /** Play the puzzle on the board to its end, the way the pack has it. */
  const solve = async () => {
    for (;;) {
      await ready();
      const c = await cur();
      await click(c.line[c.step]);
      if (c.step >= c.line.length - 1) break;
    }
    await page.waitForFunction(() => Weak.current?.over, null, { timeout: 10000 });
  };
  /** A legal move that is not the answer and is not mate: the king, one square. */
  const wrongMove = async () => {
    await ready();
    return page.evaluate(() => {
      const c = Weak.current;
      const step = c.opened.line[c.step];
      const board = new Board(step.fen);
      const move = board.legalMoves().find((m) => {
        const uci = moveToUci(m);
        return uci !== step.uci && !packMoveIsRight(step, uci) && !movePromo(m);
      });
      return moveToUci(move);
    });
  };
  const next = async () => { await page.click('#weakNext'); };
  const start = async () => { await page.click('#weakStart'); await ready(); };
  const served = [];
  /** Solve the rest of the set, noting what each puzzle was. */
  const finishSet = async (seen = []) => {
    for (;;) {
      const c = await cur();
      if (!c) break;
      if (!c.over) { seen.push(c); served.push(c.id); await solve(); }
      await next();
      if (!(await page.evaluate(() => Boolean(Weak.current)))) break;
      await ready();
    }
    return seen;
  };

  // ── A: no pack beside the page ───────────────────────────────────────────
  await page.goto(base);
  await up();
  await page.evaluate(() => localStorage.removeItem('test:asked'));
  await open('none');
  check('A: with no pack, Today offers no weak-spot puzzles', await todayRow(), null);
  await gotoSection(page, 'weak');
  check('A: and the screen says why', await text('weakNote'),
    'This build of the app was made without the puzzle pack, so there is nothing to choose from here.');
  check('A: with no button to start', await shown('weakStart'), false);
  check('A: only the description was asked for', await page.evaluate(() => localStorage.getItem('test:asked')), '["json"]');

  // ── B: a pack, and nothing analysed ──────────────────────────────────────
  await open('usual');
  check('B: with a pack, Today offers ten', (await todayRow())?.title, 'Ten puzzles at your level');
  await gotoSection(page, 'weak');
  await page.waitForFunction(() => Weak.pack, null, { timeout: 10000 });
  check('B: the screen says how many there are to choose from', await text('weakNote'), `${PACKS.usual.about.count} puzzles to choose from.`);
  check('B: and that they are a mix, and why', (await text('weakAims')).includes('None of your games has been analysed yet, so these are a mix of everything.'), true);
  check('B: the level starts at 1000', (await text('weakHead')).startsWith('Your level on these1000'), true);

  await start();
  let c = await cur();
  check('B: the first of ten is on the board', await text('weakWhere'), 'Puzzle 1 of 10 · one of the mix.');
  check('B: it says what was just played, and who is to move', await text('weakPrompt'),
    `They have just played ${c.their}. Find the best move for ${c.side === 'white' ? 'White' : 'Black'}.`);
  check('B: the move that set it up has been played on the board', await page.evaluate(() => Weak.view.board.fen()), c.start);
  check('B: and is marked as the last move', await page.evaluate(() => moveToUci(Weak.view.lastMove) === Weak.current.opened.theirUci), true);

  const setB = [];
  let levels = [1000];
  for (let i = 0; i < 10; i++) {
    c = await cur();
    setB.push(c);
    served.push(c.id);
    await solve();
    levels.push((await stored()).level);
    if (i === 0) {
      check('B: solving it says so, and what it was rated and where the level went', (await text('weakAnswer')).replace(/^Solved\. (It was [^.]+\. )?/, 'Solved. '),
        `Solved. Rated ${c.rating}; your level goes from 1000 to ${levels[1]}.`);
      check('B: the button goes on to the next', await text('weakNext'), 'Next');
    }
    if (i === 9) check('B: the last one\'s button goes to how the ten went', await text('weakNext'), 'See how the ten went');
    await next();
  }
  check('B: with nothing to aim at, all ten were of the mix', setB.every((p) => p.kind === 'mixed' && p.aim === null), true);
  check('B: each was near the level it was picked for', setB.every((p, i) => Math.abs(p.rating - (levels[i] - 100)) <= 125 + 20), true);
  check('B: ten different puzzles', new Set(setB.map((p) => p.id)).size, 10);
  check('B: the level rose with every solve', levels.every((l, i) => i === 0 || l > levels[i - 1]), true);
  check('B: the set is summed up', await text('weakNote'), `10 of 10 solved: the mix 10 of 10. Your level went from 1000 to ${levels[10]}.`);
  check('B: and another can be started', await text('weakStart'), 'Another ten');
  let data = await stored();
  check('B: what was solved is stored, and the level, and that ten were counted',
    [data.done.length, data.counted, data.level, data.again.length, data.log.length], [10, 10, levels[10], 0, 10]);
  await gotoSection(page, 'today');
  check('B: a set done today is not offered again today', await todayRow(), null);

  // ── C: games analysed ────────────────────────────────────────────────────
  await page.evaluate(async () => {
    const mistake = (themes) => ({ ply: 9, san: 'Qh5', kind: 'material', loss: 300, severity: 'blunder', themes });
    const game = (at, list, extra = {}) => ({ at, white: 'You', black: 'Them', result: '0-1', side: 'white', plies: 40, mistakes: list.map(mistake), ...extra });
    App.reviews.games = [
      game(1000, [['fork'], ['fork'], ['fork', 'hangingPiece'], []]),
      game(2000, [['fork'], ['hangingPiece'], ['lostMaterial'], ['lostMaterial']]),
      game(3000, [['fork'], ['fork'], ['hangingPiece']]),
      // Imported and never analysed: nine pins that nobody found.
      game(4000, Array.from({ length: 9 }, () => ['pin']), { reviewed: false }),
    ];
    await Store.set('reviews', App.reviews);
    // And it is tomorrow.
    App.weak.lastSet = Date.now() - 86400000;
    await Store.set('weakspots', App.weak);
    show('today');
  });
  check('C: with games analysed, Today says what the ten are aimed at', (await todayRow())?.title, 'Ten puzzles aimed at forks and loose pieces');
  await gotoSection(page, 'weak');
  check('C: the screen lists the aims, with what in your games each is for',
    await page.$$eval('#weakAims .record-row', (rows) => rows.map((r) => [r.querySelector('.record-band').textContent, r.querySelector('.record-score').textContent])),
    [['Forks', 'you allowed a fork 6 times'], ['Loose pieces', 'you left a piece loose 3 times']]);
  check('C: and over how many games — the unanalysed one not among them',
    (await text('weakAims')).includes('Counted over your last 3 analysed games.'), true);

  const before = (await stored()).level;
  await start();
  const setC = [];
  // The first: a wrong move, then the right ones.
  c = await cur();
  setC.push(c); served.push(c.id);
  const wrong = await wrongMove();
  const fenBefore = await page.evaluate(() => Weak.view.board.fen());
  await click(wrong);
  check('C: a wrong move is said to be wrong', (await text('weakAnswer')).startsWith('Not '), true);
  check('C: the position is still there', await page.evaluate(() => Weak.view.board.fen()), fenBefore);
  check('C: and the puzzle is still the one being asked', [(await cur()).id, (await cur()).over, (await cur()).missed], [c.id, false, true]);
  await solve();
  check('C: found on a second look, it counts as missed', (await text('weakAnswer')).startsWith('Found — on a second look, so it counts as missed.'), true);
  check('C: and comes back tomorrow', (await text('weakAnswer')).endsWith('It comes back tomorrow.'), true);
  data = await stored();
  check('C: the level went down for it', data.level < before, true);
  check('C: it is kept to be met again, whole, and is not among the solved',
    [data.again.length, data.again[0].puzzle.id, data.again[0].puzzle.moves.join(' '), data.done.includes(c.id)],
    [1, c.id, c.moves, false]);
  check('C: due tomorrow, not today', await page.evaluate(() => !SRS.isDue(App.weak.again[0].card) && App.weak.again[0].card.interval === 1), true);
  await next();

  // The second: the answer asked for.
  await ready();
  c = await cur();
  setC.push(c); served.push(c.id);
  await page.click('#weakShow');
  await page.waitForFunction(() => Weak.current?.over);
  check('C: asked for, the answer is given', (await text('weakAnswer')).startsWith(`The move is ${c.sans[0]}.`), true);
  check('C: and drawn on the board, on the position it is played from',
    await page.evaluate(() => [Weak.view.arrows.length, Weak.view.arrows[0]?.kind, Weak.view.board.fen() === Weak.current.opened.start]), [1, 'best', true]);
  check('C: that is a miss too', (await stored()).again.length, 2);
  await next();

  // The rest, solved; one of them is two moves long.
  await ready();
  const rest = await (async () => {
    const seen = [];
    for (;;) {
      const p = await cur();
      seen.push(p); served.push(p.id);
      if (p.line.length > 1 && !seen.twoMove) {
        seen.twoMove = true;
        await click(p.line[0]);
        await page.waitForFunction(() => Weak.current.step === 2 && Weak.view.interactive, null, { timeout: 10000 });
        check('C: a right move that is not the last is answered', await text('weakPrompt'), `Yes, ${p.sans[0]}. They answer ${p.sans[1]}. And now?`);
        check('C: and their answer is played on the board', await page.evaluate(() => Weak.view.board.fen() === Weak.current.opened.line[2].fen), true);
      }
      await solve();
      await next();
      if (!(await page.evaluate(() => Boolean(Weak.current)))) break;
      await ready();
    }
    return seen;
  })();
  setC.push(...rest);
  const count = (list, f) => list.filter(f).length;
  check('C: seven of the ten were aimed — five at forks and two at loose pieces — and three were of the mix',
    [count(setC, (p) => p.aim === 'fork'), count(setC, (p) => p.aim === 'hangingPiece'), count(setC, (p) => p.kind === 'mixed')], [5, 2, 3]);
  check('C: and every aimed one really is of its kind', setC.filter((p) => p.kind === 'aimed').every((p) => p.themes.includes(p.aim)), true);
  check('C: a set had a two-move puzzle in it', Boolean(rest.twoMove), true);
  check('C: nothing solved before was offered again', new Set(served).size, served.length);
  data = await stored();
  check('C: the set is summed up by what it was aimed at',
    /^8 of 10 solved: (forks \d of 5|loose pieces \d of 2|the mix \d of 3)(, (forks \d of 5|loose pieces \d of 2|the mix \d of 3)){2}\. Your level went from \d+ to \d+\.$/.test(await text('weakNote')), true);
  check('C: the screen keeps count against each aim', (await text('weakAims')).includes('solved so far'), true);

  // ── D: a second way to give mate ─────────────────────────────────────────
  await open('two');
  await gotoSection(page, 'weak');
  await start();
  c = await cur();
  check('D: the pack records one mate', c.line, ['a1a8']);
  await click('b2b8');
  await page.waitForFunction(() => Weak.current?.over);
  check('D: and the other is as right', (await text('weakAnswer')).startsWith('Solved.'), true);
  // Yesterday's set is the last one finished, as far as the app knows.
  await page.evaluate(() => { App.weak.lastSet = Date.now() - 86400000; });
  await page.click('#weakStop');
  check('D: stopping says how far it got, and what was counted', (await text('weakNote')).startsWith('Stopped after 1. 1 of 1 solved: the mix 1 of 1.'), true);
  check('D: a set that was stopped is not today\'s set done', await page.evaluate(() => weakSetDoneToday()), false);

  // ── E: missed puzzles come back ──────────────────────────────────────────
  await open('usual');
  data = await stored();
  check('E: after a reload the level, the solved and the missed are all still there',
    [data.again.length, data.done.length >= 18, data.counted, data.log.length], [2, true, 21, 21]);
  const missedIds = data.again.map((a) => a.puzzle.id);
  // Tomorrow has come.
  await page.evaluate(async () => {
    for (const a of App.weak.again) a.card.due = Date.now() - 1000;
    App.weak.lastSet = Date.now() - 86400000;
    await Store.set('weakspots', App.weak);
    show('today');
  });
  check('E: Today says two are due again', (await todayRow())?.note.endsWith('2 you missed before are due again.'), true);
  await gotoSection(page, 'weak');
  check('E: and so does the screen', (await text('weakNote')).endsWith('2 you missed before are due again, and come first.'), true);
  await start();
  const setE = [];
  // Solve the first that is met again; miss the second.
  for (;;) {
    c = await cur();
    setE.push(c);
    if (c.kind === 'again' && setE.filter((p) => p.kind === 'again').length === 1) {
      check('E: one met again is said to be', (await text('weakWhere')).endsWith('one you missed before.'), true);
      await solve();
      check('E: solved, it comes back once more', (await text('weakAnswer')).endsWith('It comes back once more, in about a week.'), true);
      check('E: and says nothing about the level', (await text('weakAnswer')).includes('your level'), false);
    } else if (c.kind === 'again') {
      await page.click('#weakShow');
      await page.waitForFunction(() => Weak.current?.over);
      check('E: missed again, it is back tomorrow', (await text('weakAnswer')).endsWith('It comes back tomorrow.'), true);
    } else {
      served.push(c.id);
      await solve();
    }
    await next();
    if (!(await page.evaluate(() => Boolean(Weak.current)))) break;
    await ready();
  }
  check('E: both came back in this set', setE.filter((p) => p.kind === 'again').map((p) => p.id).sort(), [...missedIds].sort());
  check('E: and the rest of the ten was new', [setE.length, new Set(served).size === served.length], [10, true]);
  data = await stored();
  check('E: meeting one again does not move the level; the eight new ones did', data.counted, 29);
  check('E: one is a week off and one is tomorrow', data.again.map((a) => a.card.interval).sort(), [1, 6]);
  // A week on: the one solved once is solved again, and is finished with.
  const weekId = data.again.find((a) => a.card.interval === 6).puzzle.id;
  await page.evaluate(async (id) => {
    for (const a of App.weak.again) a.card.due = a.puzzle.id === id ? Date.now() - 1000 : Date.now() + 5 * 86400000;
    await Store.set('weakspots', App.weak);
  }, weekId);
  await start();
  for (;;) {
    c = await cur();
    if (c.kind === 'again') {
      await solve();
      check('E: solved twice running, it is finished with', (await text('weakAnswer')).endsWith('That is twice running, so it is finished with.'), true);
      break;
    }
    served.push(c.id);
    await solve();
    await next();
    await ready();
  }
  data = await stored();
  check('E: it has left the ones to meet again and joined the solved', [data.again.length, data.done.includes(weekId)], [1, true]);
  await page.click('#weakStop');

  // ── F: kept, and in a backup ─────────────────────────────────────────────
  const kept = await stored();
  await page.reload();
  await up();
  check('F: everything is as it was after the page is opened again', await stored(), kept);
  check('F: and it is in a backup file', await page.evaluate(() => {
    const file = JSON.parse(buildBackup().text);
    return [Object.keys(file.areas).includes('weakspots'), file.areas.weakspots.payload.level === App.weak.level, readBackup(buildBackup().text).ok];
  }), [true, true, true]);

  // ── G: running out ───────────────────────────────────────────────────────
  await open('tiny');
  await page.evaluate(async () => { App.weak = weakSpotsData(null); await Store.set('weakspots', App.weak); });
  await gotoSection(page, 'weak');
  await start();
  await finishSet();
  check('G: a pack with three puzzles gives three and says that is all',
    (await text('weakNote')).startsWith('That is every puzzle in the pack. 3 of 3 solved'), true);

  // ── H: a pack that cannot be had ─────────────────────────────────────────
  await open('unreachable');
  check('H: when nothing answers, Today makes no offer', await todayRow(), null);
  await gotoSection(page, 'weak');
  check('H: and the screen says the puzzles could not be fetched',
    await text('weakNote'), 'The puzzles could not be fetched just now. They are kept on the device once they have been fetched; open this screen again with a connection.');
  await flag('pack', 'usual');
  await gotoSection(page, 'today');
  await gotoSection(page, 'weak');
  await page.waitForFunction(() => Weak.pack, null, { timeout: 10000 });
  check('H: it asks again the next time the screen is opened, and finds them', await shown('weakStart'), true);

  await open('no-file');
  await gotoSection(page, 'weak');
  await page.waitForFunction(() => Weak.failed, null, { timeout: 10000 });
  check('H: a description with no pack behind it is said to be so',
    await text('weakNote'), 'The puzzles could not be fetched just now. Open this screen again with a connection.');
  await flag('pack', 'usual');
  await start();
  check('H: and Start asks for it again', Boolean(await cur()), true);
  await page.click('#weakStop');

  await open('other');
  await gotoSection(page, 'weak');
  await page.waitForFunction(() => Weak.failed, null, { timeout: 10000 });
  check('H: a pack that is not the one described is not used',
    await text('weakNote'), 'The puzzles on this device are not the ones their description is for. Close the app completely and open it again.');
  check('H: and nothing is chosen from it', await page.evaluate(() => Weak.pack), null);

  // ── I: a copy opened from a file ─────────────────────────────────────────
  const file = await ctx.newPage();
  file.on('pageerror', (e) => errors.push(e.message));
  await file.goto(`file://${path.join(DIST, 'hard-lines-chess-app.html')}`);
  await file.waitForSelector('#tab-today', { timeout: 20000 });
  await file.waitForFunction(() => Weak.about !== undefined);
  check('I: a copy opened from a file does not ask for the pack at all', await file.evaluate(() => localStorage.getItem('test:asked')), null);
  await gotoSection(file, 'weak');
  check('I: and says why there are no puzzles in it', await file.$eval('#weakNote', (e) => e.textContent),
    'This copy of the app was opened from a file, and the puzzles are a separate file it cannot read from there. They are in the installed app and in the web version.');
  await file.close();

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
