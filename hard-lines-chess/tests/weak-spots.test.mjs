// The puzzles aimed at what goes wrong in your games: the choosing and the
// judging, held to their rules without a browser.
//
// WHAT WOULD GO WRONG QUIETLY. None of this crashes when it is wrong. A set
// "aimed at forks" that is ten random puzzles looks like a set; a level that
// moves the wrong way is still a number; a pick that ignores what has been
// solved hands out the same puzzle twice and nothing complains. So each rule
// src/weak-spots.js states is checked here against a case where breaking it
// gives a different answer.
import { readFileSync } from 'node:fs';

const src = [
  readFileSync(new URL('../src/engine/bundle.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/notation.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/pgn.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/motifs.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/weak-spots.js', import.meta.url), 'utf8'),
].join('\n');
const S = new Function('window', 'localStorage', src
  + '; return { Board, MOTIFS, WEAK_AIMS, PUZZLE_THEME_WORDS, WEAK_THEME_CODES, WEAK_SET_SIZE, WEAK_REPEATS_IN_A_SET,'
  + ' WEAK_AIMS_IN_A_SET, WEAK_EASIER, WEAK_SPREAD, WEAK_LEVEL_START, WEAK_LEVEL_MIN, WEAK_LEVEL_MAX,'
  + ' weakSpotsData, parsePuzzlePack, packRowId, readPackRow, packIndexOf, pickPackPuzzle, weakSpotAims, planWeakSet,'
  + ' weakTargetRating, nextWeakLevel, openPackPuzzle, packMoveIsRight, packLineText, packThemeWords };')({}, undefined);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL', name, extra); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const throws = (name, fn, saying) => {
  let said = null;
  try { fn(); } catch (e) { said = e.message; }
  ok(name, said !== null && (!saying || saying.test(said)), `said ${JSON.stringify(said)}`);
};
const seeded = (seed) => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

// ── the two vocabularies meet in one place ────────────────────────────────
//
// A mistake's name is the classifier's; a puzzle theme is the database's.
// Everything a mistake can be called either crosses to puzzle themes or is
// lostMaterial, which by its own definition has no trick to aim at — and
// every theme crossed to has words, or the screen would print a raw tag.
for (const name of S.MOTIFS.VOCABULARY) {
  if (name === 'lostMaterial') ok('lostMaterial is aimed at nothing', S.WEAK_AIMS[name] === undefined);
  else ok(`${name} crosses to at least one puzzle theme`, Array.isArray(S.WEAK_AIMS[name]) && S.WEAK_AIMS[name].length > 0);
}
ok('and nothing is crossed from a name no mistake can have',
  Object.keys(S.WEAK_AIMS).every((name) => S.MOTIFS.VOCABULARY.includes(name)));
for (const theme of new Set(Object.values(S.WEAK_AIMS).flat())) {
  ok(`${theme} has words for a list and for one puzzle`,
    Boolean(S.PUZZLE_THEME_WORDS[theme]?.many) && Boolean(S.PUZZLE_THEME_WORDS[theme]?.one));
}

// ── a pack, as the tool writes one ────────────────────────────────────────
const THEMES = ['fork', 'pin', 'mateIn1', 'mate', 'hangingPiece'];
const code = (names) => names.map((n) => S.WEAK_THEME_CODES[THEMES.indexOf(n)]).join('');
const FOOL = ['rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2', 'g2g4 d8h4'];
const LEGAL = ['rn1qkbnr/ppp2p1p/3p2p1/4N3/2B1P1b1/2N5/PPPP1PPP/R1BQK2R b KQkq - 0 5', 'g4d1 c4f7 e8e7 c3d5'];
const FORK = ['r3k3/p7/8/3N4/8/8/8/4K3 b - - 0 1', 'a7a6 d5c7 e8e7 c7a8'];
const row = (id, rating, names, [fen, moves]) => `${id}\t${rating}\t${code(names)}\t${fen}\t${moves}`;
const packText = (rows) => ['# a pack for the tests', `# themes ${THEMES.join(' ')}`, ...rows].join('\n') + '\n';

const ROWS = [
  row('aaaaa', 600, ['fork'], FORK),
  row('bbbbb', 800, ['mateIn1', 'mate'], FOOL),
  row('ccccc', 800, ['fork'], FORK),
  row('ddddd', 1000, ['pin'], FORK),
  row('eeeee', 1200, ['fork', 'pin'], FORK),
  row('fffff', 1500, ['mateIn1', 'mate'], FOOL),
  row('ggggg', 1900, ['fork'], FORK),
];
const pack = S.parsePuzzlePack(packText(ROWS));

same('a pack is read: how many, and which themes', [pack.count, pack.themes], [7, THEMES]);
same('each theme knows where its puzzles are, in order of rating',
  [pack.byTheme.get('fork'), pack.byTheme.get('pin'), pack.byTheme.get('mateIn1'), pack.byTheme.get('hangingPiece')],
  [[0, 2, 4, 6], [3, 4], [1, 5], []]);
same('a row reads back whole',
  (({ id, rating, themes, fen, moves }) => ({ id, rating, themes, fen, moves }))(S.readPackRow(pack.rows[4], pack.themes)),
  { id: 'eeeee', rating: 1200, themes: ['fork', 'pin'], fen: FORK[0], moves: FORK[1].split(' ') });
same('a puzzle is found by its id, and one that is not there is not', [S.packIndexOf(pack, 'fffff'), S.packIndexOf(pack, 'zzzzz')], [5, -1]);
ok('something that is not a row reads as nothing', S.readPackRow('not a row', THEMES) === null);

throws('a pack out of order is refused', () => S.parsePuzzlePack(packText([ROWS[3], ROWS[1]])), /order of rating/);
throws('a pack that does not name its themes is refused', () => S.parsePuzzlePack(ROWS.join('\n')), /themes/);
throws('a pack with no puzzles is refused', () => S.parsePuzzlePack(`# themes ${THEMES.join(' ')}\n`), /no puzzles/);
throws('a row with a theme letter the pack never named is refused',
  () => S.parsePuzzlePack(packText([`xxxxx\t900\tZ\t${FORK[0]}\t${FORK[1]}`])), /cannot be read/);
throws('a row with no rating is refused', () => S.parsePuzzlePack(packText([`xxxxx\tmany\tA\t${FORK[0]}\t${FORK[1]}`])), /cannot be read/);

// ── the nearest one that has not been taken ───────────────────────────────
const pick = (opts) => {
  const i = S.pickPackPuzzle(pack, { taken: new Set(), ...opts });
  return i < 0 ? null : S.packRowId(pack.rows[i]);
};
same('the nearest by rating, whatever its theme', pick({ around: 1010 }), 'ddddd');
same('nearest from below as readily as from above', pick({ around: 1180 }), 'eeeee');
same('with a theme, the nearest of that theme', pick({ around: 1010, theme: 'fork' }), 'eeeee');
same('one already taken is passed over for the next nearest', pick({ around: 1010, theme: 'fork', taken: new Set(['eeeee']) }), 'ccccc');
same('and so on outwards until one is left', pick({ around: 1010, theme: 'fork', taken: new Set(['eeeee', 'ccccc', 'aaaaa']) }), 'ggggg');
same('none left is none', pick({ around: 1010, theme: 'fork', taken: new Set(['aaaaa', 'ccccc', 'eeeee', 'ggggg']) }), null);
same('a theme the pack has nothing of is none', pick({ around: 1000, theme: 'hangingPiece' }), null);
same('a theme the pack has never heard of is none', pick({ around: 1000, theme: 'skewer' }), null);
same('nothing further than the reach is offered', pick({ around: 1010, theme: 'mateIn1', reach: 150 }), null);
same('and something inside it is', pick({ around: 1010, theme: 'mateIn1', reach: 250 }), 'bbbbb');
same('below everything, the lowest', pick({ around: 100 }), 'aaaaa');
same('above everything, the highest', pick({ around: 3000 }), 'ggggg');
// Every puzzle is given out exactly once when each pick is taken.
{
  const taken = new Set();
  const order = [];
  for (let n = 0; n < 9; n++) {
    const i = S.pickPackPuzzle(pack, { around: 1000, taken });
    if (i < 0) break;
    order.push(S.packRowId(pack.rows[i]));
    taken.add(order[order.length - 1]);
  }
  same('taking each pick hands out every puzzle once, nearest first',
    order, ['ddddd', 'eeeee', 'ccccc', 'bbbbb', 'aaaaa', 'fffff', 'ggggg']);
}

// ── what the games say to aim at ──────────────────────────────────────────
const game = (at, themesOfEach, extra = {}) => ({ at, mistakes: themesOfEach.map((themes) => ({ themes })), ...extra });
{
  const found = S.weakSpotAims([
    game(1, [['fork'], ['fork', 'hangingPiece'], []]),
    game(2, [['pin'], ['lostMaterial'], ['fork']]),
  ]);
  same('games, mistakes, and how many had a name', [found.games, found.mistakes, found.named], [2, 6, 5]);
  same('every theme of a mistake is counted, most frequent first',
    found.aims.map((a) => [a.theme, a.weight]), [['fork', 3], ['hangingPiece', 1], ['pin', 1]]);
  same('and each aim says which mistakes it came from', found.aims[0].from, [{ mistake: 'fork', count: 3 }]);
  ok('a loss with no trick behind it is aimed at nothing', !found.aims.some((a) => a.theme === 'lostMaterial'));
}
{
  const found = S.weakSpotAims([game(1, [['missedMate'], ['missedMate'], ['missedMate'], ['mateIn1']])]);
  same('a missed mate is shared among the short mates, on top of what they have themselves',
    found.aims.map((a) => [a.theme, a.weight]), [['mateIn1', 2], ['mateIn2', 1], ['mateIn3', 1]]);
  same('and says both sources', found.aims[0].from, [{ mistake: 'missedMate', count: 3 }, { mistake: 'mateIn1', count: 1 }]);
}
{
  const games = [];
  for (let i = 0; i < 60; i++) games.push(game(i, [[i < 10 ? 'pin' : 'fork']]));
  const found = S.weakSpotAims(games, 50);
  same('only the latest fifty analysed games are counted', [found.games, found.aims.map((a) => a.theme)], [50, ['fork']]);
  // The same games in another order are the same latest fifty.
  same('latest by when they were played, not by where they sit in the list',
    S.weakSpotAims([...games].reverse(), 50).aims.map((a) => [a.theme, a.weight]), [['fork', 50]]);
}
{
  const found = S.weakSpotAims([
    game(1, [['fork']], { reviewed: false }),
    { at: 2 },
    game(3, [['pin']]),
  ]);
  same('a game that was imported and never analysed says nothing', [found.games, found.aims.map((a) => a.theme)], [1, ['pin']]);
  same('no games at all is no aims', S.weakSpotAims([]), { games: 0, mistakes: 0, named: 0, aims: [] });
  same('nor is nothing', S.weakSpotAims(undefined).aims, []);
}

// ── a set of ten ──────────────────────────────────────────────────────────
const aims = (pairs) => pairs.map(([theme, weight]) => ({ theme, weight, from: [] }));
// How many places each thing got, whatever order the shuffle left them in.
const shape = (slots) => {
  const count = {};
  for (const s of slots) { const k = s.kind === 'aimed' ? s.theme : s.kind; count[k] = (count[k] ?? 0) + 1; }
  return Object.keys(count).sort().map((k) => `${k} ${count[k]}`).join(', ');
};
same('with nothing to aim at, a set is all mix', shape(S.planWeakSet([], { rng: seeded(1) })), 'mixed 10');
same('one aim takes seven of ten', shape(S.planWeakSet(aims([['fork', 5]]), { rng: seeded(1) })), 'fork 7, mixed 3');
same('two aims share the seven as they came up',
  shape(S.planWeakSet(aims([['fork', 14], ['hangingPiece', 7]]), { rng: seeded(1) })), 'fork 5, hangingPiece 2, mixed 3');
same('a rare aim among the leaders still gets one',
  shape(S.planWeakSet(aims([['fork', 40], ['pin', 1], ['skewer', 1]]), { rng: seeded(1) })), 'fork 5, mixed 3, pin 1, skewer 1');
same('no more than four aims in a set',
  shape(S.planWeakSet(aims([['fork', 5], ['pin', 4], ['skewer', 3], ['mateIn1', 2], ['mateIn2', 1], ['mateIn3', 1]]), { rng: seeded(1) })),
  'fork 3, mateIn1 1, mixed 3, pin 2, skewer 1');
same('puzzles due again take the mix\'s places first',
  shape(S.planWeakSet(aims([['fork', 5]]), { repeats: 2, rng: seeded(1) })), 'again 2, fork 7, mixed 1');
same('and never more than three of a set',
  shape(S.planWeakSet(aims([['fork', 5]]), { repeats: 9, rng: seeded(1) })), 'again 3, fork 7');
same('a shorter set keeps the proportions',
  shape(S.planWeakSet(aims([['fork', 5]]), { size: 5, rng: seeded(1) })), 'fork 4, mixed 1');
for (let seed = 1; seed <= 25; seed++) {
  const slots = S.planWeakSet(aims([['fork', 9], ['pin', 5], ['skewer', 2]]), { repeats: seed % 5, rng: seeded(seed) });
  if (slots.length !== 10) { ok(`a set is ten whatever the shuffle (seed ${seed})`, false, `got ${slots.length}`); break; }
  if (seed === 25) ok('a set is ten whatever the shuffle', true);
}
{
  const a = S.planWeakSet(aims([['fork', 9], ['pin', 5]]), { rng: seeded(3) }).map((s) => s.theme ?? s.kind).join(' ');
  const b = S.planWeakSet(aims([['fork', 9], ['pin', 5]]), { rng: seeded(4) }).map((s) => s.theme ?? s.kind).join(' ');
  const flat = 'fork fork fork fork fork pin pin mixed mixed mixed';
  ok('the order is shuffled, and not the same shuffle every time', a !== b && (a !== flat || b !== flat), `${a} | ${b}`);
}

// ── the level ─────────────────────────────────────────────────────────────
ok('solving moves the level up', S.nextWeakLevel(1000, 50, 1000, true) > 1000);
ok('missing moves it down', S.nextWeakLevel(1000, 50, 1000, false) < 1000);
same('by the same amount each way at an even match', [S.nextWeakLevel(1000, 50, 1000, true), S.nextWeakLevel(1000, 50, 1000, false)], [1012, 988]);
ok('solving a harder one is worth more than solving an easier one',
  S.nextWeakLevel(1000, 50, 1400, true) - 1000 > S.nextWeakLevel(1000, 50, 600, true) - 1000);
ok('and missing an easier one costs more than missing a harder one',
  1000 - S.nextWeakLevel(1000, 50, 600, false) > 1000 - S.nextWeakLevel(1000, 50, 1400, false));
same('the first puzzles move it furthest, and it settles after thirty',
  [0, 9, 10, 29, 30, 500].map((n) => S.nextWeakLevel(1000, n, 1000, true) - 1000), [32, 32, 20, 20, 12, 12]);
same('it is kept inside its limits', [S.nextWeakLevel(S.WEAK_LEVEL_MAX, 0, 3200, true), S.nextWeakLevel(S.WEAK_LEVEL_MIN, 0, 200, false)],
  [S.WEAK_LEVEL_MAX, S.WEAK_LEVEL_MIN]);
{
  const rng = seeded(11);
  let lo = Infinity, hi = -Infinity, sum = 0;
  for (let i = 0; i < 2000; i++) { const r = S.weakTargetRating(1500, rng); lo = Math.min(lo, r); hi = Math.max(hi, r); sum += r; }
  ok('puzzles are looked for a little under the level, and not at one spot',
    lo >= 1500 - S.WEAK_EASIER - S.WEAK_SPREAD && hi <= 1500 - S.WEAK_EASIER + S.WEAK_SPREAD
    && hi - lo > S.WEAK_SPREAD && Math.abs(sum / 2000 - (1500 - S.WEAK_EASIER)) < 10, `${lo}..${hi}, mean ${sum / 2000}`);
}

// ── one puzzle on a board ─────────────────────────────────────────────────
{
  const opened = S.openPackPuzzle(S.readPackRow(row('legal', 1100, ['mate'], LEGAL), THEMES));
  ok('a puzzle sets up', opened !== null);
  same('the move that set it up is known, and said the way it is written', [opened.theirUci, opened.theirSan], ['g4d1', 'Bxd1']);
  same('the solver is the side to move after it', [opened.side, opened.moveNumber, opened.yours], ['white', 6, 2]);
  same('the position asked about is one move in',
    opened.start, 'rn1qkbnr/ppp2p1p/3p2p1/4N3/2B1P3/2N5/PPPP1PPP/R1BbK2R w KQkq - 0 6');
  same('the line is the solver\'s moves and the replies between them',
    opened.line.map((s) => [s.san, s.mine]), [['Bxf7+', true], ['Ke7', false], ['Nd5#', true]]);
  same('written out the way a line is', S.packLineText(opened), '6. Bxf7+ Ke7 7. Nd5#');

  ok('the move in the line is right', S.packMoveIsRight(opened.line[0], 'c4f7'));
  ok('another move is not', !S.packMoveIsRight(opened.line[0], 'e5f7'));
  ok('nor is one that is not legal', !S.packMoveIsRight(opened.line[0], 'c4c8'));
  ok('nor is nothing at all', !S.packMoveIsRight(opened.line[0], ''));
}
{
  const opened = S.openPackPuzzle(S.readPackRow(row('fool', 700, ['mateIn1', 'mate'], FOOL), THEMES));
  same('black to move is written with the dots', [opened.side, S.packLineText(opened)], ['black', '2... Qh4#']);
}
{
  // Two ways to give mate: the line records one, and the other is as right.
  const two = S.openPackPuzzle({ id: 'two', rating: 900, themes: [], fen: '6k1/5ppp/8/n7/8/8/1Q3PPP/R5K1 b - - 0 1', moves: ['a5c4', 'a1a8'] });
  ok('a second position sets up', two !== null);
  ok('the move in the line gives mate', S.packMoveIsRight(two.line[0], 'a1a8'));
  ok('and another move that gives mate on the spot is right as well', S.packMoveIsRight(two.line[0], 'b2b8'));
  ok('a check that is not mate is not', !S.packMoveIsRight(two.line[0], 'b2g7'));
}
ok('a puzzle whose first move cannot be played is not set up',
  S.openPackPuzzle({ id: 'x', rating: 900, themes: [], fen: FOOL[0], moves: ['g2g5', 'd8h4'] }) === null);
ok('nor one with a later move that cannot be',
  S.openPackPuzzle({ id: 'x', rating: 900, themes: [], fen: FOOL[0], moves: ['g2g4', 'd8h5'] }) === null);
// Every move of this one is legal; what is wrong with it is whose move comes last.
ok('nor one that ends on the other side\'s move',
  S.openPackPuzzle({ id: 'x', rating: 900, themes: [], fen: FORK[0], moves: ['a7a6', 'd5c7', 'e8e7'] }) === null);
ok('nor one with nothing for the solver to do',
  S.openPackPuzzle({ id: 'x', rating: 900, themes: [], fen: FOOL[0], moves: ['g2g4'] }) === null);
same('themes are said in the solver\'s words, and one with no words is left out',
  S.packThemeWords(['fork', 'mate', 'sacrifice', 'opening']), ['a fork', 'a sacrifice']);

// ── what is stored ────────────────────────────────────────────────────────
same('with nothing stored, it starts',
  S.weakSpotsData(null), { level: S.WEAK_LEVEL_START, counted: 0, done: [], again: [], log: [] });
same('a stored copy missing parts is filled in, and what it has is kept',
  S.weakSpotsData({ level: 1234, done: ['aaaaa', 7], lastSet: 99 }),
  { level: 1234, done: ['aaaaa'], lastSet: 99, counted: 0, again: [], log: [] });
same('a level that is not a number starts again, and one outside the limits is brought in',
  [S.weakSpotsData({ level: 'high' }).level, S.weakSpotsData({ level: 99999 }).level, S.weakSpotsData({ level: -5 }).level],
  [S.WEAK_LEVEL_START, S.WEAK_LEVEL_MAX, S.WEAK_LEVEL_MIN]);
same('a missed puzzle stored without its puzzle is dropped',
  S.weakSpotsData({ again: [{ card: {} }, { puzzle: { id: 'aaaaa' }, card: {} }, null] }).again.length, 1);

console.log(`weak spots: ${pass} checks passed${fail ? `, ${fail} FAILED` : ''}`);
if (fail) process.exit(1);
