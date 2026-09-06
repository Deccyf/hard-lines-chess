// Evaluation and search.
//
// The evaluation is material plus piece-square tables, TAPERED between a
// middlegame and an endgame set by how much material is left — without that,
// a king that should be marching to the centre in a pawn endgame sits on g1
// because the middlegame table told it to.

import {
  Board, EMPTY, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK,
  colourOf, typeOf, fileOf, rankOf, moveFrom, moveTo, movePromo, moveFlags,
  FLAG_CAPTURE, FLAG_EP, mkMove,
} from './core.js';

const MG_VALUE = { [PAWN]: 82, [KNIGHT]: 337, [BISHOP]: 365, [ROOK]: 477, [QUEEN]: 1025, [KING]: 0 };
const EG_VALUE = { [PAWN]: 94, [KNIGHT]: 281, [BISHOP]: 297, [ROOK]: 512, [QUEEN]: 936, [KING]: 0 };

// Phase weights: how much each piece counts towards "still a middlegame".
const PHASE = { [PAWN]: 0, [KNIGHT]: 1, [BISHOP]: 1, [ROOK]: 2, [QUEEN]: 4, [KING]: 0 };
const TOTAL_PHASE = 24;

// Tables are written from White's point of view, rank 1 first, and mirrored
// for Black at read time.
const MG_PAWN = [
   0,  0,  0,  0,  0,  0,  0,  0,
 -35, -1,-20,-23,-15, 24, 38,-22,
 -26, -4, -4,-10,  3,  3, 33,-12,
 -27, -2, -5, 12, 17,  6, 10,-25,
 -14, 13,  6, 21, 23, 12, 17,-23,
  -6,  7, 26, 31, 65, 56, 25,-20,
  98,134, 61, 95, 68,126, 34,-11,
   0,  0,  0,  0,  0,  0,  0,  0,
];
const EG_PAWN = [
   0,  0,  0,  0,  0,  0,  0,  0,
  13,  8,  8, 10, 13,  0,  2, -7,
   4,  7, -6,  1,  0, -5, -1, -8,
  13,  9, -3, -7, -7, -8,  3, -1,
  32, 24, 13,  5, -2,  4, 17, 17,
  94,100, 85, 67, 56, 53, 82, 84,
 178,173,158,134,147,132,165,187,
   0,  0,  0,  0,  0,  0,  0,  0,
];
const MG_KNIGHT = [
-105,-21,-58,-33,-17,-28,-19, -23,
 -29,-53,-12, -3, -1, 18,-14, -19,
 -23, -9, 12, 10, 19, 17, 25, -16,
 -13,  4, 16, 13, 28, 19, 21,  -8,
  -9, 17, 19, 53, 37, 69, 18,  22,
 -47, 60, 37, 65, 84,129, 73,  44,
 -73,-41, 72, 36, 23, 62,  7, -17,
-167,-89,-34,-49, 61,-97,-15,-107,
];
const EG_KNIGHT = [
 -29,-51,-23,-15,-22,-18,-50, -64,
 -42,-20,-10, -5, -2,-20,-23, -44,
 -23, -3, -1, 15, 10, -3,-20, -22,
 -18, -6, 16, 25, 16, 17,  4, -18,
 -17,  3, 22, 22, 22, 11,  8, -18,
 -24,-20, 10,  9, -1, -9,-19, -41,
 -25, -8,-25, -2, -9,-25,-24, -52,
 -58,-38,-13,-28,-31,-27,-63, -99,
];
const MG_BISHOP = [
 -33, -3,-14,-21,-13,-12,-39, -21,
   4, 15, 16,  0,  7, 21, 33,   1,
   0, 15, 15, 15, 14, 27, 18,  10,
  -6, 13, 13, 26, 34, 12, 10,   4,
  -4,  5, 19, 50, 37, 37,  7,  -2,
 -16, 37, 43, 40, 35, 50, 37,  -2,
 -26, 16,-18,-13, 30, 59, 18, -47,
 -29,  4,-82,-37,-25,-42,  7,  -8,
];
const EG_BISHOP = [
 -23, -9,-23, -5, -9,-16, -5, -17,
 -14,-18, -7, -1,  4, -9,-15, -27,
 -12, -3,  8, 10, 13,  3, -7, -15,
  -6,  3, 13, 19,  7, 10, -3,  -9,
  -3,  9, 12,  9, 14, 10,  3,   2,
   2, -8,  0, -1, -2,  6,  0,   4,
  -8, -4,  7,-12, -3,-13, -4, -14,
 -14,-21,-11, -8, -7, -9,-17, -24,
];
const MG_ROOK = [
 -19,-13,  1, 17, 16,  7,-37, -26,
 -44,-16,-20, -9, -1, 11, -6, -71,
 -45,-25,-16,-17,  3,  0, -5, -33,
 -36,-26,-12, -1,  9, -7,  6, -23,
 -24,-11,  7, 26, 24, 35, -8, -20,
  -5, 19, 26, 36, 17, 45, 61,  16,
  27, 32, 58, 62, 80, 67, 26,  44,
  32, 42, 32, 51, 63,  9, 31,  43,
];
const EG_ROOK = [
 -9,  2,  3, -1, -5,-13,  4,-20,
 -6, -6,  0,  2, -9, -9,-11, -3,
 -4,  0, -5, -1, -7,-12, -8,-16,
  3,  5,  8,  4, -5, -6, -8,-11,
  4,  3, 13,  1,  2,  1, -1,  2,
  7,  7,  7,  5,  4, -3, -5, -3,
 11, 13, 13, 11, -3,  3,  8,  3,
 13, 10, 18, 15, 12, 12,  8,  5,
];
const MG_QUEEN = [
  -1,-18, -9, 10,-15,-25,-31,-50,
 -35, -8, 11,  2,  8, 15, -3,  1,
 -14,  2,-11, -2, -5,  2, 14,  5,
  -9,-26, -9,-10, -2, -4,  3, -3,
 -27,-27,-16,-16, -1, 17, -2,  1,
 -13,-17,  7,  8, 29, 56, 47, 57,
 -24,-39, -5,  1,-16, 57, 28, 54,
 -28,  0, 29, 12, 59, 44, 43, 45,
];
const EG_QUEEN = [
 -33,-28,-22,-43, -5,-32,-20,-41,
 -22,-23,-30,-16,-16,-23,-36,-32,
 -16,-27, 15,  6,  9, 17, 10,  5,
 -18, 28, 19, 47, 31, 34, 39, 23,
   3, 22, 24, 45, 57, 40, 57, 36,
 -20,  6,  9, 49, 47, 35, 19,  9,
 -17, 20, 32, 41, 58, 25, 30,  0,
  -9, 22, 22, 27, 27, 19, 10, 20,
];
const MG_KING = [
 -15, 36, 12,-54,  8,-28, 24, 14,
   1,  7, -8,-64,-43,-16,  9,  8,
 -14,-14,-22,-46,-44,-30,-15,-27,
 -49, -1,-27,-39,-46,-44,-33,-51,
 -17,-20,-12,-27,-30,-25,-14,-36,
  -9, 24,  2,-16,-20,  6, 22,-22,
  29, -1,-20, -7, -8, -4,-38,-29,
 -65, 23, 16,-15,-56,-34,  2, 13,
];
const EG_KING = [
 -53,-34,-21,-11,-28,-14,-24,-43,
 -27,-11,  4, 13, 14,  4, -5,-17,
 -19, -3, 11, 21, 23, 16,  7, -9,
 -18, -4, 21, 24, 27, 23,  9,-11,
  -8, 22, 24, 27, 26, 33, 26,  3,
  10, 17, 23, 15, 20, 45, 44, 13,
 -12, 17, 14, 17, 17, 38, 23, 11,
 -74,-35,-18,-18,-11, 15,  4,-17,
];

const MG_TABLE = { [PAWN]: MG_PAWN, [KNIGHT]: MG_KNIGHT, [BISHOP]: MG_BISHOP, [ROOK]: MG_ROOK, [QUEEN]: MG_QUEEN, [KING]: MG_KING };
const EG_TABLE = { [PAWN]: EG_PAWN, [KNIGHT]: EG_KNIGHT, [BISHOP]: EG_BISHOP, [ROOK]: EG_ROOK, [QUEEN]: EG_QUEEN, [KING]: EG_KING };

export const MATE = 30000;
const MATE_THRESHOLD = MATE - 1000;

/** Score from the side to move's point of view. */
export function evaluate(board) {
  let mg = 0, eg = 0, phase = 0;
  const pawnFiles = { [WHITE]: new Int8Array(8), [BLACK]: new Int8Array(8) };
  let bishops = { [WHITE]: 0, [BLACK]: 0 };

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const piece = board.squares[sq];
    if (!piece) continue;

    const type = typeOf(piece), colour = colourOf(piece);
    const index = colour === WHITE ? (rankOf(sq) * 8 + fileOf(sq)) : ((7 - rankOf(sq)) * 8 + fileOf(sq));
    const sign = colour === WHITE ? 1 : -1;

    mg += sign * (MG_VALUE[type] + MG_TABLE[type][index]);
    eg += sign * (EG_VALUE[type] + EG_TABLE[type][index]);
    phase += PHASE[type];

    if (type === PAWN) pawnFiles[colour][fileOf(sq)]++;
    if (type === BISHOP) bishops[colour]++;
  }

  // The bishop pair, and doubled pawns. Two terms only: every extra term is a
  // weight nobody here has measured, and a wrong weight is worse than a
  // missing one.
  const pairBonus = (bishops[WHITE] >= 2 ? 30 : 0) - (bishops[BLACK] >= 2 ? 30 : 0);
  mg += pairBonus; eg += pairBonus;

  for (let file = 0; file < 8; file++) {
    if (pawnFiles[WHITE][file] > 1) { mg -= 12; eg -= 22; }
    if (pawnFiles[BLACK][file] > 1) { mg += 12; eg += 22; }
  }

  const p = Math.min(phase, TOTAL_PHASE);
  const score = ((mg * p) + (eg * (TOTAL_PHASE - p))) / TOTAL_PHASE;

  // Rounded once, from White's side, so the mirrored position scores the exact
  // negative — and rounded AWAY FROM ZERO rather than with Math.round, which
  // was the whole of the bug this comment used to describe without fixing.
  // Math.round sends a half towards +infinity: round(10.5) is 11 and
  // round(-10.5) is -10, so a position and its mirror scored 11 and 10. It
  // happened on 337 of 7166 positions walked — one centipawn every twenty
  // moves, always in White's favour, which is a colour bias in an engine whose
  // ladder is verified by self-play with the colours alternated. Held to zero
  // now by tests/eval-symmetry.test.mjs.
  const rounded = Math.sign(score) * Math.round(Math.abs(score));
  return board.turn === WHITE ? rounded : -rounded;
}

const TT_SIZE = 1 << 18;
const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

// Mate scores cross the table boundary as "plies from THIS node", not from the root.
const toTT = (score, ply) => score > MATE_THRESHOLD ? score + ply : (score < -MATE_THRESHOLD ? score - ply : score);
const fromTT = (score, ply) => score > MATE_THRESHOLD ? score - ply : (score < -MATE_THRESHOLD ? score + ply : score);

export class Engine {
  constructor() {
    this.tt = new Map();
    this.killers = [];
    this.history = new Int32Array(128 * 128);
    this.nodes = 0;
    this.stop = false;
    this.deadline = 0;
  }

  reset() {
    this.tt.clear();
    this.history.fill(0);
    this.killers = [];
  }

  /**
   * Iterative deepening under a wall-clock budget.
   *
   * Time, not depth, for the reason the server side budgets movetime: a depth
   * budget makes a sharp position cost fifteen seconds and a quiet one a
   * fraction of that, which is unplayable in exactly the positions worth
   * playing. Each completed depth's best move is kept, so the clock can stop
   * the search at any point and there is always an answer.
   */
  search(board, { movetime = 1000, maxDepth = 64, randomness = 0, blunder = 0, lines = 1 } = {}) {
    this.nodes = 0;
    this.stop = false;
    this.deadline = Date.now() + movetime;
    this.killers = Array.from({ length: maxDepth + 8 }, () => [0, 0]);

    let best = 0, bestScore = 0, bestLine = [], all = [], reached = 0;
    const rootMoves = board.legalMoves();
    if (rootMoves.length === 0) return { move: 0, score: 0, depth: 0, nodes: 0, line: [], lines: [] };
    best = rootMoves[0];

    // A BLUNDER IS DECIDED BEFORE THE SEARCH, not by degrading it.
    //
    // Below about 1000 the thing that separates two players is not how deeply
    // they calculate, it is how often they simply drop a piece — and no amount
    // of shallow searching reproduces that, because a one-ply search still
    // sees a hanging queen. So the weak bands hang pieces on purpose, at a
    // stated rate, and the search itself stays honest.
    //
    // The move is chosen uniformly from the legal ones, which is what makes it
    // a real blunder rather than a slightly worse move.
    if (blunder > 0 && Math.random() < blunder) {
      return {
        move: rootMoves[Math.floor(Math.random() * rootMoves.length)],
        score: 0,
        depth: 0,
        nodes: 0,
        line: [],
        lines: [],
        blundered: true,
      };
    }

    for (let depth = 1; depth <= maxDepth; depth++) {
      // More than one line wanted means every root move needs its TRUE score,
      // which costs the root its cutoffs — see searchRoot. Paid only when asked.
      const result = this.searchRoot(board, depth, rootMoves, randomness, lines > 1);
      if (this.stop && depth > 1) break;
      best = result.move;
      bestScore = result.score;
      bestLine = result.line;
      all = result.all;
      reached = depth;
      // A forced mate found: nothing deeper can improve on it.
      if (Math.abs(bestScore) > MATE_THRESHOLD) break;
      if (Date.now() > this.deadline) break;
    }

    return {
      move: best, score: bestScore, depth: reached, nodes: this.nodes, line: bestLine, blundered: false,
      lines: all.slice(0, Math.max(1, lines)),
    };
  }

  /**
   * The root, where the handicap lives.
   *
   * NOISE MUST NOT ENTER THE SEARCH. The obvious way to weaken an engine is to
   * jitter each root score as it comes back and keep the highest — and it is
   * wrong in a way that hides: raising alpha with a jittered score poisons the
   * window for every root move after it, so their true scores are never
   * learned, the reported evaluation is the noise rather than the position,
   * and the handicap is many times the size it claims. Measured here at 606
   * centipawns from a stated 90.
   *
   * So the search is clean and the handicap is SELECTION OVER ITS OUTPUT:
   * every root move is scored honestly, then one is chosen from those within
   * the stated margin of the best. The reported score is the real score of the
   * move actually played, which is what makes the readout on screen an
   * evaluation rather than a rumour.
   *
   * When there is no handicap, alpha is raised normally and the root gets its
   * cutoffs back — this only costs anything when it is actually being used.
   */
  searchRoot(board, depth, rootMoves, randomness, fullRoot = false) {
    const noisy = randomness > 0 || fullRoot;
    let alpha = -MATE;
    const beta = MATE;
    const scored = [];

    const ordered = this.order(board, rootMoves, 0, this.ttMove(board));

    for (const move of ordered) {
      if (!board.make(move)) continue;
      const line = [];
      const score = -this.negamax(board, depth - 1, -beta, -alpha, 1, line);
      board.unmake();

      if (this.stop) break;

      scored.push({ move, score, line: [move, ...line] });

      // Only a TRUE score ever moves the window, and only when no handicap is
      // in play — with one, every root move needs a full window or its score
      // is a bound rather than a number.
      if (!noisy && score > alpha) alpha = score;
    }

    if (scored.length === 0) {
      return { move: rootMoves[0], score: 0, line: [], all: [] };
    }

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    if (!noisy || randomness === 0) return { move: best.move, score: best.score, line: best.line, all: scored };

    // Never let a handicap throw away a forced mate or walk into one: at that
    // point the position is decided and "playing gently" would just be playing
    // badly at the only moment it is unmistakable.
    if (Math.abs(best.score) > MATE_THRESHOLD) {
      return { move: best.move, score: best.score, line: best.line, all: scored };
    }

    const eligible = scored.filter((entry) => entry.score >= best.score - randomness);
    const pick = eligible[Math.floor(Math.random() * eligible.length)];

    return { move: pick.move, score: pick.score, line: pick.line, all: scored };
  }

  /**
   * The entry for this position, or null. An entry is trusted only when its
   * second key matches: the table is keyed on 32 bits and collides every
   * search, and a colliding entry is another position's score.
   */
  ttProbe(board) {
    const entry = this.tt.get(board.hash);
    return entry && entry.check === board.hash2 ? entry : null;
  }

  ttMove(board) {
    const entry = this.ttProbe(board);
    return entry ? entry.move : 0;
  }

  negamax(board, depth, alpha, beta, ply, line) {
    if ((this.nodes & 2047) === 0 && Date.now() > this.deadline) this.stop = true;
    if (this.stop) return 0;
    this.nodes++;

    if (ply > 0 && (board.isRepetition() || board.halfmove >= 100 || board.insufficientMaterial())) {
      return 0;
    }

    const alphaOrig = alpha;
    const entry = this.ttProbe(board);
    if (entry && entry.depth >= depth && ply > 0) {
      // MATE SCORES ARE PLY-RELATIVE. One stored at ply 3 and read at ply 1
      // is two plies further from the root than it says, so it is stored as
      // "distance from this node" and converted back to "distance from the
      // root" here. Without that the same position scored 29997 fresh and
      // 29996 with a warm table.
      const score = fromTT(entry.score, ply);
      if (entry.flag === TT_EXACT) return score;
      if (entry.flag === TT_LOWER && score > alpha) alpha = score;
      if (entry.flag === TT_UPPER && score < beta) beta = score;
      if (alpha >= beta) return score;
    }

    if (depth <= 0) return this.quiesce(board, alpha, beta, ply);

    const inCheck = board.inCheck();
    // In check, search a ply deeper: the position is forced and stopping here
    // reads a forced sequence as a quiet one.
    if (inCheck) depth++;

    const moves = board.generate();
    const ordered = this.order(board, moves, ply, entry ? entry.move : 0);

    let best = -MATE, bestMove = 0, legal = 0;

    for (const move of ordered) {
      if (!board.make(move)) continue;
      legal++;

      const childLine = [];
      let score;
      // Late-move reduction: quiet moves late in a well-ordered list are
      // searched shallower first, and re-searched at full depth only if they
      // beat alpha. The re-search is what keeps it from losing anything.
      if (legal > 3 && depth >= 3 && !(moveFlags(move) & FLAG_CAPTURE) && !movePromo(move) && !inCheck) {
        score = -this.negamax(board, depth - 2, -alpha - 1, -alpha, ply + 1, childLine);
        if (score > alpha) {
          childLine.length = 0;
          score = -this.negamax(board, depth - 1, -beta, -alpha, ply + 1, childLine);
        }
      } else if (legal === 1) {
        score = -this.negamax(board, depth - 1, -beta, -alpha, ply + 1, childLine);
      } else {
        score = -this.negamax(board, depth - 1, -alpha - 1, -alpha, ply + 1, childLine);
        if (score > alpha && score < beta) {
          childLine.length = 0;
          score = -this.negamax(board, depth - 1, -beta, -alpha, ply + 1, childLine);
        }
      }

      board.unmake();
      if (this.stop) return 0;

      if (score > best) {
        best = score;
        bestMove = move;
        line.length = 0;
        line.push(move, ...childLine);
      }

      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (!(moveFlags(move) & FLAG_CAPTURE)) {
          // The check extension can carry ply past the table's length.
          const slot = this.killers[ply] ?? (this.killers[ply] = [0, 0]);
          if (slot[0] !== move) { slot[1] = slot[0]; slot[0] = move; }
          this.history[moveFrom(move) * 128 + moveTo(move)] += depth * depth;
        }
        break;
      }
    }

    if (legal === 0) {
      // Mate scores are relative to the ply they are found at, so a mate in
      // three always outranks a mate in five however deep the search went.
      return inCheck ? -MATE + ply : 0;
    }

    const flag = best <= alphaOrig ? TT_UPPER : (best >= beta ? TT_LOWER : TT_EXACT);
    if (this.tt.size > TT_SIZE) this.tt.clear();
    this.tt.set(board.hash, { depth, score: toTT(best, ply), flag, move: bestMove, check: board.hash2 });

    return best;
  }

  /**
   * Search on to a quiet position before evaluating.
   *
   * Without this the search stops mid-exchange and calls a position winning
   * because it counted the capture and not the recapture. It is the single
   * biggest difference between an engine that hangs pieces and one that does
   * not.
   */
  quiesce(board, alpha, beta, ply) {
    if ((this.nodes & 2047) === 0 && Date.now() > this.deadline) this.stop = true;
    if (this.stop) return 0;
    this.nodes++;

    const stand = evaluate(board);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;

    // A queen ahead and still losing is possible, but not by so much that a
    // capture sequence could recover it — so a node that cannot reach alpha
    // even after winning a queen is not worth searching.
    if (stand + 1000 < alpha) return alpha;

    const moves = this.order(board, board.generate(true), ply, 0);

    for (const move of moves) {
      if (!board.make(move)) continue;
      const score = -this.quiesce(board, -beta, -alpha, ply + 1);
      board.unmake();
      if (this.stop) return 0;
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }

    return alpha;
  }

  /**
   * Move ordering, which is worth more than any other single thing here: a
   * well-ordered list makes alpha-beta cut after one move instead of twenty,
   * and the same search reaches several plies deeper in the same time.
   */
  order(board, moves, ply, ttMove) {
    const scored = moves.map((move) => {
      let score = 0;
      const flags = moveFlags(move);

      if (move === ttMove) score = 1_000_000;
      else if (flags & FLAG_CAPTURE) {
        // Most Valuable Victim, Least Valuable Attacker: taking a queen with a
        // pawn is tried before taking a pawn with a queen.
        const victim = (flags & FLAG_EP) ? PAWN : typeOf(board.squares[moveTo(move)]);
        const attacker = typeOf(board.squares[moveFrom(move)]);
        score = 100_000 + MG_VALUE[victim] * 10 - MG_VALUE[attacker];
      } else if (movePromo(move)) score = 90_000 + MG_VALUE[movePromo(move)];
      else {
        const killers = this.killers[ply] ?? [0, 0];
        if (move === killers[0]) score = 80_000;
        else if (move === killers[1]) score = 79_000;
        else score = this.history[moveFrom(move) * 128 + moveTo(move)];
      }

      return { move, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.move);
  }
}
