// The king-and-pawn table, checked two ways.
//
// It exists because the search cannot referee these endings — asked about the
// drawn opposition it is confident and wrong — so everything the endgame
// trainer says about a pawn ending rests on this file being right. Two
// independent checks, because either alone would miss the other's failures:
//
//   1. POSITIONS WHOSE ANSWER IS PUBLISHED. The square rule, the rook pawn in
//      the corner, the king in front of the pawn on the sixth. If the table
//      disagrees with a century of endgame books, the table is wrong.
//
//   2. PLAY THEM OUT ON A REAL BOARD. The table drives both sides through the
//      app's own move generator, and the game has to end the way the table
//      said it would. A verdict that is internally consistent but indexed
//      wrongly, mirrored wrongly, or translated wrongly between 0-63 and 0x88
//      passes the first check and fails this one.
import { Board, moveFrom, moveTo, movePromo } from '../src/engine/core.js';
import { buildPawnTable, probePawnEnding, bestPawnMove } from '../src/pawn-tb.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; } else { fail++; console.log('  FAIL', name, extra); }
};

const started = Date.now();
buildPawnTable();
const built = Date.now() - started;
console.log(`table built in ${built}ms`);
ok('built in under fifteen seconds', built < 15000, `took ${built}ms`);

// ── 1. what the books say ──────────────────────────────────────────────────
const TEXTBOOK = [
  // The square rule: step inside it and the pawn is caught, stay out and it is not.
  ['inside the square',              '8/8/4k3/P7/8/8/8/7K b - - 0 1', 'draw'],
  ['outside the square',             '8/8/5k2/P7/8/8/8/7K b - - 0 1', 'win'],
  // A rook pawn is drawn whenever the defending king reaches the corner, however
  // far ahead the attacking king is — the one exception every book leads with.
  ['rook pawn, king in the corner',  '7k/8/6K1/7P/8/8/8/8 w - - 0 1', 'draw'],
  ['rook pawn, defender far away',   '8/8/6K1/7P/8/8/8/6k1 w - - 0 1', 'win'],
  // The king in front of its pawn on the sixth rank wins whoever is to move.
  ['king on the sixth, white moves', '3k4/8/3K4/3P4/8/8/8/8 w - - 0 1', 'win'],
  ['king on the sixth, black moves', '3k4/8/3K4/3P4/8/8/8/8 b - - 0 1', 'win'],
  // On the fifth it depends on the opposition, which is the whole lesson.
  ['fifth rank, defender holds',     '4k3/8/8/3KP3/8/8/8/8 b - - 0 1', 'draw'],
  ['fifth rank, attacker gains it',  '4k3/8/8/3KP3/8/8/8/8 w - - 0 1', 'win'],
  // Black's pawn is White's pawn upside down; the table stores only one colour.
  ['a black pawn wins too',          '8/8/8/8/4p3/4k3/8/4K3 b - - 0 1', 'win'],
  // The rook-pawn draw, upside down: the defending king sits in the corner the
  // pawn is heading for and cannot be driven out of it.
  ['a black rook pawn drawn too',    '8/8/8/8/8/7k/7p/7K w - - 0 1', 'draw'],
];
for (const [name, fen, expect] of TEXTBOOK) {
  const verdict = probePawnEnding(new Board(fen));
  ok(name, verdict?.result === expect, `got ${verdict?.result ?? 'not a pawn ending'}, expected ${expect}`);
}

// A position with a piece on it is not this ending and must say so rather than
// answer about the three men it can see.
ok('declines anything else', probePawnEnding(new Board('8/8/8/4k3/8/8/8/R3K3 w - - 0 1')) === null);
ok('declines the opening position', probePawnEnding(new Board()) === null);

// ── 2. play them out ───────────────────────────────────────────────────────
function playOut(fen) {
  const board = new Board(fen);
  for (let ply = 0; ply < 300; ply++) {
    const finished = board.outcome();
    if (finished) return finished;
    // Past promotion the table has no more to say, and king and queen against
    // king is a win by definition — see promotionWins() for the two exceptions,
    // which are decided before the queen ever appears.
    if (!probePawnEnding(board)) return 'promoted';
    const best = bestPawnMove(board);
    if (!best) return 'no move';
    const legal = board.legalMoves().filter((m) => moveFrom(m) === best.from && moveTo(m) === best.to);
    if (!legal.length) return `illegal ${best.from}->${best.to}`;
    board.make(legal.find((m) => movePromo(m) === 5) ?? legal[0]);
  }
  return 'unfinished';
}

const seeded = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
const fenFor = (wk, bk, pawn, turn) => {
  if (new Set([wk, bk, pawn]).size !== 3) return null;
  const rows = Array.from({ length: 8 }, () => Array(8).fill(''));
  rows[7 - (wk >> 3)][wk & 7] = 'K';
  rows[7 - (bk >> 3)][bk & 7] = 'k';
  rows[7 - (pawn >> 3)][pawn & 7] = 'P';
  return rows.map((row) => {
    let out = '', gap = 0;
    for (const cell of row) { if (!cell) gap++; else { if (gap) { out += gap; gap = 0; } out += cell; } }
    return out + (gap || '');
  }).join('/') + ` ${turn} - - 0 1`;
};

let played = 0, disagreed = 0;
while (played < 400) {
  const fen = fenFor(Math.floor(seeded() * 64), Math.floor(seeded() * 64),
                     8 + Math.floor(seeded() * 48), seeded() < 0.5 ? 'w' : 'b');
  if (!fen) continue;
  let board;
  try { board = new Board(fen); } catch { continue; }
  if (board.inCheck(board.turn === 8 ? 16 : 8)) continue;   // could not have arisen
  const verdict = probePawnEnding(board);
  if (!verdict) continue;
  played++;
  const end = playOut(fen);
  const wonThrough = end === 'promoted' || end === 'checkmate';
  if (wonThrough !== (verdict.result === 'win')) {
    disagreed++;
    if (disagreed <= 5) console.log('  FAIL play-out', fen, '| table:', verdict.result, '| ended:', end);
  }
}
ok(`${played} positions play out to their own verdict`, disagreed === 0, `${disagreed} disagreed`);

// The defence must be stubborn as well as correct: a drawn position played out
// by both sides has to actually reach a draw rather than merely avoid a loss.
const drawnEnd = playOut('4k3/8/8/3KP3/8/8/8/8 b - - 0 1');
ok('a drawn ending really ends drawn', ['stalemate', 'insufficient', 'fifty_move', 'repetition'].includes(drawnEnd), `ended ${drawnEnd}`);

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
