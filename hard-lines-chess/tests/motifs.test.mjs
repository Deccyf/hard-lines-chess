// Tests for motifs.js.
//
// The file under test is a CLASSIC SCRIPT: it is concatenated into one <script>
// with the engine and never imported. So it is tested the way it ships —
// core.js and search.js with their `export` keywords and the cross-import
// stripped, then notation.js, then motifs.js, evaluated as one program in a
// fresh context. Testing it as a module would prove something about a file
// that does not exist.
//
// Every case is a HAND-BUILT position whose motif can be checked by eye on the
// board, and every case asserts the WHOLE themes array. That is deliberate: an
// exact array is a negative assertion about all twelve other themes at once,
// which is the only way to catch the failure this classifier is actually prone
// to — naming something true-sounding that was never on the board.

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

const source = [core, search, read('../src/notation.js'), read('../src/motifs.js')].join('\n\n');

const context = createContext({ console });
runInContext(source, context, { filename: 'bundle.js' });
const classifyMistake = runInContext('classifyMistake', context);
const vocabulary = runInContext('MOTIFS.VOCABULARY', context);

// ── cases ──────────────────────────────────────────────────────────────────
//
// `themes` is the exact expected array, in order. `says` are substrings the
// reason must contain; `neverSays` substrings it must not.

const CASES = [
  // ── hangingPiece ────────────────────────────────────────────────────────
  {
    name: 'hanging: a knight left loose in the middle of the board',
    // White knight on d4 with nothing defending it; the black rook takes it.
    fenBefore: '3rk3/8/8/8/3N4/8/8/4K3 w - - 0 1',
    playedUci: 'e1f1', bestUci: 'd4b5', replyUci: 'd8d4', replyLine: ['d8d4'],
    cpLoss: 320, mate: null,
    themes: ['hangingPiece'],
    says: ['You left the knight on d4 attacked and undefended'],
  },
  {
    name: 'hanging: a queen defended once and attacked by a bishop',
    // Qd5 is defended by the e4 pawn, which does not make it safe: the
    // exchange is a queen for a bishop.
    fenBefore: '4k3/1b6/8/3Q4/4P3/8/8/4K3 w - - 0 1',
    playedUci: 'e1e2', bestUci: 'd5b7', replyUci: 'b7d5', replyLine: ['b7d5', 'e4d5'],
    cpLoss: 570, mate: null,
    themes: ['hangingPiece'],
    says: ['queen on d5', 'defended too lightly', 'about 6 pawns'],
    neverSays: ['undefended'],
  },
  {
    name: 'NOT hanging: the capture is met by a recapture that wins the exchange',
    // Bxd4 looks like the same shape as the case above and is not: the knight
    // is defended by the c3 pawn and black comes out of it a tenth of a pawn
    // down. Nothing is claimed.
    fenBefore: '4k3/6b1/8/8/3N4/2P5/8/4K3 w - - 0 1',
    playedUci: 'e1e2', bestUci: 'd4f5', replyUci: 'g7d4', replyLine: ['g7d4', 'c3d4'],
    cpLoss: 40, mate: null,
    themes: [],
  },

  // ── fork ────────────────────────────────────────────────────────────────
  {
    name: 'fork: a knight that checks and takes the rook next move',
    fenBefore: '4k3/8/8/8/1n6/8/7P/R3K3 w - - 0 1',
    playedUci: 'h2h3', bestUci: 'a1b1', replyUci: 'b4c2', replyLine: ['b4c2'],
    cpLoss: 480, mate: null,
    themes: ['fork'],
    says: ['knight on c2 forks', 'your king', 'your rook on a1'],
  },
  {
    name: 'fork: a knight on two pieces both worth more than it is',
    fenBefore: '4k3/8/8/8/6n1/8/P7/3Q1R1K w - - 0 1',
    playedUci: 'a2a3', bestUci: 'd1d4', replyUci: 'g4e3', replyLine: ['g4e3'],
    cpLoss: 500, mate: null,
    themes: ['fork'],
    says: ['knight on e3 forks', 'your queen on d1', 'your rook on f1'],
  },
  {
    name: 'NOT a fork: a queen attacking two pawns is attacking two pawns',
    fenBefore: '3qk3/8/8/8/1P5P/8/8/4K3 w - - 0 1',
    playedUci: 'e1e2', bestUci: 'b4b5', replyUci: 'd8d4', replyLine: ['d8d4'],
    cpLoss: 60, mate: null,
    themes: [],
  },

  // ── pin ─────────────────────────────────────────────────────────────────
  {
    name: 'pin: bishop pins the knight against the queen behind it',
    fenBefore: '2b1k3/8/8/8/8/5N2/P7/3QK3 w - - 0 1',
    playedUci: 'a2a3', bestUci: 'f3e5', replyUci: 'c8g4', replyLine: ['c8g4'],
    cpLoss: 150, mate: null,
    themes: ['pin'],
    says: ['bishop on g4 pins your knight on f3 against your queen on d1'],
  },
  {
    name: 'pin: absolute — the king is the piece behind',
    fenBefore: 'r5k1/8/8/8/4N3/8/P7/4K3 w - - 0 1',
    playedUci: 'a2a3', bestUci: 'e4c5', replyUci: 'a8e8', replyLine: ['a8e8'],
    cpLoss: 200, mate: null,
    themes: ['pin'],
    says: ['rook on e8 pins your knight on e4 against your king on e1'],
  },
  {
    name: 'NOT a pin: nothing stands behind the attacked knight',
    // The identical rook lift, one white king moved off the file. Also the
    // negative for trappedPiece: the knight is attacked and has eight squares.
    fenBefore: 'r5k1/8/8/8/4N3/8/P7/6K1 w - - 0 1',
    playedUci: 'a2a3', bestUci: 'e4c5', replyUci: 'a8e8', replyLine: ['a8e8'],
    cpLoss: 30, mate: null,
    themes: [],
  },

  // ── skewer ──────────────────────────────────────────────────────────────
  {
    name: 'skewer: check on the king with the rook behind it',
    fenBefore: 'r5k1/8/8/8/4K3/8/P7/4R3 w - - 0 1',
    playedUci: 'a2a3', bestUci: 'e4d3', replyUci: 'a8e8', replyLine: ['a8e8'],
    cpLoss: 500, mate: null,
    themes: ['skewer'],
    says: ['rook on e8 skewers your king on e4 with your rook on e1 behind it'],
  },
  {
    name: 'skewer: the queen in front, the rook behind',
    fenBefore: '5bk1/8/8/8/3Q4/8/P4R2/4K3 w - - 0 1',
    playedUci: 'a2a3', bestUci: 'd4d8', replyUci: 'f8c5', replyLine: ['f8c5'],
    cpLoss: 400, mate: null,
    themes: ['skewer'],
    says: ['bishop on c5 skewers your queen on d4 with your rook on f2 behind it'],
  },
  {
    name: 'NOT a skewer: the piece behind belongs to the opponent',
    // Same bishop, same queen — but the rook on f2 is theirs, so there is no
    // second piece of yours on the line and nothing is claimed.
    fenBefore: '5bk1/8/8/8/3Q4/8/P4r2/4K3 w - - 0 1',
    playedUci: 'a2a3', bestUci: 'd4f2', replyUci: 'f8c5', replyLine: ['f8c5'],
    cpLoss: 80, mate: null,
    themes: [],
  },

  // ── discoveredAttack ────────────────────────────────────────────────────
  {
    name: 'discovered: the knight steps aside and the bishop hits the rook',
    fenBefore: '6k1/1b6/8/3n4/8/8/P7/4K2R w - - 0 1',
    playedUci: 'a2a3', bestUci: 'h1h5', replyUci: 'd5f4', replyLine: ['d5f4'],
    cpLoss: 480, mate: null,
    themes: ['discoveredAttack'],
    says: ['Moving off d5 uncovered their bishop on b7 onto your rook on h1'],
  },
  {
    name: 'discovered: a check uncovered by a knight move',
    fenBefore: '4r1k1/8/8/4n3/8/8/P7/4K3 w - - 0 1',
    playedUci: 'a2a3', bestUci: 'e1f1', replyUci: 'e5c6', replyLine: ['e5c6'],
    cpLoss: 120, mate: null,
    themes: ['discoveredAttack'],
    says: ['Moving off e5 uncovered their rook on e8 onto your king on e1'],
  },
  {
    name: 'NOT a discovery: the line the knight left is empty',
    // The same knight move with the rook taken off h1. The bishop still points
    // down the diagonal and there is nothing at the end of it.
    fenBefore: '6k1/1b6/8/3n4/8/8/P7/4K3 w - - 0 1',
    playedUci: 'a2a3', bestUci: 'e1e2', replyUci: 'd5f4', replyLine: ['d5f4'],
    cpLoss: 20, mate: null,
    themes: [],
  },

  {
    name: 'NOT a discovery: the bishop already attacked the rook before the move',
    // The knight is off the diagonal to begin with, so nothing was uncovered.
    // This is the case that makes the "through the vacated square" test able to
    // go red: without it, any slider pointing at anything reads as a discovery.
    fenBefore: '6k1/1b6/8/8/3n4/8/P7/4K2R w - - 0 1',
    playedUci: 'a2a3', bestUci: 'h1g1', replyUci: 'd4f5', replyLine: ['d4f5'],
    cpLoss: 40, mate: null,
    themes: [],
  },

  // ── backRankMate ────────────────────────────────────────────────────────
  {
    name: 'back rank: mated behind three of his own pawns',
    fenBefore: '4r1k1/8/8/8/8/8/P4PPP/6K1 w - - 0 1',
    playedUci: 'a2a3', bestUci: 'g1f1', replyUci: 'e8e1', replyLine: ['e8e1'],
    cpLoss: null, mate: 'allowed',
    themes: ['backRankMate', 'mateIn1'],
    says: ['mated on the back rank by their rook on e1', 'f2, g2 and h2 blocked by your own pieces', 'mate in one'],
  },
  {
    name: 'back rank: the same mate against Black',
    fenBefore: '6k1/p4ppp/8/8/8/8/8/4R1K1 b - - 0 1',
    playedUci: 'a7a6', bestUci: 'g8f8', replyUci: 'e1e8', replyLine: ['e1e8'],
    cpLoss: null, mate: 'allowed',
    themes: ['backRankMate', 'mateIn1'],
    says: ['mated on the back rank by their rook on e8', 'f7, g7 and h7'],
  },
  {
    name: 'NOT a back-rank mate: mated on the back rank with the escape squares open',
    // Two bishops cover f2 and g2 instead of two pawns blocking them, so it is
    // mate on the first rank and the lesson is not the missing luft. The mate
    // is still reported; the motif is not.
    fenBefore: 'b3r1k1/8/1b6/8/8/8/P4P1P/6K1 w - - 0 1',
    playedUci: 'a2a3', bestUci: 'g1f1', replyUci: 'e8e1', replyLine: ['e8e1'],
    cpLoss: null, mate: 'allowed',
    themes: ['mateIn1'],
    says: ['You allowed mate in one.'],
  },

  // ── mate distances ──────────────────────────────────────────────────────
  {
    name: 'mate in two, and the pawn it started with really was loose',
    fenBefore: '6k1/8/8/2q5/6n1/8/P4PPP/6K1 w - - 0 1',
    playedUci: 'a2a3', bestUci: 'g1h1',
    replyUci: 'c5f2', replyLine: ['c5f2', 'g1h1', 'f2f1'],
    cpLoss: null, mate: 'allowed',
    themes: ['backRankMate', 'mateIn2', 'hangingPiece'],
    says: ['mated on the back rank', 'mate in two'],
  },
  {
    name: 'mate in two: the queen interposes and is taken',
    fenBefore: 'r5k1/8/8/8/3Q4/8/1P3PPP/6K1 w - - 0 1',
    playedUci: 'b2b3', bestUci: 'd4d1',
    replyUci: 'a8a1', replyLine: ['a8a1', 'd4d1', 'a1d1'],
    cpLoss: null, mate: 'allowed',
    themes: ['backRankMate', 'mateIn2'],
    says: ['mated on the back rank by their rook on d1', 'mate in two'],
  },
  {
    name: 'mate in three: a quiet rook lift first, so the reply itself does nothing',
    fenBefore: '1r4k1/8/8/2q5/6n1/8/P4PPP/6K1 w - - 0 1',
    playedUci: 'a2a3', bestUci: 'g1h1',
    replyUci: 'b8b7', replyLine: ['b8b7', 'a3a4', 'c5f2', 'g1h1', 'f2f1'],
    cpLoss: null, mate: 'allowed',
    themes: ['backRankMate', 'mateIn3'],
    says: ['mate in three'],
  },
  {
    name: 'mate in three: two interpositions, both taken',
    fenBefore: 'r5k1/8/8/8/3Q4/8/1PR2PPP/6K1 w - - 0 1',
    playedUci: 'b2b3', bestUci: 'c2c1',
    replyUci: 'a8a1', replyLine: ['a8a1', 'c2c1', 'a1c1', 'd4d1', 'c1d1'],
    cpLoss: null, mate: 'allowed',
    themes: ['backRankMate', 'mateIn3'],
    says: ['mate in three'],
  },
  {
    name: 'missed mate: nothing to replay, and it still says the one true thing',
    // Ra8 was mate. No reply and no line at all, which is the shape a missed
    // mate arrives in when the game ended or the walk had nothing after it.
    fenBefore: '6k1/5ppp/8/8/8/8/P7/R5K1 w - - 0 1',
    playedUci: 'a2a3', bestUci: 'a1a8', replyUci: null, replyLine: [],
    cpLoss: null, mate: 'missed',
    themes: ['missedMate'],
    says: ['You had a forced mate here and played a3 instead.'],
  },
  {
    name: 'missed mate combined with a tactic: mate was there and the knight hung',
    fenBefore: '6k1/5ppp/7b/8/8/3N4/5PPP/R5K1 w - - 0 1',
    playedUci: 'd3f4', bestUci: 'a1a8', replyUci: 'h6f4', replyLine: ['h6f4'],
    cpLoss: null, mate: 'missed',
    themes: ['missedMate', 'hangingPiece'],
    says: ['You left the knight on f4 attacked and undefended', 'forced mate here instead'],
  },

  // ── trappedPiece ────────────────────────────────────────────────────────
  {
    name: 'trapped: a knight in the corner with both squares covered',
    fenBefore: 'N5k1/p7/8/3b4/8/8/P6r/4K3 w - - 0 1',
    playedUci: 'a2a3', bestUci: 'a8b6', replyUci: 'h2c2', replyLine: ['h2c2'],
    cpLoss: 320, mate: null,
    themes: ['trappedPiece'],
    says: ['Your knight on a8 is attacked and has no square to go to'],
  },
  {
    name: 'trapped: the bishop has two squares and loses on both',
    fenBefore: '6k1/8/3n3p/6p1/7B/8/P4P2/4K3 w - - 0 1',
    playedUci: 'a2a3', bestUci: 'h4g3', replyUci: 'd6f5', replyLine: ['d6f5'],
    cpLoss: 330, mate: null,
    themes: ['trappedPiece'],
    says: ['Your bishop on h4 is attacked and has no square to go to'],
  },

  // ── exposedKing ─────────────────────────────────────────────────────────
  {
    name: 'exposed king: the pawn push opens the long diagonal and the check comes',
    fenBefore: 'q3r1k1/8/8/8/8/2B5/5PPP/6K1 w - - 0 1',
    playedUci: 'g2g4', bestUci: 'c3d4', replyUci: 'e8e1', replyLine: ['e8e1', 'c3e1'],
    cpLoss: 260, mate: null,
    themes: ['exposedKing'],
    says: ['left your king with one square to go to where it had 2', 'comes with check'],
  },
  {
    name: 'exposed king: the same slip played by Black',
    fenBefore: '6k1/5ppp/2b5/8/8/8/8/Q3R1K1 b - - 0 1',
    playedUci: 'g7g5', bestUci: 'c6d5', replyUci: 'e1e8', replyLine: ['e1e8', 'c6e8'],
    cpLoss: 240, mate: null,
    themes: ['exposedKing'],
    says: ['one square to go to where it had 2', 'comes with check'],
  },

  // ── lostMaterial, the last resort ───────────────────────────────────────
  {
    name: 'lost material: a rook walks in and eats a pawn two moves later',
    fenBefore: '1r4k1/8/8/8/8/8/P6P/4K3 w - - 0 1',
    playedUci: 'h2h3', bestUci: 'e1d2', replyUci: 'b8b2', replyLine: ['b8b2', 'e1f1', 'b2a2'],
    cpLoss: 110, mate: null,
    themes: ['lostMaterial'],
    says: ['The line that follows leaves you about a pawn down.'],
  },
  {
    name: 'lost material: two pawns off the seventh rank, Black to move',
    fenBefore: '4k3/p6p/8/8/8/8/P6P/1R4K1 b - - 0 1',
    playedUci: 'e8f8', bestUci: 'e8d7',
    replyUci: 'b1b7', replyLine: ['b1b7', 'f8g8', 'b7a7', 'g8f8', 'a7h7'],
    cpLoss: 210, mate: null,
    themes: ['lostMaterial'],
    says: ['about 2 pawns down'],
  },

  // ── silence ─────────────────────────────────────────────────────────────
  {
    name: 'a quiet positional slip claims nothing at all',
    // A tempo thrown away in the opening. There is no motif here and the
    // honest output is an empty one.
    fenBefore: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    playedUci: 'h7h6', bestUci: 'e7e5', replyUci: 'g1f3', replyLine: ['g1f3'],
    cpLoss: 55, mate: null,
    themes: [],
  },
  {
    name: 'no reply and no mate: nothing to measure, nothing said',
    fenBefore: '3rk3/8/8/8/3N4/8/8/4K3 w - - 0 1',
    playedUci: 'e1f1', bestUci: 'd4b5', replyUci: null, replyLine: [],
    cpLoss: 320, mate: null,
    themes: [],
  },
  {
    name: 'a played move that will not play is a broken record, not a lesson',
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    playedUci: 'e2e5', bestUci: 'e2e4', replyUci: null, replyLine: [],
    cpLoss: null, mate: null,
    themes: [],
  },
];

// ── running them ───────────────────────────────────────────────────────────

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

let failures = 0;
let themeAssertions = 0;

for (const c of CASES) {
  const got = classifyMistake({
    fenBefore: c.fenBefore,
    playedUci: c.playedUci,
    bestUci: c.bestUci,
    replyUci: c.replyUci,
    replyLine: c.replyLine,
    cpLoss: c.cpLoss,
    mate: c.mate,
  });

  const problems = [];

  // The exact array: every theme named, and every theme in the vocabulary NOT
  // named. That second half is the assertion that matters.
  if (!same(got.themes, c.themes)) {
    problems.push(`themes: expected [${c.themes}] got [${got.themes}]`);
  }
  themeAssertions += vocabulary.length;

  for (const theme of got.themes) {
    if (!vocabulary.includes(theme)) problems.push(`theme outside the vocabulary: ${theme}`);
  }
  if (got.themes.length > 3) problems.push('more than three themes');

  // A theme without a sentence, or a sentence without a theme, are both bugs.
  if (c.themes.length === 0 && got.reason !== '') problems.push(`expected no reason, got "${got.reason}"`);
  if (c.themes.length > 0 && !got.reason) problems.push('themes but no reason');

  for (const phrase of (c.says || [])) {
    if (!got.reason.includes(phrase)) problems.push(`reason missing "${phrase}" — got "${got.reason}"`);
  }
  for (const phrase of (c.neverSays || [])) {
    if (got.reason.includes(phrase)) problems.push(`reason should not say "${phrase}" — got "${got.reason}"`);
  }

  if (problems.length) {
    failures++;
    console.log(`FAIL  ${c.name}`);
    for (const p of problems) console.log(`      ${p}`);
  }
}

// Determinism, since every screen that shows this re-renders it: the same
// input twice must give the same answer, and the classifier must not have
// written into the boards it was handed.
const twice = CASES.map((c) => JSON.stringify(classifyMistake(c)));
const thrice = CASES.map((c) => JSON.stringify(classifyMistake(c)));
if (!same(twice, thrice)) { failures++; console.log('FAIL  not deterministic across repeat calls'); }

console.log(`${CASES.length} cases, ${themeAssertions} theme assertions, ${failures} failed`);
if (failures) process.exit(1);
