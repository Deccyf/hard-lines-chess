// Where a game left the repertoire — checked against the repertoire itself.
//
// THE FAULT WORTH CATCHING is a report that names the wrong opening or the
// wrong move, because a person acting on it will study the wrong thing and
// have no way of telling. So the cases here are built FROM src/openings.js
// rather than typed out: a line is taken from the file, a move is changed at a
// known ply, and the finder has to name that ply and that move. If the
// repertoire changes, the cases change with it and stay true.
import { readFileSync } from 'node:fs';

const src = [
  readFileSync(new URL('../src/engine/bundle.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/notation.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/pgn.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/openings.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/deviation.js', import.meta.url), 'utf8'),
].join('\n');
const S = new Function('window', 'localStorage', src
  + '; return { Board, Engine, sanToMove, toSan, moveToUci, OPENINGS, repertoireLines,'
  + ' findDeviation, collectDeviations, measureDeviation };')({}, undefined);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL', name, extra); } };

const WHITE_LINES = S.repertoireLines(S.OPENINGS).filter((l) => l.side === 'white');
const BLACK_LINES = S.repertoireLines(S.OPENINGS).filter((l) => l.side === 'black');

ok('the repertoire has lines for both colours', WHITE_LINES.length > 0 && BLACK_LINES.length > 0,
  `${WHITE_LINES.length} white, ${BLACK_LINES.length} black`);
ok('every line is legal from move one', S.repertoireLines(S.OPENINGS).every((entry) => {
  const board = new S.Board();
  return entry.line.every((san) => { const m = S.sanToMove(board, san); if (!m) return false; board.make(m); return true; });
}));

// ── a game that IS the line is not a deviation ────────────────────────────
for (const entry of [WHITE_LINES[0], BLACK_LINES[0]]) {
  const found = S.findDeviation(entry.line, entry.side, S.OPENINGS);
  ok(`${entry.name}: played exactly, nothing is reported`, found.kind === 'followed', `got ${found.kind}`);
}

// ── a legal move that is not the book move, at a ply that is yours ────────
//
// The replacement is not invented: it is a real legal alternative found by the
// move generator in that position, so the case is a game somebody could have
// played rather than a string that happens to differ.
//
// AND IT MUST NOT BE A MOVE THE REPERTOIRE ALSO PLAYS. The first version of
// this took the first legal alternative it found, which after 1.e4 e5 is Nc3 —
// and Nc3 is the Vienna, which is in the book. The finder correctly reported
// that the game had transposed into another line the player knows, and the
// test called that a failure. A "deviation" that is a transposition into your
// own repertoire is not a deviation, so the replacement is chosen from the
// moves no line plays here.
function bookMovesAt(prefix) {
  const playable = new Set();
  for (const entry of S.repertoireLines(S.OPENINGS)) {
    let n = 0;
    while (n < prefix.length && n < entry.line.length && prefix[n] === entry.line[n]) n++;
    if (n === prefix.length && n < entry.line.length) playable.add(entry.line[n]);
  }
  return playable;
}

function swapAt(line, index) {
  const board = new S.Board();
  for (let i = 0; i < index; i++) board.make(S.sanToMove(board, line[i]));
  const book = bookMovesAt(line.slice(0, index));
  const other = board.legalMoves()
    .map((m) => S.toSan(new S.Board(board.fen()), m))
    .find((san) => !book.has(san));
  return other ? [...line.slice(0, index), other, ...line.slice(index + 1)] : null;
}

let cases = 0;
for (const entry of [...WHITE_LINES.slice(0, 6), ...BLACK_LINES.slice(0, 6)]) {
  // A ply that belongs to the player whose repertoire this is.
  const mineAt = (i) => (i % 2 === 0) === (entry.side === 'white');
  for (const index of [2, 3, 4, 5, 6, 7].filter(mineAt).filter((i) => i < entry.line.length)) {
    const game = swapAt(entry.line, index);
    if (!game) continue;
    cases++;
    const found = S.findDeviation(game, entry.side, S.OPENINGS);

    ok(`${entry.name} @${index}: the divergence is mine`, found.kind === 'you-left', `got ${found.kind}`);
    if (found.kind !== 'you-left') continue;
    // THE INVARIANT THAT MATTERS: a ply blamed on you has to be a ply you
    // played. Getting this backwards would send somebody to study their
    // opponent's move.
    ok(`${entry.name} @${index}: the ply it blames is a ply I moved on`,
      ((found.ply - 1) % 2 === 0) === (entry.side === 'white'), `ply ${found.ply} as ${entry.side}`);
    // The ply it names must be at or before the one that was changed: an
    // earlier one only if a different line matched further, which is fine.
    ok(`${entry.name} @${index}: it names ply ${index + 1} or earlier`, found.ply <= index + 1, `named ${found.ply}`);
    ok(`${entry.name} @${index}: the move it quotes is the move played`,
      found.played === game[found.ply - 1], `quoted ${found.played}, played ${game[found.ply - 1]}`);
    ok(`${entry.name} @${index}: and the book move is a legal alternative`, (() => {
      const board = new S.Board();
      for (const san of found.prefix) board.make(S.sanToMove(board, san));
      return Boolean(S.sanToMove(board, found.book)) && Boolean(S.sanToMove(new S.Board(board.fen()), found.played));
    })());
    ok(`${entry.name} @${index}: the prefix really reaches that position`, found.prefix.length === found.ply - 1);
  }
}
ok('enough cases were built to mean something', cases >= 20, `${cases} cases`);

// ── the OPPONENT leaving is not your deviation ───────────────────────────
{
  const entry = WHITE_LINES[0];
  const theirPly = 3;  // ply index 3 is Black's second move
  const game = swapAt(entry.line, theirPly);
  const found = S.findDeviation(game, 'white', S.OPENINGS);
  ok('their move out of the book is not filed as yours',
    found.kind !== 'you-left', `got ${found.kind}`);
  ok('and it is filed as theirs, or as a line you were never in',
    ['they-left', 'followed', 'they-avoided'].includes(found.kind), `got ${found.kind}`);
}

// ── A TRANSPOSITION INTO ANOTHER LINE YOU PLAY IS NOT LEAVING THE BOOK ────
//
// This is the case that made the first version of this test wrong, so it is
// now a test of its own. 1.e4 e5 2.Nc3 is not the Italian; it is the Vienna,
// which is also in the repertoire. A player who plays it has not left their
// preparation and must not be told they have.
{
  const vienna = S.OPENINGS.find((o) => o.line[0] === 'e4' && o.line[1] === 'e5' && o.line[2] === 'Nc3');
  ok('the repertoire really does contain 1.e4 e5 2.Nc3', Boolean(vienna));
  if (vienna) {
    const found = S.findDeviation(vienna.line, 'white', S.OPENINGS);
    ok('playing it in full is following the book', found.kind === 'followed', `got ${found.kind}`);
    // And the half-way case: the Italian's first two plies, then the Vienna.
    const mixed = ['e4', 'e5', 'Nc3', ...vienna.line.slice(3)];
    const half = S.findDeviation(mixed, 'white', S.OPENINGS);
    ok('and switching into it mid-game is not blamed on you', half.kind !== 'you-left', `got ${half.kind}`);
  }
}

// ── a first move outside the repertoire has no opening to name ───────────
{
  const found = S.findDeviation(['a3', 'e5', 'h3'], 'white', S.OPENINGS);
  ok('an unrepertoired first move is not blamed on an opening',
    found.kind === 'never-entered', `got ${found.kind}`);
  ok('and it says what the book plays instead',
    Array.isArray(found.firstMoves) && found.firstMoves.length > 0);
}

// ── grouping: the same mistake four times is one row saying four ─────────
{
  const entry = WHITE_LINES[0];
  const index = (0 % 2 === 0) === true ? 4 : 4;   // a White ply
  const game = swapAt(entry.line, index);
  const games = [1, 2, 3, 4].map((n) => ({ at: n * 1000, side: 'white', sans: game, label: `game ${n}` }));
  const { rows, counts } = S.collectDeviations(games, S.OPENINGS);
  ok('four identical games make one row', rows.length === 1, `${rows.length} rows`);
  ok('and the row counts four', rows[0]?.times === 4, `times ${rows[0]?.times}`);
  ok('and every game is listed on it', rows[0]?.games.length === 4);
  ok('and the totals add up', counts.games === 4 && counts.youLeft === 4);
}

// ── the cost is a measurement, and it is signed the right way round ──────
{
  const entry = WHITE_LINES[0];
  const game = swapAt(entry.line, 4);
  const { rows } = S.collectDeviations([{ at: 1, side: 'white', sans: game, label: 'g' }], S.OPENINGS);
  if (rows.length) {
    const engine = new S.Engine();
    const cost = S.measureDeviation(rows[0], { Board: S.Board, sanToMove: S.sanToMove, engine, movetime: 200, depth: 8 });
    ok('a cost comes back', cost !== null);
    ok('with both scores and their difference',
      cost && Number.isFinite(cost.yours) && Number.isFinite(cost.book) && cost.loss === cost.book - cost.yours);
    // The book move of a verified repertoire should not be WORSE than an
    // arbitrary legal alternative by a large margin. This is a sanity bound on
    // the sign, not a claim about the opening.
    ok('and the book move is not two pawns worse than a random legal one', cost === null || cost.loss > -200,
      cost ? `loss ${cost.loss}` : '');
    console.log(`  measured: your move ${cost?.yours}cp, the book ${cost?.book}cp, difference ${cost?.loss}cp`);
  }
}

console.log(`${cases} swapped-move cases, ${pass} checks passed, ${fail} failed`);
if (fail) process.exit(1);
