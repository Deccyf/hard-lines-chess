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
  readFileSync(new URL('../src/motifs.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/rating-fit.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/review.js', import.meta.url), 'utf8'),
].join('\n');
const S = new Function('window', 'localStorage', src
  + '; return { parsePgn, clocksFrom, timeControlOf, timeSpent, chessComGame, chessComMonth, importSummary, timeTrouble, lossesFromStore, judgedFromStore, headerOf, marksOf, SPENT_BUCKETS, LEFT_BUCKETS, bucketFor };')({}, undefined);

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

// ── and that a game you pasted in is recognised when it arrives ────────────
//
// A game pasted into Review has no Chess.com link and the time it was
// reviewed, not played, so neither the link nor the time can find it — and
// it used to be stored a second time, both copies counted on every chart. It
// is found by its moves instead, and joined.
{
  const pasted = [{
    at: 1800000000000, side: 'white', white: 'you', black: 'them', reviewed: undefined, accuracy: 64, meanLoss: 90,
    pgn: '[White "you"] [Black "them"]\n1. e4 e5 2. Nf3 Nc6 3. Bb5',
    curve: [0, 30, 20, 40, 30, 50], marks: '.....',
  }];
  const month = S.chessComMonth([api()], 'you', pasted);
  eq('a game pasted in earlier is not stored twice', [month.rows.length, month.duplicate, month.joined], [0, 1, 1]);
  eq('it becomes the Chess.com game: link, rating, clocks',
    [pasted[0].url, pasted[0].myRating, pasted[0].timeControl, pasted[0].source, /%clk/.test(pasted[0].pgn)],
    ['https://www.chess.com/game/live/1', 1043, '180+2', 'chess.com', true]);
  eq('with the same moves, so the review still lines up with them',
    S.parsePgn(pasted[0].pgn).plies.map((p) => p.uci), ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5']);
  eq('and nothing the review found is touched', [pasted[0].accuracy, pasted[0].meanLoss, pasted[0].marks], [64, 90, '.....']);
  eq('the summary says so', /1 of those you had already reviewed by pasting it in/.test(S.importSummary({ found: 1, duplicate: 1, joined: 1, months: 1 })), true);
  eq('a second pass finds it by its link', S.chessComMonth([api()], 'you', pasted).joined, 0);

  const other = [{ at: 1800000000000, side: 'white', pgn: '1. e4 e5 2. Nf3 Nc6 3. Bc4', accuracy: 50 }];
  eq('a different game is not joined', S.chessComMonth([api()], 'you', other).rows.length, 1);
  const theirSide = [{ at: 1800000000000, side: 'black', pgn: '1. e4 e5 2. Nf3 Nc6 3. Bb5', accuracy: 50 }];
  eq('nor the same game reviewed from the other side', S.chessComMonth([api()], 'you', theirSide).rows.length, 1);
}

// ── where the time goes, without replaying eight thousand moves ───────────
//
// timeTrouble() used to parse every game and rebuild its whole move list to
// read two fields off it: whether a move was yours and what it cost. Both fall
// out of the stored curve and the ply index, so it no longer parses at all —
// which took the Progress screen's first paint over a couple of hundred games
// from about six hundred milliseconds to about ten.
//
// A FASTER ANSWER IS ONLY WORTH ANYTHING IF IT IS THE SAME ANSWER. The old
// implementation is written out here and both are run over the same corpus;
// every bucket, every count and every mean has to match exactly.
const oldTimeTrouble = (games) => {
  const spentRows = S.SPENT_BUCKETS.map((b) => ({ ...b, n: 0, lost: 0, blunders: 0 }));
  const leftRows = S.LEFT_BUCKETS.map((b) => ({ ...b, n: 0, lost: 0, blunders: 0 }));
  let used = 0, skipped = 0, moves = 0;
  for (const game of games ?? []) {
    if (!game?.pgn || !Array.isArray(game.curve) || typeof game.marks !== 'string') { skipped++; continue; }
    let parsed;
    try { parsed = S.parsePgn(game.pgn); } catch { skipped++; continue; }
    const clocks = S.clocksFrom(game.pgn, parsed.plies.length);
    if (!clocks) { skipped++; continue; }
    const control = S.timeControlOf(parsed.headers?.TimeControl ?? game.timeControl);
    const spent = S.timeSpent(clocks, control);
    if (!spent) { skipped++; continue; }
    const judged = S.judgedFromStore(parsed, game.curve, game.marks, game.side ?? 'white');
    if (!judged.length) { skipped++; continue; }
    used++;
    for (let i = 0; i < judged.length; i++) {
      const j = judged[i];
      if (!j.mine || !Number.isFinite(j.loss)) continue;
      const took = spent[i];
      if (!Number.isFinite(took)) continue;
      moves++;
      const before = clocks[i] + took - (control?.increment ?? 0);
      for (const [rows, value] of [[spentRows, took], [leftRows, before]]) {
        const row = S.bucketFor(rows, value);
        row.n++; row.lost += Math.min(300, j.loss);
        if (j.loss >= 300) row.blunders++;
      }
    }
  }
  const finish = (rows) => rows.map((r) => ({ label: r.label, n: r.n,
    meanLoss: r.n ? r.lost / r.n : null, blunderRate: r.n ? r.blunders / r.n : null }));
  return { spent: finish(spentRows), left: finish(leftRows), used, skipped, moves };
};

// A corpus with the awkward cases in it, not just the happy one.
const corpus = [];
{
  const MOVES = ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','d6','c3','O-O','h3','Nb8','d4','Nbd7'];
  const CHARS = '*.?!X';
  for (let g = 0; g < 24; g++) {
    const n = 6 + (g % 15);                      // games of different lengths
    let w = 300 + g * 7, b = 300 + g * 5; const parts = [];
    for (let i = 0; i < n; i++) {
      const white = i % 2 === 0;
      const took = (g % 4 === 0) ? 1 + (i % 3) : 5 + ((i * 7 + g) % 40);
      if (white) w = Math.max(1, w - took); else b = Math.max(1, b - took);
      const left = Math.round(white ? w : b);
      parts.push(`${white ? `${i / 2 + 1}. ` : `${(i + 1) / 2}... `}${MOVES[i]}`
        + (g % 7 === 3 && i === 2 ? '' : ` {[%clk 0:${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}]}`));
    }
    const tc = ['600', '180+2', '1/86400', '-'][g % 4];
    const pgn = `[Event "T"]\n[White "you"]\n[Black "opp"]\n[Result "1-0"]\n[TimeControl "${tc}"]\n\n${parts.join(' ')} 1-0`;
    const curve = [0];
    for (let i = 0; i < n; i++) curve.push(curve[i] + (((i * 53 + g * 11) % 700) - 350));
    corpus.push({ at: g, side: g % 5 === 0 ? 'black' : 'white', pgn, curve, plies: n,
      marks: Array.from({ length: n }, (_, i) => CHARS[(i + g) % CHARS.length]).join('') });
  }
  // and the shapes that must be refused
  corpus.push({ at: 99, side: 'white', pgn: '1. e4 e5', curve: [0, 5, 5], marks: '..' });   // no clocks
  corpus.push({ at: 98, side: 'white', pgn: corpus[0].pgn });                                // never reviewed
  // A curve that stops short of the game: the moves it does cover still count,
  // which is why the clock check uses the game's ply count and not the curve's.
  corpus.push({ at: 97, side: 'white', pgn: corpus[0].pgn, plies: corpus[0].plies, curve: [0, 1], marks: 'X' });
  // And one with no stored ply count at all, as an older record has.
  corpus.push({ at: 96, side: 'white', pgn: corpus[1].pgn, curve: corpus[1].curve, marks: corpus[1].marks });
}
const slow = oldTimeTrouble(corpus);
const fast = S.timeTrouble(corpus);
eq('the corpus exercises both paths', [slow.used > 6, slow.skipped > 0, slow.moves > 40], [true, true, true]);
eq('same games used, same skipped, same moves', [fast.used, fast.skipped, fast.moves], [slow.used, slow.skipped, slow.moves]);
eq('every by-time-spent bucket identical', fast.spent, slow.spent);
eq('every by-clock-left bucket identical', fast.left, slow.left);

// And the parts, on their own.
eq('the header reader agrees with the parser',
  corpus.slice(0, 6).map((g) => S.headerOf(g.pgn, 'TimeControl')),
  corpus.slice(0, 6).map((g) => S.parsePgn(g.pgn).headers.TimeControl ?? null));
eq('a header that is not there is null', S.headerOf('1. e4 e5', 'TimeControl'), null);
{
  const g = corpus[1];
  const full = S.judgedFromStore(S.parsePgn(g.pgn), g.curve, g.marks, g.side);
  eq('losses read without the board match the full rebuild',
    S.lossesFromStore(g.curve, g.marks, g.side),
    full.map((j) => ({ mine: j.mine, loss: j.loss })));
}

console.log(`\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) { console.log('FAILED\n  ' + fails.join('\n  ')); process.exit(1); }
