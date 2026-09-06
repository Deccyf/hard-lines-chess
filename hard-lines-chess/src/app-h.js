// ── the teaching game ──────────────────────────────────────────────────────
//
// THE SHAPE IS A SETTER OF PROBLEMS, NOT A CORRECTOR OF MOVES. Before his
// move, the opponent looks at the position and asks one question: is there a
// tempting move here that loses? If there is, it says so — "careful, the
// obvious move is not the best one" — waits for his move, and then resolves
// it. If there is not, it says nothing. An ordinary bad move gets a quiet
// badge and no lecture; the coach speaks only about problems it set itself.
//
// Expect two to four problems in a whole game. A quiet stretch is the
// mechanism working, and the screen says so rather than looking broken.
//
// HOW "TEMPTING" IS MEASURED, because it is the whole thing. The original
// used a policy model trained on human games to know which moves people
// actually play. There is none here, so the substitute is depth: a move that a
// one-ply look likes and a deep search hates is, by measurement rather than
// opinion, a move that looks good and is not. It finds material traps well
// and positional ones not at all, and the announcement is worded to match.
//
// THE ANNOUNCEMENT IS A TEMPLATE WITH NO MODEL BEHIND IT. A template cannot
// leak an answer it was never given, which is a stronger guarantee than any
// amount of asking a model for restraint. It varies on the size of the trap
// and on how many have already been said, so no two in a game read alike.
//
// TEACHING GAMES ARE KEPT OUT OF THE STATISTICS. Not in the ladder record, not
// scanned for puzzles. A teacher that learned his weaknesses from games it
// coached him through would be grading its own homework.
const Teach = {
  on: false,              // the toggle; the game reads Play.game.teach, frozen at its start
  // ITS OWN ENGINE, never App.engine. A transposition table is shared by
  // everything that searches through one instance, and the coach's depth-8
  // look at the moves it shortlists left a 400-band opponent finding the
  // forced mate in the trap it had just set — from depth 1, six times out of
  // six, against none with a fresh table. The band label is only true if the
  // opponent's search starts where its band says it starts.
  engine: null,
  problem: null,          // the problem currently set, or null
  problems: [],           // every problem set this game, resolved or not
  lastProblemPly: null,
  looking: false,
  said: [],               // announcements already used this game
};

const TEACH_TEMPLATES = {
  small: [
    'Careful here — the natural move is not the best one.',
    'Something in this position is not quite what it looks like.',
    'Worth a second look before you move.',
    'There is a small catch in this position.',
  ],
  large: [
    'Careful — there is a real trap in this position.',
    'One of the moves that looks obvious here loses material.',
    'Take your time. Something here punishes the natural move.',
    'This is a position where the tempting move is the wrong one.',
  ],
  huge: [
    'Stop and look properly — something here loses on the spot.',
    'There is a move in this position that throws the game away.',
    'Be very careful with this one.',
    'The move that jumps out here is a losing one.',
  ],
  opportunity: [
    'There is more in this position than it looks. Look before you settle for the ordinary move.',
    'The obvious move here is not the one. Take a moment.',
    'Something here rewards a second look, and punishes the first.',
  ],
};

/** A sentence not yet used this game, of the right size. */
function announceProblem(problem) {
  const size = problem.intent === 'opportunity' ? 'opportunity'
    : (problem.trappiness >= 900 ? 'huge' : (problem.trappiness >= 300 ? 'large' : 'small'));
  const pool = TEACH_TEMPLATES[size].filter((t) => !Teach.said.includes(t));
  const line = (pool.length ? pool : TEACH_TEMPLATES[size])[Math.floor(Math.random() * (pool.length || TEACH_TEMPLATES[size].length))];
  Teach.said.push(line);
  return line;
}

function resetTeaching() {
  Teach.problem = null;
  Teach.problems = [];
  Teach.lastProblemPly = null;
  Teach.looking = false;
  Teach.said = [];
  renderTeaching();
}

/**
 * Called when it becomes HIS move. Three gates before any search, because the
 * search is the expensive part; then the measurement; then the announcement.
 * The board stays locked while it looks, so he cannot move into a position
 * the coach has not finished reading.
 *
 * THE LOOK IS CHARGED TO NOBODY. His clock is charged only for time the board
 * was interactive (the invariant on the clock in app-g.js): the tick stops
 * before the look and restarts, from now, after it. A 600ms look on a clock
 * with 700ms left used to flag him while the board was locked, and then set a
 * problem on the finished game.
 */
function considerProblem() {
  if (!Play.game?.teach || Play.over) return;
  const board = Play.view.board;
  if (board.turn !== Play.myColour) return;

  const ply = Play.moves.length;
  const since = Teach.lastProblemPly === null ? null : ply - Teach.lastProblemPly;
  const blocked = trapGate(board, ply, since, { evalCp: Play.lastEvalCp ?? undefined });
  if (blocked) { Teach.problem = null; renderTeaching(); return; }

  Teach.looking = true;
  Play.view.locked = true;
  stopClockTick();
  renderPlayStatus();
  renderTeaching();
  const generation = Play.generation;

  requestAnimationFrame(() => setTimeout(() => {
    let found = null;
    try {
      Teach.engine ??= new Engine();
      found = findTrap(new Board(board.fen()), { engine: Teach.engine });
    } catch { found = null; }
    // A New game restarted its own tick and a finished game stopped its own;
    // neither wants this look's answer.
    if (generation !== Play.generation || Play.over) return;
    Teach.looking = false;
    Play.view.locked = false;
    startClockTick();
    if (found) {
      Teach.problem = { ...found, ply, fen: board.fen(), said: announceProblem(found), outcome: null };
      Teach.problems.push(Teach.problem);
      Teach.lastProblemPly = ply;
    } else {
      Teach.problem = null;
    }
    renderPlayStatus();
    renderTeaching();
  }, 0));
}

/**
 * His move has been played. If a problem was set, it is resolved now, in one
 * of three ways, and each is worded so that the refutation is only shown when
 * he actually fell in — a problem he avoided keeps its answer, because the
 * point was that he found it himself.
 */
function resolveProblem(uci) {
  const p = Teach.problem;
  if (!p) return null;
  Teach.problem = null;

  if (uci === p.expectedMistake.uci) {
    p.outcome = 'fell';
    p.note = `That was the trap: ${p.expectedMistake.san} is answered by ${p.refutation?.san ?? 'a reply'} and it costs about ${(p.trappiness / 100).toFixed(1)} pawns. The engine wanted ${p.bestMove.san}.`;
  } else if (uci === p.bestMove.uci) {
    p.outcome = 'found';
    p.note = `Yes — ${p.bestMove.san} was the move. The trap was ${p.expectedMistake.san}, which loses to ${p.refutation?.san ?? 'a reply'}.`;
  } else {
    const onList = p.shortlist?.find((m) => m.uci === uci);
    if (onList && onList.deepLoss >= 200) {
      p.outcome = 'other-loss';
      p.note = `Not the trap, but not the answer either: that loses about ${(onList.deepLoss / 100).toFixed(1)} pawns to the engine's ${p.bestMove.san}. The trap itself was ${p.expectedMistake.san}.`;
    } else {
      p.outcome = 'avoided';
      p.note = `You steered round it. The trap was ${p.expectedMistake.san}, which loses to ${p.refutation?.san ?? 'a reply'}; the engine's own choice was ${p.bestMove.san}.`;
    }
  }
  renderTeaching();
  return p;
}

function renderTeaching() {
  const box = $('teachBox');
  box.hidden = !Teach.on;
  if (!Teach.on) return;

  const head = $('teachHead'), body = $('teachBody');
  if (Teach.looking) {
    head.textContent = 'Looking at the position';
    body.textContent = 'The coach is checking whether there is a problem here. Your move is held until it has.';
  } else if (Teach.problem) {
    head.textContent = 'A problem is set';
    body.textContent = Teach.problem.said;
  } else {
    // THE LAST RESOLUTION STAYS ON SCREEN until the next problem replaces it.
    // It used to be shown only for the one ply after his move, so it appeared
    // for the length of the opponent's think and was gone before it was read.
    const kept = Teach.problems.filter((p) => p.outcome !== 'withdrawn');
    const last = kept[kept.length - 1];
    if (last?.note) {
      head.textContent = { fell: 'You fell in', found: 'You found it', avoided: 'You avoided it', 'other-loss': 'Not that either' }[last.outcome];
      const since = Play.moves.length - last.ply;
      body.textContent = last.note + (since >= 6 ? ' Nothing has been set since.' : '');
    } else {
      head.textContent = 'Nothing set';
      body.textContent = kept.length
        ? `Quiet for now. ${kept.length} ${kept.length === 1 ? 'problem' : 'problems'} so far this game — expect two to four in a whole game.`
        : 'The coach speaks only when there is a trap to warn you about. A quiet stretch is not the coach being asleep; it is the position having nothing in it.';
    }
  }

  const list = $('teachList');
  list.innerHTML = '';
  for (const p of Teach.problems) {
    const row = el('div', 'record-row');
    const move = Math.floor(p.ply / 2) + 1;
    row.innerHTML = `<span class="record-band">Move ${move} · ${esc(p.intent === 'opportunity' ? 'an opportunity' : 'a trap')} worth ${(p.trappiness / 100).toFixed(1)}</span>
      <span class="record-score">${esc({ fell: 'fell in', found: 'found it', avoided: 'avoided', 'other-loss': 'lost anyway', withdrawn: 'taken back', null: 'open' }[p.outcome ?? 'null'])}</span>`;
    list.appendChild(row);
  }
  $('teachListWrap').hidden = Teach.problems.length === 0;
}

/**
 * A take-back landed at `Play.moves.length`. Two things follow, and the
 * invariant they keep is: EVERY PROBLEM STILL COUNTED SITS AT A PLY THAT
 * STILL EXISTS, AND THE OPEN ONE SITS AT EXACTLY THE PLY ON THE BOARD.
 *
 * Anything set above the landing ply is WITHDRAWN — kept in the list, marked,
 * so the record of what was said survives, but no longer counted for spacing
 * or in the tally. A problem set at ply 12 and taken back before it was
 * answered used to stay "open" for ever and block the spacing gate at ply 12
 * for the rest of the game.
 *
 * A problem set at the landing ply, in THIS position, is set again with no
 * new search — a withdrawn one included, if the same moves were replayed.
 * The position is checked as well as the ply: the same ply reached by a
 * different line is a different problem.
 */
function takeBackTeaching() {
  const at = Play.moves.length;
  const fen = Play.view.board.fen();
  for (const p of Teach.problems) {
    if (p.ply > at && p.outcome !== 'withdrawn') { p.outcome = 'withdrawn'; p.note = null; }
  }
  const here = Teach.problems.find((q) => q.ply === at && q.fen === fen);
  if (here) { here.outcome = null; here.note = null; Teach.problem = here; }
  else Teach.problem = null;
  const kept = Teach.problems.filter((p) => p.outcome !== 'withdrawn');
  Teach.lastProblemPly = kept.length ? Math.max(...kept.map((p) => p.ply)) : null;
  renderTeaching();
}

/** The old name, kept for the drivers that call it: the re-arm alone. */
function rearmProblem() {
  takeBackTeaching();
}
