// The clock, read back out of the movetext.
//
// A clock attached to the wrong move is worse than no clock: it reports time
// trouble in the wrong half of the game, and there is nothing on screen that
// would let you tell. So what is checked here is mostly the REFUSALS — the
// shapes of game that cannot be lined up move-for-move have to come back as
// "no answer" rather than as an answer that is off by one.
import { readFileSync } from 'node:fs';

const src = [
  readFileSync(new URL('../src/engine/bundle.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/notation.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/pgn.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/import.js', import.meta.url), 'utf8'),
].join('\n');
const S = new Function('window', 'localStorage', src
  + '; return { parsePgn, clocksFrom, timeControlOf, timeSpent, chessComGame, chessComMonth };')({}, undefined);

let pass = 0;
const fails = [];
const eq = (what, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('ok  ', what); }
  else { fails.push(what); console.log('FAIL', what, '\n     got  ', g, '\n     want ', w); }
};

// A game in the shape Chess.com actually sends: a clock comment after every
// single ply, tenths on the ones that have them.
const CLOCKED = `[Event "Live Chess"]
[White "you"]
[Black "them"]
[Result "1-0"]
[TimeControl "180+2"]

1. e4 {[%clk 0:03:00.9]} 1... e5 {[%clk 0:02:58]} 2. Nf3 {[%clk 0:02:55.4]} 2... Nc6 {[%clk 0:02:30]} 3. Bb5 {[%clk 0:02:50]} 1-0`;

const parsed = S.parsePgn(CLOCKED);
eq('the moves still parse with clocks in the way', parsed.plies.map((p) => p.san), ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
eq('one clock per ply, in seconds', S.clocksFrom(CLOCKED, parsed.plies.length), [180.9, 178, 175.4, 150, 170]);

eq('the time control reads base and increment', S.timeControlOf('180+2'), { base: 180, increment: 2 });
eq('and a bare one has no increment', S.timeControlOf('600'), { base: 600, increment: 0 });
// A day a move says nothing about how long anybody thought.
eq('correspondence is refused', S.timeControlOf('1/86400'), null);
eq('as is an absent header', S.timeControlOf(undefined), null);

// White started on 180 with a 2s increment and came out of move 1 on 180.9,
// so move 1 took 1.1s. Black's move 2 (ply 4) is 178 -> 150 plus the 2s
// increment: 30s.
const spent = S.timeSpent(S.clocksFrom(CLOCKED, 5), S.timeControlOf('180+2'));
eq('each move timed against that player\'s own previous one',
  spent.map((s) => (s === null ? null : Math.round(s * 10) / 10)), [1.1, 4, 7.5, 30, 7.4]);

// ── the refusals ──────────────────────────────────────────────────────────
const HALF = `[TimeControl "600"]

1. e4 {[%clk 0:09:57]} e5 2. Nf3 {[%clk 0:09:50]} Nc6 3. Bb5`;
eq('a game clocked on only some moves gives no answer',
  S.clocksFrom(HALF, S.parsePgn(HALF).plies.length), null);
eq('and a game with none at all', S.clocksFrom('1. e4 e5 2. Nf3', 3), null);
// Counting is only sound when there is one clock per move; a variation
// carrying its own would shift every clock after it onto the wrong move.
const VAR = `[TimeControl "600"]

1. e4 {[%clk 0:09:57]} 1... e5 {[%clk 0:09:55]} (1... c5 {[%clk 0:09:40]}) 2. Nf3 {[%clk 0:09:50]}`;
eq('a variation with its own clock is refused rather than shifted',
  S.clocksFrom(VAR, S.parsePgn(VAR).plies.length), null);
// Time added by an opponent, or a header that does not describe the game,
// makes the clock go UP. That is not a fast move.
eq('a clock that goes up is not reported as no time taken',
  S.timeSpent([100, 100, 130], { base: 100, increment: 0 }), [0, 0, null]);
eq('and with no time control the first move of each side is unknown',
  S.timeSpent([100, 98, 90, 80], null), [null, null, 10, 18]);

// ── what the importer now keeps ───────────────────────────────────────────
const api = (over = {}) => ({
  url: 'https://www.chess.com/game/live/1',
  pgn: CLOCKED,
  end_time: 1700000000,
  rated: true,
  time_class: 'blitz',
  time_control: '180+2',
  white: { username: 'you', rating: 1043, result: 'win' },
  black: { username: 'them', rating: 1128, result: 'checkmated' },
  ...over,
});

const mine = S.chessComGame(api(), 'you');
eq('the importer keeps YOUR rating for the game', mine.myRating, 1043);
eq('and theirs', mine.theirRating, 1128);
eq('and the time control the clocks need', mine.timeControl, '180+2');
eq('from the black side it is the other way round',
  [S.chessComGame(api(), 'them').myRating, S.chessComGame(api(), 'them').theirRating], [1128, 1043]);
// An unrated game's number is not a rating and must never reach a rating chart.
eq('an unrated game carries no rating', S.chessComGame(api({ rated: false }), 'you').myRating, null);
eq('nor does one the API sent without one',
  S.chessComGame(api({ white: { username: 'you', rating: undefined, result: 'win' } }), 'you').myRating, null);

// ── and that a game already stored gains what it was missing ──────────────
//
// Every game imported before the ratings were kept has none. An import that
// only ever adds would leave a rating chart that begins the day the feature
// shipped, with hundreds of games behind it whose numbers are one request
// away — so a duplicate is filled in rather than skipped.
const stored = [{
  url: 'https://www.chess.com/game/live/1', at: 1700000000000, side: 'white',
  reviewed: true, accuracy: 71, myRating: null, timeControl: undefined,
}];
const again = S.chessComMonth([api()], 'you', stored);
eq('an already-stored game is still a duplicate', [again.rows.length, again.duplicate], [0, 1]);
eq('and it is counted as filled in', again.updated, 1);
eq('the rating lands on the stored row', [stored[0].myRating, stored[0].theirRating], [1043, 1128]);
eq('and so does the time control', stored[0].timeControl, '180+2');
// The importer must never reach into what a review worked out.
eq('nothing the review found is touched', stored[0].accuracy, 71);
// Running it a third time has nothing left to do.
eq('a second pass reports no further change', S.chessComMonth([api()], 'you', stored).updated, 0);

console.log(`\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) { console.log('FAILED\n  ' + fails.join('\n  ')); process.exit(1); }
