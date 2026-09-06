// Every endgame in the bank, checked on the board.
//
// The prose makes claims — "two rooks", "the pawn is on a5", "wins whoever is
// to move", "a draw" — and prose is where this app is most likely to be wrong,
// because nothing stops a sentence being written. So each position is parsed,
// its material counted, its verdict taken from whichever referee it names, and
// the budget checked against the distance the table actually reports.
import { readFileSync } from 'node:fs';
import { Board, WHITE, BLACK, typeOf, colourOf, squareName, moveFrom, moveTo, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } from '../src/engine/core.js';
import { Engine } from '../src/engine/search.js';
import { probePawnEnding, buildPawnTable, bestPawnMove } from '../src/pawn-tb.js';

const src = readFileSync(new URL('../src/endgames.js', import.meta.url), 'utf8');
const scope = {};
new Function('exports', src + '\nexports.ENDGAMES = ENDGAMES;')(scope);
const { ENDGAMES } = scope;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; } else { fail++; console.log('  FAIL', name, extra); }
};

buildPawnTable();
const engine = new Engine();

/** What is actually on the board, as { white: {...}, black: {...} }. */
function census(board) {
  const out = { white: {}, black: {} };
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const piece = board.squares[sq];
    if (!piece) continue;
    const side = colourOf(piece) === WHITE ? 'white' : 'black';
    const type = typeOf(piece);
    out[side][type] = (out[side][type] ?? 0) + 1;
  }
  return out;
}

const ids = new Set();
for (const eg of ENDGAMES) {
  ok(`${eg.id}: id is unique`, !ids.has(eg.id));
  ids.add(eg.id);

  let board;
  try { board = new Board(eg.fen); } catch (e) {
    ok(`${eg.id}: FEN parses`, false, e.message);
    continue;
  }
  ok(`${eg.id}: FEN parses`, true);

  // The trainee is the side to move — every one of these starts with your move.
  const toMove = board.turn === WHITE ? 'white' : 'black';
  ok(`${eg.id}: the trainee is to move`, toMove === eg.side, `FEN has ${toMove} to move, bank says ${eg.side}`);

  // A position where the side not to move is in check could not have arisen.
  ok(`${eg.id}: position could have arisen`, !board.inCheck(board.turn === WHITE ? BLACK : WHITE));
  ok(`${eg.id}: there is something to play`, board.legalMoves().length > 0);

  const men = census(board);
  ok(`${eg.id}: both kings present`, men.white[KING] === 1 && men.black[KING] === 1);

  ok(`${eg.id}: has a method worth reading`, Array.isArray(eg.method) && eg.method.length >= 3);
  ok(`${eg.id}: has an idea`, typeof eg.idea === 'string' && eg.idea.length > 40);
  ok(`${eg.id}: budget is a sane number of moves`, Number.isInteger(eg.budget) && eg.budget >= 4 && eg.budget <= 40);
  ok(`${eg.id}: names a referee`, eg.referee === 'table' || eg.referee === 'engine');
  ok(`${eg.id}: names a goal`, ['mate', 'promote', 'draw'].includes(eg.goal));

  // ── what the name claims is on the board ───────────────────────────────
  const strong = eg.side === 'white' && eg.goal !== 'draw' ? men.white : (eg.goal === 'draw' ? men[eg.side === 'white' ? 'black' : 'white'] : men.black);
  if (eg.id === 'two-rooks') ok('two-rooks: is two rooks', men.white[ROOK] === 2 && !men.white[QUEEN] && !men.black[ROOK]);
  if (eg.id === 'queen-mate') ok('queen-mate: is one queen', men.white[QUEEN] === 1 && Object.keys(men.black).length === 1);
  if (eg.id === 'rook-mate') ok('rook-mate: is one rook', men.white[ROOK] === 1 && Object.keys(men.black).length === 1);

  // ── the referee's verdict has to match the goal ─────────────────────────
  if (eg.referee === 'table') {
    const verdict = probePawnEnding(board);
    ok(`${eg.id}: the table recognises it`, verdict !== null);
    if (verdict) {
      const wantWin = eg.goal === 'promote';
      ok(`${eg.id}: table agrees it is a ${wantWin ? 'win' : 'draw'}`,
        verdict.result === (wantWin ? 'win' : 'draw'), `table says ${verdict.result}`);
      // The trainee owns the pawn when the goal is to promote, and does not
      // when the goal is to hold — otherwise the lesson is the other side's.
      ok(`${eg.id}: the trainee is the side the lesson is about`,
        verdict.strongToMove === (eg.goal === 'promote'));
      if (wantWin && verdict.plies !== null) {
        ok(`${eg.id}: budget of ${eg.budget} covers the ${verdict.plies}-ply win`,
          Math.ceil(verdict.plies / 2) <= eg.budget, `needs ${Math.ceil(verdict.plies / 2)} moves`);
      }
    }
  } else {
    engine.reset();
    const result = engine.search(new Board(eg.fen), { movetime: 2500, maxDepth: 30 });
    // A mate or a promotion to force needs an advantage the search is certain
    // of. Half a rook is the floor; every one of these is far past it.
    ok(`${eg.id}: the search sees it as winning`, result.score > 400, `score ${result.score}`);
  }
}

// ── claims the prose makes about specific squares ─────────────────────────
const square = ENDGAMES.find((e) => e.id === 'square-rule');
{
  const board = new Board(square.fen);
  let pawnAt = null;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    if (board.squares[sq] && typeOf(board.squares[sq]) === PAWN) pawnAt = squareName(sq);
  }
  ok('square-rule: the pawn really is on a5', pawnAt === 'a5', `it is on ${pawnAt}`);
  ok('square-rule: the method names that square', square.method[0].includes('a5'));
}

const corner = ENDGAMES.find((e) => e.id === 'rook-pawn-corner');
{
  const board = new Board(corner.fen);
  let pawnFile = null;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    if (board.squares[sq] && typeOf(board.squares[sq]) === PAWN) pawnFile = squareName(sq)[0];
  }
  ok('rook-pawn-corner: it really is a rook pawn', pawnFile === 'a' || pawnFile === 'h', `file ${pawnFile}`);

  // The lesson is that ONE move holds and the others do not. If every move
  // drew, there would be nothing to teach.
  const drawing = [];
  for (const move of board.legalMoves()) {
    const after = new Board(corner.fen);
    after.make(move);
    const verdict = probePawnEnding(after);
    if (!verdict || verdict.result === 'draw') drawing.push(move);
  }
  ok('rook-pawn-corner: exactly one move holds the draw', drawing.length === 1,
    `${drawing.length} of ${board.legalMoves().length} moves draw`);
}

// The opposition lesson is only a lesson if the wrong move throws it away.
const opp = ENDGAMES.find((e) => e.id === 'opposition-fifth');
{
  const board = new Board(opp.fen);
  let winning = 0;
  for (const move of board.legalMoves()) {
    const after = new Board(opp.fen);
    after.make(move);
    const verdict = probePawnEnding(after);
    if (verdict && verdict.result === 'win') winning++;
  }
  ok('opposition-fifth: some moves throw the win away',
    winning > 0 && winning < board.legalMoves().length,
    `${winning} of ${board.legalMoves().length} moves keep the win`);
  // The prose says "two moves here win and the other six draw", and that both
  // winning moves are king moves to the sixth. Counted claims, so counted.
  ok('opposition-fifth: exactly two moves win', winning === 2, `${winning} win`);
  ok('opposition-fifth: eight moves in total', board.legalMoves().length === 8,
    `${board.legalMoves().length} legal moves`);
  const pushKeepsIt = (() => {
    const after = new Board(opp.fen);
    const push = after.legalMoves().find((m) => squareName(moveFrom(m)) === 'e5' && squareName(moveTo(m)) === 'e6');
    if (!push) return 'no push';
    after.make(push);
    return probePawnEnding(after)?.result;
  })();
  ok('opposition-fifth: pushing the pawn draws it away', pushKeepsIt === 'draw', `push gives ${pushKeepsIt}`);
}

// ── can the exercise actually be passed? ──────────────────────────────────
//
// THE CHECK THAT WOULD HAVE CAUGHT THE LUCENA. Everything above verifies the
// starting position — its material, its side to move, its result. None of it
// asks the question a player asks, which is whether playing well from here
// reaches the goal the screen sets within the moves it allows.
//
// It did not, for the rook ending that used to be here: the goal was to
// promote, and best play as this app plays it gave the pawn away and won by
// mating instead. The exercise could not be passed as written and nothing
// said so. So each one is now played out by the best mover available to it —
// the exact table where there is one, the search otherwise — and the goal has
// to be reached inside the budget.
function playOutEndgame(eg) {
  const board = new Board(eg.fen);
  const mySide = eg.side === 'white' ? WHITE : BLACK;
  const startingExtras = promoted(board, mySide);
  let myMoves = 0;

  for (let ply = 0; ply < eg.budget * 2 + 4; ply++) {
    const outcome = board.outcome();
    if (outcome === 'checkmate') {
      return { done: board.turn !== mySide && eg.goal === 'mate', why: `checkmate, ${board.turn === mySide ? 'against you' : 'delivered'}`, moves: myMoves };
    }
    if (outcome) {
      return { done: eg.goal === 'draw', why: outcome, moves: myMoves };
    }
    if (eg.goal === 'promote' && promoted(board, mySide) > startingExtras) {
      return { done: true, why: 'promoted', moves: myMoves };
    }

    let move = null;
    const viaTable = bestPawnMove(board);
    if (viaTable) {
      move = board.legalMoves().find((m) => moveFrom(m) === viaTable.from && moveTo(m) === viaTable.to);
    }
    if (!move) {
      engine.reset();
      const result = engine.search(new Board(board.fen()), { movetime: 900, maxDepth: 20 });
      move = result.move && board.legalMoves().find((m) => m === result.move);
      if (!move && result.move) move = board.legalMoves()[0];
    }
    if (!move) return { done: false, why: 'no move', moves: myMoves };
    if (board.turn === mySide) myMoves++;
    board.make(move);
    if (eg.goal === 'promote' && promoted(board, mySide) > startingExtras) {
      return { done: true, why: 'promoted', moves: myMoves };
    }
    if (myMoves > eg.budget) return { done: eg.goal === 'draw', why: 'out of moves', moves: myMoves };
  }
  // Surviving the whole budget IS the exercise when the goal is to hold.
  return { done: eg.goal === 'draw', why: 'still going', moves: myMoves };
}

function promoted(board, colour) {
  let n = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const piece = board.squares[sq];
    if (!piece || colourOf(piece) !== colour) continue;
    const type = typeOf(piece);
    if (type === QUEEN || type === ROOK || type === BISHOP || type === KNIGHT) n++;
  }
  return n;
}

for (const eg of ENDGAMES) {
  const played = playOutEndgame(eg);
  ok(`${eg.id}: the goal is reachable (${played.why}, ${played.moves} moves)`, played.done);
}

console.log(`${ENDGAMES.length} endgames, ${pass} checks passed, ${fail} failed`);
if (fail) process.exit(1);
