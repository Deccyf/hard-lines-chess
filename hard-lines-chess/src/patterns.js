// ── what keeps happening ───────────────────────────────────────────────────
//
// A review says what went wrong in one game. The Progress page added the
// games up: so many forks allowed, so many pieces left loose. Neither says
// the thing a coach would: which of these is costing you most often NOW,
// whether it is getting rarer, and whether you keep going wrong in the same
// place.
//
// HOW OFTEN IS A RATE, NOT A COUNT. "Fourteen forks" means one thing over
// twenty games and another over two hundred, so every kind of mistake is said
// per game.
//
// WHETHER IT IS GETTING RARER IS TWO WINDOWS OF THE SAME SIZE: your latest
// games against the same number before them. And it is only said when the
// difference is more than the luck of which games those happened to be — a
// kind of mistake that came up three times and then twice has not got rarer,
// and a page that said so would be praising noise. Where there are too few to
// tell, it says that instead.
//
// THE SAME PLACE means the same position, in the opening, gone wrong in more
// than once. A mistake made once is a mistake; made in one position three
// games out of four it is a hole, and it is the cheapest thing on this page
// to mend, because the position will be on the board again.
//
// Nothing here touches the page or searches anything: it counts what the
// reviews already stored. tests/patterns.test.mjs holds it to what it says.

/** The latest so many analysed games are set against the same number before them. */
const PATTERN_WINDOW = 25;
/** With fewer games than this in each window, nothing is said about a trend. */
const PATTERN_MIN_GAMES = 8;
/** "The opening" is each side's first twelve moves. */
const PATTERN_OPENING_PLIES = 24;
/** How many positions gone wrong in more than once are listed. */
const PATTERN_POSITIONS = 5;

/**
 * Whether a count has moved, between two windows of the same number of games.
 *
 * The two counts are set against the spread two such counts would show if
 * nothing had changed — for things that happen now and then, about the square
 * root of their sum — and called different only when they are a clear step
 * and a half of that apart. Under four in all, there is nothing to compare.
 *
 * @returns {'rarer' | 'more' | 'same' | 'unknown'}
 */
function patternTrend(before, recent) {
  const total = before + recent;
  if (total < 4) return 'unknown';
  const apart = (before - recent) / Math.sqrt(total);
  return apart >= 1.5 ? 'rarer' : (apart <= -1.5 ? 'more' : 'same');
}

/** Analysed games, oldest first. */
function analysedInOrder(games) {
  return (games ?? [])
    .filter((g) => g && g.reviewed !== false && Array.isArray(g.mistakes))
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

/**
 * How often each kind of mistake comes up, and whether it is getting rarer.
 *
 * Every theme a mistake was given is counted, as everywhere else in the app.
 * What comes back:
 *
 *   games     how many analysed games there are
 *   window    how many games are in each of the two windows, or 0 when there
 *             are too few games to have two
 *   mixed     the two windows were not all judged the same way — by the same
 *             judge at the same depth — so the comparison is rougher
 *   rows      [{ theme, count, perGame, before, recent, trend }] most frequent
 *             first; `before` and `recent` are counts in the two windows
 *   named     how many mistakes had a name, of `mistakes` in all
 */
function mistakePatterns(games, { window = PATTERN_WINDOW, least = PATTERN_MIN_GAMES } = {}) {
  const all = analysedInOrder(games);
  const size = Math.min(window, Math.floor(all.length / 2));
  const span = size >= least ? size : 0;
  const recentGames = span ? all.slice(-span) : [];
  const beforeGames = span ? all.slice(-2 * span, -span) : [];

  const tally = (list) => {
    const counts = {};
    for (const g of list) for (const m of g.mistakes) for (const t of m?.themes ?? []) counts[t] = (counts[t] ?? 0) + 1;
    return counts;
  };
  const overall = tally(all);
  const recent = tally(recentGames);
  const before = tally(beforeGames);

  let mistakes = 0, named = 0;
  for (const g of all) for (const m of g.mistakes) { mistakes++; if (m?.themes?.length) named++; }

  const how = (g) => `${g.judge ?? 'app'}/${g.depth ?? ''}`;
  const ways = new Set([...recentGames, ...beforeGames].map(how));

  const rows = Object.keys(overall).map((theme) => ({
    theme,
    count: overall[theme],
    perGame: overall[theme] / all.length,
    before: before[theme] ?? 0,
    recent: recent[theme] ?? 0,
    trend: span ? patternTrend(before[theme] ?? 0, recent[theme] ?? 0) : 'unknown',
  })).sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme));

  return { games: all.length, window: span, mixed: span > 0 && ways.size > 1, rows, mistakes, named };
}

/** A position as it counts for "the same position": the board, whose move, castling and en passant — not the move numbers. */
function positionKey(fen) {
  return String(fen ?? '').trim().split(/\s+/).slice(0, 4).join(' ');
}

/**
 * Positions in the opening where you have gone wrong in more than one game.
 *
 * `reachedIn(game)` gives the positions (as positionKey) a game put in front
 * of you in its opening, or null when the game's moves were not kept; it is
 * handed in because reading a game's moves needs the rules, and this file
 * only counts. A game whose moves were not kept still reached any position it
 * went wrong in.
 *
 * Most games first, then the most lost. Each entry:
 *
 *   key, fen, side      the position, and whose move it is — yours
 *   games               how many games you went wrong in it
 *   reached             how many games put it in front of you
 *   played              [{ san, uci, count }] what you played, most often first
 *   best                { san, uci } what the reviewer wanted, as most often said
 *   loss                the average of what it cost, in the engine's units; null for a mate
 *   from                one of the games it happened in, the latest: { at, ply }
 */
function recurringMistakes(games, { plies = PATTERN_OPENING_PLIES, most = PATTERN_POSITIONS, reachedIn = () => null } = {}) {
  const all = analysedInOrder(games);
  const spots = new Map();
  for (const g of all) {
    const seen = new Set();
    for (const m of g.mistakes) {
      if (!m || !m.fen || !(m.ply <= plies)) continue;
      const key = positionKey(m.fen);
      if (!spots.has(key)) spots.set(key, { key, fen: m.fen, side: m.side ?? g.side ?? null, games: 0, played: new Map(), wanted: new Map(), losses: [], from: null, wrongIn: new Set() });
      const spot = spots.get(key);
      // One game counts once for a position, however the review came to list it twice.
      if (seen.has(key)) continue;
      seen.add(key);
      spot.games += 1;
      spot.wrongIn.add(g);
      const played = spot.played.get(m.san) ?? { san: m.san, uci: m.uci ?? null, count: 0 };
      played.count += 1;
      spot.played.set(m.san, played);
      if (m.best?.san) {
        const wanted = spot.wanted.get(m.best.san) ?? { san: m.best.san, uci: m.best.uci ?? null, count: 0 };
        wanted.count += 1;
        spot.wanted.set(m.best.san, wanted);
      }
      if (Number.isFinite(m.loss)) spot.losses.push(m.loss);
      spot.from = { at: g.at, ply: m.ply };
    }
  }

  const repeated = [...spots.values()].filter((s) => s.games >= 2);
  if (!repeated.length) return [];
  const wanted = new Set(repeated.map((s) => s.key));
  const reached = new Map(repeated.map((s) => [s.key, 0]));
  for (const g of all) {
    const keys = reachedIn(g);
    if (keys) {
      for (const key of new Set(keys)) if (wanted.has(key)) reached.set(key, reached.get(key) + 1);
    } else {
      for (const s of repeated) if (s.wrongIn.has(g)) reached.set(s.key, reached.get(s.key) + 1);
    }
  }

  const byCount = (a, b) => b.count - a.count || a.san.localeCompare(b.san);
  return repeated.map((s) => {
    const best = [...s.wanted.values()].sort(byCount)[0] ?? null;
    return {
      key: s.key,
      fen: s.fen,
      side: s.side,
      games: s.games,
      // Never fewer than the games it went wrong in: a game read differently
      // from how it was reviewed must not make "4 of 3".
      reached: Math.max(s.games, reached.get(s.key)),
      played: [...s.played.values()].sort(byCount),
      best: best ? { san: best.san, uci: best.uci } : null,
      loss: s.losses.length ? s.losses.reduce((a, b) => a + b, 0) / s.losses.length : null,
      from: s.from,
    };
  }).sort((a, b) => b.games - a.games || (b.loss ?? Infinity) - (a.loss ?? Infinity) || a.key.localeCompare(b.key))
    .slice(0, most);
}

/**
 * How often, in words, from a number per game: "about 1.4 a game", "about
 * once every 3 games". Nothing at all is said by the caller.
 */
function howOftenWords(perGame) {
  if (!(perGame > 0)) return 'not at all';
  if (perGame >= 0.95) return `about ${perGame >= 9.95 ? Math.round(perGame) : perGame.toFixed(1).replace(/\.0$/, '')} a game`;
  const every = Math.round(1 / perGame);
  return every <= 1 ? 'about once a game' : `about once every ${every} games`;
}
