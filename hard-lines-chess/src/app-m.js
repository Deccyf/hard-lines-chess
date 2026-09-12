// ── watching ───────────────────────────────────────────────────────────────
//
// Two things to watch and one way of watching them: a game between two bands
// of the ladder, played here and now, or one of the games in famous.js,
// replayed. Both step a move at a time with the engine saying what it makes of
// each one.
//
// WHERE THE COMMENTARY COMES FROM, in order, and all of it measured:
//
//   1. THE OPENING BOOK THIS APP ALREADY HAS. While the moves match one of the
//      openings in openings.js, the screen names it and prints that opening's
//      own note for the move just played — prose already checked against the
//      board by tools/verify-openings.mjs. That is what answers "why did they
//      play that": for the first ten or twelve moves the honest answer is
//      usually "because it is the line", and the line has a reason attached.
//
//   2. THE CURATED NOTE, for a famous game at a ply that has one. Those are
//      the only sentences here written by a person, and tests/famous.test.mjs
//      checks each one still quotes the move it is about.
//
//   3. A REFERENCE SEARCH, deeper than the band that played the move. If the
//      move played is not the one a stronger search wants, the difference is
//      the story — and in a game between a weak band and a strong one that is
//      most of the game. This is the only line on the screen that is generated
//      rather than written, and it is a measurement: two searches, a
//      difference in centipawns, printed as pawns.
//
// WHAT THIS SCREEN WILL NOT SAY. It does not tell you a player's plan, or what
// they were thinking, or why a human chose a move over the engine's. It cannot
// know any of that. It reports the book, the note, and the number.
//
// NO TWO BOT GAMES ARE THE SAME, and that needed arranging. Two engines at
// fixed settings play the same game every time, because nothing in them is
// random above the blunder rate. So the pairing is drawn fresh, the colours
// are drawn, one of the openings is drawn and played as the book, and the
// search is given a `randomness` window inside which it picks among moves it
// considers equal. Four dice, and the same two bands do not repeat a game.

const Watch = {
  source: 'bots',        // 'bots' | 'famous'
  title: '',
  whiteName: '',
  blackName: '',
  bands: null,           // { white, black } while a bot game is running
  famous: null,          // the entry from FAMOUS_GAMES
  book: [],              // the drawn opening's first plies, for a bot game
  bookName: null,
  sans: [],              // the moves so far, or the whole game for a replay
  ply: 0,                // how many of them are on the board
  board: null,
  playing: false,
  timer: null,
  speed: 1600,
  view: null,
  notes: [],             // ply -> commentary, worked out once and kept
  busy: false,
  generation: 0,
  finished: null,
};

/** How wide a window of "equally good" the two sides pick inside. */
const WATCH_RANDOMNESS = 40;
/** How many plies of a drawn opening to follow before they are on their own. */
const WATCH_BOOK_PLIES = 8;
// HOW STRONG THE PAIRING MAY BE, and this is a phone limit rather than a chess
// one. The top bands are given up to 2.4 seconds a move, and a 2.4-second
// search on the page's own thread is 2.4 seconds of a frozen board — on a
// screen whose whole purpose is watching, that reads as a crash. Capped here
// the slowest side thinks for a second, which is a pause rather than a hang.
const WATCH_WEAKEST = 3;   // BANDS[3]  — 300
const WATCH_STRONGEST = 17; // BANDS[17] — 1700, movetime 1000

// ── setting one up ─────────────────────────────────────────────────────────

function startWatchBots() {
  Watch.generation++;
  Watch.source = 'bots';
  Watch.famous = null;
  Watch.finished = null;

  // Four dice. A pairing, a side, an opening and, inside the search, a window.
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const spread = WATCH_STRONGEST - WATCH_WEAKEST;
  const weakIndex = WATCH_WEAKEST + Math.floor(Math.random() * (spread - 4));
  const strongIndex = Math.min(WATCH_STRONGEST, weakIndex + 4 + Math.floor(Math.random() * 6));
  const weakIsWhite = Math.random() < 0.5;
  Watch.bands = {
    white: BANDS[weakIsWhite ? weakIndex : strongIndex],
    black: BANDS[weakIsWhite ? strongIndex : weakIndex],
  };
  Watch.whiteName = `level ${bandLabelFor(Watch.bands.white.elo)}`;
  Watch.blackName = `level ${bandLabelFor(Watch.bands.black.elo)}`;
  Watch.title = `${bandLabelFor(Watch.bands.white.elo)} against ${bandLabelFor(Watch.bands.black.elo)}`;

  // The opening is DRAWN AND PLAYED AS THE BOOK, which is the difference
  // between a fresh game and the same one again. Both sides follow it; after
  // it they are on their own and the randomness window does the rest.
  const opening = pick(OPENINGS);
  Watch.book = opening.line.slice(0, WATCH_BOOK_PLIES);
  Watch.bookName = opening.name;

  resetWatch();
}

function startWatchFamous(game) {
  Watch.generation++;
  Watch.source = 'famous';
  Watch.famous = game;
  Watch.bands = null;
  Watch.book = [];
  Watch.bookName = null;
  Watch.finished = null;
  Watch.whiteName = game.white;
  Watch.blackName = game.black;
  Watch.title = game.title;
  Watch.sans = famousSans(game);
  resetWatch(true);
}

/** A game's move text as bare SAN, the way the board will replay it. */
function famousSans(game) {
  return game.moves
    .replace(/\d+\.(\.\.)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function resetWatch(keepMoves = false) {
  stopWatch();
  if (!keepMoves) Watch.sans = [];
  Watch.ply = 0;
  Watch.notes = [];
  Watch.busy = false;
  Watch.board = new Board();
  Watch.view.orientation = WHITE;
  Watch.view.setFen(Watch.board.fen());
  $('watchStage').hidden = false;
  // THE EXPLANATION GETS OUT OF THE WAY ONCE THERE IS A BOARD. On a phone the
  // setup panel sits above the stage, and six lines of prose about how the
  // pairing is drawn pushed the game most of a screen down — read once, in the
  // way ever after. The button stays; the paragraph goes.
  $('watchBlurb').hidden = true;
  renderWatch();
  explainWatchPly(0);
}

// ── stepping ───────────────────────────────────────────────────────────────

/**
 * Make sure there is a move at `ply`. A replay already has all of them; a bot
 * game grows one search at a time, which is also what makes stepping back and
 * forward through it cheap — the moves are kept, not searched again.
 */
function ensureWatchMove(ply) {
  if (Watch.sans.length >= ply) return true;
  if (Watch.source !== 'bots' || !Watch.bands) return false;

  const board = new Board();
  for (const san of Watch.sans) {
    const move = sanToMove(board, san);
    if (!move) return false;
    board.make(move);
  }
  const already = board.outcome();
  if (already) { Watch.finished = already; return false; }

  const index = Watch.sans.length;
  let move = null;
  if (index < Watch.book.length) move = sanToMove(board, Watch.book[index]);
  if (!move) {
    const band = board.turn === WHITE ? Watch.bands.white : Watch.bands.black;
    App.engine.reset();
    const result = App.engine.search(board, {
      movetime: band.movetime,
      maxDepth: band.depth,
      blunder: band.blunder,
      randomness: WATCH_RANDOMNESS,
    });
    move = result.move;
  }
  if (!move) return false;
  Watch.sans.push(toSan(board, move));
  return true;
}

/** Put the board at `ply` and say what the move that got there was. */
function goToWatchPly(ply) {
  ply = Math.max(0, Math.min(ply, Watch.sans.length));
  const board = new Board();
  for (let i = 0; i < ply; i++) {
    // A move that will not parse should stop the walk rather than throw. Both
    // sources of these are checked — toSan wrote them, or famous.test.mjs
    // replayed them — so this cannot happen today; if it ever does, the screen
    // stops where it stopped instead of the page going blank.
    const move = sanToMove(board, Watch.sans[i]);
    if (!move) { ply = i; break; }
    board.make(move);
  }
  Watch.board = board;
  Watch.ply = ply;
  Watch.view.setFen(board.fen());
  const outcome = board.outcome();
  if (outcome && ply >= Watch.sans.length) { Watch.finished = outcome; stopWatch(); }
  renderWatch();
  explainWatchPly(ply);
}

function stepWatch(forward = true) {
  if (Watch.busy) return;
  if (forward) {
    if (!ensureWatchMove(Watch.ply + 1)) { stopWatch(); renderWatch(); return; }
    const move = sanToMove(Watch.board, Watch.sans[Watch.ply]);
    if (!move) { stopWatch(); renderWatch(); return; }
    Watch.view.apply(move);
    Watch.board = new Board(Watch.view.board.fen());
    Watch.ply++;
    const outcome = Watch.board.outcome();
    if (outcome) { Watch.finished = outcome; stopWatch(); }
    renderWatch();
    explainWatchPly(Watch.ply);
  } else {
    if (Watch.ply === 0) return;
    stopWatch();
    goToWatchPly(Watch.ply - 1);
  }
}

function playWatch() {
  if (Watch.playing) return;
  if (!Watch.sans.length && Watch.source !== 'bots') return;
  Watch.playing = true;
  $('watchPlay').hidden = true;
  $('watchPause').hidden = false;
  const mine = Watch.generation;
  const tick = () => {
    if (!Watch.playing || mine !== Watch.generation) return;
    stepWatch(true);
    if (!Watch.playing) return;
    Watch.timer = setTimeout(tick, Watch.speed);
  };
  Watch.timer = setTimeout(tick, 200);
}

function stopWatch() {
  Watch.playing = false;
  clearTimeout(Watch.timer);
  Watch.timer = null;
  const play = $('watchPlay'), pause = $('watchPause');
  if (play) play.hidden = false;
  if (pause) pause.hidden = true;
}

// ── saying what happened ───────────────────────────────────────────────────

/**
 * Which opening the moves so far are still inside, and how far into it they
 * are. The longest match wins, so a line that is a prefix of two openings is
 * reported as whichever it has gone further into.
 */
function watchOpening(sans) {
  let best = null;
  for (const opening of OPENINGS) {
    let depth = 0;
    while (depth < sans.length && depth < opening.line.length && sans[depth] === opening.line[depth]) depth++;
    if (depth >= 4 && (!best || depth > best.depth)) best = { opening, depth };
  }
  return best;
}

/**
 * The note for a ply, worked out once and kept. The reference search — deeper
 * than the band that played the move — is what turns "it played Qh5" into "a
 * deeper search wanted Nc3, and this costs three pawns".
 */
function explainWatchPly(ply) {
  if (ply < 1) {
    $('watchMove').textContent = Watch.sans.length || Watch.source === 'bots' ? 'The starting position' : '';
    $('watchWhy').innerHTML = '';
    $('watchNote').textContent = Watch.source === 'bots' && Watch.bookName
      ? `They will follow the ${Watch.bookName} for the first ${WATCH_BOOK_PLIES / 2} moves, then they are on their own.`
      : 'Press play.';
    $('watchNote').className = 'note';
    return;
  }
  if (Watch.notes[ply]) { paintWatchNote(Watch.notes[ply]); return; }

  const before = new Board();
  for (let i = 0; i < ply - 1; i++) {
    const move = sanToMove(before, Watch.sans[i]);
    if (!move) return;
    before.make(move);
  }
  const played = Watch.sans[ply - 1];
  const mover = before.turn === WHITE ? 'White' : 'Black';
  const moverName = before.turn === WHITE ? Watch.whiteName : Watch.blackName;

  const note = { ply, played, mover, moverName, lines: [] };
  Watch.notes[ply] = note;

  // 1. The book, and its own reason for this move.
  const inBook = watchOpening(Watch.sans.slice(0, ply));
  if (inBook && inBook.depth >= ply) {
    const idea = inBook.opening.ideas?.[ply - 1];
    note.opening = `${inBook.opening.name} (${inBook.opening.eco})`;
    note.lines.push(idea ? `Still in the ${inBook.opening.name}. ${idea}` : `Still in the ${inBook.opening.name}.`);
    if (ply === 1 && inBook.opening.plan) note.lines.push(inBook.opening.plan);
  } else if (Watch.source === 'bots' && ply === Watch.book.length + 1) {
    note.lines.push('The book has run out. From here both sides are choosing for themselves.');
  }

  // 2. A curated note, where a person wrote one about this exact move.
  const moment = Watch.famous?.moments?.find((m) => m.ply === ply);
  if (moment) note.moment = moment.note;

  paintWatchNote(note);

  // 3. The reference search, deferred so the board paints first.
  Watch.busy = true;
  const mine = Watch.generation;
  requestAnimationFrame(() => setTimeout(() => {
    if (mine !== Watch.generation) { Watch.busy = false; return; }
    let judged = null;
    try {
      App.engine.reset();
      const result = App.engine.search(new Board(before.fen()), { movetime: 260, maxDepth: 12 });
      if (result.move) {
        const best = toSan(new Board(before.fen()), result.move);
        const after = new Board(before.fen());
        after.make(sanToMove(after, played));
        const ended = after.outcome();
        let scoreAfter;
        if (ended === 'checkmate') scoreAfter = CHECKMATE_SCORE;
        else if (ended) scoreAfter = 0;
        else {
          App.engine.reset();
          const reply = App.engine.search(after, { movetime: 200, maxDepth: 11 });
          scoreAfter = -reply.score;
        }
        judged = {
          best,
          loss: Math.max(0, result.score - scoreAfter),
          evalAfter: plainEval(scoreAfter, mover),
          // HOW DEEP THE OPINION IS, because it changes what the opinion is
          // worth. A quarter of a second on a phone does not see a piece
          // sacrifice through, and it will happily call one of the most famous
          // moves ever played "a little worse". Printing the depth is the
          // honest alternative to either hiding that or hedging it: the reader
          // can weigh six plies against a person who thought for an hour.
          depth: result.depth,
        };
      }
    } catch { judged = null; }
    Watch.busy = false;
    if (!judged || mine !== Watch.generation) return;
    note.judged = judged;
    if (Watch.ply === ply) paintWatchNote(note);
  }, 0));
}

function paintWatchNote(note) {
  const number = Math.ceil(note.ply / 2);
  $('watchMove').textContent = `${number}${note.ply % 2 ? '.' : '…'} ${note.played} — ${note.moverName}`;

  const why = $('watchWhy');
  why.innerHTML = '';
  if (note.moment) why.appendChild(el('p', 'idea', note.moment));
  for (const text of note.lines) why.appendChild(el('p', 'note', text));

  const box = $('watchNote');
  if (!note.judged) { box.textContent = 'Looking at it…'; box.className = 'note'; return; }
  const { best, loss, evalAfter, depth } = note.judged;
  // "A 5-PLY SEARCH" MEANS NOTHING TO A CHESS PLAYER. A ply is half a move —
  // one side's turn — and it is engine vocabulary, not chess vocabulary. What
  // a reader wants is how far ahead the machine looked, in the moves they
  // count themselves, so the depth is halved and said as "about", because
  // halving an odd number is a rounding and should sound like one.
  const how = depth ? `Looking about ${Math.max(1, Math.round(depth / 2))} ${Math.round(depth / 2) === 1 ? 'move' : 'moves'} ahead, the engine` : 'A deeper search';
  if (best === note.played || loss < 40) {
    box.textContent = `${how} agrees with ${note.played}. ${evalAfter}.`;
    box.className = 'note good-note';
  } else if (loss < 150) {
    box.textContent = `${how} prefers ${best}. Slightly worse, not a mistake. ${evalAfter}.`;
    box.className = 'note';
  } else {
    box.textContent = `${how} wanted ${best}. That makes ${note.played} about ${(loss / 100).toFixed(1)} points worse. ${evalAfter}.`;
    box.className = 'note bad-note';
  }
}

function renderWatch() {
  $('watchTitle').textContent = Watch.title || 'Nothing loaded';

  // WHAT THE SUBTITLE IS FOR. On a famous game it carries the one thing this
  // app can and cannot prove about the ending, said in the same breath.
  $('watchSubtitle').textContent = Watch.source === 'famous' && Watch.famous
    ? `${Watch.famous.event}, ${Watch.famous.year} · ${Watch.famous.result} · ${Watch.famous.ending === 'checkmate'
        ? 'the mate at the end is checked on the board'
        : 'the loser resigned, which is a fact about the room rather than the position'}`
    : Watch.bands
      ? `A drawn pairing, a drawn opening and a window of equally good moves — so this is not a game either of them has played before.${Watch.bookName ? ` Opening: the ${Watch.bookName}.` : ''}`
      : '';

  const total = Watch.source === 'famous' ? Watch.sans.length : null;
  $('watchProgress').textContent = total
    ? `Move ${Math.max(1, Math.ceil(Watch.ply / 2))} of ${Math.ceil(total / 2)}`
    : Watch.ply ? `Move ${Math.ceil(Watch.ply / 2)}` : '';

  const atEnd = Watch.ply >= Watch.sans.length && (Watch.source === 'famous' || Watch.finished !== null);
  $('watchBack').disabled = Watch.ply === 0;
  $('watchNext').disabled = atEnd;
  $('watchPlay').disabled = atEnd;

  let outcome = '';
  if (Watch.finished && Watch.ply >= Watch.sans.length) {
    outcome = {
      checkmate: `Checkmate. ${Watch.ply % 2 ? 'White' : 'Black'} wins.`,
      stalemate: 'Stalemate — a draw.',
      repetition: 'Drawn by repetition.',
      fifty_move: 'Drawn by the fifty-move rule.',
      insufficient: 'Drawn — neither side has enough left to mate.',
    }[Watch.finished] ?? '';
  }
  if (Watch.source === 'famous' && Watch.famous && Watch.ply >= Watch.sans.length && Watch.sans.length) {
    outcome = Watch.famous.ending === 'checkmate'
      ? `Checkmate. ${Watch.famous.result === '1-0' ? Watch.famous.white : Watch.famous.black} wins.`
      : `${Watch.famous.result === '1-0' ? Watch.famous.black : Watch.famous.white} resigned here. The board is simply lost; nothing on it proves the game stopped.`;
  }
  $('watchOutcome').textContent = outcome;

  $('watchWhyItMatters').textContent = Watch.source === 'famous' && Watch.famous ? Watch.famous.why : '';
  $('watchWhyItMatters').hidden = Watch.source !== 'famous';

  renderWatchMoves();
}

function renderWatchMoves() {
  const box = $('watchMoves');
  box.innerHTML = '';
  for (let i = 0; i < Watch.sans.length; i++) {
    if (i % 2 === 0) box.appendChild(el('span', 'mn', `${i / 2 + 1}.`));
    const btn = el('button', 'mv', Watch.sans[i]);
    btn.type = 'button';
    if (i + 1 === Watch.ply) btn.classList.add('on');
    btn.addEventListener('click', () => { stopWatch(); goToWatchPly(i + 1); });
    box.appendChild(btn);
  }
}

function renderWatchList() {
  const box = $('watchGames');
  box.innerHTML = '';
  for (const game of FAMOUS_GAMES) {
    const row = el('div', 'endgame-row');
    const head = el('div', 'endgame-head');
    head.appendChild(el('strong', null, game.title));
    head.appendChild(el('span', 'tag', String(game.year)));
    row.appendChild(head);
    row.appendChild(el('p', 'note', `${game.white} against ${game.black} · ${game.event} · ${game.result}`));
    row.appendChild(el('p', 'note', game.why));
    const watch = el('button', 'btn', 'Watch it');
    watch.type = 'button';
    watch.addEventListener('click', () => {
      startWatchFamous(game);
      $('watchStage').scrollIntoView({ behavior: 'smooth', block: 'start' });
      playWatch();
    });
    row.appendChild(watch);
    box.appendChild(row);
  }
}
