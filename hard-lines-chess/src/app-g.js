// ── the openings his own opponents actually play ───────────────────────────
//
// Every other opening book answers "what is theoretically best". This one
// answers "what do the people on the other side of the board from me
// habitually do", which is the question that decides what he keeps having to
// face. A book built from master games would walk him into lines he will never
// see; this one walks him into the ones he meets every week.
//
// ONLY THE OPPONENT'S MOVES GO IN. A book of his own moves would be a machine
// for playing him against himself, and the first thing it would teach him is
// his own habits back.
//
// Built from the games already stored — the ones he played here and the ones
// he pasted into Review — weighted by how often each reply actually appeared.
const Book = {
  built: null,      // move-sequence key -> { uci: times }
  games: 0,
  replies: 0,
  skipped: 0,       // games from a set-up position, which have no place in a book keyed from move one
};

/** Beyond this many plies a "book" is a transcript of one game, not a habit. */
const BOOK_MAX_PLIES = 16;

function buildBook() {
  const book = {};
  let games = 0;
  let skipped = 0;

  const sources = [];
  for (const g of App.history.games) if (g.pgn) sources.push({ pgn: g.pgn, mine: g.colour, from: g.from ?? null });
  for (const r of App.reviews.games) if (r.pgn) sources.push({ pgn: r.pgn, mine: r.side, from: null });

  for (const source of sources) {
    let parsed;
    try { parsed = parsePgn(source.pgn); } catch { continue; }
    if (!parsed.plies.length) continue;
    // A GAME FROM A SET-UP POSITION IS NOT USED. Its plies are keyed by the
    // moves before them, and from a set-up position there are none: a pasted
    // game that began after 1.e4 e5 filed its 2.Nf3 as an answer to nothing,
    // and the book offered 1.Nf3 at the start "because your opponent played
    // it". Counted, and said on the note, rather than dropped quietly.
    if (source.from || parsed.startFen) { skipped++; continue; }
    games++;

    const theirs = source.mine === 'white' ? 'black' : 'white';
    const history = [];
    for (const ply of parsed.plies.slice(0, BOOK_MAX_PLIES)) {
      if (ply.colour === theirs) {
        const key = history.join(' ');
        book[key] ??= {};
        book[key][ply.uci] = (book[key][ply.uci] ?? 0) + 1;
      }
      history.push(ply.uci);
    }
  }

  Book.built = book;
  Book.games = games;
  Book.skipped = skipped;
  Book.replies = Object.values(book).reduce((n, m) => n + Object.keys(m).length, 0);
  return book;
}

/**
 * A reply from the book for this exact sequence, sampled by how often it was
 * actually played, or null.
 *
 * WHETHER THE BOOK IS IN PLAY IS DECIDED HERE, from the game that was frozen
 * at its start and from whether there is a book at all — not from a flag a
 * note-writer set at boot. The note used to switch the book off when it found
 * no games, and nothing switched it back on until the page was reloaded.
 *
 * SAMPLED, NOT THE MOST COMMON. Always taking the most frequent reply turns a
 * book of five different answers into one answer, and he would face the same
 * game every time — which is the opposite of what the book is for.
 */
function bookReply(history) {
  if (!Play.game?.useBook || Play.game.startFen) return null;
  if (history.length >= BOOK_MAX_PLIES) return null;
  const book = Book.built ?? buildBook();
  if (!Book.games) return null;
  const replies = book[history.join(' ')];
  if (!replies) return null;

  const total = Object.values(replies).reduce((a, b) => a + b, 0);
  let pick = Math.random() * total;
  for (const [uci, times] of Object.entries(replies)) {
    pick -= times;
    if (pick <= 0) return { uci, times, total };
  }
  return null;
}

/**
 * Rebuild the book from what is stored now and say what is in it. Called at
 * boot, when a game starts, when one finishes, and after a review is stored —
 * every time the set of games it is built from can have changed.
 *
 * It does not touch `Play.useBook`: the toggle is his choice and this only
 * reports whether there is anything for the choice to apply to.
 */
function refreshBook() {
  Book.built = null;
  buildBook();
  const note = $('bookNote');
  const positions = Object.keys(Book.built).length;
  const toggle = $('bookToggle');
  const unused = Book.skipped
    ? ` ${Book.skipped} ${Book.skipped === 1 ? 'game' : 'games'} from a set-up position ${Book.skipped === 1 ? 'is' : 'are'} not used.`
    : '';
  if (!Book.games) {
    note.textContent = `No games stored yet, so there is no book. Play a few, or paste some into Review, and its opening moves will start coming from what your opponents actually played against you.${unused}`;
    toggle.disabled = true;
    return;
  }
  toggle.disabled = false;
  note.textContent = `${Book.replies} ${Book.replies === 1 ? 'reply' : 'replies'} across ${positions} ${positions === 1 ? 'position' : 'positions'}, from ${Book.games} of your games. Only your opponents' moves are in it, and only the first ${BOOK_MAX_PLIES / 2} moves of a game.${unused}`;
}

// ── the clock ──────────────────────────────────────────────────────────────
//
// Pure arithmetic, and nothing else: every time value is passed in, which is
// what makes "does he flag on this move" something a test can assert without
// waiting ten minutes.
//
// THE INVARIANT: HIS CLOCK IS CHARGED ONLY FOR TIME THE BOARD WAS
// INTERACTIVE. The coach's look locks the board, so the tick stops for it and
// `startedAt` is reset when it ends; a take-back puts both clocks back to
// what they read after the last move still standing. Everything that stops
// or restarts the tick goes through startClockTick()/stopClockTick(), and
// chargeClock() measures from the `startedAt` the last of those set.
const TIME_CONTROLS = [
  { id: 'none', label: 'No clock', initial: null, increment: 0 },
  { id: '3+2', label: '3 minutes, 2 seconds a move', initial: 180000, increment: 2000 },
  { id: '5+0', label: '5 minutes', initial: 300000, increment: 0 },
  { id: '10+5', label: '10 minutes, 5 seconds a move', initial: 600000, increment: 5000 },
  { id: '15+10', label: '15 minutes, 10 seconds a move', initial: 900000, increment: 10000 },
];

/** The control of the game being played — the frozen one, never the picker. */
function clockControl() {
  return Play.game?.control ?? null;
}

function clockOn() {
  const control = clockControl();
  return !!control && control.initial !== null;
}

/**
 * What is left after a move that took `elapsed`, increment included.
 *
 * Returns a NEGATIVE number when the move took longer than the clock had.
 * Deliberately not floored at zero: the caller has to be able to tell
 * "finished with nothing left" from "moved after the flag fell", and clamping
 * here erases the difference. Increment is only credited to a clock that
 * survived — a player who has already flagged does not earn time for the move
 * that flagged them.
 */
function clockAfter(remaining, elapsed, increment) {
  const left = remaining - elapsed;
  return left < 0 ? left : left + increment;
}

const clockText = (ms) => {
  if (ms === null || ms === undefined) return '—';
  const safe = Math.max(0, ms);
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  // Under ten seconds the tenths are the whole point.
  if (safe < 10000) return `${(safe / 1000).toFixed(1)}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

function renderClocks() {
  const on = clockOn();
  $('playClocks').hidden = !on;
  if (!on) return;
  $('clockMine').textContent = clockText(Play.clock.mine);
  $('clockTheirs').textContent = clockText(Play.clock.theirs);
  const myTurn = Play.view.board.turn === Play.myColour && !Play.over;
  $('clockMineBox').classList.toggle('running', myTurn);
  $('clockTheirsBox').classList.toggle('running', !myTurn && !Play.over);
  $('clockMineBox').classList.toggle('low', Play.clock.mine < 30000);
  $('clockTheirsBox').classList.toggle('low', Play.clock.theirs < 30000);
}

/** The display ticks; only a completed move decides that time has run out. */
function startClockTick() {
  stopClockTick();
  if (!clockOn()) return;
  Play.clock.startedAt = Date.now();
  Play.clock.ticker = setInterval(() => {
    if (Play.over) return;
    const spent = Date.now() - Play.clock.startedAt;
    const mine = Play.view.board.turn === Play.myColour;
    const left = (mine ? Play.clock.mine : Play.clock.theirs) - spent;
    if (left <= 0) {
      // The flag falls on the display too, or a player watches zero sit there
      // while nothing happens.
      if (mine) { Play.clock.mine = 0; finishPlay('flagged_you'); }
      else { Play.clock.theirs = 0; finishPlay('flagged_them'); }
      stopClockTick();
      return;
    }
    $(mine ? 'clockMine' : 'clockTheirs').textContent = clockText(left);
    $(mine ? 'clockMineBox' : 'clockTheirsBox').classList.toggle('low', left < 30000);
  }, 100);
}

function stopClockTick() {
  clearInterval(Play.clock.ticker);
  Play.clock.ticker = null;
}

/** Charge the side that just moved, and say whether they survived it. */
function chargeClock(mover) {
  if (!clockOn()) return true;
  const elapsed = Date.now() - (Play.clock.startedAt ?? Date.now());
  const key = mover === Play.myColour ? 'mine' : 'theirs';
  Play.clock[key] = clockAfter(Play.clock[key], elapsed, clockControl().increment);
  Play.clock.startedAt = Date.now();
  return Play.clock[key] >= 0;
}
