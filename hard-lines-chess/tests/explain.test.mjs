// Tests for explain.js and the parsing half of stockfish-driver.js.
//
// Loaded the way motifs.test.mjs loads motifs.js — as the classic scripts they
// are, concatenated with the engine and evaluated in one fresh context — and
// fed CANNED Stockfish output rather than a running engine. That is the point
// of explain.js having no state and no worker in it: every sentence it can
// write can be pinned here, from a position that can be checked by eye and an
// analysis written out by hand.
//
// What is pinned is the wording that was wrong once, or would be wrong in a
// way a reader cannot catch:
//
//   A MATE IS NOT A NUMBER OF POINTS. Scores carry mates past anything a
//   position is worth, and printed as a difference they read "983.4 points
//   worse". A missed mate, an allowed mate and a slower win each say what
//   happened instead.
//
//   A VERDICT NEVER HAS A HOLE. When where the game stands is unknown, the
//   sentence ends; it does not print ". .".
//
//   TRUE IS NOT THE SAME AS WORTH SAYING. A pawn pinned to a knight, a knight
//   "skewered" with a pawn behind it, a recapture called a punishment: all
//   true to the classifier's definitions, all filtered here.

import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), 'utf8');

const core = read('../src/engine/core.js').replace(/^export /gm, '');
const search = read('../src/engine/search.js')
  .replace(/^export /gm, '')
  .replace(/import \{[\s\S]*?\} from '\.\/core\.js';\n/, '');
const source = [
  core, search,
  read('../src/notation.js'), read('../src/motifs.js'), read('../src/review.js'),
  read('../src/stockfish-driver.js'), read('../src/explain.js'),
].join('\n\n');

const context = createContext({ console });
runInContext(source, context, { filename: 'bundle.js' });
const js = (expr) => runInContext(expr, context);

const explainMove = js('explainMove');
const significantMotif = js('significantMotif');
const parseStockfishInfo = js('parseStockfishInfo');
const summariseStockfish = js('summariseStockfish');
const stockfishValue = js('stockfishValue');
const scoreToApp = js('scoreToApp');
const plainEval = js('plainEval');
const lineAsSan = js('lineAsSan');
const moveFacts = js('moveFacts');
const factsSentence = js('factsSentence');
const moveThreat = js('moveThreat');
const threatSentence = js('threatSentence');
const moveFromUci = js('moveFromUci');
const Board = js('Board');
const Engine = js('Engine');
const [PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK] =
  js('[PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK]');

let failures = 0;
let assertions = 0;
const fail = (name, why) => { failures++; console.log(`FAIL  ${name}\n      ${why}`); };
const eq = (name, got, want) => {
  assertions++;
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(name, `expected ${JSON.stringify(want)}\n      got      ${JSON.stringify(got)}`);
};
const has = (name, text, phrase) => {
  assertions++;
  if (!String(text).includes(phrase)) fail(name, `missing "${phrase}" in\n      "${text}"`);
};
const lacks = (name, text, phrase) => {
  assertions++;
  if (String(text).includes(phrase)) fail(name, `should not say "${phrase}" in\n      "${text}"`);
};
const noHoles = (name, out) => {
  for (const t of [out.verdict, ...out.sentences]) {
    assertions++;
    if (/undefined|NaN|\bnull\b|\. \.|\[object/.test(t)) fail(name, `a hole in "${t}"`);
  }
};

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const line = (move, pv, score, depth = 14) => ({ move, pv, score, depth, bound: false });
const analysis = (lines, depth = 14) => ({ best: lines[0]?.move ?? null, lines: lines.map((l, i) => ({ rank: i + 1, ...l })), depth, nodes: 250000 });

// ── the parser ─────────────────────────────────────────────────────────────

{
  const info = parseStockfishInfo('info depth 12 seldepth 18 multipv 2 score cp 34 nodes 120000 nps 500000 hashfull 12 tbhits 0 time 240 pv e2e4 e7e5 g1f3');
  eq('parse: a plain line', info, { depth: 12, multipv: 2, score: { cp: 34 }, bound: false, nodes: 120000, pv: ['e2e4', 'e7e5', 'g1f3'] });
  eq('parse: a mate against the side to move',
    parseStockfishInfo('info depth 20 multipv 1 score mate -3 nodes 9 pv h7h6 e1e8').score, { mate: -3 });
  eq('parse: a bound is flagged',
    parseStockfishInfo('info depth 13 multipv 1 score cp 51 lowerbound nodes 250000 pv d2d4').bound, true);
  eq('parse: a string line is not a line', parseStockfishInfo('info string NNUE evaluation using nn-37f18f62d772.nnue'), null);
  eq('parse: a current-move line is not a line', parseStockfishInfo('info depth 5 currmove e2e4 currmovenumber 1'), null);
}

// ── the summary: finished lines, and the best move first ──────────────────

{
  const whole = { depth: 10, multipv: 1, score: { cp: 20 }, bound: false, nodes: 100, pv: ['e2e4', 'e7e5', 'g1f3'] };
  const cut = { depth: 11, multipv: 1, score: { cp: 45 }, bound: true, nodes: 200, pv: ['e2e4'] };
  const s = summariseStockfish('e2e4', [whole, cut]);
  eq('summary: the last finished line wins over a cut one', [s.lines[0].pv, s.lines[0].bound], [whole.pv, false]);
  eq('summary: nodes are the most seen', s.nodes, 200);

  const switched = { depth: 11, multipv: 1, score: { cp: 60 }, bound: true, nodes: 300, pv: ['d2d4', 'd7d5'] };
  const t = summariseStockfish('d2d4', [whole, switched]);
  eq('summary: a best move changed mid-iteration leads the list', t.lines[0].move, 'd2d4');
  eq('summary: and it is flagged as cut', t.lines[0].bound, true);
}

// ── scores ─────────────────────────────────────────────────────────────────

eq('value: mate in 1 is the biggest', stockfishValue({ mate: 1 }) > stockfishValue({ mate: 2 }), true);
eq('value: mated in 2 is below every centipawn score', stockfishValue({ mate: -2 }) < -50000, true);
eq('value: mated on the board is the lowest', stockfishValue({ mate: 0 }) < stockfishValue({ mate: -1 }), true);
eq('value: centipawns pass through', stockfishValue({ cp: -37 }), -37);
has('mate in 3 reads as mate in 3', plainEval(scoreToApp({ mate: 3 }), 'White'), 'White forces checkmate in 3 moves');
has('mated in 2 reads as the other side mating', plainEval(scoreToApp({ mate: -2 }), 'White'), 'Black forces checkmate in 2 moves');

// ── lines as a person writes them ──────────────────────────────────────────

{
  const afterE4 = new Board(START);
  afterE4.make(moveFromUci(afterE4, 'e2e4'));
  eq('a line from Black to move numbers its first move with an ellipsis',
    lineAsSan(afterE4, ['e7e5', 'g1f3', 'b8c6']), '1…e5 2.Nf3 Nc6');
  eq('a line stops at the first move that is not legal',
    lineAsSan(afterE4, ['e7e5', 'e1e8', 'b8c6']), '1…e5');
}

// ── what a move is, on the board ──────────────────────────────────────────

{
  const facts = (fen, uci, prevFen, prevUci) => {
    const before = new Board(fen);
    const prev = prevFen ? moveFromUci(new Board(prevFen), prevUci) : null;
    return factsSentence(moveFacts(before, moveFromUci(before, uci), prev).facts);
  };
  eq('facts: castling', facts('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1'), 'Castles kingside.');
  eq('facts: developing', facts(START, 'g1f3'), 'Develops the knight to f3.');
  eq('facts: promotion', facts('8/4P3/8/8/8/8/k7/4K3 w - - 0 1', 'e7e8q'), 'Promotes to a queen.');
  // 1.e4 d5 2.exd5 Qxd5: the queen takes back.
  eq('facts: a recapture is called one',
    facts('rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2', 'd8d5',
      'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2', 'e4d5'),
    'Recaptures on d5.');
  eq('facts: a capture with check',
    facts('4k3/8/8/8/8/8/4r3/4RK2 w - - 0 1', 'e1e2'), 'Takes the rook on e2, with check.');
}

// ── a threat of mate, found with a small search ───────────────────────────

{
  const engine = new Engine();
  const small = (b) => { engine.reset(); return engine.search(b, { nodes: 15000, maxDepth: 5 }); };
  // Ra1-e1: the rook reaches the open file, and Re8 is mate next.
  const before = new Board('6k1/p4ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
  const after = new Board(before.fen());
  after.make(moveFromUci(after, 'a1e1'));
  const t = moveThreat(before, after, small);
  eq('threat: mate is found', t && t.kind, 'mate');
  eq('threat: and said', threatSentence(t, 'White'), 'It threatens mate with Re8#, so Black has to deal with that first.');
}

// ── the verdicts ───────────────────────────────────────────────────────────

// Stockfish's own move, and where the game stands.
{
  const out = explainMove({
    fenBefore: START, uci: 'g1f3', isEngine: true,
    a0: analysis([line('g1f3', ['g1f3', 'g8f6', 'd2d4'], { cp: 20 })]),
    a1: analysis([line('g8f6', ['g8f6', 'd2d4'], { cp: -20 })]),
  });
  has('engine move: called its choice', out.verdict, "Stockfish's choice, looking about 7 moves ahead.");
  has('engine move: with where the game stands', out.verdict, 'Roughly equal');
  eq('engine move: good tone', out.tone, 'good-note');
  noHoles('engine move', out);
}

// Where the game stands is unknown: the verdict ends, it does not stutter.
{
  const out = explainMove({
    fenBefore: START, uci: 'g1f3', isEngine: true,
    a0: analysis([line('g1f3', ['g1f3'], { cp: 20 })]),
    a1: { best: null, lines: [], depth: 0, nodes: 0 },
  });
  eq('no score: the verdict just ends', out.verdict, "Stockfish's choice, looking about 7 moves ahead.");
}

// A repetition, which only a board with the game's history can see.
{
  const out = explainMove({
    fenBefore: START, uci: 'g1f3', isEngine: true, outcome: 'repetition',
    a0: analysis([line('g1f3', ['g1f3'], { cp: 0 })]),
    a1: null,
  });
  eq('repetition: the game is drawn', out.verdict, "Stockfish's choice, looking about 7 moves ahead. The game is drawn.");
}

// The level agrees, with Stockfish's line and its next choice.
{
  const out = explainMove({
    fenBefore: START, uci: 'e2e4', isEngine: false,
    a0: analysis([
      line('e2e4', ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6'], { cp: 30 }, 16),
      line('d2d4', ['d2d4', 'd7d5'], { cp: 25 }, 16),
      line('c2c4', ['c2c4'], { cp: 10 }, 16),
    ], 16),
    a1: analysis([line('e7e5', ['e7e5', 'g1f3'], { cp: -30 })]),
  });
  has('agrees: says so', out.verdict, 'Stockfish agrees, looking about 8 moves ahead.');
  has('agrees: the line it expects', out.sentences.join(' '), 'The line Stockfish expects: 1…e5 2.Nf3 Nc6 3.Bb5 a6.');
  has('agrees: an equal alternative', out.sentences.join(' '), 'd4 was just as good.');
  noHoles('agrees', out);
}

// The only good move.
{
  const out = explainMove({
    fenBefore: START, uci: 'e2e4', isEngine: true,
    a0: analysis([line('e2e4', ['e2e4', 'e7e5'], { cp: 230 }), line('d2d4', ['d2d4'], { cp: 30 })]),
    a1: analysis([line('e7e5', ['e7e5'], { cp: -230 })]),
  });
  has('only move: says so, with the gap', out.sentences.join(' '), 'It is the only good move here: the next best, d4, is 2.0 points worse.');
}

// A mistake that costs material, in points.
{
  const out = explainMove({
    fenBefore: START, uci: 'g2g4', isEngine: false,
    a0: analysis([line('e2e4', ['e2e4', 'e7e5', 'g1f3', 'b8c6'], { cp: 30 })]),
    a1: analysis([line('d7d5', ['d7d5', 'h2h3', 'e7e5'], { cp: 150 })]),
  });
  has('mistake: severity and cost', out.verdict, "Mistake: about 1.8 points worse than Stockfish's e4.");
  eq('mistake: bad tone', out.tone, 'bad-note');
  has('mistake: what it allows', out.sentences.join(' '), 'It allows d5');
  has('mistake: what Stockfish wanted', out.sentences.join(' '), 'Stockfish wanted e4, expecting 1…e5 2.Nf3 Nc6.');
  noHoles('mistake', out);
}

// Allowing a mate: said as a mate, with the mate shown.
{
  const out = explainMove({
    fenBefore: '4r1k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', uci: 'a1a7', isEngine: false,
    a0: analysis([line('h2h3', ['h2h3', 'e8e2'], { cp: 0 }), line('g2g3', ['g2g3'], { cp: -5 })]),
    a1: analysis([line('e8e1', ['e8e1'], { mate: 1 })]),
  });
  has('allows mate: says so', out.verdict, "Blunder: this lets Black force mate, which Stockfish's h3 did not.");
  has('allows mate: and where it stands', out.verdict, 'Black forces checkmate in 1 move');
  lacks('allows mate: no points', out.verdict, 'points');
  has('allows mate: the mate itself', out.sentences.join(' '), 'It allows mate in 1: 1…Re1#.');
  eq('allows mate: bad tone', out.tone, 'bad-note');
  noHoles('allows mate', out);
}

// Missing a mate that was there: said as a miss, with the mate it missed.
{
  const out = explainMove({
    fenBefore: '6k1/p4ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1', uci: 'h2h3', isEngine: false,
    a0: analysis([line('e1e8', ['e1e8'], { mate: 1 }), line('g2g3', ['g2g3', 'h7h6'], { cp: 40 })]),
    a1: analysis([line('h7h6', ['h7h6', 'g2g3'], { cp: -40 })]),
  });
  has('misses mate: says so', out.verdict, "Blunder: it misses a forced mate — Stockfish's Re8# mates in 1.");
  lacks('misses mate: no points', out.verdict, 'points worse');
  has('misses mate: the mate it missed', out.sentences.join(' '), 'The mate Stockfish saw: 1.Re8#.');
  lacks('misses mate: not the reply to a quiet move', out.sentences.join(' '), 'It allows');
  noHoles('misses mate', out);
}

// Missing a mate while still winning easily: slower, not a blunder.
{
  const out = explainMove({
    fenBefore: '6k1/p4ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1', uci: 'g2g3', isEngine: false,
    a0: analysis([line('e1e8', ['e1e8'], { mate: 1 }), line('g2g3', ['g2g3', 'h7h6'], { cp: 950 })]),
    a1: analysis([line('h7h6', ['h7h6'], { cp: -950 })]),
  });
  has('slower win: says so', out.verdict, "Not the quickest: Stockfish's Re8# forces mate in 1, and this lets that go.");
  lacks('slower win: not a blunder', out.verdict, 'Blunder');
  eq('slower win: plain tone', out.tone, 'note');
  noHoles('slower win', out);
}

// Checkmate on the board.
{
  const out = explainMove({
    fenBefore: '4r1k1/R4ppp/8/8/8/8/5PPP/6K1 b - - 1 1', uci: 'e8e1', isEngine: true,
    prevFen: '4r1k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', prevUci: 'a1a7',
    a0: analysis([line('e8e1', ['e8e1'], { mate: 1 })]),
    a1: null,
  });
  eq('checkmate: the verdict', out.verdict, 'Checkmate. Black wins.');
  noHoles('checkmate', out);
}

// ── worth saying, not merely true ──────────────────────────────────────────

{
  const motif = (theme, e) => ({ themes: [theme], reason: 'x', details: { [theme]: e } });
  const kept = (m, opts) => significantMotif(m, opts) !== null;
  const W = WHITE, B = BLACK;

  eq('skewer: a knight with a pawn behind is not one',
    kept(motif('skewer', { slider: BISHOP | B, front: KNIGHT | W, back: PAWN | W })), false);
  eq('skewer: the king with a rook behind is',
    kept(motif('skewer', { slider: BISHOP | B, front: KING | W, back: ROOK | W })), true);
  eq('skewer: a rook with a knight behind, by a bishop, is',
    kept(motif('skewer', { slider: BISHOP | B, front: ROOK | W, back: KNIGHT | W })), true);
  eq('skewer: a queen by a queen is a trade offer, not a skewer',
    kept(motif('skewer', { slider: QUEEN | B, front: QUEEN | W, back: ROOK | W })), false);

  eq('pin: a pawn to a knight is not worth saying',
    kept(motif('pin', { slider: BISHOP | B, front: PAWN | W, back: KNIGHT | W })), false);
  eq('pin: a knight to the king is',
    kept(motif('pin', { slider: BISHOP | B, front: KNIGHT | W, back: KING | W })), true);
  eq('pin: a knight to a rook is',
    kept(motif('pin', { slider: BISHOP | B, front: KNIGHT | W, back: ROOK | W })), true);

  const hanging = motif('hangingPiece', { piece: KNIGHT | W, sq: 0x33, defended: false });
  eq('hanging: not after a move that gave nothing away', kept(hanging, { prevLoss: 30 }), false);
  eq('hanging: after one that did', kept(hanging, { prevLoss: 120 }), true);
  eq('hanging: never of a recapture', kept(hanging, { prevLoss: 120, recapture: true }), false);

  eq('lost material is never said', kept(motif('lostMaterial', { net: 300 })), false);
  eq('a fork is always said',
    kept(motif('fork', { mover: KNIGHT | B, moverSq: 0x42, targets: [], check: true })), true);
}

// ── the same input, the same words ─────────────────────────────────────────

{
  const p = {
    fenBefore: START, uci: 'g2g4', isEngine: false,
    a0: analysis([line('e2e4', ['e2e4', 'e7e5'], { cp: 30 })]),
    a1: analysis([line('d7d5', ['d7d5', 'h2h3'], { cp: 150 })]),
  };
  eq('deterministic', JSON.stringify(explainMove(p)), JSON.stringify(explainMove(p)));
}

console.log(`${assertions} assertions, ${failures} failed`);
if (failures) process.exit(1);
