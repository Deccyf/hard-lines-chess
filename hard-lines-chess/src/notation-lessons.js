// ── the notation lessons ───────────────────────────────────────────────────
//
// One rule each, one move each, and the move is played on a real board.
//
// NOTHING HERE STATES ITS OWN ANSWER. Each entry is a position and a move in
// coordinates; the notation beside it is written by the app's own toSan() at
// the moment it is shown, and the reason under each character is written by
// spellMove() from the same position. `san` below is what those two produced
// when the lesson was added, and tests/notation.test.mjs holds them to it — so
// a lesson whose claim stops being true fails the build rather than teaching
// somebody a rule the engine disagrees with.
//
// The last three are the part everyone gets wrong, and they are ordered by how
// often you meet them. Two knights that can both reach a square is common. Two
// rooks on the same file is less so. Three queens is a curiosity, and the
// lesson says as much rather than pretending it is worth memorising.

const NOTATION_LESSONS = [
  {
    id: 'pawn',
    name: 'A pawn move is just the square',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    uci: 'e2e4',
    san: 'e4',
    rule: 'A move with no capital letter in front of it is a pawn move. You never write which pawn, because only one pawn can reach a given square without capturing — so naming the square names the pawn.',
  },
  {
    id: 'piece',
    name: 'A piece move is its letter, then the square',
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    uci: 'g1f3',
    san: 'Nf3',
    rule: 'K for king, Q for queen, R for rook, B for bishop — and N for knight, because K was already taken. The letter says which kind of piece; the square says where it went. Nothing records where it came from unless it has to.',
  },
  {
    id: 'capture',
    name: 'Taking something is x',
    fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    uci: 'f3e5',
    san: 'Nxe5',
    rule: 'The x sits between the piece and the square. It does not say what was taken — the board already knows that, and so will you when you play the move through.',
  },
  {
    id: 'pawn-capture',
    name: 'A pawn taking names the file it came from',
    fen: 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2',
    uci: 'e4d5',
    san: 'exd5',
    rule: 'This is the one exception to "a pawn move is just the square". A pawn has no letter of its own, so when it captures, the file it started on goes in front — there is nothing else to name it by.',
  },
  {
    id: 'check',
    name: 'Check is +',
    fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1',
    uci: 'a1a8',
    san: 'Ra8+',
    rule: 'The + is not really part of the move. It is a note about the position the move leaves behind, which is why you can only write it after playing the move and looking.',
  },
  {
    id: 'mate',
    name: 'Checkmate is #',
    fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
    uci: 'a1a8',
    san: 'Ra8#',
    rule: 'Same idea as +, and the end of the game. Some books write ++ or "mate" instead; they all mean this. You will never see a move written after a #.',
  },
  {
    id: 'castle-short',
    name: 'Castling short is O-O',
    fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQK2R w KQkq - 0 6',
    uci: 'e1g1',
    san: 'O-O',
    rule: 'Two capital letter O’s, joined by a hyphen — not zeroes, though you will see zeroes written and nobody minds. It is the only move in chess whose notation names no square at all.',
  },
  {
    id: 'castle-long',
    name: 'Castling long is O-O-O',
    fen: 'r3kbnr/pppqpppp/2n5/3p1b2/3P1B2/2N5/PPPQPPPP/R3KBNR w KQkq - 6 6',
    uci: 'e1c1',
    san: 'O-O-O',
    rule: 'Three O’s for the longer side. The king still moves the same two squares either way; it is the rook that travels further, and the extra O is how you remember which.',
  },
  {
    id: 'promote',
    name: 'Promotion is = and what it became',
    fen: '8/4P3/8/8/8/8/8/4K2k w - - 0 1',
    uci: 'e7e8q',
    san: 'e8=Q',
    rule: 'A pawn that reaches the last rank must become something, and the equals sign says what. Some sources write e8Q or e8(Q) instead. All the same move.',
  },
  {
    id: 'underpromote',
    name: 'And it does not have to be a queen',
    fen: '8/4P3/8/8/8/8/8/4K2k w - - 0 1',
    uci: 'e7e8n',
    san: 'e8=N',
    rule: 'The same pawn, the same square, a different piece. Taking a knight instead of a queen is called underpromotion, and it is written exactly the same way — which is why the letter after the = is worth reading rather than assuming.',
  },
  {
    id: 'en-passant',
    name: 'En passant is written like any other pawn capture',
    fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
    uci: 'e5d6',
    san: 'exd6',
    rule: 'The square written down is the one the capturing pawn LANDS on — d6 — and not the square the captured pawn was standing on. Notation always records where the mover went. Some sources add "e.p." afterwards; it is optional and means nothing extra.',
  },
  {
    id: 'which-file',
    name: 'When two pieces could go there: the file',
    fen: '4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1',
    uci: 'b1d2',
    san: 'Nbd2',
    rule: 'Both knights can reach d2, so "Nd2" would not say which one moved. The file it came from is squeezed in after the letter. This is the common case, and it is the part of notation people misread most often.',
  },
  {
    id: 'which-rank',
    name: 'When the file does not separate them: the rank',
    fen: '4k3/8/8/R7/8/8/8/R3K3 w - - 0 1',
    uci: 'a1a3',
    san: 'R1a3',
    rule: 'Both rooks are on the a-file, so writing the file would not help. The rank goes in instead. The rule is simply: use the file if it tells them apart, otherwise the rank.',
  },
  {
    id: 'which-square',
    name: 'And when neither does: the whole square',
    fen: '8/4Q3/8/8/4Q2Q/8/8/k3K3 w - - 0 1',
    uci: 'e4h7',
    san: 'Qe4h7',
    rule: 'Three queens can reach h7. One shares a file with the mover and one shares a rank, so neither on its own says which — and the full square it came from is written out. You may go a long time without meeting this; it is here so that when you do, it is not a mystery.',
  },
];
