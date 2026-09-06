// How deep two builds get in the same time, and at what cost in nodes.
//
// WHY THIS AND NOT ONLY A MATCH. A match gives one number for the whole
// engine, and a change that helps in the middlegame and hurts in the endgame
// comes back as "not separated" — which is true and tells you nothing about
// what to do next. This says WHERE the change paid and where it did not, in
// about twenty seconds rather than an hour.
//
// It was worth having: the null-move/PVS candidate came back even over 120
// games, and this is what explained it. A ply deeper in the opening, the
// middlegame and a tactical position at a second a move — and THREE PLIES
// SHALLOWER in a king-and-pawn ending, where the move ordering is weakest and
// the null-window re-searches cost more than the scout saves.
//
//   node depth-probe.mjs [candidate-dir]
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
const BASE = join(HERE, '..', 'src', 'engine');
const strip = (s) => s.replace(/^export /gm, '').replace(/import \{[\s\S]*?\} from '\.\/core\.js';\n/, '');

function load(dir) {
  const pick = (n) => readFileSync(existsSync(join(dir, n)) ? join(dir, n) : join(BASE, n), 'utf8');
  const out = {};
  new Function('out', strip(pick('core.js')) + '\n' + strip(pick('search.js')) + '\nout.Board=Board;out.Engine=Engine;')(out);
  return out;
}

const candidate = process.argv[2] ?? join(HERE, 'engine-candidates', 'stronger');
const A = load(BASE), B = load(candidate);

// Five positions covering the shapes the search behaves differently in. The
// last two are the ones that catch a change that is only good in the
// middlegame, which is most of them.
const POSITIONS = [
  ['opening', 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'],
  ['middlegame', 'r2q1rk1/pp2ppbp/2np1np1/2p5/2P1P3/2NP1NP1/PP3PBP/R1BQ1RK1 w - - 0 9'],
  ['tactical', 'r1bq1rk1/ppp2ppp/2n5/3np3/1bB5/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 8'],
  ['endgame', '8/5pk1/6p1/7p/7P/5PK1/6P1/8 w - - 0 40'],
  ['pawn ending', '8/8/8/4k3/8/8/4P3/4K3 w - - 0 1'],
];

console.log(`baseline:  ${BASE}`);
console.log(`candidate: ${candidate}`);
let deeper = 0, shallower = 0;
for (const ms of [100, 400, 1000]) {
  console.log(`\n--- ${ms}ms a move`);
  console.log('position'.padEnd(13) + 'baseline'.padEnd(16) + 'candidate'.padEnd(16) + '');
  for (const [name, fen] of POSITIONS) {
    const run = (M) => { const e = new M.Engine(); e.reset(); return e.search(new M.Board(fen), { movetime: ms, maxDepth: 64 }); };
    const a = run(A), b = run(B);
    const verdict = b.depth > a.depth ? 'deeper' : b.depth < a.depth ? 'SHALLOWER' : '';
    if (b.depth > a.depth) deeper++; else if (b.depth < a.depth) shallower++;
    console.log(name.padEnd(13)
      + `${a.depth} ply / ${(a.nodes / 1000).toFixed(0)}k`.padEnd(16)
      + `${b.depth} ply / ${(b.nodes / 1000).toFixed(0)}k`.padEnd(16)
      + verdict);
  }
}
console.log(`\n${deeper} deeper, ${shallower} shallower, ${15 - deeper - shallower} level, of 15.`);
console.log('Depth is not strength. A candidate that is deeper everywhere still has to win a match.');
