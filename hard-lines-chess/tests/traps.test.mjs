// Tests for traps.js.
//
// The bundle context is built the way the real app builds it: the export
// keywords and the one import line are stripped from the ES modules, the
// files are concatenated in load order, and the whole thing is evaluated as a
// single classic script. Testing the modules directly would test something the
// page never runs — build.py's comment records a change that was verified
// against search.js and never reached the bundle that shipped.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function buildContext() {
  const strip = (src) => src
    .replace(/^export /gm, '')
    .replace(/import \{[\s\S]*?\} from '\.\/core\.js';\n/, '');

  const source = [
    '../src/engine/core.js',
    '../src/engine/search.js',
    '../src/notation.js',
    '../src/traps.js',
  ].map((f) => strip(readFileSync(join(here, f), 'utf8'))).join('\n\n');

  // eslint-disable-next-line no-new-func
  return new Function(`${source}
    return { Board, Engine, evaluate, toSan, moveToUci, findTrap, trapGate, TRAP_DEFAULTS };`)();
}

const { Board, Engine, toSan, findTrap, trapGate, TRAP_DEFAULTS } = buildContext();

/**
 * An engine whose FIRST search — the root search, the one that decides which
 * move gets offered as the answer — returns a move chosen by the test, and
 * which is honest for every search after that.
 *
 * The root search is on a clock, so what it finds depends on the machine: on
 * this one a 180ms root search on the Légal position reaches depth 5 and gets
 * it right, and at 80ms it reaches depth 3 and names the trap as its own best
 * move. A test that starves the clock and hopes therefore passes for a reason
 * that changes with the hardware — it was written that way first, and two
 * mutations survived it. Naming the move removes the clock from the question.
 */
function engineWithRootMove(fen, san) {
  const real = new Engine();
  const board = new Board(fen);
  const move = board.legalMoves().find((m) => toSan(board, m) === san);
  if (move === undefined) throw new Error(`${san} is not legal in ${fen}`);
  let first = true;
  return {
    reset: () => real.reset(),
    search: (position, options) => {
      if (!first) return real.search(position, options);
      first = false;
      return { move, score: 0, depth: 1, nodes: 0, line: [move], lines: [] };
    },
  };
}

// ── positions ──────────────────────────────────────────────────────────────

// Légal's mate. 1.e4 e5 2.Nf3 Nc6 3.Bc4 d6 4.Nc3 Bg4 5.h3 Bh5 6.Nxe5 and
// Black to move: the knight on e5 is hanging, but so is White's queen, and
// 6...Bxd1?? 7.Bxf7+ Ke7 8.Nd5# is the oldest beginner trap there is. The
// queen grab is the single most tempting move on the board and it is mate.
const LEGAL = 'r2qkbnr/ppp2ppp/2np4/4N2b/2B1P3/2N4P/PPPP1PP1/R1BQK2R b KQkq - 0 6';

// A closed French. Nothing is hanging, no capture wins anything, and the moves
// worth considering are all worth about the same.
const QUIET = 'r1bqkb1r/pp3ppp/2n1pn2/2ppP3/3P4/2P2N2/PP3PPP/RNBQKB1R w KQkq - 0 7';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Black has just played ...Qe4?? and the queen is simply hanging to fxe4.
// The obvious move is the best move — which is not a trap, it is a good day.
const FREE_QUEEN = 'rnb1kbnr/pppp1ppp/8/8/4q3/5P2/PPPP2PP/RNBQKBNR w KQkq - 0 4';

// White is comfortably better and has to not throw it away.
const WHITE_COMFORTABLE = 'r3k2r/pp1n1ppp/2pbpn2/q7/2BP4/2N1PN2/PP2QPPP/R1B2RK1 w kq - 0 12';

// Black is worse and has to find something.
const BLACK_WORSE = 'r2q1rk1/pp2ppbp/2np1np1/2p5/2P1P3/2N1BP2/PP2N1PP/R2QKB1R b KQ - 0 10';

// ── a very small test harness ──────────────────────────────────────────────

let passed = 0;
const failures = [];
const started = Date.now();

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

function ok(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message} — expected ${expected}, got ${actual}`);
}

const nonBest = (result) => result.shortlist.filter((entry) => !entry.isBest);
const mean = (numbers) => numbers.reduce((a, b) => a + b, 0) / numbers.length;

// ── 1. the trap is found, and it is the tempting losing move ───────────────

test('finds the queen grab in Légal\'s trap', () => {
  const result = findTrap(new Board(LEGAL));

  ok(result !== null, 'expected a problem here, got null');
  equal(result.expectedMistake.san, 'Bxd1', 'the expected mistake is the queen grab');
  equal(result.temptation, 1, 'and the shallow search ranks it first — it takes a queen');
  ok(result.refutation !== null, 'a trap this size has a refutation to show');
  equal(result.refutation.san, 'Bxf7+', 'refuted by the bishop check that starts the mate');

  // Mates are flattened, not left as the ±30000 sentinel: an enormous loss on
  // the centipawn scale rather than arithmetic on a number that is not one.
  ok(result.trappiness >= 1000, `walking into mate is an enormous loss, got ${result.trappiness}`);
  ok(result.trappiness <= 3000, `and a flattened one, not sentinel arithmetic — got ${result.trappiness}`);

  ok(result.bestMove.san !== 'Bxd1', 'the move offered instead cannot be the trap itself');
  ok(result.intent === 'trap' || result.intent === 'opportunity', `intent was ${result.intent}`);
});

// ── 2. a quiet balanced position is not a problem ──────────────────────────

test('a quiet balanced position sets no problem', () => {
  equal(findTrap(new Board(QUIET)), null, 'no tactic here, so nothing to announce');
});

test('the starting position sets no problem', () => {
  equal(findTrap(new Board(START)), null, 'nobody has ever been trapped on move one');
});

// ── 3. the tempting move being correct is not a trap ───────────────────────

test('the obvious move being the best move is not a trap', () => {
  const result = findTrap(new Board(FREE_QUEEN));
  equal(result, null, 'taking the free queen is right, and being right is not a problem');
});

// ── 4. the three gates, each in isolation ──────────────────────────────────

test('gate: the opening gate fires alone', () => {
  // Level position, no problem set yet — only the ply number can block this.
  const reason = trapGate(new Board(QUIET), 4, null);
  ok(reason !== null, 'ply 4 is inside the opening and must be blocked');
  ok(/^opening/.test(reason), `expected an opening reason, got: ${reason}`);

  equal(trapGate(new Board(QUIET), TRAP_DEFAULTS.openingPlies, null), null,
    'and the gate opens exactly at openingPlies');
});

test('gate: the spacing gate fires alone', () => {
  // Well past the opening, level position — only the spacing can block this.
  const reason = trapGate(new Board(QUIET), 40, 3);
  ok(reason !== null, 'three plies after the last problem is too soon');
  ok(/^spacing/.test(reason), `expected a spacing reason, got: ${reason}`);

  equal(trapGate(new Board(QUIET), 40, TRAP_DEFAULTS.spacing), null,
    'and it opens exactly at the stated spacing');
  equal(trapGate(new Board(QUIET), 40, null), null,
    'a game with no problem set yet is never blocked by spacing');
});

test('gate: the decided gate fires alone', () => {
  // Past the opening, nothing set recently — only the evaluation can block.
  const reason = trapGate(new Board(QUIET), 40, 40, { evalCp: 1200 });
  ok(reason !== null, '12 pawns up is decided');
  ok(/^decided/.test(reason), `expected a decided reason, got: ${reason}`);

  ok(/^decided/.test(trapGate(new Board(QUIET), 40, 40, { evalCp: -1200 })),
    'and decided cuts both ways — a lost position teaches nothing either');

  equal(trapGate(new Board(QUIET), 40, 40, { evalCp: 0 }), null,
    'a level position is not decided');

  // A mate score is flattened before it is compared, so it reads as decided
  // rather than as a number nobody should be doing arithmetic on.
  ok(/^decided/.test(trapGate(new Board(QUIET), 40, 40, { evalCp: 29997 })),
    'a forced mate is decided');
});

test('gate: nothing fires when nothing should', () => {
  equal(trapGate(new Board(QUIET), 40, 40, { evalCp: 20 }), null,
    'past the opening, well spaced, level — the search may run');
});

// ── 5. trappiness is a MAX over the shortlist, never a mean ────────────────

test('trappiness is the max of the shortlist, not its average', () => {
  // The same Légal position with a margin wide enough to admit the two other
  // captures beside the queen grab: one move loses a mate, the others lose
  // almost nothing. A mean would report the average of those.
  const result = findTrap(new Board(LEGAL), { shallowMargin: 900, shortlist: 4 });

  ok(result !== null, 'expected a problem here, got null');

  const others = nonBest(result);
  const losses = others.map((entry) => entry.deepLoss);
  ok(losses.length >= 2, `this test needs a shortlist of at least two candidates, got ${losses.length}`);

  const biggest = Math.max(...losses);
  const average = mean(losses);
  ok(biggest > average + 200,
    `this test needs one candidate to lose far more than the others (max ${biggest}, mean ${average})`);

  equal(result.trappiness, biggest, 'trappiness is the biggest loss on the shortlist');
  const worst = others.find((entry) => entry.deepLoss === biggest);
  equal(result.expectedMistake.uci, worst.uci, 'and names the move that loses it');
  equal(result.expectedMistake.san, 'Bxd1', 'which is the queen grab');
});

// ── 6. the engine's own move is never the problem ──────────────────────────

test('the engine\'s own best move is never the expected mistake', () => {
  // Floor zero, so nothing is hidden behind "not big enough to mention": the
  // only reason this can come back null is the exclusion itself. On this
  // position the shallow shortlist is exactly one move — the free queen grab —
  // and it is also the engine's own choice, so once it is excluded there is
  // nothing left to warn about.
  const result = findTrap(new Board(FREE_QUEEN), { floor: 0 });
  equal(result, null, 'the answer to a problem can never be the move the engine wants');
});

test('the trap survives a root search that names the trap', () => {
  // The disagreement that has actually been measured: the root search, out of
  // time, picks the queen grab too. With a shortlist of one move there is then
  // nothing left to warn about and the oldest trap in chess comes back as
  // "nothing here" — unless the position is asked about a move that did NOT
  // jump out.
  const result = findTrap(new Board(LEGAL), { engine: engineWithRootMove(LEGAL, 'Bxd1') });

  ok(result !== null, 'a root search that names the trap must not make the trap disappear');
  equal(result.expectedMistake.san, 'Bxd1', 'it is still the queen grab');
  ok(result.bestMove.san !== 'Bxd1', 'and the move offered instead is not the trap');
  ok(result.bestScore > result.shortlist.find((e) => e.san === 'Bxd1').deepScore,
    'the move offered is worth more than the trap');
});

test('the offered move is never worse than a move on the shortlist', () => {
  // The other half of the same disagreement: a root search that comes back
  // with something worse than a move the learner is being warned off. Offered
  // as the answer it would make every figure on the shortlist negative and the
  // announcement would be "do not play this, play something worse".
  const result = findTrap(new Board(LEGAL), {
    shallowMargin: 900,
    shortlist: 4,
    engine: engineWithRootMove(LEGAL, 'a6'),
  });

  ok(result !== null, 'expected a problem here, got null');
  ok(result.shortlist.length >= 2, 'this test needs more than one tempting move');
  for (const entry of result.shortlist) {
    ok(entry.deepLoss >= 0,
      `${entry.san} is worth more than the move being offered (loss ${entry.deepLoss})`);
  }
  ok(result.bestMove.san !== 'a6', 'the weak root move is not what gets offered');
});

test('the offered move is at least as good as everything on the shortlist', () => {
  // The invariant the root search and the candidate searches share. Without
  // it the two can disagree — measured: a 180ms root search on the Légal
  // position names the queen grab as its own best move — and the coach
  // announces a problem whose answer is the mistake.
  for (const fen of [LEGAL, WHITE_COMFORTABLE, BLACK_WORSE]) {
    const result = findTrap(new Board(fen));
    ok(result !== null, `expected a problem on ${fen}`);
    ok(result.expectedMistake.uci !== result.bestMove.uci,
      'the expected mistake and the move offered instead are different moves');
    for (const entry of result.shortlist) {
      ok(entry.deepLoss >= 0,
        `${entry.san} scores above the move being offered (loss ${entry.deepLoss})`);
      if (entry.isBest) {
        equal(entry.uci, result.bestMove.uci, 'the entry marked best is the move being offered');
        equal(entry.deepLoss, 0, 'and it costs nothing against itself');
      }
    }
    ok(result.trappiness >= TRAP_DEFAULTS.floor, 'and nothing under the floor is announced');
  }
});

// ── 7. intent: was the position already fine, or not ───────────────────────

test('intent separates keeping a good position from finding something in a bad one', () => {
  const keeping = findTrap(new Board(WHITE_COMFORTABLE));
  ok(keeping !== null, 'expected a problem for the better side');
  ok(keeping.bestScore > TRAP_DEFAULTS.fineTolerance,
    `this test needs the side to move to be clearly fine, got ${keeping.bestScore}`);
  equal(keeping.intent, 'trap', 'a position already fine is a trap: do not throw this away');

  const finding = findTrap(new Board(BLACK_WORSE));
  ok(finding !== null, 'expected a problem for the worse side');
  ok(finding.bestScore < -TRAP_DEFAULTS.fineTolerance,
    `this test needs the side to move to be clearly worse, got ${finding.bestScore}`);
  equal(finding.intent, 'opportunity', 'a position that is not fine is an opportunity: find something');
});

// ── summary ────────────────────────────────────────────────────────────────

const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (failures.length) {
  for (const failure of failures) console.error('FAIL  ' + failure);
}
console.log(`traps.js: ${passed}/${passed + failures.length} passed, ${failures.length} failed, ${seconds}s`);
process.exit(failures.length ? 1 : 0);
