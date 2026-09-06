// A chess engine, written from scratch: 0x88 board, alpha-beta with
// iterative deepening, quiescence, a transposition table and a tapered
// evaluation. No library, no CDN, no network.
//
// 0x88 rather than a plain 8x8 array because off-board detection is one AND:
// a square index whose 0x88 bit is set is off the board, which removes a
// bounds check from the inner loop of every sliding piece.

export const EMPTY = 0;
export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const WHITE = 8, BLACK = 16;

const COLOUR_MASK = 24, TYPE_MASK = 7;

export const colourOf = (p) => p & COLOUR_MASK;
export const typeOf = (p) => p & TYPE_MASK;

const KNIGHT_DIRS = [33, 31, 18, 14, -33, -31, -18, -14];
const BISHOP_DIRS = [17, 15, -17, -15];
const ROOK_DIRS = [16, 1, -16, -1];
const KING_DIRS = [17, 16, 15, 1, -17, -16, -15, -1];

// Castling rights as bits, so the whole set updates with one AND.
export const WK = 1, WQ = 2, BK = 4, BQ = 8;

// Squares whose occupancy or movement kills a castling right. Indexed by
// square, so make() does one lookup instead of four comparisons.
const CASTLE_MASK = new Int32Array(128).fill(15);
CASTLE_MASK[0x00] = 15 & ~WQ;   // a1
CASTLE_MASK[0x07] = 15 & ~WK;   // h1
CASTLE_MASK[0x04] = 15 & ~(WK | WQ); // e1
CASTLE_MASK[0x70] = 15 & ~BQ;   // a8
CASTLE_MASK[0x77] = 15 & ~BK;   // h8
CASTLE_MASK[0x74] = 15 & ~(BK | BQ); // e8

export const fileOf = (sq) => sq & 7;
export const rankOf = (sq) => sq >> 4;
export const squareName = (sq) => 'abcdefgh'[fileOf(sq)] + (rankOf(sq) + 1);
export const nameToSquare = (name) => (name.charCodeAt(0) - 97) + ((name.charCodeAt(1) - 49) << 4);

const PIECE_FROM_CHAR = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };
const CHAR_FROM_PIECE = { [PAWN]: 'p', [KNIGHT]: 'n', [BISHOP]: 'b', [ROOK]: 'r', [QUEEN]: 'q', [KING]: 'k' };

// Move packing. One integer per move keeps the move list a flat Int32Array,
// which matters: search allocates a move list per node and object moves make
// the garbage collector the bottleneck long before the search does.
//   bits 0-7   from
//   bits 8-15  to
//   bits 16-19 promotion piece type
//   bits 20-23 flags
export const FLAG_CAPTURE = 1, FLAG_EP = 2, FLAG_CASTLE = 4, FLAG_DOUBLE = 8;
export const mkMove = (from, to, promo, flags) => from | (to << 8) | (promo << 16) | (flags << 20);
export const moveFrom = (m) => m & 0xff;
export const moveTo = (m) => (m >> 8) & 0xff;
export const movePromo = (m) => (m >> 16) & 0xf;
export const moveFlags = (m) => (m >> 20) & 0xf;

export function moveToUci(m) {
  const promo = movePromo(m);
  return squareName(moveFrom(m)) + squareName(moveTo(m)) + (promo ? CHAR_FROM_PIECE[promo] : '');
}

// Zobrist keys. Seeded deterministically so a position hashes the same on
// every device and a transposition table stays meaningful across a reload.
function makeRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s >>> 0;
  };
}

const rnd = makeRandom(0x9e3779b9);
const ZOBRIST_PIECE = [];
for (let p = 0; p < 32; p++) {
  ZOBRIST_PIECE[p] = new Uint32Array(128);
  for (let sq = 0; sq < 128; sq++) ZOBRIST_PIECE[p][sq] = rnd();
}
const ZOBRIST_SIDE = rnd();
const ZOBRIST_CASTLE = new Uint32Array(16);
for (let i = 0; i < 16; i++) ZOBRIST_CASTLE[i] = rnd();
const ZOBRIST_EP = new Uint32Array(128);
for (let i = 0; i < 128; i++) ZOBRIST_EP[i] = rnd();

// A SECOND, INDEPENDENT KEY. The first is 32 bits, and a transposition table
// of a quarter of a million entries under a 32-bit key collides every search
// (measured: 4 and 10 foreign hits in two four-second searches). The second
// key is stored in the entry and checked on the probe, so a collision costs a
// miss rather than another position's score.
//
// NOT ANOTHER XORSHIFT SEED. Xorshift is linear over GF(2): a second seed is
// the same cycle at an offset, every entry of the second table is one fixed
// linear map of the first, and any set of pieces whose keys cancel in one
// table cancels in the other — measured: every one of the collisions was
// accepted with the second key. Splitmix multiplies, which breaks that.
function makeSplitMix(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    z ^= z >>> 15;
    return z >>> 0;
  };
}
const rnd2 = makeSplitMix(0x7f4a7c15);
const ZOBRIST2_PIECE = [];
for (let p = 0; p < 32; p++) {
  ZOBRIST2_PIECE[p] = new Uint32Array(128);
  for (let sq = 0; sq < 128; sq++) ZOBRIST2_PIECE[p][sq] = rnd2();
}
const ZOBRIST2_SIDE = rnd2();
const ZOBRIST2_CASTLE = new Uint32Array(16);
for (let i = 0; i < 16; i++) ZOBRIST2_CASTLE[i] = rnd2();
const ZOBRIST2_EP = new Uint32Array(128);
for (let i = 0; i < 128; i++) ZOBRIST2_EP[i] = rnd2();

export class Board {
  constructor(fen) {
    this.squares = new Int32Array(128);
    this.turn = WHITE;
    this.castling = 0;
    this.ep = -1;
    this.halfmove = 0;
    this.fullmove = 1;
    this.kings = { [WHITE]: -1, [BLACK]: -1 };
    this.hash = 0;
    this.hash2 = 0;
    this.history = [];
    // Every position reached, for repetition detection. Only the hash is kept.
    this.repetition = [];
    this.setFen(fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  }

  setFen(fen) {
    this.squares.fill(EMPTY);
    const [board, turn, castling, ep, half, full] = fen.trim().split(/\s+/);

    let sq = 0x70;
    for (const ch of board) {
      if (ch === '/') { sq -= 24; continue; }
      if (ch >= '1' && ch <= '8') { sq += +ch; continue; }
      const lower = ch.toLowerCase();
      const piece = PIECE_FROM_CHAR[lower] | (ch === lower ? BLACK : WHITE);
      this.squares[sq] = piece;
      if (typeOf(piece) === KING) this.kings[colourOf(piece)] = sq;
      sq++;
    }

    this.turn = turn === 'w' ? WHITE : BLACK;
    this.castling = 0;
    if (castling && castling !== '-') {
      if (castling.includes('K')) this.castling |= WK;
      if (castling.includes('Q')) this.castling |= WQ;
      if (castling.includes('k')) this.castling |= BK;
      if (castling.includes('q')) this.castling |= BQ;
    }
    // RIGHTS THE BOARD CANNOT SUPPORT ARE DROPPED HERE, not honoured. A FEN
    // saying "KQkq" over a board with no rook on h1 had the generator castle
    // anyway — the king walked two squares and whatever stood on h1 (nothing,
    // or a knight) was moved to f1 as the rook. What was dropped is recorded
    // so fenProblem() can say so instead of passing the FEN silently.
    this.castling = this.supportedCastling(this.castling);
    this.dropped_castling = this.castling ^ this.parsedCastling(castling);
    // The ep square counts only when a pawn can actually take. Every tool
    // writes "e3" after 1.e4 whether or not a capture exists, and hashing it
    // made the position after 1.e4 a different position from the same board
    // reached a move later — which missed a threefold repetition by a cycle.
    const wanted = ep && ep !== '-' && /^[a-h][1-8]$/.test(ep) ? nameToSquare(ep) : -1;
    this.ep = this.epCapturable(wanted) ? wanted : -1;
    this.halfmove = half ? +half : 0;
    this.fullmove = full ? +full : 1;
    this.history = [];
    this.hash = this.computeHash();
    this.hash2 = this.computeHash2();
    this.repetition = [this.hash];
  }

  parsedCastling(field) {
    let bits = 0;
    if (field && field !== '-') {
      if (field.includes('K')) bits |= WK;
      if (field.includes('Q')) bits |= WQ;
      if (field.includes('k')) bits |= BK;
      if (field.includes('q')) bits |= BQ;
    }
    return bits;
  }

  /** The subset of `bits` whose king and rook stand on their home squares. */
  supportedCastling(bits) {
    const at = (sq, type, colour) => this.squares[sq] === (type | colour);
    let out = 0;
    if ((bits & WK) && at(0x04, KING, WHITE) && at(0x07, ROOK, WHITE)) out |= WK;
    if ((bits & WQ) && at(0x04, KING, WHITE) && at(0x00, ROOK, WHITE)) out |= WQ;
    if ((bits & BK) && at(0x74, KING, BLACK) && at(0x77, ROOK, BLACK)) out |= BK;
    if ((bits & BQ) && at(0x74, KING, BLACK) && at(0x70, ROOK, BLACK)) out |= BQ;
    return out;
  }

  /** Could the side to move capture en passant on `sq`? A pawn of theirs must sit beside the pawn that just passed. */
  epCapturable(sq) {
    if (sq < 0 || (sq & 0x88)) return false;
    const us = this.turn;
    const passedRank = us === WHITE ? 4 : 3;      // the rank the double-pushed pawn now stands on
    if (rankOf(sq) !== (us === WHITE ? 5 : 2)) return false;
    const passed = (passedRank << 4) | fileOf(sq);
    if (this.squares[passed] !== (PAWN | (us === WHITE ? BLACK : WHITE))) return false;
    for (const side of [-1, 1]) {
      const from = passed + side;
      if (!(from & 0x88) && this.squares[from] === (PAWN | us)) return true;
    }
    return false;
  }

  /** A copy that carries the game history the search reads: repetition and the fifty-move clock. */
  clone() {
    const copy = new Board(this.fen());
    copy.repetition = this.repetition.slice();
    return copy;
  }

  fen() {
    let board = '';
    for (let rank = 7; rank >= 0; rank--) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const piece = this.squares[(rank << 4) | file];
        if (piece === EMPTY) { empty++; continue; }
        if (empty) { board += empty; empty = 0; }
        const ch = CHAR_FROM_PIECE[typeOf(piece)];
        board += colourOf(piece) === WHITE ? ch.toUpperCase() : ch;
      }
      if (empty) board += empty;
      if (rank) board += '/';
    }

    let castling = '';
    if (this.castling & WK) castling += 'K';
    if (this.castling & WQ) castling += 'Q';
    if (this.castling & BK) castling += 'k';
    if (this.castling & BQ) castling += 'q';

    return [
      board,
      this.turn === WHITE ? 'w' : 'b',
      castling || '-',
      this.ep >= 0 ? squareName(this.ep) : '-',
      this.halfmove,
      this.fullmove,
    ].join(' ');
  }

  computeHash() {
    let h = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const piece = this.squares[sq];
      if (piece) h = (h ^ ZOBRIST_PIECE[piece][sq]) >>> 0;
    }
    if (this.turn === BLACK) h = (h ^ ZOBRIST_SIDE) >>> 0;
    h = (h ^ ZOBRIST_CASTLE[this.castling]) >>> 0;
    if (this.ep >= 0) h = (h ^ ZOBRIST_EP[this.ep]) >>> 0;
    return h >>> 0;
  }

  computeHash2() {
    let h = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const piece = this.squares[sq];
      if (piece) h = (h ^ ZOBRIST2_PIECE[piece][sq]) >>> 0;
    }
    if (this.turn === BLACK) h = (h ^ ZOBRIST2_SIDE) >>> 0;
    h = (h ^ ZOBRIST2_CASTLE[this.castling]) >>> 0;
    if (this.ep >= 0) h = (h ^ ZOBRIST2_EP[this.ep]) >>> 0;
    return h >>> 0;
  }

  /** Is `square` attacked by `by` (a colour)? Used for legality and for check. */
  attacked(square, by) {
    // Pawns. Written as "where would a pawn have to stand", not "where can a
    // pawn go", because the two differ for the pawn's non-capturing push.
    const pawnDir = by === WHITE ? -16 : 16;
    for (const side of [-1, 1]) {
      const from = square + pawnDir + side;
      if (!(from & 0x88)) {
        const piece = this.squares[from];
        if (piece && colourOf(piece) === by && typeOf(piece) === PAWN) return true;
      }
    }

    for (const d of KNIGHT_DIRS) {
      const from = square + d;
      if (from & 0x88) continue;
      const piece = this.squares[from];
      if (piece && colourOf(piece) === by && typeOf(piece) === KNIGHT) return true;
    }

    for (const d of KING_DIRS) {
      const from = square + d;
      if (from & 0x88) continue;
      const piece = this.squares[from];
      if (piece && colourOf(piece) === by && typeOf(piece) === KING) return true;
    }

    for (const [dirs, slider] of [[BISHOP_DIRS, BISHOP], [ROOK_DIRS, ROOK]]) {
      for (const d of dirs) {
        let from = square + d;
        while (!(from & 0x88)) {
          const piece = this.squares[from];
          if (piece) {
            if (colourOf(piece) === by) {
              const t = typeOf(piece);
              if (t === slider || t === QUEEN) return true;
            }
            break;
          }
          from += d;
        }
      }
    }

    return false;
  }

  inCheck(colour = this.turn) {
    return this.attacked(this.kings[colour], colour === WHITE ? BLACK : WHITE);
  }

  /**
   * Pseudo-legal moves. Legality (does this leave my own king attacked?) is
   * settled in make(), which unmakes and reports false — one make/unmake is
   * cheaper than a pin analysis and cannot disagree with the rules.
   */
  generate(capturesOnly = false) {
    const moves = [];
    const us = this.turn;
    const them = us === WHITE ? BLACK : WHITE;

    for (let from = 0; from < 128; from++) {
      if (from & 0x88) continue;
      const piece = this.squares[from];
      if (!piece || colourOf(piece) !== us) continue;
      const type = typeOf(piece);

      if (type === PAWN) {
        const dir = us === WHITE ? 16 : -16;
        const startRank = us === WHITE ? 1 : 6;
        const promoRank = us === WHITE ? 7 : 0;

        const one = from + dir;
        if (!(one & 0x88) && !this.squares[one]) {
          if (!capturesOnly) {
            if (rankOf(one) === promoRank) {
              for (const p of [QUEEN, ROOK, BISHOP, KNIGHT]) moves.push(mkMove(from, one, p, 0));
            } else {
              moves.push(mkMove(from, one, 0, 0));
              const two = from + dir * 2;
              if (rankOf(from) === startRank && !this.squares[two]) {
                moves.push(mkMove(from, two, 0, FLAG_DOUBLE));
              }
            }
          } else if (rankOf(one) === promoRank) {
            // A promotion is a capture-sized swing even when nothing is taken,
            // so quiescence has to see it or it stops one ply before a queen.
            moves.push(mkMove(from, one, QUEEN, 0));
          }
        }

        for (const side of [-1, 1]) {
          const to = from + dir + side;
          if (to & 0x88) continue;
          const target = this.squares[to];
          if (target && colourOf(target) === them) {
            if (rankOf(to) === promoRank) {
              for (const p of [QUEEN, ROOK, BISHOP, KNIGHT]) moves.push(mkMove(from, to, p, FLAG_CAPTURE));
            } else {
              moves.push(mkMove(from, to, 0, FLAG_CAPTURE));
            }
          } else if (to === this.ep) {
            moves.push(mkMove(from, to, 0, FLAG_CAPTURE | FLAG_EP));
          }
        }
        continue;
      }

      const dirs = type === KNIGHT ? KNIGHT_DIRS
        : type === BISHOP ? BISHOP_DIRS
        : type === ROOK ? ROOK_DIRS
        : KING_DIRS;
      const sliding = type === BISHOP || type === ROOK || type === QUEEN;
      const allDirs = type === QUEEN ? KING_DIRS : dirs;

      for (const d of allDirs) {
        let to = from + d;
        while (!(to & 0x88)) {
          const target = this.squares[to];
          if (target) {
            if (colourOf(target) === them) moves.push(mkMove(from, to, 0, FLAG_CAPTURE));
            break;
          }
          if (!capturesOnly) moves.push(mkMove(from, to, 0, 0));
          if (!sliding) break;
          to += d;
        }
      }

      if (type === KING && !capturesOnly) {
        const kingSide = us === WHITE ? WK : BK;
        const queenSide = us === WHITE ? WQ : BQ;
        const home = us === WHITE ? 0x04 : 0x74;
        if (from === home && !this.inCheck(us)) {
          if ((this.castling & kingSide)
            && !this.squares[home + 1] && !this.squares[home + 2]
            && !this.attacked(home + 1, them) && !this.attacked(home + 2, them)) {
            moves.push(mkMove(from, home + 2, 0, FLAG_CASTLE));
          }
          if ((this.castling & queenSide)
            && !this.squares[home - 1] && !this.squares[home - 2] && !this.squares[home - 3]
            && !this.attacked(home - 1, them) && !this.attacked(home - 2, them)) {
            moves.push(mkMove(from, home - 2, 0, FLAG_CASTLE));
          }
        }
      }
    }

    return moves;
  }

  /** Play a move. Returns false and changes nothing if it leaves the king in check. */
  make(move) {
    const from = moveFrom(move), to = moveTo(move);
    const flags = moveFlags(move), promo = movePromo(move);
    const piece = this.squares[from];
    // A move is only a move of the side to move's own piece. Anything else —
    // an empty square, the opponent's piece — is refused before it touches
    // the board: a stale promotion choice once "promoted" nothing on b7 and
    // deleted the pawn there.
    if (!piece || colourOf(piece) !== this.turn) return false;
    const us = this.turn;
    const them = us === WHITE ? BLACK : WHITE;

    const captured = (flags & FLAG_EP)
      ? this.squares[to + (us === WHITE ? -16 : 16)]
      : this.squares[to];

    this.history.push({
      move, captured, castling: this.castling, ep: this.ep,
      halfmove: this.halfmove, hash: this.hash, hash2: this.hash2,
      capturedSquare: (flags & FLAG_EP) ? to + (us === WHITE ? -16 : 16) : to,
    });

    let h = this.hash, h2 = this.hash2;
    h ^= ZOBRIST_CASTLE[this.castling]; h2 ^= ZOBRIST2_CASTLE[this.castling];
    if (this.ep >= 0) { h ^= ZOBRIST_EP[this.ep]; h2 ^= ZOBRIST2_EP[this.ep]; }

    if (captured) {
      const capSq = (flags & FLAG_EP) ? to + (us === WHITE ? -16 : 16) : to;
      h ^= ZOBRIST_PIECE[captured][capSq]; h2 ^= ZOBRIST2_PIECE[captured][capSq];
      this.squares[capSq] = EMPTY;
    }

    h ^= ZOBRIST_PIECE[piece][from]; h2 ^= ZOBRIST2_PIECE[piece][from];
    this.squares[from] = EMPTY;

    const placed = promo ? (promo | us) : piece;
    this.squares[to] = placed;
    h ^= ZOBRIST_PIECE[placed][to]; h2 ^= ZOBRIST2_PIECE[placed][to];

    if (typeOf(piece) === KING) this.kings[us] = to;

    if (flags & FLAG_CASTLE) {
      const rookFrom = to > from ? from + 3 : from - 4;
      const rookTo = to > from ? from + 1 : from - 1;
      const rook = this.squares[rookFrom];
      this.squares[rookFrom] = EMPTY;
      this.squares[rookTo] = rook;
      h ^= ZOBRIST_PIECE[rook][rookFrom] ^ ZOBRIST_PIECE[rook][rookTo];
      h2 ^= ZOBRIST2_PIECE[rook][rookFrom] ^ ZOBRIST2_PIECE[rook][rookTo];
    }

    this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
    this.turn = them;
    // The ep square is set only when one of their pawns can actually take —
    // see setFen(). Otherwise the same board hashes two ways.
    const epSquare = (flags & FLAG_DOUBLE) ? (from + to) / 2 : -1;
    this.ep = this.epCapturable(epSquare) ? epSquare : -1;

    h ^= ZOBRIST_CASTLE[this.castling]; h2 ^= ZOBRIST2_CASTLE[this.castling];
    if (this.ep >= 0) { h ^= ZOBRIST_EP[this.ep]; h2 ^= ZOBRIST2_EP[this.ep]; }
    h ^= ZOBRIST_SIDE; h2 ^= ZOBRIST2_SIDE;

    this.halfmove = (captured || typeOf(piece) === PAWN) ? 0 : this.halfmove + 1;
    if (us === BLACK) this.fullmove++;
    this.hash = h >>> 0;
    this.hash2 = h2 >>> 0;

    // Legality last: the move is played, and taken back if it was never legal.
    // One make/unmake beats a pin analysis and cannot disagree with the rules.
    if (this.attacked(this.kings[us], them)) {
      this.unmake();
      return false;
    }

    this.repetition.push(this.hash);
    return true;
  }

  unmake() {
    const state = this.history.pop();
    if (!state) return;
    if (this.repetition[this.repetition.length - 1] === this.hash) this.repetition.pop();

    const { move, captured, capturedSquare } = state;
    const from = moveFrom(move), to = moveTo(move);
    const flags = moveFlags(move), promo = movePromo(move);

    this.turn = this.turn === WHITE ? BLACK : WHITE;
    const us = this.turn;
    if (us === BLACK) this.fullmove--;

    const placed = this.squares[to];
    this.squares[from] = promo ? (PAWN | us) : placed;
    this.squares[to] = EMPTY;
    if (captured) this.squares[capturedSquare] = captured;

    if (typeOf(placed) === KING) this.kings[us] = from;

    if (flags & FLAG_CASTLE) {
      const rookFrom = to > from ? from + 3 : from - 4;
      const rookTo = to > from ? from + 1 : from - 1;
      this.squares[rookFrom] = this.squares[rookTo];
      this.squares[rookTo] = EMPTY;
    }

    this.castling = state.castling;
    this.ep = state.ep;
    this.halfmove = state.halfmove;
    this.hash = state.hash;
    this.hash2 = state.hash2;
  }

  legalMoves() {
    const out = [];
    for (const move of this.generate()) {
      if (this.make(move)) { out.push(move); this.unmake(); }
    }
    return out;
  }

  isRepetition() {
    let count = 0;
    for (const h of this.repetition) if (h === this.hash) count++;
    return count >= 3;
  }

  insufficientMaterial() {
    const pieces = [];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const p = this.squares[sq];
      if (p && typeOf(p) !== KING) pieces.push({ type: typeOf(p), colour: colourOf(p), sq });
    }
    if (pieces.length === 0) return true;
    if (pieces.length === 1) return pieces[0].type === BISHOP || pieces[0].type === KNIGHT;
    if (pieces.length === 2 && pieces.every((p) => p.type === BISHOP)) {
      const light = (p) => (fileOf(p.sq) + rankOf(p.sq)) & 1;
      return light(pieces[0]) === light(pieces[1]);
    }
    return false;
  }

  /** null while the game is going, otherwise how it ended. */
  outcome() {
    const moves = this.legalMoves();
    if (moves.length === 0) return this.inCheck() ? 'checkmate' : 'stalemate';
    if (this.halfmove >= 100) return 'fifty_move';
    if (this.isRepetition()) return 'repetition';
    if (this.insufficientMaterial()) return 'insufficient';
    return null;
  }
}

/** Nodes at depth N. The standard correctness test for a move generator. */
export function perft(board, depth) {
  if (depth === 0) return 1;
  let nodes = 0;
  for (const move of board.generate()) {
    if (!board.make(move)) continue;
    nodes += depth === 1 ? 1 : perft(board, depth - 1);
    board.unmake();
  }
  return nodes;
}
