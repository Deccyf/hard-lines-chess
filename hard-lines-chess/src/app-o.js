// ── the deviation report ───────────────────────────────────────────────────
//
// The screen for deviation.js. It gathers every game the app has stored — the
// ones played here and the ones pasted into Review — walks each against the
// repertoire, and lists the places you stopped following it, commonest first.
//
// TWO THINGS IT IS CAREFUL ABOUT.
//
// A GAME FROM A SET-UP POSITION IS NOT IN THE LIST. A line that did not start
// at move one cannot be compared with one that did, and quietly including them
// would put "you left the Italian on move 1" against a game that began in a
// rook ending.
//
// AND THE COST IS MEASURED WHEN THE ROW IS SHOWN, not asserted when it is
// built. Two searches per row, deferred a frame at a time so the list paints
// first — and the answer is allowed to be "nothing". Leaving your preparation
// is not automatically a mistake, and a report that assumed it was would be
// teaching obedience rather than chess.

const Deviations = {
  rows: [],
  counts: null,
  costs: {},        // row key -> { yours, book, loss } once measured
  parsed: new Map(),// game timestamp -> its moves, so a PGN is read once
  measuring: false,
  built: false,
};

/**
 * HOW FAR BACK IT LOOKS. Every stored game has to be read out of its PGN, and
 * reading one means replaying it through the move generator — cheap once,
 * noticeable four hundred times on a page that is supposed to open instantly.
 * The most recent sixty are walked and the screen says sixty, because a report
 * that quietly ignored half your games while printing a total would be lying
 * about its own sample.
 */
const DEVIATION_GAMES = 60;

/** Every stored game that can be compared with a line, as moves from move one. */
function deviationGames() {
  const games = [];

  const add = (key, side, pgn, label, startFen) => {
    if (!pgn || !side) return;
    if (startFen) return;      // see the header: not comparable
    let sans = Deviations.parsed.get(key);
    if (sans === undefined) {
      try {
        const parsed = parsePgn(pgn);
        sans = parsed.startFen ? null : parsed.plies.map((p) => p.san);
      } catch { sans = null; }
      Deviations.parsed.set(key, sans);
    }
    if (sans && sans.length) games.push({ at: key, side, sans, label });
  };

  const stored = [
    ...(App.history?.games ?? []).map((g) => ({ at: g.at, side: g.colour, pgn: g.pgn, from: g.from,
      label: `against level ${bandLabelFor(g.band)}` })),
    ...(App.reviews?.games ?? []).map((g) => ({ at: g.at, side: g.side, pgn: g.pgn, from: null,
      label: `${g.white ?? '?'} vs ${g.black ?? '?'}` })),
  ].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, DEVIATION_GAMES);

  for (const game of stored) add(game.at, game.side, game.pgn, game.label, game.from);
  return games;
}

/**
 * Say the report is out of date.
 *
 * Called wherever a game is stored. Without it the panel is whatever it was
 * when the screen was last opened, so the game you just played — the one you
 * came to look at — is the one game it does not know about.
 */
function forgetDeviations() {
  Deviations.built = false;
  Deviations.costs = {};
}

function buildDeviations() {
  const games = deviationGames();
  const { rows, counts } = collectDeviations(games, OPENINGS);
  Deviations.rows = rows;
  Deviations.counts = counts;
  Deviations.built = true;
}

/**
 * The cost of the top rows, one search pair at a time, yielding between each.
 *
 * Only the rows on screen, and only once: a report that froze the page for
 * three seconds to price twenty rows nobody scrolled to would be worse than
 * one that priced none.
 */
function measureDeviations(limit = 6) {
  if (Deviations.measuring) return;
  const todo = Deviations.rows.slice(0, limit).filter((r) => !(r.key in Deviations.costs));
  if (!todo.length) return;
  Deviations.measuring = true;

  const step = () => {
    const row = todo.shift();
    if (!row) { Deviations.measuring = false; return; }
    let cost = null;
    try {
      cost = measureDeviation(row, { Board, sanToMove, engine: App.engine, movetime: 260, depth: 10 });
    } catch { cost = null; }
    Deviations.costs[row.key] = cost;
    renderDeviationRows();
    requestAnimationFrame(() => setTimeout(step, 0));
  };
  requestAnimationFrame(() => setTimeout(step, 0));
}

function renderDeviations() {
  if (!Deviations.built) buildDeviations();
  const panel = $('deviationPanel');
  const counts = Deviations.counts;

  // NOTHING TO SAY IS SAID BY SAYING NOTHING. A panel that reads "0 games
  // analysed" on a fresh install is a panel that looks broken.
  if (!counts || counts.games === 0) { panel.hidden = true; return; }
  panel.hidden = false;

  const parts = [`${counts.games} ${counts.games === 1 ? 'game' : 'games'} checked against your repertoire.`];
  if (counts.followed) parts.push(`${counts.followed} stayed in it to the end of the line.`);
  if (counts.youLeft) parts.push(`${counts.youLeft} left it on a move of yours.`);
  if (counts.theyLeft) parts.push(`${counts.theyLeft} ended when your opponent played something the book has no answer for — a gap in the repertoire rather than in you.`);
  if (counts.neverEntered) parts.push(`${counts.neverEntered} opened with a move that is not in your repertoire at all.`);
  if (counts.theyAvoided) parts.push(`${counts.theyAvoided} were steered somewhere else by your opponent's first move.`);
  $('deviationSummary').textContent = parts.join(' ');

  renderDeviationRows();
  measureDeviations();
}

function renderDeviationRows() {
  const box = $('deviationList');
  box.innerHTML = '';

  if (!Deviations.rows.length) {
    box.appendChild(el('p', 'note good-note',
      'You did not leave your own preparation in any of these games. Where the line ended, it ended because your opponent left it.'));
    return;
  }

  for (const row of Deviations.rows.slice(0, 8)) {
    const item = el('div', 'endgame-row');
    const head = el('div', 'endgame-head');
    head.appendChild(el('strong', null, `${row.name}${row.variation ? ` — ${row.variation}` : ''}`));
    head.appendChild(el('span', 'tag', row.times === 1 ? 'once' : `${row.times} times`));
    item.appendChild(head);

    // The move number the way a person says it, and the move a person plays.
    const number = `${row.moveNumber}${row.side === 'white' ? '.' : '…'}`;
    item.appendChild(el('p', 'prompt', `${number} you played ${row.played} — the book plays ${row.book}`));

    const cost = Deviations.costs[row.key];
    const line = el('p', 'note');
    if (!(row.key in Deviations.costs)) {
      line.textContent = 'Measuring what it cost…';
    } else if (!cost) {
      line.textContent = 'The cost could not be measured here.';
    } else if (cost.loss >= 100) {
      line.textContent = `Measured: about ${(cost.loss / 100).toFixed(1)} points worse than the book move.`;
      line.className = 'note bad-note';
    } else if (cost.loss >= 30) {
      line.textContent = `Measured: about ${(cost.loss / 100).toFixed(2)} of a point worse than the book move.`;
    } else if (cost.loss > -30) {
      line.textContent = 'Measured: it costs nothing here. Worth knowing the line anyway, but this move is not the problem.';
      line.className = 'note good-note';
    } else {
      line.textContent = `Measured: your move came out ${(Math.abs(cost.loss) / 100).toFixed(2)} of a point BETTER than the book's, at this depth.`;
      line.className = 'note good-note';
    }
    item.appendChild(line);

    const opening = OPENINGS.find((o) => o.id === row.openingId);
    if (opening) {
      const go = el('button', 'btn', 'Learn this line');
      go.type = 'button';
      go.addEventListener('click', () => {
        // Straight to the branch and the ply it went wrong on, rather than the
        // top of a line you already know the first six moves of.
        const branch = row.variation === null ? null
          : (opening.variations ?? []).findIndex((v) => v.name === row.variation);
        startOpening(opening, 'learn', {
          branch: branch === null || branch < 0 ? null : branch,
          fromPly: Math.max(0, row.ply - 3),
        });
      });
      item.appendChild(go);
    }
    box.appendChild(item);
  }

  if (Deviations.rows.length > 8) {
    box.appendChild(el('p', 'note', `${Deviations.rows.length - 8} more, seen fewer times.`));
  }
}

/** A Today row, when there is one worth acting on. */
function deviationTask() {
  if (!Deviations.built) buildDeviations();
  const top = Deviations.rows[0];
  if (!top || top.times < 2) return null;
  return {
    kind: 'Openings',
    title: `You keep leaving the ${top.name} on move ${top.moveNumber}`,
    note: `${top.times} times, you played ${top.played} where the book plays ${top.book}. Read off your own games.`,
    action: 'Look at it',
    go: () => {
      show('openings');
      requestAnimationFrame(() => $('deviationPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    },
  };
}
