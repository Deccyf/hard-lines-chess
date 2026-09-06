// Proves every line in openings.js is real chess.
//
// Three things are checked on every line AND every variation, and each one has
// actually caught something at some point in a repertoire file: that every move in `line` is legal in the
// position it is played in, that `ideas` says something about every ply and
// not one fewer, and that the position at the end of the line is not already
// lost for the student.
//
// The SAN writer is lifted from ui.js's toSan() rather than rewritten. Two
// implementations of notation is two chances to disagree about a
// disambiguation, and the one in the UI is the one the student will read.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Board, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK,
  typeOf, colourOf, fileOf, rankOf, squareName, nameToSquare,
  moveFrom, moveTo, movePromo, moveFlags,
  FLAG_CAPTURE, FLAG_CASTLE, moveToUci,
} from '../src/engine/core.js';
import { Engine } from '../src/engine/search.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOVETIME = 600;
// "Not worse than about 1.2 pawns" for the student, in centipawns.
const LOST_THRESHOLD = -120;

// ── notation, cribbed verbatim from ui.js ──────────────────────────────────
function toSan(board, move) {
  const from = moveFrom(move), to = moveTo(move);
  const flags = moveFlags(move), promo = movePromo(move);
  const piece = board.squares[from];
  const type = typeOf(piece);

  if (flags & FLAG_CASTLE) return to > from ? 'O-O' : 'O-O-O';

  const letters = { [KNIGHT]: 'N', [BISHOP]: 'B', [ROOK]: 'R', [QUEEN]: 'Q', [KING]: 'K' };
  const capture = (flags & FLAG_CAPTURE) !== 0;
  let san = '';

  if (type === PAWN) {
    if (capture) san += 'abcdefgh'[fileOf(from)] + 'x';
    san += squareName(to);
    if (promo) san += '=' + { [QUEEN]: 'Q', [ROOK]: 'R', [BISHOP]: 'B', [KNIGHT]: 'N' }[promo];
  } else {
    san += letters[type];
    const rivals = board.legalMoves().filter((m) => m !== move
      && moveTo(m) === to
      && typeOf(board.squares[moveFrom(m)]) === type);
    if (rivals.length) {
      const sameFile = rivals.some((m) => fileOf(moveFrom(m)) === fileOf(from));
      const sameRank = rivals.some((m) => rankOf(moveFrom(m)) === rankOf(from));
      if (!sameFile) san += 'abcdefgh'[fileOf(from)];
      else if (!sameRank) san += (rankOf(from) + 1);
      else san += squareName(from);
    }
    if (capture) san += 'x';
    san += squareName(to);
  }

  const copy = board;
  if (copy.make(move)) {
    const outcome = copy.outcome();
    if (outcome === 'checkmate') san += '#';
    else if (copy.inCheck()) san += '+';
    copy.unmake();
  }

  return san;
}

// ── loading ────────────────────────────────────────────────────────────────
// openings.js is written to be inlined into a classic <script>, so it has no
// export. Running it through Function() is how the page will run it too: if it
// only worked as a module, this check would be passing on a file the page
// cannot use.
async function loadOpenings() {
  const src = await readFile(join(HERE, '../src/openings.js'), 'utf8');
  return Function(`${src}\nreturn OPENINGS;`)();
}

const SHAPE = ['id', 'name', 'side', 'eco', 'line', 'ideas', 'plan', 'traps', 'variations'];
const VARIATION_SHAPE = ['name', 'at', 'line', 'ideas'];
// A main line shorter than this leaves the student in the opening with the
// pieces still deciding where to go; every entry is extended past it.
const MIN_MAIN_PLIES = 12;
// A branch has to go far enough past the divergence to show what it is for,
// and not so far that it becomes a middlegame nobody reaches. Counted from
// the diverging ply inclusive: 6 to 10 plies beyond it.
const MIN_BRANCH = 7, MAX_BRANCH = 11;

function checkShape(opening, index, failures) {
  const where = opening?.id ?? `#${index}`;
  const fail = (msg) => failures.push(`${where}: ${msg}`);

  const keys = Object.keys(opening);
  for (const key of SHAPE) if (!keys.includes(key)) fail(`missing key "${key}"`);
  for (const key of keys) if (!SHAPE.includes(key)) fail(`unexpected key "${key}"`);

  if (opening.side !== 'white' && opening.side !== 'black') fail(`side is "${opening.side}", not white or black`);
  if (!Array.isArray(opening.line) || opening.line.length === 0) fail('line is empty');
  if (!Array.isArray(opening.ideas)) fail('ideas is not an array');
  if (Array.isArray(opening.line) && Array.isArray(opening.ideas)
    && opening.ideas.length !== opening.line.length) {
    fail(`ideas has ${opening.ideas.length} entries for ${opening.line.length} plies`);
  }
  (opening.ideas ?? []).forEach((idea, i) => {
    if (typeof idea !== 'string' || idea.trim().length < 20) fail(`ideas[${i}] is empty or a stub`);
  });
  if (typeof opening.plan !== 'string' || opening.plan.trim().length < 40) fail('plan is empty or a stub');
  if (!Array.isArray(opening.traps) || opening.traps.length < 2 || opening.traps.length > 4) {
    fail(`traps has ${opening.traps?.length} entries, expected 2 to 4`);
  }
  (opening.traps ?? []).forEach((trap, i) => {
    const tkeys = Object.keys(trap ?? {});
    if (tkeys.length !== 2 || !tkeys.includes('when') || !tkeys.includes('answer')) {
      fail(`traps[${i}] is not exactly { when, answer }`);
    }
    if (!trap?.when?.trim() || !trap?.answer?.trim()) fail(`traps[${i}] has an empty field`);
  });

  if (Array.isArray(opening.line) && opening.line.length < MIN_MAIN_PLIES) {
    fail(`main line is ${opening.line.length} plies, fewer than ${MIN_MAIN_PLIES}`);
  }

  // ── variations ──────────────────────────────────────────────────────────
  // A variation is the OPPONENT leaving the main line. So the ply it starts
  // on belongs to the other side, the prefix before it is the main line
  // verbatim, and the move on it is not the main line's move. Every one of
  // those is a way to write a branch that silently teaches the wrong thing:
  // a branch where the student deviates is a second main line with no
  // signposting, and a branch whose prefix drifts is replayed from a
  // position the screen never shows.
  const vars = opening.variations;
  if (!Array.isArray(vars) || vars.length < 2 || vars.length > 4) {
    fail(`variations has ${vars?.length} entries, expected 2 to 4`);
    return;
  }
  const names = new Set();
  vars.forEach((v, i) => {
    const vkeys = Object.keys(v ?? {});
    for (const key of VARIATION_SHAPE) if (!vkeys.includes(key)) fail(`variations[${i}] missing key "${key}"`);
    for (const key of vkeys) if (!VARIATION_SHAPE.includes(key)) fail(`variations[${i}] has unexpected key "${key}"`);
    if (typeof v?.name !== 'string' || !v.name.trim()) fail(`variations[${i}] has no name`);
    if (names.has(v?.name)) fail(`variations[${i}] repeats the name "${v.name}"`);
    names.add(v?.name);
    if (!Number.isInteger(v?.at) || v.at < 0) { fail(`variations[${i}] "at" is ${v?.at}`); return; }
    if (!Array.isArray(v.line) || !Array.isArray(v.ideas)) { fail(`variations[${i}] line or ideas is not an array`); return; }
    const opponentMoves = (ply) => (ply % 2 === 0) !== (opening.side === 'white');
    if (!opponentMoves(v.at)) fail(`variations[${i}] "${v.name}" starts at ply ${v.at}, which is the student's move, not the opponent's`);
    if (v.at >= opening.line.length) fail(`variations[${i}] "${v.name}" starts at ply ${v.at}, past the end of the main line`);
    for (let p = 0; p < v.at; p++) {
      if (v.line[p] !== opening.line[p]) { fail(`variations[${i}] "${v.name}" differs from the main line at ply ${p} (${v.line[p]} vs ${opening.line[p]}), before its own "at" of ${v.at}`); break; }
    }
    if (v.line[v.at] === opening.line[v.at]) fail(`variations[${i}] "${v.name}" plays the main line's ${opening.line[v.at]} at ply ${v.at} - it does not diverge there`);
    const span = v.line.length - v.at;
    if (span < MIN_BRANCH || span > MAX_BRANCH) fail(`variations[${i}] "${v.name}" runs ${span} plies from its divergence, expected ${MIN_BRANCH} to ${MAX_BRANCH}`);
    if (v.ideas.length !== span) fail(`variations[${i}] "${v.name}" has ${v.ideas.length} ideas for ${span} plies`);
    v.ideas.forEach((idea, j) => {
      if (typeof idea !== 'string' || idea.trim().length < 20) fail(`variations[${i}] "${v.name}" ideas[${j}] is empty or a stub`);
    });
  });
}

/** Replay `line` from the start position. Throws with the ply that broke. */
function replay(opening, failures) {
  const board = new Board();
  const uci = [];

  for (let ply = 0; ply < opening.line.length; ply++) {
    const want = opening.line[ply];
    const moveNumber = Math.floor(ply / 2) + 1;
    const side = ply % 2 === 0 ? 'white' : 'black';
    const label = `${moveNumber}${side === 'white' ? '.' : '...'}${want}`;

    const legal = board.legalMoves();
    const sans = legal.map((m) => ({ move: m, san: toSan(board, m) }));
    // Match on the bare move first, so a missing "+" is reported as a wrong
    // spelling rather than an illegal move -- those are different faults and
    // saying the wrong one sends you looking in the wrong place.
    const bare = (s) => s.replace(/[+#]$/, '');
    const hit = sans.find((c) => c.san === want) ?? sans.find((c) => bare(c.san) === bare(want));

    if (!hit) {
      failures.push(`${opening.id}: ply ${ply + 1} (${label}) is NOT LEGAL in ${board.fen()}`);
      return null;
    }
    if (hit.san !== want) {
      failures.push(`${opening.id}: ply ${ply + 1} should be written "${hit.san}", not "${want}"`);
      return null;
    }

    uci.push(moveToUci(hit.move));
    board.make(hit.move);
  }

  return { board, uci };
}


// ── the claims the prose makes ─────────────────────────────────────────────
// A trap that says "this is checkmate" or "count the defenders" is an
// assertion about a real position, and an assertion nobody checked is how a
// confident, plausible, wrong sentence gets in front of a beginner. Each one
// below is replayed on the board.

/** Replay SAN from the start position (or from `board`). Throws on an illegal move. */
function fromSan(sans, board = new Board()) {
  for (const want of sans) {
    const hit = board.legalMoves()
      .map((m) => ({ m, san: toSan(board, m) }))
      .find((c) => c.san === want || c.san.replace(/[+#]$/, '') === want.replace(/[+#]$/, ''));
    if (!hit) throw new Error(`illegal move ${want} in ${board.fen()}`);
    board.make(hit.m);
  }
  return board;
}

/**
 * Which pieces of colour `by` hit `square`, named. The square's own occupant
 * is lifted first when it belongs to `by`: a defender of your own pawn cannot
 * be found by looking for moves onto it, because there are none, and that
 * silently reports every defended square as undefended.
 */
function attackersOf(board, name, by) {
  const square = nameToSquare(name);
  const occupant = board.squares[square];
  const lifted = occupant && colourOf(occupant) === by;
  if (lifted) board.squares[square] = 0;

  const saved = board.turn;
  board.turn = by;
  const letter = { [QUEEN]: 'Q', [ROOK]: 'R', [BISHOP]: 'B', [KNIGHT]: 'N', [KING]: 'K', [PAWN]: '' };
  const found = new Set();

  for (const move of board.generate()) {
    if (moveTo(move) !== square) continue;
    const piece = board.squares[moveFrom(move)];
    // A pawn's forward push reaches a square without attacking it.
    if (typeOf(piece) === PAWN && !(moveFlags(move) & FLAG_CAPTURE)) continue;
    found.add(letter[typeOf(piece)] + squareName(moveFrom(move)));
  }
  // A pawn capture onto an empty square is never generated, so add it by hand.
  const forward = by === WHITE ? 16 : -16;
  for (const side of [-1, 1]) {
    const from = square - forward + side;
    if (from & 0x88) continue;
    const piece = board.squares[from];
    if (piece && colourOf(piece) === by && typeOf(piece) === PAWN) found.add(squareName(from));
  }

  board.turn = saved;
  if (lifted) board.squares[square] = occupant;
  return [...found].sort();
}

/**
 * Where a piece can legally go, named. This reads board.legalMoves(), so the
 * side that OWNS the piece has to be the side to move -- ask about a black
 * bishop in a white-to-move position and it answers "nowhere", which is a
 * confident wrong answer rather than an error. Four claims below are about a
 * bishop with one square or none, and every one of them was written from that
 * wrong answer first.
 */
const movesOf = (board, name) => board.legalMoves()
  .filter((m) => squareName(moveFrom(m)) === name)
  .map((m) => squareName(moveTo(m)))
  .sort();

/**
 * Material for one side in pawns. Used only where a trap says "you are a piece
 * up" or "material is level" -- a claim about who is winning after a sequence
 * is not something attacker-counting can answer.
 */
const VALUE = { [PAWN]: 1, [KNIGHT]: 3, [BISHOP]: 3, [ROOK]: 5, [QUEEN]: 9, [KING]: 0 };
function material(board, colour) {
  let total = 0;
  for (let square = 0; square < 128; square++) {
    if (square & 0x88) continue;
    const piece = board.squares[square];
    if (piece && colourOf(piece) === colour) total += VALUE[typeOf(piece)];
  }
  return total;
}

/** How many bishops each side still owns, for the traps that trade one off. */
function bishops(board, colour) {
  let n = 0;
  for (let square = 0; square < 128; square++) {
    if (square & 0x88) continue;
    const piece = board.squares[square];
    if (piece && typeOf(piece) === BISHOP && colourOf(piece) === colour) n++;
  }
  return n;
}

/** Is this SAN move available to the side to move? */
const canPlay = (board, san) => board.legalMoves()
  .map((m) => toSan(board, m))
  .some((s) => s === san || s.replace(/[+#]$/, '') === san.replace(/[+#]$/, ''));

const eq = (got, want) => JSON.stringify(got) === JSON.stringify(want);

/**
 * Which of a side's minor pieces are still on their starting squares. "The
 * last minor piece" and "every piece out" are claims about this list being
 * empty, and three entries said so with a bishop still sitting on c8.
 */
function minorsAtHome(board, colour) {
  const homes = colour === WHITE ? ['b1', 'c1', 'f1', 'g1'] : ['b8', 'c8', 'f8', 'g8'];
  const want = { b: KNIGHT, c: BISHOP, f: BISHOP, g: KNIGHT };
  return homes.filter((h) => {
    const p = board.squares[nameToSquare(h)];
    return p && colourOf(p) === colour && typeOf(p) === want[h[0]];
  });
}
const minorsOut = (board, colour) => 4 - minorsAtHome(board, colour).length;

/** How many times one side has moved its queen in a SAN line. */
const queenMoves = (line, side) => line.filter((m, i) => (i % 2 === 0) === (side === 'white') && m.startsWith('Q')).length;

// The prose is checked AGAINST the board, so a sentence has to say the number
// the board gives. A claim that only checks the board would stay green while
// the sentence drifted back to the wrong word - which is exactly how the
// audit's findings got in.
const CARDINAL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const ORDINAL = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
const says = (text, re) => re.test(text) || `the prose does not say "${re.source}"`;
const doesNotSay = (text, re) => !re.test(text) || `the prose still says "${re.source}"`;
const all = (...verdicts) => verdicts.find((v) => v !== true) ?? true;

/** The variation of `opening` whose name starts with `prefix`. */
const variation = (opening, prefix) => {
  const v = opening.variations.find((x) => x.name.startsWith(prefix));
  if (!v) throw new Error(`no variation named "${prefix}..." in ${opening.id}`);
  return v;
};
/** Replay a variation up to and including ply `n` (0-based). */
const varBoard = (opening, prefix, n) => fromSan(variation(opening, prefix).line.slice(0, n + 1));

const CLAIMS = [
  {
    id: 'caro-kann-classical',
    says: '4...Nd7 5.Qe2 Ngf6 loses to 6.Nd6 checkmate',
    check: () => {
      const board = fromSan(['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nd7', 'Qe2', 'Ngf6', 'Nd6']);
      return board.outcome() === 'checkmate' || `outcome was ${board.outcome() ?? 'nothing'}`;
    },
  },
  {
    id: 'caro-kann-classical',
    says: 'after h4 h5 with no ...h6 the bishop must leave the diagonal, and taking on h5 loses it',
    check: () => {
      const board = fromSan(['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'e6', 'h5']);
      const squares = board.legalMoves()
        .filter((m) => squareName(moveFrom(m)) === 'g6')
        .map((m) => squareName(moveTo(m)))
        .sort();
      if (squares.includes('h7')) return 'h7 was available after all';
      if (!squares.includes('f5') || !squares.includes('e4')) return `bishop squares were ${squares.join(' ')}`;
      const takes = attackersOf(board, 'h5', WHITE);
      return takes.includes('Rh1') || `nothing recaptures on h5 (${takes.join(' ') || 'empty'})`;
    },
  },
  {
    id: 'caro-kann-classical',
    says: 'an early Bc4 is answered by ...d5, which blocks the diagonal and hits the bishop',
    check: () => {
      const board = fromSan(['e4', 'c6', 'Bc4', 'd5']);
      return eq(attackersOf(board, 'c4', BLACK), ['d5']) || `c4 attacked by ${attackersOf(board, 'c4', BLACK).join(' ')}`;
    },
  },
  {
    id: 'italian-game',
    says: '6.Nxf7 is a sacrifice, not a win of material, because Kxf7 is legal',
    check: () => {
      const board = fromSan(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Nxd5', 'Nxf7']);
      const replies = board.legalMoves().map((m) => toSan(board, m));
      return replies.includes('Kxf7') || 'Kxf7 was not legal';
    },
  },
  {
    id: 'italian-game',
    says: 'with a knight on g4 and a bishop on c5, f2 is attacked twice and defended once - and castling defends it twice',
    check: () => {
      const before = fromSan(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'Ng4']);
      if (!eq(attackersOf(before, 'f2', BLACK), ['Bc5', 'Ng4'])) return `attacked by ${attackersOf(before, 'f2', BLACK).join(' ')}`;
      if (!eq(attackersOf(before, 'f2', WHITE), ['Ke1'])) return `defended by ${attackersOf(before, 'f2', WHITE).join(' ')}`;
      const after = fromSan(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'O-O', 'Ng4']);
      return eq(attackersOf(after, 'f2', WHITE), ['Kg1', 'Rf1']) || `after castling, defended by ${attackersOf(after, 'f2', WHITE).join(' ')}`;
    },
  },
  {
    id: 'queens-gambit-declined',
    says: 'a knight on g5 attacks f7 once while the king and the rook on f8 defend it twice, with no bishop on c4',
    check: () => {
      const main = fromSan(['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'Nbd7']);
      // The same position with White's dark bishop replaced by a knight on g5,
      // which is the piece the trap is actually about.
      const board = new Board(main.fen().replace('3p2B1', '3p2N1'));
      if (!eq(attackersOf(board, 'f7', WHITE), ['Ng5'])) return `f7 attacked by ${attackersOf(board, 'f7', WHITE).join(' ')}`;
      if (!eq(attackersOf(board, 'f7', BLACK), ['Kg8', 'Rf8'])) return `f7 defended by ${attackersOf(board, 'f7', BLACK).join(' ')}`;
      // c4 is not empty - White's gambit pawn is sitting on it. The claim is
      // that no BISHOP is there, which is what ...e6 on move four bought.
      const onC4 = board.squares[nameToSquare('c4')];
      if (typeOf(onC4) === BISHOP) return 'a bishop is on c4 after all';
      const onF1 = board.squares[nameToSquare('f1')];
      return (typeOf(onF1) === BISHOP && colourOf(onF1) === WHITE)
        || 'the light-squared bishop is not still at home on f1';
    },
  },
  {
    id: 'scandinavian-nc3',
    says: 'the queen really can check on e5, and Be2 blocks it',
    check: () => {
      const board = fromSan(['e4', 'd5', 'exd5', 'Qxd5', 'Nc3']);
      if (!board.legalMoves().map((m) => toSan(board, m)).includes('Qe5+')) return 'Qe5+ was not available';
      fromSan(['Qe5+', 'Be2'], board);
      return true;
    },
  },
  {
    id: 'sicilian-alapin',
    says: 'nothing attacks a black queen on d5, because c3 is taken by your own pawn',
    check: () => {
      const board = fromSan(['e4', 'c5', 'c3', 'd5', 'exd5', 'Qxd5']);
      const hits = attackersOf(board, 'd5', WHITE);
      return hits.length === 0 || `d5 attacked by ${hits.join(' ')}`;
    },
  },

  // ── the twelve added later ───────────────────────────────────────────────

  {
    id: 'london-system',
    says: 'the Englund line 6.Bc3 Bb4 7.Qd2 Bxc3 8.Qxc3 Qc1 really is checkmate',
    check: () => {
      const board = fromSan(['d4', 'e5', 'dxe5', 'Nc6', 'Nf3', 'Qe7', 'Bf4', 'Qb4+', 'Bd2', 'Qxb2',
        'Bc3', 'Bb4', 'Qd2', 'Bxc3', 'Qxc3', 'Qc1']);
      return board.outcome() === 'checkmate' || `outcome was ${board.outcome() ?? 'nothing'}`;
    },
  },
  {
    id: 'london-system',
    says: 'after 6.Nc3 instead, the rook on a1 is defended by the queen on d1',
    check: () => {
      const board = fromSan(['d4', 'e5', 'dxe5', 'Nc6', 'Nf3', 'Qe7', 'Bf4', 'Qb4+', 'Bd2', 'Qxb2', 'Nc3']);
      return eq(attackersOf(board, 'a1', WHITE), ['Qd1'])
        || `a1 defended by ${attackersOf(board, 'a1', WHITE).join(' ') || 'nothing'}`;
    },
  },
  {
    id: 'london-system',
    says: 'after ...Nxg3 hxg3 the rook on h1 reaches every square from h2 to h7',
    check: () => {
      // A black move is played last so that it is White to move and movesOf
      // is looking at the right army.
      const board = fromSan(['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'Nh5', 'Bg3', 'Nxg3', 'hxg3', 'e6']);
      const want = ['h2', 'h3', 'h4', 'h5', 'h6', 'h7'];
      const got = movesOf(board, 'h1');
      return want.every((s) => got.includes(s)) || `the rook on h1 reaches ${got.join(' ')}`;
    },
  },
  {
    id: 'london-system',
    says: 'b2 is defended by nothing once the bishop has gone to f4, and Qb3 and Qc1 both answer ...Qb6',
    check: () => {
      const board = fromSan(['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'e6', 'e3', 'Bd6', 'Bg3', 'O-O', 'Bd3', 'c5', 'c3', 'Nc6']);
      const defenders = attackersOf(board, 'b2', WHITE);
      if (defenders.length) return `b2 defended by ${defenders.join(' ')}`;
      fromSan(['O-O', 'Qb6'], board);
      if (!eq(attackersOf(board, 'b2', BLACK), ['Qb6'])) return `b2 attacked by ${attackersOf(board, 'b2', BLACK).join(' ')}`;
      return (canPlay(board, 'Qb3') && canPlay(board, 'Qc1')) || 'Qb3 or Qc1 was not legal';
    },
  },
  {
    id: 'london-system',
    says: 'd4 finishes attacked twice and defended three times',
    check: () => {
      const board = fromSan(['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'e6', 'e3', 'Bd6', 'Bg3', 'O-O', 'Bd3', 'c5', 'c3', 'Nc6']);
      if (!eq(attackersOf(board, 'd4', BLACK), ['Nc6', 'c5'])) return `attacked by ${attackersOf(board, 'd4', BLACK).join(' ')}`;
      return eq(attackersOf(board, 'd4', WHITE), ['Nf3', 'c3', 'e3'])
        || `defended by ${attackersOf(board, 'd4', WHITE).join(' ')}`;
    },
  },

  {
    id: 'colle-system',
    says: 'the dark-squared bishop on c1 has zero legal moves in the finished setup',
    check: () => {
      const board = fromSan(['d4', 'd5', 'Nf3', 'Nf6', 'e3', 'e6', 'Bd3', 'c5', 'c3', 'Nc6', 'Nbd2', 'Bd6', 'O-O', 'O-O']);
      const got = movesOf(board, 'c1');
      return got.length === 0 || `the c1 bishop can go to ${got.join(' ')}`;
    },
  },
  {
    id: 'colle-system',
    says: 'h7 is one attacker against two defenders with the knight on f6, and two against one once it leaves and a knight reaches g5',
    check: () => {
      const held = fromSan(['d4', 'd5', 'Nf3', 'Nf6', 'e3', 'e6', 'Bd3', 'c5', 'c3', 'Nc6', 'Nbd2', 'Bd6', 'O-O', 'O-O']);
      if (!eq(attackersOf(held, 'h7', WHITE), ['Bd3'])) return `h7 attacked by ${attackersOf(held, 'h7', WHITE).join(' ')}`;
      if (!eq(attackersOf(held, 'h7', BLACK), ['Kg8', 'Nf6'])) return `h7 defended by ${attackersOf(held, 'h7', BLACK).join(' ')}`;
      const gone = fromSan(['Qe2', 'Nd7', 'Ng5'], new Board(held.fen()));
      if (!eq(attackersOf(gone, 'h7', WHITE), ['Bd3', 'Ng5'])) return `then attacked by ${attackersOf(gone, 'h7', WHITE).join(' ')}`;
      return eq(attackersOf(gone, 'h7', BLACK), ['Kg8']) || `then defended by ${attackersOf(gone, 'h7', BLACK).join(' ')}`;
    },
  },
  {
    id: 'colle-system',
    says: 'after ...c4 Bc2 b3 the pawn on c4 is hit by the b-pawn and the knight on d2',
    check: () => {
      const board = fromSan(['d4', 'd5', 'Nf3', 'Nf6', 'e3', 'e6', 'Bd3', 'c5', 'c3', 'Nc6', 'Nbd2', 'Bd6',
        'O-O', 'O-O', 'Re1', 'c4', 'Bc2', 'b5', 'b3']);
      return eq(attackersOf(board, 'c4', WHITE), ['Nd2', 'b3'])
        || `c4 attacked by ${attackersOf(board, 'c4', WHITE).join(' ')}`;
    },
  },
  {
    id: 'colle-system',
    says: 'e4 finishes attacked twice by each side',
    check: () => {
      const board = fromSan(['d4', 'd5', 'Nf3', 'Nf6', 'e3', 'e6', 'Bd3', 'c5', 'c3', 'Nc6', 'Nbd2', 'Bd6', 'O-O', 'O-O']);
      if (!eq(attackersOf(board, 'e4', WHITE), ['Bd3', 'Nd2'])) return `white holds e4 with ${attackersOf(board, 'e4', WHITE).join(' ')}`;
      return eq(attackersOf(board, 'e4', BLACK), ['Nf6', 'd5']) || `black holds e4 with ${attackersOf(board, 'e4', BLACK).join(' ')}`;
    },
  },

  {
    id: 'kings-indian-attack',
    says: 'the same seven white moves are legal against two completely different black setups',
    check: () => {
      fromSan(['Nf3', 'c5', 'g3', 'Nc6', 'Bg2', 'g6', 'O-O', 'Bg7', 'd3', 'd6', 'Nbd2', 'e5', 'e4', 'Nge7']);
      fromSan(['Nf3', 'Nf6', 'g3', 'g6', 'Bg2', 'Bg7', 'O-O', 'O-O', 'd3', 'd6', 'Nbd2', 'e5', 'e4', 'Nc6']);
      return true;
    },
  },
  {
    id: 'kings-indian-attack',
    says: 'the bishop on g2 has exactly two legal moves, h1 and h3',
    check: () => {
      const board = fromSan(['Nf3', 'd5', 'g3', 'Nf6', 'Bg2', 'e6', 'O-O', 'Be7', 'd3', 'O-O', 'Nbd2', 'c5', 'e4', 'Nc6']);
      return eq(movesOf(board, 'g2'), ['h1', 'h3']) || `the g2 bishop can go to ${movesOf(board, 'g2').join(' ') || 'nowhere'}`;
    },
  },
  {
    id: 'kings-indian-attack',
    says: 'e4 is held by d3 and the knight on d2, and e5 then attacks the knight on f6',
    check: () => {
      const board = fromSan(['Nf3', 'd5', 'g3', 'Nf6', 'Bg2', 'e6', 'O-O', 'Be7', 'd3', 'O-O', 'Nbd2', 'c5', 'e4', 'Nc6']);
      if (!eq(attackersOf(board, 'e4', WHITE), ['Nd2', 'd3'])) return `e4 defended by ${attackersOf(board, 'e4', WHITE).join(' ')}`;
      if (!eq(attackersOf(board, 'e4', BLACK), ['Nf6', 'd5'])) return `e4 attacked by ${attackersOf(board, 'e4', BLACK).join(' ')}`;
      const pushed = fromSan(['e5'], new Board(board.fen()));
      return eq(attackersOf(pushed, 'f6', WHITE), ['e5']) || `f6 attacked by ${attackersOf(pushed, 'f6', WHITE).join(' ') || 'nothing'}`;
    },
  },

  {
    id: 'scotch-game',
    says: '3.d4 leaves e5 attacked twice and defended once, and 5.Nb3 attacks the bishop on c5',
    check: () => {
      const board = fromSan(['e4', 'e5', 'Nf3', 'Nc6', 'd4']);
      if (!eq(attackersOf(board, 'e5', WHITE), ['Nf3', 'd4'])) return `e5 attacked by ${attackersOf(board, 'e5', WHITE).join(' ')}`;
      if (!eq(attackersOf(board, 'e5', BLACK), ['Nc6'])) return `e5 defended by ${attackersOf(board, 'e5', BLACK).join(' ')}`;
      const back = fromSan(['exd4', 'Nxd4', 'Bc5', 'Nb3'], board);
      return eq(attackersOf(back, 'c5', WHITE), ['Nb3']) || `c5 attacked by ${attackersOf(back, 'c5', WHITE).join(' ') || 'nothing'}`;
    },
  },
  {
    id: 'scotch-game',
    says: 'after 5.Nxc6 Qf6 the knight on c6 is attacked three times and defended by nothing',
    check: () => {
      const board = fromSan(['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Bc5', 'Nxc6', 'Qf6']);
      if (!eq(attackersOf(board, 'c6', BLACK), ['Qf6', 'b7', 'd7'])) return `c6 attacked by ${attackersOf(board, 'c6', BLACK).join(' ')}`;
      const held = attackersOf(board, 'c6', WHITE);
      return held.length === 0 || `c6 defended by ${held.join(' ')}`;
    },
  },
  {
    id: 'scotch-game',
    says: '4...Qh4 5.Nc3 leaves e4 attacked once and defended once',
    check: () => {
      const board = fromSan(['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Qh4', 'Nc3']);
      if (!eq(attackersOf(board, 'e4', BLACK), ['Qh4'])) return `e4 attacked by ${attackersOf(board, 'e4', BLACK).join(' ')}`;
      return eq(attackersOf(board, 'e4', WHITE), ['Nc3']) || `e4 defended by ${attackersOf(board, 'e4', WHITE).join(' ')}`;
    },
  },
  {
    id: 'scotch-game',
    says: 'f2 ends attacked once and defended once, the rook on f1 recaptures after castling, and Bxf2+ Kxf2 Ng4+ Kg1 leaves white a bishop up with no check',
    check: () => {
      const board = fromSan(['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Bc5', 'Nb3', 'Bb6', 'Nc3', 'Nf6', 'Bd3', 'd6']);
      if (!eq(attackersOf(board, 'f2', BLACK), ['Bb6'])) return `f2 attacked by ${attackersOf(board, 'f2', BLACK).join(' ')}`;
      if (!eq(attackersOf(board, 'f2', WHITE), ['Ke1'])) return `f2 defended by ${attackersOf(board, 'f2', WHITE).join(' ')}`;
      const castled = fromSan(['O-O', 'Bxf2+'], new Board(board.fen()));
      if (!eq(attackersOf(castled, 'f2', WHITE), ['Kg1', 'Rf1'])) return `after castling f2 is retaken by ${attackersOf(castled, 'f2', WHITE).join(' ')}`;
      const grabbed = fromSan(['a4', 'Bxf2+', 'Kxf2', 'Ng4+', 'Kg1'], new Board(board.fen()));
      if (grabbed.inCheck()) return 'white is still in check after Kg1';
      const edge = material(grabbed, WHITE) - material(grabbed, BLACK);
      return edge === 2 || `white is ${edge} ahead, not a bishop for a pawn`;
    },
  },
  {
    id: 'scotch-game',
    says: 'recapturing with the queen lets ...Bc5 attack her',
    check: () => {
      const board = fromSan(['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Nxd4', 'Qxd4', 'Nf6', 'Nc3', 'Bc5']);
      return attackersOf(board, 'd4', BLACK).includes('Bc5') || `the queen on d4 is attacked by ${attackersOf(board, 'd4', BLACK).join(' ') || 'nothing'}`;
    },
  },

  {
    id: 'vienna-game',
    says: '3...Nxe4 4.Nxe4 d5 hits both pieces, 5.Ng3 dxc4 costs a pawn, and 5.Bd3 dxe4 6.Bxe4 is level',
    check: () => {
      const board = fromSan(['e4', 'e5', 'Nc3', 'Nf6', 'Bc4', 'Nxe4', 'Nxe4', 'd5']);
      if (!attackersOf(board, 'c4', BLACK).includes('d5')) return `c4 attacked by ${attackersOf(board, 'c4', BLACK).join(' ') || 'nothing'}`;
      if (!attackersOf(board, 'e4', BLACK).includes('d5')) return `e4 attacked by ${attackersOf(board, 'e4', BLACK).join(' ') || 'nothing'}`;
      const ran = fromSan(['Ng3', 'dxc4'], new Board(board.fen()));
      const cost = material(ran, WHITE) - material(ran, BLACK);
      if (cost !== -1) return `moving the knight leaves white ${cost}, not one pawn down`;
      const right = fromSan(['Bd3', 'dxe4', 'Bxe4'], new Board(board.fen()));
      const level = material(right, WHITE) - material(right, BLACK);
      return level === 0 || `after 6.Bxe4 white is ${level} up, not level`;
    },
  },
  {
    id: 'vienna-game',
    says: 'f2 ends attacked once and defended twice, by the king and the rook that castling brought to f1',
    check: () => {
      const board = fromSan(['e4', 'e5', 'Nc3', 'Nf6', 'Bc4', 'Nc6', 'd3', 'Bc5', 'Nf3', 'd6', 'O-O', 'O-O']);
      if (!eq(attackersOf(board, 'f2', BLACK), ['Bc5'])) return `f2 attacked by ${attackersOf(board, 'f2', BLACK).join(' ')}`;
      return eq(attackersOf(board, 'f2', WHITE), ['Kg1', 'Rf1']) || `f2 defended by ${attackersOf(board, 'f2', WHITE).join(' ')}`;
    },
  },
  {
    id: 'vienna-game',
    says: 'after 3.f4 exf4 4.d4 Qh4+ white has only Ke2, Kd2 and g3 - and 4.Nf3 first means the same check loses the queen',
    check: () => {
      const loose = fromSan(['e4', 'e5', 'Nc3', 'Nc6', 'f4', 'exf4', 'd4', 'Qh4+']);
      const replies = loose.legalMoves().map((m) => toSan(loose, m)).sort();
      if (!eq(replies, ['Kd2', 'Ke2', 'g3'])) return `white's replies are ${replies.join(' ')}`;
      const sound = fromSan(['e4', 'e5', 'Nc3', 'Nc6', 'f4', 'exf4', 'Nf3', 'Qh4+']);
      if (!canPlay(sound, 'Nxh4')) return 'Nxh4 was not available';
      const won = fromSan(['Nxh4'], sound);
      const edge = material(won, WHITE) - material(won, BLACK);
      return edge === 8 || `white is ${edge} ahead, not a queen for a pawn`;
    },
  },

  {
    id: 'ruy-lopez-d3',
    says: 'Bb5 attacks the knight on c6, which is the only defender of e5',
    check: () => {
      const board = fromSan(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
      if (!eq(attackersOf(board, 'c6', WHITE), ['Bb5'])) return `c6 attacked by ${attackersOf(board, 'c6', WHITE).join(' ')}`;
      return eq(attackersOf(board, 'e5', BLACK), ['Nc6']) || `e5 defended by ${attackersOf(board, 'e5', BLACK).join(' ')}`;
    },
  },
  {
    id: 'ruy-lopez-d3',
    says: 'e4 ends attacked once by the knight on f6 and defended once by the pawn on d3',
    check: () => {
      const board = fromSan(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'd3', 'b5', 'Bb3', 'Be7', 'O-O', 'O-O']);
      if (!eq(attackersOf(board, 'e4', BLACK), ['Nf6'])) return `e4 attacked by ${attackersOf(board, 'e4', BLACK).join(' ')}`;
      return eq(attackersOf(board, 'e4', WHITE), ['d3']) || `e4 defended by ${attackersOf(board, 'e4', WHITE).join(' ')}`;
    },
  },
  {
    id: 'ruy-lopez-d3',
    says: 'in the Noah Ark line the bishop on b3 has only a4 and c4 left, and the pawn on b5 covers both',
    check: () => {
      const board = fromSan(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'd6', 'd4', 'b5', 'Bb3', 'Nxd4',
        'Nxd4', 'exd4', 'Qxd4', 'c5', 'Qd5', 'Be6', 'Qc6+', 'Bd7', 'Qd5', 'c4']);
      if (!eq(movesOf(board, 'b3'), ['a4', 'c4'])) return `the b3 bishop can go to ${movesOf(board, 'b3').join(' ') || 'nowhere'}`;
      if (!attackersOf(board, 'a4', BLACK).includes('b5')) return `a4 is covered by ${attackersOf(board, 'a4', BLACK).join(' ') || 'nothing'}`;
      return attackersOf(board, 'c4', BLACK).includes('b5') || `c4 is covered by ${attackersOf(board, 'c4', BLACK).join(' ') || 'nothing'}`;
    },
  },
  {
    id: 'ruy-lopez-d3',
    says: 'after 4.Bxc6 dxc6 5.Nxe5 Qd4 the knight on e5 is undefended and e4 is hit as well',
    check: () => {
      const board = fromSan(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6', 'Nxe5', 'Qd4']);
      if (!attackersOf(board, 'e5', BLACK).includes('Qd4')) return `e5 attacked by ${attackersOf(board, 'e5', BLACK).join(' ') || 'nothing'}`;
      const held = attackersOf(board, 'e5', WHITE);
      if (held.length) return `the knight on e5 is defended by ${held.join(' ')}`;
      return attackersOf(board, 'e4', BLACK).includes('Qd4') || `e4 attacked by ${attackersOf(board, 'e4', BLACK).join(' ') || 'nothing'}`;
    },
  },

  {
    id: 'stonewall-dutch',
    says: 'Qh5 is not even legal after 1.d4 f5, and is check after 1.e4 e5 2.Bc4 f5',
    check: () => {
      const safe = fromSan(['d4', 'f5']);
      if (safe.legalMoves().map((m) => toSan(safe, m)).some((s) => s.startsWith('Qh5'))) return 'Qh5 was legal after 1.d4 f5';
      const fatal = fromSan(['e4', 'e5', 'Bc4', 'f5']);
      return canPlay(fatal, 'Qh5+') || 'Qh5+ was not available after 1.e4 e5 2.Bc4 f5';
    },
  },
  {
    id: 'stonewall-dutch',
    says: 'the Staunton line 2.e4 fxe4 3.Nc3 Nf6 4.Bg5 e6 5.Bxf6 Qxf6 6.Nxe4 ends dead level',
    check: () => {
      const board = fromSan(['d4', 'f5', 'e4', 'fxe4', 'Nc3', 'Nf6', 'Bg5', 'e6', 'Bxf6', 'Qxf6', 'Nxe4']);
      const edge = material(board, WHITE) - material(board, BLACK);
      return edge === 0 || `white is ${edge} ahead, not level`;
    },
  },
  {
    id: 'stonewall-dutch',
    says: 'after 2.Bg5 Nf6 3.Bxf6 exf6 black has two bishops against one',
    check: () => {
      const board = fromSan(['d4', 'f5', 'Bg5', 'Nf6', 'Bxf6', 'exf6']);
      return (bishops(board, BLACK) === 2 && bishops(board, WHITE) === 1)
        || `white has ${bishops(board, WHITE)} bishops and black has ${bishops(board, BLACK)}`;
    },
  },
  {
    id: 'stonewall-dutch',
    says: 'e4 is covered by d5, f5 and the knight on f6 and by nothing of white; the c8 bishop has one move, to d7; nothing attacks f7',
    check: () => {
      const board = fromSan(['d4', 'f5', 'c4', 'Nf6', 'g3', 'e6', 'Bg2', 'd5', 'Nf3', 'c6', 'O-O', 'Bd6', 'b3', 'O-O']);
      if (!eq(attackersOf(board, 'e4', BLACK), ['Nf6', 'd5', 'f5'])) return `e4 covered by ${attackersOf(board, 'e4', BLACK).join(' ')}`;
      const contested = attackersOf(board, 'e4', WHITE);
      if (contested.length) return `white also covers e4 with ${contested.join(' ')}`;
      const hits = attackersOf(board, 'f7', WHITE);
      if (hits.length) return `f7 is attacked by ${hits.join(' ')}`;
      // A white move first, so the black bishop is the side to move.
      const black = fromSan(['Bb2'], new Board(board.fen()));
      return eq(movesOf(black, 'c8'), ['d7']) || `the c8 bishop can go to ${movesOf(black, 'c8').join(' ') || 'nowhere'}`;
    },
  },

  {
    id: 'scandinavian-qd6',
    says: 'skipping ...a6 lets Nb5 attack the queen on d6 and the pawn on c7 at once',
    check: () => {
      const board = fromSan(['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qd6', 'd4', 'Nf6', 'Nf3', 'Bf5', 'Nb5']);
      if (!attackersOf(board, 'd6', WHITE).includes('Nb5')) return `d6 attacked by ${attackersOf(board, 'd6', WHITE).join(' ') || 'nothing'}`;
      return attackersOf(board, 'c7', WHITE).includes('Nb5') || `c7 attacked by ${attackersOf(board, 'c7', WHITE).join(' ') || 'nothing'}`;
    },
  },
  {
    id: 'scandinavian-qd6',
    says: 'in the 3...Qa5 line the bishop on d2 hits the queen only once Nd5 moves the knight out of the way',
    check: () => {
      const board = fromSan(['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'Nf6', 'Nf3', 'c6', 'Bc4', 'Bf5', 'Bd2', 'e6']);
      const before = attackersOf(board, 'a5', WHITE);
      if (before.length) return `the queen on a5 was already attacked by ${before.join(' ')}`;
      fromSan(['Nd5'], board);
      return eq(attackersOf(board, 'a5', WHITE), ['Bd2']) || `after Nd5 the queen is attacked by ${attackersOf(board, 'a5', WHITE).join(' ') || 'nothing'}`;
    },
  },
  {
    id: 'scandinavian-qd6',
    says: 'nothing attacks f7 in the finished position and the c8 bishop has one move, to d7',
    check: () => {
      const board = fromSan(['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qd6', 'd4', 'Nf6', 'Nf3', 'a6', 'Bc4', 'e6', 'O-O', 'Be7']);
      const hits = attackersOf(board, 'f7', WHITE);
      if (hits.length) return `f7 is attacked by ${hits.join(' ')}`;
      const black = fromSan(['Re1'], new Board(board.fen()));
      return eq(movesOf(black, 'c8'), ['d7']) || `the c8 bishop can go to ${movesOf(black, 'c8').join(' ') || 'nowhere'}`;
    },
  },

  {
    id: 'french-rubinstein',
    says: 'when the bishop reaches d3, h7 is attacked once and defended twice',
    check: () => {
      const board = fromSan(['e4', 'e6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nd7', 'Nf3', 'Ngf6', 'Nxf6+', 'Nxf6', 'Bd3']);
      if (!eq(attackersOf(board, 'h7', WHITE), ['Bd3'])) return `h7 attacked by ${attackersOf(board, 'h7', WHITE).join(' ')}`;
      return eq(attackersOf(board, 'h7', BLACK), ['Nf6', 'Rh8']) || `h7 defended by ${attackersOf(board, 'h7', BLACK).join(' ')}`;
    },
  },
  {
    id: 'french-rubinstein',
    says: 'the Caro-Kann mate does not exist here: Nd6 is a check, the king can step to e7, and ...Bxd6 takes the knight for free',
    check: () => {
      const board = fromSan(['e4', 'e6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nd7', 'Qe2', 'Ngf6', 'Nd6+']);
      if (board.outcome() === 'checkmate') return 'it really is checkmate';
      if (!board.inCheck()) return 'Nd6 was not even a check';
      if (!canPlay(board, 'Ke7')) return 'the king could not step to e7';
      fromSan(['Bxd6'], board);
      const held = attackersOf(board, 'd6', WHITE);
      return held.length === 0 || `d6 is defended by ${held.join(' ')}`;
    },
  },
  {
    id: 'french-rubinstein',
    says: 'recapturing with the g-pawn leaves black no pawn at all on the g-file',
    check: () => {
      const board = fromSan(['e4', 'e6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nd7', 'Nf3', 'Ngf6', 'Nxf6+', 'gxf6']);
      let left = 0;
      for (let rank = 1; rank <= 8; rank++) {
        const piece = board.squares[nameToSquare('g' + rank)];
        if (piece && typeOf(piece) === PAWN && colourOf(piece) === BLACK) left++;
      }
      return left === 0 || `black still has ${left} pawn(s) on the g-file`;
    },
  },
  {
    id: 'french-rubinstein',
    says: 'against 3.e5 the move ...c5 attacks d4',
    check: () => {
      const board = fromSan(['e4', 'e6', 'd4', 'd5', 'e5', 'c5']);
      return attackersOf(board, 'd4', BLACK).includes('c5') || `d4 attacked by ${attackersOf(board, 'd4', BLACK).join(' ') || 'nothing'}`;
    },
  },

  {
    id: 'slav-defence',
    says: 'after 5.Nc3 d5 is leaned on twice and held three times',
    check: () => {
      const board = fromSan(['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'e3', 'Bf5', 'Nc3']);
      if (!eq(attackersOf(board, 'd5', WHITE), ['Nc3', 'c4'])) return `d5 attacked by ${attackersOf(board, 'd5', WHITE).join(' ')}`;
      return eq(attackersOf(board, 'd5', BLACK), ['Nf6', 'Qd8', 'c6']) || `d5 held by ${attackersOf(board, 'd5', BLACK).join(' ')}`;
    },
  },
  {
    id: 'slav-defence',
    says: 'playing ...e6 before ...Bf5 leaves the c8 bishop with one move, to d7',
    check: () => {
      // White to move after ...e6, so a white move is played to hand the turn back.
      const board = fromSan(['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'e3', 'e6', 'Nc3']);
      return eq(movesOf(board, 'c8'), ['d7']) || `the c8 bishop can go to ${movesOf(board, 'c8').join(' ') || 'nowhere'}`;
    },
  },
  {
    id: 'slav-defence',
    says: 'holding c4 with ...b5 loses a rook for a knight, and nothing recaptures on a8',
    check: () => {
      const board = fromSan(['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'e3', 'b5', 'a4', 'a6',
        'axb5', 'cxb5', 'Nxb5', 'axb5', 'Rxa8']);
      const back = attackersOf(board, 'a8', BLACK);
      if (back.length) return `black recaptures on a8 with ${back.join(' ')}`;
      const edge = material(board, WHITE) - material(board, BLACK);
      return edge === 2 || `white is ${edge} ahead, not a rook for a knight`;
    },
  },
  {
    id: 'slav-defence',
    says: 'nothing attacks f7 in the finished position and both sides still have one bishop',
    check: () => {
      const board = fromSan(['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'e3', 'Bf5', 'Nc3', 'e6', 'Bd3', 'Bxd3', 'Qxd3', 'Nbd7']);
      const hits = attackersOf(board, 'f7', WHITE);
      if (hits.length) return `f7 is attacked by ${hits.join(' ')}`;
      return (bishops(board, WHITE) === 1 && bishops(board, BLACK) === 1)
        || `white has ${bishops(board, WHITE)} bishops and black has ${bishops(board, BLACK)}`;
    },
  },

  {
    id: 'kings-indian-defence',
    says: 'e5 ends attacked twice and defended twice, and after dxe5 dxe5 Nxe5 the knight is defended by nothing',
    check: () => {
      const board = fromSan(['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5', 'O-O', 'Nc6']);
      if (!eq(attackersOf(board, 'e5', BLACK), ['Nc6', 'd6'])) return `e5 defended by ${attackersOf(board, 'e5', BLACK).join(' ')}`;
      if (!eq(attackersOf(board, 'e5', WHITE), ['Nf3', 'd4'])) return `e5 attacked by ${attackersOf(board, 'e5', WHITE).join(' ')}`;
      const grabbed = fromSan(['dxe5', 'dxe5', 'Nxe5'], new Board(board.fen()));
      if (!eq(attackersOf(grabbed, 'e5', BLACK), ['Nc6'])) return `after Nxe5 the knight is attacked by ${attackersOf(grabbed, 'e5', BLACK).join(' ')}`;
      const held = attackersOf(grabbed, 'e5', WHITE);
      return held.length === 0 || `the knight on e5 is defended by ${held.join(' ')}`;
    },
  },
  {
    id: 'kings-indian-defence',
    says: 'once white plays d5 and the knight goes to e7, the bishop on g7 has only h6 and h8',
    check: () => {
      const board = fromSan(['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5',
        'O-O', 'Nc6', 'd5', 'Ne7', 'b4']);
      return eq(movesOf(board, 'g7'), ['h6', 'h8']) || `the g7 bishop can go to ${movesOf(board, 'g7').join(' ') || 'nowhere'}`;
    },
  },
  {
    id: 'kings-indian-defence',
    says: 'against 5.f4 the move ...c5 attacks d4, which only the queen defends',
    check: () => {
      const board = fromSan(['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'f4', 'c5']);
      if (!attackersOf(board, 'd4', BLACK).includes('c5')) return `d4 attacked by ${attackersOf(board, 'd4', BLACK).join(' ') || 'nothing'}`;
      return eq(attackersOf(board, 'd4', WHITE), ['Qd1']) || `d4 defended by ${attackersOf(board, 'd4', WHITE).join(' ')}`;
    },
  },

  {
    id: 'english-four-knights',
    says: 'after 3.Nf3 the pawn on e5 is attacked and defended by nothing at all',
    check: () => {
      const board = fromSan(['c4', 'e5', 'Nc3', 'Nf6', 'Nf3']);
      if (!eq(attackersOf(board, 'e5', WHITE), ['Nf3'])) return `e5 attacked by ${attackersOf(board, 'e5', WHITE).join(' ')}`;
      const held = attackersOf(board, 'e5', BLACK);
      return held.length === 0 || `e5 is already defended by ${held.join(' ')}`;
    },
  },
  {
    id: 'english-four-knights',
    says: '...d5 attacks c4 and is held by the queen, and recapturing with the queen loses her for a knight',
    check: () => {
      const board = fromSan(['c4', 'e5', 'Nc3', 'Nf6', 'Nf3', 'Nc6', 'g3', 'd5']);
      if (!attackersOf(board, 'c4', BLACK).includes('d5')) return `c4 attacked by ${attackersOf(board, 'c4', BLACK).join(' ') || 'nothing'}`;
      if (!attackersOf(board, 'd5', BLACK).includes('Qd8')) return `d5 defended by ${attackersOf(board, 'd5', BLACK).join(' ')}`;
      const greedy = fromSan(['cxd5', 'Qxd5'], new Board(board.fen()));
      if (!attackersOf(greedy, 'd5', WHITE).includes('Nc3')) return `the queen on d5 is attacked by ${attackersOf(greedy, 'd5', WHITE).join(' ') || 'nothing'}`;
      const lost = fromSan(['Nxd5', 'Nxd5'], greedy);
      const edge = material(lost, WHITE) - material(lost, BLACK);
      return edge === 6 || `white is ${edge} ahead, not a queen for a knight`;
    },
  },
  {
    id: 'english-four-knights',
    says: 'leaving the tension lets black push ...d4, which attacks the knight on c3',
    check: () => {
      const board = fromSan(['c4', 'e5', 'Nc3', 'Nf6', 'Nf3', 'Nc6', 'g3', 'd5', 'd3', 'd4']);
      return attackersOf(board, 'c3', BLACK).includes('d4')
        || `the knight on c3 is attacked by ${attackersOf(board, 'c3', BLACK).join(' ') || 'nothing'}`;
    },
  },
  {
    id: 'english-four-knights',
    says: 'the bishop on g2 is blocked by white own knight on f3, and joins the attack on d5 the moment it moves',
    check: () => {
      const board = fromSan(['c4', 'e5', 'Nc3', 'Nf6', 'Nf3', 'Nc6', 'g3', 'd5', 'cxd5', 'Nxd5', 'Bg2']);
      if (!eq(attackersOf(board, 'd5', WHITE), ['Nc3'])) return `d5 attacked by ${attackersOf(board, 'd5', WHITE).join(' ')}`;
      const opened = fromSan(['Be7', 'Nd4'], new Board(board.fen()));
      return eq(attackersOf(opened, 'd5', WHITE), ['Bg2', 'Nc3']) || `once the knight leaves f3, d5 is attacked by ${attackersOf(opened, 'd5', WHITE).join(' ')}`;
    },
  },
  {
    id: 'english-four-knights',
    says: 'against an early d4, ...exd4 Qxd4 Nc6 wins the move straight back',
    check: () => {
      const board = fromSan(['c4', 'e5', 'd4', 'exd4', 'Qxd4', 'Nc6']);
      return attackersOf(board, 'd4', BLACK).includes('Nc6') || `the queen on d4 is attacked by ${attackersOf(board, 'd4', BLACK).join(' ') || 'nothing'}`;
    },
  },

  // ── the audit's five findings, each pinned to BOTH the board and the words ──
  //
  // These sentences were on screen for weeks saying "third" over a square the
  // move generator counted twice. Each check below reads the board, then reads
  // the sentence, and fails if either half disagrees with the other.

  {
    id: 'queens-gambit-declined',
    says: 'Nc3 is the SECOND attacker of d5 (c4 and the knight) and Nf6 the third defender - and the ideas say so',
    check: (o) => {
      const board = fromSan(o.line.slice(0, 5));
      const attackers = attackersOf(board, 'd5', WHITE);
      if (!eq(attackers, ['Nc3', 'c4'])) return `d5 attacked by ${attackers.join(' ')}`;
      const after = fromSan(o.line.slice(0, 6));
      if (!eq(attackersOf(after, 'd5', BLACK), ['Nf6', 'Qd8', 'e6'])) return `d5 defended by ${attackersOf(after, 'd5', BLACK).join(' ')}`;
      return all(
        says(o.ideas[4], new RegExp(`${ORDINAL[attackers.length]} attacker`)),
        doesNotSay(o.ideas[4], /third attacker/),
        says(o.ideas[5], /third defender/),
      );
    },
  },
  {
    id: 'colle-system',
    says: 'Nc6 is the SECOND attacker of d4, and the idea says so',
    check: (o) => {
      const board = fromSan(o.line.slice(0, 10));
      const attackers = attackersOf(board, 'd4', BLACK);
      if (!eq(attackers, ['Nc6', 'c5'])) return `d4 attacked by ${attackers.join(' ')}`;
      return all(says(o.ideas[9], new RegExp(`${ORDINAL[attackers.length]} attacker`)), doesNotSay(o.ideas[9], /third attacker/));
    },
  },
  {
    id: 'london-system',
    says: 'Nc6 is the SECOND attacker of d4 against three defenders, and the idea says so',
    check: (o) => {
      const board = fromSan(o.line.slice(0, 14));
      const attackers = attackersOf(board, 'd4', BLACK);
      const defenders = attackersOf(board, 'd4', WHITE);
      if (!eq(attackers, ['Nc6', 'c5'])) return `d4 attacked by ${attackers.join(' ')}`;
      if (defenders.length !== 3) return `d4 defended by ${defenders.join(' ')}`;
      return all(
        says(o.ideas[13], new RegExp(`${ORDINAL[attackers.length]} attacker`)),
        says(o.ideas[13], new RegExp(`${CARDINAL[attackers.length]} attackers, ${CARDINAL[defenders.length]} defenders`)),
        doesNotSay(o.ideas[13], /third attacker/),
      );
    },
  },
  {
    id: 'scandinavian-nc3',
    says: 'at Bc4 the count is three white pieces out, one black piece out, a queen that has moved twice - and the sentence gives those three numbers',
    check: (o) => {
      const board = fromSan(o.line.slice(0, 11));
      const white = minorsOut(board, WHITE), black = minorsOut(board, BLACK);
      const moved = queenMoves(o.line.slice(0, 11), 'black');
      if (white !== 3 || black !== 1 || moved !== 2) return `white has ${white} out, black ${black}, queen moved ${moved} times`;
      return all(
        says(o.ideas[10], new RegExp(`${CARDINAL[white]} pieces out`)),
        says(o.ideas[10], new RegExp(`${CARDINAL[black]} piece out`)),
        says(o.ideas[10], /moved twice/),
        doesNotSay(o.ideas[10], /four pieces|three times/),
      );
    },
  },
  {
    id: 'queens-gambit-declined',
    says: 'after Nf3 the bishop on f1 is still at home, so it is not the last minor piece - and the idea names what is still home',
    check: (o) => {
      const board = fromSan(o.line.slice(0, 11));
      if (!eq(minorsAtHome(board, WHITE), ['f1'])) return `white still has ${minorsAtHome(board, WHITE).join(' ') || 'nothing'} at home`;
      if (!eq(minorsAtHome(board, BLACK), ['b8', 'c8'])) return `black still has ${minorsAtHome(board, BLACK).join(' ') || 'nothing'} at home`;
      return all(says(o.ideas[10], /bishop on f1/), says(o.ideas[10], /knight on b8/), says(o.ideas[10], /bishop on c8/), doesNotSay(o.ideas[10], /last minor piece/));
    },
  },
  {
    id: 'ruy-lopez-d3',
    says: 'after ...Be7 the bishop on c8 is still at home, so it is not the last minor piece - and the idea says so',
    check: (o) => {
      const board = fromSan(o.line.slice(0, 12));
      if (!eq(minorsAtHome(board, BLACK), ['c8'])) return `black still has ${minorsAtHome(board, BLACK).join(' ') || 'nothing'} at home`;
      return all(says(o.ideas[11], /bishop on c8 is still at home/), doesNotSay(o.ideas[11], /last minor piece/));
    },
  },
  {
    id: 'scandinavian-qd6',
    says: 'after ...Be7 the knight on b8 and the bishop on c8 are still at home, so it is not the last minor piece - and the idea names both',
    check: (o) => {
      const board = fromSan(o.line.slice(0, 14));
      if (!eq(minorsAtHome(board, BLACK), ['b8', 'c8'])) return `black still has ${minorsAtHome(board, BLACK).join(' ') || 'nothing'} at home`;
      return all(says(o.ideas[13], /knight on b8/), says(o.ideas[13], /bishop on c8/), doesNotSay(o.ideas[13], /last minor piece/));
    },
  },
  {
    id: 'slav-defence',
    says: 'd5 is held by ONE pawn and two pieces after ...Nf6, the same three named again after Nc3, and the b8 knight has TWO squares before Nbd7',
    check: (o) => {
      const after6 = fromSan(o.line.slice(0, 6));
      const held = attackersOf(after6, 'd5', BLACK);
      if (!eq(held, ['Nf6', 'Qd8', 'c6'])) return `after Nf6 d5 is held by ${held.join(' ')}`;
      const after9 = fromSan(o.line.slice(0, 9));
      if (!eq(attackersOf(after9, 'd5', BLACK), held)) return 'the two screens count different defenders';
      const before14 = fromSan(o.line.slice(0, 13));
      const squares = movesOf(before14, 'b8');
      if (!eq(squares, ['a6', 'd7'])) return `the b8 knight can go to ${squares.join(' ')}`;
      return all(
        says(o.ideas[5], new RegExp(`${CARDINAL[held.length]} defenders`)),
        says(o.ideas[5], /pawn on c6/),
        doesNotSay(o.ideas[5], /two pawns/),
        says(o.ideas[8], new RegExp(`${CARDINAL[held.length]} times`)),
        says(o.ideas[13], new RegExp(`${CARDINAL[squares.length]} squares`)),
        says(o.ideas[13], /a6/), says(o.ideas[13], /d7/),
        doesNotSay(o.ideas[13], /exactly one square/),
      );
    },
  },
  {
    id: 'french-exchange',
    says: 'the first screen states no count of the repertoire at all',
    check: (o) => doesNotSay(o.ideas[0], /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/),
  },

  // ── the other numeric claims the sweep turned up ───────────────────────

  {
    id: 'italian-game',
    says: 'e4 takes d5 and f5 from black knights, f7 is defended by the king alone after Bc4, and Ng5 makes it attacked twice',
    check: () => {
      const one = fromSan(['e4']);
      if (!attackersOf(one, 'd5', WHITE).includes('e4') || !attackersOf(one, 'f5', WHITE).includes('e4')) return 'e4 does not cover d5 and f5';
      const bc4 = fromSan(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']);
      if (!eq(attackersOf(bc4, 'f7', BLACK), ['Ke8'])) return `f7 defended by ${attackersOf(bc4, 'f7', BLACK).join(' ')}`;
      const ng5 = fromSan(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5']);
      return eq(attackersOf(ng5, 'f7', WHITE), ['Bc4', 'Ng5']) || `after Ng5 f7 is attacked by ${attackersOf(ng5, 'f7', WHITE).join(' ')}`;
    },
  },
  {
    id: 'italian-game',
    says: 'Nc6 is not the ONLY developing move that defends e5 (Bd6 and three queen moves do too), and the finished position has three black minors out to two white, with b1 and c1 still at home',
    check: (o) => {
      const board = fromSan(['e4', 'e5', 'Nf3']);
      const alsoDefend = board.legalMoves().map((m) => toSan(board, m)).filter((s) => /^[NBQ]/.test(s) && s !== 'Nc6')
        .filter((s) => { const c = new Board(board.fen()); fromSan([s], c); return attackersOf(c, 'e5', BLACK).length > 0; });
      if (alsoDefend.length === 0) return 'Nc6 really is the only piece move defending e5';
      if (/only reply/.test(o.ideas[3])) return 'the idea still calls Nc6 the only reply';
      const end = fromSan(o.line);
      if (!eq(minorsAtHome(end, WHITE), ['b1', 'c1']) || !eq(minorsAtHome(end, BLACK), ['c8'])) return `at home: white ${minorsAtHome(end, WHITE)}, black ${minorsAtHome(end, BLACK)}`;
      return all(says(o.ideas[11], /three minor pieces out to your two/), says(o.ideas[11], /knight on b1/), says(o.ideas[10], /king and the rook/));
    },
  },
  {
    id: 'italian-game',
    says: 'after castling f2 is held by the king and the rook',
    check: (o) => eq(attackersOf(fromSan(o.line.slice(0, 11)), 'f2', WHITE), ['Kg1', 'Rf1']) || 'f2 is not held by king and rook after O-O',
  },
  {
    id: 'caro-kann-exchange',
    says: 'd4 and e4 together cover c5, d5, e5 and f5; b2 is defended by the c1 bishop until Bf4, and by nothing after; after Qb3, b7 is defended by nothing',
    check: (o) => {
      const two = fromSan(o.line.slice(0, 3));
      for (const sq of ['c5', 'd5', 'e5', 'f5']) if (!attackersOf(two, sq, WHITE).some((a) => a === 'd4' || a === 'e4')) return `${sq} is not covered by a pawn`;
      if (!eq(attackersOf(fromSan(o.line.slice(0, 10)), 'b2', WHITE), ['Bc1'])) return 'b2 is not held by Bc1 before Bf4';
      if (attackersOf(fromSan(o.line.slice(0, 11)), 'b2', WHITE).length) return 'b2 is still defended after Bf4';
      const qb3 = fromSan(o.line.slice(0, 13));
      if (attackersOf(qb3, 'b7', BLACK).length) return `b7 defended by ${attackersOf(qb3, 'b7', BLACK).join(' ')}`;
      if (!attackersOf(qb3, 'd5', WHITE).includes('Qb3')) return 'Qb3 does not lean on d5';
      const qd7 = fromSan(o.line.slice(0, 14));
      return (attackersOf(qd7, 'b7', BLACK).includes('Qd7') && attackersOf(qd7, 'd5', BLACK).includes('Qd7')) || 'Qd7 does not cover both b7 and d5';
    },
  },
  {
    id: 'scandinavian-nc3',
    says: 'after d4 Black has made two queen moves and one pawn move; after ...e6 every white minor piece is out and Black has two at home',
    check: (o) => {
      const seven = o.line.slice(0, 7).filter((m, i) => i % 2 === 1);
      if (seven.filter((m) => m.startsWith('Q')).length !== 2 || seven.length !== 3) return `black's moves were ${seven.join(' ')}`;
      const end = fromSan(o.line);
      if (minorsAtHome(end, WHITE).length) return `white still has ${minorsAtHome(end, WHITE).join(' ')} at home`;
      return minorsAtHome(end, BLACK).length === 2 || `black has ${minorsAtHome(end, BLACK).join(' ')} at home`;
    },
  },
  {
    id: 'sicilian-alapin',
    says: 'after ...Nc6 d4 is attacked by c5, Nc6 and Qd5 and held by c3, Nf3 and Qd1',
    check: (o) => {
      const board = fromSan(o.line.slice(0, 12));
      if (!eq(attackersOf(board, 'd4', BLACK), ['Nc6', 'Qd5', 'c5'])) return `d4 attacked by ${attackersOf(board, 'd4', BLACK).join(' ')}`;
      return eq(attackersOf(board, 'd4', WHITE), ['Nf3', 'Qd1', 'c3']) || `d4 held by ${attackersOf(board, 'd4', WHITE).join(' ')}`;
    },
  },
  {
    id: 'caro-kann-classical',
    says: 'after h4 ...h6 the bishop can retreat to h7 once h5 comes',
    check: (o) => {
      const board = fromSan([...o.line.slice(0, 12), 'h5']);
      return movesOf(board, 'g6').includes('h7') || `after h5 the bishop can go to ${movesOf(board, 'g6').join(' ') || 'nowhere'}`;
    },
  },
  {
    id: 'london-system',
    says: 'in the Englund the black queen has moved THREE times by ...Qxb2, and the trap says three, not four',
    check: (o) => {
      const moved = queenMoves(['d4', 'e5', 'dxe5', 'Nc6', 'Nf3', 'Qe7', 'Bf4', 'Qb4+', 'Bd2', 'Qxb2'], 'black');
      if (moved !== 3) return `the queen moved ${moved} times`;
      return all(says(o.traps[0].answer, /spent three moves/), doesNotSay(o.traps[0].answer, /four moves/));
    },
  },
  {
    id: 'colle-system',
    says: 'London and Colle share their first two moves for each side, and after ...Bd6 each side has exactly one minor piece at home (c1 and c8)',
    check: (o, byId) => {
      if (!eq(o.line.slice(0, 4), byId['london-system'].line.slice(0, 4))) return 'the first four plies differ from the London';
      const board = fromSan(o.line.slice(0, 12));
      return (eq(minorsAtHome(board, WHITE), ['c1']) && eq(minorsAtHome(board, BLACK), ['c8'])) || `at home: white ${minorsAtHome(board, WHITE)}, black ${minorsAtHome(board, BLACK)}`;
    },
  },
  {
    id: 'kings-indian-attack',
    says: 'after Nf3 there are exactly SIX more white moves in the line, the trap lists exactly those six, castling is move four and e4 is move seven, and ...Nc6 leaves only the c8 bishop at home',
    check: (o) => {
      const white = o.line.filter((m, i) => i % 2 === 0);
      const rest = white.slice(1);
      if (rest.length !== 6) return `${rest.length} white moves follow Nf3`;
      for (const m of rest) if (!o.traps[0].answer.includes(m)) return `the trap does not list ${m}`;
      if (o.line[6] !== 'O-O' || o.line[12] !== 'e4') return 'castling is not move four or e4 is not move seven';
      if (!eq(minorsAtHome(fromSan(o.line), BLACK), ['c8'])) return 'more than the c8 bishop is at home';
      return all(says(o.ideas[0], /six moves that follow/), says(o.traps[0].answer, /same six moves/), doesNotSay(o.traps[0].answer, /seven moves/), says(o.ideas[6], /move four/), says(o.ideas[1], /move seven/));
    },
  },
  {
    id: 'scotch-game',
    says: 'after ...d6 each side has one bishop at home, so "every piece out" is not said',
    check: (o) => {
      const board = fromSan(o.line);
      if (!eq(minorsAtHome(board, WHITE), ['c1']) || !eq(minorsAtHome(board, BLACK), ['c8'])) return `at home: white ${minorsAtHome(board, WHITE)}, black ${minorsAtHome(board, BLACK)}`;
      return all(says(o.ideas[13], /three minor pieces out/), doesNotSay(o.ideas[13], /every piece out/));
    },
  },
  {
    id: 'vienna-game',
    says: 'after 2.Nc3 e4 is defended once, by the knight - not "a second time"',
    check: (o) => {
      const board = fromSan(o.line.slice(0, 3));
      if (!eq(attackersOf(board, 'e4', WHITE), ['Nc3'])) return `e4 defended by ${attackersOf(board, 'e4', WHITE).join(' ')}`;
      return doesNotSay(o.ideas[2], /second time/);
    },
  },
  {
    id: 'vienna-game',
    says: 'the castling-defends-f2 count appears in exactly the Italian, the Scotch and the Vienna, which is what the trap now names',
    check: (o, byId) => {
      const prose = (x) => [...x.ideas, ...x.traps.map((t) => t.answer)].join(' ');
      const have = Object.values(byId).filter((x) => x.side === 'white' && x.line[1] === 'e5' && /f2/.test(prose(x))).map((x) => x.id).sort();
      if (!eq(have, ['italian-game', 'scotch-game', 'vienna-game'])) return `f2 is discussed in ${have.join(' ')}`;
      return all(says(o.traps[1].answer, /the Italian, the Scotch and here/), doesNotSay(o.traps[1].answer, /four different openings/));
    },
  },
  {
    id: 'ruy-lopez-d3',
    says: 'Ba4 has b3 and a losing b5 as its only squares, no black pawn can hit b3 next move, castling is move seven, and the first four plies match the Italian and the Scotch',
    check: (o, byId) => {
      const before = fromSan(o.line.slice(0, 10));
      if (!eq(movesOf(before, 'a4'), ['b3', 'b5'])) return `the a4 bishop can go to ${movesOf(before, 'a4').join(' ')}`;
      if (!attackersOf(before, 'b5', BLACK).includes('a6')) return 'b5 is not covered by the a6 pawn';
      const after = fromSan(o.line.slice(0, 11));
      const pawnHits = after.legalMoves().filter((m) => typeOf(after.squares[moveFrom(m)]) === PAWN).map((m) => toSan(after, m))
        .filter((san) => { const c = new Board(after.fen()); fromSan([san], c); return attackersOf(c, 'b3', BLACK).some((a) => /^[a-h][1-8]$/.test(a)); });
      if (pawnHits.length) return `${pawnHits.join(' ')} would hit b3 next move`;
      if (o.line[12] !== 'O-O') return 'castling is not move seven';
      for (const id of ['italian-game', 'scotch-game']) if (!eq(byId[id].line.slice(0, 4), o.line.slice(0, 4))) return `first four plies differ from ${id}`;
      return all(says(o.ideas[10], /only safe square/), says(o.ideas[12], /move seven/), doesNotSay(o.ideas[10], /no pawn left/), doesNotSay(o.ideas[1], /last answer/));
    },
  },
  {
    id: 'slav-defence',
    says: 'the bishop reaches f5 on Black\'s fourth move, and after Nc3 both white knights are out',
    check: (o) => {
      if (o.line[7] !== 'Bf5') return `ply 8 is ${o.line[7]}`;
      const board = fromSan(o.line.slice(0, 9));
      return eq(minorsAtHome(board, WHITE), ['c1', 'f1']) || `white has ${minorsAtHome(board, WHITE).join(' ')} at home`;
    },
  },
  {
    id: 'french-rubinstein',
    says: 'after Nf3 both white knights are out, and at ...c5 d4 is the only white pawn in the centre',
    check: (o) => {
      if (!eq(minorsAtHome(fromSan(o.line.slice(0, 9)), WHITE), ['c1', 'f1'])) return 'a white knight is still at home after Nf3';
      const end = fromSan(o.line);
      const centre = ['d4', 'e4', 'd5', 'e5'].filter((sq) => { const p = end.squares[nameToSquare(sq)]; return p && typeOf(p) === PAWN && colourOf(p) === WHITE; });
      return eq(centre, ['d4']) || `white centre pawns: ${centre.join(' ')}`;
    },
  },
  {
    id: 'kings-indian-defence',
    says: 'after Nf3 both white knights are out, and ...Nc6 is the last KNIGHT (the c8 bishop is home), which is what the idea now says',
    check: (o) => {
      if (!eq(minorsAtHome(fromSan(o.line.slice(0, 9)), WHITE), ['c1', 'f1'])) return 'a white knight is still at home after Nf3';
      if (!eq(minorsAtHome(fromSan(o.line), BLACK), ['c8'])) return `black has ${minorsAtHome(fromSan(o.line), BLACK).join(' ')} at home`;
      return all(says(o.ideas[13], /last knight out/), doesNotSay(o.ideas[13], /last piece out/));
    },
  },
  {
    id: 'kings-indian-defence',
    says: 'every other black answer to 1.d4 in this file starts with a pawn move',
    check: (o, byId) => {
      const others = Object.values(byId).filter((x) => x.side === 'black' && x.line[0] === 'd4' && x.id !== o.id);
      const bad = others.filter((x) => !/^[a-h]/.test(x.line[1]));
      return bad.length === 0 || `${bad.map((x) => x.id).join(' ')} do not start with a pawn move`;
    },
  },
  {
    id: 'english-four-knights',
    says: 'the ...d5 break is Black\'s fourth move',
    check: (o) => o.line[7] === 'd5' || `ply 8 is ${o.line[7]}`,
  },
  {
    id: 'scotch-game',
    says: 'the Scotch no longer counts the 1...e5 openings, because the count changed when the Petrov entry was added',
    check: (o, byId) => {
      const e5 = Object.values(byId).filter((x) => x.side === 'white' && x.line[0] === 'e4' && x.line[1] === 'e5');
      if (e5.length === 3) return 'there are only three 1...e5 openings, so the old sentence would have been true';
      return doesNotSay(o.ideas[0], /three new answers/);
    },
  },

  // ── the six openings added later ─────────────────────────────────────

  {
    id: 'scholars-mate-defence',
    says: 'Qh5 hits an undefended e5; after ...Nc6 f7 is one v one; after Bc4 it is two v one and Qxf7 would be mate; ...g6 attacks the queen; after Qf3 two v one again; ...Nf6 leaves f7 attacked once and e4 attacked once with only the queen holding it; the queen has moved twice by Ne2; after ...O-O f7 is held by king and rook',
    check: (o) => {
      const q = fromSan(o.line.slice(0, 3));
      if (!eq(attackersOf(q, 'e5', WHITE), ['Qh5']) || attackersOf(q, 'e5', BLACK).length) return 'e5 is not attacked-once-undefended after Qh5';
      const n = fromSan(o.line.slice(0, 4));
      if (!eq(attackersOf(n, 'f7', WHITE), ['Qh5']) || !eq(attackersOf(n, 'f7', BLACK), ['Ke8'])) return 'f7 is not one v one after Nc6';
      const b = fromSan(o.line.slice(0, 5));
      if (!eq(attackersOf(b, 'f7', WHITE), ['Bc4', 'Qh5']) || !eq(attackersOf(b, 'f7', BLACK), ['Ke8'])) return 'f7 is not two v one after Bc4';
      if (fromSan(['a6', 'Qxf7#'], new Board(b.fen())).outcome() !== 'checkmate') return 'Qxf7 would not be mate';
      if (!attackersOf(fromSan(o.line.slice(0, 6)), 'h5', BLACK).includes('g6')) return 'g6 does not attack the queen';
      const f = fromSan(o.line.slice(0, 7));
      if (!eq(attackersOf(f, 'f7', WHITE), ['Bc4', 'Qf3'])) return 'f7 is not attacked twice after Qf3';
      const k = fromSan(o.line.slice(0, 8));
      if (!eq(attackersOf(k, 'f7', WHITE), ['Bc4']) || !eq(attackersOf(k, 'e4', BLACK), ['Nf6']) || !eq(attackersOf(k, 'e4', WHITE), ['Qf3'])) return 'after Nf6 the counts on f7 and e4 are wrong';
      if (queenMoves(o.line.slice(0, 9), 'white') !== 2) return 'the queen has not moved exactly twice by Ne2';
      const c = fromSan(o.line.slice(0, 12));
      if (!eq(attackersOf(c, 'f7', WHITE), ['Bc4']) || !eq(attackersOf(c, 'f7', BLACK), ['Kg8', 'Rf8'])) return 'f7 is not one v two after castling';
      return all(says(o.ideas[4], /attacked twice, defended once/), says(o.ideas[7], /defended only by the queen/), says(o.ideas[8], /moved twice/), says(o.ideas[11], /attacked once, by the bishop, and defended twice/));
    },
  },
  {
    id: 'scholars-mate-defence',
    says: 'the traps: 2...g6?? Qxe5+ is check and hits h8; 2...Nf6?? Qxe5+ is check and a pawn; 4...Nd4?? Qxf7 is mate',
    check: () => {
      const g6 = fromSan(['e4', 'e5', 'Qh5', 'g6', 'Qxe5+']);
      if (!g6.inCheck() || !attackersOf(g6, 'h8', WHITE).includes('Qe5')) return 'after 2...g6 Qxe5+ is not check-and-h8';
      const nf6 = fromSan(['e4', 'e5', 'Qh5', 'Nf6', 'Qxe5+']);
      if (!nf6.inCheck() || material(nf6, WHITE) - material(nf6, BLACK) !== 1) return 'after 2...Nf6 Qxe5+ is not check-and-a-pawn';
      return fromSan(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'g6', 'Qf3', 'Nd4', 'Qxf7#']).outcome() === 'checkmate' || '4...Nd4 Qxf7 is not mate';
    },
  },
  {
    id: 'scholars-mate-defence',
    says: 'Bishop-first branch: two v one on f7 after Qh5 and three black minors out to two at the end; Qb3 branch: the queen has moved three times, b7 is held by Bc8 alone, ...Nd4 hits b3 and c2 (still after Bxf7+ Ke7), Qc3 is her fourth move and defends c2, Qxf3 her fifth; Qxe5+ branch: e5 is held by Nc6, ...Nxe5 is a queen for a pawn, and the knight attacks c4',
    check: (o) => {
      const bf = varBoard(o, 'Bishop first', 4);
      if (!eq(attackersOf(bf, 'f7', WHITE), ['Bc4', 'Qh5']) || !eq(attackersOf(bf, 'f7', BLACK), ['Ke8'])) return 'bishop-first: f7 is not two v one';
      const bfEnd = varBoard(o, 'Bishop first', 11);
      if (minorsOut(bfEnd, BLACK) !== 3 || minorsOut(bfEnd, WHITE) !== 2) return `bishop-first: ${minorsOut(bfEnd, BLACK)} v ${minorsOut(bfEnd, WHITE)} minors out`;
      const v = variation(o, '5.Qb3');
      if (queenMoves(v.line.slice(0, 9), 'white') !== 3) return 'the queen has not moved three times by Qb3';
      const qb3 = varBoard(o, '5.Qb3', 8);
      if (!eq(attackersOf(qb3, 'b7', BLACK), ['Bc8']) || !eq(attackersOf(qb3, 'b7', WHITE), ['Qb3'])) return 'b7 is not Qb3 v Bc8';
      const nd4 = varBoard(o, '5.Qb3', 9);
      if (!attackersOf(nd4, 'b3', BLACK).includes('Nd4') || !attackersOf(nd4, 'c2', BLACK).includes('Nd4')) return 'Nd4 does not hit b3 and c2';
      const ke7 = fromSan(['Bxf7+', 'Ke7'], new Board(nd4.fen()));
      if (!attackersOf(ke7, 'b3', BLACK).includes('Nd4') || !attackersOf(ke7, 'c2', BLACK).includes('Nd4')) return 'after Bxf7+ Ke7 the knight no longer hits b3 and c2';
      if (queenMoves(v.line.slice(0, 11), 'white') !== 4 || !attackersOf(varBoard(o, '5.Qb3', 10), 'c2', WHITE).includes('Qc3')) return 'Qc3 is not the fourth queen move defending c2';
      if (queenMoves(v.line.slice(0, 15), 'white') !== 5) return 'Qxf3 is not the fifth queen move';
      const qx = varBoard(o, '4.Qxe5+', 6);
      if (!qx.inCheck() || !eq(attackersOf(qx, 'e5', BLACK), ['Nc6'])) return 'Qxe5+ is not check into a knight';
      const took = varBoard(o, '4.Qxe5+', 7);
      if (material(took, BLACK) - material(took, WHITE) !== 8) return 'Nxe5 is not a queen for a pawn';
      return attackersOf(took, 'c4', BLACK).includes('Ne5') || 'the knight does not attack c4';
    },
  },
  {
    id: 'pirc-150-attack',
    says: 'after ...Bg7 d4 is held by Be3 and the queen; f3 makes e4 held by knight and pawn and covers g4; ...Ng4 hits an e3 held by queen and f-pawn; in the Ng4 branch ...Nc6 makes d4 two v one and Nge2 two v two; in the ...e5 branch d4 is one v one',
    check: (o) => {
      if (!eq(attackersOf(fromSan(o.line.slice(0, 8)), 'd4', WHITE), ['Be3', 'Qd1'])) return 'd4 is not held by Be3 and Qd1 after Bg7';
      const f3 = fromSan(o.line.slice(0, 11));
      if (!eq(attackersOf(f3, 'e4', WHITE), ['Nc3', 'f3']) || !attackersOf(f3, 'g4', WHITE).includes('f3')) return 'f3 does not hold e4 and cover g4 as described';
      const ng4 = varBoard(o, '5...Ng4', 9);
      if (!eq(attackersOf(ng4, 'e3', BLACK), ['Ng4']) || !eq(attackersOf(ng4, 'e3', WHITE), ['Qd2', 'f2'])) return `e3 after Ng4: ${attackersOf(ng4, 'e3', BLACK)} v ${attackersOf(ng4, 'e3', WHITE)}`;
      const nc6 = varBoard(o, '5...Ng4', 15);
      if (attackersOf(nc6, 'd4', BLACK).length !== 2 || !eq(attackersOf(nc6, 'd4', WHITE), ['Qd2'])) return `d4 after Nc6: ${attackersOf(nc6, 'd4', BLACK)} v ${attackersOf(nc6, 'd4', WHITE)}`;
      if (attackersOf(varBoard(o, '5...Ng4', 16), 'd4', WHITE).length !== 2) return 'Nge2 does not make d4 two v two';
      const e5 = varBoard(o, '3...e5', 5);
      return (eq(attackersOf(e5, 'd4', BLACK), ['e5']) && eq(attackersOf(e5, 'd4', WHITE), ['Qd1'])) || `d4 after e5: ${attackersOf(e5, 'd4', BLACK)} v ${attackersOf(e5, 'd4', WHITE)}`;
    },
  },
  {
    id: 'queens-gambit-accepted',
    says: 'after ...dxc4 the pawn is held by nothing, e3 attacks it with the f1 bishop, Bxc4 levels material, ...c5 makes d4 two v three; the b5 branch: a4 hits an undefended b5, Qf3 hits a8, the c6 knight is undefended, Qc5 is a knight for a pawn, and Qxc4 or Qxb5 would each lose the queen; the e5 branch leaves no white pawn on the c- or e-file; the pin branch ends castled',
    check: (o) => {
      if (attackersOf(fromSan(o.line.slice(0, 4)), 'c4', BLACK).length) return 'c4 is defended after dxc4';
      if (!eq(attackersOf(fromSan(o.line.slice(0, 5)), 'c4', WHITE), ['Bf1'])) return 'e3 does not open the bishop onto c4';
      const bx = fromSan(o.line.slice(0, 7));
      if (material(bx, WHITE) !== material(bx, BLACK)) return 'material is not level after Bxc4';
      const c5 = fromSan(o.line.slice(0, 10));
      if (attackersOf(c5, 'd4', BLACK).length !== 2 || attackersOf(c5, 'd4', WHITE).length !== 3) return `d4 after c5: ${attackersOf(c5, 'd4', BLACK)} v ${attackersOf(c5, 'd4', WHITE)}`;
      if (!eq(attackersOf(fromSan(o.line), 'c4', BLACK), ['b5'])) return '...b5 does not hit the bishop';
      const a4 = varBoard(o, '3...b5', 6);
      if (!eq(attackersOf(a4, 'b5', WHITE), ['a4']) || attackersOf(a4, 'b5', BLACK).length) return 'b5 is not attacked-once-undefended after a4';
      const qf3 = varBoard(o, '3...b5', 10);
      if (!attackersOf(qf3, 'a8', WHITE).includes('Qf3')) return 'Qf3 does not attack a8';
      const nc6 = varBoard(o, '3...b5', 11);
      if (attackersOf(nc6, 'c6', BLACK).length) return `the c6 knight is defended by ${attackersOf(nc6, 'c6', BLACK)}`;
      const bd7 = varBoard(o, '3...b5', 13);
      if (!attackersOf(fromSan(['Qxc4'], new Board(bd7.fen())), 'c4', BLACK).includes('b5')) return 'Qxc4 would be safe';
      if (!attackersOf(fromSan(['Qxb5'], new Board(bd7.fen())), 'b5', BLACK).includes('Bd7')) return 'Qxb5 would be safe';
      const end = varBoard(o, '3...b5', 14);
      if (material(end, WHITE) - material(end, BLACK) !== 2 || attackersOf(end, 'c5', BLACK).length) return 'Qc5 is not a safe knight-for-a-pawn';
      const ex = varBoard(o, '3...e5', 8);
      const cePawns = ['c2', 'c3', 'c4', 'e2', 'e3', 'e4'].filter((sq) => { const p = ex.squares[nameToSquare(sq)]; return p && typeOf(p) === PAWN && colourOf(p) === WHITE; });
      if (cePawns.length) return `white still has pawns on ${cePawns.join(' ')}`;
      if (material(varBoard(o, '3...e5', 6), WHITE) !== material(varBoard(o, '3...e5', 6), BLACK)) return 'material is not level after Bxc4 in the e5 branch';
      return variation(o, '4...Bg4').line.at(-1) === 'O-O' || 'the pin branch does not end with castling';
    },
  },
  {
    id: 'petrov-as-white',
    says: 'after ...Nf6 both e-pawns are attacked once and undefended; Nxf7 Kxf7 is a knight for two pawns; ...Nxe4 levels material; after ...d5 the knight is held by the pawn and attacked by nothing, then by Bd3 alone',
    check: (o) => {
      const p = fromSan(o.line.slice(0, 4));
      if (!eq(attackersOf(p, 'e4', BLACK), ['Nf6']) || attackersOf(p, 'e4', WHITE).length || !eq(attackersOf(p, 'e5', WHITE), ['Nf3']) || attackersOf(p, 'e5', BLACK).length) return 'the two e-pawns are not each attacked-once-undefended';
      const nxf7 = fromSan([...o.line.slice(0, 6), 'Nxf7', 'Kxf7']);
      if (material(nxf7, WHITE) - material(nxf7, BLACK) !== -1) return 'Nxf7 Kxf7 is not a knight for two pawns';
      const lvl = fromSan(o.line.slice(0, 8));
      if (material(lvl, WHITE) !== material(lvl, BLACK)) return 'material is not level after ...Nxe4';
      const d5 = fromSan(o.line.slice(0, 10));
      if (attackersOf(d5, 'e4', WHITE).length || !eq(attackersOf(d5, 'e4', BLACK), ['d5'])) return 'after ...d5 the knight is not held-by-pawn-and-unattacked';
      return eq(attackersOf(fromSan(o.line.slice(0, 11)), 'e4', WHITE), ['Bd3']) || 'Bd3 is not the only attacker of e4';
    },
  },
  {
    id: 'petrov-as-white',
    says: '3...Nxe4 branch: Qe2 hits an undefended knight, ...Nf6 Nc6+ is a discovered check that wins the queen (six points), after ...d6 the e5 knight is two v one, d4 makes it two v two, dxe5 is a pawn up, and Bf4 defends e5 twice against two; 3...Qe7 branch: the e5 knight is attacked and undefended, d4 defends it, ...Qxe4+ is check and levels material, d4 is held by knight and queen after ...Nc6, and Nc3 attacks the queen; 5...Be7 branch: Bd3 attacks an undefended knight and Black has made three knight moves by ...Nf6',
    check: (o) => {
      const qe2 = varBoard(o, '3...Nxe4', 6);
      if (!eq(attackersOf(qe2, 'e4', WHITE), ['Qe2']) || attackersOf(qe2, 'e4', BLACK).length) return 'Qe2 does not hit an undefended knight';
      const disc = fromSan(['Nf6', 'Nc6+'], new Board(qe2.fen()));
      if (!disc.inCheck() || !attackersOf(disc, 'd8', WHITE).includes('Nc6')) return 'Nc6+ is not a discovered check hitting d8';
      const won = fromSan(['Be7', 'Nxd8', 'Kxd8'], disc);
      if (material(won, WHITE) - material(won, BLACK) !== 6) return `after Nxd8 Kxd8 white is ${material(won, WHITE) - material(won, BLACK)} up, not six`;
      const d6 = varBoard(o, '3...Nxe4', 9);
      if (attackersOf(d6, 'e5', BLACK).length !== 2 || !eq(attackersOf(d6, 'e5', WHITE), ['Qe4'])) return 'after ...d6 the e5 knight is not two v one';
      if (attackersOf(varBoard(o, '3...Nxe4', 10), 'e5', WHITE).length !== 2) return 'd4 does not make e5 two v two';
      const dx = varBoard(o, '3...Nxe4', 12);
      if (material(dx, WHITE) - material(dx, BLACK) !== 1) return 'dxe5 is not a pawn up';
      const bf4 = varBoard(o, '3...Nxe4', 14);
      if (attackersOf(bf4, 'e5', WHITE).length !== 2 || attackersOf(bf4, 'e5', BLACK).length !== 2) return `e5 after Bf4: ${attackersOf(bf4, 'e5', BLACK)} v ${attackersOf(bf4, 'e5', WHITE)}`;
      const qe7 = varBoard(o, '3...Qe7', 5);
      if (!eq(attackersOf(qe7, 'e5', BLACK), ['Qe7']) || attackersOf(qe7, 'e5', WHITE).length) return 'after ...Qe7 the knight is not attacked-and-undefended';
      if (!eq(attackersOf(varBoard(o, '3...Qe7', 6), 'e5', WHITE), ['d4'])) return 'd4 does not defend the knight';
      const qx = varBoard(o, '3...Qe7', 9);
      if (!qx.inCheck() || material(qx, WHITE) !== material(qx, BLACK)) return '...Qxe4+ is not check-and-level';
      if (!eq(attackersOf(varBoard(o, '3...Qe7', 11), 'd4', WHITE), ['Nf3', 'Qd1'])) return 'd4 is not held by knight and queen after ...Nc6';
      if (!attackersOf(varBoard(o, '3...Qe7', 14), 'e4', WHITE).includes('Nc3')) return 'Nc3 does not attack the queen';
      const bd3 = varBoard(o, '5...Be7', 10);
      if (!eq(attackersOf(bd3, 'e4', WHITE), ['Bd3']) || attackersOf(bd3, 'e4', BLACK).length) return 'Bd3 does not hit an undefended knight';
      const knightMoves = variation(o, '5...Be7').line.slice(0, 12).filter((m, i) => i % 2 === 1 && m.startsWith('N')).length;
      return knightMoves === 3 || `Black has made ${knightMoves} knight moves, not three`;
    },
  },
  {
    id: 'london-vs-kid',
    says: 'Bf4 and d4 both cover e5; d4 is held by e3 and queen after e3 and by three after Nf3; after h3 the bishop can retreat to h2; the ...e5 trap: dxe5 dxe5 hits f4 and Bh2 is legal; ...c5 branch: Qb6 hits an undefended b2, after Qxb2 Nb5 c7 is two v none and Nc7+ forks king and a8, exd4 leaves d4 held by the queen; ...Nh5 branch: Be5 hits h8 and after hxg3 the rook reaches h2 to h7; ...d5 branch: after c3 d4 is one v four',
    check: (o) => {
      if (!eq(attackersOf(fromSan(o.line.slice(0, 3)), 'e5', WHITE), ['Bf4', 'd4'])) return 'Bf4 and d4 do not both cover e5';
      if (!eq(attackersOf(fromSan(o.line.slice(0, 5)), 'd4', WHITE), ['Qd1', 'e3'])) return 'd4 is not held by e3 and Qd1 after e3';
      if (attackersOf(fromSan(o.line.slice(0, 7)), 'd4', WHITE).length !== 3) return 'd4 is not held three times after Nf3';
      if (!movesOf(fromSan(o.line.slice(0, 12)), 'f4').includes('h2')) return 'the bishop cannot retreat to h2 after h3';
      const e5 = fromSan([...o.line.slice(0, 13), 'e5', 'dxe5', 'dxe5']);
      if (!attackersOf(e5, 'f4', BLACK).includes('e5') || !movesOf(e5, 'f4').includes('h2')) return 'the ...e5 trap is not as described';
      const qb6 = varBoard(o, '2...c5', 5);
      if (!eq(attackersOf(qb6, 'b2', BLACK), ['Qb6']) || attackersOf(qb6, 'b2', WHITE).length) return 'b2 is not attacked-once-undefended after Qb6';
      const nb5 = fromSan(['Nc3', 'Qxb2', 'Nb5'], new Board(qb6.fen()));
      if (attackersOf(nb5, 'c7', WHITE).length !== 2 || attackersOf(nb5, 'c7', BLACK).length) return `c7 after Nb5: ${attackersOf(nb5, 'c7', WHITE)} v ${attackersOf(nb5, 'c7', BLACK)}`;
      const fork = fromSan(['e6', 'Nc7+'], nb5);
      if (!fork.inCheck() || !attackersOf(fork, 'a8', WHITE).includes('Nc7')) return 'Nc7+ is not a fork of king and a8';
      if (!eq(attackersOf(varBoard(o, '2...c5', 8), 'd4', WHITE), ['Qd1'])) return 'after exd4 the pawn is not held by the queen alone';
      if (!attackersOf(varBoard(o, '3...Nh5', 6), 'h8', WHITE).includes('Be5')) return 'Be5 does not hit h8';
      const rook = movesOf(varBoard(o, '3...Nh5', 11), 'h1');
      if (!['h2', 'h3', 'h4', 'h5', 'h6', 'h7'].every((s) => rook.includes(s))) return `the rook reaches ${rook.join(' ')}`;
      const c3 = varBoard(o, '4...d5', 12);
      return (attackersOf(c3, 'd4', BLACK).length === 1 && attackersOf(c3, 'd4', WHITE).length === 4) || `d4 after c3: ${attackersOf(c3, 'd4', BLACK)} v ${attackersOf(c3, 'd4', WHITE)}`;
    },
  },
  {
    id: 'vs-london-as-black',
    says: 'after ...Nc6 d4 is two v two, after c3 three defenders; ...Qb6 hits an undefended b2; ...c4 attacks the queen with pawn and queen; after axb6 the a8 rook has an open file; Nd2 hits a c4 held by d5; the Nc3 trap: after Qxb2 Nb5 c7 is two v none; Qc2 branch: after Qxf5 Qxb2 the a1 rook is attacked and undefended; 6.Qc2 branch: Qc1 is the third queen move; Nd2 branch: after Qxb2 no white knight can reach b5 or c7, and the end is a pawn up',
    check: (o) => {
      const nc6 = fromSan(o.line.slice(0, 6));
      if (attackersOf(nc6, 'd4', BLACK).length !== 2 || attackersOf(nc6, 'd4', WHITE).length !== 2) return `d4 after Nc6: ${attackersOf(nc6, 'd4', BLACK)} v ${attackersOf(nc6, 'd4', WHITE)}`;
      if (attackersOf(fromSan(o.line.slice(0, 7)), 'd4', WHITE).length !== 3) return 'c3 is not the third defender';
      const qb6 = fromSan(o.line.slice(0, 8));
      if (!eq(attackersOf(qb6, 'b2', BLACK), ['Qb6']) || attackersOf(qb6, 'b2', WHITE).length) return 'b2 is not attacked-once-undefended after Qb6';
      if (!eq(attackersOf(fromSan(o.line.slice(0, 10)), 'b3', BLACK), ['Qb6', 'c4'])) return 'the queen on b3 is not hit by pawn and queen';
      const ax = fromSan([...o.line.slice(0, 12), 'Nd2']);
      if (!movesOf(ax, 'a8').includes('a2')) return 'the a8 rook does not see down to a2';
      if (!attackersOf(ax, 'c4', WHITE).includes('Nd2') || !eq(attackersOf(ax, 'c4', BLACK), ['d5'])) return 'Nd2 v d5 on c4 is not as described';
      const trap = fromSan(['d4', 'd5', 'Bf4', 'c5', 'e3', 'Nc6', 'Nf3', 'Qb6', 'Nc3', 'Qxb2', 'Nb5']);
      if (attackersOf(trap, 'c7', WHITE).length !== 2 || attackersOf(trap, 'c7', BLACK).length) return 'the Nc3 trap does not leave c7 two v none';
      const qx = fromSan(['Qxf5', 'Qxb2'], new Board(varBoard(o, '5.Qc2', 9).fen()));
      if (!eq(attackersOf(qx, 'a1', BLACK), ['Qb2']) || attackersOf(qx, 'a1', WHITE).length) return 'after Qxf5 Qxb2 the a1 rook is not attacked-and-undefended';
      if (queenMoves(variation(o, '6.Qc2').line.slice(0, 13), 'white') !== 3) return 'Qc1 is not the third queen move';
      const nd2 = varBoard(o, '5.Nd2', 9);
      const jumps = nd2.legalMoves().map((m) => toSan(nd2, m)).filter((s) => /^N.*(b5|c7)/.test(s));
      if (jumps.length) return `a knight can play ${jumps.join(' ')}`;
      const end = varBoard(o, '5.Nd2', 15);
      return material(end, BLACK) - material(end, WHITE) === 1 || 'the Nd2 branch does not end a pawn up';
    },
  },

  // ── claims made inside the variations ─────────────────────────────────

  {
    id: 'italian-game',
    says: 'Philidor: after 3.d4 e5 is attacked twice and defended once',
    check: (o) => {
      const b = varBoard(o, 'Philidor', 4);
      return (eq(attackersOf(b, 'e5', WHITE), ['Nf3', 'd4']) && eq(attackersOf(b, 'e5', BLACK), ['d6'])) || `e5: ${attackersOf(b, 'e5', WHITE)} v ${attackersOf(b, 'e5', BLACK)}`;
    },
  },
  {
    id: 'italian-game',
    says: 'Early queen: Bxf7+ is check, and Ng5+ is a check that also attacks the queen on e4, which nothing defends',
    check: (o) => {
      if (!varBoard(o, 'Early queen', 8).inCheck()) return 'Bxf7+ is not check';
      const b = varBoard(o, 'Early queen', 10);
      if (!b.inCheck()) return 'Ng5+ is not check';
      if (!attackersOf(b, 'e4', WHITE).includes('Ng5')) return 'Ng5 does not attack e4';
      return attackersOf(b, 'e4', BLACK).length === 0 || `the queen is defended by ${attackersOf(b, 'e4', BLACK).join(' ')}`;
    },
  },
  {
    id: 'caro-kann-exchange',
    says: 'Queen recapture: after Nf3 two white minors are out and none of Black\'s; Qb6 raid: b2 is held by Bc1 and d4 by c3 alone; fianchetto: after Nf3 the knight is the ONLY defender of d4, because Bd3 blocks the queen',
    check: (o) => {
      const q = varBoard(o, 'Queen recapture', 8);
      if (minorsOut(q, WHITE) !== 2 || minorsOut(q, BLACK) !== 0) return `${minorsOut(q, WHITE)} white and ${minorsOut(q, BLACK)} black pieces out`;
      const r = varBoard(o, 'The queen raid', 9);
      if (!eq(attackersOf(r, 'b2', WHITE), ['Bc1']) || !eq(attackersOf(r, 'd4', WHITE), ['c3'])) return `b2 held by ${attackersOf(r, 'b2', WHITE)}, d4 by ${attackersOf(r, 'd4', WHITE)}`;
      const f = varBoard(o, 'The fianchetto', 8);
      return eq(attackersOf(f, 'd4', WHITE), ['Nf3']) || `d4 held by ${attackersOf(f, 'd4', WHITE).join(' ')}`;
    },
  },
  {
    id: 'french-exchange',
    says: 'Queen recapture: after Nf3 two white minors out to none; early check: after O-O two white minors out to one black',
    check: (o) => {
      const q = varBoard(o, 'Queen recapture', 8);
      if (minorsOut(q, WHITE) !== 2 || minorsOut(q, BLACK) !== 0) return `${minorsOut(q, WHITE)} v ${minorsOut(q, BLACK)}`;
      const c = varBoard(o, 'Early check', 10);
      return (minorsOut(c, WHITE) === 2 && minorsOut(c, BLACK) === 1) || `${minorsOut(c, WHITE)} v ${minorsOut(c, BLACK)} after castling`;
    },
  },
  {
    id: 'scandinavian-nc3',
    says: 'Qd6 branch: Nb5 hits d6 and c7, Bf4 makes c7 attacked twice and defended once, and after ...Na6 it is three minors out each',
    check: (o) => {
      const n = varBoard(o, '3...Qd6', 10);
      if (!attackersOf(n, 'd6', WHITE).includes('Nb5') || !attackersOf(n, 'c7', WHITE).includes('Nb5')) return 'Nb5 does not hit both d6 and c7';
      const b = varBoard(o, '3...Qd6', 12);
      if (!eq(attackersOf(b, 'c7', WHITE), ['Bf4', 'Nb5']) || !eq(attackersOf(b, 'c7', BLACK), ['Qd8'])) return `c7: ${attackersOf(b, 'c7', WHITE)} v ${attackersOf(b, 'c7', BLACK)}`;
      const a = varBoard(o, '3...Qd6', 13);
      return (minorsOut(a, WHITE) === 3 && minorsOut(a, BLACK) === 3) || `${minorsOut(a, WHITE)} v ${minorsOut(a, BLACK)} minors out`;
    },
  },
  {
    id: 'scandinavian-nc3',
    says: 'Qd8 branch: after O-O three white minors out to two; Nf6 branch: c4 attacks the knight on d5; Qe5+ branch: the queen has moved three times by ...Qc7, and after O-O it is three minors out to one',
    check: (o) => {
      const d8 = varBoard(o, '3...Qd8', 12);
      if (minorsOut(d8, WHITE) !== 3 || minorsOut(d8, BLACK) !== 2) return `Qd8: ${minorsOut(d8, WHITE)} v ${minorsOut(d8, BLACK)}`;
      if (!attackersOf(varBoard(o, '2...Nf6', 12), 'd5', WHITE).includes('c4')) return 'c4 does not attack d5';
      const v = variation(o, '3...Qe5+');
      if (queenMoves(v.line.slice(0, 10), 'black') !== 3) return `the queen moved ${queenMoves(v.line.slice(0, 10), 'black')} times by Qc7`;
      const e = varBoard(o, '3...Qe5+', 9);
      if (minorsOut(e, WHITE) !== 2 || minorsOut(e, BLACK) !== 0) return `after Qc7: ${minorsOut(e, WHITE)} v ${minorsOut(e, BLACK)}`;
      const c = varBoard(o, '3...Qe5+', 12);
      return (minorsOut(c, WHITE) === 3 && minorsOut(c, BLACK) === 1) || `after O-O: ${minorsOut(c, WHITE)} v ${minorsOut(c, BLACK)}`;
    },
  },
  {
    id: 'sicilian-alapin',
    says: '2...Nf6: e5 attacks the knight and is defended by nothing yet, and Bc4 hits a knight on d5 defended by nothing; 4...Nc6: d4 is hit by c5, Nc6 and the queen on d5 and held by c3 and Qd1, Nc3 later attacks the queen, and she has moved twice by ...Qa5 while three white minors are out; 2...e6: two attackers and three defenders of d4 after ...Nc6',
    check: (o) => {
      const e5 = varBoard(o, '2...Nf6', 4);
      if (!eq(attackersOf(e5, 'f6', WHITE), ['e5']) || attackersOf(e5, 'e5', WHITE).length) return 'e5 push is not as described';
      const bc4 = varBoard(o, '2...Nf6', 12);
      if (!attackersOf(bc4, 'd5', WHITE).includes('Bc4') || attackersOf(bc4, 'd5', BLACK).length) return 'the d5 knight is not attacked-and-undefended after Bc4';
      const nc6 = varBoard(o, '4...Nc6', 7);
      if (!eq(attackersOf(nc6, 'd4', BLACK), ['Nc6', 'Qd5', 'c5']) || !eq(attackersOf(nc6, 'd4', WHITE), ['Qd1', 'c3'])) return `d4: ${attackersOf(nc6, 'd4', BLACK)} v ${attackersOf(nc6, 'd4', WHITE)}`;
      if (!attackersOf(varBoard(o, '4...Nc6', 14), 'd5', WHITE).includes('Nc3')) return 'Nc3 does not attack d5';
      const v = variation(o, '4...Nc6');
      if (queenMoves(v.line.slice(0, 16), 'black') !== 2) return 'the queen has not moved exactly twice by Qa5';
      if (minorsOut(varBoard(o, '4...Nc6', 15), WHITE) !== 3) return 'three white minors are not out at Qa5';
      const e6 = varBoard(o, '2...e6', 9);
      return (attackersOf(e6, 'd4', BLACK).length === 2 && attackersOf(e6, 'd4', WHITE).length === 3) || `d4: ${attackersOf(e6, 'd4', BLACK)} v ${attackersOf(e6, 'd4', WHITE)}`;
    },
  },
  {
    id: 'caro-kann-classical',
    says: 'Advance: after ...c5 d4 is hit by the c-pawn and held by queen and knight, and f6 is covered by e5; Exchange: d4 is held by NOTHING after ...Nc6 (Bd3 blocks the queen), by c3 after c3, and b7 by nothing after Qb3; Bc4 raid: ...d5 hits the bishop and is held by c6, and at the end Black has three minors out to two',
    check: (o) => {
      const adv = varBoard(o, 'Advance', 9);
      if (!eq(attackersOf(adv, 'd4', BLACK), ['c5']) || !eq(attackersOf(adv, 'd4', WHITE), ['Nf3', 'Qd1'])) return `advance d4: ${attackersOf(adv, 'd4', BLACK)} v ${attackersOf(adv, 'd4', WHITE)}`;
      if (!attackersOf(adv, 'f6', WHITE).includes('e5')) return 'e5 does not cover f6';
      const ex = varBoard(o, 'Exchange', 7);
      if (attackersOf(ex, 'd4', WHITE).length) return `exchange d4 held by ${attackersOf(ex, 'd4', WHITE)}`;
      if (!eq(attackersOf(varBoard(o, 'Exchange', 8), 'd4', WHITE), ['c3'])) return 'd4 is not held by c3 alone after c3';
      if (attackersOf(varBoard(o, 'Exchange', 12), 'b7', BLACK).length) return 'b7 is defended after Qb3';
      const raid = varBoard(o, 'The Bc4 raid', 3);
      if (!eq(attackersOf(raid, 'c4', BLACK), ['d5']) || !attackersOf(raid, 'd5', BLACK).includes('c6')) return 'the d5 push is not as described';
      if (!eq(attackersOf(varBoard(o, 'The Bc4 raid', 5), 'c4', BLACK), ['d5'])) return 'the bishop is not re-attacked after cxd5';
      const end = varBoard(o, 'The Bc4 raid', 11);
      return (minorsOut(end, BLACK) === 3 && minorsOut(end, WHITE) === 2) || `${minorsOut(end, BLACK)} v ${minorsOut(end, WHITE)} minors out`;
    },
  },
  {
    id: 'caro-kann-classical',
    says: '5.Bd3? leaves d4 defended by nothing, ...Qxd4 is a clean pawn and hits e4 a second time',
    check: (o) => {
      const b = varBoard(o, 'The trap 5.Bd3?', 8);
      if (attackersOf(b, 'd4', WHITE).length) return `d4 defended by ${attackersOf(b, 'd4', WHITE).join(' ')}`;
      const q = varBoard(o, 'The trap 5.Bd3?', 9);
      if (material(q, BLACK) - material(q, WHITE) !== 1) return 'not a pawn up after Qxd4';
      return attackersOf(q, 'e4', BLACK).length === 2 || `e4 attacked by ${attackersOf(q, 'e4', BLACK).join(' ')}`;
    },
  },
  {
    id: 'queens-gambit-declined',
    says: 'after Bxf6 Bxf6 and Bd3, h7 is attacked once and defended once, by the king; after 4.Bf4 ... dxc5 Bxc5 material is level',
    check: (o) => {
      const b = varBoard(o, 'White takes on f6', 14);
      if (!eq(attackersOf(b, 'h7', WHITE), ['Bd3']) || !eq(attackersOf(b, 'h7', BLACK), ['Kg8'])) return `h7: ${attackersOf(b, 'h7', WHITE)} v ${attackersOf(b, 'h7', BLACK)}`;
      const f = varBoard(o, '4.Bf4', 13);
      return material(f, WHITE) === material(f, BLACK) || 'material is not level after Bxc5';
    },
  },
  {
    id: 'london-system',
    says: 'Englund: after Bf4 it is two white minors out to one, Nc3 leaves a1 held by Qd1 and the queen has moved three times; 2...c5: after e3 d4 is held three times against two, ...Qb6 hits an undefended b2 and Qc1 defends it; 3...Nh5: after hxg3 ...e6 the rook reaches h2 to h7',
    check: (o) => {
      const bf4 = varBoard(o, 'Englund', 6);
      if (minorsOut(bf4, WHITE) !== 2 || minorsOut(bf4, BLACK) !== 1) return `Englund after Bf4: ${minorsOut(bf4, WHITE)} v ${minorsOut(bf4, BLACK)}`;
      const nc3 = varBoard(o, 'Englund', 10);
      if (!eq(attackersOf(nc3, 'a1', WHITE), ['Qd1'])) return `a1 held by ${attackersOf(nc3, 'a1', WHITE)}`;
      if (queenMoves(variation(o, 'Englund').line, 'black') !== 3) return 'the Englund queen has not moved three times';
      const e3 = varBoard(o, '2...c5', 6);
      if (attackersOf(e3, 'd4', WHITE).length !== 3 || attackersOf(e3, 'd4', BLACK).length !== 2) return `c5 line d4: ${attackersOf(e3, 'd4', BLACK)} v ${attackersOf(e3, 'd4', WHITE)}`;
      const qb6 = varBoard(o, '2...c5', 7);
      if (!eq(attackersOf(qb6, 'b2', BLACK), ['Qb6']) || attackersOf(qb6, 'b2', WHITE).length) return 'b2 is not attacked-and-undefended after Qb6';
      if (!attackersOf(varBoard(o, '2...c5', 8), 'b2', WHITE).includes('Qc1')) return 'Qc1 does not defend b2';
      const rook = movesOf(varBoard(o, '3...Nh5', 9), 'h1');
      return ['h2', 'h3', 'h4', 'h5', 'h6', 'h7'].every((s) => rook.includes(s)) || `the rook reaches ${rook.join(' ')}`;
    },
  },
  {
    id: 'colle-system',
    says: '3...Bf5: the e4 push is held by the queen and the knight; 3...Bg4: after Nbd2 the f3 knight is defended by the d2 knight; 6...c4: after b3 the c4 pawn is hit by the b-pawn and the d2 knight',
    check: (o) => {
      const e4 = varBoard(o, '3...Bf5', 14);
      if (!eq(attackersOf(e4, 'e4', WHITE), ['Nd2', 'Qd3'])) return `e4 held by ${attackersOf(e4, 'e4', WHITE)}`;
      if (!attackersOf(varBoard(o, '3...Bg4', 10), 'f3', WHITE).includes('Nd2')) return 'Nd2 does not defend f3';
      const b3 = varBoard(o, '6...c4', 16);
      return eq(attackersOf(b3, 'c4', WHITE), ['Nd2', 'b3']) || `c4 attacked by ${attackersOf(b3, 'c4', WHITE)}`;
    },
  },
  {
    id: 'kings-indian-attack',
    says: 'both 1...c5 and 1...Nf6 branches castle on move four and reach Nbd2 as the sixth white move; in the ...Bg4 branch f3 is held by the e-pawn alone after ...Bg4 and by the e-pawn, the g2 bishop and the d2 knight after Nbd2, and e4 by d3 and the knight',
    check: (o) => {
      for (const name of ['1...c5', '1...Nf6']) {
        const v = variation(o, name);
        if (v.line[6] !== 'O-O' || v.line[10] !== 'Nbd2') return `${name}: castling or Nbd2 is not where the idea says`;
      }
      if (!eq(attackersOf(varBoard(o, '2...Bg4', 3), 'f3', WHITE), ['e2'])) return 'f3 is not held by the e-pawn alone after ...Bg4';
      const f3 = varBoard(o, '2...Bg4', 10);
      if (!eq(attackersOf(f3, 'f3', WHITE), ['Bg2', 'Nd2', 'e2'])) return `f3 held by ${attackersOf(f3, 'f3', WHITE)}`;
      const e4 = varBoard(o, '2...Bg4', 12);
      return eq(attackersOf(e4, 'e4', WHITE), ['Nd2', 'd3']) || `e4 held by ${attackersOf(e4, 'e4', WHITE)}`;
    },
  },
  {
    id: 'scotch-game',
    says: 'Four Knights: after ...Nf6 e4 is attacked once and undefended, after Nc3 defended once, after ...d5 two against two; Qh4: e4 one v one after Nc3, the d4 knight is held twice after Be3, Nf3 attacks h4, ...Bxe3 Nxh4 wins a queen for a bishop, the queen has moved TWICE by ...Qh5 with three white minors out',
    check: (o) => {
      const nf6 = varBoard(o, '4...Nf6', 7);
      if (!eq(attackersOf(nf6, 'e4', BLACK), ['Nf6']) || attackersOf(nf6, 'e4', WHITE).length) return 'e4 after ...Nf6 is not attacked-once-undefended';
      if (attackersOf(varBoard(o, '4...Nf6', 8), 'e4', WHITE).length !== 1) return 'e4 is not defended once after Nc3';
      const d5 = varBoard(o, '4...Nf6', 13);
      if (attackersOf(d5, 'e4', BLACK).length !== 2 || attackersOf(d5, 'e4', WHITE).length !== 2) return `e4 after ...d5: ${attackersOf(d5, 'e4', BLACK)} v ${attackersOf(d5, 'e4', WHITE)}`;
      const qh4 = varBoard(o, '4...Qh4', 8);
      if (attackersOf(qh4, 'e4', BLACK).length !== 1 || attackersOf(qh4, 'e4', WHITE).length !== 1) return 'e4 is not one v one after Nc3';
      if (attackersOf(varBoard(o, '4...Qh4', 10), 'd4', WHITE).length !== 2) return 'the d4 knight is not held twice after Be3';
      if (!attackersOf(varBoard(o, '4...Qh4', 12), 'h4', WHITE).includes('Nf3')) return 'Nf3 does not attack h4';
      const won = fromSan([...variation(o, '4...Qh4').line.slice(0, 13), 'Bxe3', 'Nxh4']);
      if (material(won, WHITE) - material(won, BLACK) !== 6) return 'Nxh4 does not win a queen for a bishop';
      const v = variation(o, '4...Qh4');
      if (queenMoves(v.line.slice(0, 14), 'black') !== 2) return 'the queen has not moved exactly twice by Qh5';
      if (!/second move/.test(v.ideas[6])) return 'the idea does not call Qh5 her second move';
      return minorsOut(varBoard(o, '4...Qh4', 13), WHITE) === 3 || 'three white minors are not out at ...Qh5';
    },
  },
  {
    id: 'vienna-game',
    says: '4...Bb4 pins a knight that b2 defends; 4...Na5 ends with the a2 square empty and the a-file open for the rook',
    check: (o) => {
      const b = varBoard(o, '4...Bb4', 7);
      if (!attackersOf(b, 'c3', BLACK).includes('Bb4') || !attackersOf(b, 'c3', WHITE).includes('b2')) return 'the c3 knight is not pinned-and-defended as described';
      const a = varBoard(o, '4...Na5', 10);
      return a.squares[nameToSquare('a2')] === 0 || 'a2 is not empty after axb3';
    },
  },
  {
    id: 'ruy-lopez-d3',
    says: 'Berlin and Classical: after castling f2 is held by the king and the rook against the c5 bishop; Bird: after c3 the d4 pawn is attacked once and defended by nothing',
    check: (o) => {
      for (const name of ['Berlin', 'Classical']) {
        const b = varBoard(o, name, 10);
        if (!eq(attackersOf(b, 'f2', WHITE), ['Kg1', 'Rf1']) || !eq(attackersOf(b, 'f2', BLACK), ['Bc5'])) return `${name}: f2 is ${attackersOf(b, 'f2', BLACK)} v ${attackersOf(b, 'f2', WHITE)}`;
      }
      const bird = varBoard(o, "Bird's", 14);
      return (eq(attackersOf(bird, 'd4', WHITE), ['c3']) && attackersOf(bird, 'd4', BLACK).length === 0) || `d4: ${attackersOf(bird, 'd4', WHITE)} v ${attackersOf(bird, 'd4', BLACK)}`;
    },
  },
  {
    id: 'stonewall-dutch',
    says: 'Staunton: after ...Qxf6 the e4 pawn is attacked by the knight and undefended, and after Nxe4 material is level with the queen attacked; Bg5: two bishops against one with f6 covering e5; Nc3: material level after ...Bxf6',
    check: (o) => {
      const q = varBoard(o, 'Staunton', 9);
      if (!eq(attackersOf(q, 'e4', WHITE), ['Nc3']) || attackersOf(q, 'e4', BLACK).length) return 'e4 is not attacked-once-undefended after Qxf6';
      const n = varBoard(o, 'Staunton', 10);
      if (material(n, WHITE) !== material(n, BLACK) || !attackersOf(n, 'f6', WHITE).includes('Ne4')) return 'after Nxe4 material is not level or the queen is not attacked';
      const bg5 = varBoard(o, 'The Bg5', 5);
      if (bishops(bg5, BLACK) !== 2 || bishops(bg5, WHITE) !== 1 || !attackersOf(bg5, 'e5', BLACK).includes('f6')) return 'the Bg5 line does not leave two bishops v one with f6 covering e5';
      const nc3 = varBoard(o, '2.Nc3', 11);
      return material(nc3, WHITE) === material(nc3, BLACK) || 'material is not level after ...Bxf6';
    },
  },
  {
    id: 'scandinavian-qd6',
    says: '2.Bc4?? is attacked by the d5 pawn and nothing recaptures on c4; 5.Nb5 hits d6 and c7, and Bf4 makes c7 attacked twice and defended once; 2.e5: f6 is covered by the e5 pawn; 2.Nc3: nothing attacks f7 at the end',
    check: (o) => {
      const bc4 = varBoard(o, '2.Bc4', 2);
      if (!eq(attackersOf(bc4, 'c4', BLACK), ['d5'])) return `c4 attacked by ${attackersOf(bc4, 'c4', BLACK)}`;
      const took = varBoard(o, '2.Bc4', 3);
      if (attackersOf(took, 'c4', WHITE).length || material(took, BLACK) - material(took, WHITE) !== 3) return 'the bishop is not simply lost';
      const nb5 = varBoard(o, '5.Nb5', 8);
      if (!attackersOf(nb5, 'd6', WHITE).includes('Nb5') || !attackersOf(nb5, 'c7', WHITE).includes('Nb5')) return 'Nb5 does not hit d6 and c7';
      const bf4 = varBoard(o, '5.Nb5', 10);
      if (attackersOf(bf4, 'c7', WHITE).length !== 2 || !eq(attackersOf(bf4, 'c7', BLACK), ['Qd8'])) return `c7: ${attackersOf(bf4, 'c7', WHITE)} v ${attackersOf(bf4, 'c7', BLACK)}`;
      if (!attackersOf(varBoard(o, '2.e5', 11), 'f6', WHITE).includes('e5')) return 'e5 does not cover f6';
      const end = varBoard(o, '2.Nc3', 12);
      return attackersOf(end, 'f7', WHITE).length === 0 || `f7 attacked by ${attackersOf(end, 'f7', WHITE)}`;
    },
  },
  {
    id: 'french-rubinstein',
    says: 'Advance: ...c5 hits a d4 held by the queen alone, ...Qb6 finds b2 held by Bc1, and after cxd4 cxd4 the pawn is held by knight and queen against knight and queen; Tarrasch: h7 one v two after Bd3; 5.Qe2: Nd6+ is check but not mate, and ...Bxd6 wins a piece nothing recaptures',
    check: (o) => {
      const c5 = varBoard(o, 'Advance', 5);
      if (!eq(attackersOf(c5, 'd4', BLACK), ['c5']) || !eq(attackersOf(c5, 'd4', WHITE), ['Qd1'])) return `d4 after c5: ${attackersOf(c5, 'd4', BLACK)} v ${attackersOf(c5, 'd4', WHITE)}`;
      if (!attackersOf(varBoard(o, 'Advance', 9), 'b2', WHITE).includes('Bc1')) return 'b2 is not held by Bc1';
      const cx = varBoard(o, 'Advance', 12);
      if (!eq(attackersOf(cx, 'd4', BLACK), ['Nc6', 'Qb6']) || !eq(attackersOf(cx, 'd4', WHITE), ['Nf3', 'Qd1'])) return `d4 after cxd4: ${attackersOf(cx, 'd4', BLACK)} v ${attackersOf(cx, 'd4', WHITE)}`;
      const t = varBoard(o, 'Tarrasch', 12);
      if (attackersOf(t, 'h7', WHITE).length !== 1 || attackersOf(t, 'h7', BLACK).length !== 2) return 'h7 is not one v two';
      const chk = varBoard(o, '5.Qe2', 10);
      if (!chk.inCheck() || chk.outcome() === 'checkmate') return 'Nd6+ is not a plain check';
      const took = varBoard(o, '5.Qe2', 11);
      return (attackersOf(took, 'd6', WHITE).length === 0 && material(took, BLACK) - material(took, WHITE) === 3) || 'Bxd6 does not win a clean piece';
    },
  },
  {
    id: 'slav-defence',
    says: 'Exchange: d4 is held by the queen alone after ...Nc6 and material is level at the end; 4.Nc3: a4 covers b5, Bxc4 restores material, ...Bb4 pins c3; 5.Qb3: b7 is undefended, ...Qb6 defends it and attacks the queen on b3 (NOT b2, which the white queen shields), Qb3 does not reach d5 past its own c4 pawn, Nc3 makes d5 attacked twice, ...e6 held three times',
    check: (o) => {
      if (!eq(attackersOf(varBoard(o, 'Exchange', 9), 'd4', WHITE), ['Qd1'])) return 'd4 is not held by the queen alone';
      const ex = varBoard(o, 'Exchange', 14);
      if (material(ex, WHITE) !== material(ex, BLACK)) return 'exchange line is not level';
      const a4 = varBoard(o, '4.Nc3', 8);
      if (!attackersOf(a4, 'b5', WHITE).includes('a4')) return 'a4 does not cover b5';
      const bx = varBoard(o, '4.Nc3', 12);
      if (material(bx, WHITE) !== material(bx, BLACK)) return 'material is not level after Bxc4';
      if (!attackersOf(varBoard(o, '4.Nc3', 13), 'c3', BLACK).includes('Bb4')) return 'Bb4 does not hit c3';
      const qb3 = varBoard(o, '5.Qb3', 8);
      if (attackersOf(qb3, 'b7', BLACK).length || !attackersOf(qb3, 'b7', WHITE).includes('Qb3')) return 'b7 is not attacked-and-undefended after Qb3';
      const qb6 = varBoard(o, '5.Qb3', 9);
      if (!attackersOf(qb6, 'b7', BLACK).includes('Qb6') || !attackersOf(qb6, 'b3', BLACK).includes('Qb6')) return 'Qb6 does not defend b7 and attack b3';
      if (attackersOf(qb6, 'b2', BLACK).includes('Qb6')) return 'Qb6 hits b2 after all';
      if (!eq(attackersOf(qb3, 'd5', WHITE), ['c4'])) return `d5 attacked by ${attackersOf(qb3, 'd5', WHITE)} after Qb3`;
      if (attackersOf(varBoard(o, '5.Qb3', 10), 'd5', WHITE).length !== 2) return 'd5 is not attacked twice after Nc3';
      return attackersOf(varBoard(o, '5.Qb3', 11), 'd5', BLACK).length === 3 || `d5 held by ${attackersOf(varBoard(o, '5.Qb3', 11), 'd5', BLACK)}`;
    },
  },
  {
    id: 'kings-indian-defence',
    says: 'Four Pawns: after ...c5 d4 is attacked by the c-pawn and held by the queen alone; 7.d5: the knight on c5 attacks e4 and the queen on c2 defends it',
    check: (o) => {
      const c5 = varBoard(o, 'Four Pawns', 9);
      if (!attackersOf(c5, 'd4', BLACK).includes('c5') || !eq(attackersOf(c5, 'd4', WHITE), ['Qd1'])) return `d4: ${attackersOf(c5, 'd4', BLACK)} v ${attackersOf(c5, 'd4', WHITE)}`;
      const nc5 = varBoard(o, '7.d5', 15);
      if (!attackersOf(nc5, 'e4', BLACK).includes('Nc5')) return 'the c5 knight does not attack e4';
      return attackersOf(varBoard(o, '7.d5', 16), 'e4', WHITE).includes('Qc2') || 'Qc2 does not defend e4';
    },
  },
  {
    id: 'english-four-knights',
    says: '4.d4: ...Bb4 hits c3, Bg5 hits f6, and bxc3 leaves doubled c-pawns; 2.d4: ...Nc6 attacks the queen and after Qd1 she has moved twice with no white minor out',
    check: (o) => {
      if (!attackersOf(varBoard(o, '4.d4', 9), 'c3', BLACK).includes('Bb4')) return 'Bb4 does not hit c3';
      if (!attackersOf(varBoard(o, '4.d4', 10), 'f6', WHITE).includes('Bg5')) return 'Bg5 does not hit f6';
      const bx = varBoard(o, '4.d4', 14);
      const cPawns = ['c3', 'c4'].filter((sq) => { const p = bx.squares[nameToSquare(sq)]; return p && typeOf(p) === PAWN && colourOf(p) === WHITE; });
      if (cPawns.length !== 2) return `white c-pawns on ${cPawns.join(' ') || 'nothing'}`;
      if (!attackersOf(varBoard(o, '2.d4', 5), 'd4', BLACK).includes('Nc6')) return 'Nc6 does not attack the queen';
      const v = variation(o, '2.d4');
      if (queenMoves(v.line.slice(0, 7), 'white') !== 2) return 'the white queen has not moved twice';
      return minorsOut(varBoard(o, '2.d4', 6), WHITE) === 0 || 'a white minor piece is out after Qd1';
    },
  },
];

// ── counts of the repertoire itself ────────────────────────────────────────
// "The third opening against 1...e5" was written when there were three and
// stayed when there were four. Any sentence that puts a number on openings,
// answers or systems has to be listed here with a check that counts them.
const REPERTOIRE_COUNT = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|second|third|fourth|fifth|half the)\s+(\w+\s+){0,2}?(openings?|answers?|systems?)\b/i;
const REPERTOIRE_CLAIMS = [
  {
    id: 'vienna-game', needle: 'the third opening in your repertoire pointing at',
    check: (byId) => {
      const bc4 = Object.values(byId).filter((o) => o.side === 'white' && o.line.includes('Bc4')).map((o) => o.id);
      return (bc4.length === 3 && bc4[2] === 'vienna-game') || `white openings with Bc4 are ${bc4.join(' ')}`;
    },
  },
  {
    id: 'french-rubinstein', needle: 'the third answer to it here after the Caro-Kann and the Scandinavian',
    check: (byId) => {
      const e4 = Object.values(byId).filter((o) => o.side === 'black' && o.line[0] === 'e4').map((o) => o.id);
      // Third in file order; a later entry (the Scholar's Mate defence) does not change that.
      return (e4[2] === 'french-rubinstein' && e4.slice(0, 2).every((id) => /^[cd]/.test(byId[id].line[1]))) || `black answers to 1.e4 are ${e4.join(' ')}`;
    },
  },
  {
    id: 'colle-system', needle: 'Two openings that look identical on the board and differ by one square',
    // The London and the Torre - the Torre is not in the file, so the only
    // thing to check is that the London it is being compared with is.
    check: (byId) => byId['london-system']?.line.includes('Bf4') || 'the London is not in the file',
  },
];

// ── UK English ─────────────────────────────────────────────────────────────
// The prose is written for a reader in the UK, and a single "defense" in a
// file that says "defence" everywhere else reads as a different author. The
// whole built file is scanned, comments included, so a stray spelling in a
// header cannot hide behind the data. The -ize list is explicit rather than a
// suffix rule, because "size", "prize" and "seize" are not misspellings.
const AMERICAN = new RegExp(String.raw`\b(defense|defenses|offense|center|centers|centered|color|colors|colored|colorful|favor|favors|favorite|favorable|gray|maneuver|maneuvers|maneuvering|practicing|practiced|toward|labor|honor|humor|behavior|neighbor|armor|harbor|catalog|traveled|traveling|canceled|analyze|analyzed|analyzing|(?:recogn|memor|real|organ|capital|minim|maxim|critic|apolog|emphas|priorit|summar|util|special|neutral|equal|mobil|stabil|visual|categor|final|harmon|symbol|sympath|jeopard|normal|formal|civil|material|penal|patron|scrutin|theor|central|immobil|energ|familiar|character|synchron|author|item|legal|steril|terror|revital|ideal|ration|local|global|vocal|standard|custom|optim|rand|sanit|magnet|monet|moral|natural|popular|rival|ritual|serial|social|subsid|tranquil|vandal|weapon)iz(?:e|es|ed|ing|ation|ations))\b`, 'i');

function checkSpelling(source, failures) {
  const lines = source.split("\n");
  let hits = 0;
  lines.forEach((line, i) => {
    const found = line.match(new RegExp(AMERICAN.source, "gi"));
    if (!found) return;
    hits += found.length;
    failures.push(`openings.js line ${i + 1}: American spelling "${found.join("\", \"")}" - the prose is UK English`);
  });
  return hits;
}

function checkRepertoireCounts(openings, failures) {
  const byId = Object.fromEntries(openings.map((o) => [o.id, o]));
  let matched = 0;
  for (const o of openings) {
    const texts = [...o.ideas, ...o.traps.map((t) => t.answer), o.plan, ...o.variations.flatMap((v) => v.ideas)];
    for (const text of texts) {
      for (const sentence of text.split(/(?<=[.!?])\s+/)) {
        if (!REPERTOIRE_COUNT.test(sentence)) continue;
        const claim = REPERTOIRE_CLAIMS.find((c) => c.id === o.id && sentence.includes(c.needle));
        if (!claim) { failures.push(`${o.id}: puts a number on the repertoire with no check behind it - "${sentence}"`); continue; }
        matched++;
        const verdict = claim.check(byId);
        if (verdict !== true) failures.push(`${o.id}: repertoire count "${claim.needle}" is WRONG - ${verdict}`);
      }
    }
  }
  return matched;
}

// ── run ────────────────────────────────────────────────────────────────────
const openings = await loadOpenings();
const failures = [];
const spellingHits = checkSpelling(await readFile(join(HERE, '../src/openings.js'), 'utf8'), failures);
const rows = [];

console.log(`Verifying ${openings.length} openings against the engine in ./engine\n`);

for (const [index, opening] of openings.entries()) {
  checkShape(opening, index, failures);
  const before = failures.length;
  const played = replay(opening, failures);
  const legal = failures.length === before && played !== null;

  let evalLine = 'not evaluated';
  let cp = null;

  if (legal) {
    const { board } = played;
    const student = opening.side === 'white' ? WHITE : BLACK;
    const result = new Engine().search(board, { movetime: MOVETIME });
    // search() scores from the side to move's point of view; flip it when the
    // student is the one waiting.
    cp = board.turn === student ? result.score : -result.score;
    const pawns = (cp / 100).toFixed(2);
    const best = result.move ? toSan(board, result.move) : '-';
    evalLine = `${cp >= 0 ? '+' : ''}${pawns} for ${opening.side} (engine would play ${best})`;
    if (cp < LOST_THRESHOLD) {
      failures.push(`${opening.id}: final position is ${pawns} for ${opening.side}, worse than the ${(LOST_THRESHOLD / 100).toFixed(2)} floor`);
    }
  }

  // Every branch is replayed and evaluated exactly as the main line is. A
  // branch that is illegal, mis-spelt or lost for the student is a failure
  // with the branch named, not a quiet gap in the lesson.
  const branches = [];
  for (const v of opening.variations ?? []) {
    const stub = { id: `${opening.id} / ${v.name}`, line: v.line };
    const beforeBranch = failures.length;
    const replayed = replay(stub, failures);
    let line = 'not evaluated';
    if (failures.length === beforeBranch && replayed) {
      const student = opening.side === 'white' ? WHITE : BLACK;
      const result = new Engine().search(replayed.board, { movetime: MOVETIME });
      const bcp = replayed.board.turn === student ? result.score : -result.score;
      const best = result.move ? toSan(replayed.board, result.move) : '-';
      line = `${bcp >= 0 ? '+' : ''}${(bcp / 100).toFixed(2)} for ${opening.side} (engine would play ${best})`;
      if (bcp < LOST_THRESHOLD) failures.push(`${stub.id}: final position is ${(bcp / 100).toFixed(2)} for ${opening.side}, worse than the ${(LOST_THRESHOLD / 100).toFixed(2)} floor`);
    }
    branches.push({ v, line, legal: failures.length === beforeBranch && replayed !== null });
  }

  rows.push({ opening, legal, evalLine, cp, uci: played?.uci ?? [], branches });
}
const byId = Object.fromEntries(openings.map((o) => [o.id, o]));

const pad = (s, n) => String(s).padEnd(n);
const idWidth = Math.max(...openings.map((o) => o.id.length)) + 2;

for (const row of rows) {
  const { opening } = row;
  console.log(`${row.legal ? 'OK  ' : 'FAIL'} ${pad(opening.id, idWidth)}${opening.eco}  ${pad(opening.side, 7)}${pad(`${opening.line.length} plies`, 10)}ideas ${opening.ideas.length}`);
  console.log(`     ${opening.line.join(' ')}`);
  console.log(`     eval ${row.evalLine}`);
  for (const b of row.branches) {
    console.log(`     ${b.legal ? 'ok  ' : 'FAIL'} ${b.v.name}: at ply ${b.v.at}, ${b.v.line.length - b.v.at} plies from there, ideas ${b.v.ideas.length}`);
    console.log(`          ${b.v.line.slice(b.v.at).join(' ')}`);
    console.log(`          eval ${b.line}`);
  }
  console.log('');
}

console.log('Claims made in the trap prose:');
for (const claim of CLAIMS) {
  let verdict;
  try {
    verdict = claim.check(byId[claim.id], byId);
  } catch (error) {
    verdict = error.message;
  }
  const ok = verdict === true;
  if (!ok) failures.push(`${claim.id}: claim "${claim.says}" is WRONG - ${verdict}`);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${claim.id}: ${claim.says}`);
}

const counted = checkRepertoireCounts(openings, failures);
console.log(`\nRepertoire counts in the prose: ${counted} sentence(s) matched against the file.`);
console.log(`American spellings found: ${spellingHits}.`);

const plies = openings.reduce((n, o) => n + o.line.length, 0);
const variations = openings.reduce((n, o) => n + o.variations.length, 0);
const branchPlies = openings.reduce((n, o) => n + o.variations.reduce((m, v) => m + (v.line.length - v.at), 0), 0);
console.log(`\n${openings.length} openings, ${plies} main-line plies replayed, ${variations} variations (${branchPlies} branch plies), ${plies + branchPlies} idea sentences, ${CLAIMS.length} claims checked on the board, ${counted} repertoire counts checked, ${spellingHits} American spellings.`);

if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

console.log('Every line and every branch legal, every ideas array the right length, every final evaluation sane, every counted claim true on the board.');
