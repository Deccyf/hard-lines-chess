// What keeps happening: how often each kind of mistake comes up, whether it
// is getting rarer, and positions gone wrong in more than once.
//
// THE FAULT WORTH CATCHING is a page that says something has got rarer when
// it has not — or says you keep going wrong in a position you have only gone
// wrong in once. Both read as coaching and both would be acted on. So the
// cases here are the edges: counts that differ by luck and counts that differ
// by more than luck, a game listed twice, a game whose moves were not kept,
// and the same position reached by another order of moves.
import { readFileSync } from 'node:fs';

const src = [
  readFileSync(new URL('../src/engine/bundle.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/notation.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/pgn.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/patterns.js', import.meta.url), 'utf8'),
].join('\n');
const S = new Function('window', 'localStorage', src
  + '; return { Board, parsePgn, sanToMove, PATTERN_WINDOW, PATTERN_MIN_GAMES, PATTERN_OPENING_PLIES, PATTERN_POSITIONS,'
  + ' patternTrend, mistakePatterns, positionKey, recurringMistakes, howOftenWords };')({}, undefined);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL', name, extra); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ── has it moved, or is it luck ───────────────────────────────────────────
same('nine and then three is rarer', S.patternTrend(9, 3), 'rarer');
same('three and then nine is more often', S.patternTrend(3, 9), 'more');
same('six and then three is not enough to say', S.patternTrend(6, 3), 'same');
same('three and then two is not rarer', S.patternTrend(3, 2), 'same');
same('the same both times is the same', S.patternTrend(5, 5), 'same');
same('four and then none is rarer', S.patternTrend(4, 0), 'rarer');
same('three in all is too few to compare', [S.patternTrend(3, 0), S.patternTrend(0, 3), S.patternTrend(2, 1), S.patternTrend(0, 0)],
  ['unknown', 'unknown', 'unknown', 'unknown']);
same('a big count needs a bigger step: forty and then thirty is not enough', S.patternTrend(40, 30), 'same');
same('and forty and then twenty-five is', S.patternTrend(40, 25), 'rarer');
// It is the same judgement whichever way round the two are.
for (const [a, b] of [[9, 3], [6, 3], [12, 4], [20, 11], [5, 0], [7, 7]]) {
  const forward = S.patternTrend(a, b), back = S.patternTrend(b, a);
  const mirrored = { rarer: 'more', more: 'rarer', same: 'same', unknown: 'unknown' }[forward];
  if (back !== mirrored) { ok(`${a} then ${b} and ${b} then ${a} are judged alike`, false, `${forward} / ${back}`); break; }
}
ok('a rise and a fall of the same size are judged alike', true);

// ── how often, and over which games ───────────────────────────────────────
const game = (at, themesOfEach, extra = {}) => ({ at, side: 'white', mistakes: themesOfEach.map((themes) => ({ themes })), ...extra });
{
  // Twenty games: a fork in every one of the first ten, and in two of the last ten.
  const games = [];
  for (let i = 0; i < 20; i++) games.push(game(i, [i < 10 || i >= 18 ? ['fork'] : [], ['hangingPiece']]));
  const found = S.mistakePatterns(games);
  same('twenty games make two windows of ten', [found.games, found.window], [20, 10]);
  same('counted in each window, and over all the games',
    found.rows.map((r) => [r.theme, r.count, r.before, r.recent, r.trend]),
    [['hangingPiece', 20, 10, 10, 'same'], ['fork', 12, 10, 2, 'rarer']]);
  same('how often is per game', found.rows.map((r) => r.perGame), [1, 0.6]);
  same('and how many had a name, of how many', [found.named, found.mistakes], [32, 40]);
  ok('games all judged one way are not called mixed', found.mixed === false);
  // The same games handed over backwards are the same windows.
  same('the windows are the latest games by when they were played, not by where they sit',
    S.mistakePatterns([...games].reverse()).rows.map((r) => [r.theme, r.before, r.recent]), [['hangingPiece', 10, 10], ['fork', 10, 2]]);
}
{
  const games = [];
  for (let i = 0; i < 15; i++) games.push(game(i, [['fork']]));
  const found = S.mistakePatterns(games);
  same('fifteen games are too few for two windows of eight: no trend is offered', [found.window, found.rows[0].trend], [0, 'unknown']);
  same('but how often is still said', [found.rows[0].count, found.rows[0].perGame], [15, 1]);
  same('sixteen are enough', S.mistakePatterns([...games, game(15, [['fork']])]).window, 8);
}
{
  const games = [];
  for (let i = 0; i < 200; i++) games.push(game(i, [[i < 150 ? 'pin' : 'fork']]));
  const found = S.mistakePatterns(games);
  same('with a long history the windows are the latest twenty-five and the twenty-five before', found.window, 25);
  same('so what happened long ago does not count as "before"',
    found.rows.map((r) => [r.theme, r.count, r.before, r.recent, r.trend]), [['pin', 150, 0, 0, 'unknown'], ['fork', 50, 25, 25, 'same']]);
}
{
  const games = [];
  for (let i = 0; i < 16; i++) games.push(game(i, [['fork']], i < 8 ? { judge: 'app', depth: 7 } : { judge: 'stockfish', depth: 7 }));
  ok('windows judged by different judges are said to be', S.mistakePatterns(games).mixed === true);
  const deeper = games.map((g, i) => ({ ...g, judge: 'app', depth: i < 8 ? 7 : 12 }));
  ok('and so are windows judged at different depths', S.mistakePatterns(deeper).mixed === true);
  // Fifty games judged one way are the two windows; ten older ones judged another way are before both.
  const long = [...Array.from({ length: 50 }, (_, i) => game(100 + i, [['fork']], { judge: 'app', depth: 7 })),
    ...Array.from({ length: 10 }, (_, i) => game(i, [['fork']], { judge: 'reckless', depth: 12 }))];
  ok('a different judge long before the windows does not make them mixed', S.mistakePatterns(long).mixed === false);
  ok('but one inside them does', S.mistakePatterns([...long, game(120.5, [['fork']], { judge: 'reckless', depth: 12 })]).mixed === true);
}
{
  const found = S.mistakePatterns([game(1, [['fork']], { reviewed: false }), { at: 2 }, game(3, [['pin'], []])]);
  same('a game imported and never analysed says nothing', [found.games, found.rows.map((r) => r.theme)], [1, ['pin']]);
  // A mistake that is two things at once is counted as both, as it is everywhere else.
  same('every name a mistake was given is counted, not only the first',
    S.mistakePatterns([game(1, [['fork', 'pin'], ['pin']])]).rows.map((r) => [r.theme, r.count]), [['pin', 2], ['fork', 1]]);
  same('no games is nothing', S.mistakePatterns([]), { games: 0, window: 0, mixed: false, rows: [], mistakes: 0, named: 0 });
}

// ── the same position ─────────────────────────────────────────────────────
same('a position is the board, whose move, castling and en passant — not the move numbers',
  [S.positionKey('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'), S.positionKey('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 7 31')],
  ['rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -', 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -']);

// Real games, so that "reached" is read off moves and not typed in: the same
// position after 1.e4 e5 2.Nf3 Nc6 3.Bc4 by two orders of moves, and games
// that never get there.
const ITALIAN = '1. e4 e5 2. Nf3 Nc6 3. Bc4';
const OTHER_ORDER = '1. e4 e5 2. Bc4 Nc6 3. Nf3';
const SICILIAN = '1. e4 c5 2. Nf3 d6 3. d4';
const after = (moves) => {
  const board = new S.Board();
  for (const ply of S.parsePgn(moves).plies) board.make(S.sanToMove(board, ply.san));
  return board.fen();
};
const reachedIn = (g) => (g.pgn ? S.parsePgn(g.pgn, { maxPlies: 24 }).plies.filter((p) => p.colour === g.side).map((p) => S.positionKey(p.fenBefore)) : null);
const spot = after(`${ITALIAN} Nf6`);                    // White to play move four
const wrong = (san, uci, loss, ply = 7) => ({ ply, san, uci, fen: spot, side: 'white', best: { san: 'd3', uci: 'd2d3' }, loss, themes: [] });
const played = (at, moves, mistakes = []) => ({ at, side: 'white', pgn: moves, mistakes });
{
  const games = [
    played(1, `${ITALIAN} Nf6 4. Ng5 d5`, [wrong('Ng5', 'f3g5', 120)]),
    played(2, `${OTHER_ORDER} Nf6 4. Ng5 d5`, [wrong('Ng5', 'f3g5', 80)]),       // the same position, by another road
    played(3, `${ITALIAN} Nf6 4. d3 Be7`),                                        // reached, and played well
    played(4, `${ITALIAN} Nf6 4. Qe2 Bc5`, [wrong('Qe2', 'd1e2', 100)]),
    played(5, `${SICILIAN} cxd4 4. Nxd4`),                                        // never there
    played(6, `${ITALIAN} Bc5 4. c3 Nf6`),                                        // a different fourth move by Black
  ];
  const found = S.recurringMistakes(games, { reachedIn });
  same('one position, gone wrong in three games of the four that reached it', found.map((s) => [s.games, s.reached]), [[3, 4]]);
  same('with what was played, most often first', found[0].played.map((p) => [p.san, p.count]), [['Ng5', 2], ['Qe2', 1]]);
  same('what the reviewer wanted, the average of what it cost, and the latest game it happened in',
    [found[0].best, found[0].loss, found[0].from], [{ san: 'd3', uci: 'd2d3' }, 100, { at: 4, ply: 7 }]);
  same('whose move it is there', [found[0].side, S.positionKey(found[0].fen)], ['white', S.positionKey(spot)]);
  same('and each move played keeps its squares, for the arrow', found[0].played.map((p) => p.uci), ['f3g5', 'd1e2']);
}
{
  // The move played most is first, and the move wanted most is the one given —
  // whichever game happened to come first.
  const wanting = (san, uci, loss, best) => ({ ...wrong(san, uci, loss), best });
  const games = [
    played(1, `${ITALIAN} Nf6 4. Qe2 Bc5`, [wanting('Qe2', 'd1e2', 100, { san: 'd3', uci: 'd2d3' })]),
    played(2, `${ITALIAN} Nf6 4. Ng5 d5`, [wanting('Ng5', 'f3g5', 100, { san: 'O-O', uci: 'e1g1' })]),
    played(3, `${ITALIAN} Nf6 4. Ng5 d5`, [wanting('Ng5', 'f3g5', 100, { san: 'O-O', uci: 'e1g1' })]),
  ];
  const found = S.recurringMistakes(games, { reachedIn });
  same('the move played most often is first, though it was not played first', found[0].played.map((p) => [p.san, p.count]), [['Ng5', 2], ['Qe2', 1]]);
  same('and the move wanted is the one most often wanted, not the first one said', found[0].best, { san: 'O-O', uci: 'e1g1' });
}
{
  // The opening ends where it says: a move-twelve mistake by Black is in it, the move after is not.
  const late = (ply) => [1, 2].map((at) => ({ at, side: 'white', mistakes: [wrong('Ng5', 'f3g5', 120, ply)] }));
  same('the last ply of the opening counts, and the one after does not',
    [S.recurringMistakes(late(S.PATTERN_OPENING_PLIES)).length, S.recurringMistakes(late(S.PATTERN_OPENING_PLIES + 1)).length], [1, 0]);
}
{
  const games = [
    played(1, `${ITALIAN} Nf6 4. Ng5 d5`, [wrong('Ng5', 'f3g5', 120)]),
    played(2, `${ITALIAN} Nf6 4. Ng5 d5`, [wrong('Ng5', 'f3g5', 120)]),
    played(3, `${ITALIAN} Nf6 4. d3 Be7`),
  ];
  // A game that comes back to a position has still only been put in front of it once.
  const twice = (g) => [...reachedIn(g), ...reachedIn(g)];
  same('a game that reaches the position twice has reached it once', S.recurringMistakes(games, { reachedIn: twice }).map((s) => [s.games, s.reached]), [[2, 3]]);
  // And a game read differently from how it was reviewed cannot make "2 of 0".
  same('reached is never fewer than gone wrong, whatever the moves are read as',
    S.recurringMistakes(games, { reachedIn: () => [] }).map((s) => [s.games, s.reached]), [[2, 2]]);
}
same('gone wrong in once is not a pattern',
  S.recurringMistakes([played(1, `${ITALIAN} Nf6 4. Ng5`, [wrong('Ng5', 'f3g5', 120)]), played(2, `${ITALIAN} Nf6 4. d3`)], { reachedIn }), []);
same('the same game listing the position twice is still once',
  S.recurringMistakes([played(1, `${ITALIAN} Nf6 4. Ng5`, [wrong('Ng5', 'f3g5', 120), wrong('Ng5', 'f3g5', 120)])], { reachedIn }), []);
same('a mistake deep in the game is not an opening position',
  S.recurringMistakes([played(1, ITALIAN, [wrong('Ng5', 'f3g5', 120, 41)]), played(2, ITALIAN, [wrong('Ng5', 'f3g5', 120, 41)])], { reachedIn }), []);
{
  // Games whose moves were not kept still reached what they went wrong in.
  const games = [
    { at: 1, side: 'white', mistakes: [wrong('Ng5', 'f3g5', 120)] },
    { at: 2, side: 'white', mistakes: [wrong('Ng5', 'f3g5', 90)] },
    played(3, `${ITALIAN} Nf6 4. d3`),
  ];
  same('a game whose moves were not kept counts as having reached the position it went wrong in',
    S.recurringMistakes(games, { reachedIn }).map((s) => [s.games, s.reached]), [[2, 3]]);
  same('and with nothing to read any game\'s moves with, reached is never fewer than gone wrong',
    S.recurringMistakes(games).map((s) => [s.games, s.reached]), [[2, 2]]);
}
{
  // Several positions: the one gone wrong in most often first, and no more than five.
  const at = (n) => after(['1. e4 e5', '1. d4 d5', '1. c4 e5', '1. Nf3 d5', '1. g3 d5', '1. b3 e5', '1. f4 d5'][n]);
  const games = [];
  let t = 0;
  for (let n = 0; n < 7; n++) {
    for (let k = 0; k < 2 + (n === 3 ? 3 : 0) + (n === 5 ? 1 : 0); k++) {
      games.push({ at: ++t, side: 'white', mistakes: [{ ply: 3, san: 'h4', uci: 'h2h4', fen: at(n), side: 'white', best: { san: 'Nc3', uci: 'b1c3' }, loss: 50 + n, themes: [] }] });
    }
  }
  const found = S.recurringMistakes(games);
  same('no more than five are listed', found.length, 5);
  same('most games first, and among equals the one that cost most', found.map((s) => [s.games, s.loss]), [[5, 53], [3, 55], [2, 56], [2, 54], [2, 52]]);
}
same('an unanalysed game says nothing here either',
  S.recurringMistakes([{ at: 1, reviewed: false, mistakes: [wrong('Ng5', 'f3g5', 1)] }, { at: 2, reviewed: false, mistakes: [wrong('Ng5', 'f3g5', 1)] }]), []);
{
  // A mate has no number to average.
  const mate = (at) => ({ at, side: 'white', mistakes: [{ ...wrong('Ng5', 'f3g5', null), kind: 'allowed_mate' }] });
  same('a mistake that cost a mate has no average cost', S.recurringMistakes([mate(1), mate(2)])[0].loss, null);
}

// ── how often, in words ───────────────────────────────────────────────────
same('more than once a game is said as a number a game', [S.howOftenWords(1.42), S.howOftenWords(2), S.howOftenWords(12.3)],
  ['about 1.4 a game', 'about 2 a game', 'about 12 a game']);
same('less than once a game is said as one in so many games', [S.howOftenWords(0.5), S.howOftenWords(0.34), S.howOftenWords(0.1), S.howOftenWords(0.02)],
  ['about once every 2 games', 'about once every 3 games', 'about once every 10 games', 'about once every 50 games']);
same('just under once a game is once a game, not "every 1 games"', [S.howOftenWords(0.97), S.howOftenWords(0.8)], ['about 1 a game', 'about once a game']);
same('nothing is nothing', [S.howOftenWords(0), S.howOftenWords(NaN)], ['not at all', 'not at all']);

console.log(`patterns: ${pass} checks passed${fail ? `, ${fail} FAILED` : ''}`);
if (fail) process.exit(1);
