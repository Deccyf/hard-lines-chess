// ── the clock mode ─────────────────────────────────────────────────────────
//
// Three minutes, one position after another, and the only way to go faster is
// to see faster. Everything else in this app is untimed on purpose — a drill
// you rush is a drill you did not do — but recognition is the one thing a
// clock actually trains, because the skill IS the speed. You already know what
// a fork looks like; what you do not have is finding it in four seconds.
//
// WHERE THE POSITIONS COME FROM, IN ORDER OF PREFERENCE.
//
//   1. YOUR OWN GAMES, always first. They are the reason the Puzzles tab
//      exists and they are worth more than anything generated: a fork you
//      missed on Tuesday is a fork you will miss again.
//   2. The bank in puzzle-bank.js, which is the app's own engine playing
//      itself, mined by the same review and checked twice. It exists so this
//      screen works on the first day rather than showing an empty box to
//      somebody who has not reviewed a game yet.
//
// The screen says which one each position came from, every time, because "from
// your own game against the 1200 band" and "from the starting bank" are
// different facts and a trainer that blurs them is claiming the first while
// serving the second.

const Storm = {
  running: false,
  endsAt: 0,
  ticker: null,
  queue: [],
  at: 0,
  solved: 0,
  missed: 0,
  streak: 0,
  bestStreak: 0,
  board: null,
  current: null,
  best: null,          // { score, at, solved, missed }
  view: null,
  locked: false,
};

/** Three minutes. Long enough to settle into, short enough to sprint. */
const STORM_SECONDS = 180;
/** What a wrong answer costs. A strike system ends the run on bad luck. */
const STORM_PENALTY_MS = 10000;

/**
 * The run's positions: yours first, then the bank, each shuffled within itself
 * so the same run is not the same order twice.
 */
function buildStormQueue() {
  const shuffle = (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  const mine = (App.puzzles.items ?? [])
    .filter((p) => p && p.fen && p.best?.uci)
    .map((p) => ({
      fen: p.fen, uci: p.best.uci, san: p.best.san, mate: p.mate ?? null,
      source: 'yours', label: p.label ?? null, line: p.line ?? '',
    }));

  // The bank is ordered easiest-first by the generator. Keeping that order
  // rather than shuffling gives a run that starts gently and gets harder,
  // which is the shape a timed run wants.
  const bank = (typeof PUZZLE_BANK === 'undefined' ? [] : PUZZLE_BANK).map((p) => ({
    fen: p.f, uci: p.u, san: p.n, mate: p.m ?? null,
    source: 'bank', label: null, line: p.l ?? '',
  }));

  return [...shuffle(mine), ...bank];
}

function startStorm() {
  Storm.queue = buildStormQueue();
  if (!Storm.queue.length) { renderStorm(); return; }

  Storm.running = true;
  Storm.at = 0;
  Storm.solved = 0;
  Storm.missed = 0;
  Storm.streak = 0;
  Storm.bestStreak = 0;
  Storm.endsAt = Date.now() + STORM_SECONDS * 1000;

  // The same reason as the vision round, and one more: the setup panel says
  // how many positions are queued, and it was still saying "there are none"
  // in the middle of a run because nothing had asked it to say otherwise.
  $('stormSetup').hidden = true;
  $('stormLede').hidden = true;
  $('stormLayout').classList.add('live');
  $('stormStart').hidden = true;
  $('stormStop').hidden = false;
  $('stormBoardWrap').hidden = false;
  $('stormSummary').textContent = '';

  clearInterval(Storm.ticker);
  Storm.ticker = setInterval(tickStorm, 100);
  nextStormPuzzle();
  renderStormScore();
}

function tickStorm() {
  if (!Storm.running) return;
  if (Date.now() >= Storm.endsAt) { finishStorm(); return; }
  const left = Math.max(0, Storm.endsAt - Date.now());
  $('stormClock').textContent = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
  $('stormClock').className = left < 20000 ? 'v urgent' : 'v';
}

function renderStormScore() {
  $('stormScore').textContent = String(Storm.solved);
  $('stormStreak').textContent = Storm.streak > 1 ? `${Storm.streak} in a row` : '';
}

function nextStormPuzzle() {
  if (!Storm.running) return;
  if (Storm.at >= Storm.queue.length) { finishStorm('ran out'); return; }

  const puzzle = Storm.queue[Storm.at++];
  Storm.current = puzzle;
  Storm.board = new Board(puzzle.fen);
  Storm.locked = false;

  const white = Storm.board.turn === WHITE;
  Storm.view.orientation = white ? WHITE : BLACK;
  Storm.view.interactive = true;
  Storm.view.locked = false;
  Storm.view.onMove = onStormMove;
  Storm.view.setFen(puzzle.fen);

  $('stormPrompt').textContent = puzzle.mate
    ? `${white ? 'White' : 'Black'} to play. Mate in ${puzzle.mate}.`
    : `${white ? 'White' : 'Black'} to play and win material.`;
  // SAID EVERY TIME, not once at the top. Which of the two sources a position
  // came from is a fact about that position.
  $('stormWhere').textContent = puzzle.source === 'yours'
    ? `From your own game${puzzle.label ? ` against ${puzzle.label}` : ''}.`
    : 'From the starting bank — the app’s engine against itself.';
  $('stormFeedback').textContent = '';
}

function onStormMove({ move }) {
  if (!Storm.running || Storm.locked || !Storm.current) return;
  const uci = moveToUci(move);
  Storm.locked = true;
  Storm.view.locked = true;
  Storm.view.apply(move);

  if (uci === Storm.current.uci) {
    Storm.solved++;
    Storm.streak++;
    Storm.bestStreak = Math.max(Storm.bestStreak, Storm.streak);
    $('stormFeedback').textContent = '';
    $('stormFeedback').className = 'note good-note';
    renderStormScore();
    setTimeout(nextStormPuzzle, 180);
    return;
  }

  // WRONG COSTS TIME, NOT THE RUN. Three strikes ends a run on a position you
  // half-saw, and the thing that improves is the number of positions you get
  // through — so the punishment is fewer of them, which is the same currency
  // as the reward.
  Storm.missed++;
  Storm.streak = 0;
  Storm.endsAt -= STORM_PENALTY_MS;
  $('stormFeedback').textContent = `${Storm.current.san} was the move. Ten seconds off.`;
  $('stormFeedback').className = 'note bad-note';
  renderStormScore();
  setTimeout(nextStormPuzzle, 1100);
}

async function finishStorm(reason = 'time') {
  if (!Storm.running) return;
  Storm.running = false;
  clearInterval(Storm.ticker);
  Storm.ticker = null;
  Storm.current = null;
  Storm.view.interactive = false;
  Storm.view.locked = true;

  $('stormSetup').hidden = false;
  $('stormLede').hidden = false;
  $('stormLayout').classList.remove('live');
  $('stormStart').hidden = false;
  $('stormStop').hidden = true;
  $('stormPrompt').textContent = reason === 'ran out' ? 'That is every position there is.' : 'Time.';
  $('stormWhere').textContent = '';
  $('stormFeedback').textContent = '';
  $('stormClock').textContent = '0:00';

  const beaten = !Storm.best || Storm.solved > Storm.best.score;
  if (beaten) {
    Storm.best = { score: Storm.solved, at: Date.now(), solved: Storm.solved, missed: Storm.missed, streak: Storm.bestStreak };
    await Store.set('storm', Storm.best);
  }
  const attempted = Storm.solved + Storm.missed;
  $('stormSummary').textContent = attempted === 0
    ? 'No positions attempted.'
    : `${Storm.solved} solved, ${Storm.missed} missed, best run of ${Storm.bestStreak}. `
      + (beaten ? 'That is your best.' : `Your best is ${Storm.best.score}.`);
  renderStorm();
}

function stopStorm() {
  if (!Storm.running) return;
  finishStorm('stopped');
}

function renderStorm() {
  const queue = buildStormQueue();
  const mine = queue.filter((p) => p.source === 'yours').length;
  const bank = queue.length - mine;

  $('stormStart').disabled = queue.length === 0;
  $('stormSource').textContent = queue.length === 0
    ? 'There are no positions to run. The starting bank is missing from this build, and you have no tactics of your own yet.'
    : mine === 0
      ? `${bank} positions from the starting bank. Review a game and your own tactics go to the front of the queue, where they belong.`
      : `${mine} of your own ${mine === 1 ? 'tactic' : 'tactics'} first, then ${bank} from the starting bank.`;

  $('stormBest').textContent = Storm.best
    ? `${Storm.best.score} solved, best run of ${Storm.best.streak ?? 0}.`
    : 'No runs yet.';
}
