// ── walking a game and finding what went wrong ─────────────────────────────
//
// ONE SEARCH PER POSITION, not two per move. The evaluation after your move is
// the same position as the evaluation before your opponent's, so walking every
// ply once gives both sides everything they need. A 60-ply game is 60 searches
// rather than 120.
//
// The comparison is between two INDEPENDENT searches, which has a known
// consequence worth stating: a move that was the engine's own choice can still
// come out with a small loss, because the two searches stopped at different
// depths. Those plies are scored zero rather than reported, because "the
// engine disagrees with itself by 20 centipawns" is not a mistake anybody made.
const SEVERITY = [
  { name: 'blunder', at: 300 },
  { name: 'mistake', at: 150 },
  { name: 'inaccuracy', at: 50 },
];

/**
 * At most one allowed mate and one missed mate per review, earliest of each.
 *
 * A forced mate scores at the ±10000 sentinel, so ANY move with a mate at
 * either end of the comparison costs more than any material error can, and
 * takes every slot in the list. Measured on a real corpus: six of six
 * write-ups were mate moments from two games, and one game had seven missed
 * mates that took every slot on its own.
 *
 * AND THE TWO KINDS ARE DIFFERENT. Allowing a mate is real, and about as
 * costly as the figure says. MISSING one leaves you still winning by eight
 * pawns — cp_before 10000, cp_after 971 — so its "ninety pawns lost" is
 * sentinel arithmetic and not a loss of anything.
 *
 * NEITHER KIND CAN BE IDENTIFIED FROM ITS COST, which is the trap here: an
 * allowed mate played from two pawns down costs 7900 and slips under any floor
 * high enough to leave real blunders alone, and a missed mate costs
 * 10000 - cp_after and arrives in the same range from the other direction.
 * Both are read off the KIND, which the sentinel makes an identity rather than
 * a threshold.
 *
 * What is dropped is COUNTED AND RETURNED, never dropped silently: "four other
 * moves also allowed a forced checkmate" is a sentence worth reading.
 */
function capMateMoments(mistakes) {
  const kept = [];
  const capped = { allowed_mate: 0, missed_mate: 0 };
  const seen = { allowed_mate: false, missed_mate: false };

  for (const m of mistakes) {
    if (m.kind === 'material') { kept.push(m); continue; }
    if (seen[m.kind]) { capped[m.kind]++; continue; }
    seen[m.kind] = true;
    kept.push(m);
  }
  return { kept, capped };
}

/**
 * An evaluation as a sentence rather than a signed decimal.
 *
 * "+8.13" made answers muddle up who was winning — the sign is doing all the
 * work and half the readers of a training app do not know which way it points.
 * Every figure that reaches a person goes through here.
 *
 * `cp` is from `mover`'s side. Mate distances are counted in MOVES, not plies.
 */
function plainEval(cp, mover) {
  const other = mover === 'White' ? 'Black' : 'White';
  if (cp === null || cp === undefined) return 'no score';
  // The sentinel itself is a mate that has HAPPENED, not one that is coming:
  // zero plies away is not "in 1 move", it is the end of the game.
  if (Math.abs(cp) >= CHECKMATE_SCORE) return `checkmate — ${cp < 0 ? mover : other} is checkmated`;
  if (Math.abs(cp) > MATE_EDGE) {
    const moves = Math.max(1, Math.ceil((30000 - Math.abs(cp)) / 2));
    return cp > 0
      ? `${mover} forces checkmate in ${moves} ${moves === 1 ? 'move' : 'moves'}`
      : `${other} forces checkmate in ${moves} ${moves === 1 ? 'move' : 'moves'}`;
  }
  const pawns = Math.abs(cp) / 100;
  const leader = cp < 0 ? other : mover;
  if (pawns < 0.5) return 'roughly equal';
  if (pawns < 1.5) return `${leader} is slightly better (about ${pawns.toFixed(1)} of a pawn)`;
  if (pawns < 3.0) return `${leader} is clearly better (about ${pawns.toFixed(1)} pawns ahead)`;
  return `${leader} is winning (about ${pawns.toFixed(1)} pawns ahead)`;
}

const severityFor = (loss) => SEVERITY.find((s) => loss >= s.at)?.name ?? null;

// Mate scores are not centipawns and a difference between them is not a number
// of pawns. A move that allows mate, or misses one, is reported as that rather
// than as arithmetic on the sentinel.
const MATE_EDGE = 29000;

// The engine's own sentinel: a mate N plies away scores CHECKMATE_SCORE - N,
// so the position in which the mate has already been delivered is exactly
// this, from the side that has been mated. Repeated here rather than read
// from the engine bundle so this file still loads on its own under test.
const CHECKMATE_SCORE = 30000;

/**
 * What a finished position is worth to the side to move. The engine cannot
 * be asked — it answers "no legal moves" with a score of zero — and zero is
 * right for a draw and wrong by the whole scale for a checkmate. The side to
 * move in a checkmated position is the side that has been mated.
 */
function scoreFinished(outcome) {
  return outcome === 'checkmate' ? -CHECKMATE_SCORE : 0;
}

/**
 * Fewer judged moves than this and there is no accuracy and no estimate. A
 * one-move game scored 100% and "1200 or above" once, because an empty sample
 * is a perfect one, and the figure was then saved and averaged into Progress.
 */
const MIN_JUDGED = 10;

/**
 * The rough accuracy and the mean loss from a walk's totals, or null for
 * both when there were too few of his moves to say anything.
 */
function accuracyFrom(lost, counted) {
  if (counted < MIN_JUDGED) return { accuracy: null, meanLoss: null };
  const meanLoss = lost / counted;
  return { accuracy: Math.max(0, Math.round(100 - (meanLoss / 3))), meanLoss };
}

function costOf(before, after) {
  const beforeMate = Math.abs(before) > MATE_EDGE;
  const afterMate = Math.abs(after) > MATE_EDGE;

  if (beforeMate && before > 0 && !(afterMate && after > 0)) {
    return { kind: 'missed_mate', loss: null, label: 'You had a forced mate and let it go.' };
  }
  if (!(beforeMate && before < 0) && afterMate && after < 0) {
    return { kind: 'allowed_mate', loss: null, label: 'This allowed a forced mate.' };
  }
  if (beforeMate || afterMate) {
    return { kind: 'material', loss: 0, label: null };
  }

  return { kind: 'material', loss: Math.max(0, before - after), label: null };
}

/**
 * Walk a parsed game. Calls `onProgress(done, total)` between plies so the page
 * can stay responsive; the caller yields to the browser, not this.
 *
 * @returns {Promise<{evals: number[], mistakes: object[], accuracy: number}>}
 */
/**
 * WHAT COUNTS AS A TACTIC, and why each gate is here.
 *
 * A tactic is a moment the OPPONENT went wrong and there was something to
 * take. It is not "the engine's favourite move" — asking someone to find a
 * quiet improvement in a balanced position is not a puzzle, it is an opinion
 * poll. So all four gates have to hold, and the last one costs a second
 * search:
 *
 *   theirLoss  — their move actually cost them something. Without this the
 *                list fills with positions that were always winning.
 *   yourEdge   — and the position afterwards is genuinely won for you, so
 *                there is a point to finding the move.
 *   alreadyWon — but you were NOT already winning by a mile before they
 *                erred. Punishing a blunder when you are a queen up teaches
 *                nothing; every game that ends in a rout would otherwise
 *                produce a dozen "tactics".
 *   gap        — and ONE move does it. This is the gate that needs the
 *                second search: the walk knows the best move but not whether
 *                the second-best is just as good, and "find the move" is
 *                unfair — and untrue — when three moves win equally.
 *
 * A position that fails the last gate is DROPPED, not softened. There is no
 * such thing as a puzzle with several right answers here.
 */
const TACTIC = {
  theirLoss: 200,     // centipawns their move gave away
  yourEdge: 200,      // how won the position is for you afterwards
  alreadyWon: 600,    // if you were this far ahead already, it is not a tactic
  gap: 100,           // how far clear the move must be of the next best
  perGame: 6,         // and only the biggest few, so one rout is not a course
};

async function reviewGame(parsed, side, { movetime = 180, depth = 8, onProgress = null, yieldEvery = 1, withTactics = true } = {}) {
  const engine = new Engine();
  const board = new Board(parsed.startFen ?? undefined);
  const positions = [];

  // Every position the game passed through, in order, with the FEN and whose
  // turn it was — collected first so the search loop is a flat walk.
  positions.push({ fen: board.fen(), turn: board.turn });
  for (const ply of parsed.plies) {
    const move = sanToMove(board, ply.san);
    if (!move) break;
    board.make(move);
    positions.push({ fen: board.fen(), turn: board.turn });
  }

  const evals = new Array(positions.length).fill(0);
  const best = new Array(positions.length).fill(null);

  for (let i = 0; i < positions.length; i++) {
    const at = new Board(positions[i].fen);
    const outcome = at.outcome();
    // A checkmated position is remembered as such: the ply that produced it
    // is the best move there is, whatever a search of the position before it
    // happened to list first.
    positions[i].mated = outcome === 'checkmate';
    if (outcome) { evals[i] = scoreFinished(outcome); best[i] = null; }
    else {
      engine.reset();
      const result = engine.search(at, { movetime, maxDepth: depth });
      evals[i] = result.score;
      // The LINE is kept as well as the move: a motif is demonstrated by the
      // punishing sequence, not by its first move, and re-searching for it
      // later would be a second opinion rather than the same one.
      best[i] = result.move
        ? { uci: moveToUci(result.move), san: toSan(at, result.move), line: (result.line ?? []).map(moveToUci) }
        : null;
    }

    if (onProgress) onProgress(i + 1, positions.length);
    if (yieldEvery && i % yieldEvery === 0) await new Promise((r) => setTimeout(r, 0));
  }

  const mistakes = [];
  const judged = [];
  let counted = 0;
  let lost = 0;

  // The evaluation from WHITE's side at each position, for an eval bar. A bar
  // that swapped ends every move would be showing whose turn it is, not who
  // is winning.
  const whiteCp = positions.map((p, i) => (p.turn === WHITE ? evals[i] : -evals[i]));

  for (let i = 0; i < parsed.plies.length; i++) {
    const ply = parsed.plies[i];
    if (i + 1 >= evals.length) break;

    // evals[i] is from the mover's side; evals[i+1] is from the opponent's, so
    // it is negated to bring both onto the same side of the board.
    const before = evals[i];
    const after = -evals[i + 1];
    const engineMove = best[i];

    // The engine's own choice is not a mistake, whatever two searches say.
    // Nor is a move that delivered checkmate: with two mates on the board the
    // search lists one of them, and the other used to be written up as "you
    // had a forced mate and let it go" on the move that ended the game.
    const mates = positions[i + 1].mated === true;
    const played = mates || Boolean(engineMove && engineMove.san.replace(/[+#]$/, '') === ply.san.replace(/[+#]$/, ''));
    const cost = played ? { kind: 'material', loss: 0, label: null } : costOf(before, after);
    const severity = cost.kind === 'material' ? severityFor(cost.loss ?? 0) : 'blunder';

    // EVERY move gets a class, both sides, so the move list can carry a glyph
    // on each one the way chess.com's does. "best" is the engine's own move;
    // "good" is anything that lost under half a pawn.
    judged.push({
      ply: ply.ply,
      moveNumber: Math.ceil(ply.ply / 2),
      san: ply.san,
      uci: ply.uci,
      colour: ply.colour,
      fen: ply.fenBefore,
      fenAfter: positions[i + 1].fen,
      best: engineMove,
      loss: cost.loss,
      kind: cost.kind,
      label: cost.label,
      cls: played ? 'best' : (cost.kind !== 'material' ? cost.kind : (severity ?? 'good')),
      mates,
      whiteCpAfter: whiteCp[i + 1],
      mine: ply.colour === side,
    });

    if (ply.colour !== side) continue;

    counted++;
    if (cost.loss !== null) lost += Math.min(300, cost.loss);

    if (!severity) continue;

    // WHAT KIND OF MISTAKE IT WAS, measured on the board rather than inferred
    // from its cost. Severity says how much it cost; this says what happened.
    const reply = best[i + 1];
    const motif = classifyMistake({
      fenBefore: ply.fenBefore,
      playedUci: ply.uci,
      bestUci: engineMove?.uci ?? null,
      replyUci: reply?.uci ?? null,
      replyLine: reply?.line ?? [],
      cpLoss: cost.loss,
      mate: cost.kind === 'allowed_mate' ? 'allowed' : (cost.kind === 'missed_mate' ? 'missed' : null),
    });

    mistakes.push({
      ply: ply.ply,
      themes: motif.themes,
      reason: motif.reason,
      moveNumber: Math.ceil(ply.ply / 2),
      san: ply.san,
      // Carried so a board can draw what was played beside what was wanted.
      // Without it there is a green arrow and nothing to compare it to, which
      // is exactly the half-answer this is meant to replace.
      uci: ply.uci,
      fen: ply.fenBefore,
      side,
      best: engineMove,
      loss: cost.loss,
      kind: cost.kind,
      label: cost.label,
      severity,
    });
  }

  // ── tactics: the moments THEY went wrong ───────────────────────────────
  //
  // Candidates come free from the walk above — the same two evaluations that
  // classify their move as a blunder say there was something to take. Only
  // the uniqueness check costs anything, and it is paid on a handful of
  // positions rather than on the whole game.
  const tactics = [];
  const candidates = [];
  // COUNTED, NOT QUIETLY DROPPED, AND COUNTED BY REASON. A candidate that is
  // not asked is a real moment their opponent went wrong that this app will
  // not ask about, and there are three different reasons, which one figure
  // used to word as if they were all the same one:
  //   capped       — beyond the per-game cap; real, unique or not, unchecked.
  //   notUnique    — checked, and a second move punished it about as well.
  //   singleReply  — he had only one legal move there, so there was nothing
  //                  to find.
  const passed = { capped: 0, notUnique: 0, singleReply: 0 };

  if (withTactics) {
    for (let i = 0; i < parsed.plies.length; i++) {
      const ply = parsed.plies[i];
      if (ply.colour === side) continue;          // their move
      if (i + 1 >= evals.length) break;
      if (!best[i + 1]) continue;

      // Both figures on YOUR side of the board, so a gain is a gain.
      const edgeBefore = -evals[i];
      const edgeAfter = evals[i + 1];

      const mateNow = edgeAfter > MATE_EDGE;
      const mateBefore = edgeBefore > MATE_EDGE;

      // A mate they walked into is always worth finding, and its "gain" is
      // not a number of pawns — the ±10000 sentinel is not arithmetic.
      if (mateNow) {
        if (!mateBefore) candidates.push({ i, gain: null, mate: true });
        continue;
      }
      if (Math.abs(edgeBefore) > MATE_EDGE || Math.abs(edgeAfter) > MATE_EDGE) continue;
      if (edgeBefore >= TACTIC.alreadyWon) continue;

      const gain = edgeAfter - edgeBefore;
      if (gain < TACTIC.theirLoss) continue;
      if (edgeAfter < TACTIC.yourEdge) continue;
      candidates.push({ i, gain, mate: false });
    }

    candidates.sort((a, b) => (Number(b.mate) - Number(a.mate)) || (b.gain - a.gain));
    const shortlist = candidates.slice(0, TACTIC.perGame);
    passed.capped += candidates.length - shortlist.length;

    for (let n = 0; n < shortlist.length; n++) {
      const c = shortlist[n];
      const at = new Board(positions[c.i + 1].fen);
      engine.reset();
      // Deeper and slower than the walk: this decides whether a position
      // becomes a puzzle at all, and a shallow search calls two moves equal
      // that are not, or vice versa.
      const check = engine.search(at, { movetime: Math.max(movetime, 600), maxDepth: depth + 2, lines: 2 });

      if (onProgress) onProgress(n + 1, shortlist.length, 'tactics');
      await new Promise((r) => setTimeout(r, 0));

      if (!check.move || check.lines.length < 2) { passed.singleReply++; continue; }
      const [top, second] = check.lines;
      const topMate = top.score > MATE_EDGE;
      const secondMate = second.score > MATE_EDGE;

      // Clearly best, or dropped. A mate that a second move also reaches is
      // not one move to find.
      const clear = topMate ? !secondMate : (!secondMate && top.score - second.score >= TACTIC.gap);
      if (!clear) { passed.notUnique++; continue; }
      if (!topMate && top.score < TACTIC.yourEdge) { passed.notUnique++; continue; }

      const san = toSan(at, top.move);
      const answered = parsed.plies[c.i + 1] ?? null;
      const bare = (text) => text.replace(/[+#]$/, '');
      // A reply that delivered checkmate found the tactic whichever mate the
      // deeper search happened to list; and a reply the PGN could not read is
      // not a reply he failed to make.
      const foundIt = answered ? (bare(answered.san) === bare(san) || positions[c.i + 2]?.mated === true) : null;
      const unreadable = !answered && parsed.truncated === true;

      tactics.push({
        fen: positions[c.i + 1].fen,
        side,
        ply: c.i + 2,
        moveNumber: Math.ceil((c.i + 2) / 2),
        theirMove: ply_san(parsed, c.i),
        best: { uci: moveToUci(top.move), san },
        line: lineToSan(at, top.line),
        mate: topMate ? Math.ceil((30000 - top.score) / 2) : null,
        edge: topMate ? null : top.score,
        margin: topMate ? null : top.score - second.score,
        // Whether he found it AT THE TIME. Null when the game ended on their
        // mistake and he never got the chance — which is not the same as
        // missing it, and is not reported as one.
        yourMove: answered ? answered.san : null,
        found: foundIt,
        // Null `found` has TWO causes and the screen must not word one as the
        // other: the game really ended here, or the pasted moves stopped being
        // readable at his reply and whether he played it is simply unknown.
        truncated: unreadable,
      });
    }
  }

  const { kept, capped } = capMateMoments(mistakes);
  mistakes.length = 0;
  mistakes.push(...kept);

  // A rough accuracy, and labelled as rough: it is the average centipawn loss
  // turned into a percentage, capped so one catastrophe does not swamp fifty
  // good moves. It is not Lichess's or chess.com's figure and does not claim
  // to be comparable with either. And it is NULL, not 100, when there were
  // fewer than MIN_JUDGED of his moves to average over.
  const { accuracy, meanLoss } = accuracyFrom(lost, counted);

  return { evals, mistakes, accuracy, counted, minJudged: MIN_JUDGED, judged, whiteCp, tactics, capped, tacticsPassed: passed, meanLoss, depth };
}


/** The SAN of ply `i`, or a dash — a game can be truncated under either. */
function ply_san(parsed, i) {
  return parsed.plies[i]?.san ?? '?';
}


// ── what a game says about strength ────────────────────────────────────────
//
// MEASURED, NOT INVENTED. Chess.com shows an estimated rating for a reviewed
// game; the temptation is to conjure one out of accuracy with a plausible
// constant. Instead the app's own bands played each other, every game was
// walked by this reviewer at each of its three depth settings, and the mean
// centipawn loss per band was recorded. `RATING_FIT` is the least-squares fit
// of ln(loss) against band Elo, per depth — injected at build time from that
// measurement, and absent when the measurement has not been made.
//
// WHAT IT INHERITS, and it is said wherever the figure is shown: the band
// labels are TARGETS, not ratings anyone earned. So this is an estimate
// calibrated against a ladder whose own numbers are aimed rather than
// measured. What it can honestly claim is ordering and rough scale — "this
// game looked like the 900 band" — and never "you are 900".
function estimateRating(meanLoss, depth) {
  if (typeof RATING_FIT === 'undefined' || !RATING_FIT?.fits) return null;
  const fit = RATING_FIT.fits[String(depth)];
  if (!fit || meanLoss === null || meanLoss === undefined) return null;
  // ln(loss) = m*elo + c  →  elo = (ln(loss) - c) / m. A loss of zero is a
  // perfect game and has no logarithm; it is pinned at a small floor.
  const loss = Math.max(3, meanLoss);
  const raw = (Math.log(loss) - fit.c) / fit.m;
  // THE BANDS THE CALIBRATION ACTUALLY PLAYED, not the ladder's. The ladder
  // is a hundred points wide and the measurement was taken every three
  // hundred, and a label like "900–1000" named a band nobody had measured.
  const bands = measuredBands();
  const lowest = bands[0];
  // The ceiling is where the measurement stopped telling bands apart. Above
  // it the honest answer is "at least this", not a number.
  const ceiling = RATING_FIT.ceilings?.[String(depth)] ?? bands[bands.length - 1];
  const floorHit = raw < lowest;
  const ceilingHit = raw >= ceiling;
  const elo = Math.round(Math.min(ceiling, Math.max(lowest, raw)) / 10) * 10;
  const index = Math.max(0, bands.findIndex((b, i) => elo < (bands[i + 1] ?? Infinity)));
  return {
    elo,
    clamped: floorHit || ceilingHit,
    floorHit,
    ceilingHit,
    ceiling,
    band: measuredBandLabel(index, bands),
    bandIndex: index,
    step: measuredStep(bands),
    // The ladder rung nearest the figure, for a button that starts a game —
    // the measured band is what was played like; this is what can be played.
    play: nearestPlayableBand(elo),
    r2: fit.r2,
    measured: RATING_FIT.measured,
  };
}

/** The lower bounds of the bands the calibration played, ascending. */
function measuredBands() {
  const own = typeof RATING_FIT !== 'undefined' && Array.isArray(RATING_FIT?.bands) && RATING_FIT.bands.length ? RATING_FIT.bands : null;
  return (own ?? BANDS.map((b) => b.elo)).slice().sort((a, b) => a - b);
}

/** How far apart the measured bands are — 300 for the calibration as run. */
function measuredStep(bands) {
  return bands.length > 1 ? bands[1] - bands[0] : 100;
}

/** "900–1200", or "2100+" for the top one, from the MEASURED bands. */
function measuredBandLabel(index, bands) {
  const lower = bands[index];
  const upper = bands[index + 1];
  return upper === undefined ? `${lower}+` : `${lower}–${upper}`;
}

/**
 * The ladder band nearest an estimate, as { index, label, elo }. The ladder
 * steps by a hundred and the estimate is a point figure, so this is the rung
 * whose range holds it, or the last rung when it is above all of them.
 */
function nearestPlayableBand(elo) {
  const bands = BANDS.map((b) => b.elo);
  const index = Math.max(0, bands.findIndex((b, i) => elo < (bands[i + 1] ?? Infinity)));
  return { index, elo: BANDS[index].elo, label: bandLabel(BANDS[index], index, BANDS) };
}
