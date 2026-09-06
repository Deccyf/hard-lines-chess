// ── notation ───────────────────────────────────────────────────────────────
// SAN is written here rather than stored, because it depends on the position
// the move was played in — the disambiguation especially, which is the part
// everyone gets wrong by writing it from the move alone.
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
    // Disambiguate only against pieces of the same type that could legally go
    // to the same square. Anything else names a piece that was never a
    // candidate.
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

  // Check and mate are properties of the position AFTER the move, so they can
  // only be read by playing it.
  const copy = board;
  if (copy.make(move)) {
    const outcome = copy.outcome();
    if (outcome === 'checkmate') san += '#';
    else if (copy.inCheck()) san += '+';
    copy.unmake();
  }

  return san;
}

/**
 * A principal variation written as SAN, from the position it starts in.
 *
 * IT LIVES HERE, not with the screen that first needed it. This is the same
 * kind of thing toSan() is — notation written from a position — and it was in
 * app-d.js, which cannot be loaded without a DOM. tools/make-puzzles.mjs walks
 * games in node and needs exactly this, and reaching it meant either dragging
 * in a file full of getElementById or keeping a second copy that could drift.
 */
function lineToSan(board, moves) {
  const copy = new Board(board.fen());
  const out = [];
  for (const move of moves.slice(0, 6)) {
    if (!copy.legalMoves().includes(move)) break;
    const n = copy.turn === WHITE ? `${copy.fullmove}. ` : (out.length === 0 ? `${copy.fullmove}... ` : '');
    const san = toSan(copy, move);
    out.push(n + san);
    copy.make(move);
  }
  return out.join(' ');
}
