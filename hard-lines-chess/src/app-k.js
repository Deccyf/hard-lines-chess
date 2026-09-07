// ── the coach, without a model ─────────────────────────────────────────────
//
// The rule this app is built on is that the engine is the source of truth and
// the model is the narrator. In the installed app there is no model: the APK
// holds no internet permission and a saved copy has no runtime to ask. So the
// coach was simply absent, which is the one thing the README advertises that
// the phone could not do.
//
// The way out is to notice what the model was actually for. buildCoachBundle()
// already searches the position, already resolves every move the question
// names, already turns each score into English through plainEval(), and hands
// over a structure with the material, the check, the top four lines and every
// refutation in it. The model was never evaluating anything — it was choosing
// which of those facts answered the question and writing them as sentences.
// That is a function, and this is that function.
//
// WHAT IT WILL NOT DO. It will not say anything the bundle does not contain,
// it will not rank a move the engine did not search, and where the bundle has
// no answer it says so rather than producing a sentence shaped like one. The
// prose is plainer than the model's. It is not less true — it is the same
// facts with the hedging removed, and where the model would have found a way
// to sound helpful about a position it knew nothing about, this stops.

/** Which of the handful of questions people actually ask this is. */
function coachIntent(question) {
  const q = ' ' + String(question).toLowerCase().replace(/[^a-z0-9? ]+/g, ' ') + ' ';
  if (/\bwhy not\b|\bwhat about\b|\bis \w+ (good|bad|any good|playable|safe)\b|\bcan i (play|go)\b/.test(q)) return 'about-move';
  if (/\bthreat|\bthreaten|\bdanger|\battack(ing)?\b|\bwhat is (he|she|they|it) (doing|up to)\b/.test(q)) return 'threat';
  if (/\bwho is (better|winning)\b|\bam i (better|winning|losing|lost)\b|\bhow (bad|good) is\b|\bevaluat/.test(q)) return 'assess';
  if (/\bplan\b|\bidea\b|\bwhat should i (do|play)\b|\bbest move\b|\bwhat next\b/.test(q)) return 'best';
  return 'general';
}

const coachSide = (bundle) => (bundle.mover === 'White' ? 'Black' : 'White');

/**
 * The moves of a line, without the move numbers.
 *
 * lineToSan() writes lines the way a human reads them — "4... Qxg5 5. O-O Nf6"
 * — and renderCoachAnswer() replays a bracketed line by feeding each token to
 * sanToMove(). "4..." is not a move, so the whole line failed to parse and was
 * shown as dead text instead of a button; the same tokens also made the first
 * move of a line print as "4..." in the sentence naming it. The prompt tells
 * the model to strip them. Nothing was telling this.
 */
const coachSans = (line) => String(line ?? '')
  .split(/\s+/)
  .filter((token) => token && !/^\d+\.(\.\.)?$/.test(token));

/** A line as a button the board will play, or nothing when there is no line. */
const coachLine = (line) => {
  const sans = coachSans(line);
  return sans.length ? ` [[${sans.join(' ')}]]` : '';
};

/**
 * The whole answer, assembled from the bundle and nothing else.
 *
 * Every sentence below traces to a field: `positionEval` and `depth` come from
 * one search, `lines` from the same search asked for four, `moves` from a
 * separate search of each move the question named, and `notLegal` from the
 * move generator. Nothing is inferred and nothing is softened.
 */
function narrateCoach(bundle, question) {
  const parts = [];
  const other = coachSide(bundle);
  const intent = coachIntent(question);

  // ── a finished position is stated, not analysed ──────────────────────────
  if (bundle.outcome) {
    parts.push(`${bundle.positionEval}. There is no move to find here — the game is over.`);
    if (bundle.notLegal.length) {
      parts.push(`You named ${bundle.notLegal.join(' and ')}, which cannot be played in a finished position.`);
    }
    return parts.join('\n\n');
  }

  // ── moves that do not exist ──────────────────────────────────────────────
  //
  // Said FIRST and plainly. A question resting on a move that cannot be played
  // is answered by saying so; burying it under an evaluation of a different
  // move is how you get an answer that reads as agreement.
  if (bundle.notLegal.length) {
    parts.push(`${bundle.notLegal.join(' and ')} ${bundle.notLegal.length === 1 ? 'is not a legal move' : 'are not legal moves'} in this position, so there is nothing to look at. Check the square — either the piece cannot reach it, or something of yours is already there, or the move would leave your king in check.`);
  }

  // ── the moves the question actually named ────────────────────────────────
  if (bundle.moves.length) {
    for (const move of bundle.moves) {
      const reply = coachSans(move.replyLine);
      const after = !reply.length || move.replyLine === '(the game ends here)'
        ? 'the game ends there'
        : `${other} answers ${reply[0]}${coachLine(move.replyLine)}`;
      // The classified reason first, because "it loses the knight to a fork" is
      // the answer and "Black is 3.0 pawns ahead" is the evidence for it.
      const because = move.reason && move.loss >= 80 ? ` ${move.reason}` : '';
      parts.push(`${move.san}: ${move.eval}.${because} After it, ${after}.`);
    }
    // How the named move compares with the engine's own choice, when it is not
    // already the engine's own choice.
    const best = bundle.lines[0];
    if (best && !bundle.moves.some((m) => m.san === best.san)) {
      parts.push(`The engine prefers ${best.san} here — ${best.eval}.${coachLine(best.line)}`);
    }
  }

  // ── the answer first, then what it rests on ──────────────────────────────
  //
  // ORDER IS THE ANSWER. Asked "what is he threatening?" this used to open
  // with the material count and the evaluation and reach the threat three
  // sentences later. The coach's own rules tell the model to open with one
  // sentence that answers the question before any explanation; the function
  // has to do the same or it is a worse coach than the one it replaces.
  const depth = bundle.depth ? ` (looking about ${Math.max(1, Math.round(bundle.depth / 2))} moves ahead)` : '';
  const checkNote = bundle.check ? ` ${bundle.mover} is in check, so the only moves are the ones that answer it.` : '';
  const best = bundle.lines[0];

  if (intent === 'threat') {
    // THE THREAT IS MEASURED. Found by passing the turn and asking the engine
    // what the other side would play — the same thing the board's Insight mode
    // draws in blue. This used to answer with the second move of the engine's
    // own best line, which is a reply to a move you have not made.
    if (bundle.threat?.san) {
      parts.push(`${other} is threatening ${bundle.threat.san}. If it were their move that is what the engine would play, and after it: ${bundle.threat.eval}.${coachLine(bundle.threat.line)}`);
    } else {
      parts.push(`No threat can be measured here — ${bundle.threat?.blocked ?? 'the turn cannot be passed'}.`);
    }
  }

  if ((intent === 'best' || intent === 'general' || intent === 'assess') && best) {
    parts.push(`Best is ${best.san} — ${best.eval}.${coachLine(best.line)}`);
    const rest = bundle.lines.slice(1, 3);
    if (rest.length) parts.push(`Also searched: ${rest.map((l) => `${l.san} (${l.eval})`).join(', ')}.`);
  }

  // Worth saying unprompted on an open question: a threat you have not seen is
  // the commonest reason a plan is about to stop working.
  if ((intent === 'best' || intent === 'general') && bundle.threat?.san) {
    parts.push(`Watch ${bundle.threat.san}: that is what ${other} plays if given the move.`);
  }

  if (intent === 'assess' || intent === 'general' || !bundle.moves.length) {
    parts.push(`${bundle.positionEval}${depth}.${checkNote} Material: ${bundle.material}.`);

    // Attacked and undefended, from the board rather than from the score.
    // Yours first: it is the half you can do something about this move.
    const mine = bundle.mover === 'White' ? bundle.hanging?.white : bundle.hanging?.black;
    const theirs = bundle.mover === 'White' ? bundle.hanging?.black : bundle.hanging?.white;
    const hangs = [];
    if (mine?.length) hangs.push(`Yours: ${mine.join(', ')} — attacked and undefended.`);
    if (theirs?.length) hangs.push(`${other}'s: ${theirs.join(', ')} — attacked and undefended.`);
    parts.push(hangs.length ? hangs.join(' ') : 'Nothing on either side is attacked and undefended.');
  }

  if (!parts.length) {
    parts.push(`${bundle.positionEval}${depth}. Nothing in the question named a move to look at, so there is only the position itself.`);
  }

  // The one thing this narrator can honestly say about itself.
  // renderCoachAnswer() draws text nodes and line buttons, nothing else, so
  // this is written as a sentence rather than marked up as one.
  parts.push('Written from the engine’s own output on this device. No model was asked, so there is nothing in it beyond what the search found.');
  return parts.join('\n\n');
}

/**
 * Ask, without a model. The engine work is identical — the same bundle, from
 * the same search — so the answer rests on exactly what the model's would
 * have, and the position's conversation gets the same pair of turns.
 */
async function askCoachOnDevice() {
  const question = $('coachQuestion').value.trim();
  if (!question || Coach.busy) return;

  const board = new Board(Practice.view.board.fen());
  const fen = board.fen();
  const turns = coachSession(fen);
  const status = $('coachStatus');

  Coach.busy = true;
  $('coachAsk').disabled = true;
  $('coachQuestion').value = '';
  status.textContent = 'Looking at the position…';

  // Yield so the status paints before the search blocks the thread.
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  let bundle;
  try {
    bundle = buildCoachBundle(board, question);
  } catch (e) {
    status.textContent = `The engine could not read this position: ${e?.message ?? e}.`;
    $('coachQuestion').value = question;
    Coach.busy = false;
    $('coachAsk').disabled = false;
    return;
  }
  Coach.lastBundle = bundle;

  turns.push({ role: 'user', content: question, display: question, fen });
  turns.push({ role: 'assistant', content: narrateCoach(bundle, question), fen });
  status.textContent = '';
  Coach.busy = false;
  $('coachAsk').disabled = false;
  renderCoachSession();
  renderCoachSuggestions();
}
