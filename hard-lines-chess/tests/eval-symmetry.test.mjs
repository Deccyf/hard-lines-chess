// The evaluation, and its mirror image.
//
// A CHESS EVALUATION HAS TO BE COLOUR-BLIND. Take any position, turn the board
// upside down and swap every piece's colour, and you have a position that is
// exactly as good for Black as the original was for White. An engine whose
// score does not negate under that transform has a colour bias — it thinks one
// side is worth a little more than the other for no reason on the board.
//
// This one did. Not by much: one centipawn, on 337 of 7166 positions walked,
// always in White's favour. The cause was Math.round, which sends a half
// towards positive infinity — round(10.5) is 11 and round(-10.5) is -10 — so a
// position and its mirror came out 11 and 10. There was already a comment in
// the evaluation saying the rounding was done "so the mirrored position scores
// the exact negative". It said so; it did not do so. Nothing measured it.
//
// Now something does. The tolerance is zero, because there is no honest reason
// for a single centipawn of difference.
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/engine/bundle.js', import.meta.url), 'utf8');
const { Board, evaluate } = new Function('window', src + '; return { Board, evaluate };')({});

/**
 * The same position, upside down, with every piece the other colour.
 *
 * Ranks reverse, cases swap, castling rights swap with them, the side to move
 * swaps, and the en passant square moves to the mirrored rank. Everything the
 * FEN says has to be mirrored or the two positions are not each other.
 */
function mirror(fen) {
  const [placement, turn, castling, ep, half, full] = fen.split(' ');
  const swapCase = (s) => s.replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
  return [
    placement.split('/').reverse().map(swapCase).join('/'),
    turn === 'w' ? 'b' : 'w',
    castling === '-' ? '-' : swapCase(castling).split('').sort().join(''),
    ep === '-' ? '-' : ep[0] + String(9 - Number(ep[1])),
    half, full,
  ].join(' ');
}

// A fixed seed, so a failure here is one anybody can reproduce.
let seed = 7;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

let positions = 0, asymmetric = 0;
const examples = [];
for (let game = 0; game < 120; game++) {
  const board = new Board();
  for (let ply = 0; ply < 60; ply++) {
    const legal = board.legalMoves();
    if (!legal.length || board.outcome()) break;
    const fen = board.fen();
    positions++;
    const here = evaluate(new Board(fen));
    const there = evaluate(new Board(mirror(fen)));
    if (here !== there) {
      asymmetric++;
      if (examples.length < 3) examples.push(`${fen}  scored ${here}, its mirror ${there}`);
    }
    board.make(legal[Math.floor(rand() * legal.length)]);
  }
}

// A HANDFUL BY HAND, so a walk that somehow never reached an odd half still
// checks the thing this file is about.
const byHand = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
  '8/4P3/8/8/8/8/8/4K2k w - - 0 1',
  '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
  '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
];
let handBad = 0;
for (const fen of byHand) {
  positions++;
  if (evaluate(new Board(fen)) !== evaluate(new Board(mirror(fen)))) { handBad++; asymmetric++; }
}

// The starting position is level by inspection, whoever is to move.
const level = evaluate(new Board()) === 0;

console.log(`${positions} positions, ${asymmetric} where the mirror did not agree`);
console.log(`the starting position scores ${evaluate(new Board())}`);
if (!level) console.log('  FAIL the starting position is not level');
for (const e of examples) console.log('  ' + e);
if (asymmetric || !level) process.exit(1);
console.log('the evaluation is colour-blind.');
