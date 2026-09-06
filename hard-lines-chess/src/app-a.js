// ── the app ────────────────────────────────────────────────────────────────
const App = {
  section: 'today',
  engine: new Engine(),
  play: null,
  openings: null,
  drills: null,
  history: null,
  reviews: null,
  puzzles: null,
  teaching: null,
  prefs: null,
  downloads: null,
};

// The copy this page offers to save: itself, as it arrived, before anything
// has rendered a game into it. Everything is in one <script> at the end of the
// body, so by the time this line runs the parser has already put the whole
// program in the document.
//
// AND IT IS REPAIRED ON THE WAY OUT. A page served inside a wrapper gets its
// charset and viewport from that wrapper, and a copy saved without them is not
// the same page: opened from a phone's Files app, Chrome guesses the encoding
// and every arrow in the interface came out as "Â'", and with no viewport it
// laid the whole thing out at 980px and shrank it. Scraping the DOM is how a
// document loses the two lines that are not in the DOM's own content — so
// both are put back rather than assumed.
// Built by sourceSnapshot() in app-d.js (hoisted across the one bundle script),
// which also strips the manifest link and any blob: URLs from the clone.
const SOURCE_SNAPSHOT = sourceSnapshot();

// ── WHERE THIS COPY IS RUNNING ────────────────────────────────────────────
//
// The Android app is this same page, in a WebView, served out of the APK's own
// assets. Nothing about the chess differs there — but two of the offers on the
// "Take it with you" panel are answers to questions that copy has already
// answered: it is installed, and it is on the device. location.protocol cannot
// tell, because the wrapper serves the page over https from a real origin
// precisely so the browser storage the progress lives in behaves normally.
//
// So the wrapper says so, in the one place a page can always read: its user
// agent. Stamped in MainActivity.java; nothing else in the app looks at it.
const IN_ANDROID_APP = / HardLinesAndroid\//.test(navigator.userAgent);

const esc = (text) => String(text ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── preferences ────────────────────────────────────────────────────────────
//
// Applied to the root element as data attributes, so a choice reaches every
// board through CSS rather than through each screen remembering to ask.
const DEFAULT_PREFS = {
  pieces: 'hardlines',   // hardlines | classic | letters
  board: 'vermilion',    // vermilion | walnut | green | slate | ink | sand
  theme: 'system',       // system | light | dark
  dots: true,            // legal-move dots
  coords: true,
  animate: true,
  longPress: 1,          // highlight colour a long-press means, 1..4
  think: 'normal',       // fast | normal | deep — the practice board's budget
};

const THINK = {
  fast: { movetime: 300, depth: 8 },
  normal: { movetime: 900, depth: 12 },
  deep: { movetime: 2500, depth: 20 },
};

function applyPrefs() {
  const p = App.prefs;
  const root = document.documentElement;
  PieceStyle.current = p.pieces;
  if (p.board === 'vermilion') delete root.dataset.board; else root.dataset.board = p.board;
  root.dataset.pieces = p.pieces;
  root.dataset.coords = p.coords ? 'on' : 'off';
  if (p.theme === 'system') delete root.dataset.theme; else root.dataset.theme = p.theme;
  root.dataset.animate = p.animate ? 'on' : 'off';
  for (const view of allViews()) {
    if (!view) continue;
    view.showDots = p.dots;
    view.longPress = p.longPress;
    view.draw();
  }
}

function allViews() {
  return [Play.view, Openings.view, Review.view, Drill.view, Practice.view, Puzzles.view];
}

async function savePrefs() {
  applyPrefs();
  await Store.set('prefs', App.prefs);
}

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const SECTIONS = [
  ['today', 'Today'],
  ['play', 'Play'],
  ['board', 'Board'],
  ['openings', 'Openings'],
  ['review', 'Review'],
  ['puzzles', 'Puzzles'],
  ['drills', 'Drills'],
  ['progress', 'Progress'],
  ['settings', 'Settings'],
];

function show(section) {
  App.section = section;
  for (const [id] of SECTIONS) {
    $('section-' + id).hidden = id !== section;
    $('tab-' + id).classList.toggle('on', id === section);
    $('tab-' + id).setAttribute('aria-current', id === section ? 'page' : 'false');
  }
  if (section === 'today') renderToday();
  if (section === 'openings') renderOpenings();
  if (section === 'drills') renderDrills();
  if (section === 'puzzles') renderPuzzles();
  if (section === 'progress') renderProgress();
  if (section === 'board') renderPractice();
  if (section === 'settings') renderSettings();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ── today ──────────────────────────────────────────────────────────────────
//
// A LIST OF THINGS TO DO, and a row that cannot be acted on is never shown. A
// button that does nothing is a standing instruction to do something
// impossible, which is worse than an empty page saying so plainly.
function dueOpenings() {
  return OPENINGS.filter((o) => SRS.isDue(App.openings.cards[o.id] ?? SRS.fresh()));
}

function dueDrills() {
  return App.drills.items.filter((d) => SRS.isDue(d.card));
}

function renderToday() {
  const box = $('todayList');
  box.innerHTML = '';

  const rows = [];

  const openings = dueOpenings();
  if (openings.length) {
    rows.push({
      kind: 'Openings',
      title: `${openings.length} ${openings.length === 1 ? 'line' : 'lines'} to run through`,
      note: openings.slice(0, 3).map((o) => o.name).join(', ') + (openings.length > 3 ? '…' : ''),
      action: 'Practise',
      go: () => { show('openings'); },
    });
  }

  const puzzles = duePuzzles();
  if (puzzles.length) {
    const missed = puzzles.filter((p) => p.found === false).length;
    rows.push({
      kind: 'Puzzles',
      title: `${puzzles.length} ${puzzles.length === 1 ? 'tactic' : 'tactics'} from your own games`,
      note: missed
        ? `Moments your opponent went wrong. ${missed} of these went past you at the time.`
        : 'Moments your opponent went wrong and one move took it.',
      action: 'Solve',
      go: () => { show('puzzles'); startPuzzle(); },
    });
  }

  const drills = dueDrills();
  if (drills.length) {
    rows.push({
      kind: 'Drills',
      title: `${drills.length} ${drills.length === 1 ? 'position' : 'positions'} from your own games`,
      note: 'Your own mistakes, offered again once they have had time to fade.',
      action: 'Drill',
      go: () => { show('drills'); startDrill(); },
    });
  }

  if (!puzzles.length && scannableGames().length) {
    const n = scannableGames().length;
    rows.push({
      kind: 'Puzzles',
      title: `${n} ${n === 1 ? 'game has' : 'games have'} not been searched for tactics`,
      note: 'The engine walks each game and keeps the moments your opponent went wrong.',
      action: 'Search',
      go: () => { show('puzzles'); scanGamesForTactics(); },
    });
  }

  if (!App.reviews.games.length) {
    rows.push({
      kind: 'Review',
      title: 'No games reviewed yet',
      note: 'Paste a game from Chess.com or Lichess and the engine will walk it and name the mistakes.',
      action: 'Paste one',
      go: () => show('review'),
    });
  }

  if (rows.length === 0) {
    rows.push({
      kind: 'Nothing owed',
      title: 'You are up to date',
      note: 'Nothing is due. Play a game, or review one you have already played.',
      action: 'Play',
      go: () => show('play'),
    });
  }

  for (const row of rows) {
    const card = el('button', 'task');
    card.innerHTML = `<span class="task-kind">${row.kind}</span>
      <span class="task-title">${row.title}</span>
      <span class="task-note">${row.note}</span>`;
    const go = el('span', 'task-go', row.action + ' →');
    card.appendChild(go);
    card.addEventListener('click', row.go);
    box.appendChild(card);
  }

  // The record, per band, and only for bands actually played. A table of
  // twenty-two rows of zeroes is not a record, it is a menu.
  const record = $('todayRecord');
  const played = Object.entries(App.history.bands).filter(([, r]) => r.w + r.d + r.l > 0);
  // Hidden entirely rather than shown empty. A panel whose only content is
  // "there is nothing here" is the same fault as a button that does nothing.
  record.hidden = played.length === 0;
  if (played.length) {
    record.innerHTML = '<h3>Your record</h3>';
    const list = el('div', 'record');
    for (const [elo, r] of played.sort((a, b) => Number(a[0]) - Number(b[0]))) {
      const row = el('div', 'record-row');
      row.innerHTML = `<span class="record-band">${bandLabelFor(Number(elo))}</span>
        <span class="record-score">${r.w}W ${r.d}D ${r.l}L</span>`;
      list.appendChild(row);
    }
    record.appendChild(list);
  }
}

function bandLabelFor(elo) {
  const index = BANDS.findIndex((b) => b.elo === elo);
  return index < 0 ? String(elo) : bandLabel(BANDS[index], index, BANDS);
}

// ── play ───────────────────────────────────────────────────────────────────
const Play = {
  view: null,
  // WHAT THE CONTROLS SAY. These are the picker's current values, and nothing
  // in the move loop reads them: a game reads `Play.game`, which is frozen
  // from these when it starts. Changing the band select mid-game used to
  // change the opponent mid-game and file the result under whichever band the
  // select showed at the end.
  band: BANDS[4],
  myColour: WHITE,
  control: TIME_CONTROLS[0],
  useBook: true,
  // THE GAME BEING PLAYED, frozen at newPlayGame(): { band, control, startFen,
  // teach, useBook }. The only thing the move loop, the status line, the clock
  // and the record read.
  game: null,
  over: null,
  thinking: false,
  fault: null,
  moves: [],
  ticker: null,
  thinkingFor: 0,
  lastEval: null,
  lastEvalCp: null,
  // Bumped by every New game AND by every game ending. A search that was
  // already running when either happened finishes into the old generation and
  // is thrown away, rather than playing its move onto the fresh board — or
  // onto a finished one.
  generation: 0,
  clock: { mine: 0, theirs: 0, startedAt: 0, ticker: null },
  // A take-back SUPERSEDES rather than deletes: the moves that were actually
  // played are kept, marked, so the record of what happened survives being
  // undone. A game whose history is edited by its own player is not a record.
  superseded: [],
};

function renderBandPicker() {
  const select = $('bandSelect');
  select.innerHTML = '';
  BANDS.forEach((band, index) => {
    const option = el('option', null, bandLabel(band, index, BANDS));
    option.value = String(band.elo);
    if (band.elo === Play.band.elo) option.selected = true;
    select.appendChild(option);
  });
  describeBand();
}

function describeBand() {
  $('bandNote').textContent = bandNote(Play.band);
}

/**
 * Whether a control that would start a new game may do so now. The same
 * question Resign asks: a game with moves in it is not thrown away on a
 * mis-tap. True when there is nothing to lose.
 */
function confirmAbandon(what) {
  if (!Play.moves.length || Play.over) return true;
  return window.confirm(`${what} starts a new game. The game in progress will be abandoned — it is not saved. Continue?`);
}

function newPlayGame(fen = null) {
  Play.generation++;
  clearInterval(Play.ticker);
  stopClockTick();
  Play.thinking = false;
  Play.fault = null;
  Play.superseded = [];
  Play.lastEvalCp = null;
  Play.game = {
    band: Play.band,
    control: Play.control,
    startFen: fen,
    teach: Teach.on,
    useBook: Play.useBook,
  };
  resetTeaching();
  Play.clock = { mine: Play.control.initial ?? 0, theirs: Play.control.initial ?? 0, startedAt: Date.now(), ticker: null };
  refreshBook();
  // A promotion left half-chosen belongs to the game that just ended. Its
  // choice would be a move from that position played onto this one.
  $('promo').hidden = true;
  Play.view.orientation = Play.myColour;
  // INTERACTIVE BEFORE THE POSITION IS SET. setFen() works out the legal
  // moves as it draws, and only for an interactive board; set afterwards, a
  // New game pressed after a finished one drew a board with no legal moves
  // on it, and nothing could be played until a second New game.
  Play.view.interactive = true;
  Play.view.locked = false;
  Play.view.setFen(fen ?? new Board().fen());
  Play.moves = [];
  Play.over = null;
  Play.lastEval = null;
  App.engine.reset();
  $('playEval').textContent = '—';
  $('playAfter').hidden = true;
  $('playFrom').hidden = !fen;
  renderPlayStatus();
  renderPlayMoves();
  renderClocks();
  startClockTick();
  if (Play.view.board.outcome()) { finishPlay(Play.view.board.outcome() === 'checkmate' ? (Play.view.board.turn === Play.myColour ? 'checkmate_loss' : 'checkmate_win') : Play.view.board.outcome()); return; }
  if (Play.view.board.turn !== Play.myColour) engineMove();
}

function renderPlayStatus() {
  const head = $('playHead'), body = $('playBody'), box = $('playStatus');
  box.classList.toggle('over', !!Play.over);
  $('playTakeback').disabled = Play.thinking || Teach.looking || Play.moves.length < 2 || !!Play.over;
  $('playResign').disabled = Play.thinking || !!Play.over;

  if (Play.over) {
    head.textContent = Play.over.head;
    body.textContent = Play.over.body;
    return;
  }
  if (Play.fault) {
    head.textContent = 'The opponent could not move';
    body.textContent = `Its search failed: ${Play.fault}. Start a new game.`;
    return;
  }
  const label = bandLabelFor(Play.game.band.elo);
  if (Play.thinking) {
    head.textContent = 'Thinking';
    body.textContent = Play.thinkingFor < 2
      ? `${label} is choosing a move.`
      : `${label} is choosing a move… ${Play.thinkingFor}s`;
    return;
  }
  head.textContent = Play.view.board.turn === Play.myColour ? 'Your move' : 'Its move';
  if (Play.superseded.length) {
    body.textContent = `${Play.superseded.length} ${Play.superseded.length === 1 ? 'move has' : 'moves have'} been taken back. They are kept in the game's record.`;
    return;
  }
  body.textContent = Play.view.board.inCheck()
    ? 'You are in check.'
    : (Play.moves.length === 0 ? 'Tap a piece, then tap where it goes.' : '');
}

function renderPlayMoves() {
  const list = $('playMoves');
  list.innerHTML = '';
  if (!Play.moves.length) { list.innerHTML = '<li class="empty">No moves yet.</li>'; return; }
  const first = firstPly(Play.game?.startFen);
  const start = first.number;
  // A game set up with Black to move shows its first move in Black's column.
  const offset = first.side === BLACK ? 1 : 0;
  for (let i = -offset; i < Play.moves.length; i += 2) {
    const li = el('li');
    li.innerHTML = `<span class="n">${start + (i + offset) / 2}.</span><span>${Play.moves[i]?.san ?? (i < 0 ? '…' : '')}</span><span>${Play.moves[i + 1]?.san ?? ''}</span>`;
    list.appendChild(li);
  }
  list.parentElement.scrollTop = list.parentElement.scrollHeight;
}

/** Which side moves first from this position, and at what move number. */
function firstPly(fen) {
  if (!fen) return { side: WHITE, number: 1 };
  const parts = fen.trim().split(/\s+/);
  return { side: parts[1] === 'b' ? BLACK : WHITE, number: Math.max(1, parseInt(parts[5] ?? '1', 10) || 1) };
}

/**
 * The moves as PGN text, numbered from the position they started in. A game
 * set up at move 23 with Black to move reads "23... Nf6 24. Nxe5", not
 * "1. Nf6 Nxe5", which names a White move that Black played.
 */
function movesToPgn(moves, startFen) {
  const first = firstPly(startFen);
  let number = first.number;
  let side = first.side;
  const out = [];
  for (const m of moves) {
    if (side === WHITE) out.push(`${number}. ${m.san}`);
    else out.push(`${out.length === 0 ? `${number}... ` : ''}${m.san}`);
    if (side === BLACK) number++;
    side = side === WHITE ? BLACK : WHITE;
  }
  return out.join(' ');
}

const OVER = {
  flagged_you: ['You lost', 'Your clock ran out.'],
  flagged_them: ['You won', 'Their clock ran out.'],
  checkmate_win: ['You won', 'Checkmate.'],
  checkmate_loss: ['You lost', 'Checkmate.'],
  stalemate: ['Drawn', 'Stalemate — the side to move has no legal move and is not in check.'],
  repetition: ['Drawn', 'The same position occurred three times.'],
  fifty_move: ['Drawn', 'Fifty moves passed with no capture and no pawn move.'],
  insufficient: ['Drawn', 'Neither side has enough material to give mate.'],
  resigned: ['You lost', 'You resigned.'],
};

/**
 * THE ONLY PLACE A GAME ENDS, and a game ends once. The clock ticker, a
 * completed move and Resign all come here; a second call for a game that is
 * already over is a no-op. Ending bumps the generation, so a reply or a
 * coach's look that was already in flight finishes into a generation nobody
 * is listening to — a game once had its opponent's clock run out on the
 * display while its reply was pending, the reply landed, ran out the clock
 * again, and the record showed two wins for one game.
 */
async function finishPlay(key) {
  if (Play.over) return;
  const [head, body] = OVER[key] ?? ['Game over', ''];
  Play.over = { head, body, key };
  Play.generation++;
  clearInterval(Play.ticker);
  Play.thinking = false;
  Teach.looking = false;
  Play.view.locked = false;
  Play.view.interactive = false;
  Play.view.refresh();
  stopClockTick();
  $('promo').hidden = true;

  const game = Play.game;
  const won = key === 'checkmate_win' || key === 'flagged_them';
  const lost = key === 'checkmate_loss' || key === 'resigned' || key === 'flagged_you';
  const result = won ? 'w' : (lost ? 'l' : 'd');
  const pgn = movesToPgn(Play.moves, game.startFen);

  // The after-game panel is written BEFORE the store is asked to keep the
  // game. The store may be a round trip away, and a New game pressed in that
  // gap used to receive the finished game's "saved" note.
  renderPlayStatus();
  renderClocks();
  $('playAfter').hidden = false;

  // A TEACHING GAME IS NOT A GAME AGAINST THE BAND EITHER, and it goes in its
  // own list rather than the record — never into the games the puzzle scan
  // reads, never into the ladder. The coach was setting the problems; a
  // record that counted them would be the coach marking its own homework.
  if (game.teach) {
    const set = Teach.problems.filter((p) => p.outcome !== 'withdrawn');
    const took = set.filter((p) => p.outcome === 'found' || p.outcome === 'avoided').length;
    App.teaching.games.push({
      at: Date.now(), band: game.band.elo, colour: Play.myColour === WHITE ? 'white' : 'black', result,
      plies: Play.moves.length, from: game.startFen, takebacks: Play.superseded.length, control: game.control.id, pgn,
      problems: Teach.problems.map((p) => ({ ply: p.ply, intent: p.intent, trappiness: p.trappiness, outcome: p.outcome })),
    });
    $('playAfterText').textContent = `Teaching game over. ${set.length} ${set.length === 1 ? 'problem was' : 'problems were'} set${set.length ? ` and you came through ${took} of them` : ''}. Its moves are saved, but it is not counted in your record or searched for puzzles: the coach set the problems, so it does not get to mark them.`;
    await Store.set('teaching', App.teaching);
    return;
  }

  // A game from a set-up position is not a game against the band, so it does
  // not go on the record: winning a won position twenty times is not twenty
  // wins. It is still kept, marked, so the moves are not lost.
  if (!game.startFen) {
    const record = App.history.bands[game.band.elo] ?? { w: 0, d: 0, l: 0 };
    record[result]++;
    App.history.bands[game.band.elo] = record;
  }
  App.history.games.push({
    at: Date.now(),
    band: game.band.elo,
    colour: Play.myColour === WHITE ? 'white' : 'black',
    result,
    plies: Play.moves.length,
    from: game.startFen,
    takebacks: Play.superseded.length,
    control: game.control.id,
    pgn,
  });
  $('playAfterText').textContent = game.startFen
    ? 'The game is saved with its moves. Games from a set-up position are not counted in your record against the band.'
    : 'The game is saved. It is in your record on the Today page.';

  const generation = Play.generation;
  await Store.set('history', App.history);
  // Nothing after the store is allowed to touch a game that has since been
  // replaced; the only thing left to do is refresh the book, and that is
  // per game.
  if (generation !== Play.generation) return;
  refreshBook();
}

function onPlayerMove({ move, san }) {
  if (Play.thinking || Play.over || Teach.looking || Play.view.locked) return;
  if (Play.view.board.turn !== Play.myColour) return;

  const survived = chargeClock(Play.myColour);
  // A problem that was set is resolved by THIS move, before anything else
  // happens to the board.
  resolveProblem(moveToUci(move));
  Play.view.apply(move);
  // BOTH CLOCKS AFTER THE MOVE travel with it, so a take-back can put both
  // back. Without that a take-back kept the increment the move had earned,
  // and four take-backs of one move were worth seven seconds.
  Play.moves.push({ san, uci: moveToUci(move), clock: { mine: Play.clock.mine, theirs: Play.clock.theirs } });
  renderPlayMoves();
  renderClocks();

  // The clock is settled by the COMPLETED move, not by the ticking display:
  // the move was made, and whether it was made in time is arithmetic on when
  // it arrived.
  if (!survived) { finishPlay('flagged_you'); return; }

  const outcome = Play.view.board.outcome();
  if (outcome) {
    finishPlay(outcome === 'checkmate' ? 'checkmate_win' : outcome);
    return;
  }
  renderPlayStatus();
  engineMove();
}

function engineMove() {
  if (Play.over) return;
  const generation = Play.generation;
  // Alive means: the game this reply belongs to is still the game on the
  // board, and it has not ended. Ending bumps the generation too, so the
  // second half is belt and braces — kept because a callback that plays a
  // move onto a finished game is the fault this exists to prevent.
  const alive = () => generation === Play.generation && !Play.over;
  Play.thinking = true;
  Play.thinkingFor = 0;
  // Locked, not made non-interactive: a redraw here would cut short the slide
  // of the move he just played. While it is locked his taps do nothing — no
  // selecting the opponent's pieces and being shown where they could go.
  Play.view.locked = true;
  clearInterval(Play.ticker);
  Play.ticker = setInterval(() => { Play.thinkingFor++; renderPlayStatus(); }, 1000);
  renderPlayStatus();

  const startedAt = Date.now();

  // THE BOOK FIRST, and only in the opening. A reply his own opponents have
  // actually played beats a reply the engine likes, because the point of the
  // exercise is the positions he keeps landing in.
  const fromBook = bookReply(Play.moves.map((m) => m.uci));
  if (fromBook) {
    const move = Play.view.board.legalMoves().find((m) => moveToUci(m) === fromBook.uci);
    if (move) {
      setTimeout(() => {
        if (!alive()) return;
        clearInterval(Play.ticker);
        Play.thinking = false;
        Play.view.locked = false;
        finishEngineMove({ move, score: 0, book: fromBook });
      }, MIN_REPLY_MS);
      return;
    }
  }

  // Yield twice so "Thinking" actually paints before the search blocks the
  // thread. Without it the label appears only after the move it describes.
  requestAnimationFrame(() => setTimeout(() => {
    if (!alive()) return;
    let result;
    try {
      result = App.engine.search(Play.view.board, {
        movetime: Play.game.band.movetime,
        maxDepth: Play.game.band.depth,
        blunder: Play.game.band.blunder,
      });
    } catch (e) {
      // A search that throws must not leave the board locked and the status
      // saying "Thinking" for ever. The fault is shown, not swallowed.
      clearInterval(Play.ticker);
      Play.thinking = false;
      Play.view.locked = false;
      Play.fault = e?.message ?? String(e);
      renderPlayStatus();
      return;
    }

    // A FLOOR ON THE PAUSE, not on the search. The weakest bands think for a
    // sixtieth of a second, and a reply that lands before your finger has left
    // the board reads as a reflex rather than as an opponent — and it hides
    // your own move, which is still sliding. The engine has already decided;
    // this only holds the answer back, and never extends a search that took
    // longer than the floor anyway.
    const elapsed = Date.now() - startedAt;
    const wait = Math.max(0, MIN_REPLY_MS - elapsed);

    setTimeout(() => {
      if (!alive()) return;
      clearInterval(Play.ticker);
      Play.thinking = false;
      Play.view.locked = false;
      finishEngineMove(result);
    }, wait);
  }, 0));
}

// A shade longer than the slide, so the opponent's piece starts moving after
// yours has arrived rather than over the top of it.
const MIN_REPLY_MS = 420;

function finishEngineMove(result) {
  if (Play.over) return;
  if (!result.move) { renderPlayStatus(); return; }
  const survived = chargeClock(Play.myColour === WHITE ? BLACK : WHITE);

  // Scored from the engine's side; flipped once, here, so the readout is
  // always from HIS side. A number that changes whose side it is about
  // between moves is worse than no number.
  if (result.book) {
    // Said plainly rather than shown as an evaluation it never computed.
    Play.lastEval = 'from your games';
    Play.lastEvalCp = null;
  } else if (!result.blundered) {
    Play.lastEvalCp = -result.score;
    const pawns = -result.score / 100;
    Play.lastEval = Math.abs(result.score) > 29000
      ? (result.score > 0 ? 'it mates' : 'you mate')
      : (pawns > 0 ? '+' : '') + pawns.toFixed(1);
  } else {
    // A random move was played instead of the searched one, so the searched
    // score describes a position that did not happen. The coach's decided
    // gate reads this figure; a stale one called a level position decided.
    Play.lastEval = 'blundered';
    Play.lastEvalCp = null;
  }
  $('playEval').textContent = Play.lastEval;

  // SAN BEFORE the move is applied. It describes the move from the position
  // it was played in — the disambiguation especially — so writing it
  // afterwards names a move that was never made.
  const san = toSan(Play.view.board, result.move);
  Play.view.apply(result.move);
  Play.moves.push({ san, uci: moveToUci(result.move), clock: { mine: Play.clock.mine, theirs: Play.clock.theirs } });
  renderPlayMoves();

  renderClocks();
  if (!survived) { finishPlay('flagged_them'); return; }

  const outcome = Play.view.board.outcome();
  if (outcome) {
    finishPlay(outcome === 'checkmate' ? 'checkmate_loss' : outcome);
    return;
  }
  renderPlayStatus();
  considerProblem();
}

function takeBackPlay() {
  if (Play.thinking || Play.over || Teach.looking || Play.moves.length < 2) return;
  // Both plies: his and the reply. Taking back one hands the move straight back
  // to the engine and changes nothing he can act on.
  Play.view.board.unmake();
  Play.view.board.unmake();
  // SUPERSEDED, NOT DELETED. What was played is kept with the point it was
  // taken back from, so a game that was taken back four times still knows it.
  Play.superseded.push({ at: Play.moves.length - 2, moves: Play.moves.slice(-2) });
  Play.moves.splice(-2);
  // THE CLOCKS GO BACK TOO — to what they read after the last move still
  // standing, or to the start if none is. The time the superseded moves
  // took, and the increment they earned, go with them.
  restoreClocks();
  Play.view.interactive = true;
  Play.view.locked = false;
  Play.view.lastMove = null;
  Play.view.refresh();
  renderPlayMoves();
  renderPlayStatus();
  renderClocks();
  startClockTick();
  takeBackTeaching();
  $('playAfter').hidden = true;
}

/** Both clocks as they stood after the last move still standing. */
function restoreClocks() {
  const last = Play.moves[Play.moves.length - 1];
  const initial = Play.game.control.initial ?? 0;
  Play.clock.mine = last?.clock?.mine ?? initial;
  Play.clock.theirs = last?.clock?.theirs ?? initial;
  Play.clock.startedAt = Date.now();
}
