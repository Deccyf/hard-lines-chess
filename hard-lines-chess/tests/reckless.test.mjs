// The Reckless the website serves, checked from the files in vendor/reckless/.
//
// This is the engine a phone downloads, so it is tested as that: the pieces
// as they are stored, unpacked and checked against the manifest the page
// checks them against, joined, and started — the real engine, in node, with
// the bindings the page uses. Then asked real questions:
//
//   IT ANSWERS WITH A LEGAL MOVE, in output the app's own UCI reader reads.
//
//   THE SAME QUESTION GETS THE SAME ANSWER — twice in a row, and again after a
//   different search in between. Out of the box it did not: its reset left the
//   correction histories behind (vendor/reckless/reset.patch), and the same
//   position came back with a different score from the very first ply.
//
//   IT IS TOLD THE GAME. The same position reached by a different route is
//   searched with that route's history, which is what lets it see a repetition.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const vendor = join(here, '..', 'vendor', 'reckless');
const read = (f) => readFileSync(join(here, f), 'utf8');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

let failures = 0;
let checks = 0;
const check = (what, got, want) => {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`}`);
  if (!ok) failures++;
};

// ── the files, as the page checks them ─────────────────────────────────────
const manifest = JSON.parse(readFileSync(join(vendor, 'manifest.json'), 'utf8'));
const wasm = Buffer.alloc(manifest.wasm.bytes);
let at = 0;
let damaged = 0;
for (const piece of manifest.pieces) {
  const packed = readFileSync(join(vendor, piece.file));
  const raw = gunzipSync(packed);
  if (packed.length !== piece.bytes || raw.length !== piece.raw || sha256(raw) !== piece.sha256) damaged++;
  raw.copy(wasm, at);
  at += raw.length;
}
check(`all ${manifest.pieces.length} pieces match the manifest`, damaged, 0);
check('and join into the whole engine it names', at === manifest.wasm.bytes && sha256(wasm) === manifest.wasm.sha256, true);
const glueFile = join(vendor, manifest.glue.file);
check('the bindings match the manifest', sha256(readFileSync(glueFile)) === manifest.glue.sha256, true);
check('its network is the one pinned', manifest.network.name.startsWith('v60-') && manifest.network.sha256.startsWith(manifest.network.name.slice(4, 12)), true);

// ── the engine ─────────────────────────────────────────────────────────────
const bindings = await import(pathToFileURL(glueFile).href);
const started = Date.now();
bindings.initSync({ module: wasm });
const engine = new bindings.Engine();
engine.set_threads(1);
console.log(`     started in ${Date.now() - started} ms`);

// The app's own board and UCI reader, loaded the way the page has them.
const core = read('../src/engine/core.js').replace(/^export /gm, '');
const context = createContext({ console });
runInContext([core, read('../src/stockfish-driver.js')].join('\n\n'), context, { filename: 'bundle.js' });
const js = (expr) => runInContext(expr, context);
const Board = js('Board');
const moveToUci = js('moveToUci');
const parseStockfishInfo = js('parseStockfishInfo');
const summariseStockfish = js('summariseStockfish');

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
function ask(moves, nodes = 100000, multipv = 3) {
  const lines = [];
  engine.reset();
  engine.set_position(START);
  for (const m of moves) engine.make_move(m);
  const t = Date.now();
  engine.go_uci(0, nodes, multipv, (line) => lines.push(String(line)));
  const ms = Date.now() - t;
  const infos = lines.map(parseStockfishInfo).filter(Boolean);
  return { summary: summariseStockfish(engine.last_bestmove(), infos), lines, ms };
}
// What is compared: everything but the clock, which is the one thing a
// search's output may honestly differ in.
const steady = (r) => JSON.stringify(r.lines.map((l) => l.replace(/ time \d+ nps \d+/, '').replace(/ hashfull \d+/, '')));

const italian = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5'];
const first = ask(italian);
const board = new Board(START);
for (const m of italian) board.make(board.legalMoves().find((x) => moveToUci(x) === m));
const legal = board.legalMoves().map(moveToUci);
console.log(`     ${first.summary.best}, depth ${first.summary.depth}, ${first.summary.nodes} positions in ${first.ms} ms`);
check('it answers with a legal move', legal.includes(first.summary.best), true);
check('with three candidate lines', first.summary.lines.length, 3);
check('each read as a score and a line', first.summary.lines.every((l) => l.score && l.pv.length >= 1 && legal.includes(l.move)), true);
check('and a budget kept to the position', first.summary.nodes >= 100000 && first.summary.nodes < 100100, true);

const again = ask(italian);
check('the same question twice, the same answer', steady(again), steady(first));
ask(['d2d4', 'g8f6', 'c2c4'], 60000, 1);
check('and again after another search in between', steady(ask(italian)), steady(first));

// Knights out and back: the start position again, with a history. Each side
// has made the same position twice already, so the history is different and
// the engine must not answer as if it were the first move of the game.
const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'];
const fresh = ask([], 60000, 1);
const repeated = ask(shuffle, 60000, 1);
check('it is told the game, not just the position', steady(repeated) !== steady(fresh), true);

console.log(`${checks} checks, ${failures} failed`);
if (failures) process.exit(1);
