// A candidate engine, before it is allowed anywhere near src/engine/.
//
// A match tells you whether a change wins games. It does not tell you whether
// the change is CORRECT, and the two are different questions: null-move
// pruning that returns a mate score it has not proved will win most of its
// games and lose the one where it walks into mate, and a search that returns
// an illegal move fails in a way no scoreline shows.
//
// So the candidate has to answer the questions a match cannot:
//
//   1. The move generator still generates the right moves. perft is the
//      standard proof and it is exhaustive.
//   2. Every move it returns is legal in the position it was asked about.
//   3. It still finds every forced mate in the app's own bank — the 42 that
//      tests/puzzle-bank.test.mjs proves by exhaustion — and reports them as
//      mates rather than as large numbers.
//
//   node verify-candidate.mjs <candidate-dir>
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
const BASE = join(HERE, '..', 'src', 'engine');
const dir = process.argv[2] ? resolve(process.argv[2]) : BASE;

const strip = (s) => s.replace(/^export /gm, '').replace(/import \{[\s\S]*?\} from '\.\/core\.js';\n/, '');
const pick = (name) => readFileSync(existsSync(join(dir, name)) ? join(dir, name) : join(BASE, name), 'utf8');

const src = strip(pick('core.js')) + '\n' + strip(pick('search.js')) + '\n'
  + readFileSync(join(HERE, '..', 'src', 'notation.js'), 'utf8') + '\n'
  + readFileSync(join(HERE, '..', 'src', 'puzzle-bank.js'), 'utf8');
const E = {};
new Function('out', 'window', src
  + '\nout.Board = Board; out.Engine = Engine; out.perft = perft; out.toSan = toSan;'
  + ' out.moveToUci = moveToUci; out.PUZZLE_BANK = PUZZLE_BANK; out.MATE = MATE;')(E, {});

let fail = 0;
const check = (what, got, want) => {
  const ok = got === want;
  console.log(String(what).padEnd(46), ok ? String(got) : `${got}   <- expected ${want}`);
  if (!ok) fail++;
};

console.log(`candidate: ${dir}\n`);

// ── 1. the move generator, exhaustively ──────────────────────────────────
// The standard positions, with the standard counts. A generator that passes
// these is not subtly wrong about castling, en passant or promotion.
// The same five positions and counts tests/perft.mjs uses — the standard set,
// whose numbers are published rather than produced by this engine.
const PERFT = [
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 4, 197281],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 4, 43238],
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 3, 9467],
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 3, 62379],
];
for (const [fen, depth, nodes] of PERFT) {
  check(`perft(${depth}) on ${fen.slice(0, 22)}…`, E.perft(new E.Board(fen), depth), nodes);
}

// ── 2. every move it returns is legal ────────────────────────────────────
const engine = new E.Engine();
let seed = 11;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
let searched = 0, illegal = 0;
for (let game = 0; game < 12; game++) {
  const board = new E.Board();
  for (let ply = 0; ply < 40 && !board.outcome(); ply++) {
    engine.reset();
    const result = engine.search(board, { movetime: 40, maxDepth: 64 });
    searched++;
    if (!result.move || !board.legalMoves().includes(result.move)) { illegal++; break; }
    // Then play something else, so the walk covers positions the search would
    // never choose to be in.
    const legal = board.legalMoves();
    board.make(legal[Math.floor(rand() * legal.length)]);
  }
}
check(`illegal moves in ${searched} searches`, illegal, 0);

// ── 3. the mates it has to find ──────────────────────────────────────────
//
// Every "mate in N" in the bank is proved by exhaustion in the test suite, so
// these are facts and not opinions. A search that cannot see a mate in one
// at a second of thinking is broken, whatever a match says.
let mates = 0, missed = [];
for (const p of E.PUZZLE_BANK) {
  if (!p.m || p.m > 3) continue;
  mates++;
  engine.reset();
  const result = engine.search(new E.Board(p.f), { movetime: 900, maxDepth: 64 });
  const sawMate = Math.abs(result.score) > E.MATE - 1000 && result.score > 0;
  const played = result.move ? E.moveToUci(result.move) : '(none)';
  // Another move may also mate in the same number, so the test is that it
  // reports a mate, not that it picked this exact move.
  if (!sawMate) missed.push(`${p.f}  wanted mate in ${p.m}, played ${played} scoring ${result.score}`);
}
check(`forced mates found, of ${mates}`, mates - missed.length, mates);
for (const m of missed.slice(0, 6)) console.log('   missed:', m);

// ── and it does not hang on a quiet position ─────────────────────────────
engine.reset();
const started = Date.now();
engine.search(new E.Board(), { movetime: 300, maxDepth: 64 });
const took = Date.now() - started;
check('a 300ms search returns inside a second', took < 1000, true);
console.log(`   (it took ${took}ms)`);

console.log(fail ? `\n${fail} CHECKS FAILED — this candidate is not correct.` : '\nthe candidate is correct.');
process.exit(fail ? 1 : 0);
