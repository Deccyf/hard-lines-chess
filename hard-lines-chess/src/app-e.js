// ── puzzles: tactics out of his own games ──────────────────────────────────
//
// THE DIFFERENCE FROM DRILLS, and it is the whole reason both exist: a drill
// is a position where HE went wrong, and asks him to find what he should have
// played. A puzzle is a position where the OPPONENT went wrong, and asks him
// to take what was on offer. One is a correction, the other is an
// opportunity, and a beginner loses far more games to the second than to the
// first — the chance was there, on the board, and went past.
//
// Every puzzle here came out of a game he actually played, and every one was
// verified twice: once by the walk that found the opponent's mistake, and
// once by a deeper two-line search that confirms exactly one move takes it.
// Nothing is generated, nothing is borrowed from a puzzle database, and a
// position where two moves win equally is dropped rather than asked.
const Puzzles = {
  view: null,
  current: null,
  answered: false,
  scanning: false,
  cancel: false,
};

/** The key that stops a game being scanned twice. */
const puzzleKey = (source, at) => `${source}:${at}`;

/**
 * File a game's verified tactics. Returns how many were new.
 *
 * DEDUPED BY POSITION, because the same position can arrive from two routes —
 * a game played here and then pasted into Review — and being asked the same
 * question twice from two lists is how a review queue stops being believed.
 */
async function addTactics(tactics, { source, label, at, against = null, dropped = 0 }) {
  const key = puzzleKey(source, at);
  if (!App.puzzles.scanned.includes(key)) App.puzzles.scanned.push(key);

  let added = 0;
  for (const t of tactics) {
    if (App.puzzles.items.some((p) => p.fen === t.fen)) continue;
    App.puzzles.items.push({
      id: `${at}-${t.ply}`,
      ...t,
      source,
      label,
      at,
      // WHO IT WAS AGAINST, kept on every row. A tactic taken against this
      // app's own opponent and one taken against a person are not the same
      // evidence, and a single ratio over both quietly claims they are.
      against: against ?? (source === 'play' ? 'app' : 'elsewhere'),
      // A tactic he FOUND at the time is not due now. He has shown he can see
      // it; asking again this afternoon tests nothing. It still enters the
      // queue, a few days out, because seeing it once is not knowing it.
      card: t.found ? { ...SRS.fresh(), seen: 1, interval: 4, due: Date.now() + 4 * 86400000 } : SRS.fresh(),
    });
    added++;
  }
  if (added) await Store.set('puzzles', App.puzzles);
  return added;
}

function duePuzzles() {
  return App.puzzles.items.filter((p) => SRS.isDue(p.card));
}

/** Games played here that still have a PGN and have never been scanned. */
function scannableGames() {
  const out = [];
  for (const g of App.history.games) {
    // Six plies, not more: a beginner's game that ended in a four-move mate
    // is exactly the game worth searching, and an eight-ply floor threw those
    // away without saying so.
    if (!g.pgn || g.plies < 6) continue;
    if (App.puzzles.scanned.includes(puzzleKey('play', g.at))) continue;
    out.push({ kind: 'play', at: g.at, pgn: g.pgn, side: g.colour, from: g.from ?? null, label: `the ${bandLabelFor(g.band)} opponent`, against: 'app' });
  }
  for (const r of App.reviews.games) {
    if (!r.pgn) continue;
    if (App.puzzles.scanned.includes(puzzleKey('review', r.at))) continue;
    out.push({ kind: 'review', at: r.at, pgn: r.pgn, side: r.side, from: null, label: `${r.white} vs ${r.black}`, against: 'elsewhere' });
  }
  return out;
}

/** Reviews saved before this page counted tactics, which cannot be scanned. */
function unscannableReviews() {
  return App.reviews.games.filter((r) => !r.pgn && !r.tactics).length;
}

function renderPuzzles() {
  if (Puzzles.current || Puzzles.scanning) return;

  const items = App.puzzles.items;
  const due = duePuzzles();
  const pending = scannableGames();
  const older = unscannableReviews();

  $('puzzleBoardWrap').hidden = true;
  $('puzzleStart').hidden = due.length === 0;
  $('puzzleScan').hidden = pending.length === 0;
  $('puzzleScan').textContent = `Scan ${pending.length} ${pending.length === 1 ? 'game' : 'games'} for tactics`;

  // The headline is the number worth knowing: how often the chance was taken.
  // It is only ever computed over tactics he actually got to answer — a game
  // that ended on their mistake never asked him the question.
  const answered = items.filter((p) => p.found !== null);
  const took = answered.filter((p) => p.found).length;
  // Two reasons a tactic was never answered, and they are not the same one:
  // the game really ended on their mistake, or the pasted moves stopped being
  // readable at his reply. Neither is in the ratio; both are said.
  const ended = items.filter((p) => p.found === null && !p.truncated).length;
  const unreadable = items.filter((p) => p.found === null && p.truncated).length;
  const notAsked = [];
  if (ended) notAsked.push(`${ended} came on the last move of a game, so you were never asked`);
  if (unreadable) notAsked.push(`${unreadable} sat where the pasted moves stopped being readable, so whether you played it is unknown and it is not counted either way`);
  // The split is stated rather than averaged away. Beating this app's own
  // opponent is not evidence about how you play against people, and one ratio
  // covering both quietly claims that it is.
  const fromApp = items.filter((p) => p.against === 'app').length;
  const mix = fromApp && fromApp < items.length
    ? `<p class="note">${fromApp} of these came from games against this app's own opponents and ${items.length - fromApp} from games you played elsewhere. They are counted together here, which is worth knowing: the app's opponents blunder to order.</p>`
    : (fromApp === items.length && items.length
      ? `<p class="note">All of these came from games against this app's own opponents, which blunder to order. Paste a game you played elsewhere into Review to see how the figure looks against people.</p>`
      : '');
  const head = $('puzzleHead');
  if (!items.length) {
    head.innerHTML = '';
    head.hidden = true;
  } else {
    head.hidden = false;
    head.innerHTML = `<div class="readout">
      <div><span class="k">Tactics in your games</span><span class="v">${items.length}</span></div>
      <div><span class="k">You took them</span><span class="v">${answered.length ? `${took}/${answered.length}` : '—'}</span></div>
    </div>
    <p class="note">Each one is a moment your opponent went wrong and exactly one move took it. The
    second figure is how many you played at the time${notAsked.length ? `; ${notAsked.join('; ')}` : ''}.</p>
    ${mix}`;
  }

  $('puzzleCount').textContent = !items.length
    ? ''
    : (due.length ? `${due.length} due of ${items.length} stored.` : `Nothing due. ${items.length} stored; the next comes back ${nextPuzzleDue()}.`);

  $('puzzleEmpty').hidden = items.length > 0 || pending.length > 0;
  $('puzzleOlder').hidden = older === 0;
  $('puzzleOlder').textContent = older === 0 ? '' :
    `${older} game${older === 1 ? '' : 's'} you reviewed before this page counted tactics cannot be scanned — the moves were not kept. Paste ${older === 1 ? 'it' : 'them'} into Review again to include ${older === 1 ? 'it' : 'them'}.`;

  renderPuzzleList();
}

function nextPuzzleDue() {
  const soonest = Math.min(...App.puzzles.items.map((p) => p.card?.due ?? 0));
  if (!Number.isFinite(soonest)) return 'later';
  const days = Math.max(0, Math.ceil((soonest - Date.now()) / 86400000));
  return days <= 0 ? 'today' : (days === 1 ? 'tomorrow' : `in ${days} days`);
}

/**
 * What the move is worth, said precisely.
 *
 * `edge` is the EVALUATION AFTER the move, not the amount it gains — so it is
 * worded as where it leaves you. "Worth 9 pawns" for a move that took a queen
 * from an equal position happens to be true and would be false the moment the
 * position was not equal; a figure that is only right by coincidence is the
 * kind that survives into a screen where it is wrong.
 */
function puzzlePrize(p) {
  if (p.mate !== null && p.mate !== undefined) return `mate in ${p.mate}`;
  if (p.edge === null || p.edge === undefined) return 'a winning position';
  return `${(p.edge / 100).toFixed(1)} points up`;
}

function renderPuzzleList() {
  const box = $('puzzleList');
  box.innerHTML = '';
  // An empty panel is an empty box with a border round it, which reads as a
  // fault. It is hidden until there is a list to put in it.
  box.hidden = !App.puzzles.items.length;
  if (box.hidden) return;

  box.appendChild(el('h3', null, 'Every tactic found'));
  box.appendChild(el('p', 'note', 'Newest first. Tap one to try it again now — that does not change when it is next due.'));

  for (const p of [...App.puzzles.items].reverse()) {
    const row = el('button', 'puzzle-row');
    row.type = 'button';
    const flag = p.found === null ? `<span class="puzzle-flag">${p.truncated ? 'reply unreadable' : 'never asked'}</span>`
      : (p.found ? '<span class="puzzle-flag found">you took it</span>' : '<span class="puzzle-flag missed">missed</span>');
    row.innerHTML = `<span class="puzzle-when">${p.moveNumber}${p.side === 'white' ? '.' : '...'} · ${esc(p.label)}</span>
      ${flag}
      <span class="puzzle-note">They played ${esc(p.theirMove)} · one move left you ${esc(puzzlePrize(p))}${p.against === 'app' ? ' · against this app' : ''}</span>`;
    row.addEventListener('click', () => startPuzzle(p, { scoring: false }));
    box.appendChild(row);
  }
}

function startPuzzle(item = null, { scoring = true } = {}) {
  const due = duePuzzles();
  const puzzle = item ?? due[0];
  if (!puzzle) { Puzzles.current = null; renderPuzzles(); return; }

  Puzzles.current = puzzle;
  Puzzles.scoring = scoring;
  Puzzles.answered = false;

  $('puzzleBoardWrap').hidden = false;
  $('puzzleStart').hidden = true;
  $('puzzleScan').hidden = true;
  $('puzzleCount').textContent = scoring
    ? `${due.length} to go.`
    : 'Trying one again. This one is not being scored.';

  Puzzles.view.orientation = puzzle.side === 'white' ? WHITE : BLACK;
  Puzzles.view.interactive = true;
  Puzzles.view.onMove = onPuzzleMove;
  // NO ARROWS WHILE IT IS STILL A QUESTION — not even the move they played,
  // which would point straight at the square the answer starts from.
  Puzzles.view.setFen(puzzle.fen);
  $('puzzleLegend').hidden = true;

  const prize = puzzle.mate !== null && puzzle.mate !== undefined
    ? `There is a forced mate in ${puzzle.mate}.`
    : 'There is a move here that wins material.';
  $('puzzlePrompt').textContent = `They have just played ${puzzle.theirMove}. ${prize} Find it.`;
  const Side = puzzle.side === 'white' ? 'White' : 'Black';
  $('puzzleWhere').textContent = `From your own game against ${puzzle.label} — move ${puzzle.moveNumber}, and you are ${Side}.`;
  $('puzzleAnswer').textContent = '';
  $('puzzleNext').hidden = true;
  $('puzzleExplore').hidden = true;
  $('puzzleAskWhy').hidden = true;
}

async function onPuzzleMove({ move, san }) {
  if (Puzzles.answered) return;
  const p = Puzzles.current;
  const bare = (t) => t.replace(/[+#]$/, '');
  const correct = bare(san) === bare(p.best.san);

  Puzzles.answered = true;
  Puzzles.view.interactive = false;
  Puzzles.view.apply(move);

  // Back to the question with both moves on it, exactly as the drills do —
  // the board after your move shows a consequence, the board before it shows
  // the choice, and the choice is the thing being learned.
  const arrows = arrowsFor(correct ? null : moveToUci(move), p.best.uci);
  Puzzles.view.setFen(p.fen, { arrows });
  $('puzzleLegend').hidden = false;

  // A "line" that is the move again says nothing. Shown only when it
  // continues past the move being asked for.
  const single = !p.line || p.line.split(' ').filter((t) => !/^\d+\.(\.\.)?$/.test(t)).length <= 1;
  const followUp = single ? '' : ` The line runs ${p.line}.`;
  const original = p.found === null
    ? (p.truncated
      ? ' The pasted moves stopped being readable at your reply, so what you played there is unknown.'
      : ' The game ended on their mistake, so you were never asked this one.')
    : (p.found ? ' You played it at the time too.' : ` In the game you played ${p.yourMove}.`);

  const leaves = p.mate !== null && p.mate !== undefined
    ? `it forces ${puzzlePrize(p)}`
    : `it leaves you ${puzzlePrize(p)}`;
  $('puzzleAnswer').textContent = correct
    ? `Yes — ${p.best.san}, and ${leaves}.${followUp}${original}`
    : `Not this time. The move is ${p.best.san}, and ${leaves}; you played ${san}.${followUp}${original}`;

  $('puzzleNext').hidden = false;
  $('puzzleExplore').hidden = false;
  $('puzzleExplore').onclick = () => openPractice(p.fen, { arrows });
  $('puzzleAskWhy').hidden = !Coach.ready;
  $('puzzleAskWhy').onclick = () => askCoachAbout(p.fen, `Why is ${p.best.san} the move here?`, { arrows });

  // Replaying an old one for practice does not move its due date. Scheduling
  // off a repeat he chose himself would push everything he likes into the
  // distance and leave the ones he avoids due forever.
  if (Puzzles.scoring) {
    p.card = SRS.review(p.card, correct);
    await Store.set('puzzles', App.puzzles);
  }
}

function nextPuzzle() {
  Puzzles.current = null;
  startPuzzle();
  if (!Puzzles.current) renderPuzzles();
}

/**
 * Walk the games that have never been scanned.
 *
 * ONE GAME AT A TIME, with a progress bar and a stop button, because this is
 * a full engine walk per game and on a phone that is real seconds. Everything
 * found is saved as it goes, so stopping half way keeps what was found rather
 * than throwing the work away.
 */
async function scanGamesForTactics() {
  if (Puzzles.scanning) return;
  const games = scannableGames();
  if (!games.length) return;

  Puzzles.scanning = true;
  Puzzles.cancel = false;
  $('puzzleScan').hidden = true;
  $('puzzleStart').hidden = true;
  $('puzzleStop').hidden = false;
  $('puzzleBar').hidden = false;
  $('puzzleList').innerHTML = '';

  let found = 0;
  let done = 0;
  const passedOver = { capped: 0, notUnique: 0, singleReply: 0 };
  const status = $('puzzleScanNote');

  for (const game of games) {
    if (Puzzles.cancel) break;
    done++;
    status.textContent = `Game ${done} of ${games.length}: ${game.label}…`;

    // A game from a set-up position carries its FEN, or the walk would start
    // it from move one of a different game entirely.
    const text = game.from ? `[FEN "${game.from}"]\n[SetUp "1"]\n${game.pgn}` : game.pgn;
    let parsed;
    try { parsed = parsePgn(text); } catch { parsed = null; }
    if (!parsed || parsed.plies.length < 6) {
      App.puzzles.scanned.push(puzzleKey(game.kind, game.at));
      await Store.set('puzzles', App.puzzles);
      continue;
    }

    const result = await reviewGame(parsed, game.side, {
      movetime: 160,
      depth: 8,
      onProgress: (a, b, phase) => {
        const share = phase === 'tactics' ? 1 : a / b;
        $('puzzleFill').style.width = `${Math.round(((done - 1 + share) / games.length) * 100)}%`;
        status.textContent = phase === 'tactics'
          ? `Game ${done} of ${games.length}: checking ${a} of ${b} candidates…`
          : `Game ${done} of ${games.length}: ${a} of ${b} positions…`;
      },
    });

    found += await addTactics(result.tactics, { source: game.kind, label: game.label, at: game.at, against: game.against });
    for (const reason of Object.keys(passedOver)) passedOver[reason] += result.tacticsPassed?.[reason] ?? 0;
    await Store.set('puzzles', App.puzzles);
  }

  Puzzles.scanning = false;
  $('puzzleStop').hidden = true;
  $('puzzleBar').hidden = true;
  const left = scannableGames().length;
  // What was passed over is SAID, BY REASON. Those are real mistakes by his
  // opponents that this page will not ask about — because more than one move
  // punished them, or they were beyond the per-game cap, or he had only one
  // legal reply — and the count belongs on screen under the reason it has.
  const sentence = passedOverSentence(passedOver);
  const passed = sentence ? ` ${sentence}` : '';
  status.textContent = Puzzles.cancel
    ? `Stopped. ${found} ${found === 1 ? 'tactic' : 'tactics'} found in ${done - 1} ${done - 1 === 1 ? 'game' : 'games'}; ${left} still unscanned.${passed}`
    : (found
      ? `${found} ${found === 1 ? 'tactic' : 'tactics'} found across ${done} ${done === 1 ? 'game' : 'games'}.${passed}`
      : `Nothing found in ${done} ${done === 1 ? 'game' : 'games'}. Either nobody blundered, or the moves that punished it were not clear-cut enough to ask as a puzzle.${passed}`);
  renderPuzzles();
}

function stopScan() {
  Puzzles.cancel = true;
  $('puzzleStop').hidden = true;
  $('puzzleScanNote').textContent = 'Stopping after this game…';
}
