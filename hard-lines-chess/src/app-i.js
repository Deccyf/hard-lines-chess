// ── the endgame trainer ────────────────────────────────────────────────────
//
// A position with a technique attached, played out against a defence that does
// not help. What makes it a trainer rather than a set of positions is that it
// grades the MOVE, not the result: in a king and pawn ending the app knows the
// exact value of every position, so the moment a win becomes a draw it can say
// so — on that move, while you can still see what you did.
//
// It could not say that before. See pawn-tb.js for why the search cannot be
// asked, and endgames.js for which positions each referee owns.

const Endgames = {
  view: null,
  current: null,       // the entry being played
  board: null,         // the live position
  movesPlayed: 0,      // full moves by the trainee
  finished: null,      // 'passed' | 'failed' | null
  thinking: false,
  slipped: false,      // has the trainee already thrown the result away?
  results: {},         // id -> { passed, at, moves }
  history: [],         // FENs, for take-back
  // BUMPED WHENEVER THE POSITION IS CHANGED BY ANYTHING BUT A REPLY. A reply
  // is scheduled behind a pause and a search, and without this a take-back
  // pressed during either one is undone half a second later by an answer to a
  // move that is no longer on the board.
  generation: 0,
};

const endgameGroups = () => {
  const groups = [];
  for (const item of ENDGAMES) {
    let group = groups.find((g) => g.name === item.group);
    if (!group) { group = { name: item.group, items: [] }; groups.push(group); }
    group.items.push(item);
  }
  return groups;
};

/**
 * What the referee says about the position from the trainee's point of view.
 * `null` where nobody can say — which is a real answer and is printed as one
 * rather than guessed at.
 */
function endgameVerdict(entry, board) {
  if (entry.referee === 'table') {
    const probe = probePawnEnding(board);
    if (!probe) return null;
    // The table always speaks for the side with the pawn. When the trainee is
    // defending, a win for the pawn is a loss for them.
    const traineeIsStrong = entry.goal !== 'draw';
    if (probe.result === 'draw') return { result: 'draw', plies: null };
    return { result: traineeIsStrong ? 'winning' : 'losing', plies: probe.plies };
  }
  return null;
}

function renderEndgames() {
  const box = $('endgameList');
  box.innerHTML = '';

  for (const group of endgameGroups()) {
    const panel = el('div', 'panel');
    panel.appendChild(el('h3', null, group.name));
    for (const item of group.items) {
      const row = el('div', 'endgame-row');
      const done = Endgames.results[item.id];
      const head = el('div', 'endgame-head');
      head.appendChild(el('strong', null, item.name));
      head.appendChild(el('span', done?.passed ? 'tag good' : 'tag',
        done?.passed ? `done in ${done.moves}` : 'not yet'));
      row.appendChild(head);
      row.appendChild(el('p', 'note', item.idea));
      const start = el('button', 'btn', done?.passed ? 'Again' : 'Try it');
      start.type = 'button';
      start.addEventListener('click', () => startEndgame(item));
      row.appendChild(start);
      panel.appendChild(row);
    }
    box.appendChild(panel);
  }
}

function startEndgame(entry) {
  Endgames.current = entry;
  Endgames.board = new Board(entry.fen);
  Endgames.movesPlayed = 0;
  Endgames.finished = null;
  Endgames.slipped = false;
  Endgames.thinking = false;
  Endgames.history = [];
  Endgames.generation++;

  $('endgameBoardWrap').hidden = false;
  $('endgameName').textContent = entry.name;
  $('endgameIdea').textContent = entry.idea;

  const method = $('endgameMethod');
  method.innerHTML = '';
  for (const step of entry.method) method.appendChild(el('li', null, step));

  Endgames.view.orientation = entry.side === 'white' ? WHITE : BLACK;
  Endgames.view.interactive = true;
  Endgames.view.onMove = onEndgameMove;
  Endgames.view.setFen(entry.fen);
  Endgames.view.locked = false;

  // WHO IS REFEREEING, SAID OUT LOUD. The difference matters to the player:
  // one of these can tell them the move they went wrong on and the other
  // cannot, and a trainer that hides which is which is claiming more than it
  // has.
  $('endgameReferee').textContent = entry.referee === 'table'
    ? 'This ending is solved exactly, so every move is graded as you play it — the app can tell you the move the win went, not just that it went.'
    : 'The defence is the app’s own engine. It will not help you, but it cannot grade a single move here the way a solved ending can — the goal below is the test.';

  $('endgameGoal').textContent = goalSentence(entry);
  $('endgameVerdict').textContent = '';
  $('endgameOutcome').textContent = '';
  $('endgameNext').hidden = true;
  $('endgameTakeBack').hidden = true;
  renderEndgameCount();
  showEndgameVerdict();
  $('endgameBoardWrap').scrollIntoView({ block: 'nearest' });
}

function goalSentence(entry) {
  const side = entry.side === 'white' ? 'White' : 'Black';
  if (entry.goal === 'mate') return `You are ${side}. Checkmate within ${entry.budget} moves.`;
  if (entry.goal === 'promote') return `You are ${side}. Get a pawn to the last rank within ${entry.budget} moves.`;
  return `You are ${side}. Hold the draw for ${entry.budget} moves.`;
}

function renderEndgameCount() {
  const entry = Endgames.current;
  const left = entry.budget - Endgames.movesPlayed;
  $('endgameCount').textContent = Endgames.finished
    ? ''
    : `${Endgames.movesPlayed} of ${entry.budget} moves used${left <= 3 ? ` — ${left} left` : ''}.`;
}

/**
 * The running verdict, where there is one. This is the whole reason the exact
 * table exists: "still winning, nine plies off" is a different lesson from
 * "you won", and "that was the move it went" is a different lesson again.
 */
function showEndgameVerdict() {
  const entry = Endgames.current;
  const box = $('endgameVerdict');
  const verdict = endgameVerdict(entry, Endgames.board);
  if (!verdict) { box.textContent = ''; box.className = 'note'; return; }

  if (entry.goal === 'draw') {
    if (verdict.result === 'draw') {
      box.textContent = 'Still drawn.';
      box.className = 'note good-note';
    } else {
      box.textContent = `This is lost now — the pawn queens in ${verdict.plies} plies with best play.`;
      box.className = 'note bad-note';
    }
    return;
  }
  if (verdict.result === 'winning') {
    box.textContent = `Still winning — the pawn goes through in ${verdict.plies} plies from here.`;
    box.className = 'note good-note';
  } else {
    box.textContent = 'This is a draw now. The win has gone.';
    box.className = 'note bad-note';
  }
}

async function onEndgameMove({ move }) {
  const entry = Endgames.current;
  if (!entry || Endgames.finished || Endgames.thinking || Endgames.view.locked) return;

  const before = endgameVerdict(entry, Endgames.board);
  Endgames.history.push(Endgames.board.fen());
  // The view is told to make the move rather than being reset to the position
  // after it: apply() slides the piece, and a board that jumps is a board you
  // cannot see your own move on. Everything else reads the position back off
  // the view, so the two cannot drift.
  Endgames.view.apply(move);
  Endgames.board = new Board(Endgames.view.board.fen());
  Endgames.movesPlayed++;
  renderEndgameCount();
  $('endgameTakeBack').hidden = false;

  // THE MOVE THAT LOST IT, NAMED WHEN IT HAPPENS. Said once — after the first
  // slip every position is worse, and repeating it every move turns a lesson
  // into nagging.
  const after = endgameVerdict(entry, Endgames.board);
  if (before && after && !Endgames.slipped) {
    const wasGood = before.result === (entry.goal === 'draw' ? 'draw' : 'winning');
    const nowGood = after.result === (entry.goal === 'draw' ? 'draw' : 'winning');
    if (wasGood && !nowGood) {
      Endgames.slipped = true;
      $('endgameOutcome').textContent = entry.goal === 'draw'
        ? 'That was the move the draw went. Take it back and try another — the position before it was still holding.'
        : 'That was the move the win went. Take it back and try another — the position before it was still winning.';
      $('endgameOutcome').className = 'idea bad-note';
    }
  }
  showEndgameVerdict();

  if (settleEndgame()) return;
  scheduleEndgameReply();
}

/**
 * Has the exercise ended? Success and failure are both facts about the board
 * rather than about the score, so both can be stated plainly.
 */
function settleEndgame() {
  const entry = Endgames.current;
  const board = Endgames.board;
  const outcome = board.outcome();
  const mySide = entry.side === 'white' ? WHITE : BLACK;
  const drawn = outcome && outcome !== 'checkmate';

  if (entry.goal === 'mate') {
    if (outcome === 'checkmate') {
      // Whoever is to move is the one mated, so a mate delivered by the
      // trainee leaves the OTHER side to move.
      return board.turn !== mySide ? endEndgame(true, 'Checkmate. That is the technique.')
        : endEndgame(false, 'You were checkmated.');
    }
    if (drawn) return endEndgame(false, `${outcome === 'stalemate' ? 'Stalemate' : 'A draw'} — the mate has gone. That is the mistake this ending is about.`);
  }

  if (entry.goal === 'promote') {
    // ANY promotion, not just a queen. The picker lets you choose, and
    // counting queens told somebody who promoted to a rook — which is the
    // right move in some of these, to avoid stalemate — that they had run out
    // of moves without ever getting the pawn through.
    const promoted = promotedMaterial(board, mySide) > promotedMaterial(new Board(entry.fen), mySide);
    if (promoted) return endEndgame(true, 'Promoted. That is the technique.');
    if (drawn) return endEndgame(false, `${outcome === 'stalemate' ? 'Stalemate' : 'Drawn'} — the pawn never got through.`);
    if (outcome === 'checkmate') return endEndgame(false, 'You were checkmated.');
    // Losing the pawn ends it as surely as a draw does.
    if (countPieces(board, mySide, PAWN) === 0 && countPieces(new Board(entry.fen), mySide, PAWN) > 0) {
      return endEndgame(false, 'The pawn has gone, and with it the win.');
    }
  }

  if (entry.goal === 'draw') {
    if (drawn) return endEndgame(true, `${outcome === 'stalemate' ? 'Stalemate' : outcome === 'repetition' ? 'Threefold repetition' : 'Drawn'} — held.`);
    if (outcome === 'checkmate') return endEndgame(false, 'Checkmated. The draw has gone.');
  }

  if (Endgames.movesPlayed >= entry.budget) {
    // OUT OF MOVES IS NOT ALWAYS A FAILURE. Holding a draw for the whole
    // budget IS the exercise, so an exact referee that still says "drawn" is
    // a pass — the clock running out is the finish line, not the buzzer.
    const verdict = endgameVerdict(entry, board);
    if (entry.goal === 'draw' && verdict?.result === 'draw') {
      return endEndgame(true, `Held for all ${entry.budget} moves, and the position is still a draw.`);
    }
    return endEndgame(false, `Out of moves. ${verdict?.result === 'winning' ? 'The win was still there — it just took too long.' : 'Try the method again from the top.'}`);
  }
  return false;
}

/** Everything that is not a king and not a pawn: what a promotion adds to. */
function promotedMaterial(board, colour) {
  return [QUEEN, ROOK, BISHOP, KNIGHT]
    .reduce((total, type) => total + countPieces(board, colour, type), 0);
}

function countPieces(board, colour, type) {
  let n = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const piece = board.squares[sq];
    if (piece && colourOf(piece) === colour && typeOf(piece) === type) n++;
  }
  return n;
}

async function endEndgame(passed, message) {
  Endgames.finished = passed ? 'passed' : 'failed';
  Endgames.view.locked = true;
  Endgames.view.interactive = false;
  $('endgameOutcome').textContent = message;
  $('endgameOutcome').className = passed ? 'idea good-note' : 'idea bad-note';
  $('endgameNext').hidden = false;
  $('endgameCount').textContent = '';

  const entry = Endgames.current;
  const best = Endgames.results[entry.id];
  // A pass is kept only when it is better than the pass already there, so
  // trying again cannot make a record worse.
  if (passed && (!best?.passed || Endgames.movesPlayed < best.moves)) {
    Endgames.results[entry.id] = { passed: true, moves: Endgames.movesPlayed, at: Date.now() };
    await Store.set('endgames', Endgames.results);
  } else if (!best) {
    Endgames.results[entry.id] = { passed: false, moves: Endgames.movesPlayed, at: Date.now() };
    await Store.set('endgames', Endgames.results);
  }
  renderEndgames();
  return true;
}

/**
 * The defence. A solved ending is defended from the table — perfectly, and
 * stubbornly: where it is lost anyway it picks the longest loss, because a
 * defender who resigns early never asks the question the lesson is about.
 */
function scheduleEndgameReply() {
  const entry = Endgames.current;
  Endgames.thinking = true;
  Endgames.view.locked = true;
  const mine = Endgames.generation;

  // The move is looked up on the VIEW's board, which is the one that will be
  // asked to play it. Finding it on a copy and handing the result over is how
  // a move object from one board ends up rejected by another.
  const play = (uci) => {
    if (mine !== Endgames.generation) return;   // taken back while thinking
    Endgames.thinking = false;
    Endgames.view.locked = false;
    const move = uci && Endgames.view.board.legalMoves().find((m) => moveToUci(m) === uci);
    if (!move) { showEndgameVerdict(); return; }
    Endgames.view.apply(move);
    Endgames.board = new Board(Endgames.view.board.fen());
    showEndgameVerdict();
    settleEndgame();
  };

  if (entry.referee === 'table') {
    const best = bestPawnMove(Endgames.board);
    const move = best && Endgames.board.legalMoves().find((m) => moveFrom(m) === best.from && moveTo(m) === best.to);
    setTimeout(() => play(move ? moveToUci(move) : null), MIN_REPLY_MS);
    return;
  }

  requestAnimationFrame(() => setTimeout(() => {
    if (mine !== Endgames.generation) return;
    let result = null;
    try {
      App.engine.reset();
      result = App.engine.search(new Board(Endgames.board.fen()), { movetime: 600, maxDepth: 18 });
    } catch { result = null; }
    setTimeout(() => play(result?.move ? moveToUci(result.move) : null), MIN_REPLY_MS);
  }, 0));
}

/**
 * Back to the position before your last move — including when the answer to it
 * is still in the air. Refusing while the opponent thinks is what a first
 * version did, and it reads as a dead button: the press does nothing, and half
 * a second later a reply lands on the move you were trying to take back.
 */
function takeBackEndgame() {
  if (!Endgames.history.length) return;
  Endgames.generation++;
  Endgames.thinking = false;
  const fen = Endgames.history.pop();
  Endgames.board = new Board(fen);
  Endgames.movesPlayed = Math.max(0, Endgames.movesPlayed - 1);
  Endgames.finished = null;
  Endgames.view.interactive = true;
  Endgames.view.locked = false;
  Endgames.view.setFen(fen);
  $('endgameOutcome').textContent = '';
  $('endgameNext').hidden = true;
  $('endgameTakeBack').hidden = Endgames.history.length === 0;
  renderEndgameCount();
  showEndgameVerdict();
}

function closeEndgame() {
  Endgames.current = null;
  $('endgameBoardWrap').hidden = true;
  renderEndgames();
}
