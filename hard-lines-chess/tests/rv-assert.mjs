// One assertion per fix; exits 1 on the first failure. Used for the mutation tests.
import { readFileSync } from 'node:fs';
import { Board, mkMove, nameToSquare, moveToUci } from '../src/engine/core.js';
import { Engine } from '../src/engine/search.js';
const src = [readFileSync('../src/engine/bundle.js','utf8'), readFileSync('../src/engine/bands.js','utf8'), readFileSync('../src/notation.js','utf8'), readFileSync('../src/store.js','utf8'), readFileSync('../src/pgn.js','utf8')].join('\n');
const api = new Function('window', 'localStorage', src + '; return { parsePgn, fenProblem, SRS, Store, bandNoteDrift, Board };')({}, undefined);
let n = 0;
const check = (label, ok) => { n++; console.log((ok ? 'ok   ' : 'FAIL ') + label); if (!ok) process.exit(1); };

// 1. make() refuses a move that is not the side to move's piece
const start = new Board();
check('make() refuses a move from an empty square', start.make(mkMove(nameToSquare('b7'), nameToSquare('b8'), 5, 0)) === false && start.fen() === new Board().fen());
check('make() refuses moving the opponent\'s piece', start.make(mkMove(nameToSquare('e7'), nameToSquare('e5'), 0, 8)) === false && start.turn === 8);

// 2. SRS normalisation
const r1 = api.SRS.review({}, true), r2 = api.SRS.review(undefined, false), r3 = api.SRS.review({ interval: 3, seen: 2 }, true);
check('review({}) yields finite numbers', [r1.interval, r1.ease, r1.due, r1.lapses, r1.seen].every(Number.isFinite));
check('review(undefined) does not throw and is finite', [r2.interval, r2.ease, r2.due].every(Number.isFinite));
check('review(card without ease) is finite', Number.isFinite(r3.due) && Number.isFinite(r3.ease));
check('isDue treats a NaN due as due', api.SRS.isDue({ seen: 3, due: NaN }) === true);

// 3. castling reconciliation
const noRook = new Board('4k3/8/8/8/8/8/8/4K2N w K - 0 1');
check('castling right without a rook is dropped', noRook.castling === 0 && !noRook.legalMoves().some((m) => moveToUci(m) === 'e1g1'));
check('fenProblem names the dropped right', /kingside/.test(api.fenProblem('4k3/8/8/8/8/8/8/4K2N w K - 0 1') ?? ''));
check('a supported right is kept', new Board('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1').castling === 15 && api.fenProblem('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1') === null);

// 4. ep canonical -> repetition
const g = new Board(); const play = (u) => g.make(g.legalMoves().find((x) => moveToUci(x) === u));
for (const u of ['e2e4','g8f6','g1f3','f6g8','f3g1','g8f6','g1f3','f6g8','f3g1']) play(u);
check('threefold seen after 5.Ng1', g.outcome() === 'repetition');
check('ep square from a FEN dropped when no pawn can take', new Board('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1').ep === -1);
check('ep square kept when capturable', new Board('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3').ep >= 0);

// 5. pgn
const u = api.parsePgn('[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *');
check('"*" is a result, not a truncation', !u.truncated && u.unfinished === true && u.result === '*');
check('0-0 and b8Q read', !api.parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. 0-0').truncated && !api.parsePgn('[FEN "4k3/1P6/8/8/8/8/8/4K3 w - - 0 1"]\n\n1. b8Q').truncated);
check('header value with ] survives', api.parsePgn('[Event "x [y]"]\n1. e4 e5 2. Nf3 1-0').plies.length === 3);

// 6. bands
check('bandNoteDrift() is empty', api.bandNoteDrift().length === 0);

// 7. search
const e = new Engine();
check('blunder branch returns lines: []', Array.isArray(e.search(new Board(), { movetime: 30, maxDepth: 1, blunder: 1 }).lines));
check('TT entries carry a verification word', (() => { e.reset(); e.search(new Board(), { movetime: 100, maxDepth: 3 }); const [, v] = e.tt.entries().next().value; return typeof v.check === 'number'; })());
check('Board.clone() carries repetition', g.clone().repetition.length === g.repetition.length);
console.log(`${n} assertions pass`);
