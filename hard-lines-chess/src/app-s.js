// ── what keeps happening: the panel on Progress ────────────────────────────
//
// src/patterns.js counts. This says what the counts come to, the way somebody
// looking over your games would: the thing that goes wrong most often now,
// what has got rarer and what has not, and the positions you have gone wrong
// in more than once — each with the board one tap away.
//
// EVERY SENTENCE HERE IS A COUNT WITH ITS GAMES BESIDE IT. "Rarer" is never
// said without the two numbers it came from, and where there are too few
// games to tell, that is what is said.

const Patterns = {
  // What each game's opening put in front of you, read once: game -> positions, or null.
  reached: new Map(),
};

const PATTERN_TREND_WORDS = { rarer: 'rarer', more: 'more often', same: 'about the same', unknown: 'too few to say' };

/** A mistake's name, as it reads in the middle of a sentence. */
const themeInSentence = (theme) => {
  const label = THEME_LABEL[theme] ?? theme;
  return label.charAt(0).toLowerCase() + label.slice(1);
};

/**
 * The positions a game's opening put in front of you, as patterns.js counts
 * them — or null when the game's moves were not kept. Read once a game: it
 * means replaying the moves, and Progress is drawn often.
 */
function openingPositionsOf(game) {
  if (!game.pgn || !game.side) return null;
  const id = `${game.at}|${game.side}|${game.pgn.length}`;
  if (!Patterns.reached.has(id)) {
    let keys = null;
    try {
      keys = parsePgn(game.pgn, { maxPlies: PATTERN_OPENING_PLIES }).plies
        .filter((p) => p.colour === game.side).map((p) => positionKey(p.fenBefore));
    } catch { keys = null; }
    Patterns.reached.set(id, keys);
  }
  return Patterns.reached.get(id);
}

/** The moves that led to a position in one game, written out: "1. e4 e5 2. Nf3" — or '' when they were not kept. */
function movesLeadingTo(game, ply) {
  if (!game?.pgn || !(ply > 1)) return '';
  try {
    const sans = parsePgn(game.pgn, { maxPlies: ply - 1 }).plies.map((p) => p.san);
    if (sans.length !== ply - 1) return '';
    return sans.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san)).join(' ');
  } catch {
    return '';
  }
}

const timesWords = (n) => (n === 1 ? 'once' : (n === 2 ? 'twice' : `${n} times`));

/**
 * Draw both panels into `box`, from the analysed games the page is showing:
 * the kinds of mistake, and the positions gone wrong in more than once.
 *
 * THE TWO DO NOT DEPEND ON EACH OTHER. A position is the same position
 * whether or not the mistake made in it could be given a name, so the list of
 * positions is drawn even when there is no kind of mistake to count — it was
 * once left out with it, and a player whose mistakes were all nameless was
 * not told about the one move he kept getting wrong.
 */
function renderPatterns(box, games) {
  const found = mistakePatterns(games);
  if (found.rows.length) renderMistakeKinds(box, found);
  renderRecurring(box, games);
}

/** How often each kind of mistake comes up, and whether it is getting rarer. */
function renderMistakeKinds(box, found) {
  const panel = el('div', 'panel');
  panel.id = 'patterns';
  panel.appendChild(el('h3', null, 'What keeps happening'));

  // ── what it comes to ────────────────────────────────────────────────────
  const n = found.window;
  const latest = n ? [...found.rows].sort((a, b) => b.recent - a.recent || b.count - a.count)[0] : null;
  // THE ONE NAMED AT THE TOP, with how it compares — and so not named again
  // underneath. Only something that actually came up lately can be it: when
  // the latest games have none of any of these, nothing is "most often
  // lately", and everything that has got rarer is said below as usual.
  const lead = latest && latest.recent > 0 ? latest : null;
  const most = found.rows[0];
  const points = el('div', 'coach-points');
  if (lead) {
    const versus = { rarer: `which is rarer than in the ${n} before`, more: `which is more often than in the ${n} before`,
      same: `about as often as in the ${n} before`, unknown: '' }[lead.trend];
    points.appendChild(el('p', 'idea', `Most often lately: ${themeInSentence(lead.theme)} — ${howOftenWords(lead.recent / n)} over your latest ${n} analysed games${versus ? `, ${versus}` : ''}.`));
  } else if (n) {
    points.appendChild(el('p', 'idea', `None of these came up in your latest ${n} analysed games. Over all ${found.games}, most often: ${themeInSentence(most.theme)} — ${howOftenWords(most.perGame)}.`));
  } else {
    points.appendChild(el('p', 'idea', `Most often: ${themeInSentence(most.theme)} — ${howOftenWords(most.perGame)} over your ${found.games === 1 ? 'one analysed game' : `${found.games} analysed games`}.`));
  }
  const rarer = found.rows.filter((r) => r.trend === 'rarer' && r !== lead).slice(0, 2);
  const more = found.rows.filter((r) => r.trend === 'more' && r !== lead).slice(0, 2);
  const pair = (r) => `${themeInSentence(r.theme)} (${r.before}, then ${r.recent})`;
  if (rarer.length) points.appendChild(el('p', 'note good-note', `Getting rarer: ${rarer.map(pair).join('; ')}.`));
  if (more.length) points.appendChild(el('p', 'note bad-note', `Coming up more: ${more.map(pair).join('; ')}.`));
  panel.appendChild(points);

  // ── every kind, with its numbers ────────────────────────────────────────
  const list = el('div', 'record');
  for (const r of found.rows) {
    const row = el('div', 'record-row');
    row.dataset.theme = r.theme;
    const often = `${r.count} in ${found.games === 1 ? 'one game' : `${found.games} games`} · ${howOftenWords(r.perGame)}`;
    const moved = n ? ` · ${r.before}, then ${r.recent}: ${PATTERN_TREND_WORDS[r.trend]}` : '';
    row.innerHTML = `<span class="record-band">${esc(THEME_LABEL[r.theme] ?? r.theme)}</span>
      <span class="record-score">${esc(often)}${esc(moved)}</span>`;
    list.appendChild(row);
  }
  panel.appendChild(list);

  panel.appendChild(el('p', 'note', n
    ? `Each was shown on the board by replaying the moves that punished you, and describes what was done to you. The two numbers after each are your ${n} analysed games before the latest ${n}, and then the latest ${n}; "rarer" and "more often" are said only when the two are further apart than the luck of which games those were.`
    : `Each was shown on the board by replaying the moves that punished you, and describes what was done to you. With ${2 * PATTERN_MIN_GAMES} analysed games this will also say whether each is getting rarer; there ${found.games === 1 ? 'is one' : `are ${found.games}`} so far.`));
  if (found.mixed) {
    panel.appendChild(el('p', 'note', 'Those two sets of games were not all judged the same way — by the same judge, at the same setting — and a different judge finds different things, so read the comparison loosely.'));
  }
  const unnamed = found.mistakes - found.named;
  if (unnamed) {
    panel.appendChild(el('p', 'note', `${unnamed} of your ${found.mistakes} mistakes could not be given a name: the moves that punished them showed no pattern this app is able to demonstrate. They were positional, or the loss came from a sequence rather than a trick.`));
  }
  if (Weak.about) {
    const go = el('button', 'btn', 'Ten puzzles aimed at these');
    go.type = 'button';
    go.id = 'patternsWeak';
    go.addEventListener('click', () => { show('weak'); startWeakSet(); });
    const row = el('div', 'row');
    row.style.marginTop = '10px';
    row.appendChild(go);
    panel.appendChild(row);
  }
  box.appendChild(panel);
}

/** The positions gone wrong in more than once, each with what was played, what was wanted, and the board. */
function renderRecurring(box, games) {
  const spots = recurringMistakes(games, { reachedIn: openingPositionsOf });
  if (!spots.length) return;

  const panel = el('div', 'panel');
  panel.id = 'patternPositions';
  panel.appendChild(el('h3', null, spots.length === 1 ? 'A position you keep going wrong in' : 'Positions you keep going wrong in'));
  panel.appendChild(el('p', 'note', `In the first ${PATTERN_OPENING_PLIES / 2} moves, the same position gone wrong in more than one game. It will be on the board again, which makes it the cheapest thing here to put right.`));

  for (const s of spots) {
    const game = games.find((g) => g.at === s.from?.at);
    const line = movesLeadingTo(game, s.from?.ply);
    const item = el('div', 'pattern-spot');
    item.dataset.key = s.key;
    const Side = s.side === 'black' ? 'Black' : 'White';
    item.appendChild(el('p', 'pattern-where', line ? `After ${line}` : `A position on move ${Math.ceil((s.from?.ply ?? 1) / 2)}, with ${Side} to play`));
    const playedWords = s.played.map((p) => `${p.san} ${timesWords(p.count)}`);
    const said = playedWords.length < 2 ? playedWords[0] : `${playedWords.slice(0, -1).join(', ')} and ${playedWords[playedWords.length - 1]}`;
    const cost = Number.isFinite(s.loss) ? ` It cost about ${(s.loss / 100).toFixed(1)} points each time.` : '';
    item.appendChild(el('p', 'note', `Reached ${timesWords(s.reached)}, gone wrong in ${s.games}: you played ${said}.${s.best ? ` The reviewer wanted ${s.best.san}.` : ''}${cost}`));
    const look = el('button', 'btn', 'Look at it');
    look.type = 'button';
    look.addEventListener('click', () => openPractice(s.fen, { arrows: arrowsFor(s.played[0]?.uci ?? null, s.best?.uci ?? null) }));
    const row = el('div', 'row');
    row.appendChild(look);
    item.appendChild(row);
    panel.appendChild(item);
  }
  box.appendChild(panel);
}
