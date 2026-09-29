// The judge adapter in review.js, checked against the reviewer it stands in for.
//
// reviewGame() can ask Stockfish or Reckless instead of this app's engine. The
// answers come back in UCI — moves as strings, scores as centipawns or a mate
// count in moves — and are turned into what the reviewer works with. That
// translation is the one place a review by another judge could go wrong
// without the judge being wrong: a mate read a ply out, a move mapped to the
// wrong one, the game's history not passed.
//
// So a FAKE judge answers in UCI from this app's own engine, and the review it
// produces must be IDENTICAL to the review the engine produces directly — the
// same curve to the centipawn, the same marks, the same mistakes and tactics.
// Anything the translation loses or bends shows up as a difference.
//
// And the judge must have been told the game: for every position, exactly the
// moves that led to it.
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), 'utf8');
const core = read('../src/engine/core.js').replace(/^export /gm, '');
const search = read('../src/engine/search.js').replace(/^export /gm, '').replace(/import \{[\s\S]*?\} from '\.\/core\.js';\n/, '');
const context = createContext({ console, setTimeout });
runInContext([core, search, read('../src/notation.js'), read('../src/pgn.js'), read('../src/motifs.js'), read('../src/review.js')].join('\n\n'),
  context, { filename: 'bundle.js' });
const js = (expr) => runInContext(expr, context);
const [Board, Engine, parsePgn, reviewGame, moveToUci, MATE_EDGE, CHECKMATE_SCORE] =
  js('[Board, Engine, parsePgn, reviewGame, moveToUci, MATE_EDGE, CHECKMATE_SCORE]');

let failures = 0;
let checks = 0;
const check = (what, got, want) => {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) { failures++; console.log(`     got  ${JSON.stringify(got)?.slice(0, 300)}\n     want ${JSON.stringify(want)?.slice(0, 300)}`); }
};

/** This app's score as UCI writes it: mate counted in moves, from the side to move. */
function uciScore(score) {
  if (Math.abs(score) > MATE_EDGE) {
    const plies = CHECKMATE_SCORE - Math.abs(score);
    const moves = Math.ceil(plies / 2);
    return { mate: score > 0 ? moves : -moves };
  }
  return { cp: score };
}

/**
 * A judge that answers in UCI, from this app's engine at the review's own
 * settings — so its answers are the engine's, and only the translation can
 * make a difference.
 */
function fakeJudge(depth) {
  const asked = [];
  return {
    asked,
    name: 'fake',
    analyse: async (fen, { nodes, multipv = 1, moves = [] }) => {
      asked.push({ fen, moves: [...moves], multipv });
      const board = new Board(fen);
      for (const uci of moves) board.make(board.legalMoves().find((m) => moveToUci(m) === uci));
      const engine = new Engine();
      engine.reset();
      // The reviewer's own settings: a tactic check is two lines, two plies deeper.
      const r = engine.search(new Board(board.fen()), { nodes, maxDepth: multipv > 1 ? depth + 2 : depth, lines: multipv });
      const lines = (multipv > 1 ? r.lines : [{ move: r.move, score: r.score, line: r.line }])
        .filter((l) => l.move)
        .map((l, i) => ({ rank: i + 1, move: moveToUci(l.move), pv: (l.line ?? [l.move]).map(moveToUci), score: uciScore(l.score), depth: r.depth, bound: false }));
      return { best: lines[0]?.move ?? null, lines, depth: r.depth, nodes };
    },
  };
}

const GAMES = {
  // A mate at the end, and a queen sacrifice before it: mate scores at both ends.
  opera: '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 '
    + '11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8#',
  // Several missed mates, and pieces left hanging: the tactic check runs.
  rout: '1. Nf3 Nc6 2. d4 d5 3. Nc3 Nf6 4. Be3 e6 5. Nd2 Ng4 6. Bh6 Nxh6 7. Rb1 Nxd4 8. e4 dxe4 9. Ndxe4 c6 10. f4 Nhf5 '
    + '11. Nc5 Bxc5 12. Bd3 Qh4+ 13. g3 Nxg3 14. hxg3 Qxh1+ 15. Bf1 Qh2 16. Qc1 Nf3+ 17. Kd1 Qf2 18. Ne4 Qxf1#',
};

for (const [name, pgn] of Object.entries(GAMES)) {
  const parsed = parsePgn(pgn);
  for (const side of ['white', 'black']) {
    const settings = { nodes: 20000, depth: 7, yieldEvery: 0 };
    const direct = await reviewGame(parsed, side, settings);
    const judge = fakeJudge(7);
    const judged = await reviewGame(parsed, side, { ...settings, judge });
    const view = (r) => ({
      curve: r.whiteCp,
      marks: r.judged.map((j) => j.cls).join(' '),
      best: r.judged.map((j) => j.best?.uci ?? '-').join(' '),
      mistakes: r.mistakes.map((m) => `${m.ply}:${m.severity}:${m.kind}:${m.loss}:${m.themes.join('+')}`),
      tactics: r.tactics.map((t) => `${t.ply}:${t.best.uci}:${t.mate}:${t.edge}:${t.line}`),
      passed: r.tacticsPassed,
      meanLoss: r.meanLoss,
    });
    check(`${name}, as ${side}: the judged review is the direct one`, view(judged), view(direct));
    check(`${name}, as ${side}: and says who judged it`, [direct.judge, judged.judge], ['app', 'fake']);
    // Told the game: position i came with the first i moves, from the start.
    const told = judge.asked.filter((a) => a.multipv === 1);
    const ucis = parsed.plies.map((p) => p.uci);
    check(`${name}, as ${side}: every position came with the moves that led to it`,
      told.every((a) => JSON.stringify(a.moves) === JSON.stringify(ucis.slice(0, a.moves.length)) && a.fen === told[0].fen), true);
    check(`${name}, as ${side}: and every position was asked about once`,
      told.map((a) => a.moves.length).join(','), Array.from({ length: told.length }, (_, i) => i).join(','));
  }
}

// The mates, read the same both ways: a mate in N moves for the side to move,
// and mated in N, round-trip through UCI to the score the engine wrote.
const scoreToApp = js('scoreToApp');
const round = [29999, 29997, 29995, -29998, -29996, 0, 250, -80].map((s) => scoreToApp(uciScore(s)));
check('mate scores survive the round trip through UCI', round, [29999, 29997, 29995, -29998, -29996, 0, 250, -80]);

console.log(`${checks} checks, ${failures} failed`);
if (failures) process.exit(1);
