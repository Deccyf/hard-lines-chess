// ── a bank of tactics, mined from the app playing itself ───────────────────
//
// The Puzzles tab takes its positions from YOUR games, which is the best thing
// about it and useless on the first day: a clock mode with nothing to put in
// front of you is a clock mode that cannot start. This writes a starting bank.
//
// WHERE THE POSITIONS COME FROM. Not a downloaded database and not a human's
// judgement — the app's own engine, playing itself, a weak band against a
// strong one so that real blunders happen. Every game is then run through the
// SAME review the app runs on yours, so a puzzle here passed exactly the gates
// a puzzle from your own game passes: the opponent gave something away, one
// move takes it, and a second deeper search agrees that move is clearly best
// and the next one is not.
//
// AND THEN EVERY ONE IS CHECKED AGAIN, deeper than the review that found it,
// because a bank is shipped once and read for ever. Anything whose best move
// stops being uniquely best under the deeper search is dropped rather than
// shipped with a hedge.
//
// Run from tools/:  node make-puzzles.mjs [games] [out]
// Writes src/puzzle-bank.js, which is committed — this takes minutes and must
// not run on every build.

import { readFileSync, writeFileSync } from 'node:fs';

const stripExports = (s) => s.replace(/^export /gm, '').replace(/import \{[\s\S]*?\} from '\.\/core\.js';\n/, '');
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const source = [
  stripExports(read('../src/engine/core.js')),
  stripExports(read('../src/engine/search.js')),
  read('../src/engine/bands.js'),
  read('../src/notation.js'),
  read('../src/pgn.js'),
  read('../src/motifs.js'),
  read('../src/review.js'),
].join('\n');

const api = new Function('window', 'localStorage', source
  + '; return { Board, Engine, BANDS, WHITE, BLACK, toSan, sanToMove, moveToUci, parsePgn, reviewGame, TACTIC };')({}, undefined);
const { Board, Engine, BANDS, WHITE, toSan, moveToUci, parsePgn, reviewGame } = api;

const GAMES = Number(process.argv[2] ?? 40);
const OUT = new URL(process.argv[3] ?? '../src/puzzle-bank.js', import.meta.url);

// Deterministic: the same bank comes out of the same command, so a rebuild is
// a rebuild rather than a new set of puzzles nobody chose.
const seeded = (seed) => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

/**
 * One self-play game as a PGN. A weak band against a strong one blunders.
 *
 * WHICH COLOUR IS WEAK ALTERNATES, and it has to. The first run put the weak
 * band on White every game, so White made all the mistakes and every puzzle in
 * the bank was Black to move — a set that trains one orientation and leaves
 * the other unpractised, which is the half most people are worse at anyway.
 */
function playGame(weakIndex, strongIndex, seed, weakIsWhite) {
  Math.random = seeded(seed);
  const white = BANDS[weakIsWhite ? weakIndex : strongIndex];
  const black = BANDS[weakIsWhite ? strongIndex : weakIndex];
  const board = new Board();
  const engine = new Engine();
  const sans = [];
  for (let ply = 0; ply < 140 && !board.outcome(); ply++) {
    const band = board.turn === WHITE ? white : black;
    engine.reset();
    const result = engine.search(board, { movetime: band.movetime, maxDepth: band.depth, blunder: band.blunder });
    if (!result.move) break;
    sans.push(toSan(board, result.move));
    board.make(result.move);
  }
  return sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + s).join(' ');
}

/**
 * The second opinion. Deeper than the review that found the puzzle, and
 * stricter: the move must still be clearly ahead of the next one, or the
 * position is not a puzzle with one answer and does not belong in a bank.
 */
function stillClear(tactic) {
  const engine = new Engine();
  engine.reset();
  const board = new Board(tactic.fen);
  const result = engine.search(board, { movetime: 1200, maxDepth: 18, lines: 2 });
  if (!result.move) return null;
  if (moveToUci(result.move) !== tactic.best.uci) return null;
  const [top, second] = result.lines;
  if (!top) return null;
  const MATE_EDGE = 29000;
  const topMate = Math.abs(top.score) > MATE_EDGE;
  if (second) {
    const secondMate = Math.abs(second.score) > MATE_EDGE;
    if (topMate && secondMate) return null;                    // two mates: no single answer
    if (!topMate && top.score - second.score < 200) return null;
  }
  return {
    mate: topMate ? Math.ceil((30000 - Math.abs(top.score)) / 2) : null,
    edge: topMate ? null : top.score,
  };
}

const bank = new Map();          // fen -> entry, so a repeated position appears once
let played = 0, found = 0, kept = 0;
const started = Date.now();

for (let g = 0; g < GAMES; g++) {
  // Spread across the ladder: the weakest bands give away material, the
  // middle ones give away tactics that take more than one move to punish.
  const weak = 1 + (g % 8);
  const strong = 14 + (g % 7);
  const pgn = playGame(weak, strong, 1000 + g * 7919, g % 2 === 0);
  const parsed = parsePgn(pgn);
  if (!parsed || !parsed.plies?.length) continue;
  played++;

  for (const side of ['white', 'black']) {
    const result = await reviewGame(parsed, side, { movetime: 150, depth: 9, withTactics: true });
    for (const tactic of result.tactics ?? []) {
      found++;
      if (bank.has(tactic.fen)) continue;
      const confirmed = stillClear(tactic);
      if (!confirmed) continue;
      kept++;
      bank.set(tactic.fen, {
        f: tactic.fen,
        s: tactic.side,
        u: tactic.best.uci,
        n: tactic.best.san,
        m: confirmed.mate,
        e: confirmed.edge,
        l: tactic.line,
      });
    }
  }
  process.stderr.write(`game ${g + 1}/${GAMES}  ${bank.size} puzzles  ${Math.round((Date.now() - started) / 1000)}s\n`);
}

/**
 * Easiest first, so a timed run starts with something anybody can see.
 *
 * There is no difficulty rating here and none is invented: the order is by
 * how much of the board the answer involves — a mate in one before a mate in
 * three, a short punishing line before a long one, a big material swing before
 * a small one. That is a proxy, and it is labelled as one wherever it is used.
 */
const entries = [...bank.values()].sort((a, b) => {
  const cost = (t) => (t.m !== null ? t.m * 2 : 6)
    + (t.l ? t.l.split(/\s+/).filter((x) => !/^\d+\.(\.\.)?$/.test(x)).length : 0)
    - Math.min(6, Math.abs(t.e ?? 0) / 300);
  return cost(a) - cost(b);
});

const file = `// ── the starting bank ──────────────────────────────────────────────────────
//
// GENERATED by tools/make-puzzles.mjs. Do not edit by hand.
//
// ${entries.length} positions, mined from ${played} games the app's engine played against
// itself and passed through the same review that mines tactics from yours: the
// opponent gave something away, one move takes it, and a second search agrees
// that move is clearly best. Every one was then re-checked at greater depth
// than the review that found it, and ${found - kept} of the ${found} candidates were
// dropped for no longer having a single clear answer.
//
// These exist so the timed mode works on the first day. Your own games are
// still the better source and the app says so where it offers both.
//
//   f  the position          n  that move in algebraic
//   s  the side to move      m  mate in this many, or null
//   u  the move that wins    e  the advantage in centipawns, or null
//   l  the line that demonstrates it
const PUZZLE_BANK = ${JSON.stringify(entries)};
`;

writeFileSync(OUT, file);
console.log(`\n${entries.length} puzzles from ${played} games (${found} candidates, ${found - kept} dropped on the second look) in ${Math.round((Date.now() - started) / 1000)}s`);
console.log(`written to ${OUT.pathname}`);
