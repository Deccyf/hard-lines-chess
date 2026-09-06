// ── king and pawn against king, solved exactly ─────────────────────────────
//
// WHY THIS EXISTS, AND WHY THE ENGINE COULD NOT DO IT.
//
// The trainer's whole claim is that the engine is the source of truth. In king
// and pawn endings it is not. Asked about the textbook drawn opposition —
// white king e6, pawn e5, black king e8, white to move — the search calls it
// +10.3 for White, and playing it out it answered 1.Kf6 with 1...Kd7??, which
// loses on the spot. A trainer refereed by that would hand out wins in drawn
// positions and call bad technique good, which is worse than having no trainer:
// it teaches the opposite of the lesson.
//
// The reason is not depth. A search evaluates a position by counting material
// and adding positional terms, and no amount of either knows that a pawn one
// square from queening can be a draw. These endings are not estimated, they are
// SOLVED — and the whole space is small enough to solve outright.
//
// THE SPACE. White king (64) x black king (64) x white pawn on ranks 2-7 (48)
// x side to move (2) = 393,216 positions. Every one is either a win for White
// or a draw: Black has nothing but a king and can never win. One byte each
// holds the distance to the win in plies, with 255 for "drawn", and the whole
// table is 384KB — built once, in about a second, the first time an ending
// needs it.
//
// A BLACK PAWN IS A WHITE PAWN SEEN UPSIDE DOWN. Every lookup mirrors the
// board when the pawn is Black's, so only one colour is ever stored.

const TB_DRAW = 255;
const TB_UNKNOWN = 254;

/** wk(0-63) x bk(0-63) x pawn(rank 2-7, 48) x side to move. */
const TB_SIZE = 64 * 64 * 48 * 2;
const tbIndex = (wk, bk, pawnSq, blackToMove) =>
  (((wk * 64 + bk) * 48 + (pawnSq - 8)) * 2) + (blackToMove ? 1 : 0);

// 0-63 squares, not the 0x88 the rest of the engine uses. Inside this file a
// square is a file plus eight times a rank, because the table is indexed by it.
const sqFile = (s) => s & 7;
const sqRank = (s) => s >> 3;

/** The eight king moves from every square, precomputed. */
const KING_STEPS = (() => {
  const table = [];
  for (let s = 0; s < 64; s++) {
    const moves = [];
    const f = sqFile(s), r = sqRank(s);
    for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nf = f + df, nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) moves.push(nr * 8 + nf);
    }
    table.push(moves);
  }
  return table;
})();

const adjacent = (a, b) => Math.abs(sqFile(a) - sqFile(b)) <= 1 && Math.abs(sqRank(a) - sqRank(b)) <= 1;

/** The two squares a white pawn attacks. */
function pawnAttacks(pawnSq) {
  const f = sqFile(pawnSq), r = sqRank(pawnSq);
  const out = [];
  if (r < 7) {
    if (f > 0) out.push((r + 1) * 8 + (f - 1));
    if (f < 7) out.push((r + 1) * 8 + (f + 1));
  }
  return out;
}

/**
 * Is this a position that can occur? Kings never touch, nothing shares a
 * square, and the side NOT to move is never left in check — with one pawn on
 * the board that means White to move with the pawn already attacking the black
 * king is a position that could not have arisen.
 */
function legalPosition(wk, bk, pawnSq, blackToMove) {
  if (wk === bk || wk === pawnSq || bk === pawnSq) return false;
  if (adjacent(wk, bk)) return false;
  if (!blackToMove && pawnAttacks(pawnSq).includes(bk)) return false;
  return true;
}

/**
 * What a promotion is worth, without a queen-and-king table to look it up in.
 *
 * King and queen against king is won from every position but two, and both are
 * about the queen rather than the ending: Black to move can capture a queen
 * the white king does not defend, which leaves king against king; or Black has
 * no legal move at all and it is stalemate. Everything else is a win, which is
 * why this ending is the first one anybody is taught.
 */
function promotionWins(wk, bk, promoSq) {
  // The queen appears with Black to move.
  if (adjacent(bk, promoSq) && !adjacent(wk, promoSq)) return false;   // taken
  // Stalemate: every black king move is attacked, and the queen cannot be had.
  const attacked = (sq) => {
    if (adjacent(wk, sq)) return true;
    if (sqFile(sq) === sqFile(promoSq) || sqRank(sq) === sqRank(promoSq)) return true;
    if (Math.abs(sqFile(sq) - sqFile(promoSq)) === Math.abs(sqRank(sq) - sqRank(promoSq))) return true;
    return false;
  };
  const escapes = KING_STEPS[bk].filter((sq) => {
    if (sq === promoSq) return !adjacent(wk, promoSq);   // capturing the queen
    return sq !== wk && !attacked(sq);
  });
  if (escapes.length === 0 && !attacked(bk)) return false;             // stalemate
  return true;
}

/**
 * Every white move from a position, as the position it leads to. A move that
 * leaves the three-man space is answered here rather than followed: promoting
 * is a win or a draw by promotionWins(), and there is nothing else to reach.
 */
function whiteMoves(wk, bk, pawnSq) {
  const moves = [];
  for (const to of KING_STEPS[wk]) {
    if (to === pawnSq || adjacent(to, bk)) continue;
    moves.push({ wk: to, bk, pawnSq });
  }
  const up = pawnSq + 8;
  if (up !== wk && up !== bk) {
    if (sqRank(up) === 7) moves.push({ promotion: up });
    else {
      moves.push({ wk, bk, pawnSq: up });
      const up2 = pawnSq + 16;
      if (sqRank(pawnSq) === 1 && up2 !== wk && up2 !== bk) moves.push({ wk, bk, pawnSq: up2 });
    }
  }
  return moves;
}

/** Every black move. Taking the pawn leaves king against king — a draw. */
function blackMoves(wk, bk, pawnSq) {
  const moves = [];
  const attacks = pawnAttacks(pawnSq);
  for (const to of KING_STEPS[bk]) {
    if (adjacent(to, wk)) continue;
    if (to === pawnSq) { moves.push({ drawn: true }); continue; }   // the pawn goes
    if (attacks.includes(to)) continue;
    moves.push({ wk, bk: to, pawnSq });
  }
  return moves;
}

let TABLE = null;

/**
 * Backward induction over the whole space, one ply at a time.
 *
 * Pass zero marks the positions White wins at once by queening. Every pass
 * after it marks a white-to-move position won when ONE move reaches a won
 * position, and a black-to-move position lost when EVERY move does — the
 * ordinary minimax rule, run over the table instead of over a tree. When a
 * pass changes nothing, everything still unmarked is a draw, because a
 * position from which the win can never be forced is exactly what a draw is.
 */
export function buildPawnTable() {
  if (TABLE) return TABLE;
  const table = new Uint8Array(TB_SIZE).fill(TB_UNKNOWN);

  // ── ply 0 ────────────────────────────────────────────────────────────────
  for (let wk = 0; wk < 64; wk++) {
    for (let bk = 0; bk < 64; bk++) {
      for (let pawnSq = 8; pawnSq < 56; pawnSq++) {
        if (!legalPosition(wk, bk, pawnSq, false)) continue;
        for (const move of whiteMoves(wk, bk, pawnSq)) {
          if (move.promotion !== undefined && promotionWins(wk, bk, move.promotion)) {
            table[tbIndex(wk, bk, pawnSq, false)] = 1;
            break;
          }
        }
      }
    }
  }

  // ── and outwards ─────────────────────────────────────────────────────────
  for (let ply = 1; ply < 254; ply++) {
    let changed = false;

    // Black to move is lost when it has moves and all of them are lost.
    for (let wk = 0; wk < 64; wk++) {
      for (let bk = 0; bk < 64; bk++) {
        for (let pawnSq = 8; pawnSq < 56; pawnSq++) {
          const at = tbIndex(wk, bk, pawnSq, true);
          if (table[at] !== TB_UNKNOWN) continue;
          if (!legalPosition(wk, bk, pawnSq, true)) continue;
          const moves = blackMoves(wk, bk, pawnSq);
          if (!moves.length) continue;                       // stalemate: a draw
          let worst = 0;
          let allLost = true;
          for (const move of moves) {
            if (move.drawn) { allLost = false; break; }
            const value = table[tbIndex(move.wk, move.bk, move.pawnSq, false)];
            if (value === TB_UNKNOWN || value === TB_DRAW || value > ply) { allLost = false; break; }
            if (value > worst) worst = value;
          }
          if (allLost) { table[at] = worst + 1; changed = true; }
        }
      }
    }

    // White to move is won when any move reaches a won position.
    for (let wk = 0; wk < 64; wk++) {
      for (let bk = 0; bk < 64; bk++) {
        for (let pawnSq = 8; pawnSq < 56; pawnSq++) {
          const at = tbIndex(wk, bk, pawnSq, false);
          if (table[at] !== TB_UNKNOWN) continue;
          if (!legalPosition(wk, bk, pawnSq, false)) continue;
          let best = TB_UNKNOWN;
          for (const move of whiteMoves(wk, bk, pawnSq)) {
            if (move.promotion !== undefined) continue;      // handled at ply 0
            const value = table[tbIndex(move.wk, move.bk, move.pawnSq, true)];
            if (value !== TB_UNKNOWN && value !== TB_DRAW && value < best) best = value;
          }
          if (best !== TB_UNKNOWN && best <= ply) { table[at] = best + 1; changed = true; }
        }
      }
    }

    if (!changed) break;
  }

  for (let i = 0; i < table.length; i++) if (table[i] === TB_UNKNOWN) table[i] = TB_DRAW;
  TABLE = table;
  return table;
}

// ── reading a real board ───────────────────────────────────────────────────
//
// The rest of the app speaks 0x88 and piece codes; everything above speaks
// 0-63 with a white pawn. These two translate, mirroring the board when the
// pawn belongs to Black so that only one colour was ever solved.

const from0x88 = (sq) => (sq >> 4) * 8 + (sq & 7);
const mirror = (sq) => (7 - sqRank(sq)) * 8 + sqFile(sq);

/**
 * The three men on the board, or null when this is not that ending.
 * `flip` is true when the position was mirrored to make the pawn White's, in
 * which case a win in the table is a win for the player who owns the pawn.
 */
export function readPawnEnding(board) {
  let wk = -1, bk = -1, pawn = -1, pawnColour = 0, others = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const piece = board.squares[sq];
    if (!piece) continue;
    const type = piece & 7, colour = piece & 24;
    if (type === 6) { if (colour === 8) wk = from0x88(sq); else bk = from0x88(sq); continue; }
    if (type === 1 && pawn < 0) { pawn = from0x88(sq); pawnColour = colour; continue; }
    others++;
  }
  if (others || wk < 0 || bk < 0 || pawn < 0) return null;

  const flip = pawnColour === 16;
  const strongKing = flip ? mirror(bk) : wk;
  const weakKing = flip ? mirror(wk) : bk;
  const pawnSq = flip ? mirror(pawn) : pawn;
  if (sqRank(pawnSq) < 1 || sqRank(pawnSq) > 6) return null;
  // `board.turn` is WHITE (8) or BLACK (16); the strong side is whoever has
  // the pawn, so the mirror swaps who is to move as well as where they stand.
  const strongToMove = flip ? board.turn === 16 : board.turn === 8;
  return { strongKing, weakKing, pawnSq, strongToMove, flip, pawnColour };
}

/**
 * 'win' or 'draw' for the side with the pawn, and how far off the win is.
 * Null when the position is not king and pawn against king.
 */
export function probePawnEnding(board) {
  const men = readPawnEnding(board);
  if (!men) return null;
  const table = buildPawnTable();
  const value = table[tbIndex(men.strongKing, men.weakKing, men.pawnSq, !men.strongToMove)];
  return {
    result: value === TB_DRAW ? 'draw' : 'win',
    plies: value === TB_DRAW ? null : value,
    strongIsWhite: !men.flip,
    strongToMove: men.strongToMove,
  };
}

/**
 * The best move for whoever is to move, as a from/to pair in 0x88, or null.
 *
 * PERFECT MEANS PERFECT ON BOTH SIDES. The side with the pawn takes the
 * shortest win; the side without takes any draw, and where there is none, the
 * longest loss — which is what makes the defence worth playing against, since
 * a defender who gives up early never asks the question the lesson is about.
 */
export function bestPawnMove(board) {
  const men = readPawnEnding(board);
  if (!men) return null;
  const table = buildPawnTable();

  const to0x88 = (sq) => ((sq >> 3) << 4) | (sq & 7);
  const unmirrorSq = (sq) => (men.flip ? mirror(sq) : sq);

  if (men.strongToMove) {
    let best = null, bestPlies = Infinity;
    for (const move of whiteMoves(men.strongKing, men.weakKing, men.pawnSq)) {
      let plies;
      let from, to;
      if (move.promotion !== undefined) {
        if (!promotionWins(men.strongKing, men.weakKing, move.promotion)) continue;
        plies = 1;
        from = men.pawnSq; to = move.promotion;
      } else {
        const value = table[tbIndex(move.wk, move.bk, move.pawnSq, true)];
        plies = value === TB_DRAW ? Infinity : value + 1;
        from = move.wk !== men.strongKing ? men.strongKing : men.pawnSq;
        to = move.wk !== men.strongKing ? move.wk : move.pawnSq;
      }
      if (plies < bestPlies) { bestPlies = plies; best = { from, to }; }
    }
    // Every move draws: shuffle the king rather than push the pawn away.
    if (!best) {
      const moves = whiteMoves(men.strongKing, men.weakKing, men.pawnSq).filter((m) => m.promotion === undefined);
      if (!moves.length) return null;
      const move = moves[0];
      best = move.wk !== men.strongKing
        ? { from: men.strongKing, to: move.wk }
        : { from: men.pawnSq, to: move.pawnSq };
    }
    return { from: to0x88(unmirrorSq(best.from)), to: to0x88(unmirrorSq(best.to)) };
  }

  let best = null, bestPlies = -1;
  for (const move of blackMoves(men.strongKing, men.weakKing, men.pawnSq)) {
    if (move.drawn) {
      return { from: to0x88(unmirrorSq(men.weakKing)), to: to0x88(unmirrorSq(men.pawnSq)) };
    }
    const value = table[tbIndex(move.wk, move.bk, move.pawnSq, false)];
    const plies = value === TB_DRAW ? Infinity : value;
    if (plies > bestPlies) { bestPlies = plies; best = move; }
    if (plies === Infinity) break;
  }
  if (!best) return null;
  return { from: to0x88(unmirrorSq(men.weakKing)), to: to0x88(unmirrorSq(best.bk)) };
}
