// Every famous game, replayed on the board.
//
// These move lists came from outside this repository, which makes them the
// least trustworthy data in it: a single wrong character in eighty-seven plies
// is a game that is not the game it says it is. So none of them is taken on
// faith. Each is replayed from the starting position through the app's own
// move generator, and a game that does not replay does not ship.
//
// Where the record says mate, the final position has to BE mate. Where it says
// a player resigned, nothing here can check that — a resignation is a fact
// about a room, not about a position — and the file marks those differently
// rather than implying the board proves them.
//
// Each note quotes the move it is about. The quote is checked against the move
// actually at that ply, so a note cannot drift off its move when a game is
// edited.
import { readFileSync } from 'node:fs';
import { Board } from '../src/engine/core.js';

const load = (path, name) => {
  const src = readFileSync(new URL(path, import.meta.url), 'utf8');
  const scope = {};
  new Function('exports', src + `\nexports.${name} = ${name};`)(scope);
  return scope[name];
};

// sanToMove and toSan live in files that need each other; the notation and pgn
// sources are read together the way the page concatenates them.
const helpers = (() => {
  const src = [
    readFileSync(new URL('../src/engine/bundle.js', import.meta.url), 'utf8'),
    readFileSync(new URL('../src/notation.js', import.meta.url), 'utf8'),
    readFileSync(new URL('../src/pgn.js', import.meta.url), 'utf8'),
  ].join('\n');
  return new Function('window', 'localStorage', src + '; return { sanToMove, toSan, Board };')({}, undefined);
})();

const FAMOUS_GAMES = load('../src/famous.js', 'FAMOUS_GAMES');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; } else { fail++; console.log('  FAIL', name, extra); }
};

/** The move list as bare SAN, the way the app will replay it. */
const sansOf = (game) => game.moves
  .replace(/\d+\.(\.\.)?/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .split(' ')
  .filter(Boolean);

const ids = new Set();
let totalPlies = 0;

for (const game of FAMOUS_GAMES) {
  ok(`${game.id}: id is unique`, !ids.has(game.id));
  ids.add(game.id);

  for (const field of ['title', 'white', 'black', 'event', 'result', 'ending', 'why', 'moves']) {
    ok(`${game.id}: has ${field}`, typeof game[field] === 'string' && game[field].length > 0);
  }
  ok(`${game.id}: the year is a year`, Number.isInteger(game.year) && game.year > 1400 && game.year < 2100);
  ok(`${game.id}: the result is a result`, ['1-0', '0-1', '1/2-1/2'].includes(game.result));
  ok(`${game.id}: says how it ended`, ['checkmate', 'resigned', 'agreed', 'flagged'].includes(game.ending));
  ok(`${game.id}: says why it matters`, game.why.length > 120);

  // ── the moves, one at a time, on a real board ──────────────────────────
  const board = new helpers.Board();
  const sans = sansOf(game);
  const played = [];
  let illegalAt = null;
  for (let i = 0; i < sans.length; i++) {
    const move = helpers.sanToMove(board, sans[i]);
    if (!move) { illegalAt = `${Math.floor(i / 2) + 1}${i % 2 ? '...' : '.'} ${sans[i]} (ply ${i + 1})`; break; }
    played.push(sans[i]);
    board.make(move);
  }
  ok(`${game.id}: every move is legal (${sans.length} plies)`, illegalAt === null, illegalAt ? `illegal at ${illegalAt}` : '');
  if (illegalAt) continue;
  totalPlies += sans.length;

  // ── the ending ─────────────────────────────────────────────────────────
  const outcome = board.outcome();
  if (game.ending === 'checkmate') {
    ok(`${game.id}: the mate is really mate`, outcome === 'checkmate', `board says ${outcome ?? 'unfinished'}`);
    // A game that ends in mate must be written as ending in mate.
    ok(`${game.id}: the last move is marked #`, sans[sans.length - 1].endsWith('#'));
    // And the side that mated has to be the side the result says won.
    const winnerIsWhite = sans.length % 2 === 1;
    ok(`${game.id}: the result matches who mated`, game.result === (winnerIsWhite ? '1-0' : '0-1'));
  } else {
    // A RESIGNATION IS NOT ON THE BOARD. The position at the end of these is
    // simply lost, and the app must not claim the board proves otherwise.
    ok(`${game.id}: a resignation is not dressed as a mate`, outcome !== 'checkmate',
      'the board says checkmate but the game is filed as a resignation');
  }

  // ── the notes point at the moves they quote ────────────────────────────
  ok(`${game.id}: has moments worth stopping on`, Array.isArray(game.moments) && game.moments.length >= 2);
  for (const moment of game.moments ?? []) {
    ok(`${game.id}: moment ply ${moment.ply} is in the game`,
      Number.isInteger(moment.ply) && moment.ply >= 1 && moment.ply <= sans.length);
    if (!(moment.ply >= 1 && moment.ply <= sans.length)) continue;
    const actual = sans[moment.ply - 1];
    // The quoted move must be the move at that ply, ignoring the check and
    // mate marks, which different sources punctuate differently.
    const bare = (s) => s.replace(/[+#!?]+$/, '');
    ok(`${game.id}: ply ${moment.ply} really is ${moment.san}`, bare(actual) === bare(moment.san),
      `ply ${moment.ply} is ${actual}`);
    ok(`${game.id}: the note at ply ${moment.ply} says something`,
      typeof moment.note === 'string' && moment.note.length > 30);
  }
}

console.log(`${FAMOUS_GAMES.length} games, ${totalPlies} plies replayed, ${pass} checks passed, ${fail} failed`);
if (fail) process.exit(1);
