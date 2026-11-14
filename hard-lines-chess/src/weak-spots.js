// ── puzzles aimed at what goes wrong in your games ─────────────────────────
//
// The Puzzles screen asks about moments out of your own games, and there are
// only as many of those as you have played. This is the other half: a pack of
// puzzles from the Lichess puzzle database — released into the public domain,
// each one rated by how thousands of people did on it — and a rule for which
// of them you are given.
//
// THE RULE IS YOUR OWN GAMES. Every mistake the reviewer finds is replayed on
// the board and named when it can be (src/motifs.js): you allowed a fork, you
// left a piece loose, you walked into a pin. Those names are counted over your
// latest analysed games, and most of each set of puzzles is of the kinds that
// come up most. The rest is a mix, so the set is not a single idea ten times.
//
// TWO VOCABULARIES, KEPT APART. A mistake's name says what was done TO you; a
// puzzle's theme says what the solver DOES. "Allowing a fork" is trained by
// puzzles where a fork wins — the same pattern seen from the side that plays
// it — and the screen says both halves rather than one label for the two.
// WEAK_AIMS is the whole of the crossing between them.
//
// AND THE LEVEL IS YOURS. Each puzzle has a rating; you have a level on the
// same scale, moved after every new puzzle by how surprising the result was.
// Puzzles are picked a little under it, so that about two in three are solved:
// hard enough to need looking at, not so hard that a set is ten misses.
//
// THE PACK CAN BE MISSING. It is a file beside the page, described by a small
// one beside that. A copy of the page opened from a file has neither, and
// then there is no Weak spots screen at all rather than one that cannot work.
//
// Nothing in this file touches the page: it is the choosing and the judging,
// so that tests/weak-spots.test.mjs can hold it to its rules without a browser.

/** The two files beside the page: what the pack is, and the pack. */
const WEAK_PACK_ABOUT = 'puzzle-pack.json';
const WEAK_PACK_FILE = 'puzzle-pack.txt';

/** One letter a theme, in the order the pack's own first lines give. */
const WEAK_THEME_CODES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A mistake's name → the puzzle themes that show the same pattern from the
 * side that plays it. A name that is not here has no puzzle of its own:
 * `lostMaterial` is, by its own definition, a loss with no trick behind it.
 */
const WEAK_AIMS = {
  hangingPiece: ['hangingPiece'],
  fork: ['fork'],
  pin: ['pin'],
  skewer: ['skewer'],
  discoveredAttack: ['discoveredAttack'],
  backRankMate: ['backRankMate'],
  trappedPiece: ['trappedPiece'],
  exposedKing: ['exposedKing'],
  mateIn1: ['mateIn1'],
  mateIn2: ['mateIn2'],
  mateIn3: ['mateIn3'],
  missedMate: ['mateIn1', 'mateIn2', 'mateIn3'],
};

/**
 * What a puzzle theme is called, from the solver's side. `many` heads a list
 * and names an aim ("aimed at forks"); `one` says what a single puzzle was.
 * A theme with no entry here is never shown: the pack carries a few that only
 * describe how long the answer is or how the game was going.
 */
const PUZZLE_THEME_WORDS = {
  hangingPiece: { many: 'loose pieces', one: 'a piece left loose' },
  fork: { many: 'forks', one: 'a fork' },
  pin: { many: 'pins', one: 'a pin' },
  skewer: { many: 'skewers', one: 'a skewer' },
  discoveredAttack: { many: 'discovered attacks', one: 'a discovered attack' },
  backRankMate: { many: 'back-rank mates', one: 'a back-rank mate' },
  trappedPiece: { many: 'trapped pieces', one: 'a trapped piece' },
  exposedKing: { many: 'exposed kings', one: 'an exposed king' },
  mateIn1: { many: 'mates in one', one: 'mate in one' },
  mateIn2: { many: 'mates in two', one: 'mate in two' },
  mateIn3: { many: 'mates in three', one: 'mate in three' },
  mateIn4: { many: 'mates in four', one: 'mate in four' },
  doubleCheck: { many: 'double checks', one: 'a double check' },
  sacrifice: { many: 'sacrifices', one: 'a sacrifice' },
  capturingDefender: { many: 'removing the defender', one: 'removing the defender' },
  deflection: { many: 'pulling a defender away', one: 'pulling a defender away' },
  attraction: { many: 'luring a piece', one: 'luring a piece onto a bad square' },
  interference: { many: 'blocking a defender', one: 'blocking a defender' },
  clearance: { many: 'clearing a line', one: 'clearing a line' },
  intermezzo: { many: 'in-between moves', one: 'an in-between move' },
  quietMove: { many: 'quiet moves', one: 'a quiet move' },
  defensiveMove: { many: 'defensive moves', one: 'a defensive move' },
  xRayAttack: { many: 'attacks through a piece', one: 'an attack through a piece' },
  zugzwang: { many: 'zugzwang', one: 'zugzwang' },
  advancedPawn: { many: 'advanced pawns', one: 'an advanced pawn' },
  promotion: { many: 'promotions', one: 'a promotion' },
  underPromotion: { many: 'underpromotions', one: 'an underpromotion' },
  enPassant: { many: 'en passant', one: 'en passant' },
  smotheredMate: { many: 'smothered mates', one: 'a smothered mate' },
  kingsideAttack: { many: 'kingside attacks', one: 'an attack on the kingside' },
  queensideAttack: { many: 'queenside attacks', one: 'an attack on the queenside' },
  attackingF2F7: { many: 'attacks on f2 and f7', one: 'an attack on f2 or f7' },
};

/** How many of the latest analysed games the aim is taken from. */
const WEAK_SPAN_GAMES = 50;
/** How many puzzles make a set. */
const WEAK_SET_SIZE = 10;
/** Of a set, the share aimed at your own mistakes when there are any to aim at. */
const WEAK_AIMED_SHARE = 0.7;
/** No more than this many aims in one set, so that it has a subject. */
const WEAK_AIMS_IN_A_SET = 4;
/** At most this many of a set are ones missed before and now due again. */
const WEAK_REPEATS_IN_A_SET = 3;
/** How far under your level the middle of the pick sits, and how far either side it ranges. */
const WEAK_EASIER = 100;
const WEAK_SPREAD = 125;
/** An aimed puzzle further than this from the level wanted is not offered; a mixed one takes its place. */
const WEAK_REACH = 300;
/** Where a level starts, and the limits it is kept inside. */
const WEAK_LEVEL_START = 1000;
const WEAK_LEVEL_MIN = 300;
const WEAK_LEVEL_MAX = 3000;
/** How many results are kept for the figures by theme. */
const WEAK_LOG_KEEP = 1000;

/** The stored area as it starts, and with anything an older copy lacks filled in. */
function weakSpotsData(stored) {
  const src = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  return {
    ...src,
    level: Number.isFinite(src.level) ? Math.min(WEAK_LEVEL_MAX, Math.max(WEAK_LEVEL_MIN, src.level)) : WEAK_LEVEL_START,
    counted: Number.isFinite(src.counted) && src.counted > 0 ? Math.floor(src.counted) : 0,
    done: Array.isArray(src.done) ? src.done.filter((id) => typeof id === 'string') : [],
    again: Array.isArray(src.again) ? src.again.filter((a) => a && a.puzzle && typeof a.puzzle.id === 'string') : [],
    log: Array.isArray(src.log) ? src.log.filter((r) => r && typeof r === 'object') : [],
  };
}

// ── the pack ───────────────────────────────────────────────────────────────

/**
 * Read a pack: its themes, its rows, and where every theme's puzzles are.
 *
 * The file is lines. The ones that start with "#" say what it is, and one of
 * them lists the themes in the order their letters stand for. Every other
 * line is a puzzle, tab-separated: its Lichess id, its rating, a letter for
 * each theme, the position, and the moves — the first is the move that was
 * just played against the solver, exactly as the database has it.
 *
 * ROWS ARE IN ORDER OF RATING, and this refuses a pack that is not: finding
 * the puzzles nearest a level is a search through that order, and on a pack
 * out of order it would quietly return the wrong ones.
 *
 * Rows are kept as the text they came as and read only when one is wanted.
 */
function parsePuzzlePack(text) {
  const rows = [];
  let themes = null;
  for (const line of String(text ?? '').split('\n')) {
    if (!line) continue;
    if (line[0] === '#') {
      if (line.startsWith('# themes ')) themes = line.slice(9).trim().split(/\s+/).filter(Boolean);
      continue;
    }
    rows.push(line);
  }
  if (!themes || !themes.length) throw new Error('The puzzle pack does not say what its themes are.');
  if (themes.length > WEAK_THEME_CODES.length) throw new Error('The puzzle pack names more themes than it has letters for.');
  if (!rows.length) throw new Error('The puzzle pack has no puzzles in it.');

  const rating = new Uint16Array(rows.length);
  const byTheme = new Map(themes.map((name) => [name, []]));
  let last = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const a = row.indexOf('\t');
    const b = row.indexOf('\t', a + 1);
    const c = row.indexOf('\t', b + 1);
    const rated = Number(row.slice(a + 1, b));
    if (a < 1 || b < 0 || c < 0 || !Number.isInteger(rated) || rated < 1 || rated > 65535) {
      throw new Error(`The puzzle pack cannot be read at its puzzle number ${i + 1}.`);
    }
    if (rated < last) throw new Error('The puzzle pack is not in order of rating.');
    last = rated;
    rating[i] = rated;
    for (let k = b + 1; k < c; k++) {
      const name = themes[WEAK_THEME_CODES.indexOf(row[k])];
      if (name === undefined) throw new Error(`The puzzle pack cannot be read at its puzzle number ${i + 1}.`);
      byTheme.get(name).push(i);
    }
  }
  return { rows, themes, rating, byTheme, count: rows.length, where: null };
}

/** The id a row starts with. */
const packRowId = (row) => row.slice(0, row.indexOf('\t'));

/** One row, read: { id, rating, themes, fen, moves }, or null when it is not a row. */
function readPackRow(row, themes) {
  const parts = String(row ?? '').split('\t');
  if (parts.length !== 5) return null;
  const [id, rated, codes, fen, moves] = parts;
  const rating = Number(rated);
  const line = moves.split(' ').filter(Boolean);
  if (!id || !Number.isInteger(rating) || line.length < 2) return null;
  const names = [];
  for (const code of codes) {
    const name = themes?.[WEAK_THEME_CODES.indexOf(code)];
    if (name) names.push(name);
  }
  return { id, rating, themes: names, fen, moves: line, row };
}

/** Where a puzzle with this id is in the pack, or -1. The index is built the first time it is asked for. */
function packIndexOf(pack, id) {
  if (!pack.where) {
    pack.where = new Map();
    for (let i = 0; i < pack.rows.length; i++) pack.where.set(packRowId(pack.rows[i]), i);
  }
  return pack.where.get(id) ?? -1;
}

/**
 * The puzzle nearest a rating that has not been taken, or -1.
 *
 * `theme` narrows it to one theme's puzzles; without one it is any puzzle.
 * The search starts where the rating sits in the pack's order and walks
 * outwards, down and up, taking whichever side is nearer each time — so what
 * comes back is the nearest one left, not merely one inside a window, and a
 * level where the pack is thin is served from the nearest place it is not.
 * `reach` is how far that may go before the answer is "none".
 */
function pickPackPuzzle(pack, { theme = null, around, taken, reach = Infinity }) {
  const list = theme ? pack.byTheme.get(theme) : null;
  if (theme && (!list || !list.length)) return -1;
  const size = list ? list.length : pack.count;
  const at = (k) => (list ? list[k] : k);

  let lo = 0, hi = size;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pack.rating[at(mid)] < around) lo = mid + 1; else hi = mid;
  }
  let down = lo - 1, up = lo;
  while (down >= 0 || up < size) {
    const below = down >= 0 ? around - pack.rating[at(down)] : Infinity;
    const above = up < size ? pack.rating[at(up)] - around : Infinity;
    if (Math.min(below, above) > reach) return -1;
    const i = above <= below ? at(up++) : at(down--);
    if (!taken.has(packRowId(pack.rows[i]))) return i;
  }
  return -1;
}

// ── what to aim at ─────────────────────────────────────────────────────────

/**
 * What the latest analysed games say goes wrong, as puzzle themes to aim at.
 *
 * Every theme a mistake was given is counted, the way the Progress page
 * counts them, so the two pages cannot give one game two different tallies.
 * A mistake name that crosses to several puzzle themes shares its count out
 * among them. What comes back is most-frequent first:
 *
 *   games     how many analysed games were looked at
 *   mistakes  how many mistakes they held
 *   named     how many of those had a name at all
 *   aims      [{ theme, weight, from: [{ mistake, count }] }]
 */
function weakSpotAims(games, span = WEAK_SPAN_GAMES) {
  const latest = (games ?? [])
    .filter((g) => g && g.reviewed !== false && Array.isArray(g.mistakes))
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    .slice(-span);
  const counts = {};
  let mistakes = 0, named = 0;
  for (const game of latest) {
    for (const m of game.mistakes) {
      mistakes++;
      if (!Array.isArray(m?.themes) || !m.themes.length) continue;
      named++;
      for (const name of m.themes) counts[name] = (counts[name] ?? 0) + 1;
    }
  }
  const aims = new Map();
  for (const [mistake, count] of Object.entries(counts)) {
    const themes = WEAK_AIMS[mistake];
    if (!themes) continue;
    for (const theme of themes) {
      if (!aims.has(theme)) aims.set(theme, { theme, weight: 0, from: [] });
      const aim = aims.get(theme);
      aim.weight += count / themes.length;
      aim.from.push({ mistake, count });
    }
  }
  const list = [...aims.values()].sort((a, b) => b.weight - a.weight || a.theme.localeCompare(b.theme));
  for (const aim of list) aim.from.sort((a, b) => b.count - a.count || a.mistake.localeCompare(b.mistake));
  return { games: latest.length, mistakes, named, aims: list };
}

/**
 * Lay out one set: which slot is aimed at what, and which are mixed.
 *
 * `repeats` is how many puzzles missed before are due again; they take mixed
 * places first. Of what is left, WEAK_AIMED_SHARE goes to the leading aims in
 * proportion to how often each came up — every one of them gets at least one
 * place while there are places — and the rest is mixed. The order is then
 * shuffled, so a set does not open with its four forks in a row.
 *
 * @returns {Array<{ kind: 'again' } | { kind: 'aimed', theme: string } | { kind: 'mixed' }>}
 */
function planWeakSet(aims, { size = WEAK_SET_SIZE, repeats = 0, rng = Math.random } = {}) {
  const again = Math.max(0, Math.min(repeats, WEAK_REPEATS_IN_A_SET, size));
  const fresh = size - again;
  const leading = (aims ?? []).filter((a) => a.weight > 0).slice(0, WEAK_AIMS_IN_A_SET);
  const aimed = leading.length ? Math.min(fresh, Math.round(size * WEAK_AIMED_SHARE)) : 0;

  // Largest remainder: whole places first, then the leftovers to whoever was
  // rounded down the furthest.
  const total = leading.reduce((sum, a) => sum + a.weight, 0);
  const shares = leading.map((a) => ({ theme: a.theme, exact: (a.weight / total) * aimed, places: 0 }));
  for (const s of shares) s.places = Math.floor(s.exact);
  let left = aimed - shares.reduce((sum, s) => sum + s.places, 0);
  for (const s of [...shares].sort((a, b) => (b.exact - b.places) - (a.exact - a.places))) {
    if (left <= 0) break;
    s.places++;
    left--;
  }
  // Nobody among the leading aims is left with none while another has two.
  for (const s of shares) {
    if (s.places > 0) continue;
    const richest = shares.reduce((best, x) => (x.places > best.places ? x : best), shares[0]);
    if (richest.places > 1) { richest.places--; s.places++; }
  }

  const slots = [];
  for (let i = 0; i < again; i++) slots.push({ kind: 'again' });
  for (const s of shares) for (let i = 0; i < s.places; i++) slots.push({ kind: 'aimed', theme: s.theme });
  while (slots.length < size) slots.push({ kind: 'mixed' });
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots;
}

/** The rating to look near for a level: a little under it, and not the same spot every time. */
function weakTargetRating(level, rng = Math.random) {
  return Math.round(level - WEAK_EASIER + (rng() * 2 - 1) * WEAK_SPREAD);
}

/**
 * The level after one more new puzzle.
 *
 * The ordinary rating sum: what was expected of this level against this
 * puzzle, and a step towards what happened. The step is large for the first
 * few puzzles, while the level is a guess, and settles after thirty.
 */
function nextWeakLevel(level, counted, rating, solved) {
  const expected = 1 / (1 + 10 ** ((rating - level) / 400));
  const step = counted < 10 ? 64 : (counted < 30 ? 40 : 24);
  const next = Math.round(level + step * ((solved ? 1 : 0) - expected));
  return Math.min(WEAK_LEVEL_MAX, Math.max(WEAK_LEVEL_MIN, next));
}

// ── one puzzle, on a board ─────────────────────────────────────────────────

/**
 * Set a puzzle up to be solved, or null when its moves cannot be played.
 *
 * The database gives the position BEFORE the move that set the puzzle up, and
 * that move first. So the solver's position is one move in, the move that was
 * "just played" is known rather than guessed, and every later move is written
 * out here once: `line` holds the solver's moves and the replies in between,
 * each with the position it is played from.
 */
function openPackPuzzle(puzzle) {
  let board;
  try { board = new Board(puzzle.fen); } catch { return null; }
  const before = puzzle.fen;
  const first = moveFromUci(board, puzzle.moves[0]);
  if (!first) return null;
  const theirSan = toSan(board, first);
  board.make(first);
  const start = board.fen();
  const side = board.turn === WHITE ? 'white' : 'black';
  const moveNumber = board.fullmove;
  const line = [];
  for (let i = 1; i < puzzle.moves.length; i++) {
    const move = moveFromUci(board, puzzle.moves[i]);
    if (!move) return null;
    line.push({ uci: puzzle.moves[i], san: toSan(board, move), fen: board.fen(), mine: i % 2 === 1 });
    board.make(move);
  }
  if (!line.length || !line[line.length - 1].mine) return null;
  return {
    ...puzzle, before, theirUci: puzzle.moves[0], theirSan, start, side, moveNumber, line,
    yours: line.filter((step) => step.mine).length,
  };
}

/**
 * Is this the move the puzzle wants, at this step of its line?
 *
 * The move in the line is. So is any move that is checkmate on the spot: a
 * mate is a mate, and the database's own rule is that a second way to give
 * it counts — it records one line, not every one.
 */
function packMoveIsRight(step, uci) {
  if (uci === step.uci) return true;
  const board = new Board(step.fen);
  const move = moveFromUci(board, uci);
  if (!move) return false;
  board.make(move);
  return board.inCheck() && !hasLegalReply(board);
}

/** A puzzle's line as it would be written down, from the solver's first move. */
function packLineText(opened) {
  const board = new Board(opened.start);
  const out = [];
  for (const step of opened.line) {
    const white = board.turn === WHITE;
    if (white) out.push(`${board.fullmove}. ${step.san}`);
    else out.push(out.length ? step.san : `${board.fullmove}... ${step.san}`);
    board.make(moveFromUci(board, step.uci));
  }
  return out.join(' ');
}

/** What a puzzle was, in the solver's words: the themes there are words for, in the pack's order. */
function packThemeWords(themes) {
  return (themes ?? []).map((t) => PUZZLE_THEME_WORDS[t]?.one).filter(Boolean);
}
