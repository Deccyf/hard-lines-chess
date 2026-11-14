// What keeps happening, on the Progress page, with histories made up on the spot.
//
// The counting is held to its rules in node (patterns.test.mjs). This is the
// page: that it says what the counts come to and no more than that — a trend
// only where there are games enough for one and a difference bigger than luck,
// a position only where it has been gone wrong in more than once — that the
// numbers on the screen are the numbers in the games, and that the board is
// one tap from each position it names.
//
// What has to be true:
//
//   - with a few games, each kind of mistake is said with how often, and the
//     page says how many games it needs before it will say whether any is
//     getting rarer;
//   - with enough, each kind carries its two counts — the games before, and
//     the latest — and "rarer" or "more often" only where they are far enough
//     apart; the sentence at the top names what happens most often lately;
//   - that sentence is about the LATEST games, not all of them, and what it
//     names is not named a second time underneath; no more than two kinds are
//     listed as rarer; and when the latest games have none of any of these,
//     that is what is said;
//   - two windows judged in different ways are said to be;
//   - mistakes with no name are counted and said;
//   - the page's own choice of time control narrows all of it;
//   - a position gone wrong in more than once, in the opening, is listed with
//     how it was reached, how often, what was played and what was wanted, and
//     opens on the analysis board with both moves drawn; where the moves that
//     led to it were not kept, it is said by its move number and whose move;
//   - with puzzles to choose from there is a way straight to ten aimed at
//     these, and without, no button;
//   - and with no mistake that has a name there is no list of kinds at all —
//     though a position gone wrong in twice is still listed.
const { launch, serve, DIST } = require('./browser.cjs');
const path = require('path');

const PORT = 8341;
const base = `http://127.0.0.1:${PORT}/`;

// The Italian after 3...Nf6, White to play: the position gone wrong in below.
const SPOT = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
const ITALIAN = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6';

const mistake = (themes, extra = {}) => ({ kind: 'material', severity: 'mistake', ply: 31, san: 'Qh5', uci: 'd1h5', loss: 150, themes, ...extra });
const game = (at, mistakes, extra = {}) => ({
  at, white: 'You', black: 'Them', result: '1-0', side: 'white', accuracy: 80, plies: 60, meanLoss: 40, depth: 7, judge: 'app',
  pgn: '1. d4 d5', tactics: 0, estimate: null, mistakes, ...extra,
});
const wrongAt = (san, uci, loss) => mistake([], { ply: 7, san, uci, fen: SPOT, side: 'white', best: { san: 'd3', uci: 'd2d3' }, loss });

// A pack small enough to say there is one.
const STAND_IN = () => {
  const real = window.fetch;
  const row = (id, rating) => `${id}\t${rating}\tA\trnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2\tg2g4 d8h4`;
  const rows = Array.from({ length: 40 }, (_, i) => row(`p${String(i).padStart(4, '0')}`, 700 + i * 10));
  const text = ['# a pack for the tests', '# themes mateIn1', ...rows].join('\n') + '\n';
  window.fetch = async (url, options) => {
    const which = /puzzle-pack\.(json|txt)$/.exec(String(url))?.[1];
    if (!which) return real(url, options);
    if ((localStorage.getItem('test:pack') ?? 'none') === 'none') return which === 'json' ? new Response('{"format": 1, "count": 0}') : new Response('', { status: 404 });
    return which === 'json' ? new Response(JSON.stringify({ format: 1, count: rows.length })) : new Response(text);
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
    say(what, ok ? String(typeof got === 'string' ? got : JSON.stringify(got)).slice(0, 130)
      : `${JSON.stringify(got).slice(0, 700)}   <- expected ${JSON.stringify(want).slice(0, 700)}`);
    if (!ok) failures.push(what);
  };
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(STAND_IN);

  const up = async () => {
    await page.waitForSelector('#tab-today', { timeout: 20000 });
    await page.waitForFunction(() => typeof Weak !== 'undefined' && Weak.about !== undefined, null, { timeout: 20000 });
  };
  const load = (games) => page.evaluate((gs) => {
    App.reviews.games = gs;
    Progress.timeClass = 'all';
    show('progress');
  }, games);
  const panel = () => page.evaluate(() => {
    const p = document.getElementById('patterns');
    if (!p) return null;
    return {
      says: [...p.querySelectorAll('.coach-points p')].map((e) => e.textContent),
      rows: [...p.querySelectorAll('.record-row')].map((r) => `${r.querySelector('.record-band').textContent} | ${r.querySelector('.record-score').textContent}`),
      notes: [...p.querySelectorAll(':scope > .note')].map((e) => e.textContent),
      button: p.querySelector('#patternsWeak')?.textContent ?? null,
    };
  });
  const spots = () => page.evaluate(() => {
    const p = document.getElementById('patternPositions');
    if (!p) return null;
    return { title: p.querySelector('h3').textContent, items: [...p.querySelectorAll('.pattern-spot')].map((s) => [...s.querySelectorAll('p')].map((e) => e.textContent)) };
  });

  await page.goto(base);
  await up();

  // ── A: a few games ───────────────────────────────────────────────────────
  await load([
    game(1, [mistake(['fork']), mistake(['hangingPiece'])]),
    game(2, [mistake(['fork', 'hangingPiece']), mistake([])]),
    game(3, [mistake(['fork'])]),
    game(4, []),
    game(5, [mistake(['pin'])]),
    game(6, [mistake(['lostMaterial']), mistake([])]),
  ]);
  let p = await panel();
  check('A: with a few games, the page says what happens most often, and how often', p.says,
    ['Most often: allowing a fork — about once every 2 games over your 6 analysed games.']);
  check('A: every kind is listed with its count, most frequent first, and no trend', p.rows, [
    'Allowing a fork | 3 in 6 games · about once every 2 games',
    'Leaving a piece loose | 2 in 6 games · about once every 3 games',
    'Losing material with no trick behind it | 1 in 6 games · about once every 6 games',
    'Getting pinned | 1 in 6 games · about once every 6 games',
  ]);
  check('A: and it says how many games it needs before it will speak of rarer', p.notes[0].endsWith('With 16 analysed games this will also say whether each is getting rarer; there are 6 so far.'), true);
  check('A: mistakes that could not be named are counted and said', p.notes[1].startsWith('2 of your 8 mistakes could not be given a name'), true);
  check('A: with no puzzles beside the page there is no button to them', p.button, null);
  check('A: no position has been gone wrong in twice, so none is listed', await spots(), null);
  check('A: the old list of counts is gone, not kept beside the new one',
    await page.$eval('#progressOut', (e) => e.textContent.includes('What your mistakes have in common')), false);

  // ── B: enough games for two windows ──────────────────────────────────────
  const twenty = [];
  for (let i = 0; i < 20; i++) {
    const list = [mistake(['hangingPiece'])];
    if (i < 10 || i >= 18) list.push(mistake(['fork']));
    if (i >= 14) list.push(mistake(['pin']));
    if (i === 3 || i === 12) list.push(mistake(['skewer']));
    twenty.push(game(100 + i, list));
  }
  await load(twenty);
  p = await panel();
  check('B: the sentence at the top is about the latest games, and says how they compare', p.says[0],
    'Most often lately: leaving a piece loose — about 1 a game over your latest 10 analysed games, about as often as in the 10 before.');
  check('B: what has got rarer is said with its two counts', p.says[1], 'Getting rarer: allowing a fork (10, then 2).');
  check('B: and what is coming up more', p.says[2], 'Coming up more: getting pinned (0, then 6).');
  check('B: every kind carries both counts and what they come to', p.rows, [
    'Leaving a piece loose | 20 in 20 games · about 1 a game · 10, then 10: about the same',
    'Allowing a fork | 12 in 20 games · about once every 2 games · 10, then 2: rarer',
    'Getting pinned | 6 in 20 games · about once every 3 games · 0, then 6: more often',
    'Getting skewered | 2 in 20 games · about once every 10 games · 1, then 1: too few to say',
  ]);
  check('B: the note says what the two numbers are', p.notes[0].includes('The two numbers after each are your 10 analysed games before the latest 10, and then the latest 10'), true);
  check('B: games all judged one way carry no warning about it', p.notes.some((n) => n.includes('not all judged the same way')), false);

  // What happens most often LATELY is not what has happened most often: two
  // forks, a loose piece and a skewer in each of the first ten games, and a
  // pin in each of the last ten.
  const turned = [];
  for (let i = 0; i < 20; i++) {
    turned.push(game(200 + i, i < 10
      ? [mistake(['fork']), mistake(['fork']), mistake(['hangingPiece']), mistake(['skewer'])]
      : [mistake(['pin'])]));
  }
  await load(turned);
  p = await panel();
  check('B: the sentence at the top names what came up most in the LATEST games, with its rate over them', p.says[0],
    'Most often lately: getting pinned — about 1 a game over your latest 10 analysed games, which is more often than in the 10 before.');
  check('B: what it names is not named again underneath, and no more than two kinds are listed as rarer', p.says.slice(1),
    ['Getting rarer: allowing a fork (20, then 0); leaving a piece loose (10, then 0).']);
  check('B: though every kind is still in the list with its numbers', p.rows.map((r) => r.split(' | ')[0]),
    ['Allowing a fork', 'Leaving a piece loose', 'Getting pinned', 'Getting skewered']);

  // And when the latest games have none of any of these, that is what is said.
  await load(turned.map((g, i) => (i < 10 ? g : { ...g, mistakes: [] })));
  p = await panel();
  check('B: with nothing in the latest games, the page says so rather than naming a "most often lately"', p.says[0],
    'None of these came up in your latest 10 analysed games. Over all 20, most often: allowing a fork — about 1 a game.');
  check('B: and what has got rarer is all said, the most frequent included', p.says.slice(1),
    ['Getting rarer: allowing a fork (20, then 0); leaving a piece loose (10, then 0).']);

  // ── C: windows judged differently ────────────────────────────────────────
  await load(twenty.map((g, i) => (i >= 10 ? { ...g, judge: 'stockfish' } : g)));
  check('C: two windows judged by different judges are said to be',
    (await panel()).notes.some((n) => n.startsWith('Those two sets of games were not all judged the same way')), true);

  // ── D: the page's choice of time control narrows it ──────────────────────
  const clocked = twenty.map((g, i) => ({ ...g, timeClass: i % 2 ? 'blitz' : 'rapid' }));
  await load(clocked);
  await page.click('#progressOut button[data-time-class="blitz"]');
  p = await panel();
  check('D: with blitz chosen, only the blitz games are counted', p.rows[0], 'Leaving a piece loose | 10 in 10 games · about 1 a game');
  check('D: and ten games are too few for two windows, which is said', p.notes[0].endsWith('there are 10 so far.'), true);

  // ── E: a position gone wrong in more than once ───────────────────────────
  const italian = [
    game(1, [wrongAt('Ng5', 'f3g5', 120)], { pgn: `${ITALIAN} 4. Ng5 d5` }),
    game(2, [wrongAt('Ng5', 'f3g5', 80), mistake(['fork'])], { pgn: `1. e4 e5 2. Bc4 Nc6 3. Nf3 Nf6 4. Ng5 d5` }),
    game(3, [mistake(['fork'])], { pgn: `${ITALIAN} 4. d3 Be7` }),
    game(4, [wrongAt('Qe2', 'd1e2', 100)], { pgn: `${ITALIAN} 4. Qe2 Bc5` }),
    game(5, [], { pgn: '1. e4 c5 2. Nf3 d6' }),
  ];
  await load(italian);
  const s = await spots();
  check('E: one position is listed', [s.title, s.items.length], ['A position you keep going wrong in', 1]);
  check('E: with how one of the games reached it', s.items[0][0], `After ${ITALIAN}`);
  check('E: how often it was reached and gone wrong in, what was played, what was wanted and what it cost', s.items[0][1],
    'Reached 4 times, gone wrong in 3: you played Ng5 twice and Qe2 once. The reviewer wanted d3. It cost about 1.0 points each time.');
  await page.click('#patternPositions .pattern-spot button');
  check('E: "Look at it" opens the position on the analysis board', await page.evaluate(() => [App.section, Practice.view.board.fen().split(' ').slice(0, 2).join(' ')]),
    ['board', SPOT.split(' ').slice(0, 2).join(' ')]);
  check('E: with the move usually played and the move wanted both drawn',
    await page.evaluate(() => Practice.view.arrows.map((a) => `${a.kind} ${squareName(a.from)}${squareName(a.to)}`)), ['played f3g5', 'best d2d3']);

  // Where the moves that led there were not kept, the position is said by its
  // move number and whose move it is — for either side.
  const BLACK_SPOT = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
  const asBlack = (at) => game(at, [mistake([], { ply: 6, san: 'Nd4', uci: 'c6d4', fen: BLACK_SPOT, side: 'black', best: { san: 'Nf6', uci: 'g8f6' }, loss: 90 })], { side: 'black' });
  await load([
    game(11, [wrongAt('Ng5', 'f3g5', 120)]), game(12, [wrongAt('Ng5', 'f3g5', 120)]), game(13, [wrongAt('Ng5', 'f3g5', 120)]),
    asBlack(14), asBlack(15),
  ]);
  const unkept = await spots();
  check('E: two positions are headed as several, the one gone wrong in most first', [unkept.title, unkept.items.length], ['Positions you keep going wrong in', 2]);
  check('E: with no moves kept, each is said by its move number and whose move it is', unkept.items.map((i) => i[0]),
    ['A position on move 4, with White to play', 'A position on move 3, with Black to play']);
  check('E: and reached is no fewer than gone wrong', unkept.items.map((i) => i[1].split(':')[0]),
    ['Reached 3 times, gone wrong in 3', 'Reached twice, gone wrong in 2']);
  // None of those mistakes had a name, so there is no list of kinds — and the positions are listed all the same.
  check('E: positions are listed even when no mistake could be given a name', await panel(), null);

  // A position gone wrong in once is not listed, however many times it was reached.
  await load(italian.slice(2));
  check('E: gone wrong in once, it is not listed', await spots(), null);

  // ── F: puzzles beside the page ───────────────────────────────────────────
  await page.evaluate(() => localStorage.setItem('test:pack', 'usual'));
  await page.reload();
  await up();
  await load(twenty);
  check('F: with puzzles to choose from, there is a way straight to ten aimed at these', (await panel()).button, 'Ten puzzles aimed at these');
  await page.click('#patternsWeak');
  await page.waitForFunction(() => Weak.current && Weak.view.interactive, null, { timeout: 15000 });
  check('F: and it starts them', await page.evaluate(() => [App.section, Weak.set.slots.length]), ['weak', 10]);
  await page.click('#weakStop');

  // ── G: nothing with a name ───────────────────────────────────────────────
  await load([game(1, [mistake([])]), game(2, [])]);
  check('G: with no mistake that has a name, there is no such panel', await panel(), null);

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
