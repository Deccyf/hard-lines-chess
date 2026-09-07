// ── the coach ──────────────────────────────────────────────────────────────
//
// THE ONE RULE THIS WHOLE LAYER EXISTS TO ENFORCE: the engine is the source of
// truth and the model is the narrator. It is never asked to evaluate a
// position, find a move, or assert that a tactic exists. It receives verified
// engine output and turns it into English.
//
// Four things follow from that, and each of them is here because the obvious
// version is wrong:
//
//   1. NEVER SEND ONLY A FEN. A model reading a FEN reconstructs the board in
//      its head and gets it wrong, then explains the position it imagined. So
//      every prompt carries an explicit plain-text inventory: every piece and
//      the square it stands on, written out.
//   2. WHEN THE QUESTION NAMES A MOVE, SEARCH THAT MOVE FIRST. "Why not Qh5?"
//      is a question about Qh5, and the top four lines do not contain it. The
//      move is searched on its own and its refutation goes in the prompt.
//   3. A MOVE-SHAPED NAME THAT IS NOT LEGAL COMES BACK TOO. Asked about Qf5
//      when the queen cannot reach f5, the useful answer is "the queen on d6
//      cannot get to f5", not "I have no evaluation for Qf5". An empty answer
//      and an unreadable one are different things.
//   4. THE MODEL IS ALLOWED TO SAY THERE IS NO REASON. "The engine gives no
//      clear reason here, this is calculation rather than a principle" is a
//      true sentence and a fabricated explanation is worse than none.
//
// WHERE THERE IS NO MODEL, A FUNCTION NARRATES. The coach used to be hidden
// wherever Claude could not be reached — which is every installed copy of this
// app, since the APK holds no internet permission and a saved file has no
// runtime to ask. But the model was never the part that knew anything: the
// bundle below already contains the search, the material, the top four lines
// and every named move's refutation, each turned into English by plainEval().
// Choosing which of those answers the question and writing it as sentences is
// a function, and narrateCoach() in app-k.js is that function. Same bundle,
// same search, plainer prose, no network.
const Coach = {
  ready: false,
  sample: null,
  // True where no model can be reached and narrateCoach() writes the answers
  // from the engine's own output instead. See app-k.js.
  onDevice: false,
  busy: false,
  abort: null,
  sessions: {},     // fen -> [{role, content}]
  fen: null,
  returnTo: null,   // the position a played line came from
  lastBundle: null,
};

const COACH_RULES = `You are a chess coach explaining engine analysis to someone who plays casually and does NOT read chess notation fluently. Assume they know how the pieces move and nothing else. Your job is to make them see the position, not to sound like a chess book. Write in British English.

Grounding rules (these override everything else):
- The engine analysis below is the sole source of truth. Never state a fact about the position — piece placement, tactics, threats, evaluations, lines — that is not present in the provided data.
- Never invent moves, pieces or tactics. Any piece or square you mention must appear in the POSITION or ENGINE ANALYSIS sections.
- Recommend no moves beyond those the engine analysis supplies.
- If the engine's preference has no clear verbal justification, say so plainly: "the engine gives no clear reason here — this is calculation, not a principle." A fabricated explanation is worse than none.

How to write:
- Open with one sentence that answers the question in plain words, before any explanation.
- Short sentences. Everyday words. Explain any chess term the moment you use it — "a passed pawn (one with no enemy pawns left to stop it)".
- Name pieces and squares in words: "the bishop on d7", "White's king walks to f6". Never leave bare notation sitting in a sentence for the reader to decode.
- Describe evaluations the way the data does — "White is winning by about five pawns". Never quote raw signed numbers like -4.96 at the reader.
- A few sentences, up to two short paragraphs. No headings, no bullet lists.

Showing moves (this is how the reader actually follows you):
- Every move or sequence you mention MUST be wrapped in double square brackets: [[Nf3]] or [[Nf3 d5 exd5]]. The app turns each one into a button that plays the moves out on the board.
- Inside the brackets use plain SAN separated by spaces: no move numbers, no evaluations, no commentary. [[Nxe5 Qxe5 d4]], never [[1. Nxe5 Qxe5?! (-4.96)]].
- EVERY bracketed line starts from the position on the board right now. If you are describing what happens after a move, that move is the first move of the line.
- That applies to a reply by the other side too. If it is White to move and you want to mention a Black answer, write [[Rd2 Qd4]] — White's move first, then Black's. A bracketed move for the side that is not to move will be replayed as the wrong piece.
- Put brackets round a move even when you name just one.`;

/** Every piece and the square it stands on, in words. Rule 1 above. */
function pieceInventory(board, colour) {
  const NAMES = { [KING]: 'King', [QUEEN]: 'Queen', [ROOK]: 'Rook', [BISHOP]: 'Bishop', [KNIGHT]: 'Knight', [PAWN]: 'Pawn' };
  const ORDER = [KING, QUEEN, ROOK, BISHOP, KNIGHT, PAWN];
  const found = [];
  for (const type of ORDER) {
    const squares = [];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const piece = board.squares[sq];
      if (piece && colourOf(piece) === colour && typeOf(piece) === type) squares.push(squareName(sq));
    }
    if (squares.length) found.push(`${NAMES[type]}${squares.length > 1 ? 's' : ''} on ${squares.join(', ')}`);
  }
  return found.join('; ') || 'nothing left';
}

const PIECE_VALUE = { [PAWN]: 1, [KNIGHT]: 3, [BISHOP]: 3, [ROOK]: 5, [QUEEN]: 9, [KING]: 0 };

function materialLine(board) {
  let white = 0, black = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const piece = board.squares[sq];
    if (!piece) continue;
    const value = PIECE_VALUE[typeOf(piece)];
    if (colourOf(piece) === WHITE) white += value; else black += value;
  }
  const gap = white - black;
  if (gap === 0) return `material is level (${white} points each, counting a pawn 1, knight and bishop 3, rook 5, queen 9)`;
  const by = Math.abs(gap);
  return `${gap > 0 ? 'White' : 'Black'} is ${by} ${by === 1 ? 'point' : 'points'} up (White ${white}, Black ${black})`;
}

/**
 * Move-shaped names in a question, resolved against this position.
 *
 * EVERY move the question names, in the order named, capped at three. An
 * earlier design called a question naming two moves ambiguous and searched
 * NEITHER, so "why is d3 better than my Nxe4?" silently lost the dedicated
 * search that was the whole point of asking.
 *
 * And the ones that are NOT legal come back separately rather than being
 * dropped — see rule 3 at the top of this file.
 */
function detectMovesInQuestion(board, text) {
  const SHAPE = /\b(?:O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)\b/g;
  const legalSan = new Map();
  for (const move of board.legalMoves()) {
    const san = toSan(board, move);
    legalSan.set(san.replace(/[+#]$/, ''), { san, uci: moveToUci(move), move });
  }

  const named = [];
  const notLegal = [];
  const seen = new Set();

  for (const raw of text.match(SHAPE) ?? []) {
    const bare = raw.replace(/[+#]$/, '');
    if (seen.has(bare)) continue;
    seen.add(bare);
    // A bare square like "e4" inside "the pawn on e4" is not a move being
    // asked about unless it is genuinely a legal pawn move; that case is
    // caught by the lookup rather than by guessing from the wording.
    if (legalSan.has(bare)) { named.push(legalSan.get(bare)); continue; }
    // Only things that really look like a move get reported as illegal. A
    // lone square name is far more often prose than a claim about a move.
    if (/^[KQRBN]/.test(bare) || /^[a-h]x/.test(bare) || bare.startsWith('O-O')) notLegal.push(bare);
  }

  return { named: named.slice(0, 3), notLegal: notLegal.slice(0, 3) };
}

/**
 * WHAT THE OPPONENT IS THREATENING, measured rather than read off a line.
 *
 * The board's own Insight mode answers this by passing the turn — rewriting
 * the FEN with the other side to move — and asking the engine what it would
 * then play. That IS the threat. The coach had none of it and was left
 * inferring one from the second move of its own best line, which is the reply
 * to a move you have not made yet, not a threat.
 *
 * Null where the question cannot be put: in check the threat is the check, and
 * a pass that would leave the other side already checking is not a position.
 */
function coachThreat(board) {
  if (board.inCheck()) return { blocked: 'in check', san: null };
  if (board.outcome()) return { blocked: 'the game is over', san: null };
  const parts = board.fen().split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  let passed;
  try { passed = new Board(parts.join(' ')); } catch { return { blocked: 'the turn cannot be passed here', san: null }; }
  if (passed.inCheck()) return { blocked: 'the turn cannot be passed here', san: null };
  App.engine.reset();
  const result = App.engine.search(passed, { movetime: 250, maxDepth: 8 });
  if (!result.move) return { blocked: 'nothing came back', san: null };
  const them = passed.turn === WHITE ? 'White' : 'Black';
  return {
    blocked: null,
    san: toSan(passed, result.move),
    eval: plainEval(result.score, them),
    line: lineToSan(passed, result.line ?? []),
  };
}

/**
 * Attacked and undefended, both sides, named. The board's Insight mode rings
 * these already; the coach could not see them and had to guess from material.
 */
function coachHanging(board) {
  const NAMES = { [KING]: 'king', [QUEEN]: 'queen', [ROOK]: 'rook', [BISHOP]: 'bishop', [KNIGHT]: 'knight', [PAWN]: 'pawn' };
  const out = { white: [], black: [] };
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const piece = board.squares[sq];
    if (!piece || typeOf(piece) === KING) continue;
    const own = colourOf(piece), enemy = own === WHITE ? BLACK : WHITE;
    if (board.attacked(sq, enemy) && !board.attacked(sq, own)) {
      out[own === WHITE ? 'white' : 'black'].push(`${NAMES[typeOf(piece)]} on ${squareName(sq)}`);
    }
  }
  return out;
}

/** The bundle: everything the model is allowed to know, and nothing else. */
function buildCoachBundle(board, question) {
  const budget = THINK[App.prefs.think] ?? THINK.normal;
  const mover = board.turn === WHITE ? 'White' : 'Black';
  const other = mover === 'White' ? 'Black' : 'White';
  const { named, notLegal } = detectMovesInQuestion(board, question);

  // A FINISHED POSITION IS STATED, NOT SEARCHED. The engine answers a board
  // with no legal moves with score 0 at depth 0 and an empty list, which the
  // prompt then rendered as "roughly equal, 0 plies deep" — a false figure
  // under the heading that calls itself the sole source of truth.
  const outcome = board.outcome();
  if (outcome) {
    return {
      fen: board.fen(), mover, outcome,
      inventory: { white: pieceInventory(board, WHITE), black: pieceInventory(board, BLACK) },
      material: materialLine(board),
      check: board.inCheck(),
      positionEval: outcomeLine(outcome, mover, other),
      depth: null,
      threat: { blocked: 'the game is over', san: null },
      hanging: coachHanging(board),
      lines: [],
      moves: [],
      notLegal,
    };
  }

  App.engine.reset();
  const top = App.engine.search(new Board(board.fen()), {
    movetime: budget.movetime, maxDepth: budget.depth, lines: 4,
  });

  // Each named move searched ON ITS OWN, and what comes back is the
  // refutation: the position after it, from the opponent's side, flipped once
  // here so every figure in the prompt is from the mover's perspective.
  const moves = named.map(({ san, uci, move }) => {
    const after = new Board(board.fen());
    after.make(move);
    let reply = null;
    if (!after.outcome()) {
      App.engine.reset();
      reply = App.engine.search(after, { movetime: Math.round(budget.movetime * 0.6), maxDepth: budget.depth - 1 });
    }
    const scoreAfter = reply ? -reply.score : (after.outcome() === 'checkmate' ? 30000 : 0);

    // WHY IT IS BAD, WITH A NAME. The review already classifies a mistake by
    // what happened on the board — a fork, a pin, a hanging piece, a back rank
    // — from the move, the engine's move and the punishing line. The coach was
    // sending the model those three things and hoping it would work the name
    // out. It is measured here instead, by the same function the review uses.
    let motif = null;
    try {
      motif = classifyMistake({
        fenBefore: board.fen(),
        playedUci: uci,
        bestUci: top.move ? moveToUci(top.move) : null,
        replyUci: reply?.move ? moveToUci(reply.move) : null,
        replyLine: (reply?.line ?? []).map(moveToUci),
        cpLoss: Math.max(0, top.score - scoreAfter),
        mate: null,
      });
    } catch { motif = null; }

    return {
      san, uci,
      eval: plainEval(scoreAfter, mover),
      // How much worse than the engine's own move, in centipawns, for the
      // narrator to decide whether this is a blunder or a matter of taste.
      loss: Math.max(0, top.score - scoreAfter),
      themes: motif?.themes ?? [],
      reason: motif?.reason ?? null,
      replyLine: reply?.move ? lineToSan(after, reply.line) : '(the game ends here)',
    };
  });

  return {
    fen: board.fen(),
    mover,
    outcome: null,
    inventory: { white: pieceInventory(board, WHITE), black: pieceInventory(board, BLACK) },
    material: materialLine(board),
    check: board.inCheck(),
    positionEval: plainEval(top.score, mover),
    depth: top.depth || null,
    threat: coachThreat(new Board(board.fen())),
    hanging: coachHanging(board),
    lines: top.lines.map((l) => ({
      san: toSan(new Board(board.fen()), l.move),
      eval: plainEval(l.score, mover),
      line: lineToSan(board, l.line),
    })),
    moves,
    notLegal,
  };
}

/** The game is over: say how, in the same slot an evaluation would fill. */
function outcomeLine(outcome, mover, other) {
  return {
    checkmate: `checkmate — ${other} has won; ${mover} is mated and the game is over`,
    stalemate: `stalemate — ${mover} has no legal move and is not in check, so the game is a draw`,
    repetition: 'drawn by repetition — the same position has occurred three times',
    fifty_move: 'drawn by the fifty-move rule — fifty moves without a capture or a pawn move',
    insufficient: 'drawn — neither side has enough material to give checkmate',
  }[outcome] ?? `the game is over (${outcome})`;
}

function coachPrompt(bundle, question) {
  const other = bundle.mover === 'White' ? 'Black' : 'White';
  const parts = [];

  parts.push(`POSITION
FEN: ${bundle.fen}
Side to move: ${bundle.mover}${bundle.check ? ' (in check)' : ''}
White pieces: ${bundle.inventory.white}
Black pieces: ${bundle.inventory.black}
Material: ${bundle.material}`);

  // The depth is printed only when there was a search; "0 plies deep" is a
  // number that describes nothing. The best-move list is omitted when it is
  // empty rather than left as a heading over blank lines.
  const depthNote = bundle.depth ? `, looking about ${Math.max(1, Math.round(bundle.depth / 2))} moves ahead` : '';
  const turnLine = bundle.outcome
    ? `The game is over. Nothing was searched; there is no move to find.`
    : `It is ${bundle.mover} to move. Every evaluation below is written out in words already; use those words.`;
  const bestMoves = bundle.lines.length
    ? `\nBest moves for ${bundle.mover}:\n${bundle.lines.map((l, i) => `${i + 1}. ${l.san} — ${l.eval}. Line: ${l.line}`).join('\n')}`
    : '';
  parts.push(`ENGINE ANALYSIS (this app's own engine${depthNote})
${turnLine}
Position: ${bundle.positionEval}${bestMoves}`);

  // MEASURED, NOT INFERRED. Everything in this block is something the model
  // was previously left to work out from a list of lines: what the opponent is
  // threatening (found by passing the turn), what is hanging (found by asking
  // the board), and what kind of mistake a named move is (found by the same
  // classifier the review uses). It got them wrong often enough to matter.
  const measured = [];
  if (bundle.threat?.san) {
    measured.push(`If ${other} could move now they would play ${bundle.threat.san} — ${bundle.threat.eval}. That is the threat. Line: ${bundle.threat.line}`);
  } else if (bundle.threat?.blocked) {
    measured.push(`No threat could be measured here (${bundle.threat.blocked}).`);
  }
  const hangs = [
    bundle.hanging?.white?.length ? `White: ${bundle.hanging.white.join(', ')}` : null,
    bundle.hanging?.black?.length ? `Black: ${bundle.hanging.black.join(', ')}` : null,
  ].filter(Boolean);
  measured.push(hangs.length
    ? `Attacked and undefended — ${hangs.join('; ')}`
    : 'Nothing is attacked and undefended.');
  parts.push(`MEASURED ON THE BOARD (not from the lines above)\n${measured.join('\n')}`);

  if (bundle.moves.length) {
    parts.push(bundle.moves.length === 1
      ? `THE MOVE THE QUESTION ASKED ABOUT
${bundle.moves.map((m) => `${m.san} (a ${bundle.mover} move): ${m.eval}.\n${other}'s best answer to it: ${m.replyLine}${m.reason ? `\nWhat it costs, classified on the board: ${m.reason}` : ''}${m.themes?.length ? `\nThemes: ${m.themes.join(', ')}` : ''}`).join('\n\n')}`
      : `MOVES THE QUESTION NAMED (in the order asked; each searched on its own, none of them is a recommendation)
${bundle.moves.map((m) => `${m.san} (a ${bundle.mover} move): ${m.eval}.\n${other}'s best answer to it: ${m.replyLine}${m.reason ? `\nWhat it costs, classified on the board: ${m.reason}` : ''}${m.themes?.length ? `\nThemes: ${m.themes.join(', ')}` : ''}`).join('\n\n')}`);
  }

  if (bundle.notLegal.length) {
    parts.push(`NAMED IN THE QUESTION BUT NOT LEGAL HERE
${bundle.notLegal.join(', ')}
There is no legal move of that name in this position. If the question depends on one of them, say plainly which piece it would have to be and why it cannot go there. Do NOT say you have no evaluation for it — that describes a move nobody could play as one nobody looked at.`);
  }

  parts.push(`QUESTION\n${question}`);
  return parts.join('\n\n');
}

/**
 * Turn [[...]] into buttons, but only for lines that actually replay.
 *
 * EVERY LINE IS REPLAYED THROUGH THE MOVE GENERATOR before it becomes a
 * button. A button that plays a different move from the one written beside it
 * is worse than no button, and a model writing a reply for the side that is
 * not to move produces exactly that — so a line that does not replay is left
 * as plain text and marked, rather than quietly dropped.
 */
function renderCoachAnswer(text, fen) {
  const box = document.createElement('div');
  box.className = 'coach-answer';
  const parts = String(text).split(/(\[\[[^\]]*\]\])/);

  for (const part of parts) {
    const match = /^\[\[(.*)\]\]$/.exec(part);
    if (!match) {
      if (part) box.appendChild(document.createTextNode(part));
      continue;
    }
    const sans = match[1].trim().split(/\s+/).filter(Boolean);
    const board = new Board(fen);
    const moves = [];
    let ok = sans.length > 0;
    for (const san of sans) {
      const move = sanToMove(board, san);
      if (!move) { ok = false; break; }
      moves.push({ san, move: moveToUci(move) });
      board.make(move);
    }
    if (!ok) {
      const bad = el('span', 'coach-bad', sans.join(' '));
      bad.title = 'This line does not replay from this position, so it is shown as text rather than as a button.';
      box.appendChild(bad);
      continue;
    }
    const button = el('button', 'coach-line', sans.join(' '));
    button.type = 'button';
    button.title = 'Play this line on the board';
    button.addEventListener('click', () => playCoachLine(fen, moves));
    box.appendChild(button);
  }
  return box;
}

/**
 * Walk a line on the practice board, one move at a time so it can be seen.
 *
 * AND OFFER THE WAY BACK. A conversation belongs to a position, so playing a
 * line moves the board on and the thread you were reading is replaced by the
 * (empty) thread of wherever you landed. That looked exactly like the answer
 * being thrown away. The position you asked from is kept and a button returns
 * to it, rather than the app pretending nothing moved.
 *
 * Three things this got wrong once, each fixed here:
 *   - `Coach.returnTo` is set AFTER the reset. resetPractice() clears it when
 *     it is reset TO, which it always was, so the Back button did nothing.
 *   - The walker carries the practice generation and stops when it changes.
 *     Two buttons pressed a beat apart used to interleave into a line neither
 *     of them offered ("1. d4 e5 2. d5").
 *   - Every move goes through onPracticeMove(), so the hanging marks, the
 *     threat and auto-analysis all run, and the log is re-rendered at the end
 *     so the "go back" note and the button appear together.
 */
function playCoachLine(fen, moves) {
  resetPractice(fen);
  Coach.returnTo = fen;
  const generation = Practice.generation;
  let i = 0;
  const finish = () => {
    if (generation !== Practice.generation) return;
    renderCoachSession();
    $('coachBack').hidden = false;
  };
  const step = () => {
    if (generation !== Practice.generation) return;
    if (i >= moves.length) { finish(); return; }
    // Auto-analysis may be thinking about the last step: wait for it rather
    // than have onPracticeMove() drop the move on the floor.
    if (Practice.busy) { setTimeout(step, 100); return; }
    const move = sanToMove(Practice.view.board, moves[i].san);
    if (!move) { finish(); return; }
    onPracticeMove({ move, san: moves[i].san, uci: moveToUci(move) });
    i++;
    setTimeout(step, 480);
  };
  step();
}

function coachGoBack() {
  const fen = Coach.returnTo;
  if (!fen) return;
  Coach.returnTo = null;
  $('coachBack').hidden = true;
  resetPractice(fen);
  // resetPractice() renders the session for the position it lands on; said
  // again here so this function is complete on its own.
  renderCoachSession();
}

// ── asking ─────────────────────────────────────────────────────────────────
async function setupCoach() {
  try { Coach.sample = await window.claude?.use?.('sample') ?? null; } catch { Coach.sample = null; }

  // THE COACH IS NEVER ABSENT NOW. It used to be hidden wherever Claude could
  // not be reached, which is every installed copy of this app — the APK holds
  // no internet permission and a saved file has no runtime to ask. The engine
  // work was always local; only the sentences were not. narrateCoach() writes
  // them from the same bundle, so the answer rests on the same search either
  // way and the panel is shown either way.
  Coach.ready = true;
  Coach.onDevice = Coach.sample === null;
  $('coachPanel').hidden = false;
  $('coachAbsent').hidden = true;
  $('coachHow').textContent = Coach.onDevice
    ? 'No model is reachable from here, so the answers are written on this device from the engine\u2019s own output. Plainer than the model\u2019s, and made of the same measurements.'
    : 'Answers are written by Claude from what the engine found, and it is never asked to evaluate anything itself.';
  renderCoachSession();
}

function coachSession(fen) {
  Coach.sessions[fen] ??= [];
  return Coach.sessions[fen];
}

function renderCoachSession() {
  if (!Coach.ready) return;
  const fen = Practice.view.board.fen();
  Coach.fen = fen;
  const log = $('coachLog');
  log.innerHTML = '';
  const turns = coachSession(fen);

  if (!turns.length) {
    log.appendChild(el('p', 'note', Coach.returnTo
      ? 'This is a different position, so it has its own conversation. The question you asked is still there — go back to it below.'
      : 'Ask about this position and the answer is built from what the engine found here — never from the model’s own idea of the board.'));
  }
  for (const turn of turns) {
    if (turn.role === 'user') {
      log.appendChild(el('p', 'coach-you', turn.display ?? turn.content));
    } else {
      log.appendChild(renderCoachAnswer(turn.content, turn.fen ?? fen));
    }
  }
  log.scrollTop = log.scrollHeight;
  renderCoachSuggestions();
}

/**
 * Questions worth asking here, built from the position rather than from a
 * fixed list — the last move played, the engine's move, and the standing
 * question every beginner needs answered.
 */
function renderCoachSuggestions() {
  const box = $('coachSuggestions');
  box.innerHTML = '';
  const board = Practice.view.board;
  if (board.outcome()) return;

  const here = (text) => ({ text, run: () => { $('coachQuestion').value = text; askCoach(); } });
  // TALK ME THROUGH IT comes first, because most of the time you do not have a
  // question — you have a position and no idea where to start, which is the
  // state a coach is actually for.
  const asks = [
    here('Talk me through this position'),
    here('What should I be thinking about here?'),
    here('What is my opponent threatening?'),
  ];
  const best = Practice.lastLines?.lines?.[0];
  if (best) {
    try { asks.unshift(here(`Why is ${toSan(new Board(board.fen()), best.move)} the move?`)); } catch { /* position moved on */ }
  }
  // "Why not X?" is a question about the position X was played IN, not the
  // one it left behind — asked here, X is not a legal move and the bundle
  // told the model to explain why the piece could not go there. The move's
  // own `fenBefore` is the position to ask on.
  const last = Practice.moves[Practice.moves.length - 1];
  if (last) {
    const text = `Why not ${last.san}?`;
    asks.push({ text, run: () => askCoachAbout(last.fenBefore, text) });
  }

  for (const ask of asks.slice(0, 4)) {
    const chip = el('button', 'chip', ask.text);
    chip.type = 'button';
    chip.addEventListener('click', ask.run);
    box.appendChild(chip);
  }
}

async function askCoach() {
  if (!Coach.ready || Coach.busy) return;
  const question = $('coachQuestion').value.trim();
  if (!question) return;
  if (Coach.onDevice) { await askCoachOnDevice(); return; }

  const board = new Board(Practice.view.board.fen());
  const fen = board.fen();
  const turns = coachSession(fen);
  const status = $('coachStatus');

  Coach.busy = true;
  $('coachAsk').disabled = true;
  $('coachStop').hidden = false;
  $('coachQuestion').value = '';
  status.textContent = 'Looking at the position…';

  // The engine runs FIRST and blocks nothing else: the answer is about what it
  // found, so there is nothing to send until it has finished.
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  let bundle;
  try {
    bundle = buildCoachBundle(board, question);
  } catch (e) {
    status.textContent = `The engine could not read this position: ${e?.message ?? e}. Nothing was sent.`;
    Coach.busy = false; $('coachAsk').disabled = false; $('coachStop').hidden = true;
    return;
  }
  Coach.lastBundle = bundle;

  const asked = { role: 'user', content: coachPrompt(bundle, question), display: question, fen };
  turns.push(asked);
  renderCoachSession();
  status.textContent = 'Thinking…';

  // The rules ride on the first turn of each position's conversation; later
  // turns inherit them as history, which is what "no memory" actually means.
  const input = turns.map((turn, index) => ({
    role: turn.role,
    content: turn.role === 'user' && index === 0 ? `${COACH_RULES}\n\n${turn.content}` : turn.content,
  }));

  const answer = { role: 'assistant', content: '', fen };
  turns.push(answer);
  const log = $('coachLog');
  let node = renderCoachAnswer('', fen);
  log.appendChild(node);

  Coach.abort = new AbortController();
  try {
    // THE THREAD MUST ALTERNATE. A failed call once left its question in the
    // thread with no answer, and the next question went out as user, user —
    // which every sampling API rejects or mangles. The failure path below now
    // removes the question too; this is the check that says so if it ever
    // stops doing that, in words, before anything is sent.
    assertAlternating(input);
    const result = await Coach.sample(input, {
      signal: Coach.abort.signal,
      modelTier: 'default',
      onText: ({ text }) => {
        // `text` is the WHOLE answer so far, so it is assigned rather than
        // appended — appending it produces the answer repeated once per chunk.
        answer.content = text;
        const fresh = renderCoachAnswer(text, fen);
        node.replaceWith(fresh);
        node = fresh;
        log.scrollTop = log.scrollHeight;
      },
    });
    answer.content = result.text;
    const fresh = renderCoachAnswer(result.text, fen);
    node.replaceWith(fresh);
    status.textContent = result.truncated ? 'The answer was cut short.' : '';
  } catch (e) {
    const code = e?.code ?? 'unknown';
    // A partial answer is kept: it is grounded in the same bundle and half an
    // explanation is worth more than an apology that replaced it. With no
    // answer at all, the QUESTION goes too — a thread is pairs, and a question
    // left on its own is what sent user, user next time — and it is put back
    // in the box so asking again is one press.
    if (e?.text) { answer.content = e.text; node.replaceWith(renderCoachAnswer(e.text, fen)); }
    else {
      turns.splice(turns.indexOf(answer), 1);
      const at = turns.indexOf(asked);
      if (at >= 0) turns.splice(at, 1);
      node.remove();
      renderCoachSession();
      $('coachQuestion').value = question;
    }
    status.textContent = {
      cancelled: 'Stopped. Your question is back in the box.',
      rate_limited: 'Too many questions just now — wait a moment and ask again.',
      not_granted: 'The coach is not available in this view.',
      thread_order: `This position's conversation was out of order (${e.message}), so it was not sent. Ask again.`,
    }[code] ?? `The coach could not answer (${code}).`;
    if (code === 'not_granted') { Coach.ready = false; $('coachPanel').hidden = true; $('coachAbsent').hidden = false; }
  }

  Coach.abort = null;
  Coach.busy = false;
  $('coachAsk').disabled = false;
  $('coachStop').hidden = true;
  renderCoachSuggestions();
}

function stopCoach() {
  Coach.abort?.abort();
}

/** Two turns of one role in a row is a thread nothing downstream accepts. */
function assertAlternating(input) {
  for (let i = 1; i < input.length; i++) {
    if (input[i].role === input[i - 1].role) {
      const error = new Error(`two ${input[i].role} turns in a row at turn ${i + 1}`);
      error.code = 'thread_order';
      throw error;
    }
  }
}

/** Open the board on a position with a question already typed. */
function askCoachAbout(fen, question, { arrows = [] } = {}) {
  openPractice(fen, { arrows });
  renderCoachSession();
  $('coachQuestion').value = question;
  if (Coach.ready) {
    $('coachPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    askCoach();
  }
}
