// ── the fast paths, held to the rules they shortcut ────────────────────────
//
// Three places take a shortcut because the long way was costing whole seconds
// on a page that has to open instantly. None of them is allowed to change an
// answer, and "I read the code and it looks equivalent" is not a way of
// knowing that — so each is held to the thing it replaced.
//
//   sanToMove()           spells only the moves that could match the text,
//                         instead of every legal move in the position.
//   insufficientMaterial() stops at the third piece instead of counting them
//                         all into an array.
//   parsePgn(…, maxPlies) stops early, for callers that cannot see past a
//                         fixed depth anyway.
//   buildBook()           remembers what it read out of each game, and reads
//                         each one only as deep as the book goes.
//
// The check on toSan() lives in notation.test.mjs, which already spells every
// legal move of four hundred games two independent ways.
import { readFileSync } from 'node:fs';

const src = [
  readFileSync(new URL('../src/engine/bundle.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/notation.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/pgn.js', import.meta.url), 'utf8'),
].join('\n');
const withBook = [src, readFileSync(new URL('../src/app-g.js', import.meta.url), 'utf8')].join('\n');
// `App` is the only thing buildBook() reaches outside itself; the clock in the
// same file never runs here.
const App = { history: { games: [] }, reviews: { games: [] } };
const api = new Function('window', 'App', withBook + `; return { Board, toSan, sanToMove, parsePgn, moveToUci,
  moveFrom, moveTo, movePromo, typeOf, fileOf, rankOf, nameToSquare, PAWN, KNIGHT, BISHOP, ROOK,
  QUEEN, KING, WHITE, Book, BOOK_MAX_PLIES, buildBook };`)({}, App);
const { Board, toSan, sanToMove, parsePgn, moveToUci, moveFrom, moveTo, movePromo, typeOf,
  fileOf, rankOf, nameToSquare, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE,
  Book, BOOK_MAX_PLIES, buildBook } = api;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.log('  FAIL', name, extra); } };

// ── sanToMove: the narrowed search finds what the wide one found ───────────
//
// The wide one, word for word as it was: spell every legal move, take the one
// whose text matches. Anything the narrowed version returns has to be this.
function wideSanToMove(board, san) {
  const wanted = san.replace(/[!?]+$/, '').replace(/[+#]$/, '').replace(/^0-0-0$/, 'O-O-O').replace(/^0-0$/, 'O-O');
  const legal = board.legalMoves();
  for (const move of legal) {
    if (toSan(board, move).replace(/[+#]$/, '') === wanted) return move;
  }
  if (wanted === 'O-O' || wanted === 'O-O-O') return null;
  const parts = /^([KQRBN])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([QRBN]))?$/.exec(wanted);
  if (!parts) return null;
  const [, letter, fromFile, fromRank, target, promoLetter] = parts;
  const type = letter ? { K: KING, Q: QUEEN, R: ROOK, B: BISHOP, N: KNIGHT }[letter] : PAWN;
  const to = nameToSquare(target);
  const promo = promoLetter ? { K: KING, Q: QUEEN, R: ROOK, B: BISHOP, N: KNIGHT }[promoLetter] : 0;
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
  return matches.length === 1 ? matches[0] : null;
}

// A fixed seed, so a disagreement found here is one anybody can reproduce.
let seed = 20260927;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

let read = 0, positions = 0, disagreed = null;
const seen = { castle: 0, promo: 0, capture: 0, disambig: 0, check: 0, mate: 0 };
for (let game = 0; game < 24 && !disagreed; game++) {
  const board = new Board();
  for (let ply = 0; ply < 120; ply++) {
    const legal = board.legalMoves();
    if (!legal.length || board.outcome()) break;
    positions++;
    const fen = board.fen();
    for (const move of legal) {
      const text = toSan(new Board(fen), move);
      if (text.startsWith('O-O')) seen.castle++;
      if (text.includes('=')) seen.promo++;
      if (text.includes('x')) seen.capture++;
      if (text.endsWith('#')) seen.mate++; else if (text.endsWith('+')) seen.check++;
      if (/^[NBRQK][a-h1-8]/.test(text) && text.length > (text.includes('x') ? 4 : 3)) seen.disambig++;
      // Read the text back both ways. It has to be the move it was written from.
      const narrow = sanToMove(new Board(fen), text);
      const wide = wideSanToMove(new Board(fen), text);
      read++;
      if (narrow !== wide || narrow !== move) {
        disagreed = `${text} in ${fen}: narrow ${narrow === null ? 'null' : moveToUci(narrow)}, `
          + `wide ${wide === null ? 'null' : moveToUci(wide)}, written from ${moveToUci(move)}`;
        break;
      }
    }
    if (disagreed) break;
    board.make(legal[Math.floor(rand() * legal.length)]);
  }
}
ok('every move written reads back as itself, narrowed or not', disagreed === null, disagreed ?? '');
// A SAMPLE THAT NEVER MET THE HARD CASES WOULD PASS AND PROVE NOTHING.
ok('the walk met castling', seen.castle > 10, `saw ${seen.castle}`);
ok('the walk met promotions', seen.promo > 10, `saw ${seen.promo}`);
ok('the walk met captures', seen.capture > 500, `saw ${seen.capture}`);
ok('the walk met disambiguation', seen.disambig > 100, `saw ${seen.disambig}`);
ok('the walk met checks', seen.check > 100, `saw ${seen.check}`);
ok('the walk met mates', seen.mate > 2, `saw ${seen.mate}`);

// ── and the sloppy text real exports actually contain ──────────────────────
//
// The narrowing reads the destination square out of the text, so anything with
// no square in it to read has to go through untouched.
const AWKWARD = [
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e4', 'Nf3', 'Ng1f3', 'Nbc3', 'b1c3', 'h3', 'e4!?', 'Nf3?!', 'zz', '', 'O-O']],
  ['r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 1', ['O-O', '0-0', 'O-O-O', '0-0-0', 'Nbd2', 'Nfd2', 'Nd2', 'Ng5', 'Bxf7+', 'Bb5!?']],
  ['4k3/1P6/8/8/8/8/8/4K3 w - - 0 1', ['b8=Q', 'b8Q', 'b8=N+', 'b8N', 'b8=R', 'b8']],
  ['8/8/8/3pP3/8/8/8/K3k3 w - d6 0 1', ['exd6', 'e6', 'exd', 'd6', 'exd6 e.p.']],
  ['R6R/8/8/8/8/8/8/K3k3 w - - 0 1', ['Rad8', 'Rhd8', 'Rd8', 'R8d8', 'Ra1', 'Rab8', 'Rh2']],
  ['8/8/8/8/8/8/8/RK1k4 w - - 0 1', ['Ra2', 'Rc1+', 'Kb2', 'Ra1a2']],
  ['4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1', ['Nbd2', 'Nfd2', 'Nd2', 'N1d2', 'N3d2', 'Nb1d2']],
];
let awkward = 0, awkwardBad = null;
for (const [fen, texts] of AWKWARD) {
  for (const text of texts) {
    const narrow = sanToMove(new Board(fen), text);
    const wide = wideSanToMove(new Board(fen), text);
    awkward++;
    if (narrow !== wide) {
      awkwardBad = `"${text}" in ${fen}: narrowed ${narrow === null ? 'null' : moveToUci(narrow)}, `
        + `wide ${wide === null ? 'null' : moveToUci(wide)}`;
    }
  }
}
ok(`${awkward} over-disambiguated and malformed spellings read the same either way`, awkwardBad === null, awkwardBad ?? '');

// ── insufficientMaterial: stopping at three says what counting all of them said ──
function wideInsufficient(board) {
  const pieces = [];
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const p = board.squares[sq];
    if (p && typeOf(p) !== KING) pieces.push({ type: typeOf(p), sq });
  }
  if (pieces.length === 0) return true;
  if (pieces.length === 1) return pieces[0].type === BISHOP || pieces[0].type === KNIGHT;
  if (pieces.length === 2 && pieces.every((p) => p.type === BISHOP)) {
    const light = (p) => (fileOf(p.sq) + rankOf(p.sq)) & 1;
    return light(pieces[0]) === light(pieces[1]);
  }
  return false;
}

const CHAR = { [PAWN]: 'p', [KNIGHT]: 'n', [BISHOP]: 'b', [ROOK]: 'r', [QUEEN]: 'q' };
const free = [];
for (let sq = 0; sq < 128; sq++) if (!(sq & 0x88) && sq !== 0x00 && sq !== 0x77) free.push(sq);
const fenOf = (placed) => {
  const rows = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '', empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = placed.get((rank << 4) | file);
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += p;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} w - - 0 1`;
};
const base = () => new Map([[0x00, 'K'], [0x77, 'k']]);
let endings = 0, materialBad = null;
const tryOne = (placed) => {
  let board;
  try { board = new Board(fenOf(placed)); } catch { return; }
  if (board.kings[WHITE] < 0) return;
  endings++;
  if (wideInsufficient(board) !== board.insufficientMaterial()) {
    materialBad = `${fenOf(placed)}: counting all says ${wideInsufficient(board)}, stopping at three says ${board.insufficientMaterial()}`;
  }
};
tryOne(base());
// EVERY one-piece ending: each piece, each colour, each square.
for (const sq of free) {
  for (const type of [PAWN, KNIGHT, BISHOP, ROOK, QUEEN]) {
    for (const white of [true, false]) {
      const p = base();
      p.set(sq, white ? CHAR[type].toUpperCase() : CHAR[type]);
      tryOne(p);
    }
  }
}
const one = endings;
// And two-piece endings, where the two-bishops-on-one-colour rule lives.
for (let i = 0; i < free.length; i += 3) {
  for (let j = i + 1; j < free.length; j += 5) {
    for (const t1 of [KNIGHT, BISHOP, ROOK, PAWN]) {
      for (const t2 of [KNIGHT, BISHOP, QUEEN]) {
        const p = base();
        p.set(free[i], CHAR[t1].toUpperCase());
        p.set(free[j], CHAR[t2]);
        tryOne(p);
      }
    }
  }
}
ok(`${one} one-piece and ${endings - one} two-piece endings agree`, materialBad === null, materialBad ?? '');

// And crowded positions, where the shortcut returns on the third piece.
let crowded = 0, crowdedBad = null;
for (let game = 0; game < 12; game++) {
  const board = new Board();
  for (let ply = 0; ply < 200; ply++) {
    const legal = board.legalMoves();
    if (!legal.length) break;
    crowded++;
    if (wideInsufficient(board) !== board.insufficientMaterial()) { crowdedBad = board.fen(); break; }
    board.make(legal[Math.floor(rand() * legal.length)]);
  }
  if (crowdedBad) break;
}
ok(`${crowded} positions from play agree`, crowdedBad === null, crowdedBad ?? '');

// ── parsePgn's ply limit reads the same moves, and stops ───────────────────
const GAME = `[Event "Test"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 `
  + `6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. Nbd2 Bb7 12. Bc2 Re8 1-0`;
const full = parsePgn(GAME);
ok('the whole game reads', full.plies.length === 24 && !full.truncated, `${full.plies.length} plies`);
for (const limit of [0, 1, 2, 7, 16, 23, 24, 25, 100]) {
  const cut = parsePgn(GAME, { maxPlies: limit });
  const want = Math.min(limit, full.plies.length);
  ok(`a limit of ${limit} reads ${want} plies`, cut.plies.length === want, `read ${cut.plies.length}`);
  ok(`and they are the same ${want} plies`,
    cut.plies.every((p, i) => p.san === full.plies[i].san && p.uci === full.plies[i].uci && p.fenBefore === full.plies[i].fenBefore));
  // A LIMIT IS NOT A TRUNCATION. Stopping where the caller asked is not the
  // same as the rules refusing a move, and the flag that says "this game could
  // not be read" must not start saying "you asked for less".
  ok(`a limit of ${limit} is not reported as truncated`, cut.truncated === false && cut.stoppedAt === null);
  ok(`and the headers still read`, cut.headers.Result === '1-0' && cut.result === '1-0');
}
// A game the rules DO refuse still says so, wherever the limit is — as long as
// the limit does not stop the read before the bad move. Four legal plies, then
// a token no rules allow.
const BROKEN = '[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 3. Qz9 *';
for (const opts of [undefined, { maxPlies: 100 }, { maxPlies: 5 }]) {
  const cut = parsePgn(BROKEN, opts);
  ok(`an illegal move is still a truncation${opts ? ` under a limit of ${opts.maxPlies}` : ''}`,
    cut.truncated === true && cut.stoppedAt === 'Qz9', `truncated ${cut.truncated}, stopped at ${cut.stoppedAt}`);
}
// And where the limit stops first, there is nothing to report: the caller got
// what it asked for and the game was never read far enough to be refused.
for (const limit of [3, 4]) {
  const early = parsePgn(BROKEN, { maxPlies: limit });
  ok(`a limit of ${limit} stops before the bad move and reports no truncation`,
    early.plies.length === limit && early.truncated === false && early.stoppedAt === null,
    `read ${early.plies.length}, truncated ${early.truncated}`);
}

// ── the opening book: remembering what it read says what re-reading said ───
//
// The builder as it was: every game read whole, every rebuild from scratch.
function wideBuildBook(App) {
  const book = {};
  let games = 0, skipped = 0;
  const sources = [];
  for (const g of App.history.games) if (g.pgn) sources.push({ pgn: g.pgn, mine: g.colour, from: g.from ?? null });
  for (const r of App.reviews.games) if (r.pgn) sources.push({ pgn: r.pgn, mine: r.side, from: null });
  for (const source of sources) {
    let parsed;
    try { parsed = parsePgn(source.pgn); } catch { continue; }
    if (!parsed.plies.length) continue;
    if (source.from || parsed.startFen) { skipped++; continue; }
    games++;
    const theirs = source.mine === 'white' ? 'black' : 'white';
    const history = [];
    for (const ply of parsed.plies.slice(0, BOOK_MAX_PLIES)) {
      if (ply.colour === theirs) {
        const key = history.join(' ');
        book[key] ??= {};
        book[key][ply.uci] = (book[key][ply.uci] ?? 0) + 1;
      }
      history.push(ply.uci);
    }
  }
  return { book, games, skipped, replies: Object.values(book).reduce((n, m) => n + Object.keys(m).length, 0) };
}

const HEAD = '[Event "T"]\n[White "you"]\n[Black "opp"]\n[Result "1-0"]\n\n';
const RUY = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 1-0';
const QGD = '1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 1-0';
const HISTORIES = [
  ['nothing stored', { history: [], reviews: [] }],
  ['one game as white', { history: [], reviews: [{ at: 1, side: 'white', pgn: HEAD + RUY }] }],
  ['the same game as black', { history: [], reviews: [{ at: 2, side: 'black', pgn: HEAD + RUY }] }],
  ['two of the same opening', { history: [], reviews: [
    { at: 3, side: 'white', pgn: HEAD + RUY }, { at: 4, side: 'white', pgn: HEAD + RUY }] }],
  ['two different openings', { history: [], reviews: [
    { at: 5, side: 'white', pgn: HEAD + RUY }, { at: 6, side: 'black', pgn: HEAD + QGD }] }],
  ['a game shorter than the book', { history: [], reviews: [{ at: 7, side: 'white', pgn: HEAD + '1. e4 e5 2. Nf3 1-0' }] }],
  ['a game with no moves', { history: [], reviews: [{ at: 8, side: 'white', pgn: HEAD + '1-0' }] }],
  ['an illegal move partway', { history: [], reviews: [{ at: 9, side: 'white', pgn: HEAD + '1. e4 e5 2. Qz9 1-0' }] }],
  ['from a set-up position', { history: [], reviews: [{ at: 10, side: 'white',
    pgn: '[FEN "8/8/8/8/8/8/R7/K6k w - - 0 1"]\n[SetUp "1"]\n\n1. Ra8+ Kg2 1-0' }] }],
  ['a played game from a set-up position', { history: [{ at: 11, colour: 'white',
    from: '8/8/8/8/8/8/1P6/K6k w - - 0 1', pgn: '1. b4 Kg2' }], reviews: [] }],
  ['no side recorded', { history: [], reviews: [{ at: 12, side: undefined, pgn: HEAD + RUY }] }],
  ['no timestamp', { history: [], reviews: [{ side: 'white', pgn: HEAD + RUY }] }],
  ['a game with no pgn beside one with', { history: [], reviews: [
    { at: 13, side: 'white', pgn: null }, { at: 14, side: 'white', pgn: HEAD + RUY }] }],
  ['comments, clocks and a variation', { history: [], reviews: [{ at: 15, side: 'white',
    pgn: HEAD + '1. e4 {[%clk 0:09:58]} e5 (1... c5 2. Nf3) 2. Nf3 $1 Nc6 1-0' }] }],
  ['played and reviewed together', { history: [{ at: 16, colour: 'black', pgn: QGD }],
    reviews: [{ at: 17, side: 'white', pgn: HEAD + RUY }] }],
];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const readBook = () => ({ book: Book.built, games: Book.games, skipped: Book.skipped, replies: Book.replies });
for (const [name, h] of HISTORIES) {
  App.history.games = h.history;
  App.reviews.games = h.reviews;
  Book.read = new Map();
  const want = wideBuildBook(App);
  buildBook();
  const first = readBook();
  // AND AGAIN, this time answered from what it remembered. A memo that drifts
  // on the second call is worse than no memo.
  buildBook();
  const second = readBook();
  ok(`${name}: read from scratch`, same(want, first), `wanted ${JSON.stringify(want)}, got ${JSON.stringify(first)}`);
  ok(`${name}: and remembered`, same(want, second), `wanted ${JSON.stringify(want)}, got ${JSON.stringify(second)}`);
}

// A GAME EDITED UNDER THE SAME TIMESTAMP IS READ AGAIN. The memo is keyed by
// what the reading depends on, not by the timestamp alone.
App.history.games = [];
App.reviews.games = [{ at: 500, side: 'white', pgn: HEAD + '1. e4 e5 2. Nf3 Nc6 1-0' }];
Book.read = new Map();
buildBook();
const beforeEdit = JSON.stringify(Book.built);
App.reviews.games[0].pgn = HEAD + QGD;
buildBook();
ok('a game edited in place is read again, not answered from the memo',
  JSON.stringify(Book.built) !== beforeEdit && same(wideBuildBook(App), readBook()));
// And the same game with the other colour.
App.reviews.games = [{ at: 500, side: 'white', pgn: HEAD + RUY }];
Book.read = new Map();
buildBook();
const asWhite = JSON.stringify(Book.built);
App.reviews.games[0].side = 'black';
buildBook();
ok('and so is one whose side changed', JSON.stringify(Book.built) !== asWhite && same(wideBuildBook(App), readBook()));

// The memo does not outlive the games it was read from.
App.reviews.games = [];
buildBook();
ok('the memo empties with the history', Book.read.size === 0, `${Book.read.size} left`);

console.log(`${positions} positions, ${read} moves read back both ways, ${endings + crowded} positions weighed`);
console.log(`  met: ${seen.castle} castling, ${seen.promo} promotions, ${seen.disambig} disambiguated, ${seen.check} checks, ${seen.mate} mates`);
console.log(`${pass} checks passed, ${fail} failed`);
if (fail) process.exit(1);
