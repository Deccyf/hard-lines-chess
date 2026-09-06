// ── traps: setting a problem instead of correcting a mistake ───────────────
//
// The teaching opponent asks one question before the learner moves: is there a
// tempting move here that loses badly? If there is, it says so — "careful,
// something here is not what it looks like" — waits, and resolves afterwards.
//
// THE ORIGINAL MEASUREMENT, AND WHY THIS ONE IS DIFFERENT.
//
// The server-side version had a policy model (Maia) that gives every move a
// probability a human of a given strength would play it, and defined
//
//     trappiness = max over m where policy(m) >= floor of (eval(best) - eval(m))
//
// There is no policy model in a single-file browser app: Maia is a neural
// network and a weights file. So temptation has to be measured some other way,
// and the substitute has to be defensible rather than a guess about what
// "looks" good.
//
// THE SUBSTITUTE: A MOVE A SHALLOW SEARCH LIKES AND A DEEP SEARCH HATES.
//
// That is a measurement, not an opinion, and it is close to the thing being
// modelled. A beginner sees the capture, the check and the material grab, and
// does not see the reply two moves later. A one-ply search sees exactly the
// same things and misses exactly the same things. So:
//
//   1. Rank every legal move by a deliberately shallow search.
//   2. Shortlist the ones it ranks near its own best — what jumps out.
//   3. Score each shortlisted move with a deep search.
//   4. trappiness = MAX over the shortlist of deep(best) - deep(m).
//
// MAX, NEVER MEAN — the same reason the policy version was a max. The question
// is "is there a tempting move that loses badly", not "what happens to a
// player who picks at random from the plausible moves". A mean is answering a
// different question, and it answers it wrongly in the exact case that matters:
// one catastrophe among three harmless moves is a trap worth announcing, and a
// mean divides it by four until it falls under the floor and nothing is said.
//
// WHAT THIS CANNOT DO, STATED HERE RATHER THAN DISCOVERED LATER.
//
// A policy model knows that a move is popular for reasons that have nothing to
// do with a shallow evaluation: pattern, habit, opening memory, the shape of a
// move. A shallow search only knows material and piece-square tables, so it
// finds material traps well and positional ones not at all. It is a narrower
// instrument, honestly labelled — every figure it returns comes from a search
// that actually ran.

// ── the mate sentinel ──────────────────────────────────────────────────────
//
// The engine scores a mate near ±30000 and review.js reads anything past
// ±29000 as "not a number of centipawns, do not do arithmetic on it". The
// same sentinel is read here, but the answer is different because the question
// is: trappiness IS a subtraction, and a move that walks into mate has to come
// out of it as an enormous loss rather than as an unscored oddity, or the one
// case the whole feature exists for is the one case it cannot report.
//
// So a mate score is FLATTENED to a stated, finite figure — bigger than any
// material swing on a board, still on the centipawn scale — and every score is
// clamped to it, so a huge material evaluation can never outrank a mate.
const TRAP_MATE_EDGE = 29000;
const TRAP_MATE_FLAT = 3000;

function trapFlattenCp(score) {
  if (score > TRAP_MATE_EDGE) return TRAP_MATE_FLAT;
  if (score < -TRAP_MATE_EDGE) return -TRAP_MATE_FLAT;
  return Math.max(-TRAP_MATE_FLAT, Math.min(TRAP_MATE_FLAT, Math.round(score)));
}

// ── defaults, and why each one is what it is ───────────────────────────────
//
// Every figure here was measured on this engine in this browser bundle, on
// 2026-09-04. They are a snapshot: re-measure before trusting them elsewhere.
const TRAP_DEFAULTS = {
  // 1, not 2. Depth 2 already sees the recapture, and seeing the recapture is
  // precisely the faculty the learner is missing — at depth 2 a poisoned pawn
  // stops looking like a free pawn and the shortlist stops containing the
  // moves worth warning about. Measured on the Légal position: at depth 1 the
  // queen grab leads by 577cp, at depth 2 by 636cp but every quiet move has
  // collapsed with it, which is a different eye, not a beginner's.
  shallowDepth: 1,

  // How far below the shallow best a move can score and still count as one
  // that jumps out. A pawn and a half: wide enough that a second capture stays
  // on the list, narrow enough that quiet moves do not join a list headed by a
  // queen grab.
  shallowMargin: 150,

  // At most this many moves get a deep search, so the cost of a call has a
  // ceiling that does not depend on how many legal moves there are.
  shortlist: 3,

  // Deep enough to see the refutation of a shallow grab. Reached in practice
  // because these searches start one ply INTO the candidate move, where the
  // position is forcing and alpha-beta cuts hard.
  deepDepth: 8,

  // Per candidate search, and there are at most `1 + shortlist` of them — see
  // the budget note on findTrap.
  movetime: 150,

  // The root search gets its own, larger budget, because it is the one search
  // whose answer is SHOWN: the move the coach eventually reveals. Measured on
  // the Légal position (36 legal moves) on 2026-09-04: at 180ms it reaches
  // depth 4 and names the queen grab as its own best move — the trap, offered
  // as the answer — and at 300ms it reaches depth 5 and does not. 400ms buys
  // depth 5 to 6 there with room to spare on slower hardware. The invariant
  // below is what stops this figure being load-bearing.
  rootMovetime: 400,

  // Below this, nothing is said. Two thirds of a pawn is under a minor piece
  // on purpose: a trap that costs an exchange is worth a warning, and one that
  // costs 40cp is noise the learner cannot act on.
  floor: 200,

  // A position level within a pawn counts as "you were fine here", which
  // decides whether the problem reads as `trap` (don't throw this away) or
  // `opportunity` (there is something here to find).
  fineTolerance: 100,

  // ── the three gates ──────────────────────────────────────────────────
  // Opening moves are memorised rather than found, so a problem set inside
  // book is a problem about somebody else's preparation. Ten plies is five
  // moves each.
  openingPlies: 10,
  // Two to four problems in a whole game is the design. Constant interruption
  // destroys it, and a learner who is interrupted every third move stops
  // reading the interruption.
  spacing: 8,
  // A decided position has the largest swings in the game, so selecting by
  // size selects those first and teaches nothing — the answer to "what is the
  // trap here" when a queen up is "there is nothing left to lose".
  decided: 800,
};

/**
 * The shallow ranking: what jumps out.
 *
 * WHY THIS IS NOT `Engine.search(..., { maxDepth: 1 })`. The engine's search
 * drops into quiescence at the leaves, and quiescence is exactly the thing
 * that resolves a capture sequence before scoring it — it is the single
 * biggest reason that engine does not hang pieces. Run at depth 1 it still
 * sees the recapture, so a poisoned pawn never floats to the top and the
 * shortlist comes back empty of the only moves worth warning about.
 *
 * So the shallow eye is its own search: full width, no quiescence, no
 * ordering, static evaluation at the leaves. It is still a search that was
 * actually run, and it is deterministic — no clock, no transposition table,
 * so the same position and depth give the same ranking every time.
 *
 * @returns {{move:number, score:number}[]} best first
 */
function trapShallowNegamax(board, depth) {
  if (depth <= 0) return evaluate(board);

  let best = -MATE, legal = 0;
  for (const move of board.generate()) {
    if (!board.make(move)) continue;
    legal++;
    const score = -trapShallowNegamax(board, depth - 1);
    board.unmake();
    if (score > best) best = score;
  }

  if (legal === 0) return board.inCheck() ? -MATE : 0;
  return best;
}

function trapShallowRank(board, depth) {
  const ranked = [];

  for (const move of board.legalMoves()) {
    board.make(move);
    // Mate is not a static evaluation, and a beginner does see a mate in one —
    // it is the rules of the game, not a guess about what looks tempting. The
    // recursion below depth 1 never reaches this, so the root asks.
    const done = board.legalMoves().length === 0;
    const score = done
      ? (board.inCheck() ? MATE : 0)
      : -trapShallowNegamax(board, depth - 1);
    board.unmake();
    ranked.push({ move, score: trapFlattenCp(score) });
  }

  // Stable sort over a deterministic move list: ties keep generation order, so
  // the ranking — and therefore `temptation` — is reproducible.
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

/**
 * Deep-score ONE move, from the point of view of the side that plays it, and
 * bring back the reply that refutes it.
 *
 * Every candidate AND the engine's own best move go through this same
 * function, at the same depth and the same budget. That is deliberate:
 * review.js records what happens when two figures in one subtraction come from
 * two different searches — the engine disagrees with itself by 20 centipawns
 * and the difference is reported as a mistake somebody made. Here the
 * subtraction is the entire output, so both sides of it are measured the same
 * way.
 */
function trapScoreMove(engine, board, move, opts) {
  board.make(move);

  // Asking the engine about a finished position is an error, not a zero — it
  // answers `bestmove (none)`. So the game ending on this move is read from
  // the rules instead.
  const outcome = board.outcome();
  if (outcome) {
    const score = outcome === 'checkmate' ? TRAP_MATE_FLAT : 0;
    board.unmake();
    return { score, reply: null };
  }

  engine.reset();
  const reply = engine.search(board, {
    movetime: opts.movetime,
    // One ply is already spent on `move`, so the total from the root is
    // deepDepth either way.
    maxDepth: Math.max(1, opts.deepDepth - 1),
  });

  const result = {
    score: trapFlattenCp(-reply.score),
    reply: reply.move ? { uci: moveToUci(reply.move), san: toSan(board, reply.move) } : null,
  };

  board.unmake();
  return result;
}

/**
 * Is there a problem worth setting in this position?
 *
 * @param {Board} board  position with the learner to move
 * @param {object} options
 *   shallowDepth   depth of the "what jumps out" ranking (1 or 2)
 *   shallowMargin  centipawns below the shallow best that still counts as tempting
 *   shortlist      how many tempting moves get a deep search (the cost ceiling)
 *   deepDepth      depth of the search that decides what a move is really worth
 *   movetime       ms per candidate search
 *   rootMovetime   ms for the one search that finds the move to offer
 *   floor          minimum trappiness worth interrupting for
 *   decided        (used by trapGate, carried here so one options object serves both)
 *   engine         an Engine to reuse; one is made per call otherwise
 *
 * THE INVARIANT THE TWO SEARCHES SHARE. The root search and the candidate
 * searches are different searches at different budgets, and they can disagree:
 * measured on the Légal position, a 180ms root search names the queen grab as
 * its own best move while a candidate search on the same move finds the mate
 * that refutes it. Two perfectly good answers, contradicting each other on one
 * screen, with nothing reporting an error — so the disagreement is resolved
 * rather than trusted: THE MOVE OFFERED AS `bestMove` IS, BY THE CANDIDATE
 * MEASUREMENT, AT LEAST AS GOOD AS EVERY MOVE ON THE SHORTLIST. It is the
 * argmax over the candidate scores, not whatever the root search said, so
 * `deepLoss` is never negative and the coach can never announce a problem
 * whose answer is worse than the mistake.
 *
 * BUDGET. One root search plus at most `2 + shortlist` candidate searches: one
 * for the root's own move (free when that move is itself on the shortlist,
 * which is the common case in a quiet position), one per shortlisted move, and
 * one more only in the case below, where every tempting move turned out to be
 * the same move. At the defaults that is a ceiling of 400 + 5 × 150 = 1150ms.
 *
 * MEASURED 2026-09-04, node 22, seven positions × five calls: 3 to 5 searches
 * per call, median 862ms, worst 1045ms. The shallow ranking is 2.2ms of that
 * at depth 1 and 5.6ms at depth 2; the gate's static evaluation is under a
 * microsecond. A snapshot, like every measurement in a docblock here —
 * re-measure on the hardware it has to run on.
 *
 * @returns {null|{intent:string, expectedMistake:{uci,san}, bestMove:{uci,san},
 *                 refutation:{uci,san}|null, trappiness:number, temptation:number,
 *                 bestScore:number, shortlist:object[]}}
 */
function findTrap(board, options = {}) {
  const opts = { ...TRAP_DEFAULTS, ...options };

  if (board.outcome()) return null;

  const legal = board.legalMoves();
  // One legal move is not a problem, it is a formality: there is nothing to
  // be tempted away from.
  if (legal.length < 2) return null;

  const ranked = trapShallowRank(board, opts.shallowDepth);
  const cut = ranked[0].score - opts.shallowMargin;
  const tempting = [];
  for (let i = 0; i < ranked.length && tempting.length < opts.shortlist; i++) {
    if (ranked[i].score < cut) break;
    tempting.push({ move: ranked[i].move, rank: i + 1 });
  }

  const engine = opts.engine ?? new Engine();

  engine.reset();
  const top = engine.search(board, { movetime: opts.rootMovetime, maxDepth: opts.deepDepth });
  if (!top.move) return null;

  // Every move that gets a number gets it the same way — the root's own choice
  // included, so the subtraction has one measurement on both sides of it.
  const scored = new Map();
  const scoreOnce = (move) => {
    if (!scored.has(move)) scored.set(move, trapScoreMove(engine, board, move, opts));
    return scored.get(move);
  };

  scoreOnce(top.move);
  for (const entry of tempting) scoreOnce(entry.move);

  // The invariant, enforced rather than assumed: the move offered as the
  // answer is the best of everything measured. On a tie the root's own choice
  // keeps it, which is both deterministic and the right precedence — it is the
  // move that had the deepest look at the whole position.
  let bestMove = top.move;
  let bestDeep = scored.get(top.move);
  for (const entry of tempting) {
    const deep = scored.get(entry.move);
    if (deep.score > bestDeep.score) { bestMove = entry.move; bestDeep = deep; }
  }

  // WHEN EVERYTHING THAT JUMPS OUT IS THE SAME MOVE, LOOK AT ONE THAT DOES NOT.
  //
  // If every tempting move is the move being offered, there is nothing to warn
  // about — which is right when the tempting move is genuinely best (a free
  // queen is not a trap), and wrong in the case this feature exists for: a
  // shortlist of one, where the root search ran out of time and picked the
  // trap as well. Measured on the Légal position at a 180ms root budget, both
  // halves name the queen grab and the oldest trap in chess comes back as
  // "nothing here".
  //
  // So before concluding that, the best move the shallow search did NOT like
  // gets a candidate search too. It costs one search, only in this case, and
  // it is the whole point stated as a rule: the answer to "what jumps out is
  // wrong" is a move that does not jump out.
  if (tempting.every((entry) => entry.move === bestMove)) {
    const quiet = ranked.find((entry) => !tempting.some((t) => t.move === entry.move));
    if (quiet) {
      const deep = scoreOnce(quiet.move);
      if (deep.score > bestDeep.score) { bestMove = quiet.move; bestDeep = deep; }
    }
  }

  const shortlist = tempting.map((entry) => {
    const deep = scored.get(entry.move);
    return {
      uci: moveToUci(entry.move),
      san: toSan(board, entry.move),
      move: entry.move,
      rank: entry.rank,
      isBest: entry.move === bestMove,
      deepScore: deep.score,
      // What the move costs against the move being offered instead. Never
      // negative: the line above made the offered move the argmax.
      deepLoss: bestDeep.score - deep.score,
      refutation: deep.reply,
    };
  });

  // ── MAX, NOT MEAN ────────────────────────────────────────────────────
  // The question is "is there a tempting move that loses badly", so one
  // catastrophe among three harmless moves is the answer. A mean would divide
  // that catastrophe by the number of harmless moves standing next to it and
  // report nothing.
  //
  // THE ENGINE'S OWN MOVE IS NEVER THE PROBLEM. It is excluded by identity
  // rather than by score: a warning whose answer is "you should have played
  // the move you were about to play" is worse than no warning, and the
  // subtraction would score it at zero anyway only by accident.
  let worst = null;
  for (const entry of shortlist) {
    if (entry.isBest) continue;
    if (!worst || entry.deepLoss > worst.deepLoss) worst = entry;
  }

  if (!worst) return null;
  if (worst.deepLoss < opts.floor) return null;

  return {
    // `trap` — the position was already fine and the problem is not throwing
    // it away. `opportunity` — it was not, so there is something to find.
    intent: bestDeep.score >= -opts.fineTolerance ? 'trap' : 'opportunity',
    expectedMistake: { uci: worst.uci, san: worst.san },
    bestMove: { uci: moveToUci(bestMove), san: toSan(board, bestMove) },
    refutation: worst.refutation,
    trappiness: worst.deepLoss,
    // Rank 1 is the move the shallow search liked most.
    temptation: worst.rank,

    // ── below here is not part of the announcement ────────────────────
    // It is what makes the figure above checkable — by a test, and by anyone
    // reading a log and asking where 900 centipawns came from. A number with
    // no visible provenance is indistinguishable from one that was made up.
    bestScore: bestDeep.score,
    shortlist: shortlist.map((entry) => ({
      uci: entry.uci,
      san: entry.san,
      rank: entry.rank,
      isBest: entry.isBest,
      deepScore: entry.deepScore,
      deepLoss: entry.deepLoss,
    })),
  };
}

/**
 * The three gates, applied BEFORE any search happens.
 *
 * Searching is the expensive part of a move — the whole point of a gate is
 * that it costs nothing. So this runs first and findTrap runs only if it
 * passes.
 *
 * @param {Board} board
 * @param {number} plyNumber              plies played so far (0 at the first move)
 * @param {number|null} pliesSinceLastProblem  null when none has been set yet
 * @param {object} options  openingPlies, spacing, decided, and optionally
 *                          evalCp — an evaluation the caller already measured
 *
 * @returns {string|null}  null when nothing blocks and the search may run;
 *                         otherwise the reason it did not, in words, because a
 *                         quiet stretch is the mechanism working and the page
 *                         says so rather than looking broken.
 */
function trapGate(board, plyNumber, pliesSinceLastProblem, options = {}) {
  const opts = { ...TRAP_DEFAULTS, ...options };

  if (plyNumber < opts.openingPlies) {
    return `opening: ply ${plyNumber}, and no problems before ply ${opts.openingPlies} — opening moves are memorised, not found`;
  }

  if (pliesSinceLastProblem !== null && pliesSinceLastProblem !== undefined
    && pliesSinceLastProblem < opts.spacing) {
    return `spacing: ${pliesSinceLastProblem} plies since the last problem, and they are ${opts.spacing} apart at the closest`;
  }

  // The decided gate needs an evaluation, and a search is what this gate
  // exists to avoid — so it takes one the caller has already measured, and
  // falls back to the engine's own static evaluation, which costs a single
  // pass over the board. Flattened first, so a forced mate reads as decided
  // rather than as arithmetic on the sentinel.
  const cp = trapFlattenCp(options.evalCp ?? evaluate(board));
  if (Math.abs(cp) > opts.decided) {
    return `decided: ${cp}cp, past the ${opts.decided}cp mark — the biggest swings in a game are in positions nobody can still lose`;
  }

  return null;
}
