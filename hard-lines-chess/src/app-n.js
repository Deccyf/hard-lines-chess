// ── notation ───────────────────────────────────────────────────────────────
//
// Every other screen in this app talks in algebraic — the openings say d4 and
// c5, the review says the mistake was on f7, the coach answers in it and so
// does every book and every website you will ever open. This is the screen
// that explains it, and the only way to explain it honestly is to derive it.
//
// SO NOTHING ON THIS SCREEN IS WRITTEN OUT BY HAND. You move a piece; the app
// writes the move down with the same toSan() the rest of it uses, and then
// spellMove() takes that string apart and says why each character is there —
// from the position, not from a table. The reason "Nbd2" has a b in it is that
// the app looked and found another knight that could also go to d2, and it
// names the square that knight is standing on.
//
// That matters for one case in particular. Disambiguation is the part of
// notation everybody gets wrong, precisely because it cannot be worked out
// from the move: it depends on what else is on the board. A screen that
// explained it from a rulebook would be repeating the mistake. This one
// answers by looking.

const Notation = {
  view: null,
  board: null,
  history: [],       // [{ fen, san, parts }] — every move made on this board
  lesson: null,      // the lesson being attempted, if any
  spelled: null,     // the last move, spelled out
};

function startNotationBoard(fen = null, lesson = null) {
  Notation.lesson = lesson;
  Notation.history = [];
  Notation.spelled = null;
  Notation.board = new Board(fen ?? undefined);
  // Set ONCE, from the side the lesson asks to move, so a Black-to-move
  // position is shown from Black's side and then stays put.
  Notation.view.orientation = Notation.board.turn;
  // The square to ring is the one the lesson's move starts from — and it is
  // ringed only if that move is actually legal here, so a broken lesson marks
  // nothing rather than pointing at a square you cannot move from.
  const wanted = lesson && Notation.board.legalMoves().some((m) => moveToUci(m) === lesson.uci);
  Notation.view.setFen(Notation.board.fen(), { marks: wanted ? [nameToSquare(lesson.uci.slice(0, 2))] : [] });
  renderNotation();
}

/** The move a lesson asks for, said in words rather than in the notation. */
function notationAsk(lesson) {
  const board = new Board(lesson.fen);
  const move = board.legalMoves().find((m) => moveToUci(m) === lesson.uci);
  if (!move) return 'Play the move.';
  const from = moveFrom(move), to = moveTo(move);
  if (moveFlags(move) & FLAG_CASTLE) {
    return to > from
      ? 'Castle on the king’s side: move the king two squares towards the h-file.'
      : 'Castle on the queen’s side: move the king two squares towards the a-file.';
  }
  const names = { [PAWN]: 'pawn', [KNIGHT]: 'knight', [BISHOP]: 'bishop', [ROOK]: 'rook', [QUEEN]: 'queen', [KING]: 'king' };
  const piece = names[typeOf(board.squares[from])];
  const promo = movePromo(move);
  const became = { [QUEEN]: 'a queen', [ROOK]: 'a rook', [BISHOP]: 'a bishop', [KNIGHT]: 'a knight' }[promo];
  const target = board.squares[to] ? ', taking what is there' : '';
  return `Move the ${piece} on ${squareName(from)} to ${squareName(to)}${target}.`
    + (became ? ` Make it ${became}.` : '');
}

/**
 * A move was played on the free board. Every move is named, whether or not it
 * is the one a lesson asked for — refusing to name a legal move would be this
 * screen failing at the one thing it is for.
 */
function onNotationMove({ move }) {
  const fenBefore = Notation.board.fen();
  const spelled = spellMove(new Board(fenBefore), move);
  Notation.view.apply(move);
  Notation.board = new Board(Notation.view.board.fen());
  Notation.history.push({ fen: fenBefore, san: spelled.san, parts: spelled.parts, uci: moveToUci(move) });
  Notation.spelled = spelled;
  // THE BOARD DOES NOT TURN ROUND UNDER YOU. It used to follow the side to
  // move, so playing the lesson's move spun the board — on a screen about
  // where the squares are, which is the worst place for it. The orientation is
  // set once when a position is loaded and changes only when you ask.
  Notation.view.setFen(Notation.board.fen(), { lastMove: move });
  renderNotation();
}

function showNotationMove() {
  const lesson = Notation.lesson;
  if (!lesson) return;
  const move = Notation.board.legalMoves().find((m) => moveToUci(m) === lesson.uci);
  if (!move) return;
  onNotationMove({ move });
}

function takeBackNotation() {
  if (!Notation.history.length) return;
  const last = Notation.history.pop();
  Notation.board = new Board(last.fen);
  Notation.spelled = Notation.history.length
    ? { san: Notation.history[Notation.history.length - 1].san, parts: Notation.history[Notation.history.length - 1].parts }
    : null;
  Notation.view.setFen(Notation.board.fen());
  renderNotation();
}

function renderNotation() {
  const lesson = Notation.lesson;
  $('notationLessonName').textContent = lesson ? lesson.name : 'A board of your own';
  $('notationRule').textContent = lesson
    ? lesson.rule
    : 'Move anything, either colour, as many times as you like. Every move you make is written down and then taken apart.';
  $('notationShow').hidden = !lesson || Notation.history.length > 0;
  $('notationPrompt').textContent = lesson && !Notation.history.length
    ? notationAsk(lesson)
    : `${Notation.board.turn === WHITE ? 'White' : 'Black'} to move.`;

  const done = Notation.spelled;
  $('notationSan').textContent = done ? done.san : '—';
  $('notationSan').classList.toggle('waiting', !done);

  const parts = $('notationParts');
  parts.innerHTML = '';
  // Before a move there is nothing to take apart, and a panel with a dash in
  // it and nothing else read as a box that had failed to load. It says what
  // it is waiting for.
  if (!done) {
    parts.appendChild(el('p', 'note', lesson
      ? 'Make the move the lesson asks for and it is written here, then taken apart symbol by symbol.'
      : 'Make any move on the board and it is written here, then taken apart symbol by symbol.'));
  }
  if (done) {
    for (const part of done.parts) {
      const row = el('div', 'san-part');
      row.appendChild(el('span', 'san-part-text', part.text));
      const body = el('div', 'san-part-body');
      body.appendChild(el('span', 'san-part-label', part.label));
      body.appendChild(el('p', 'note', part.why));
      row.appendChild(body);
      parts.appendChild(row);
    }
  }

  // WHETHER IT WAS THE MOVE THE LESSON ASKED FOR — said after naming it, never
  // instead of naming it.
  const feedback = $('notationFeedback');
  if (!lesson || !Notation.history.length) {
    feedback.textContent = '';
    feedback.className = 'note';
  } else {
    const first = Notation.history[0];
    const right = first.uci === lesson.uci;
    feedback.textContent = right
      ? `That is the move, and ${lesson.san} is how it is written.`
      : `That is a legal move and ${first.san} is how it is written — but it is not the one this lesson is about. Take it back and the position comes again.`;
    feedback.className = right ? 'note good-note' : 'note';
  }

  $('notationTakeBack').disabled = Notation.history.length === 0;

  const moves = $('notationMoves');
  moves.innerHTML = '';
  Notation.history.forEach((entry, i) => {
    if (i % 2 === 0) moves.appendChild(el('span', 'mn', `${i / 2 + 1}.`));
    const chip = el('button', 'mv', entry.san);
    chip.type = 'button';
    if (i === Notation.history.length - 1) chip.classList.add('on');
    chip.addEventListener('click', () => {
      Notation.spelled = { san: entry.san, parts: entry.parts };
      renderNotation();
    });
    moves.appendChild(chip);
  });
}

function renderNotationLessons() {
  const box = $('notationLessons');
  box.innerHTML = '';
  // Heading and rows in one panel, as Endgames does — see renderWatchList.
  const panel = el('div', 'panel');
  panel.appendChild(el('h3', null, 'Lessons'));
  panel.appendChild(el('p', 'note', 'Each lesson sets up a position and asks for one move. The notation beside it is written from the board by the same code that records your own games.'));
  box.appendChild(panel);
  for (const lesson of NOTATION_LESSONS) {
    const row = el('div', 'endgame-row');
    const head = el('div', 'endgame-head');
    head.appendChild(el('strong', null, lesson.name));
    // The notation itself is the tag, and it is not the string in the file:
    // it is written out of the position at the moment this list is built.
    const board = new Board(lesson.fen);
    const move = board.legalMoves().find((m) => moveToUci(m) === lesson.uci);
    head.appendChild(el('span', 'tag', move ? toSan(new Board(lesson.fen), move) : '?'));
    row.appendChild(head);
    row.appendChild(el('p', 'note', lesson.rule));
    const go = el('button', 'btn', 'Try it on the board');
    go.type = 'button';
    go.addEventListener('click', () => {
      startNotationBoard(lesson.fen, lesson);
      $('notationStage').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    row.appendChild(go);
    panel.appendChild(row);
  }
}

/** Turn the board round, because sometimes you want to see it the other way. */
function flipNotation() {
  Notation.view.orientation = Notation.view.orientation === WHITE ? BLACK : WHITE;
  Notation.view.setFen(Notation.board.fen());
}
