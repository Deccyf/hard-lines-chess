import { Board, perft } from '../src/engine/core.js';

// The standard positions every move generator is tested against. If any of
// these is off by one node the generator has a bug, and an engine built on a
// buggy generator is worse than no engine.
const CASES = [
  ['startpos', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['position 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['position 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
];

let failures = 0;
for (const [name, fen, expected] of CASES) {
  for (let depth = 1; depth <= expected.length; depth++) {
    const board = new Board(fen);
    const got = perft(board, depth);
    const want = expected[depth - 1];
    const ok = got === want;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} depth ${depth}: ${got}${ok ? '' : ` (expected ${want})`}`);
  }
}
console.log(failures === 0 ? '\nALL PERFT PASS' : `\n${failures} PERFT FAILURES`);
process.exit(failures === 0 ? 0 : 1);
