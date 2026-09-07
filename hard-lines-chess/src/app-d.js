// ── eval bar ───────────────────────────────────────────────────────────────
//
// Lichess's fitted transform from centipawns to win chance, the same one the
// training app charts. A bar that scaled with pawns would show a +1 lead as a
// sliver and a +9 as everything, when the first is the one worth seeing.
const winChance = (cp) => 1 / (1 + Math.exp(-0.00368208 * cp));

function makeEvalBar(host) {
  host.classList.add('evalbar');
  host.innerHTML = '<div class="evalbar-white"></div><span class="evalbar-label top"></span><span class="evalbar-label bottom"></span>';
  const white = host.querySelector('.evalbar-white');
  const top = host.querySelector('.top'), bottom = host.querySelector('.bottom');
  const bar = {
    orientation: WHITE,
    orient(colour) {
      this.orientation = colour;
      host.classList.toggle('flipped', colour === BLACK);
    },
    /** `whiteCp`: centipawns from White's side; mates are beyond ±29000. */
    set(whiteCp) {
      if (whiteCp === null || whiteCp === undefined) {
        white.style.height = '50%'; top.textContent = ''; bottom.textContent = '';
        host.title = 'No evaluation yet';
        return;
      }
      let share, label;
      if (Math.abs(whiteCp) > 29000) {
        share = whiteCp > 0 ? 1 : 0;
        const plies = 30000 - Math.abs(whiteCp);
        // Zero plies is a mate that has been delivered, not "mate in 0".
        label = plies === 0 ? '#' : `M${Math.ceil(plies / 2)}`;
      } else {
        share = winChance(whiteCp);
        label = (Math.abs(whiteCp) / 100).toFixed(1);
      }
      white.style.height = `${Math.round(share * 1000) / 10}%`;
      // The number sits in the winning side's half, where there is room for it.
      const whiteWinning = whiteCp >= 0;
      const whiteAtBottom = this.orientation === WHITE;
      const whiteLabel = whiteAtBottom ? bottom : top;
      const blackLabel = whiteAtBottom ? top : bottom;
      whiteLabel.textContent = whiteWinning ? label : '';
      blackLabel.textContent = whiteWinning ? '' : label;
      host.title = label === '#'
        ? `Checkmate — ${whiteWinning ? 'Black' : 'White'} is checkmated`
        : `${whiteWinning ? 'White' : 'Black'} ${Math.abs(whiteCp) > 29000 ? 'mates in ' + label.slice(1) : 'ahead by ' + label}`;
    },
  };
  bar.set(null);
  return bar;
}

// ── the practice board ─────────────────────────────────────────────────────
//
// A board with nobody on the other side. Move either colour, ask the engine
// what it would do, look at what is hanging and what the opponent is
// threatening, then hand the position to Play if you want to play it out.
//
// THE ENGINE IS NEVER RUN ON A RENDER. Every search here is behind a button or
// a switch he turned on, so the page never stalls on its own account.
const Practice = {
  view: null,
  bar: null,
  moves: [],          // { san, uci, fenBefore }
  startFen: null,
  auto: false,
  threats: false,
  hanging: false,
  busy: false,
  generation: 0,
  lastLines: null,
};

function renderPractice() {
  if (!Practice.startFen) resetPractice();
  renderPracticeMoves();
  renderPracticeFen();
}

function resetPractice(fen = null, { arrows = [] } = {}) {
  Practice.generation++;
  if (Coach.returnTo === fen) Coach.returnTo = null;
  Practice.startFen = fen ?? new Board().fen();
  Practice.moves = [];
  Practice.lastLines = null;
  Practice.view.setFen(Practice.startFen, { arrows });
  Practice.view.interactive = true;
  Practice.view.locked = false;
  Practice.bar.orient(Practice.view.orientation);
  Practice.bar.set(null);
  $('practiceLines').innerHTML = '';
  $('practiceVerdict').textContent = '';
  renderPracticeMoves();
  renderPracticeFen();
  // The conversation belongs to the position, so changing the position changes
  // which conversation is on screen. Leaving it behind showed one position's
  // board beside another position's answer, which is the worst of both.
  renderCoachSession();
  afterPracticeChange();
}

/** Open the Board tab on a position, with any arrows the caller wants kept. */
function openPractice(fen, { arrows = [] } = {}) {
  show('board');
  // Orientation first, so the reset draws the board the right way up once
  // rather than one way and then the other.
  Practice.view.orientation = new Board(fen).turn;
  resetPractice(fen, { arrows });
}

function onPracticeMove({ move, san, uci }) {
  if (Practice.busy) return;
  Practice.moves.push({ san, uci, fenBefore: Practice.view.board.fen() });
  Practice.view.arrows = [];
  Practice.view.apply(move);
  Practice.lastLines = null;
  $('practiceLines').innerHTML = '';
  $('practiceVerdict').textContent = '';
  renderPracticeMoves();
  renderPracticeFen();
  renderCoachSession();
  afterPracticeChange();
}

function undoPractice() {
  if (Practice.busy) {
    // Said, not swallowed: a button that does nothing while the engine is
    // thinking looks exactly like a button that is broken.
    $('practiceVerdict').textContent = 'Still thinking — undo once the suggestion has arrived.';
    return;
  }
  if (!Practice.moves.length) return;
  Practice.moves.pop();
  Practice.view.board.unmake();
  Practice.view.lastMove = null;
  Practice.view.arrows = [];
  Practice.view.refresh();
  Practice.lastLines = null;
  $('practiceLines').innerHTML = '';
  $('practiceVerdict').textContent = '';
  renderPracticeMoves();
  renderPracticeFen();
  renderCoachSession();
  afterPracticeChange();
}

function renderPracticeMoves() {
  const box = $('practiceMoves');
  box.innerHTML = '';
  if (!Practice.moves.length) { box.innerHTML = '<span class="empty">No moves yet — move either side.</span>'; return; }
  const startBoard = new Board(Practice.startFen);
  let ply = startBoard.turn === WHITE ? 0 : 1;
  const offset = startBoard.fullmove;
  Practice.moves.forEach((m, i) => {
    const p = ply + i;
    if (p % 2 === 0 || i === 0) box.appendChild(el('span', 'mn', `${offset + Math.floor(p / 2)}.${p % 2 === 1 ? '..' : ''}`));
    box.appendChild(el('span', 'mv' + (i === Practice.moves.length - 1 ? ' on' : ''), m.san));
  });
}

function renderPracticeFen() {
  $('practiceFen').value = Practice.view.board.fen();
  const outcome = Practice.view.board.outcome();
  const turn = Practice.view.board.turn === WHITE ? 'White' : 'Black';
  $('practiceTurn').textContent = outcome
    ? ({ checkmate: `Checkmate — ${turn} is mated.`, stalemate: 'Stalemate.', repetition: 'Drawn by repetition.', fifty_move: 'Drawn — fifty moves.', insufficient: 'Drawn — not enough material.' }[outcome] ?? 'Game over.')
    : `${turn} to move${Practice.view.board.inCheck() ? ' — in check' : ''}.`;
}

function loadPracticeFen() {
  const fen = $('practiceFenIn').value.trim();
  const problem = fenProblem(fen);
  if (problem) { $('practiceFenNote').textContent = `That FEN cannot be used. ${problem}`; return; }
  $('practiceFenNote').textContent = '';
  const board = new Board(fen);
  Practice.view.orientation = board.turn;
  resetPractice(board.fen());
}

/** What runs after every change: the switches he has on, and nothing else. */
function afterPracticeChange() {
  // The hanging marks need a redraw, which would cut the slide short — so
  // they land just after it. Nothing redraws here otherwise.
  if (Practice.hanging) setTimeout(markHanging, 230);
  else if (Practice.view.hangs.length) { Practice.view.hangs = []; Practice.view.draw(); }
  if (Practice.auto) suggestPractice();
  else if (Practice.threats) showThreat();
}

/**
 * The engine's top three, with scores, as arrows and as lines. The first is
 * green — the meaning green has everywhere here — the others are drawn as
 * the user's own colour, because they are a suggestion rather than a verdict.
 */
function suggestPractice() {
  if (Practice.busy) return;
  const board = Practice.view.board;
  if (board.outcome()) { $('practiceVerdict').textContent = 'The game is over in this position.'; return; }
  const generation = ++Practice.generation;
  const budget = THINK[App.prefs.think] ?? THINK.normal;
  Practice.busy = true;
  Practice.view.locked = true;
  $('practiceSuggest').disabled = true;
  $('practiceVerdict').textContent = `Thinking, up to ${(budget.movetime / 1000).toFixed(1)}s…`;

  requestAnimationFrame(() => setTimeout(() => {
    let result;
    try {
      App.engine.reset();
      result = App.engine.search(new Board(board.fen()), { movetime: budget.movetime, maxDepth: budget.depth, lines: 3 });
    } finally {
      Practice.busy = false;
      Practice.view.locked = false;
      $('practiceSuggest').disabled = false;
    }
    if (generation !== Practice.generation) return;
    Practice.lastLines = result;
    renderPracticeLines(result, board);
    if (Practice.threats) showThreat();
  }, 0));
}

function renderPracticeLines(result, board) {
  const box = $('practiceLines');
  box.innerHTML = '';
  const mover = board.turn;
  const toWhite = (cp) => (mover === WHITE ? cp : -cp);
  Practice.bar.set(toWhite(result.score));

  const arrows = [];
  result.lines.forEach((line, i) => {
    arrows.push({ from: moveFrom(line.move), to: moveTo(line.move), kind: i === 0 ? 'best' : 'user' });
    const row = el('button', 'line-row' + (i === 0 ? ' top' : ''));
    row.type = 'button';
    const score = Math.abs(line.score) > 29000
      ? `M${Math.ceil((30000 - Math.abs(line.score)) / 2)}${line.score > 0 ? '' : ' (against)'}`
      : ((toWhite(line.score) >= 0 ? '+' : '') + (toWhite(line.score) / 100).toFixed(1));
    row.innerHTML = `<span class="line-score">${esc(score)}</span><span class="line-moves">${esc(lineToSan(board, line.line))}</span>`;
    row.title = 'Play this move';
    row.addEventListener('click', () => {
      const san = toSan(Practice.view.board, line.move);
      onPracticeMove({ move: line.move, san, uci: moveToUci(line.move) });
    });
    box.appendChild(row);
  });
  Practice.view.arrows = arrows;
  Practice.view.redrawArrows();

  const best = result.lines[0];
  const bestSan = toSan(board, best.move);
  // Moves, not plies. A ply is half a move and is engine vocabulary; nobody
  // playing chess counts in them.
  const depthNote = result.depth ? ` (looked about ${Math.max(1, Math.round(result.depth / 2))} moves ahead)` : '';
  $('practiceVerdict').textContent = Math.abs(best.score) > 29000
    ? `${bestSan} — a forced mate${depthNote}.`
    : `${bestSan} is its choice. Scores are from White's side, in points${depthNote}.`;
}

/**
 * INSIGHT: what the opponent is threatening. The side to move passes — the
 * FEN is rewritten with the other side on turn — and the engine says what it
 * would then do. That move is the threat, drawn in blue: the colour that means
 * "played at you" everywhere in this app.
 *
 * A pass is not possible while in check, and the page says so rather than
 * inventing a threat from an impossible position.
 *
 * THE SEARCH IS DEFERRED, like the suggestion's, and the position is checked
 * again before anything is drawn. Run inline it blocked the move handler for
 * ~250ms before the slide could paint; and a result for a position the board
 * has since left is a threat drawn on the wrong board.
 *
 * THE FIGURE IS SIGNED. This used to print the absolute value as "worth X
 * pawns to them", which called a move that leaves them ten pawns down a
 * ten-pawn threat. It is an evaluation, not a swing, and it goes through the
 * same words the coach uses.
 */
function showThreat() {
  const view = Practice.view;
  const board = view.board;
  const note = $('practiceThreatNote');
  view.arrows = view.arrows.filter((a) => a.kind !== 'threat');
  view.redrawArrows();
  if (!Practice.threats) { note.textContent = ''; return; }
  if (board.inCheck()) { note.textContent = 'In check: the threat is the check itself.'; return; }
  if (board.outcome()) { note.textContent = ''; return; }
  const parts = board.fen().split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  const passed = new Board(parts.join(' '));
  if (passed.inCheck()) { note.textContent = ''; return; }
  // A suggestion in flight calls this again once it has rendered, so a
  // second search now would only queue behind it and then be thrown away.
  if (Practice.busy) return;

  const generation = Practice.generation;
  const fen = board.fen();
  const them = passed.turn === WHITE ? 'White' : 'Black';
  note.textContent = 'Looking for the threat…';
  requestAnimationFrame(() => setTimeout(() => {
    if (generation !== Practice.generation || Practice.busy || !Practice.threats) return;
    if (Practice.view.board.fen() !== fen) return;
    App.engine.reset();
    const result = App.engine.search(passed, { movetime: 250, maxDepth: 7 });
    if (generation !== Practice.generation || Practice.view.board.fen() !== fen) return;
    if (!result.move) { note.textContent = ''; return; }
    const san = toSan(passed, result.move);
    Practice.view.arrows = Practice.view.arrows.filter((a) => a.kind !== 'threat');
    Practice.view.arrows.push({ from: moveFrom(result.move), to: moveTo(result.move), kind: 'threat' });
    Practice.view.redrawArrows();
    note.textContent = `If it were ${them}'s move, the engine would play ${san}. After it: ${plainEval(result.score, them)}.`;
  }, 0));
}

/**
 * INSIGHT: hanging pieces — attacked and not defended at all. Counted, not
 * judged: a defended piece attacked by a pawn is also in trouble, but "attacked
 * and undefended" is the one a beginner can check on the board in a second,
 * and it is the one that decides most games under 1000.
 */
function markHanging() {
  const board = Practice.view.board;
  const hangs = [];
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const piece = board.squares[sq];
    if (!piece || typeOf(piece) === KING) continue;
    const own = colourOf(piece), enemy = own === WHITE ? BLACK : WHITE;
    if (board.attacked(sq, enemy) && !board.attacked(sq, own)) hangs.push(sq);
  }
  Practice.view.hangs = hangs;
  Practice.view.draw();
  const mine = hangs.filter((sq) => colourOf(board.squares[sq]) === board.turn).length;
  $('practiceHangNote').textContent = hangs.length
    ? `${hangs.length} ${hangs.length === 1 ? 'piece is' : 'pieces are'} attacked and undefended — ${mine} of ${board.turn === WHITE ? 'White' : 'Black'}'s, whose move it is.`
    : 'Nothing is attacked and undefended.';
}

function playFromPractice() {
  const board = Practice.view.board;
  if (board.outcome()) return;
  Play.myColour = board.turn;
  $('asWhite').classList.toggle('primary', Play.myColour === WHITE);
  $('asBlack').classList.toggle('primary', Play.myColour === BLACK);
  show('play');
  newPlayGame(board.fen());
}

// ── settings ───────────────────────────────────────────────────────────────
const BOARD_THEMES = [
  ['vermilion', 'Vermilion', '#ffffff', '#e8412a'],
  ['walnut', 'Walnut', '#f0d9b5', '#b58863'],
  ['green', 'Green', '#eeeed2', '#769656'],
  ['slate', 'Slate', '#dee3e6', '#8ca2ad'],
  ['sand', 'Sand', '#f5f0dc', '#c9a86a'],
  ['ink', 'Ink', '#e7e2d5', '#4d463c'],
];

const PIECE_STYLES = [
  ['hardlines', 'Hard Lines', 'Solid glyphs, both sides outlined. The house style.'],
  ['classic', 'Classic', 'Outline white, solid black — the printed-diagram look.'],
  ['letters', 'Letters', 'K Q R B N P on tiles. Reads at any size, and needs no glyph knowledge.'],
];

function renderSettings() {
  const p = App.prefs;

  const boards = $('settingBoards');
  boards.innerHTML = '';
  for (const [id, name, light, dark] of BOARD_THEMES) {
    const b = el('button', 'swatch' + (p.board === id ? ' on' : ''));
    b.type = 'button';
    b.style.setProperty('--sw-light', light);
    b.style.setProperty('--sw-dark', dark);
    b.innerHTML = `<i><b></b><b></b><b></b><b></b></i><span>${esc(name)}</span>`;
    b.addEventListener('click', () => { p.board = id; savePrefs(); renderSettings(); });
    boards.appendChild(b);
  }

  const styles = $('settingPieces');
  styles.innerHTML = '';
  for (const [id, name, note] of PIECE_STYLES) {
    const card = el('button', 'style-card' + (p.pieces === id ? ' on' : ''));
    card.type = 'button';
    card.innerHTML = `<b>${esc(name)}</b><span class="note" style="margin:0">${esc(note)}</span>`;
    card.addEventListener('click', () => { p.pieces = id; savePrefs(); renderSettings(); });
    styles.appendChild(card);
  }

  $('settingTheme').value = p.theme;
  $('settingDots').checked = p.dots;
  $('settingCoords').checked = p.coords;
  $('settingAnimate').checked = p.animate;
  $('settingLongPress').value = String(p.longPress);
  $('settingThink').value = p.think;

  // A live specimen: the pieces and board as chosen, on a position with every
  // kind of mark on it, so a choice is judged on what it looks like rather
  // than on its name.
  //
  // THE CAPTION IS TRUE OF WHAT IS DRAWN. The previous specimen promised a
  // check ring on a position with no check, and drew "the engine's move" from
  // an empty square. This is the Fried Liver after 7.Qf3+: Black's king on f7
  // is in check from the queen that just arrived, the engine's answer is the
  // king to e6, the pinned knight on d5 is what White threatens, and d5 is
  // the marked square.
  const sample = $('settingSample');
  if (!sample.dataset.ready) {
    sample.dataset.ready = '1';
    Settings.view = makeBoardView(sample, { interactive: false });
    Settings.view.showDots = true;
  }
  Settings.view.setFen(SPECIMEN.fen, {
    lastMove: nameToSquare('d1') | (nameToSquare('f3') << 8),
    arrows: [{ from: nameToSquare('c4'), to: nameToSquare('d5'), kind: 'threat' }, { from: nameToSquare('f7'), to: nameToSquare('e6'), kind: 'best' }],
  });
  Settings.view.highlights = new Map([[nameToSquare('d5'), 1]]);
  Settings.view.draw();
  $('settingSampleNote').textContent = SPECIMEN.caption;
}

const SPECIMEN = {
  fen: 'r1bq1b1r/ppp2kpp/2n5/3np3/2B5/5Q2/PPPP1PPP/RNB1K2R b KQ - 1 7',
  caption: 'A specimen: the last move (the queen to f3) in yellow, the check ring on the king it attacks, the engine\u2019s reply in green, what White threatens in blue, and a square you marked.',
};

const Settings = { view: null };

// ── taking it with you ─────────────────────────────────────────────────────
//
// The copy this page offers to save: itself, as it arrived, before anything
// has rendered a game into it. Called ONCE, at parse time, from app-a.js
// (`const SOURCE_SNAPSHOT = sourceSnapshot();`) — a function declaration so
// it is hoisted across the bundle, and it reads nothing but the document.
//
// It is REPAIRED ON THE WAY OUT. A page served inside a wrapper gets its
// charset and viewport from that wrapper, and a copy saved without them is
// not the same page: opened from a phone's Files app, Chrome guesses the
// encoding and every arrow in the interface came out as "Â'", and with no
// viewport it laid the whole thing out at 980px and shrank it.
//
// AND IT IS STRIPPED OF WHAT ONLY MAKES SENSE HERE. A copy saved from the
// installable build kept `<link rel="manifest" href="manifest.webmanifest">`,
// so served from anywhere else the link 404ed and setupInstall() — seeing a
// manifest link already present — never injected its own: the saved copy
// could not be installed at all. Anything with a blob: address goes too; a
// blob URL is a name for memory in the tab that made it and nothing else.
function sourceSnapshot() {
  const root = document.documentElement.cloneNode(true);
  let head = root.querySelector('head');
  if (!head) {
    head = document.createElement('head');
    root.insertBefore(head, root.firstChild);
  }
  for (const node of root.querySelectorAll('link[rel="manifest"]')) node.remove();
  for (const node of root.querySelectorAll('[href^="blob:"], [src^="blob:"]')) node.remove();
  const ensure = (selector, build) => {
    if (head.querySelector(selector)) return;
    head.insertBefore(build(), head.firstChild);
  };
  ensure('meta[name="viewport"]', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'viewport');
    meta.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
    return meta;
  });
  // Inserted LAST so it ends up FIRST: a charset declaration has to be inside
  // the first 1024 bytes of the file to be honoured at all.
  ensure('meta[charset]', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('charset', 'utf-8');
    return meta;
  });
  if (!root.getAttribute('lang')) root.setAttribute('lang', 'en-GB');
  return '<!doctype html>\n' + root.outerHTML + '\n';
}

//
// The page is a single file, and the copy offered here is the page as it
// ARRIVED — taken before anything rendered — so the file opens fresh rather
// than mid-game.
//
// TWO ROUTES, AND THE BUTTON IS SHOWN EITHER WAY. The first version only
// offered the save when the viewer's platform granted a downloads capability,
// so where it did not, the button was simply absent and there was nothing to
// press — which is indistinguishable from the feature being broken, and is
// what it looked like. Now the capability is tried first, an ordinary browser
// download is tried second, and if neither can run the page says so in a
// sentence that tells you what to do instead.
function appFileName() {
  return 'hard-lines-chess.html';
}

async function downloadApp() {
  const note = $('downloadNote');
  const button = $('downloadApp');
  button.disabled = true;
  note.textContent = 'Preparing the file…';

  // Route one: the viewer's platform saves it, with its own confirmation.
  if (App.downloads) {
    try {
      await App.downloads.save({ filename: appFileName(), data: SOURCE_SNAPSHOT });
      note.textContent = 'Saved. Open the file in any browser — it needs no server and no connection.';
      button.disabled = false;
      return;
    } catch (e) {
      const code = e?.code ?? 'unavailable';
      if (code === 'declined') { note.textContent = 'Not saved.'; button.disabled = false; return; }
      if (code === 'rate_limited') {
        note.textContent = 'A save prompt is already open — answer that one, then try again.';
        button.disabled = false;
        return;
      }
      if (code === 'rejected_extension' || code === 'extension_not_enabled') {
        note.textContent = 'This viewer will not save HTML files. The same file is attached in your chat with Claude — download it from there.';
        button.disabled = false;
        return;
      }
      // Anything else falls through to route two rather than stopping here.
      note.textContent = `The built-in save failed (${code}). Trying the browser's own download…`;
    }
  }

  // Route two: an ordinary link. This works in a normal browser tab and is
  // INERT inside the artifact viewer, which blocks page-initiated downloads —
  // and inert means nothing happens and nothing throws, so the message below
  // is written for the case where it silently did nothing.
  try {
    const blob = new Blob([SOURCE_SNAPSHOT], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = appFileName();
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    note.textContent = 'Asked your browser to save it. If nothing happened, downloads are blocked here — use the browser’s own Save Page instead.';
  } catch (e) {
    note.textContent = 'This page cannot save a file here. The same file is attached in your chat with Claude — download it from there.';
  }
  button.disabled = false;
}

// ── installing it as an app ────────────────────────────────────────────────
//
// WHAT CAN AND CANNOT BE INSTALLED, because the answer is a browser rule and
// not a property of this app:
//
//   file:  and content:  — never. A page opened out of a Files app has no
//          origin a browser will attach an installed app to, and no service
//          worker can run there. Nothing this page does can change that.
//   http(s) on localhost or a real host — yes: a manifest, an icon and a
//          service worker, which are all supplied here.
//   inside another site's frame — the host page owns installation, not this
//          one, so the button simply never appears.
//
// The manifest is injected rather than linked, so the single-file build needs
// no second file. Its start_url and scope are ABSOLUTE: a blob: manifest URL
// has nothing sensible for a relative path to resolve against, and a manifest
// whose start_url does not resolve is silently ignored.
function manifestFor() {
  // The page's own address with nothing after the path. A query string or a
  // hash in `id` made every distinct URL a distinct app, and a slash inside
  // the query made the scope end mid-query.
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  const here = url.href;
  return {
    id: here,
    name: 'Hard Lines Chess',
    short_name: 'Hard Lines',
    description: 'Play, analyse and train chess. Everything runs on your own device.',
    start_url: here,
    scope: here.replace(/[^/]*$/, ''),
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait-primary',
    background_color: '#f2efe6',
    theme_color: '#14110d',
    lang: 'en-GB',
    icons: [
      { src: ICON_192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: ICON_512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: ICON_MASKABLE, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

const Install = { prompt: null };

function setupInstall() {
  // THE ANDROID APP IS THE INSTALLED APP. Everything below it would run and
  // achieve nothing there: there is no browser to attach an installed app to,
  // the prompt never fires, and registering a worker to cache a page that is
  // already a file inside the APK would only put a stale copy in front of it.
  if (IN_ANDROID_APP) {
    $('installRow').hidden = true;
    $('installNote').textContent = 'Running as the Android app.';
    return;
  }

  // WHICH COPY IS THIS. The installable kit ships with a manifest LINKED in its
  // markup and a sw.js beside it; every other copy — the single file, the
  // fragment, a page saved to disk — has neither, and builds its manifest here
  // out of a blob so the browser has something to read. So the presence of a
  // linked manifest at load time is what says a worker exists to register.
  const shipped = Boolean(document.querySelector('link[rel="manifest"]'));
  if (!shipped) {
    const blob = new Blob([JSON.stringify(manifestFor())], { type: 'application/manifest+json' });
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = URL.createObjectURL(blob);
    document.head.appendChild(link);
  }

  // A service worker is registered only where one exists to register.
  //
  // THIS USED TO REGISTER EVERYWHERE and lean on a `.catch()`, with a comment
  // saying the failure was "fine and silent". It was fine. It was not silent:
  // a registration that 404s is logged by the browser itself, before any
  // promise of ours can catch it, so every load of the single-file copy served
  // over http printed two console errors that nothing in the page could
  // suppress — and a console with permanent errors in it is a console nobody
  // reads the real errors out of. tests/every-screen.cjs fails on any console
  // error, which is what found this.
  if (shipped && 'serviceWorker' in navigator && window.isSecureContext && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  }

  // Chrome hands over the install prompt rather than showing it. Kept, and
  // surfaced as a button, because a prompt fired on load is the thing everyone
  // dismisses without reading.
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    Install.prompt = event;
    $('installRow').hidden = false;
    $('installNote').textContent = '';
  });

  window.addEventListener('appinstalled', () => {
    Install.prompt = null;
    $('installRow').hidden = true;
    $('installNote').textContent = 'Installed. It is on your home screen and opens without the browser around it.';
  });

  // Already running as an installed app: say so instead of offering it again.
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
    $('installNote').textContent = 'Running as an installed app.';
  }
}

async function installApp() {
  if (!Install.prompt) return;
  const event = Install.prompt;
  Install.prompt = null;
  $('installRow').hidden = true;
  const { outcome } = await event.prompt().then(() => event.userChoice).catch(() => ({ outcome: 'dismissed' }));
  $('installNote').textContent = outcome === 'accepted'
    ? 'Installing. It will appear on your home screen.'
    : 'Not installed. The option comes back if you reload this page.';
}
