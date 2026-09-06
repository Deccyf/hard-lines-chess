// ── notation ───────────────────────────────────────────────────────────────
// SAN is written here rather than stored, because it depends on the position
// the move was played in — the disambiguation especially, which is the part
// everyone gets wrong by writing it from the move alone.
function toSan(board, move) {
  const from = moveFrom(move), to = moveTo(move);
  const flags = moveFlags(move), promo = movePromo(move);
  const piece = board.squares[from];
  const type = typeOf(piece);


  const letters = { [KNIGHT]: 'N', [BISHOP]: 'B', [ROOK]: 'R', [QUEEN]: 'Q', [KING]: 'K' };
  const capture = (flags & FLAG_CAPTURE) !== 0;
  let san = '';

  // CASTLING STILL FALLS THROUGH TO THE CHECK MARK BELOW. It used to return
  // here, which meant a castling move that gave check was written "O-O" rather
  // than "O-O+" — everywhere: the move list, the review, an exported game. It
  // was found by tests/notation.test.mjs, which spells a million moves two
  // different ways and holds the two to each other; nothing else in the app
  // had a second opinion to disagree with.
  if (flags & FLAG_CASTLE) {
    san = to > from ? 'O-O' : 'O-O-O';
  } else if (type === PAWN) {
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

/**
 * A move, spelled out piece by piece, with the reason for each piece of it.
 *
 * WHY THIS EXISTS SEPARATELY FROM toSan(). The notation screen has to explain
 * why a move is written the way it is, and the honest way to do that is to
 * derive it from the position rather than to write prose beside it. So this
 * walks the same decisions toSan() walks and records them; the parts joined
 * back together are the SAN, and tests/notation.test.mjs holds them to exactly
 * what toSan() produces for a few thousand positions. If the two ever disagree
 * the explanation is wrong, and the test says so rather than the screen
 * quietly teaching somebody the wrong rule.
 */
function spellMove(board, move) {
  const from = moveFrom(move), to = moveTo(move);
  const flags = moveFlags(move), promo = movePromo(move);
  const piece = board.squares[from];
  const type = typeOf(piece);
  const capture = (flags & FLAG_CAPTURE) !== 0;
  const parts = [];
  const add = (text, label, why) => { if (text) parts.push({ text, label, why }); };

  if (flags & FLAG_CASTLE) {
    const short = to > from;
    add(short ? 'O-O' : 'O-O-O', 'castling',
      short
        ? 'Castling on the king’s side. Two letter O’s, because the king has two squares of rook behind it — nothing about the move is written down, not even which pieces moved.'
        : 'Castling on the queen’s side. Three letter O’s for the longer side. The king still moves two squares; it is the rook that travels further.');
  } else if (type === PAWN) {
    if (capture) {
      add('abcdefgh'[fileOf(from)], 'the file it came from',
        'A pawn has no letter, so a pawn capture is named by the file the pawn started on. It is the only thing there is to name it by.');
      add('x', 'takes',
        'The x means something was taken. It does not say what — the board already knows, and so will you when you play the move through.');
    }
    add(squareName(to), 'where it lands',
      flags & FLAG_EP
        ? 'The square the pawn LANDS on — which in an en passant capture is not the square the captured pawn was standing on. Notation records where the mover went, never where the victim was.'
        : capture
          ? 'The square the pawn lands on, which is also the square the captured piece was on.'
          : 'A move with no capital letter in front of it is a pawn move, and the square is where it went. Nothing says which pawn: only one pawn can legally reach a given square without capturing.');
    if (promo) {
      add('=' + { [QUEEN]: 'Q', [ROOK]: 'R', [BISHOP]: 'B', [KNIGHT]: 'N' }[promo], 'what it became',
        'A pawn reaching the last rank has to become something. The equals sign says what you chose — and you may choose a rook, a bishop or a knight instead of a queen.');
    }
  } else {
    const letters = { [KNIGHT]: 'N', [BISHOP]: 'B', [ROOK]: 'R', [QUEEN]: 'Q', [KING]: 'K' };
    const names = { [KNIGHT]: 'knight', [BISHOP]: 'bishop', [ROOK]: 'rook', [QUEEN]: 'queen', [KING]: 'king' };
    const introduce = {
      [KNIGHT]: 'N is the knight. K was already taken by the king, so the knight got the next letter that was free.',
      [KING]: 'K is the king. There is only ever one of them, so a king move never needs anything else in front of the square.',
      [QUEEN]: 'Q is the queen. The letter does not say whose queen — it is always the side to move, and the board tells you which side that is.',
      [ROOK]: 'R is the rook. Which of the two rooks moved is written down only when both of them could have gone to the same square.',
      [BISHOP]: 'B is the bishop. Which bishop is written down only when it would otherwise be ambiguous — and a pair of bishops are on opposite colours, so it almost never is.',
    };
    add(letters[type], 'which piece', introduce[type]);

    const rivals = board.legalMoves().filter((m) => m !== move
      && moveTo(m) === to
      && typeOf(board.squares[moveFrom(m)]) === type);
    if (rivals.length) {
      const where = rivals.map((m) => squareName(moveFrom(m))).join(' and ');
      const plural = rivals.length > 1;
      const sameFile = rivals.some((m) => fileOf(moveFrom(m)) === fileOf(from));
      const sameRank = rivals.some((m) => rankOf(moveFrom(m)) === rankOf(from));
      const need = `The ${names[type]} on ${where} could legally go there too, so "${letters[type]}${squareName(to)}" would not say which one moved.`;
      if (!sameFile) {
        add('abcdefgh'[fileOf(from)], 'which one',
          `${need} They are on different files, so the file it came from is enough.`);
      } else if (!sameRank) {
        add(String(rankOf(from) + 1), 'which one',
          `${need} ${plural ? 'They share' : 'It shares'} a file with this one, so the file would not separate them and the rank is written instead.`);
      } else {
        add(squareName(from), 'which one',
          `${need} File and rank each fail on their own here, so the whole square it came from is written out.`);
      }
    }
    if (capture) add('x', 'takes',
      'The x means something was taken. It does not say what — the board already knows, and so will you when you play the move through.');
    add(squareName(to), 'where it lands', 'The square the piece moved to. Notation records the destination, not the route.');
  }

  // Check and mate are properties of the position AFTER the move, so they can
  // only be read by playing it.
  if (board.make(move)) {
    const outcome = board.outcome();
    if (outcome === 'checkmate') {
      add('#', 'checkmate', 'The king is attacked and there is no legal move. The game is over — # is only ever written at the end.');
    } else if (board.inCheck()) {
      add('+', 'check', 'The move attacks the enemy king. The + is not part of the move; it is a fact about the position it left behind.');
    }
    board.unmake();
  }

  return { san: parts.map((p) => p.text).join(''), parts };
}
