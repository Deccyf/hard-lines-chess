// A real game, played by the app's own engine: a weak band as White against a
// strong one. Gives the review tests a game with genuine blunders and a real
// finish, rather than a hand-typed PGN that turns out to be illegal at move 4.
import { readFileSync } from 'node:fs';
const strip = (s) => s.replace(/^export /gm, '').replace(/import \{[\s\S]*?\} from '\.\/core\.js';\n/, '');
const src = strip(readFileSync('../src/engine/core.js', 'utf8')) + '\n' + strip(readFileSync('../src/engine/search.js', 'utf8'))
  + '\n' + readFileSync('../src/engine/bands.js', 'utf8') + '\n' + readFileSync('../src/notation.js', 'utf8');
const ctx = {};
new Function('out', src + '\nout.Board = Board; out.Engine = Engine; out.toSan = toSan; out.BANDS = BANDS; out.WHITE = WHITE;')(ctx);
const { Board, Engine, toSan, BANDS } = ctx;

const seedRandom = (seed) => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
Math.random = seedRandom(Number(process.argv[3] ?? 7));

const white = BANDS[Number(process.argv[2] ?? 1)];
const black = BANDS[20];
const board = new Board();
const engine = new Engine();
const sans = [];
for (let ply = 0; ply < 120 && !board.outcome(); ply++) {
  const band = board.turn === ctx.WHITE ? white : black;
  engine.reset();
  const r = engine.search(board, { movetime: band.movetime, maxDepth: band.depth, blunder: band.blunder });
  if (!r.move) break;
  sans.push(toSan(board, r.move));
  board.make(r.move);
}
const pgn = sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + s).join(' ');
console.log(JSON.stringify({ outcome: board.outcome(), plies: sans.length, pgn }));
