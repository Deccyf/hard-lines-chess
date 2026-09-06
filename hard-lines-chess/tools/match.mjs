// Two engines, played off against each other.
//
// WHY THIS EXISTS. Every idea about making a chess engine stronger is an idea
// that sounds right. Null-move pruning sounds right. Aspiration windows sound
// right. Bigger transposition tables sound right. Some of them are worth a
// hundred points and some of them lose games, and reading the code tells you
// which about half the time — which is the same as not knowing.
//
// So nothing goes into src/engine/ on the strength of sounding right. A
// candidate is a copy of search.js with the change in it, and it earns its
// place by beating the current one over enough games to mean something.
//
//   node match.mjs <candidate-dir> [games] [movetime]
//
// The candidate directory holds a search.js (and optionally a core.js);
// anything it does not have is taken from src/engine/. Colours alternate and
// each opening is played twice, once from each side, so an opening that
// happens to favour White cannot favour one engine.
//
// WHAT THE NUMBER MEANS, and its error bar. A match score is a sample. Fifty
// games is worth about ±100 Elo at 95%, which cannot separate two engines
// less than a hundred points apart — so the interval is printed next to the
// estimate, and a result whose interval spans zero is reported as "not
// separated" rather than as a small win.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
const BASE = join(HERE, '..', 'src', 'engine');

const strip = (s) => s
  .replace(/^export /gm, '')
  .replace(/import \{[\s\S]*?\} from '\.\/core\.js';\n/, '');

/** One engine, in its own scope, so two builds cannot share a global. */
function load(dir) {
  const pick = (name) => {
    const own = join(dir, name);
    return readFileSync(existsSync(own) ? own : join(BASE, name), 'utf8');
  };
  const src = strip(pick('core.js')) + '\n' + strip(pick('search.js'));
  const out = {};
  new Function('out', src + '\nout.Board = Board; out.Engine = Engine; out.WHITE = WHITE;')(out);
  return out;
}

const candidateDir = process.argv[2] ? resolve(process.argv[2]) : null;
if (!candidateDir) {
  console.error('usage: node match.mjs <candidate-dir> [games] [movetime]');
  process.exit(2);
}
const GAMES = Number(process.argv[3] ?? 40);
const MOVETIME = Number(process.argv[4] ?? 120);
const MAX_PLIES = 240;

const A = load(BASE);            // what ships
const B = load(candidateDir);    // what wants to

// ── the openings ───────────────────────────────────────────────────────────
//
// Not the starting position forty times. Two engines from the same starting
// position play something close to the same game every time, and forty copies
// of one game is a sample of one. These are the app's own repertoire lines,
// truncated, so the games start from real positions and start differently.
const openingSrc = readFileSync(join(HERE, '..', 'src', 'openings.js'), 'utf8');
const OPENINGS = new Function(openingSrc + '; return OPENINGS;')();

/** A start position: the first few plies of one opening, played out. */
function startFrom(opening, plies) {
  const notation = readFileSync(join(HERE, '..', 'src', 'notation.js'), 'utf8');
  const pgn = readFileSync(join(HERE, '..', 'src', 'pgn.js'), 'utf8');
  const scope = {};
  new Function('out', strip(readFileSync(join(BASE, 'core.js'), 'utf8')) + '\n' + strip(readFileSync(join(BASE, 'search.js'), 'utf8'))
    + '\n' + notation + '\n' + pgn + '\nout.Board = Board; out.sanToMove = sanToMove;')(scope);
  const board = new scope.Board();
  for (const san of opening.line.slice(0, plies)) {
    const move = scope.sanToMove(board, san);
    if (!move) break;
    board.make(move);
  }
  return board.fen();
}

// ── one game ───────────────────────────────────────────────────────────────
function play(white, black, fen) {
  // Each side gets its own board object from its own build, kept in step by
  // replaying the move: the two builds' Board classes are different classes.
  const wb = new white.mod.Board(fen);
  const bb = new black.mod.Board(fen);
  const we = new white.mod.Engine();
  const be = new black.mod.Engine();

  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const whiteToMove = wb.turn === white.mod.WHITE;
    const board = whiteToMove ? wb : bb;
    if (board.outcome()) break;
    const engine = whiteToMove ? we : be;
    engine.reset();
    const result = engine.search(board, { movetime: MOVETIME, maxDepth: 64 });
    if (!result.move) break;
    // Replay by coordinates, because a move is an integer encoding and the two
    // builds' encodings only have to agree by convention, not by identity.
    const from = result.move & 0x7f, to = (result.move >> 7) & 0x7f, promo = (result.move >> 14) & 0x7;
    const mirrorOn = (b, mod) => b.legalMoves().find((m) => (m & 0x7f) === from && ((m >> 7) & 0x7f) === to && ((m >> 14) & 0x7) === promo);
    const wm = mirrorOn(wb, white.mod), bm = mirrorOn(bb, black.mod);
    if (wm === undefined || bm === undefined) return { result: 0.5, reason: 'desync' };
    wb.make(wm); bb.make(bm);
  }

  const outcome = wb.outcome();
  if (outcome === 'checkmate') {
    // The side to move is the side that has been mated.
    return { result: wb.turn === white.mod.WHITE ? 0 : 1, reason: 'checkmate' };
  }
  return { result: 0.5, reason: outcome ?? 'move limit' };
}

// ── the match ──────────────────────────────────────────────────────────────
const engines = { A: { name: 'baseline (src/engine)', mod: A }, B: { name: candidateDir, mod: B } };
let bWins = 0, draws = 0, aWins = 0;
const reasons = {};
const started = Date.now();

for (let game = 0; game < GAMES; game++) {
  // Each opening twice, once from each side; the pair index picks the opening.
  const pair = Math.floor(game / 2);
  const opening = OPENINGS[pair % OPENINGS.length];
  const fen = startFrom(opening, 6 + (pair % 3) * 2);
  const bIsWhite = game % 2 === 1;
  const white = bIsWhite ? engines.B : engines.A;
  const black = bIsWhite ? engines.A : engines.B;

  const { result, reason } = play(white, black, fen);
  reasons[reason] = (reasons[reason] ?? 0) + 1;
  const bScore = bIsWhite ? result : 1 - result;
  if (bScore === 1) bWins++; else if (bScore === 0) aWins++; else draws++;

  const played = game + 1;
  process.stdout.write(`\r${played}/${GAMES}  candidate ${bWins}W ${draws}D ${aWins}L  (${opening.name.slice(0, 28)})            `);
}
process.stdout.write('\n');

const played = bWins + draws + aWins;
const score = (bWins + draws / 2) / played;
// The standard deviation of the mean of the per-game scores, and 1.96 of them.
const mean = score;
const variance = (bWins * (1 - mean) ** 2 + draws * (0.5 - mean) ** 2 + aWins * (0 - mean) ** 2) / played;
const stderr = Math.sqrt(variance / played);
const elo = (s) => (s <= 0 || s >= 1) ? (s <= 0 ? -Infinity : Infinity) : -400 * Math.log10(1 / s - 1);
const lo = elo(Math.max(0.001, score - 1.96 * stderr));
const hi = elo(Math.min(0.999, score + 1.96 * stderr));

console.log(`\ncandidate: ${candidateDir}`);
console.log(`${played} games at ${MOVETIME}ms a move, in ${Math.round((Date.now() - started) / 1000)}s`);
console.log(`candidate scored ${bWins}W ${draws}D ${aWins}L = ${(score * 100).toFixed(1)}%`);
console.log(`endings: ${Object.entries(reasons).map(([k, v]) => `${v} ${k}`).join(', ')}`);
console.log(`Elo difference: ${elo(score).toFixed(0)}  (95%: ${lo.toFixed(0)} to ${hi.toFixed(0)})`);
if (lo < 0 && hi > 0) {
  console.log('NOT SEPARATED at this sample size. The interval spans zero, so this run does not');
  console.log('establish that the candidate is better OR worse. More games, or a bigger change.');
} else if (lo > 0) {
  console.log('The candidate is stronger, and the interval says so.');
} else {
  console.log('The candidate is WEAKER. Do not ship it.');
}
