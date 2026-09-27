// ── the same question gets the same answer ─────────────────────────────────
//
// The engine used to be given a number of MILLISECONDS, which is a number of
// whatever the machine managed in them. Two things followed, and both were
// wrong:
//
//   Reviewing the same game twice gave a different accuracy and an estimate
//   that moved by up to 220 rating points, because the second run got a
//   different number of positions out of the same 280ms. A progress chart
//   built out of those is partly a chart of the machine.
//
//   A level labelled 1500 was a materially weaker opponent on a phone than on
//   a laptop — the same word for two different players.
//
// It is given a number of POSITIONS now. This file is the guard on that: the
// search, the reviewer and the ladder all have to be the same everywhere and
// every time, and "I read the code and it looks deterministic" is not a way of
// knowing that.
import { readFileSync } from 'node:fs';

const load = (files) => files.map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/^export /gm, '')).join('\n');
const src = load(['src/engine/bundle.js', 'src/engine/bands.js', 'src/motifs.js', 'src/notation.js',
  'src/pgn.js', 'src/famous.js', 'src/rating-fit.js', 'src/review.js']);
const api = new Function('window', src + `; return { Board, Engine, toSan, moveToUci, parsePgn, reviewGame,
  estimateRating, BANDS, FAMOUS_GAMES, RATING_FIT, TACTIC_NODES };`)({});
const { Board, Engine, moveToUci, parsePgn, reviewGame, estimateRating, BANDS, FAMOUS_GAMES, RATING_FIT } = api;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.log('  FAIL', name, extra); } };

// ── 1. the search returns the same answer every time ───────────────────────
const FENS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1',
  'r2q1rk1/1b1nbppp/p2ppn2/1p6/3NPP2/1BN1B3/PPPQ2PP/2KR3R w - - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/8/4k3/8/8/4K3/4P3/8 w - - 0 1',
];
const engine = new Engine();
const RUNS = 4;
let drifted = null, searched = 0;
for (const nodes of [25000, 80000]) {
  for (const fen of FENS) {
    const answers = new Set();
    for (let run = 0; run < RUNS; run++) {
      engine.reset();
      const r = engine.search(new Board(fen), { nodes, maxDepth: 12 });
      searched++;
      answers.add(`${moveToUci(r.move)} ${r.score} d${r.depth} n${r.nodes}`);
      if (r.ranOutOfTime) answers.add('the clock stopped it');
    }
    if (answers.size !== 1) drifted = `${fen} at ${nodes}: ${[...answers].join(' / ')}`;
  }
}
ok(`${searched} searches: the same position and budget give the same move, score, depth and count`,
  drifted === null, drifted ?? '');

// AND THE BUDGET IS SPENT, not approximated. A count that overshoots by a
// different amount each run is the same bug wearing a smaller number.
let overshot = null;
for (const nodes of [10000, 25000, 80000]) {
  engine.reset();
  const r = engine.search(new Board(FENS[2]), { nodes, maxDepth: 30 });
  if (r.nodes !== nodes) overshot = `asked for ${nodes}, used ${r.nodes}`;
}
ok('a search spends exactly the positions it was given', overshot === null, overshot ?? '');

// A position with one legal move cannot spend them, and must not pretend to.
const FORCED = '7k/8/8/8/8/8/5Q2/6RK b - - 0 1';
const forced = (() => { engine.reset(); return engine.search(new Board(FORCED), { nodes: 50000, maxDepth: 20 }); })();
ok('a position that runs out of chess stops early rather than spinning',
  forced.nodes < 50000 && forced.ranOutOfTime === false, `${forced.nodes} positions, ranOutOfTime ${forced.ranOutOfTime}`);

// The backstop is a backstop: nothing at these budgets should ever reach it.
ok('no search at a review budget hits the clock backstop', drifted === null && !forced.ranOutOfTime);

// ── 2. the same game reviews to the same figures ───────────────────────────
//
// The one that matters: every number on the Progress screen comes out of this.
const game = FAMOUS_GAMES.find((g) => g.id === 'evergreen');
const parsed = parsePgn(`[Result "*"]\n\n${game.moves}`);
const readings = [];
for (let run = 0; run < 3; run++) {
  const r = await reviewGame(parsed, 'white', { nodes: 25000, depth: 7, withTactics: false, yieldEvery: 0 });
  readings.push(JSON.stringify({
    meanLoss: r.meanLoss, accuracy: r.accuracy, counted: r.counted,
    mistakes: r.mistakes.map((m) => `${m.ply}${m.san}${m.loss}${m.severity}`),
    curve: r.whiteCp, marks: r.judged.map((j) => j.cls).join(''),
    estimate: r.meanLoss === null ? null : estimateRating(r.meanLoss, 7)?.elo ?? null,
    ranOutOfTime: r.ranOutOfTime,
  }));
}
const identical = new Set(readings).size === 1;
ok('the same game reviewed three times gives the same figures, to the last move',
  identical, identical ? '' : readings.map((r) => r.slice(0, 180)).join('\n      vs '));
const first = JSON.parse(readings[0]);
ok('and none of those searches ran out of time', first.ranOutOfTime === 0, `${first.ranOutOfTime} did`);
ok('the review actually judged something', first.counted >= 10 && first.mistakes.length > 0,
  `${first.counted} judged, ${first.mistakes.length} mistakes`);

// Both sides of the same game, so a bug that is symmetric does not hide.
const black = [];
for (let run = 0; run < 2; run++) {
  const r = await reviewGame(parsed, 'black', { nodes: 25000, depth: 7, withTactics: false, yieldEvery: 0 });
  black.push(`${r.meanLoss} ${r.accuracy} ${r.counted}`);
}
ok('and from the other side too', new Set(black).size === 1, black.join(' vs '));

// AND THE TACTICS, which are a second, harder search on top of the walk and
// become the puzzles you are asked. A puzzle bank that differs run to run is
// the same bug one screen along.
//
// From BLACK's side of this game, because two empty lists match each other and
// prove nothing: the count is asserted so that a run which quietly found no
// tactics fails here rather than passing.
const tactics = [];
for (let run = 0; run < 2; run++) {
  const r = await reviewGame(parsed, 'black', { nodes: 25000, depth: 7, withTactics: true, yieldEvery: 0 });
  tactics.push(r.tactics.map((t) => `${t.ply}${t.uci ?? ''}${t.found}`).join('|'));
}
ok('the tactics found in a game are the same tactics next time',
  new Set(tactics).size === 1, tactics.map((t) => t.slice(0, 120)).join('\n      vs '));
ok('and there were tactics to find', tactics[0].length > 0, 'the walk found none, so this check compared nothing');

// ── 3. the ladder is a ladder of work, not of clock ────────────────────────
ok('every band carries a budget of positions', BANDS.every((b) => Number.isFinite(b.nodes) && b.nodes > 0));
ok('and none carries a budget of milliseconds', BANDS.every((b) => b.movetime === undefined));
ok('the budgets climb with the label', BANDS.every((b, i) => i === 0 || b.nodes >= BANDS[i - 1].nodes));
ok('the strongest band is still playable on a phone', BANDS[BANDS.length - 1].nodes <= 250000,
  `${BANDS[BANDS.length - 1].nodes} positions`);

// A band plays the same move twice from the same position when it is not
// blundering on purpose — the blunder rate is meant to be random, so it is
// switched off here rather than worked around.
const strong = BANDS[BANDS.length - 1];
const plays = new Set();
for (let run = 0; run < 3; run++) {
  engine.reset();
  const r = engine.search(new Board(FENS[1]), { nodes: strong.nodes, maxDepth: strong.depth, blunder: 0 });
  plays.add(moveToUci(r.move));
}
ok('a level plays the same move from the same position', plays.size === 1, [...plays].join(' / '));

// ── 4. the fit and the app agree about what a review costs ─────────────────
//
// The fit maps a loss onto a rating, and a loss means nothing without the
// amount of work that measured it. If the app's settings drift away from the
// ones the calibration used, every estimate is quietly wrong.
if (RATING_FIT === null) {
  console.log('  (no calibration is present, so the budgets cannot be checked against it)');
} else {
  ok('the calibration records the budgets it measured under', RATING_FIT.budgets !== null && RATING_FIT.budgets !== undefined,
    'run tools/calibrate-rating.mjs to regenerate it');
  if (RATING_FIT.budgets) {
    // Read the app's own settings out of the source, so this is the table the
    // page ships rather than a copy of it kept in a test.
    const appSrc = readFileSync(new URL('../src/app-b.js', import.meta.url), 'utf8');
    const table = /const REVIEW_BUDGET = \{([\s\S]*?)\n\};/.exec(appSrc)?.[1] ?? '';
    const budgets = {};
    for (const m of table.matchAll(/(\d+):\s*\{\s*nodes:\s*(\d+)\s*\}/g)) budgets[m[1]] = Number(m[2]);
    ok('the app has a budget for every depth the fit was measured at',
      Object.keys(RATING_FIT.budgets).every((d) => budgets[d] !== undefined),
      `app ${JSON.stringify(budgets)} vs fit ${JSON.stringify(RATING_FIT.budgets)}`);
    for (const [depth, nodes] of Object.entries(RATING_FIT.budgets)) {
      ok(`depth ${depth}: the app reviews at the ${nodes} positions the fit was measured at`,
        budgets[depth] === nodes, `the app uses ${budgets[depth]}`);
    }
  }
}

console.log(`${searched} searches repeated ${RUNS} times, one game reviewed 5 times, ${BANDS.length} levels checked`);
console.log(`${pass} checks passed, ${fail} failed`);
if (fail) process.exit(1);
