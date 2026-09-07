// ── openings ───────────────────────────────────────────────────────────────
//
// Two modes, and the order matters. LEARN walks the line and says what each
// move is FOR — an opening you cannot explain is one you will abandon the
// first time somebody deviates. DRILL then asks you to play it from memory,
// spaced out, because recognising a move when you see it is not the same as
// finding it when the clock is running.
//
// A line has BRANCHES: the places the opponent usually leaves it. Each is a
// full line from move one that shares the first `at` plies with the main line,
// so the same walker runs both — one set of code, one way of being wrong.
const Openings = {
  view: null,
  current: null,
  branch: null,        // index into current.variations, or null for the main line
  line: [],            // the active branch's moves
  ideas: [],           // one per move of `line`
  mode: 'learn',
  ply: 0,
  wrong: 0,
  timer: null,         // the pending opponent reply in drill mode
};

const tipBox = (() => {
  let box = null;
  return {
    show(anchor, title, text) {
      if (!box) { box = document.createElement('div'); box.className = 'tip'; document.body.appendChild(box); }
      box.innerHTML = `<b>${esc(title)}</b>${esc(text)}`;
      box.hidden = false;
      const r = anchor.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth * 0.92);
      let left = r.left + window.scrollX;
      if (left + width > window.scrollX + window.innerWidth - 8) left = window.scrollX + window.innerWidth - width - 8;
      box.style.left = `${Math.max(8, left)}px`;
      box.style.top = `${r.bottom + window.scrollY + 6}px`;
      box.style.width = `${width}px`;
    },
    hide() { if (box) box.hidden = true; },
  };
})();

/**
 * Where an opening's card lives. ONE CARD PER LINE, not per opening: a clean
 * run of a four-move branch used to schedule the whole opening six days out.
 * The main line keeps the opening's own id, because the Today page and every
 * card written before branches had their own read exactly that key.
 */
function openingCardKey(opening, branch = null) {
  return branch === null ? opening.id : `${opening.id}:${branch}`;
}

/** Midnight today, the stamp a card carries for the day it was last set. */
function dayStamp(at = Date.now()) {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function openingCardState(opening) {
  const card = App.openings.cards[openingCardKey(opening)] ?? SRS.fresh();
  const due = SRS.isDue(card);
  let state;
  if (card.seen === 0) state = card.learned ? 'Walked through · not yet tested' : 'Not started';
  else if (due) state = 'Due now';
  else state = `Next review in ${Math.max(1, Math.ceil((card.due - Date.now()) / 86400000))} days`;
  return { card, due, state };
}

function renderOpenings() {
  if (Openings.current) return;
  renderDeviations();

  const box = $('openingList');
  box.innerHTML = '';

  const groups = [
    ['As White', OPENINGS.filter((o) => o.side === 'white')],
    ['As Black', OPENINGS.filter((o) => o.side === 'black')],
  ];

  for (const [title, list] of groups) {
    if (!list.length) continue;
    box.appendChild(el('h3', 'group', title));
    const grid = el('div', 'opening-grid');

    for (const opening of list) {
      const { card, due, state } = openingCardState(opening);
      const item = el('div', 'opening' + (due && card.seen > 0 ? ' due' : ''));
      const branches = opening.variations?.length ?? 0;

      item.innerHTML = `
        <div class="opening-head">
          <span class="opening-name">${esc(opening.name)}</span>
          <span class="opening-eco">${esc(opening.eco)}</span>
        </div>
        <p class="opening-plan">${esc(opening.plan)}</p>
        <p class="opening-state">${esc(state)} · ${opening.line.length} moves${branches ? ` · ${branches} ${branches === 1 ? 'branch' : 'branches'}` : ''} · seen ${card.seen} ${card.seen === 1 ? 'time' : 'times'}</p>`;

      const row = el('div', 'row');
      const learn = el('button', 'btn', 'Learn it');
      learn.addEventListener('click', () => startOpening(opening, 'learn'));
      const drill = el('button', 'btn' + (due ? ' primary' : ''), 'Test me');
      drill.addEventListener('click', () => startOpening(opening, 'drill'));
      row.appendChild(learn);
      row.appendChild(drill);
      item.appendChild(row);
      grid.appendChild(item);
    }

    box.appendChild(grid);
  }
}

function openingBranchLine(opening, branch) {
  if (branch === null) return { line: opening.line, ideas: opening.ideas };
  const v = opening.variations[branch];
  return { line: v.line, ideas: [...opening.ideas.slice(0, v.at), ...v.ideas] };
}

function startOpening(opening, mode, { branch = null, fromPly = 0 } = {}) {
  clearTimeout(Openings.timer);
  Openings.current = opening;
  Openings.branch = branch;
  Object.assign(Openings, openingBranchLine(opening, branch));
  Openings.mode = mode;
  Openings.ply = 0;
  Openings.wrong = 0;

  $('openingBrowse').hidden = true;
  $('openingStudy').hidden = false;
  $('openingTitle').textContent = opening.name;
  $('openingMode').textContent = mode === 'learn' ? 'Walking through it' : 'From memory';
  $('openingResult').textContent = '';
  $('openingTestNow').hidden = true;

  const studentIsWhite = opening.side === 'white';
  Openings.view.orientation = studentIsWhite ? WHITE : BLACK;
  Openings.view.setFen(new Board().fen());
  Openings.view.interactive = mode === 'drill';
  Openings.view.onMove = onOpeningMove;

  // Jumping straight to where a branch begins replays the shared moves silently.
  for (let i = 0; i < fromPly && i < Openings.line.length; i++) {
    const move = sanToMove(Openings.view.board, Openings.line[i]);
    if (!move) break;
    Openings.view.apply(move, { animate: false });
    Openings.ply = i + 1;
  }

  renderBranches();
  stepOpening();
}

/**
 * ONE pending step at a time, and the board is locked while it is pending.
 * Two timers were alive once: the opponent's reply schedules the next step
 * 420ms out and the board was already tappable, so a student who answered
 * inside that window scheduled a second one — and the line then stepped
 * twice, playing the opponent's next move on top of its own and finishing the
 * drill twice, which scored it twice.
 */
function scheduleStep(ms) {
  clearTimeout(Openings.timer);
  Openings.view.locked = true;
  Openings.timer = setTimeout(() => { Openings.timer = null; stepOpening(); }, ms);
}

function openingStudentToMove() {
  const studentIsWhite = Openings.current.side === 'white';
  return (Openings.ply % 2 === 0) === studentIsWhite;
}

function stepOpening() {
  const opening = Openings.current;
  if (!opening) return;

  if (Openings.ply >= Openings.line.length) { finishOpening(); return; }

  // In drill mode the opponent's moves play themselves; only the student's are
  // asked for. Making him play both sides would be testing his memory of a
  // script rather than of his own repertoire.
  if (Openings.mode === 'drill' && !openingStudentToMove()) {
    const move = sanToMove(Openings.view.board, Openings.line[Openings.ply]);
    if (move) { Openings.view.apply(move); Openings.ply++; }
    renderOpeningStep();
    // Kept, so Back can cancel it. A reply that lands after the screen has
    // gone would step a lesson that no longer exists.
    scheduleStep(420);
    return;
  }

  Openings.view.locked = false;
  renderOpeningStep();
}

function renderOpeningStep() {
  const opening = Openings.current;
  const line = Openings.line;
  const ply = Openings.ply;
  const done = ply >= line.length;
  const view = Openings.view;
  const wasInteractive = view.interactive;

  $('openingProgress').textContent = done
    ? `${line.length} of ${line.length}`
    : `Move ${Math.ceil((ply + 1) / 2)} · ${ply + 1} of ${line.length}`;

  if (Openings.mode === 'learn') {
    view.interactive = false;
    $('openingIdea').textContent = done ? opening.plan : Openings.ideas[ply];
    $('openingWho').textContent = done
      ? 'That is the line.'
      : ((ply % 2 === 0 ? 'White' : 'Black') + ' plays ' + line[ply]
         + ((ply % 2 === 0) === (opening.side === 'white') ? ' — your move' : ''));
    $('openingNext').hidden = done;
    $('openingPrompt').hidden = true;
    // The move about to be explained is drawn on, so the reader looks at the
    // board while reading why — not at the text, then hunts for the square.
    const next = done ? null : sanToMove(view.board, line[ply]);
    view.arrows = next ? [{ from: moveFrom(next), to: moveTo(next), kind: 'best' }] : [];
  } else {
    view.interactive = !done;
    view.arrows = [];
    $('openingIdea').textContent = done ? opening.plan : '';
    $('openingWho').textContent = done ? 'Line complete.' : (openingStudentToMove() ? 'Your move' : 'Their move');
    $('openingNext').hidden = true;
    $('openingPrompt').hidden = done;
    if (!done && openingStudentToMove()) $('openingPromptText').textContent = 'Play your move.';
  }

  const traps = done && opening.traps?.length
    ? '<h4>When it goes wrong</h4>' + opening.traps.map((t) => `<p><strong>${esc(t.when)}.</strong> ${esc(t.answer)}</p>`).join('')
    : '';
  $('openingTraps').innerHTML = traps;
  $('openingTraps').hidden = !traps;

  $('openingFinish').hidden = !done;
  renderOpeningChips();

  // A redraw only when something the board shows has changed. apply() has
  // already drawn the move and started its slide, and drawing again here is
  // what made every opening move teleport.
  if (view.interactive !== wasInteractive || Openings.mode === 'learn') {
    if (view.interactive !== wasInteractive) view.refresh();
    else view.redrawArrows();
  }
}

/**
 * The line as a row of chips, one per move, each carrying its idea as a
 * tooltip and jumping the board there when tapped. In drill mode only the
 * moves already played are shown — the rest is what is being tested.
 */
function renderOpeningChips() {
  const box = $('openingChips');
  box.innerHTML = '';
  const studentIsWhite = Openings.current.side === 'white';
  const shown = Openings.mode === 'learn' ? Openings.line.length : Openings.ply;

  for (let i = 0; i < shown; i++) {
    const mine = (i % 2 === 0) === studentIsWhite;
    const chip = el('button', 'chip' + (mine ? ' mine' : '') + (i === Openings.ply ? ' on' : '') + (i > Openings.ply ? ' todo' : ''));
    chip.type = 'button';
    chip.innerHTML = (i % 2 === 0 ? `<span class="mn">${i / 2 + 1}.</span>` : '') + esc(Openings.line[i]);
    chip.setAttribute('aria-label', `${Openings.line[i]}: ${Openings.ideas[i]}`);
    const title = `${i % 2 === 0 ? 'White' : 'Black'} · ${Openings.line[i]}`;
    chip.addEventListener('mouseenter', () => tipBox.show(chip, title, Openings.ideas[i]));
    chip.addEventListener('mouseleave', tipBox.hide);
    chip.addEventListener('focus', () => tipBox.show(chip, title, Openings.ideas[i]));
    chip.addEventListener('blur', tipBox.hide);
    if (Openings.mode === 'learn') {
      chip.addEventListener('click', () => { tipBox.hide(); jumpOpening(i); });
    } else {
      chip.disabled = true;
    }
    box.appendChild(chip);
  }
}

function jumpOpening(ply) {
  clearTimeout(Openings.timer);
  const view = Openings.view;
  view.setFen(new Board().fen());
  for (let i = 0; i < ply; i++) {
    const move = sanToMove(view.board, Openings.line[i]);
    if (!move) break;
    view.apply(move, { animate: false });
  }
  Openings.ply = ply;
  renderOpeningStep();
}

function renderBranches() {
  const box = $('openingBranches');
  const opening = Openings.current;
  const variations = opening.variations ?? [];
  box.innerHTML = '';
  if (!variations.length) { box.hidden = true; return; }
  box.hidden = false;

  // NO MOVES WHILE IT IS A TEST. The chips withhold the line in drill mode,
  // and these buttons used to print the first six plies of the main line and
  // every branch's first five — his own replies included — beside them.
  const drill = Openings.mode === 'drill';
  box.appendChild(el('h4', null, 'When they leave the line'));
  box.appendChild(el('p', 'note', drill
    ? 'Each branch is a reply you will actually meet. Pick one and the test carries on from where it splits.'
    : 'Each branch is a different reply you will actually meet. Pick one and the walk-through continues from where it departs.'));
  const list = el('div', 'branches');

  const main = el('button', 'branch' + (Openings.branch === null ? ' on' : ''));
  main.type = 'button';
  main.innerHTML = `<b>Main line</b>${drill ? `<small>${opening.line.length} moves</small>` : `<span>${esc(opening.line.slice(0, 6).join(' '))}${opening.line.length > 6 ? ' …' : ''}</span>`}`;
  main.addEventListener('click', () => startOpening(opening, Openings.mode, { branch: null }));
  list.appendChild(main);

  variations.forEach((v, index) => {
    const btn = el('button', 'branch' + (Openings.branch === index ? ' on' : ''));
    btn.type = 'button';
    const moveNumber = Math.floor(v.at / 2) + 1;
    const who = v.at % 2 === 0 ? 'White' : 'Black';
    btn.innerHTML = `<b>${esc(v.name)}</b>
      ${drill ? '' : `<span>${esc(v.line.slice(v.at, v.at + 5).join(' '))}${v.line.length > v.at + 5 ? ' …' : ''}</span>`}
      <small>${who} departs at move ${moveNumber} · ${v.line.length - v.at} moves</small>`;
    btn.addEventListener('click', () => startOpening(opening, Openings.mode, { branch: index, fromPly: v.at }));
    list.appendChild(btn);
  });
  box.appendChild(list);
}

function advanceOpening() {
  const move = sanToMove(Openings.view.board, Openings.line[Openings.ply]);
  if (move) Openings.view.apply(move);
  Openings.ply++;
  // Through stepOpening, not straight to the renderer: the end of the line is
  // finishOpening's to handle, and going round it left Learn mode with no
  // result and a card that still said "not started".
  stepOpening();
}

function onOpeningMove({ move, san }) {
  const wanted = Openings.line[Openings.ply];

  if (san.replace(/[+#]$/, '') !== wanted.replace(/[+#]$/, '')) {
    Openings.wrong++;
    Openings.view.selected = -1;
    Openings.view.refresh();
    $('openingPromptText').textContent = Openings.wrong === 1
      ? `Not that one. ${Openings.ideas[Openings.ply]}`
      : `The move is ${wanted}. ${Openings.ideas[Openings.ply]}`;
    return;
  }

  Openings.view.apply(move);
  Openings.ply++;
  $('openingPromptText').textContent = 'Right.';
  renderOpeningChips();
  scheduleStep(260);
}

async function finishOpening() {
  Openings.view.locked = false;
  renderOpeningStep();
  const opening = Openings.current;
  const key = openingCardKey(opening, Openings.branch);
  const card = App.openings.cards[key] ?? SRS.fresh();
  const what = Openings.branch === null ? 'This line' : 'This branch';

  if (Openings.mode === 'drill') {
    // Any prompt needed is a failure for scheduling: recalling it after being
    // told is recognition, not recall, and scheduling it as a success is how a
    // review queue fills with lines you cannot actually play.
    //
    // AND ONCE A DAY. "Test me" is always offered, and three clean runs in a
    // minute used to take a card from tomorrow to a fortnight out. A clean
    // run on a day the card was already set CONFIRMS it and moves nothing; a
    // failed run always counts, whatever day it is.
    const today = dayStamp();
    const clean = Openings.wrong === 0;
    if (clean && card.set_on === today) {
      $('openingResult').textContent = `Clean again. ${what} was already scheduled today, so this run confirms it rather than pushing it further out.`;
    } else {
      App.openings.cards[key] = { ...SRS.review(card, clean), set_on: today };
      await Store.set('openings', App.openings);
      $('openingResult').textContent = clean
        ? `Clean run. ${what} comes back later rather than sooner.`
        : `${Openings.wrong} prompt${Openings.wrong === 1 ? '' : 's'} needed, so ${what.toLowerCase()} comes back tomorrow.`;
    }
  } else {
    // A walk-through is recorded as exactly that. It does not schedule
    // anything — only a test can — but the card stops saying "not started".
    card.learned = Date.now();
    App.openings.cards[key] = card;
    await Store.set('openings', App.openings);
    $('openingResult').textContent = 'That is the whole line. Now try it from memory — the test plays the other side.';
    $('openingTestNow').hidden = false;
  }
}

function closeOpening() {
  clearTimeout(Openings.timer);
  tipBox.hide();
  const opening = Openings.current;
  Openings.current = null;
  $('openingStudy').hidden = true;
  $('openingBrowse').hidden = false;
  $('openingResult').textContent = '';
  renderOpenings();
  return opening;
}

// ── review ─────────────────────────────────────────────────────────────────
const Review = {
  parsed: null,
  result: null,
  side: 'white',
  view: null,
  bar: null,
  index: 0,
  running: false,
};

const REVIEW_BUDGET = {
  // Three settings that are actually different. The old ones shared a
  // movetime, so Quick and Normal reached the same depth in the same time and
  // only the label changed.
  7: { movetime: 120 },
  9: { movetime: 280 },
  12: { movetime: 650 },
};

async function runReview() {
  if (Review.running) return;
  const text = $('pgnInput').value.trim();
  const status = $('reviewStatus');
  if (!text) { status.textContent = 'Paste a game first.'; return; }

  let parsed;
  try {
    parsed = parsePgn(text);
  } catch (e) {
    status.textContent = e?.message?.startsWith('FEN')
      ? 'The game starts from a set-up position and its FEN header could not be read. The moves were not the problem.'
      : 'That does not read as a game. Copy the PGN, including the moves.';
    return;
  }

  if (!parsed.plies.length) {
    status.textContent = parsed.stoppedAt
      ? `No legal moves were found. The first token, "${parsed.stoppedAt}", is not a legal move from the starting position.`
      : 'No moves were found in that text. Make sure you copied the moves and not just the header.';
    return;
  }

  const name = $('reviewName').value.trim();
  const named = sideOf(parsed.headers, name);
  Review.side = named ?? ($('reviewSide').value === 'black' ? 'black' : 'white');
  Review.parsed = parsed;

  const notes = [];
  if (name && !named && (parsed.headers.White || parsed.headers.Black)) {
    notes.push(`"${name}" is neither ${parsed.headers.White ?? '?'} nor ${parsed.headers.Black ?? '?'}, so the drop-down decided: you were ${Review.side}.`);
  }
  if (parsed.truncated) {
    notes.push(`Read ${parsed.plies.length} of ${parsed.tokens} moves. It stopped at "${parsed.stoppedAt}", which is not a legal move in that position — the rest was left out.`);
  }

  Review.running = true;
  $('reviewRun').disabled = true;
  status.textContent = 'Walking the game…';
  $('reviewBar').hidden = false;
  $('reviewOut').hidden = true;
  $('reviewBoardWrap').hidden = true;

  const depth = Number($('reviewDepth').value);
  const budget = REVIEW_BUDGET[depth] ?? REVIEW_BUDGET[9];
  let result;
  try {
    result = await reviewGame(parsed, Review.side, {
      movetime: budget.movetime,
      depth,
      onProgress: (done, total, phase) => {
        $('reviewFill').style.width = `${Math.round((done / total) * 100)}%`;
        status.textContent = phase === 'tactics'
          ? `Checking what was on offer… ${done} of ${total}`
          : `Walking the game… ${done} of ${total} positions`;
      },
    });
  } catch (e) {
    Review.running = false;
    $('reviewRun').disabled = false;
    $('reviewBar').hidden = true;
    status.textContent = `The walk failed part-way: ${e?.message ?? e}. Nothing was saved.`;
    return;
  }

  Review.result = result;
  Review.running = false;
  $('reviewRun').disabled = false;
  $('reviewBar').hidden = true;

  // Kept, so the mistakes can become drills and the progress page has
  // something to count.
  const at = Date.now();
  const label = `${parsed.headers.White ?? '?'} vs ${parsed.headers.Black ?? '?'}`;
  forgetDeviations();
  App.reviews.games.push({
    at,
    white: parsed.headers.White ?? '?',
    black: parsed.headers.Black ?? '?',
    result: parsed.headers.Result ?? '*',
    side: Review.side,
    // NULL when fewer than `minJudged` of his moves were judged — never a
    // 100% that an empty sample would earn.
    accuracy: result.accuracy,
    plies: parsed.plies.length,
    mistakes: result.mistakes,
    // KEPT so the game can be walked again later. Without it a review is a
    // one-way door: anything a future version of this page wants to work out
    // about the game is lost, which is exactly what happened to the tactics.
    pgn: text,
    tactics: result.tactics.length,
    meanLoss: result.meanLoss,
    depth,
    estimate: result.meanLoss === null ? null : estimateRating(result.meanLoss, depth),
  });
  await Store.set('reviews', App.reviews);
  // The book is built from stored games, and one was just stored.
  refreshBook();

  const filed = await addTactics(result.tactics, { source: 'review', label, at, against: 'elsewhere' });

  notes.unshift(`Done: ${result.mistakes.length} ${result.mistakes.length === 1 ? 'mistake' : 'mistakes'} found in your ${result.counted} moves.`);
  if (result.accuracy === null) {
    notes.push(`Too few of your moves to estimate from: ${result.counted} judged, ${result.minJudged} needed for an accuracy or a strength figure.`);
  }
  if (filed) {
    const missed = result.tactics.filter((t) => t.found === false).length;
    notes.push(`${filed} ${filed === 1 ? 'tactic' : 'tactics'} added to Puzzles — moments your opponent went wrong${missed ? `, ${missed} of which went past you` : ''}.`);
  }
  const passedOver = passedOverSentence(result.tacticsPassed);
  if (passedOver) notes.push(passedOver);
  status.textContent = notes.join(' ');
  renderReviewResult();
}

/**
 * The moments the opponent went wrong that were NOT filed as puzzles, said
 * by reason. One figure used to cover all three and was worded as the middle
 * one, which was false for the other two.
 */
function passedOverSentence(passed) {
  if (!passed) return '';
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const parts = [];
  if (passed.notUnique) parts.push(`${n(passed.notUnique, 'moment was', 'moments were')} passed over because more than one move punished ${passed.notUnique === 1 ? 'it' : 'them'}, so there was no single answer to ask for`);
  if (passed.capped) parts.push(`${n(passed.capped, 'more was', 'more were')} left unchecked beyond the ${TACTIC.perGame} biggest a game is limited to`);
  if (passed.singleReply) parts.push(`${n(passed.singleReply, 'was', 'were')} skipped because you had only one legal move there, so there was nothing to find`);
  return parts.length ? parts.join('; ').replace(/^./, (c) => c.toUpperCase()) + '.' : '';
}

function moveLabel(m) {
  return `${m.moveNumber}${m.colour === 'white' || m.side === 'white' ? '.' : '...'} ${m.san}`;
}

/**
 * How the game stood after every ply, drawn as WIN CHANCE rather than pawns.
 *
 * A pawn axis has to scale to the largest lead in the game, so a game that
 * ends nine pawns apart squashes every earlier swing flat along the middle —
 * a chart drawn to show where the game turned would show nothing but the
 * collapse at the end. Chance is monotone in the score, so it reorders
 * nothing; all it changes is the spacing, which is the whole point.
 *
 * Drawn from EVERY position, both colours, not just from his mistakes. A line
 * drawn from his errors alone would fall at each of them and sit flat in
 * between, as though his opponent never gave anything back — which is a
 * straightforwardly false story about a game he sat through.
 */
function renderCurve(box) {
  const { whiteCp, judged } = Review.result;
  if (!whiteCp || whiteCp.length < 3) return;

  const mine = Review.side === 'white';
  const chance = whiteCp.map((cp) => {
    const share = Math.abs(cp) > 29000 ? (cp > 0 ? 1 : 0) : winChance(cp);
    return mine ? share : 1 - share;
  });

  const panel = el('div', 'panel');
  panel.appendChild(el('h3', null, 'How the game went'));
  panel.appendChild(el('p', 'note', `Your chance of winning after every move, yours and theirs. Above the middle line you were better. This is the engine's own figure turned into a chance, not a prediction about you.`));

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'curve');
  svg.setAttribute('viewBox', `0 0 ${Math.max(2, chance.length - 1)} 100`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Win chance through the game');

  // FILLED TO THE FLOOR, not to the middle. Filling the band between the line
  // and the halfway mark reads as two different shapes depending on which side
  // of it you are on, and where the line crosses, the region it encloses is
  // genuinely ambiguous. Filled from the bottom, the HEIGHT of the shading is
  // the number: there is nothing to interpret.
  const y = (c) => 100 - c * 100;
  const area = document.createElementNS(NS, 'path');
  area.setAttribute('d', `M0,100 ${chance.map((c, i) => `L${i},${y(c)}`).join(' ')} L${chance.length - 1},100 Z`);
  area.setAttribute('class', 'curve-fill');
  svg.appendChild(area);

  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', chance.map((c, i) => `${i},${y(c)}`).join(' '));
  line.setAttribute('class', 'curve-line');
  svg.appendChild(line);

  const mid = document.createElementNS(NS, 'line');
  mid.setAttribute('x1', 0); mid.setAttribute('x2', chance.length - 1);
  mid.setAttribute('y1', 50); mid.setAttribute('y2', 50);
  mid.setAttribute('class', 'curve-mid');
  svg.appendChild(mid);

  // A mark on each of HIS mistakes, because the question the chart is being
  // read to answer is "where did it go wrong, and was it me".
  for (const m of judged) {
    if (!m.mine || m.cls === 'best' || m.cls === 'good') continue;
    // Drawn as a zero-length line rather than a circle: see the note on the
    // progress chart's dots. This viewBox is stretched too — sixty plies wide
    // by a hundred tall, into a box that is far wider than it is high — so a
    // circle here has always come out as an ellipse.
    const dot = document.createElementNS(NS, 'line');
    dot.setAttribute('x1', m.ply); dot.setAttribute('x2', m.ply);
    dot.setAttribute('y1', y(chance[m.ply] ?? 0.5)); dot.setAttribute('y2', y(chance[m.ply] ?? 0.5));
    dot.setAttribute('class', 'curve-dot');
    svg.appendChild(dot);
  }

  const frame = el('div', 'curve-frame');
  frame.appendChild(svg);

  // Tapping the chart goes to that move. "Where did it go wrong" is the
  // question the chart is read to answer, and a chart that answers it and then
  // makes you find the move in a list has stopped half way.
  frame.addEventListener('click', (event) => {
    const box = frame.getBoundingClientRect();
    const ply = Math.round(((event.clientX - box.left) / box.width) * (chance.length - 1));
    const at = judged.find((m) => m.ply === ply) ?? judged.find((m) => m.ply === ply - 1);
    if (at) showJudged(at);
  });
  frame.title = 'Tap the chart to see that move';
  panel.appendChild(frame);

  const worst = judged.filter((m) => m.mine).reduce((a, b) => ((b.loss ?? 0) > (a?.loss ?? -1) ? b : a), null);
  if (worst && (worst.loss ?? 0) > 0) {
    panel.appendChild(el('p', 'note', `The biggest single drop of yours was ${moveLabel(worst)}.`));
  }
  box.appendChild(panel);
}

function renderReviewResult() {
  const { mistakes, accuracy, judged, capped } = Review.result;
  const box = $('reviewOut');
  box.hidden = false;
  box.innerHTML = '';
  const h = Review.parsed.headers;

  const summary = el('div', 'panel');
  const blunders = mistakes.filter((m) => m.severity === 'blunder').length;
  summary.innerHTML = `<h3>${esc(h.White ?? '?')} vs ${esc(h.Black ?? '?')}</h3>
    <p class="note">You played ${esc(Review.side)}. ${Math.ceil(Review.parsed.plies.length / 2)} moves, ${Review.result.counted} of your moves judged.</p>
    <div class="readout">
      <div><span class="k">Rough accuracy</span><span class="v">${accuracy === null ? '—' : `${accuracy}%`}</span></div>
      <div><span class="k">Mistakes found</span><span class="v">${mistakes.length}</span></div>
    </div>
    <p class="note">${blunders} of them ${blunders === 1 ? 'was' : 'were'} a blunder. ${accuracy === null
      ? `No accuracy: only ${Review.result.counted} of your moves were judged and ${Review.result.minJudged} are needed before an average means anything.`
      : `Accuracy here is your average loss per move, turned into a percentage. It is this engine's own
    figure and will not match the one Chess.com or Lichess shows you.`}</p>`;
  box.appendChild(summary);

  // The estimate, with what it is and is not, every time. A number on its
  // own would be read as a rating; it is a comparison with the app's ladder.
  const est = Review.result.meanLoss === null ? null : estimateRating(Review.result.meanLoss, Review.result.depth);
  if (est) {
    const panel = el('div', 'panel');
    panel.innerHTML = `<h3>How strong this game looked</h3>
      <div class="readout">
        <div><span class="k">Estimated strength</span><span class="v">${estimateWords(est)}</span></div>
        <div><span class="k">Played like the band</span><span class="v">${est.ceilingHit ? `${est.ceiling}+` : esc(est.band)}</span></div>
      </div>
      ${est.floorHit && Number.isFinite(est.floorLoss) ? `<p class="note"><strong>Why not a number:</strong> the weakest opponent this app has measured loses about ${(est.floorLoss / 100).toFixed(2)} points a move at this setting, and this game lost ${(Review.result.meanLoss / 100).toFixed(2)}. There is nothing below that on the scale — the ladder has no weaker rung to have measured — so this is where the measurement stops, not a statement about how strong you are. The figure gets useful as your loss per move comes down towards ${(est.floorLoss / 100).toFixed(2)}.</p>` : ''}
      ${est.ceilingHit ? `<p class="note"><strong>Why not a number:</strong> above ${est.ceiling} this app's own opponents all look the same to its reviewer — they play the moves it would play, and lose next to nothing — so the measurement cannot separate them, and a figure up there would be invented. Use a slower review setting for a little more range.</p>` : ''}
      <p class="note">Worked out from your average loss per move (${(Review.result.meanLoss / 100).toFixed(2)} points)
      by comparing it with games this app's own opponents played against each other, walked by the same reviewer at
      the same setting. <strong>It is a comparison with this app's ladder, not a rating.</strong> The ladder's numbers
      are targets rather than measured strengths, so treat this as "which band you played like today", not as your
      Chess.com or Lichess figure. The band named is one the calibration actually played — it was measured at
      ${est.step}-point steps, so the nearest rung to play is the ${esc(est.play.label)} band. Measured ${esc(est.measured)}.</p>`;
    box.appendChild(panel);
  } else if (Review.result.meanLoss === null) {
    box.appendChild(el('p', 'note', `No strength estimate: too few of your moves to estimate from (${Review.result.counted} judged, ${Review.result.minJudged} needed).`));
  } else {
    box.appendChild(el('p', 'note', 'No strength estimate: the calibration for this setting has not been made, and a figure without one would be a guess with a number on it.'));
  }

  // COUNTED AND STATED, never dropped quietly. A mate moment is capped at one
  // of each kind so it cannot take every slot, and a page that knows how many
  // it left out and does not say is this project's most repeated fault.
  const extra = [];
  if (capped?.allowed_mate) extra.push(`${capped.allowed_mate} other ${capped.allowed_mate === 1 ? 'move' : 'moves'} also allowed a forced checkmate`);
  if (capped?.missed_mate) extra.push(`${capped.missed_mate} other ${capped.missed_mate === 1 ? 'move' : 'moves'} also missed one`);
  if (extra.length) {
    summary.appendChild(el('p', 'note', `${extra.join(', and ')}. Only the first of each is listed: a forced mate scores at the top of the scale, so left uncapped they take every slot and the list becomes one collapse reported over and over.`));
  }

  renderCurve(box);

  // Every move, both sides, with a glyph — the chess.com move list. Tapping
  // one puts the position on the board with both arrows and the eval bar.
  const all = el('div', 'panel');
  all.appendChild(el('h3', null, 'Every move'));
  all.appendChild(el('p', 'note', 'Your moves are bold. ★ the engine’s own choice, ?! half a point, ? a point and a half, ?? three or more, #? a mate missed or allowed. Tap one to see it.'));
  const list = el('div', 'movelist');
  list.id = 'reviewMoves';
  for (const j of judged) {
    if (j.colour === 'white') list.appendChild(el('span', 'mn', `${j.moveNumber}.`));
    const btn = el('button', 'mv' + (j.mine ? ' mine' : ''), j.san);
    btn.type = 'button';
    btn.dataset.class = j.cls;
    btn.dataset.ply = j.ply;
    btn.title = describeJudged(j);
    btn.addEventListener('click', () => showJudged(j));
    list.appendChild(btn);
  }
  all.appendChild(list);
  box.appendChild(all);

  if (!mistakes.length) {
    box.appendChild(el('p', 'note', 'Nothing crossed the threshold. At this search depth that means no move of yours lost half a point or more.'));
    return;
  }

  const panel = el('div', 'panel');
  panel.appendChild(el('h3', null, 'What went wrong'));

  for (const m of mistakes) {
    const row = el('button', 'mistake ' + m.severity);
    const cost = m.loss === null ? m.label : `lost ${(m.loss / 100).toFixed(1)} points`;
    row.innerHTML = `<span class="mistake-move">${esc(moveLabel(m))}</span>
      <span class="mistake-sev">${esc(m.severity)}</span>
      <span class="mistake-note">${esc(cost)}${m.best ? ` · the engine wanted ${esc(m.best.san)}` : ''}</span>
      ${m.reason ? `<span class="mistake-why">${esc(m.reason)}</span>` : ''}`;
    row.addEventListener('click', () => showMistake(m));
    panel.appendChild(row);
  }

  const row = el('div', 'row');
  row.style.marginTop = '12px';
  const add = el('button', 'btn primary', `Add ${mistakes.length} to drills`);
  const said = el('span', 'note');
  said.style.margin = '0';
  said.style.alignSelf = 'center';
  add.addEventListener('click', async () => {
    add.disabled = true;
    // The confirmation lands NEXT TO THE BUTTON. It used to go to the status
    // line at the top of the page, which on a phone was two screens away.
    const added = await addMistakesToDrills(mistakes);
    // A BARE NUMBER IS NOT AN ANSWER. This printed "7" next to the button and
    // left you to work out what seven meant.
    said.textContent = added === 0
      ? 'Already in your drills.'
      : `${added} added — they are on the Drills screen.`;
    renderDrills();
  });
  row.appendChild(add);
  row.appendChild(said);
  panel.appendChild(row);
  box.appendChild(panel);
}

function describeJudged(j) {
  const who = j.mine ? 'You' : 'They';
  if (j.mates) return `${moveLabel(j)} — checkmate.`;
  if (j.cls === 'best') return `${moveLabel(j)} — the engine's own move.`;
  if (j.kind !== 'material') return `${moveLabel(j)} — ${j.label} The engine wanted ${j.best?.san ?? 'something else'}.`;
  if (j.cls === 'good') return `${moveLabel(j)} — fine. ${who} lost ${(j.loss / 100).toFixed(2)} points against ${j.best?.san ?? 'the engine’s move'}.`;
  return `${moveLabel(j)} — ${j.cls}: lost ${(j.loss / 100).toFixed(1)} points. The engine wanted ${j.best?.san ?? 'something else'}.`;
}

function showJudged(j) {
  $('reviewBoardWrap').hidden = false;
  Review.view.orientation = Review.side === 'white' ? WHITE : BLACK;
  Review.view.interactive = false;
  Review.view.setFen(j.fen, { arrows: arrowsFor(j.uci, j.best?.uci) });
  Review.bar.orient(Review.view.orientation);
  showReviewBar(j.whiteCpAfter);
  $('reviewBoardNote').textContent = describeJudged(j);
  $('reviewBoardEval').textContent = `After the move: ${plainEval(j.whiteCpAfter, 'White')}.`;
  const found = Review.result.mistakes.find((m) => m.ply === j.ply);
  $('reviewBoardWhy').textContent = found?.reason ?? '';
  $('reviewBoardWhy').hidden = !found?.reason;
  for (const btn of document.querySelectorAll('#reviewMoves .mv')) btn.classList.toggle('on', Number(btn.dataset.ply) === j.ply);
  const arrows = arrowsFor(j.uci, j.best?.uci);
  $('reviewExplore').onclick = () => openPractice(j.fen, { arrows });
  // NAMES BOTH MOVES, because the question is the comparison. The coach
  // searches every move a question names, so asking about two costs one extra
  // search and answers the thing actually being asked.
  $('reviewAskWhy').hidden = !Coach.ready || !j.best;
  $('reviewAskWhy').onclick = () => askCoachAbout(j.fen,
    j.cls === 'best'
      ? `Why is ${j.san} the best move here?`
      : `Why is ${j.best.san} better than my ${j.san}?`, { arrows });
  $('reviewBoardWrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * The eval bar, with the one case it does not know about. The bar labels a
 * mate by its distance, and a mate that has been DELIVERED is nought plies
 * away — which it prints as "M0" and titles "mates in 0". The bar lives in
 * board-view.js and is shared by three screens; until it learns the sentinel
 * itself, the review corrects the label here.
 */
function showReviewBar(whiteCp) {
  Review.bar.set(whiteCp);
  if (whiteCp === null || whiteCp === undefined || Math.abs(whiteCp) < CHECKMATE_SCORE) return;
  const host = $('reviewEval');
  for (const label of host.querySelectorAll('.evalbar-label')) if (label.textContent === 'M0') label.textContent = '#';
  host.title = `Checkmate — ${whiteCp > 0 ? 'Black' : 'White'} is checkmated`;
}

function showMistake(m) {
  const j = Review.result.judged.find((x) => x.ply === m.ply);
  if (j) { showJudged(j); return; }
  $('reviewBoardWrap').hidden = false;
  Review.view.orientation = m.side === 'white' ? WHITE : BLACK;
  Review.view.interactive = false;
  Review.view.setFen(m.fen, { arrows: arrowsFor(m.uci, m.best?.uci) });
  $('reviewBoardNote').textContent = m.loss === null
    ? `${moveLabel(m)} — ${m.label} The engine wanted ${m.best?.san ?? 'something else'}.`
    : `${moveLabel(m)} lost ${(m.loss / 100).toFixed(1)} points. The engine wanted ${m.best?.san ?? 'something else'}.`;
  $('reviewBoardWrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * Red for the move that was played, green for the move the engine wanted.
 * One helper so the two screens cannot drift into different colours for the
 * same two ideas.
 */
function arrowsFor(playedUci, bestUci) {
  const arrows = [];
  const square = (uci, at) => nameToSquare(uci.slice(at, at + 2));

  if (playedUci) arrows.push({ from: square(playedUci, 0), to: square(playedUci, 2), kind: 'played' });
  // Nothing is drawn twice: when the move played WAS the engine's, one green
  // arrow is the honest picture and a red one on top of it would invent a
  // disagreement.
  if (bestUci && bestUci !== playedUci) {
    arrows.push({ from: square(bestUci, 0), to: square(bestUci, 2), kind: 'best' });
  }
  return arrows;
}

/**
 * Turn mistakes into drills.
 *
 * `worstOnly` leaves inaccuracies out. A single game's review adds everything,
 * because six drills is six drills — but walking a hundred imported games at
 * once produced two hundred and thirty-one mistakes, and a drill list nobody
 * can finish is a drill list nobody starts. Blunders and mistakes are the ones
 * that decide games; the half-pawn inaccuracies are not what to spend an
 * evening on.
 *
 * Deduplicated by position, so the same mistake in four games is one drill.
 */
async function addMistakesToDrills(mistakes, { worstOnly = false } = {}) {
  let added = 0;
  for (const m of mistakes) {
    if (!m.best) continue;
    if (worstOnly && m.severity === 'inaccuracy') continue;
    if (App.drills.items.some((d) => d.fen === m.fen)) continue;
    App.drills.items.push({
      id: `${Date.now()}-${added}`,
      fen: m.fen,
      side: m.side,
      played: m.san,
      playedUci: m.uci,
      best: m.best,
      severity: m.severity,
      label: m.label,
      loss: m.loss,
      card: SRS.fresh(),
    });
    added++;
  }
  await Store.set('drills', App.drills);
  // A COUNT, NOT A SENTENCE. This used to return English, which is fine for the
  // one caller that put it straight on screen and wrong for any caller that
  // wants to add it up — the bulk walk did `+= ` on it and produced
  // "0Those are already in your drills. new positions added". A function that
  // changes data should hand back what it did, and let each screen say it.
  return added;
}

// ── drills ─────────────────────────────────────────────────────────────────
const Drill = { current: null, view: null, answered: false };

/**
 * Mistakes from games already reviewed that have never become drills.
 *
 * Every reviewed game carries its mistakes, so this needs no engine and no
 * re-walk: it is a set difference between what the reviews found and what the
 * drill list holds.
 */
function drillsOwed() {
  const have = new Set(App.drills.items.map((d) => d.fen));
  const owed = [];
  const seen = new Set();
  for (const game of App.reviews.games) {
    for (const m of game.mistakes ?? []) {
      if (!m.best || !m.fen) continue;
      if (m.severity === 'inaccuracy') continue;
      if (have.has(m.fen) || seen.has(m.fen)) continue;
      seen.add(m.fen);
      owed.push(m);
    }
  }
  return owed;
}

async function catchUpDrills() {
  const owed = drillsOwed();
  const added = await addMistakesToDrills(owed, { worstOnly: true });
  $('drillCatchUpNote').textContent = added
    ? `${added} added from games you had already reviewed.`
    : 'Nothing left to add.';
  renderDrills();
}

function renderDrills() {
  if (Drill.current) return;
  const due = dueDrills();
  $('drillEmpty').hidden = App.drills.items.length > 0;
  // THE CATCH-UP BUTTON, only when there is something to catch up on.
  const owed = drillsOwed().length;
  $('drillCatchUp').hidden = owed === 0;
  $('drillCatchUp').textContent = `Add ${owed} from reviewed games`;
  $('drillStart').hidden = due.length === 0;
  $('drillCount').textContent = App.drills.items.length === 0
    ? ''
    : (due.length === 0
      ? `Nothing due. ${App.drills.items.length} stored; the next comes back ${nextDrillDue()}.`
      : `${due.length} due of ${App.drills.items.length} stored.`);
  $('drillBoardWrap').hidden = true;
}

function nextDrillDue() {
  const soonest = Math.min(...App.drills.items.map((d) => d.card?.due ?? 0));
  if (!Number.isFinite(soonest)) return 'later';
  const days = Math.max(0, Math.ceil((soonest - Date.now()) / 86400000));
  return days <= 0 ? 'today' : (days === 1 ? 'tomorrow' : `in ${days} days`);
}

function startDrill() {
  const due = dueDrills();
  if (!due.length) { Drill.current = null; renderDrills(); return; }

  Drill.current = due[0];
  Drill.answered = false;
  $('drillBoardWrap').hidden = false;
  $('drillStart').hidden = true;
  $('drillCount').textContent = `${due.length} to go.`;

  Drill.view.orientation = Drill.current.side === 'white' ? WHITE : BLACK;
  Drill.view.interactive = true;
  Drill.view.onMove = onDrillMove;
  // NO ARROWS WHILE IT IS STILL A QUESTION. Drawing the engine's move here
  // would answer the thing being asked, and drawing only the played move would
  // point at the square to avoid, which is most of the answer.
  Drill.view.setFen(Drill.current.fen);
  $('drillLegend').hidden = true;
  $('drillPrompt').textContent = 'You played ' + Drill.current.played + ' here. Find something better.';
  $('drillAnswer').textContent = '';
  $('drillNext').hidden = true;
  $('drillExplore').hidden = true;
  $('drillAskWhy').hidden = true;
}

async function onDrillMove({ move, san }) {
  if (Drill.answered) return;
  const correct = san.replace(/[+#]$/, '') === Drill.current.best.san.replace(/[+#]$/, '');
  Drill.answered = true;
  Drill.view.interactive = false;
  Drill.view.apply(move);

  // Back to the position being asked about, with both moves drawn on it. The
  // board after your move shows the consequence; the board before it, with two
  // arrows, shows the choice — and the choice is the thing being learned.
  const arrows = arrowsFor(correct ? null : moveToUci(move), Drill.current.best.uci);
  Drill.view.setFen(Drill.current.fen, { arrows });
  $('drillLegend').hidden = false;

  $('drillAnswer').textContent = correct
    ? `Yes — ${Drill.current.best.san} is what the engine wanted.`
    : `Not quite. The engine wanted ${Drill.current.best.san}; you played ${san}.`;
  $('drillNext').hidden = false;
  $('drillExplore').hidden = false;
  $('drillExplore').onclick = () => openPractice(Drill.current.fen, { arrows });
  $('drillAskWhy').hidden = !Coach.ready;
  $('drillAskWhy').onclick = () => askCoachAbout(Drill.current.fen,
    `Why is ${Drill.current.best.san} better than ${Drill.current.played}?`, { arrows });

  Drill.current.card = SRS.review(Drill.current.card, correct);
  await Store.set('drills', App.drills);
}

function nextDrill() { Drill.current = null; startDrill(); if (!Drill.current) renderDrills(); }

/**
 * What each theme is called on screen.
 *
 * WORDED FROM THE DEFENDING SIDE, always. A puzzle theme describes what the
 * solver does; a game-mistake theme describes what was done TO the player, and
 * the inversion is total rather than per-theme. Showing one label for both is
 * what put fifteen mate-in-one puzzles under the heading "leaving pieces
 * unprotected" in the app this came from.
 */
const THEME_LABEL = {
  hangingPiece: 'Leaving a piece loose',
  fork: 'Allowing a fork',
  pin: 'Getting pinned',
  skewer: 'Getting skewered',
  discoveredAttack: 'Walking into a discovery',
  backRankMate: 'Back rank',
  trappedPiece: 'Letting a piece get trapped',
  exposedKing: 'Opening up your own king',
  mateIn1: 'Allowing mate in one',
  mateIn2: 'Allowing mate in two',
  mateIn3: 'Allowing mate in three',
  missedMate: 'Missing a forced mate',
  lostMaterial: 'Losing material with no trick behind it',
};

// ── progress ───────────────────────────────────────────────────────────────
// ── progress over time ─────────────────────────────────────────────────────
//
// The panels below this one say what your mistakes have in common. They do not
// say whether there are fewer of them than there used to be, which is the only
// question anybody opens a progress screen to ask.
//
// WHAT IS PLOTTED IS WHAT WAS ALREADY MEASURED. Every review stores its own
// accuracy, its mistake list and a calibrated strength estimate; none of that
// was ever shown against time. Nothing new is computed here and nothing is
// smoothed away: the dots are the games, and the line through them is a
// rolling median, which one collapse cannot drag the way a mean can.
const Progress = { measure: 'accuracy' };

const PROGRESS_MEASURES = {
  accuracy: {
    label: 'Accuracy',
    note: 'The share of your moves the engine judged best or near it. Games too short to score are left out rather than counted as nought.',
    better: 'up',
    value: (game) => (Number.isFinite(game.accuracy) ? game.accuracy : null),
    format: (v) => `${Math.round(v)}%`,
  },
  mistakes: {
    label: 'Mistakes a game',
    note: 'Every inaccuracy, mistake and blunder the review found in your moves. A long game has more room for them than a short one.',
    better: 'down',
    value: (game) => (game.mistakes ?? []).length,
    format: (v) => v.toFixed(1),
  },
  estimate: {
    label: 'Strength estimate',
    note: 'What each game’s average loss per move resembles on this app’s own ladder. The ladder’s numbers are targets rather than measured ratings, and above the calibration ceiling it can only say "or above".',
    better: 'up',
    value: (game) => (Number.isFinite(game.estimate?.elo) ? game.estimate.elo : null),
    format: (v) => String(Math.round(v)),
  },
};

/** The middle value of a window, so one disaster moves the line by one place. */
function rollingMedian(values, window = 5) {
  return values.map((_, i) => {
    const from = Math.max(0, i - Math.floor(window / 2));
    const slice = values.slice(from, from + window).filter((v) => v !== null);
    if (!slice.length) return null;
    const sorted = [...slice].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  });
}

/**
 * A rolling window that suits the number of games.
 *
 * FIVE WAS FIXED, AND FIVE OVER TWO HUNDRED GAMES IS NOT A TREND LINE, it is
 * the noise redrawn slightly smoother. The window grows with the sample so the
 * line answers the question the screen asks — is this going anywhere — rather
 * than tracing every good and bad afternoon.
 */
const trendWindow = (n) => Math.max(5, Math.min(25, Math.round(n / 12)) | 1);

/** The rolling low and high of the same window, for the spread behind the line. */
function rollingSpread(values, window) {
  const lo = [], hi = [];
  for (let i = 0; i < values.length; i++) {
    const from = Math.max(0, i - Math.floor(window / 2));
    const slice = values.slice(from, from + window).filter((v) => v !== null);
    if (!slice.length) { lo.push(null); hi.push(null); continue; }
    lo.push(Math.min(...slice));
    hi.push(Math.max(...slice));
  }
  return { lo, hi };
}

/**
 * How your games have gone, over however many of them there are.
 *
 * WHAT WAS WRONG WITH THE OLD ONE. Every game was a seven-pixel dot in the
 * accent colour, with the trend line underneath. At nine games that is a chart.
 * At two hundred and forty-three it is a solid band of red with a line hidden
 * somewhere inside it: the loudest mark on the screen was the noise, and the
 * one thing worth reading was behind it.
 *
 * So the emphasis is the other way round now. The trend is the only strong
 * mark. The spread it was drawn from is a soft band behind it, which says the
 * same thing two hundred dots were trying to say — how much the games vary —
 * without drawing two hundred of anything. Individual games are only drawn
 * while there are few enough of them to tell apart.
 *
 * And it has an axis. "0 to 1400" underneath was the whole vertical scale; now
 * there are gridlines and three labels, and hovering names the game.
 */
function renderProgressChart(games) {
  const measure = PROGRESS_MEASURES[Progress.measure];
  const panel = el('div', 'panel');
  panel.appendChild(el('h3', null, 'Over time'));

  const picker = el('div', 'row');
  for (const [key, spec] of Object.entries(PROGRESS_MEASURES)) {
    const button = el('button', key === Progress.measure ? 'btn primary' : 'btn', spec.label);
    button.type = 'button';
    button.addEventListener('click', () => { Progress.measure = key; renderProgress(); });
    picker.appendChild(button);
  }
  panel.appendChild(picker);

  const values = games.map(measure.value);
  const scored = values.filter((v) => v !== null);

  // THREE POINTS IS NOT A TREND AND IS NOT DRAWN AS ONE. A line through two
  // games always slopes, and the slope is noise; saying so is more use than
  // a chart that implies otherwise.
  if (scored.length < 3) {
    panel.appendChild(el('p', 'note',
      `${scored.length} of your ${games.length} reviewed ${games.length === 1 ? 'game has' : 'games have'} a ${measure.label.toLowerCase()} to plot. Three are needed before a line through them means anything.`));
    return panel;
  }

  const lo = Math.min(...scored), hi = Math.max(...scored);
  // EVERY GAME THE SAME NUMBER IS A REAL HISTORY, not a broken one. It is what
  // a run of games pinned to the bottom of the strength estimate looks like,
  // which is the shape a lot of real histories have. Dividing by a made-up
  // span of 1 drew a scale that does not exist: a hundred and twenty games all
  // worth 300 came out labelled "300 / 301 / 300", with the top of the axis
  // BELOW its own middle. When nothing varies the line goes down the middle
  // and the axis says the one number there is.
  const flat = hi === lo;
  const span = hi - lo || 1;
  const window = trendWindow(scored.length);
  const trend = rollingMedian(values, window);
  const spread = rollingSpread(values, window);
  const width = Math.max(2, values.length - 1);
  const y = (v) => (flat ? 50 : 96 - ((v - lo) / span) * 92);

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'curve chart');
  svg.setAttribute('viewBox', `0 0 ${width} 100`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', flat
    ? `${measure.label} across ${games.length} reviewed games, every one of them ${measure.format(hi)}`
    : `${measure.label} across ${games.length} reviewed games, from ${measure.format(lo)} to ${measure.format(hi)}`);

  // ── the grid, one shade off the ground and behind everything ─────────────
  for (const frac of [0, 0.5, 1]) {
    const rule = document.createElementNS(NS, 'line');
    const at = 4 + frac * 92;
    rule.setAttribute('x1', 0); rule.setAttribute('x2', width);
    rule.setAttribute('y1', at); rule.setAttribute('y2', at);
    rule.setAttribute('class', 'chart-grid');
    svg.appendChild(rule);
  }

  // ── the spread the trend was drawn from ──────────────────────────────────
  //
  // The band is what replaces two hundred dots: it is the highest and lowest
  // game inside the same rolling window, so its thickness IS how much the
  // games vary, drawn once instead of once per game.
  const top = [], bottom = [];
  for (let i = 0; i < values.length; i++) {
    if (spread.hi[i] === null) continue;
    top.push(`${i},${y(spread.hi[i])}`);
    bottom.unshift(`${i},${y(spread.lo[i])}`);
  }
  if (top.length > 1) {
    const band = document.createElementNS(NS, 'polygon');
    band.setAttribute('points', [...top, ...bottom].join(' '));
    band.setAttribute('class', 'chart-band');
    svg.appendChild(band);
  }

  // ── the trend, which is the point of the chart ───────────────────────────
  const points = trend.map((v, i) => (v === null ? null : `${i},${y(v)}`)).filter(Boolean);
  if (points.length > 1) {
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', points.join(' '));
    line.setAttribute('class', 'chart-trend');
    svg.appendChild(line);
  }

  // ── and the games themselves, ONLY while they can be told apart ──────────
  //
  // A DOT DRAWN AS A CIRCLE IN THIS VIEWBOX IS NOT A DOT. The chart is
  // stretched to the width of the panel with preserveAspectRatio="none", so a
  // zero-length line with a round cap and a non-scaling stroke is the only way
  // to get a circle measured in screen pixels. Above the cap they are not
  // drawn at all: at one dot per pixel they stop being dots.
  const DOT_CAP = 40;
  const showDots = values.length <= DOT_CAP;
  if (showDots) {
    for (let i = 0; i < values.length; i++) {
      if (values[i] === null) continue;
      const dot = document.createElementNS(NS, 'line');
      dot.setAttribute('x1', i); dot.setAttribute('x2', i);
      dot.setAttribute('y1', y(values[i])); dot.setAttribute('y2', y(values[i]));
      dot.setAttribute('class', 'chart-dot');
      svg.appendChild(dot);
    }
  }

  // The one dot that is always drawn: where you are now.
  const lastAt = values.length - 1 - [...values].reverse().findIndex((v) => v !== null);
  if (Number.isFinite(values[lastAt])) {
    const now = document.createElementNS(NS, 'line');
    now.setAttribute('x1', lastAt); now.setAttribute('x2', lastAt);
    now.setAttribute('y1', y(values[lastAt])); now.setAttribute('y2', y(values[lastAt]));
    now.setAttribute('class', 'chart-now');
    svg.appendChild(now);
  }

  // ── the frame, with the vertical scale beside it ─────────────────────────
  const plot = el('div', 'chart-plot');
  const axis = el('div', 'chart-yaxis');
  // The blanks keep the one label on the middle rule: the three spans are
  // pinned to the three gridlines by position, not by order.
  for (const v of (flat ? [null, hi, null] : [hi, lo + span / 2, lo])) {
    axis.appendChild(el('span', null, v === null ? '' : measure.format(v)));
  }
  plot.appendChild(axis);
  const frame = el('div', 'curve-frame chart-frame');
  frame.appendChild(svg);
  plot.appendChild(frame);

  // ── hovering names the game, because a trend line hides the games ────────
  //
  // Nearest-point rather than a hit area on each mark: at this density the
  // marks are a pixel apart and there is nothing to aim at.
  const tip = el('div', 'chart-tip');
  tip.hidden = true;
  frame.appendChild(tip);
  const at = (event) => {
    const box = frame.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (event.clientX - box.left) / (box.width || 1)));
    return Math.round(frac * (values.length - 1));
  };
  const showTip = (event) => {
    const i = at(event);
    const value = values[i];
    tip.hidden = false;
    tip.textContent = value === null
      ? `Game ${i + 1} of ${values.length} — not scored`
      : `Game ${i + 1} of ${values.length} — ${measure.format(value)}`;
    const box = frame.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max(6, event.clientX - box.left), box.width - 6)}px`;
  };
  frame.addEventListener('pointermove', showTip);
  frame.addEventListener('pointerdown', showTip);
  frame.addEventListener('pointerleave', () => { tip.hidden = true; });
  panel.appendChild(plot);

  // Two facts, not four muddled together: the left-to-right axis is time, and
  // the up-and-down one is the measure — which now has its own labels, so this
  // line only has to carry the time axis and what the marks mean.
  const scale = el('div', 'chart-scale');
  scale.appendChild(el('span', null, `${games.length} games · oldest left`));
  // The rolling middle of a flat run is the same number, so naming the window
  // there would be a fact about nothing.
  if (!flat) scale.appendChild(el('span', null, `line: middle of ${window}`));
  panel.appendChild(scale);
  // What the marks are, on its own line — this wrapped into the axis label when
  // the two were crammed onto one row on a phone. A flat line needs none of it:
  // the sentence under the chart already says the one thing there is to say,
  // and saying it twice in a row reads like a stutter.
  if (!flat) {
    panel.appendChild(el('p', 'note chart-key',
      `The line is the middle of every ${window} games in a row, and the band is the best and worst of the same ${window} — so how thick the band is, is how much your games vary.${showDots ? ' Each dot is one game.' : ` Single games are only dotted up to ${DOT_CAP} of them; all ${values.length} would be one solid block. Touch the chart to name one.`}`));
  }

  // ── and what it amounts to, in a sentence ────────────────────────────────
  const half = Math.floor(scored.length / 2);
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  const earlier = mean(scored.slice(0, half));
  const later = mean(scored.slice(half));
  const change = later - earlier;
  const improving = measure.better === 'up' ? change > 0 : change < 0;
  // A difference smaller than this is not worth a word either way, and the
  // number of games here is never large enough to prove one.
  const meaningful = Math.abs(change) >= (measure.better === 'up' ? Math.max(1, span * 0.08) : 0.3);
  const halves = `First ${half} games: ${measure.format(earlier)}. Last ${scored.length - half}: ${measure.format(later)}.`;

  const verdict = el('p', 'note');
  verdict.textContent = flat
    ? `Every one of your ${scored.length} scored games came out at ${measure.format(hi)}. That is not a flat run of form — it is the measure itself running out of room, so nothing it says here can move until the games move off it.`
    : scored.length < 6
    ? `${halves} With ${scored.length} scored games that is a difference, not a trend — it takes many more before one bad afternoon stops moving the line.`
    : !meaningful
      ? `${halves} That is flat: the two halves are close enough that the order of the games would change which was higher.`
      : `${halves} Going ${improving ? 'the right way' : 'the wrong way'}. Both halves are your own games at whatever setting you reviewed them with, so a change of setting shows up here as a change in you.`;
  panel.appendChild(verdict);
  panel.appendChild(el('p', 'note', measure.note));
  return panel;
}

function renderProgress() {
  const box = $('progressOut');
  box.innerHTML = '';

  // AN IMPORTED GAME IS NOT A REVIEWED ONE. Bringing games in from Chess.com
  // stores their moves, which is all the repertoire report and the tactics
  // miner need — but nothing on this page can be said about a game the engine
  // has not walked. Counting them here would report three hundred reviews
  // whose accuracy nobody measured, and would file them under "too short to
  // score", which is not why they have no score.
  //
  // A row with no `reviewed` field at all was stored before importing existed,
  // and every one of those WAS a review, so absent means reviewed.
  const games = App.reviews.games.filter((g) => g.reviewed !== false);
  const waiting = App.reviews.games.length - games.length;
  const allMistakes = games.flatMap((g) => g.mistakes ?? []);

  if (!games.length) {
    if (waiting) {
      box.innerHTML = `<p class="note">${waiting} imported ${waiting === 1 ? 'game is' : 'games are'} stored and none of them has been walked by the engine yet. Review one and this fills in: how often each kind of mistake shows up, and whether it is getting rarer.</p>`;
      return;
    }
  }
  if (!games.length) {
    box.innerHTML = '<p class="note">Review a game and this fills in: how often each kind of mistake shows up, and whether it is getting rarer.</p>';
    return;
  }

  const bySeverity = { blunder: 0, mistake: 0, inaccuracy: 0 };
  // A row without a severity is a row written before there was one, and it
  // is skipped rather than shown as a bar called "undefined".
  for (const m of allMistakes) if (m.severity) bySeverity[m.severity] = (bySeverity[m.severity] ?? 0) + 1;

  const byKind = {};
  for (const m of allMistakes) byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;

  const perGame = (allMistakes.length / games.length).toFixed(1);
  // Games too short to have an accuracy are left OUT of the mean, not counted
  // as nought — and not as a hundred, which is what they used to be.
  const scored = games.filter((g) => Number.isFinite(g.accuracy));
  const accuracy = scored.length ? Math.round(scored.reduce((sum, g) => sum + g.accuracy, 0) / scored.length) : null;

  const summary = el('div', 'panel');
  summary.innerHTML = `<h3>Across ${games.length} reviewed ${games.length === 1 ? 'game' : 'games'}${waiting ? `, with ${waiting} imported and not yet walked` : ''}</h3>
    <div class="readout">
      <div><span class="k">Mistakes a game</span><span class="v">${perGame}</span></div>
      <div><span class="k">Mean accuracy</span><span class="v">${accuracy === null ? '—' : `${accuracy}%`}</span></div>
    </div>${scored.length < games.length ? `<p class="note">${games.length - scored.length} of these ${games.length - scored.length === 1 ? 'was' : 'were'} too short to score and ${games.length - scored.length === 1 ? 'is' : 'are'} left out of the mean.</p>` : ''}`;
  box.appendChild(summary);
  box.appendChild(renderProgressChart(games));

  // A rolling estimate over recent reviewed games — the MEDIAN, so one
  // collapse or one lucky game does not drag it — and the band it points at.
  // `Number.isFinite`, not truthiness: an estimate pinned at the floor is
  // elo 0, and a truthy test dropped exactly the worst games from the median.
  const rated = games.filter((g) => Number.isFinite(g.estimate?.elo)).slice(-8);
  if (rated.length) {
    const elos = rated.map((g) => g.estimate.elo).sort((a, b) => a - b);
    const median = elos[Math.floor(elos.length / 2)];
    const measured = measuredBands();
    const step = measuredStep(measured);
    const measuredIndex = Math.max(0, measured.findIndex((b, i) => median < (measured[i + 1] ?? Infinity)));
    const play = nearestPlayableBand(median);
    const spread = elos.length > 1 ? `${elos[0]}–${elos[elos.length - 1]}` : String(median);
    const atCeiling = rated.filter((g) => g.estimate.ceilingHit).length;
    // AND THE SAME AT THE OTHER END. A median of 0 is not a strength, it is the
    // bottom of the measured scale, and printing it bare was the same fault the
    // per-game rows had.
    const atFloor = rated.filter((g) => g.estimate.floorHit).length;
    const floorUnder = measured[0] + step;
    const middle = atCeiling > rated.length / 2 ? `${median} or above`
      : (atFloor > rated.length / 2 ? `under ${floorUnder}` : String(median));
    const say = (elo) => (elo <= measured[0] ? `under ${floorUnder}` : String(elo));
    // "they ranged under 300 to under 300" is a range of one thing said twice.
    const low = say(elos[0]), high = say(elos[elos.length - 1]);
    const range = low === high ? `all ${low}` : `${low} to ${high}`;
    const panel = el('div', 'panel');
    panel.innerHTML = `<h3>How strong your games look</h3>
      <div class="readout">
        <div><span class="k">Middle of your last ${rated.length}</span><span class="v">${middle}</span></div>
        <div><span class="k">Played like the band</span><span class="v">${esc(measuredBandLabel(measuredIndex, measured))}</span></div>
      </div>
      ${atFloor > rated.length / 2 && Number.isFinite(rated[rated.length - 1].estimate?.floorLoss) ? `<p class="note"><strong>The scale has run out below you, which is not the same as a low number.</strong> ${atFloor} of these ${rated.length} games lost more per move than the weakest opponent this app has ever measured — about ${(rated[rated.length - 1].estimate.floorLoss / 100).toFixed(2)} points a move. The ladder has no weaker rung, so there is nothing to compare them against and the figure cannot separate them. Mistakes a game, above, is the measure that still works here.</p>` : ''}
      <p class="note">The middle value of the per-game estimates from your last ${rated.length} reviewed ${rated.length === 1 ? 'game' : 'games'} (they ranged ${range}). Each one compares your average loss per move with this app's own ladder, whose numbers are targets rather than measured ratings — so this says which band your recent games resemble, and nothing about your rating anywhere else. The band named is one the calibration actually played, measured at ${step}-point steps${atFloor > rated.length / 2 ? '' : `; the button below picks the nearest rung the ladder offers, the ${esc(play.label)} band`}.</p>`;
    // NO BAND BUTTON OFF A FLOORED ESTIMATE. The nearest rung to an estimate
    // pinned at the bottom is the weakest band there is — an opponent that
    // plays a random move three times in five — and offering that to somebody
    // whose games the scale simply could not measure is the app acting on a
    // number it has just finished explaining it does not have. The record of
    // what you have actually beaten is a measurement; this is not.
    if (atFloor > rated.length / 2) {
      panel.appendChild(el('p', 'note', 'No band suggested. The nearest rung to a floored estimate is the weakest bot on the ladder, which is not what these games say you should play. Pick by your record on the Today page, where the wins and losses are real.'));
    } else {
      const go = el('button', 'btn', `Play the ${play.label} band`);
      go.addEventListener('click', () => { Play.band = BANDS[play.index]; renderBandPicker(); show('play'); newPlayGame(); });
      panel.appendChild(go);
    }
    box.appendChild(panel);
  }

  const breakdown = el('div', 'panel');
  breakdown.appendChild(el('h3', null, 'By severity'));
  const bars = el('div', 'bars');
  const worst = Math.max(1, ...Object.values(bySeverity));
  for (const [name, count] of Object.entries(bySeverity)) {
    const row = el('div', 'bar-row');
    row.innerHTML = `<span class="bar-label">${esc(name)}</span>
      <span class="bar"><span class="bar-fill sev-${esc(name)}" style="width:${Math.round((count / worst) * 100)}%"></span></span>
      <span class="bar-count">${count}</span>`;
    bars.appendChild(row);
  }
  breakdown.appendChild(bars);

  // WHAT THEY HAVE IN COMMON, which is the question this page exists to
  // answer and which severity alone cannot: "twelve blunders" says how bad,
  // never what kind. Every theme here was measured on the board.
  const byTheme = {};
  let classified = 0;
  for (const m of allMistakes) {
    if (!m.themes?.length) continue;
    classified++;
    for (const theme of m.themes) byTheme[theme] = (byTheme[theme] ?? 0) + 1;
  }
  const themes = Object.entries(byTheme).sort((a, b) => b[1] - a[1]);
  if (themes.length) {
    const panel = el('div', 'panel');
    panel.appendChild(el('h3', null, 'What your mistakes have in common'));
    panel.appendChild(el('p', 'note', 'Each one was shown on the board by replaying the moves that punished you, not guessed from what the move cost. They describe what was done TO you.'));
    const bars = el('div', 'bars');
    const worst = Math.max(...themes.map(([, n]) => n));
    for (const [theme, count] of themes) {
      const row = el('div', 'bar-row');
      row.innerHTML = `<span class="bar-label">${esc(THEME_LABEL[theme] ?? theme)}</span>
        <span class="bar"><span class="bar-fill" style="width:${Math.round((count / worst) * 100)}%"></span></span>
        <span class="bar-count">${count}</span>`;
      bars.appendChild(row);
    }
    panel.appendChild(bars);
    // COUNTED AND STATED. A mistake the classifier could not name is not a
    // mistake without a cause, and reporting only what it could name would
    // make the list look more complete than it is.
    const unnamed = allMistakes.length - classified;
    if (unnamed) {
      panel.appendChild(el('p', 'note', `${unnamed} of your ${allMistakes.length} mistakes could not be given a name: the moves that punished them showed no motif this app is able to demonstrate. They were positional, or the loss came from a sequence rather than a trick.`));
    }
    box.appendChild(panel);
  }

  const mates = (byKind.allowed_mate ?? 0) + (byKind.missed_mate ?? 0);
  if (mates > 0) {
    breakdown.appendChild(el('p', 'note',
      `${byKind.allowed_mate ?? 0} of your moves allowed a forced mate and ${byKind.missed_mate ?? 0} missed one. `
      + 'Those are counted separately because a mate is not a number of points and cannot be averaged with one.'));
  }
  box.appendChild(breakdown);

  // Whether it is getting rarer: the first half of the reviewed games against
  // the second. Two numbers, or nothing — a trend line through three games
  // would be decoration.
  if (games.length >= 4) {
    const half = Math.floor(games.length / 2);
    const rate = (list) => (list.reduce((s, g) => s + (g.mistakes?.length ?? 0), 0) / list.length).toFixed(1);
    const earlier = rate(games.slice(0, half)), later = rate(games.slice(half));
    const trend = el('div', 'panel');
    trend.innerHTML = `<h3>Is it getting rarer?</h3>
      <div class="readout">
        <div><span class="k">Earlier ${half} games</span><span class="v">${earlier}</span></div>
        <div><span class="k">Latest ${games.length - half} games</span><span class="v">${later}</span></div>
      </div>
      <p class="note">Mistakes a game, first half of your reviewed games against the second. The same search setting has to be used for the two to be comparable.</p>`;
    box.appendChild(trend);
  }

  const recent = el('div', 'panel');
  recent.appendChild(el('h3', null, 'Games reviewed'));
  const list = el('div', 'record');
  for (const g of [...games].reverse().slice(0, 12)) {
    const row = el('div', 'record-row');
    row.innerHTML = `<span class="record-band">${esc(g.white)} vs ${esc(g.black)}</span>
      <span class="record-score">${(g.mistakes ?? []).length} found · ${Number.isFinite(g.accuracy) ? `${g.accuracy}%` : 'too short to score'}${estimateWords(g.estimate, { short: true }) ? ` · looked like ${estimateWords(g.estimate, { short: true })}` : ''}</span>`;
    list.appendChild(row);
  }
  recent.appendChild(list);
  box.appendChild(recent);

  // Games against the ladder, so the record on Today has somewhere to go into
  // detail.
  if (App.history.games.length) {
    const played = el('div', 'panel');
    played.appendChild(el('h3', null, 'Games against the ladder'));
    const rows = el('div', 'record');
    for (const g of [...App.history.games].reverse().slice(0, 12)) {
      const row = el('div', 'record-row');
      const when = new Date(g.at).toLocaleDateString();
      row.innerHTML = `<span class="record-band">${esc(when)} · ${esc(bandLabelFor(g.band))} · as ${esc(g.colour)}${g.from ? ' · from a set-up position' : ''}</span>
        <span class="record-score">${{ w: 'Won', d: 'Drew', l: 'Lost' }[g.result]} · ${Math.ceil(g.plies / 2)} moves</span>`;
      rows.appendChild(row);
    }
    played.appendChild(rows);
    box.appendChild(played);
  }
}
