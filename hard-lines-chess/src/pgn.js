// ── reading a game somebody else recorded ─────────────────────────────────
//
// This is how a chess.com or Lichess game gets in. The page cannot call their
// servers — a published artifact may not make network requests — so the route
// is the PGN itself, which both sites put one click away.
//
// SAN is matched by GENERATING it, not by parsing it. Every legal move is
// written out with the same writer the move list uses, and the one whose text
// matches is the move. Parsing SAN by hand means reimplementing
// disambiguation, and getting that subtly wrong shows up as a game that reads
// in fine until the one position where two knights can reach a square.
const SAN_SHAPE = /^([KQRBN])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([QRBN]))?$/;
const PIECE_LETTER = { K: KING, Q: QUEEN, R: ROOK, B: BISHOP, N: KNIGHT };

function sanToMove(board, san) {
  // Zeros for castling ("0-0") are wrong by the standard and common in the wild.
  const wanted = san.replace(/[!?]+$/, '').replace(/[+#]$/, '').replace(/^0-0-0$/, 'O-O-O').replace(/^0-0$/, 'O-O');
  const legal = board.legalMoves();

  for (const move of legal) {
    if (toSan(board, move).replace(/[+#]$/, '') === wanted) return move;
  }

  // A second, looser pass, because real exports over-disambiguate. A PGN that
  // writes "Nbd2" where only one knight can reach d2 is not wrong exactly, but
  // the strict writer above produces "Nd2" and the two never match — and the
  // symptom is a game that imports fine until the one move where a program
  // somewhere decided to be explicit.
  if (wanted === 'O-O' || wanted === 'O-O-O') return null;

  const parts = SAN_SHAPE.exec(wanted);
  if (!parts) return null;

  const [, letter, fromFile, fromRank, target, promoLetter] = parts;
  const type = letter ? PIECE_LETTER[letter] : PAWN;
  const to = nameToSquare(target);
  const promo = promoLetter ? PIECE_LETTER[promoLetter] : 0;

  const matches = legal.filter((move) => {
    const from = moveFrom(move);
    if (moveTo(move) !== to) return false;
    if (typeOf(board.squares[from]) !== type) return false;
    if (promo && movePromo(move) !== promo) return false;
    if (!promo && movePromo(move) && type === PAWN) return false;
    if (fromFile && 'abcdefgh'[fileOf(from)] !== fromFile) return false;
    if (fromRank && String(rankOf(from) + 1) !== fromRank) return false;
    return true;
  });

  // Exactly one, or nothing. Guessing between two candidates would silently
  // import a different game from the one that was played.
  return matches.length === 1 ? matches[0] : null;
}

// A header is `[Tag "value"]` with the value able to hold an escaped quote
// or a bracket. Matched as a TOKEN rather than as a whole line: stripping
// every "[...]" from the text ate a value that contained a bracket, and then
// read the tail of the header as the first move; matching whole lines only
// broke the moment two headers shared a line, which many exports and every
// hand-typed test do.
const HEADER = /\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]/g;

function parsePgn(text) {
  const headers = {};
  const body0 = text.replace(HEADER, (whole, tag, value) => {
    headers[tag] = value.replace(/\\(["\\])/g, '$1');
    return ' ';
  });
  const movetext = [body0];

  // The movetext with comments, variations, move numbers and the result
  // stripped. Nested variations are removed innermost-first, which is why
  // this loops rather than replacing once.
  let body = movetext.join('\n').replace(/\{[^}]*\}/g, ' ');
  let previous;
  do { previous = body; body = body.replace(/\([^()]*\)/g, ' '); } while (body !== previous);
  body = body.replace(/\$\d+/g, ' ').replace(/\d+\.(\.\.)?/g, ' ');
  // "*" is a result too — an unfinished game — and "\b" never matched it
  // because a word boundary needs a letter on one side. Every unfinished
  // game read as "truncated at *".
  // The result token in the movetext counts as much as the header: a pasted
  // game often has no headers at all, and "*" on the end is the only thing
  // that says it was never finished.
  const bodyResult = /(?:^|\s)(1-0|0-1|1\/2-1\/2|\*)(?=\s|$)/.exec(body)?.[1] ?? null;
  body = body.replace(/(?:^|\s)(1-0|0-1|1\/2-1\/2|\*)(?=\s|$)/g, ' ');

  const tokens = body.split(/\s+/).filter(Boolean);

  // A FEN header is honoured whether or not SetUp is present: both sites
  // write SetUp, but a hand-edited file may not, and a game read from the
  // wrong starting position fails at move one with a message blaming the move.
  const start = headers.FEN ? headers.FEN.trim() : undefined;
  let board;
  try {
    board = new Board(start);
    if (start && (board.kings[WHITE] < 0 || board.kings[BLACK] < 0)) throw new Error('a king is missing');
  } catch (e) {
    throw new Error(`FEN header unreadable: ${e?.message ?? e}`);
  }
  const plies = [];
  let stoppedAt = null;

  for (const token of tokens) {
    const move = sanToMove(board, token);

    // A token the rules refuse ends the game here rather than taking the whole
    // import down. A partial game is still worth reviewing, and saying where it
    // stopped is more use than refusing the lot.
    if (!move) { stoppedAt = token; break; }

    plies.push({
      ply: plies.length + 1,
      san: toSan(board, move),
      uci: moveToUci(move),
      fenBefore: board.fen(),
      colour: board.turn === WHITE ? 'white' : 'black',
    });

    board.make(move);
  }

  return {
    headers,
    plies,
    truncated: plies.length < tokens.length,
    tokens: tokens.length,
    stoppedAt,
    startFen: start ?? null,
    // The result the headers claim: "*" is a game still going, which is not
    // the same thing as one that was cut short.
    result: headers.Result ?? bodyResult,
    unfinished: (headers.Result ?? bodyResult) === '*',
  };
}

/**
 * Which side the player was, from the headers and a name.
 * Returns 'white' | 'black' | null when the headers do not say.
 */
function sideOf(headers, name) {
  if (!name) return null;
  const want = name.trim().toLowerCase();
  if ((headers.White ?? '').toLowerCase() === want) return 'white';
  if ((headers.Black ?? '').toLowerCase() === want) return 'black';
  return null;
}

/**
 * Whether a FEN describes a position the engine can be asked about: a board
 * with one king each, and the side NOT to move not already in check (which
 * would mean the last move was illegal). Returns null when it is fine and the
 * reason when it is not — a reason, because "invalid FEN" sends someone to
 * count the slashes when the problem was a missing king.
 */
function fenProblem(fen) {
  if (typeof fen !== 'string' || !fen.trim()) return 'It is empty.';
  const parts = fen.trim().split(/\s+/);
  const rows = parts[0].split('/');
  if (rows.length !== 8) return `The board part has ${rows.length} ranks, not 8.`;
  for (const row of rows) {
    let width = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') width += +ch;
      else if ('pnbrqkPNBRQK'.includes(ch)) width += 1;
      else return `"${ch}" is not a piece or a number of empty squares.`;
    }
    if (width !== 8) return `The rank "${row}" is ${width} squares wide, not 8.`;
  }
  if (parts[1] && !['w', 'b'].includes(parts[1])) return `The side to move should be w or b, not "${parts[1]}".`;
  let board;
  try { board = new Board(fen); } catch (e) { return e?.message ?? String(e); }
  const kings = { w: 0, b: 0 };
  for (const p of board.squares) { if (p && typeOf(p) === KING) kings[colourOf(p) === WHITE ? 'w' : 'b']++; }
  if (kings.w !== 1 || kings.b !== 1) return `There should be one king each; this has ${kings.w} white and ${kings.b} black.`;
  const other = board.turn === WHITE ? BLACK : WHITE;
  if (board.inCheck(other)) return 'The side that just moved is in check, so the position could not have arisen.';
  // Castling rights the board cannot support are dropped by the Board; said
  // here rather than passed over, because a FEN that claims them is wrong and
  // the reader should know which piece is missing.
  if (board.dropped_castling) {
    const names = { [WK]: 'White castling kingside (no white king on e1 and rook on h1)', [WQ]: 'White castling queenside (no white king on e1 and rook on a1)', [BK]: 'Black castling kingside (no black king on e8 and rook on h8)', [BQ]: 'Black castling queenside (no black king on e8 and rook on a8)' };
    const gone = [WK, WQ, BK, BQ].filter((bit) => board.dropped_castling & bit).map((bit) => names[bit]);
    return `The castling field claims rights the pieces do not support: ${gone.join('; ')}. Remove them from the castling field.`;
  }
  return null;
}
