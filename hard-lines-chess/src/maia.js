// ── the human-like opponent: what the network is shown, and what it says ───
//
// src/maia-net.js runs a network on 112 grids and gets 73 back. This is the
// chess on either side of that: how a game so far becomes the grids, which
// number in the answer belongs to which move, and how a move is chosen from
// them.
//
// EVERY RULE HERE IS SOMEBODY ELSE'S, and has to be followed exactly. The
// networks were trained by the Maia project with the Leela Chess Zero engine,
// which shows a position one particular way and numbers the moves one
// particular way; a network shown the position any other way still answers,
// confidently, with nonsense. So the drawing is Leela's — eight boards of
// history from the side of whoever is to move, and what to do when there is
// no history — and the numbering is held, move for move, to Leela's own table
// of all 1,858 of them (tests/maia.test.mjs).
//
// THE CHOOSING IS THIS APP'S. Maia's own bots always play the likeliest move,
// which makes them the same game every time: the same reply to the same
// position, for ever. A person is not like that, and an opponent you can
// learn by heart is not practice. So the move is drawn from the likely ones,
// in proportion to how likely each is — likely meaning that at least one
// player in twenty would play it. Rarer than that is left out: down there the
// network is mostly guessing, and an opponent that plays its guesses is not
// playing like anybody.

/** A move is "likely" when at least this share of players would play it. */
const MAIA_LEAST = 0.05;
/** How many boards of the game the network is shown: this one and the seven before. */
const MAIA_HISTORY = 8;
/** Each board is thirteen grids: six kinds of piece for each side, and "seen before". */
const MAIA_BOARD_GRIDS = 13;

const MAIA_PIECE_GRID = { p: 0, n: 1, b: 2, r: 3, q: 4, k: 5 };
/** The usual starting position, as "the same position" counts it. */
const MAIA_START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';

/** A position as it counts for "the same position": the board, whose move, castling and en passant. */
const maiaSamePosition = (fen) => String(fen ?? '').trim().split(/\s+/).slice(0, 4).join(' ');

/**
 * The pieces of a position, square by square: 64 letters as a FEN writes
 * them, or '' for an empty square, a1 first.
 *
 * `beforeDoubleStep` puts a pawn that has just moved two squares back where
 * it came from. It is for the made-up boards of history below, and is how
 * Leela shows a network that the capture in passing is on.
 */
function maiaSquares(fen, beforeDoubleStep = false) {
  const [placement, , , passing] = String(fen).trim().split(/\s+/);
  const squares = new Array(64).fill('');
  const ranks = placement.split('/');
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of ranks[7 - r] ?? '') {
      if (ch >= '1' && ch <= '8') file += Number(ch);
      else squares[r * 8 + file++] = ch;
    }
  }
  if (beforeDoubleStep && /^[a-h][36]$/.test(passing ?? '')) {
    const file = passing.charCodeAt(0) - 97;
    // "e3" is a white pawn now on e4 that came from e2; "e6" a black one on e5 from e7.
    const [pawn, now, was] = passing[1] === '3' ? ['P', 3, 1] : ['p', 4, 6];
    if (squares[now * 8 + file] === pawn && !squares[was * 8 + file]) {
      squares[now * 8 + file] = '';
      squares[was * 8 + file] = pawn;
    }
  }
  return squares;
}

/**
 * A game so far, as the network is shown it: 112 grids of 64.
 *
 * `fens` is every position of the game, oldest first; the last is the one a
 * move is wanted in. Everything is drawn from the side of whoever is to move
 * there — their pieces first, their back rank at the bottom — so the network
 * only ever sees "mine" and "theirs", never White and Black.
 *
 *   0–103     eight boards, this one first and then back through the game,
 *             thirteen grids each: my pawns, knights, bishops, rooks, queens
 *             and king, the same six of theirs, and one that is all ones if
 *             that position had been on the board before
 *   104–107   all ones if I may still castle long, I may castle short, they
 *             may castle long, they may castle short
 *   108       all ones if I am Black
 *   109       how many moves since a capture or a pawn move, in every square
 *   110       noughts
 *   111       ones
 *
 * WHERE THE GAME IS YOUNGER THAN EIGHT POSITIONS there are boards missing,
 * and what stands in for them is Leela's rule, because it is what the
 * networks were run with. A game from the usual starting position leaves
 * them empty: that is what the network saw in training at move three. A game
 * from any other position — one set up on the board — fills them with that
 * first position over again. Measured on positions from seven master games:
 * shown an empty past in the middle of a game, the network's first choice
 * was the one it makes with the real past about three times in ten; shown the
 * position repeated, about eight times in ten.
 */
function maiaPlanes(fens) {
  const planes = new Float32Array(MAIA_INPUT_PLANES * 64);
  const last = fens.length - 1;
  const now = String(fens[last]).trim().split(/\s+/);
  const black = now[1] === 'b';
  const same = fens.map(maiaSamePosition);
  const fromTheStart = same[0] === MAIA_START;
  const whole = (grid, value = 1) => planes.fill(value, grid * 64, grid * 64 + 64);

  for (let back = 0; back < MAIA_HISTORY; back++) {
    const at = last - back;
    const madeUp = at < 0;
    if (madeUp && fromTheStart) break;
    const squares = maiaSquares(fens[madeUp ? 0 : at], madeUp);
    const first = back * MAIA_BOARD_GRIDS;
    for (let sq = 0; sq < 64; sq++) {
      const piece = squares[sq];
      if (!piece) continue;
      const mine = (piece < 'a') !== black;
      const rank = sq >> 3;
      const where = (black ? 7 - rank : rank) * 8 + (sq & 7);
      planes[(first + MAIA_PIECE_GRID[piece.toLowerCase()] + (mine ? 0 : 6)) * 64 + where] = 1;
    }
    if (!madeUp && same.indexOf(same[at]) < at) whole(first + 12);
  }

  const rights = now[2] ?? '-';
  const [myLong, myShort, theirLong, theirShort] = black ? ['q', 'k', 'Q', 'K'] : ['Q', 'K', 'q', 'k'];
  const about = MAIA_HISTORY * MAIA_BOARD_GRIDS;
  if (rights.includes(myLong)) whole(about);
  if (rights.includes(myShort)) whole(about + 1);
  if (rights.includes(theirLong)) whole(about + 2);
  if (rights.includes(theirShort)) whole(about + 3);
  if (black) whole(about + 4);
  whole(about + 5, Number(now[4]) || 0);
  whole(about + 7);
  return planes;
}

// The 73 kinds of move, in Leela's order. Fifty-six are a straight line: one
// of eight ways, one to seven squares. Eight are a knight's jump. Nine are a
// pawn reaching the last rank and becoming a rook, a bishop or a queen, by
// one of three files. [ranks, files], as the mover sees the board.
const MAIA_WAYS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const MAIA_JUMPS = [[2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2], [2, -1]];
const MAIA_BECOMES = { [ROOK]: 0, [BISHOP]: 1, [QUEEN]: 2 };

/**
 * Which number in the network's answer is this move's.
 *
 * Two things in Leela's numbering are not what anyone would guess, and both
 * were got wrong here once. CASTLING IS THE KING GOING TO ITS OWN ROOK'S
 * SQUARE, e1 to h1, not to where it ends up. And A PAWN BECOMING A KNIGHT
 * HAS NO NUMBER OF ITS OWN: it is the plain move, and only rook, bishop and
 * queen are marked.
 */
function maiaSlot(move, black) {
  const from = moveFrom(move), to = moveTo(move);
  const fromFile = fileOf(from);
  let fromRank = rankOf(from), toRank = rankOf(to), toFile = fileOf(to);
  if (moveFlags(move) & FLAG_CASTLE) toFile = toFile > fromFile ? 7 : 0;
  if (black) { fromRank = 7 - fromRank; toRank = 7 - toRank; }
  const up = toRank - fromRank, across = toFile - fromFile;
  const becomes = movePromo(move);
  let kind;
  if (becomes && becomes !== KNIGHT) {
    kind = 64 + (across + 1) * 3 + MAIA_BECOMES[becomes];
  } else {
    const jump = MAIA_JUMPS.findIndex(([r, f]) => r === up && f === across);
    kind = jump >= 0
      ? 56 + jump
      : MAIA_WAYS.findIndex(([r, f]) => r === Math.sign(up) && f === Math.sign(across)) * 7 + Math.max(Math.abs(up), Math.abs(across)) - 1;
  }
  return kind * 64 + fromRank * 8 + fromFile;
}

/**
 * The network's answer as chances: for each move that can be played here,
 * the share of players it expects to play it. Likeliest first; they add up
 * to one.
 *
 * Most of the answer is about moves that cannot be played — a rook's move
 * from an empty square — and is not looked at. A network run correctly puts
 * next to nothing there, and a test holds it to that.
 *
 * @returns {{ move: number, uci: string, chance: number }[]}
 */
function maiaChances(board, answer) {
  const black = board.turn === BLACK;
  const moves = board.legalMoves();
  if (!moves.length) return [];
  const said = moves.map((move) => answer[maiaSlot(move, black)]);
  const most = Math.max(...said);
  const weights = said.map((x) => Math.exp(x - most));
  const all = weights.reduce((a, b) => a + b, 0);
  return moves
    .map((move, i) => ({ move, uci: moveToUci(move), chance: weights[i] / all }))
    .sort((a, b) => b.chance - a.chance || (a.uci < b.uci ? -1 : 1));
}

/**
 * Choose a move from the chances: one of the likely ones, in proportion to
 * how likely each is. `random` gives a number from nought up to one.
 *
 * The likeliest move is always among them, however unlikely it is on its own
 * — in a position with forty reasonable moves nothing may reach one in
 * twenty. A PAWN BECOMING A KNIGHT IS ONLY CHOSEN WHEN IT IS THE LIKELIEST
 * MOVE THERE IS. It has no number of its own: it shares one with the plain
 * move from that square, which for a capture is the number every ordinary
 * pawn capture is given. Mostly the network puts next to nothing on it. But
 * where a pawn can take something on the last rank it sometimes puts a great
 * deal there — measured, three in ten for a pawn taking a rook, from the
 * 1900 network — which is far more often than anybody makes a knight.
 *
 * @returns {{ move: number, uci: string, chance: number, among: number } | null}
 */
function maiaChoose(chances, random = Math.random) {
  if (!chances.length) return null;
  const likely = chances.filter((c, i) => i === 0 || (c.chance >= MAIA_LEAST && movePromo(c.move) !== KNIGHT));
  const all = likely.reduce((sum, c) => sum + c.chance, 0);
  let left = random() * all;
  let chosen = likely[likely.length - 1];
  for (const c of likely) {
    left -= c.chance;
    if (left < 0) { chosen = c; break; }
  }
  return { ...chosen, among: likely.length };
}
