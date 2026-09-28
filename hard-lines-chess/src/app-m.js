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
  source: 'bots',        // 'bots' | 'famous' | 'stockfish'
  title: '',
  whiteName: '',
  blackName: '',
  bands: null,           // { white, black } while a bot game is running
  famous: null,          // the entry from FAMOUS_GAMES
  sf: null,              // a Stockfish game's state — see startWatchStockfish
  book: [],              // the drawn opening's first plies, for a bot game
  bookName: null,
  sans: [],              // the moves so far, or the whole game for a replay
  ply: 0,                // how many of them are on the board
  board: null,
  playing: false,
  run: 0,                // which run of Play the timer belongs to; Pause starts a new one
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
// one. The top band looks at up to 240,000 positions a move, and that search
// runs on the page's own thread — on a phone it is a second or two of frozen
// board, and on a screen whose whole purpose is watching, that reads as a
// crash. Capped here the slowest side looks at 100,000, which is a pause
// rather than a hang.
const WATCH_WEAKEST = 3;   // BANDS[3]  — 300
const WATCH_STRONGEST = 17; // BANDS[17] — 1700, 100,000 positions a move

// ── setting one up ─────────────────────────────────────────────────────────

function startWatchBots() {
  Watch.generation++;
  Watch.source = 'bots';
  Watch.famous = null;
  Watch.sf = null;
  Watch.finished = null;
  sfNote('');

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
  Watch.sf = null;
  sfNote('');
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
      nodes: band.nodes,
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
  if (forward && Watch.source === 'stockfish') { stepWatchStockfish(); return; }
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
  if (!Watch.sans.length && Watch.source === 'famous') return;
  Watch.playing = true;
  $('watchPlay').hidden = true;
  $('watchPause').hidden = false;
  // ONE RUN AT A TIME. A Stockfish step is a wait, and Pause then Play during
  // one would otherwise leave the old run's tick to wake up beside the new
  // one's, and the game would play at double speed from then on.
  const run = ++Watch.run;
  const tick = async () => {
    if (run !== Watch.run) return;
    if (Watch.source === 'stockfish') await stepWatchStockfish();
    else stepWatch(true);
    if (run !== Watch.run || !Watch.playing) return;
    // Twice the pace for Stockfish: there is a paragraph to read, not a line.
    Watch.timer = setTimeout(tick, Watch.source === 'stockfish' ? Watch.speed * 2 : Watch.speed);
  };
  Watch.timer = setTimeout(tick, 200);
}

function stopWatch() {
  Watch.playing = false;
  Watch.run++;
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
    $('watchMove').textContent = Watch.sans.length || Watch.source !== 'famous' ? 'The starting position' : '';
    $('watchWhy').innerHTML = '';
    $('watchNote').textContent = Watch.source !== 'famous' && Watch.bookName
      ? `They will follow the ${Watch.bookName} for the first ${Math.ceil(Watch.book.length / 2)} moves, then they are on their own.`
      : 'Press play.';
    $('watchNote').className = 'note';
    return;
  }
  if (Watch.notes[ply]) {
    const kept = Watch.notes[ply];
    // A Stockfish note is kept before its analysis arrives, and filled in here.
    if (Watch.source === 'stockfish' && !kept.explained) explainWatchPlyStockfish(ply, kept);
    paintWatchNote(kept);
    return;
  }

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
  } else if (Watch.source !== 'famous' && ply === Watch.book.length + 1) {
    note.lines.push('The book has run out. From here both sides are choosing for themselves.');
  }

  // 2. A curated note, where a person wrote one about this exact move.
  const moment = Watch.famous?.moments?.find((m) => m.ply === ply);
  if (moment) note.moment = moment.note;

  // 3, for a Stockfish game: its own analysis either side of the move, which
  // is already made, rather than a search of this app's.
  if (Watch.source === 'stockfish') {
    explainWatchPlyStockfish(ply, note);
    paintWatchNote(note);
    return;
  }

  paintWatchNote(note);

  // 3. The reference search, deferred so the board paints first.
  Watch.busy = true;
  const mine = Watch.generation;
  requestAnimationFrame(() => setTimeout(() => {
    if (mine !== Watch.generation) { Watch.busy = false; return; }
    let judged = null;
    try {
      App.engine.reset();
      const result = App.engine.search(new Board(before.fen()), { nodes: 26000, maxDepth: 12 });
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
          const reply = App.engine.search(after, { nodes: 20000, maxDepth: 11 });
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
  if (Watch.source === 'stockfish') { paintWatchNoteStockfish(note); return; }
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
      : Watch.source === 'stockfish' && Watch.sf
        ? `Stockfish looks at ${STOCKFISH_NODES.toLocaleString('en-GB')} positions before every move, and every move is explained from what it saw.${Watch.sf.level ? ' The level plays exactly as it does on Play.' : ''}${Watch.bookName ? ` Opening: the ${Watch.bookName}.` : ''}`
        : '';

  renderWatchProgress();

  const atEnd = Watch.ply >= Watch.sans.length
    && (Watch.source === 'famous' || Watch.finished !== null || Boolean(Watch.sf?.error));
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
  // "Why this game" is a famous game's question. A game played here and now
  // has no reason to be watched beyond itself, and the panel is its moves.
  $('watchMovesHead').textContent = Watch.source === 'famous' ? 'Why this game' : 'Moves';

  renderWatchMoves();
}

/** The line under the controls: how far into the game, and whether Stockfish is busy. */
function renderWatchProgress() {
  const total = Watch.source === 'famous' ? Watch.sans.length : null;
  let text = total
    ? `Move ${Math.max(1, Math.ceil(Watch.ply / 2))} of ${Math.ceil(total / 2)}`
    : Watch.ply ? `Move ${Math.ceil(Watch.ply / 2)}` : '';
  if (Watch.source === 'stockfish' && Watch.sf?.thinking) {
    const doing = Stockfish.worker ? 'Stockfish is thinking…' : 'Starting Stockfish…';
    text = text ? `${text} · ${doing}` : doing;
  }
  $('watchProgress').textContent = text;
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
  // ONE PANEL, heading and rows together — the way Endgames lists its
  // techniques. The heading used to sit in a card of its own with the games
  // loose on the page beneath it, so the list looked like a different screen
  // from the card that introduced it.
  const panel = el('div', 'panel');
  panel.appendChild(el('h3', null, 'Famous games'));
  panel.appendChild(el('p', 'note', 'Every move is replayed on a real board before it ships, so these are the games they say they are.'));
  box.appendChild(panel);
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
    panel.appendChild(row);
  }
}

// ── Stockfish, against a level or against itself ───────────────────────────
//
// The same stage and the same controls as the bot games, with two differences
// that change how it has to be driven.
//
// STOCKFISH IS ASYNCHRONOUS. It runs in a worker (src/stockfish-driver.js), so
// a move from it is a promise rather than a return value, and the stepping
// below waits for one instead of computing it in place. The board is never
// locked for it: the page stays responsive while it thinks, and says so under
// the controls, where the explanation of the move on the board is not in the
// way of it.
//
// EVERY POSITION IS ANALYSED ONCE. Stockfish looks at each position the game
// passes through a single time; that one analysis is both where its own move
// comes from and half of the explanation of the move that led there. So one
// search per move, kept, and stepping back through the game is free.
//
// IT IS TOLD THE WHOLE GAME, not just the position: the moves from the start,
// so it knows which positions have already been on the board. A repetition is
// a draw, and an engine that cannot see one coming will walk a won game into
// it — or, a side worse off, miss the draw it could have forced.
//
// AND IT LOOKS AHEAD WHILE YOU READ. Once a move is on the board and its
// explanation on screen, the next move and its analysis are started in the
// background, so pressing Next is usually instant rather than a wait.

/** The opponent list: every level of the ladder, and Stockfish itself. */
function renderWatchOpponents() {
  const select = $('watchSfOpponent');
  if (!select || select.options.length) return;
  const self = document.createElement('option');
  self.value = 'stockfish';
  self.textContent = 'Stockfish — itself';
  select.appendChild(self);
  BANDS.forEach((band, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `Level ${bandLabelFor(band.elo)}`;
    select.appendChild(option);
  });
  // 1500 by default: strong enough that the game is a game for a while, weak
  // enough that Stockfish's punishment of its mistakes is the lesson.
  const fifteen = BANDS.findIndex((b) => b.elo === 1500);
  select.value = String(fifteen >= 0 ? fifteen : Math.floor(BANDS.length / 2));
}

/**
 * How many plies of the drawn opening a Stockfish game follows: three to six
 * moves, drawn. Stockfish is deterministic — the same position and the same
 * budget give the same move — so against itself the opening is the only dice
 * there is, and drawing its length as well as its name makes a hundred games
 * out of twenty-five openings instead of twenty-five.
 */
const WATCH_SF_BOOK_PLIES = [6, 8, 10, 12];

function startWatchStockfish(opponent) {
  Watch.generation++;
  Watch.source = 'stockfish';
  Watch.famous = null;
  Watch.bands = null;
  Watch.finished = null;

  const level = opponent === 'stockfish' ? null : BANDS[Number(opponent)] ?? null;
  const sfIsWhite = level ? Math.random() < 0.5 : true;
  Watch.sf = {
    level,                                   // null when Stockfish plays itself
    white: level && !sfIsWhite ? 'level' : 'stockfish',
    black: level && sfIsWhite ? 'level' : 'stockfish',
    fens: [new Board().fen()],               // position i: after i moves
    ucis: [],                                // the moves, as Stockfish is told them
    analysis: new Map(),                     // position index -> promise of Stockfish's analysis
    ready: new Map(),                        // position index -> that analysis, once it has arrived
    prep: new Map(),                         // ply -> promise that the move and both its analyses are ready
    step: 0,                                 // the latest Next; an older one arriving late is dropped
    thinking: false,
    error: null,
  };
  if (level) {
    const levelName = `Level ${bandLabelFor(level.elo)}`;
    Watch.whiteName = sfIsWhite ? 'Stockfish' : levelName;
    Watch.blackName = sfIsWhite ? levelName : 'Stockfish';
    Watch.title = `${Watch.whiteName} against ${Watch.blackName}`;
  } else {
    Watch.whiteName = 'Stockfish, White';
    Watch.blackName = 'Stockfish, Black';
    Watch.title = 'Stockfish against itself';
  }

  const opening = OPENINGS[Math.floor(Math.random() * OPENINGS.length)];
  const plies = WATCH_SF_BOOK_PLIES[Math.floor(Math.random() * WATCH_SF_BOOK_PLIES.length)];
  Watch.book = opening.line.slice(0, Math.min(plies, opening.line.length));
  Watch.bookName = opening.name;

  resetWatch();
  sfNote('');
  // Started now rather than on the first move, so its second or so of loading
  // overlaps with the reader looking at the empty board.
  loadStockfish().catch((e) => sfFailed(e));
}

function sfNote(text, kind = 'note') {
  const box = $('watchSfNote');
  if (!box) return;
  box.hidden = !text;
  box.textContent = text;
  box.className = kind;
}

function sfFailed(e) {
  if (!Watch.sf) return;
  Watch.sf.error = e?.message ?? String(e);
  Watch.sf.thinking = false;
  stopWatch();
  sfNote(Watch.sf.error, 'note bad-note');
  const box = $('watchNote');
  box.textContent = Watch.sf.error;
  box.className = 'note bad-note';
  renderWatch();
}

/** Which side is to move in position `index`: 'stockfish' or 'level'. */
function sfSideAt(index, sf = Watch.sf) {
  return index % 2 === 0 ? sf.white : sf.black;
}

/**
 * The board after `ply` moves, replayed from the start so that it knows its
 * own history: a repetition is only a repetition to a board that saw the
 * position the first two times. One made from a FEN never has.
 */
function watchBoardAt(ply) {
  const board = new Board();
  for (let i = 0; i < ply; i++) {
    const move = sanToMove(board, Watch.sans[i]);
    if (!move) return null;
    board.make(move);
  }
  return board;
}

/** The same, from a Stockfish game's own record of its moves. */
function sfBoardAt(sf, index) {
  const board = new Board(sf.fens[0]);
  for (let i = 0; i < index; i++) {
    const move = moveFromUci(board, sf.ucis[i]);
    if (!move) return null;
    board.make(move);
  }
  return board;
}

/**
 * Stockfish's analysis of position `index`, searched once and kept. Null for
 * a finished game.
 *
 * EVERYTHING HERE TAKES THE GAME IT IS ABOUT, rather than reading whichever
 * game is on the screen: a search for the last game can still be finishing
 * when the next one starts, and it must not file its answer under the new
 * game's positions.
 */
function sfAnalysis(sf, index) {
  if (sf.analysis.has(index)) return sf.analysis.get(index);
  const board = sfBoardAt(sf, index);
  const job = !board || board.outcome()
    ? Promise.resolve(null)
    : stockfishAnalyse(sf.fens[0], { nodes: STOCKFISH_NODES, multipv: 3, moves: sf.ucis.slice(0, index) });
  job.then((a) => sf.ready.set(index, a), () => {});
  sf.analysis.set(index, job);
  return job;
}

/**
 * Make the move that takes the game to `ply`, and the two analyses its
 * explanation needs. In order: a move needs every move before it.
 */
function sfPrepare(ply, sf = Watch.sf) {
  if (sf.prep.has(ply)) return sf.prep.get(ply);
  const current = () => Watch.sf === sf;
  const job = (async () => {
    if (ply > 1 && !(await sfPrepare(ply - 1, sf))) return false;
    if (!current()) return false;
    if (sf.ucis.length < ply) {
      const index = ply - 1;
      const board = sfBoardAt(sf, index);
      if (!board) return false;
      const over = board.outcome();
      if (over) { Watch.finished = over; return false; }
      let move = null;
      if (index < Watch.book.length) move = sanToMove(board, Watch.book[index]);
      if (!move && sfSideAt(index, sf) === 'stockfish') {
        const a = await sfAnalysis(sf, index);
        if (!current()) return false;
        move = moveFromUci(board, a?.best);
      }
      if (!move && sf.level) {
        // The level's move: the app's own engine, exactly as it plays on Play.
        App.engine.reset();
        move = App.engine.search(new Board(board.fen()), {
          nodes: sf.level.nodes, maxDepth: sf.level.depth, blunder: sf.level.blunder, randomness: WATCH_RANDOMNESS,
        }).move;
      }
      if (!move || !current() || sf.ucis.length !== index) return false;
      Watch.sans.push(toSan(new Board(board.fen()), move));
      sf.ucis.push(moveToUci(move));
      board.make(move);
      sf.fens[ply] = board.fen();
    }
    // Both sides of the move, for its explanation.
    if (!current()) return false;
    await sfAnalysis(sf, ply - 1);
    await sfAnalysis(sf, ply);
    return current();
  })();
  sf.prep.set(ply, job);
  job.catch((e) => { if (current()) { sf.prep.delete(ply); sfFailed(e); } });
  return job;
}

/**
 * One step forward in a Stockfish game: wait for the move if it is not ready,
 * then show it. Resolves true if a move was shown.
 *
 * THE READER MAY MOVE ON WHILE IT WAITS — press Back, pick a move from the
 * list, press Next again — and the step that arrives late is then dropped
 * rather than dragging the board forward from wherever they went.
 */
async function stepWatchStockfish() {
  const sf = Watch.sf;
  if (!sf || sf.error) return false;
  const mine = Watch.generation;
  const from = Watch.ply;
  const token = ++sf.step;
  const next = from + 1;
  if (!sf.ready.has(next) || !sf.ready.has(from)) {
    sf.thinking = true;
    renderWatchProgress();
  }
  let ok = false;
  try { ok = await sfPrepare(next); } catch { ok = false; }
  if (mine !== Watch.generation || token !== sf.step) return false;
  sf.thinking = false;
  renderWatchProgress();
  if (Watch.ply !== from) return false;
  if (!ok) { stopWatch(); renderWatch(); return false; }

  const move = sanToMove(Watch.board, Watch.sans[Watch.ply]);
  if (!move) { stopWatch(); renderWatch(); return false; }
  Watch.view.apply(move);
  Watch.ply++;
  Watch.board = watchBoardAt(Watch.ply) ?? new Board(Watch.view.board.fen());
  const outcome = Watch.board.outcome();
  if (outcome) { Watch.finished = outcome; stopWatch(); }
  renderWatch();
  explainWatchPly(Watch.ply);
  // Look ahead while the explanation is read — after the piece has finished
  // moving, because the level's own search runs on this thread and would
  // stall the animation.
  if (!outcome) setTimeout(() => { if (mine === Watch.generation) sfPrepare(Watch.ply + 1).catch(() => {}); }, 350);
  return true;
}

/** The explanation of a ply in a Stockfish game, from the analyses already made. */
function explainWatchPlyStockfish(ply, note) {
  const sf = Watch.sf;
  const a0 = sf.ready.get(ply - 1);
  const a1 = sf.ready.get(ply);
  if (a0 === undefined || a1 === undefined) {
    // Not analysed yet: say so, and fill it in when it arrives — only then,
    // or a failure would ask again forever.
    const mine = Watch.generation;
    sfPrepare(ply).then((ok) => {
      if (ok && mine === Watch.generation && Watch.ply === ply && sf.ready.has(ply - 1) && sf.ready.has(ply)) {
        explainWatchPly(ply);
      }
    }, () => {});
    return;
  }
  const before = new Board(sf.fens[ply - 1]);
  const move = sanToMove(before, Watch.sans[ply - 1]);
  if (!move) return;
  const inBook = ply <= Watch.book.length;
  note.explained = explainMove({
    fenBefore: sf.fens[ply - 1],
    uci: sf.ucis[ply - 1],
    prevFen: ply >= 2 ? sf.fens[ply - 2] : null,
    prevUci: ply >= 2 ? sf.ucis[ply - 2] : null,
    aPrev: ply >= 2 ? sf.ready.get(ply - 2) ?? null : null,
    a0,
    a1,
    // How the game stands after the move, from a board that knows the game:
    // a repetition, which a board made from the FEN alone cannot see.
    outcome: watchBoardAt(ply)?.outcome() ?? null,
    // A book move is the book's, whoever plays it: Stockfish did not choose it.
    isEngine: sfSideAt(ply - 1) === 'stockfish' && !inBook,
    search: (board) => { App.engine.reset(); return App.engine.search(board, { nodes: 15000, maxDepth: 5 }); },
  });
}

/** Paint a Stockfish-game note: the book's word first, then the explanation, then the verdict. */
function paintWatchNoteStockfish(note) {
  const number = Math.ceil(note.ply / 2);
  $('watchMove').textContent = `${number}${note.ply % 2 ? '.' : '…'} ${note.played} — ${note.moverName}`;
  const why = $('watchWhy');
  why.innerHTML = '';
  for (const text of note.lines) why.appendChild(el('p', 'note', text));
  const box = $('watchNote');
  if (!note.explained) {
    box.textContent = Watch.sf?.error ?? 'Stockfish is looking at the move…';
    box.className = Watch.sf?.error ? 'note bad-note' : 'note';
    return;
  }
  const { verdict, tone, sentences } = note.explained;
  for (const text of sentences) why.appendChild(el('p', 'note', text));
  box.textContent = verdict;
  box.className = `note ${tone}`;
}
