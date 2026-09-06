// ── board vision ───────────────────────────────────────────────────────────
//
// Naming a square without counting up from a1 is the thing every other part of
// this app quietly assumes you can do. The openings talk about d4 and c5, the
// review says the mistake was on f7, the coach answers in algebraic — and all
// of it is noise until the letters and numbers are somewhere you can reach
// without thinking.
//
// Three questions, mixed, against a clock: point at a named square, name a
// pointed-at one, and say what colour it is without looking. The last is the
// one people skip and the one that pays: a bishop's whole life is spent on one
// colour, and "is that square dark" is a question you have to answer in your
// head about a square with nothing on it.
//
// THE BOARD IS BUILT HERE RATHER THAN BORROWED. makeBoardView() is for
// positions — it carries pieces, drags, arrows, promotions and a legal-move
// model, none of which mean anything on an empty board where a tap is an
// answer and not a move. The classes are the app's own, so it looks like every
// other board in it.

const Vision = {
  running: false,
  mode: 'mixed',
  orientation: 'white',   // white | black | random
  seconds: 30,
  endsAt: 0,
  ticker: null,
  score: 0,
  asked: 0,
  streak: 0,
  question: null,
  best: {},
  grid: null,
  gridFor: null,          // the orientation the cells were built for
};

const FILES = 'abcdefgh';
const visionSquareName = (sq) => FILES[sq & 7] + ((sq >> 4) + 1);
const visionIsLight = (sq) => (((sq & 7) + (sq >> 4)) % 2) === 1;

/** Every square, in the order they are laid out for a given orientation. */
function visionSquares(white) {
  const out = [];
  for (let rank = 7; rank >= 0; rank--) {
    for (let file = 0; file < 8; file++) {
      out.push(white ? (rank << 4) | file : ((7 - rank) << 4) | (7 - file));
    }
  }
  return out;
}

function buildVisionGrid(white) {
  const host = $('visionBoard');
  const grid = document.createElement('div');
  grid.className = 'board';
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', 'Board vision');

  for (const sq of visionSquares(white)) {
    const cell = document.createElement('div');
    cell.className = 'sq ' + (visionIsLight(sq) ? 'light' : 'dark');
    cell.dataset.sq = String(sq);
    cell.setAttribute('role', 'gridcell');
    // The name is on the cell for a screen reader but never drawn: the whole
    // exercise is knowing it without being told.
    cell.setAttribute('aria-label', visionSquareName(sq));
    cell.addEventListener('click', () => answerVision({ square: sq }));
    grid.appendChild(cell);
  }

  const frame = document.createElement('div');
  frame.className = 'board-frame';
  frame.appendChild(grid);

  const coords = document.createElement('div');
  coords.className = 'coords';
  coords.setAttribute('aria-hidden', 'true');
  coords.innerHTML = [...(white ? FILES : [...FILES].reverse().join(''))]
    .map((f) => `<span>${f}</span>`).join('');

  host.innerHTML = '';
  host.appendChild(frame);
  host.appendChild(coords);
  Vision.grid = grid;
  Vision.gridFor = white ? 'white' : 'black';
}

function visionCell(sq) {
  return Vision.grid?.querySelector(`[data-sq="${sq}"]`);
}

function clearVisionMarks() {
  if (!Vision.grid) return;
  for (const cell of Vision.grid.children) cell.classList.remove('vision-ask', 'vision-right', 'vision-wrong');
}

// ── the round ──────────────────────────────────────────────────────────────

function startVision() {
  Vision.running = true;
  Vision.score = 0;
  Vision.asked = 0;
  Vision.streak = 0;
  Vision.endsAt = Date.now() + Vision.seconds * 1000;

  // OUT OF THE WAY WHILE THE CLOCK RUNS. The blurb and the two pickers are
  // most of a phone screen, and with them there the clock, the score, the
  // question and the board were all below the fold — thirty seconds of a
  // thirty-second round spent scrolling.
  $('visionSetup').hidden = true;
  $('visionLede').hidden = true;
  $('visionLayout').classList.add('live');
  $('visionStart').hidden = true;
  $('visionStop').hidden = false;
  $('visionSummary').textContent = '';
  $('visionBoardWrap').hidden = false;

  clearInterval(Vision.ticker);
  Vision.ticker = setInterval(tickVision, 100);
  nextVisionQuestion();
  renderVisionScore();
}

function tickVision() {
  if (!Vision.running) return;
  if (Date.now() >= Vision.endsAt) { finishVision(); return; }
  renderVisionClock();
}

function renderVisionClock() {
  const left = Math.max(0, Vision.endsAt - Date.now());
  $('visionClock').textContent = (left / 1000).toFixed(1) + 's';
  $('visionClock').className = left < 5000 ? 'v urgent' : 'v';
}

function renderVisionScore() {
  $('visionScore').textContent = String(Vision.score);
  $('visionStreak').textContent = Vision.streak > 1 ? `${Vision.streak} in a row` : '';
}

/** A different square from the last one, so the answer is never "the same again". */
function pickVisionSquare(avoid) {
  for (let tries = 0; tries < 50; tries++) {
    const sq = ((Math.floor(Math.random() * 8)) << 4) | Math.floor(Math.random() * 8);
    if (sq !== avoid) return sq;
  }
  return 0;
}

function nextVisionQuestion() {
  if (!Vision.running) return;
  clearVisionMarks();
  $('visionFeedback').textContent = '';

  const white = Vision.orientation === 'white' ? true
    : Vision.orientation === 'black' ? false
    : Math.random() < 0.5;
  if (Vision.gridFor !== (white ? 'white' : 'black') || !Vision.grid) buildVisionGrid(white);

  const kinds = Vision.mode === 'mixed' ? ['find', 'name', 'colour'] : [Vision.mode];
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  const square = pickVisionSquare(Vision.question?.square);
  Vision.question = { kind, square };

  const options = $('visionOptions');
  options.innerHTML = '';

  if (kind === 'find') {
    $('visionPrompt').textContent = `Tap ${visionSquareName(square)}`;
    $('visionHow').textContent = white ? 'White at the bottom.' : 'Black at the bottom.';
    return;
  }

  if (kind === 'name') {
    $('visionPrompt').textContent = 'Which square is ringed?';
    $('visionHow').textContent = white ? 'White at the bottom.' : 'Black at the bottom.';
    visionCell(square)?.classList.add('vision-ask');
    for (const name of nameChoices(square)) {
      const button = el('button', 'btn', name);
      button.type = 'button';
      button.addEventListener('click', () => answerVision({ name }));
      options.appendChild(button);
    }
    return;
  }

  $('visionPrompt').textContent = `Is ${visionSquareName(square)} light or dark?`;
  $('visionHow').textContent = 'Answer without looking for it.';
  for (const [label, light] of [['Light', true], ['Dark', false]]) {
    const button = el('button', 'btn', label);
    button.type = 'button';
    button.addEventListener('click', () => answerVision({ light }));
    options.appendChild(button);
  }
}

/**
 * Four names to choose between: the right one, and three that are wrong in the
 * three ways people actually get squares wrong — the rank slipped, the file
 * slipped, and the two read the wrong way round.
 */
function nameChoices(square) {
  const file = square & 7, rank = square >> 4;
  const name = (f, r) => FILES[f] + (r + 1);
  const wrong = new Set();
  wrong.add(name(file, (rank + 1) % 8));
  wrong.add(name((file + 1) % 8, rank));
  wrong.add(name(rank, file));                       // read the wrong way round
  wrong.delete(name(file, rank));
  const out = [name(file, rank), ...[...wrong].slice(0, 3)];
  while (out.length < 4) {
    const extra = name(Math.floor(Math.random() * 8), Math.floor(Math.random() * 8));
    if (!out.includes(extra)) out.push(extra);
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function answerVision(given) {
  if (!Vision.running || !Vision.question) return;
  const { kind, square } = Vision.question;
  let right = false;
  if (kind === 'find') right = given.square === square;
  else if (kind === 'name') right = given.name === visionSquareName(square);
  else right = given.light === visionIsLight(square);

  Vision.asked++;
  if (right) {
    Vision.score++;
    Vision.streak++;
    $('visionFeedback').textContent = '';
    $('visionFeedback').className = 'note good-note';
    visionCell(square)?.classList.add('vision-right');
  } else {
    Vision.streak = 0;
    // WRONG ANSWERS SHOW THE ANSWER. A trainer that only says "no" trains you
    // to guess faster; the square lights up so the next one is learned rather
    // than survived.
    $('visionFeedback').textContent = kind === 'colour'
      ? `${visionSquareName(square)} is ${visionIsLight(square) ? 'light' : 'dark'}.`
      : `That was ${visionSquareName(square)}.`;
    $('visionFeedback').className = 'note bad-note';
    visionCell(square)?.classList.add('vision-wrong');
    if (given.square !== undefined && given.square !== square) {
      visionCell(given.square)?.classList.add('vision-wrong');
    }
  }
  renderVisionScore();
  // A wrong answer is left on screen long enough to read; a right one is not,
  // because the reward for being right is another question.
  setTimeout(nextVisionQuestion, right ? 120 : 900);
}

async function finishVision() {
  Vision.running = false;
  clearInterval(Vision.ticker);
  Vision.ticker = null;
  Vision.question = null;
  clearVisionMarks();

  $('visionSetup').hidden = false;
  $('visionLede').hidden = false;
  $('visionLayout').classList.remove('live');
  $('visionStart').hidden = false;
  $('visionStop').hidden = true;
  $('visionPrompt').textContent = 'Time.';
  $('visionHow').textContent = '';
  $('visionOptions').innerHTML = '';
  $('visionFeedback').textContent = '';
  $('visionClock').textContent = '0.0s';

  const key = `${Vision.mode}:${Vision.orientation}`;
  const previous = Vision.best[key] ?? 0;
  const beaten = Vision.score > previous;
  if (beaten) {
    Vision.best[key] = Vision.score;
    await Store.set('vision', Vision.best);
  }
  const rate = Vision.asked ? Math.round((Vision.score / Vision.asked) * 100) : 0;
  $('visionSummary').textContent = Vision.asked === 0
    ? 'No questions answered.'
    : `${Vision.score} right out of ${Vision.asked} in ${Vision.seconds} seconds — ${rate}%.`
      + (beaten ? ` That is your best at this setting${previous ? `, past ${previous}` : ''}.` : ` Your best here is ${Vision.best[key] ?? 0}.`);
  renderVisionBest();
}

function stopVision() {
  if (!Vision.running) return;
  Vision.endsAt = Date.now();
  finishVision();
}

function renderVisionBest() {
  const box = $('visionBest');
  const rows = Object.entries(Vision.best).filter(([, v]) => v > 0);
  if (!rows.length) { box.textContent = 'No rounds yet.'; return; }
  box.innerHTML = '';
  const readable = { mixed: 'All three', find: 'Tap the square', name: 'Name the square', colour: 'Light or dark' };
  for (const [key, value] of rows.sort((a, b) => b[1] - a[1])) {
    const [mode, orientation] = key.split(':');
    const row = el('div', 'readout-row');
    row.appendChild(el('span', 'k', `${readable[mode] ?? mode}, ${orientation === 'random' ? 'either way up' : orientation + ' at the bottom'}`));
    row.appendChild(el('span', 'v', String(value)));
    box.appendChild(row);
  }
}

function renderVision() {
  $('visionMode').value = Vision.mode;
  $('visionOrientation').value = Vision.orientation;
  if (!Vision.grid) buildVisionGrid(Vision.orientation !== 'black');
  renderVisionBest();
}
