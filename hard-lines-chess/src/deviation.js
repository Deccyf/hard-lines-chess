// ── where your games leave your repertoire ─────────────────────────────────
//
// The app has had both halves of this since the openings went in and has
// never joined them: 25 verified lines with 79 branches on one side, and every
// game you have played or pasted, stored with its moves, on the other. Nothing
// asked the obvious question, which is whether the games are the lines.
//
// It is the question worth asking, too. Studying an opening you already play
// correctly is time spent on something that was not costing you anything. The
// move worth knowing is the one where you stopped following your own
// preparation — and you cannot remember it, because at the time you did not
// notice.
//
// WHOSE FAULT THE DIVERGENCE WAS, and the two are not the same problem.
//
//   'you'   — you played something the book does not. This is preparation you
//             have not learnt, and it is the list to work through.
//   'them'  — they played something the book has no answer written for. That
//             is a gap in the repertoire rather than a gap in you, and it is
//             counted separately and never called a mistake.
//
// AND WHAT IT COST IS MEASURED, NOT ASSERTED. The cost of a deviation is the
// difference between two searches: the position after the move you played and
// the position after the move the book plays, both scored from your side. A
// deviation that costs nothing is reported as costing nothing — leaving the
// book is not automatically an error, and a screen that implied it was would
// be teaching obedience rather than chess.

/** How many plies of a line must match before the deviation gets a name. */
const REPERTOIRE_MIN_MATCH = 2;

/**
 * Every line in the repertoire, main and branch alike, as one flat list.
 *
 * A variation's `line` is written from move one — it shares the first `at`
 * plies with its main line and then diverges — so a branch can be walked
 * exactly like a main line and nothing here needs to know which it is.
 */
function repertoireLines(openings) {
  const lines = [];
  for (const opening of openings) {
    lines.push({
      openingId: opening.id,
      name: opening.name,
      eco: opening.eco,
      side: opening.side,
      variation: null,
      line: opening.line,
    });
    for (const variation of opening.variations ?? []) {
      lines.push({
        openingId: opening.id,
        name: opening.name,
        eco: opening.eco,
        side: opening.side,
        variation: variation.name,
        line: variation.line,
      });
    }
  }
  return lines;
}

/** How many leading plies two move lists share. */
function sharedPlies(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Where one game left the repertoire.
 *
 * The line it is judged against is THE ONE IT FOLLOWED FURTHEST, which is the
 * only defensible answer to "which opening was this": nobody records what they
 * intended, and the moves are what there is. A game that matches two lines
 * equally far is judged against the first, and it does not matter — they agree
 * up to the point being reported.
 *
 * @param sans   the game's moves, as bare algebraic from move one
 * @param side   'white' or 'black' — which colour you had
 * @param openings the repertoire
 */
function findDeviation(sans, side, openings) {
  const mine = repertoireLines(openings).filter((l) => l.side === side);
  if (!mine.length || !sans.length) return { kind: 'no-repertoire' };

  let best = null;
  for (const entry of mine) {
    const matched = sharedPlies(sans, entry.line);
    if (!best || matched > best.matched) best = { ...entry, matched };
  }

  // The first ply that is not in the line. Whose move it is decides everything
  // else, and it is decided by the ply's parity rather than by anything stored:
  // ply 0 is always White's.
  const at = best.matched;
  const moverIsMine = (at % 2 === 0) === (side === 'white');

  // Followed to the end of the line — or as far as the game went.
  if (at >= sans.length) return { kind: 'followed', ...best, plies: sans.length };
  if (at >= best.line.length) return { kind: 'followed', ...best, plies: best.line.length };

  // NOTHING MATCHED AT ALL, so there is no opening to name. Naming one anyway
  // — "you left the Italian on move 1" for a game that opened 1.d4 — would be
  // an invented fact about a game nobody played.
  if (at === 0) {
    return moverIsMine
      ? { kind: 'never-entered', side, played: sans[0], firstMoves: [...new Set(mine.map((l) => l.line[0]))] }
      : { kind: 'they-avoided', side, played: sans[0], firstMoves: [...new Set(mine.map((l) => l.line[0]))] };
  }

  return {
    kind: moverIsMine ? 'you-left' : 'they-left',
    ...best,
    // One-based, the way a person counts and the way the rest of the app
    // prints plies.
    ply: at + 1,
    moveNumber: Math.floor(at / 2) + 1,
    played: sans[at],
    book: best.line[at],
    // Enough of the game to replay to the position, so the cost can be
    // measured later without storing a board.
    prefix: sans.slice(0, at),
    named: at >= REPERTOIRE_MIN_MATCH,
  };
}

/**
 * Every game's deviation, grouped so the same one seen four times is one row
 * saying four rather than four rows.
 *
 * `games` is [{ at, side, sans, label }]. A game from a set-up position has no
 * business here and is the caller's to leave out: a line that did not start at
 * move one cannot be compared with one that did.
 */
function collectDeviations(games, openings) {
  const rows = new Map();
  const counts = { games: 0, youLeft: 0, theyLeft: 0, followed: 0, neverEntered: 0, theyAvoided: 0 };

  for (const game of games) {
    if (!game.sans?.length) continue;
    counts.games++;
    const found = findDeviation(game.sans, game.side, openings);

    if (found.kind === 'followed') { counts.followed++; continue; }
    if (found.kind === 'never-entered') { counts.neverEntered++; continue; }
    if (found.kind === 'they-avoided') { counts.theyAvoided++; continue; }
    if (found.kind === 'no-repertoire') continue;
    if (found.kind === 'they-left') { counts.theyLeft++; continue; }

    counts.youLeft++;
    // Grouped by the position and the move, not by the game: the same mistake
    // in four games is one thing to learn.
    const key = `${found.openingId}|${found.ply}|${found.played}`;
    const row = rows.get(key) ?? {
      key,
      openingId: found.openingId,
      name: found.name,
      eco: found.eco,
      variation: found.variation,
      side: found.side,
      ply: found.ply,
      moveNumber: found.moveNumber,
      played: found.played,
      book: found.book,
      prefix: found.prefix,
      times: 0,
      games: [],
    };
    row.times++;
    row.games.push({ at: game.at, label: game.label });
    rows.set(key, row);
  }

  // The one you do most often, first; ties broken by the earlier move, because
  // an opening mistake on move three matters more than the same mistake on
  // move eleven.
  const list = [...rows.values()].sort((a, b) => b.times - a.times || a.ply - b.ply);
  return { rows: list, counts };
}

/**
 * What a deviation cost, in centipawns from your side.
 *
 * Two searches of equal depth: the position after your move, and the position
 * after the book's. Their difference is the whole claim, and it is a
 * measurement rather than an opinion about the opening.
 *
 * A POSITIVE NUMBER IS A LOSS. Zero or below means leaving the book cost you
 * nothing here, which happens and is reported as such.
 */
function measureDeviation(row, { Board, sanToMove, engine, movetime = 300, depth = 10 }) {
  const board = new Board();
  for (const san of row.prefix) {
    const move = sanToMove(board, san);
    if (!move) return null;
    board.make(move);
  }
  const fen = board.fen();

  const after = (san) => {
    const copy = new Board(fen);
    const move = sanToMove(copy, san);
    if (!move) return null;
    copy.make(move);
    const outcome = copy.outcome();
    if (outcome === 'checkmate') return -30000;   // the mover is mated: from OUR side, lost
    if (outcome) return 0;
    engine.reset();
    // The score comes back from the side to move, which after our move is
    // theirs, so it is negated onto our side.
    return -engine.search(copy, { movetime, maxDepth: depth }).score;
  };

  const yours = after(row.played);
  const book = after(row.book);
  if (yours === null || book === null) return null;
  return { yours, book, loss: book - yours, fen };
}
