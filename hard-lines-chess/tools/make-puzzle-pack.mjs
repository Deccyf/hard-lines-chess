// ── the puzzle pack, made from the Lichess puzzle database ─────────────────
//
// The Weak spots screen gives puzzles of the kinds your own games go wrong
// in, at your level (src/weak-spots.js). It needs a supply of puzzles that
// have a kind and a level, and the place that has one is the Lichess puzzle
// database: millions of positions out of real games, each tagged with its
// themes and rated by how people did on it, and released into the public
// domain (CC0). This picks a pack out of it.
//
// WHAT IS PICKED, AND WHY NOT SIMPLY THE FIRST FIFTY THOUSAND.
//
//   ONLY PUZZLES PEOPLE HAVE TESTED. A puzzle has to have been played enough
//   for its rating to have settled, and liked by nearly everybody who played
//   it. A rating nobody has tested is a guess, and an unpopular puzzle is
//   usually one whose answer is arguable.
//
//   SHORT ENOUGH FOR A PHONE. The solver makes at most four moves.
//
//   TWO THIRDS OF IT IS THE THEMES THE APP CAN AIM AT. Those are the themes a
//   game mistake can cross to — WEAK_AIMS in src/weak-spots.js, read from
//   there rather than typed again here — and each gets the same number of
//   puzzles, spread over the ratings, so that whatever your games show and
//   whatever your level there is a shelf of it. The other third is anything.
//
//   MOST OF IT WHERE MOST PLAYERS ARE. Ratings from 600 to 2000 get twice the
//   room of the ends.
//
//   THE SAME FILE GIVES THE SAME PACK. The choosing is random, from a fixed
//   seed, over the rows in the order the file has them.
//
// AND EVERY PUZZLE IS PLAYED THROUGH BEFORE IT IS KEPT, by this app's own
// move generator: the position has to be one the app can set up, every move
// has to be legal in it, the solver has to have the last move, and a puzzle
// tagged as a mate has to end in one — in the number of moves it says. A row
// that fails is dropped and counted. The app plays these on the same board,
// so a move it would refuse must never reach it.
//
// Run from the app's directory:
//
//   zstd -dc lichess_db_puzzle.csv.zst | node tools/make-puzzle-pack.mjs - --snapshot 2026-11-01
//   node tools/make-puzzle-pack.mjs lichess_db_puzzle.csv --snapshot 2026-11-01
//
//   --size N       how many puzzles to keep (50000)
//   --out DIR      where pack.txt and pack.json go (vendor/puzzles)
//   --snapshot D   the date of the database file, written into pack.json
//   --plays N --popularity N --deviation N   the thresholds, see below
//
// Writes pack.txt, the pack, and pack.json, which says what is in it. Both
// are committed: the database is a quarter of a gigabyte and this takes
// minutes, so it does not run on every build.

import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

const stripExports = (s) => s.replace(/^export /gm, '').replace(/import \{[\s\S]*?\} from '\.\/core\.js';\n/, '');
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const api = new Function('window', 'localStorage', [
  stripExports(read('../src/engine/core.js')),
  read('../src/notation.js'),
  read('../src/pgn.js'),
  read('../src/weak-spots.js'),
].join('\n') + '; return { Board, moveToUci, typeOf, KING, nameToSquare, hasLegalReply, fenProblem,'
  + ' WEAK_AIMS, PUZZLE_THEME_WORDS, WEAK_THEME_CODES, parsePuzzlePack };')({}, undefined);
const { Board, moveToUci, typeOf, KING, nameToSquare, hasLegalReply, fenProblem,
  WEAK_AIMS, PUZZLE_THEME_WORDS, WEAK_THEME_CODES, parsePuzzlePack } = api;

// ── what was asked for ─────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const input = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--'));
if (!input) {
  console.error('usage: node tools/make-puzzle-pack.mjs <lichess_db_puzzle.csv | -> [--size N] [--out DIR] [--snapshot YYYY-MM-DD]');
  process.exit(2);
}

const SIZE = Number(flag('size', 50000));
const OUT = resolve(flag('out', 'vendor/puzzles'));
const SNAPSHOT = flag('snapshot', null);

/** Ratings kept, in bands of a hundred: 400 up to, and not including, 2300. */
const MIN_RATING = 400, MAX_RATING = 2300, BAND = 100;
/** A rating that has settled: the database's own measure of how unsure it still is. */
const MAX_DEVIATION = Number(flag('deviation', 90));
/** Liked by nearly everybody who played it, on the database's scale of -100 to 100. */
const MIN_POPULARITY = Number(flag('popularity', 85));
/** And played by enough people for both of those to mean something. */
const MIN_PLAYS = Number(flag('plays', 500));
/** The most moves the solver makes. */
const MAX_SOLVER_MOVES = 4;
/** The share of the pack that is the themes the app can aim at. */
const AIMED_SHARE = 0.66;
/** How much room a band of ratings gets: the middle twice the ends. */
const bandWeight = (band) => (band >= 600 && band < 2000 ? 1 : 0.5);

/** The themes the app can aim at, each once, in the order WEAK_AIMS first names them. */
const AIMED = [...new Set(Object.values(WEAK_AIMS).flat())];
/**
 * The themes a row keeps: the ones the app has words for, and four that say
 * what part of the game it was and whether the answer is a mate. Everything
 * else the database tags a puzzle with — how long the answer is, who played
 * the game — is left behind.
 */
const KEPT = [...new Set([...AIMED, ...Object.keys(PUZZLE_THEME_WORDS), 'mate', 'opening', 'middlegame', 'endgame'])];
if (KEPT.length > WEAK_THEME_CODES.length) throw new Error(`${KEPT.length} themes to keep and ${WEAK_THEME_CODES.length} letters to write them with`);
const codeOf = new Map(KEPT.map((name, i) => [name, WEAK_THEME_CODES[i]]));

const BANDS = [];
for (let b = MIN_RATING; b < MAX_RATING; b += BAND) BANDS.push(b);
const weightSum = BANDS.reduce((sum, b) => sum + bandWeight(b), 0);

/** Share a number out over the bands by their weights, in whole puzzles that add up to it. */
function overBands(total) {
  const exact = BANDS.map((b) => (total * bandWeight(b)) / weightSum);
  const whole = exact.map(Math.floor);
  let left = total - whole.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - whole[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left-- <= 0) break; whole[i]++; }
  return whole;
}

const perTheme = Math.floor((SIZE * AIMED_SHARE) / AIMED.length);
const aimedQuota = overBands(perTheme);                              // the same for every aimed theme
const mixedQuota = overBands(SIZE - perTheme * AIMED.length);

// ── reading, and keeping a fair sample of what passes ──────────────────────

// Deterministic: the same file gives the same pack.
let seed = 20261114;
const rng = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

/**
 * A fair sample of everything offered to it, of a fixed size, without holding
 * everything: the database is millions of rows and a cell wants a few hundred.
 */
class Sample {
  constructor(room) { this.room = room; this.rows = []; this.seen = 0; }
  offer(row) {
    this.seen++;
    if (this.rows.length < this.room) { this.rows.push(row); return; }
    const at = Math.floor(rng() * this.seen);
    if (at < this.room) this.rows[at] = row;
  }
  /** The sample in a random order, so that taking from the front is taking at random. */
  shuffled() {
    const out = [...this.rows];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

// Three times the quota: room for the rows a later cell has already taken,
// and for the ones that do not survive being played through.
const aimedCells = new Map(AIMED.map((t) => [t, BANDS.map((_, i) => new Sample(aimedQuota[i] * 3 + 20))]));
const mixedCells = BANDS.map((_, i) => new Sample(mixedQuota[i] * 3 + 20));

const passed = { rows: 0, kept: 0, columns: 0, rating: 0, deviation: 0, popularity: 0, plays: 0, length: 0 };

function consider(line) {
  if (!line) return;
  const cols = line.split(',');
  // The file's own first line, which names the columns.
  if (cols[0] === 'PuzzleId') return;
  passed.rows++;
  if (cols.length < 8) { passed.columns++; return; }
  const [id, fen, moves, ratingText, deviationText, popularityText, playsText, themesText] = cols;
  const rating = Number(ratingText);
  if (!Number.isInteger(rating) || rating < MIN_RATING || rating >= MAX_RATING) { passed.rating++; return; }
  if (!(Number(deviationText) <= MAX_DEVIATION)) { passed.deviation++; return; }
  if (!(Number(popularityText) >= MIN_POPULARITY)) { passed.popularity++; return; }
  if (!(Number(playsText) >= MIN_PLAYS)) { passed.plays++; return; }
  const count = moves.split(' ').length;
  if (count < 2 || count % 2 || count / 2 > MAX_SOLVER_MOVES) { passed.length++; return; }
  passed.kept++;

  const themes = themesText.split(' ').filter(Boolean);
  const row = { id, fen, moves, rating, themes };
  const band = Math.floor((rating - MIN_RATING) / BAND);
  mixedCells[band].offer(row);
  for (const theme of themes) aimedCells.get(theme)?.[band].offer(row);
}

// ── playing a puzzle through ───────────────────────────────────────────────

const refused = { position: 0, move: 0, lastMove: 0, mate: 0 };

/** The four castling moves as some tools write them: the king onto its own rook. */
const CASTLE_ALIAS = { e1h1: 'e1g1', e1a1: 'e1c1', e8h8: 'e8g8', e8a8: 'e8c8' };

/**
 * Play a row through on this app's board. Returns its moves as the app writes
 * them, or null — and counts why — when it cannot be played or is not what
 * its tags say.
 */
function playThrough(row) {
  if (fenProblem(row.fen)) { refused.position++; return null; }
  const board = new Board(row.fen);
  const out = [];
  for (const written of row.moves.split(' ')) {
    const legal = board.legalMoves();
    let move = legal.find((m) => moveToUci(m) === written);
    if (!move && CASTLE_ALIAS[written] && typeOf(board.squares[nameToSquare(written.slice(0, 2))]) === KING) {
      move = legal.find((m) => moveToUci(m) === CASTLE_ALIAS[written]);
    }
    if (!move) { refused.move++; return null; }
    out.push(moveToUci(move));
    board.make(move);
  }
  // The solver moves second, fourth, sixth: an even count, checked on the way
  // in, means the last move is theirs. Said again here because everything the
  // app does with a puzzle assumes it.
  if (out.length % 2) { refused.lastMove++; return null; }
  const mated = board.inCheck() && !hasLegalReply(board);
  const mateIn = row.themes.map((t) => /^mateIn(\d)$/.exec(t)).find(Boolean);
  if ((row.themes.includes('mate') || mateIn) && !mated) { refused.mate++; return null; }
  if (mateIn && Number(mateIn[1]) !== out.length / 2) { refused.mate++; return null; }
  return out;
}

// ── choosing ───────────────────────────────────────────────────────────────

const chosen = new Map();        // id -> the line that goes in the pack
const tally = { aimed: Object.fromEntries(AIMED.map((t) => [t, 0])), mixed: 0, short: {} };

const turnedDown = new Set();    // ids that did not play through, so each is tried and counted once

/** Keep a row if it is new and plays through. Says whether it was kept. */
function keep(row) {
  if (chosen.has(row.id) || turnedDown.has(row.id)) return false;
  const moves = playThrough(row);
  if (!moves) { turnedDown.add(row.id); return false; }
  const codes = row.themes.map((t) => codeOf.get(t)).filter(Boolean).join('');
  chosen.set(row.id, { id: row.id, rating: row.rating, text: `${row.id}\t${row.rating}\t${codes}\t${row.fen}\t${moves.join(' ')}` });
  return true;
}

/** Take up to `want` rows from the front of a list, and say how many were taken. */
function take(rows, want) {
  let got = 0;
  while (got < want && rows.length) if (keep(rows.shift())) got++;
  return got;
}

function choose() {
  // Each aimed theme's shelf, band by band. What a band cannot supply is asked
  // of the same theme's other bands, nearest first, so a theme that is rare at
  // one level still gets its share of the pack.
  for (const theme of AIMED) {
    const lists = aimedCells.get(theme).map((cell) => cell.shuffled());
    const owed = BANDS.map((_, i) => aimedQuota[i] - take(lists[i], aimedQuota[i]));
    for (let i = 0; i < BANDS.length; i++) {
      for (let step = 1; owed[i] > 0 && step < BANDS.length; step++) {
        for (const j of [i - step, i + step]) {
          if (owed[i] <= 0 || j < 0 || j >= BANDS.length) continue;
          owed[i] -= take(lists[j], owed[i]);
        }
      }
    }
    const missing = owed.reduce((a, b) => a + b, 0);
    tally.aimed[theme] = perTheme - missing;
    if (missing) tally.short[theme] = missing;
  }
  // The mix, band by band, and then whatever is still owed from any band.
  const lists = mixedCells.map((cell) => cell.shuffled());
  for (let i = 0; i < BANDS.length; i++) tally.mixed += take(lists[i], mixedQuota[i]);
  for (let round = 0; chosen.size < SIZE && round < 10000; round++) {
    let any = false;
    for (let i = 0; i < BANDS.length && chosen.size < SIZE; i++) {
      if (take(lists[i], 1)) { tally.mixed++; any = true; }
    }
    if (!any) break;
  }
}

// ── writing ────────────────────────────────────────────────────────────────

function write() {
  const rows = [...chosen.values()].sort((a, b) => a.rating - b.rating || (a.id < b.id ? -1 : 1));
  const head = [
    '# Hard Lines Chess puzzle pack, format 1',
    '# Chosen from the Lichess puzzle database (database.lichess.org), which is released under CC0.',
    '# Made by tools/make-puzzle-pack.mjs. One puzzle a line: id, rating, a letter a theme, position, moves.',
    `# themes ${KEPT.join(' ')}`,
  ];
  const text = head.concat(rows.map((r) => r.text)).join('\n') + '\n';

  // Read back the way the app reads it, so a pack the app would refuse is
  // never written.
  const pack = parsePuzzlePack(text);
  if (pack.count !== rows.length) throw new Error('the pack does not read back whole');

  const themes = {};
  for (const [name, list] of pack.byTheme) if (list.length) themes[name] = list.length;
  const bands = {};
  for (const r of rows) {
    const b = Math.floor(r.rating / BAND) * BAND;
    bands[b] = (bands[b] ?? 0) + 1;
  }
  const bytes = Buffer.byteLength(text);
  const about = {
    format: 1,
    count: rows.length,
    bytes,
    sha256: createHash('sha256').update(text).digest('hex'),
    source: 'Lichess puzzle database, lichess_db_puzzle.csv — database.lichess.org — CC0',
    snapshot: SNAPSHOT,
    ratings: [rows[0].rating, rows[rows.length - 1].rating],
    chosen: { plays: MIN_PLAYS, popularity: MIN_POPULARITY, deviation: MAX_DEVIATION, solverMoves: MAX_SOLVER_MOVES },
    // What the database file held, what passed the thresholds, and what was
    // turned down when it was played through on this app's board — kept with
    // the pack, because a move the app refuses is worth knowing about.
    read: { rows: passed.rows, passed: passed.kept },
    refused: { ...refused },
    short: { ...tally.short },
    aimed: tally.aimed,
    themes,
    bands,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'pack.txt'), text);
  writeFileSync(resolve(OUT, 'pack.json'), JSON.stringify(about, null, 2) + '\n');
  return about;
}

// ── run ────────────────────────────────────────────────────────────────────

const source = input === '-' ? process.stdin : createReadStream(input);
const lines = createInterface({ input: source, crlfDelay: Infinity });
for await (const line of lines) consider(line);

if (!passed.kept) {
  console.error(`No row passed. ${passed.rows} rows read. Is this the Lichess puzzle file?`);
  process.exit(1);
}
choose();
if (!chosen.size) {
  console.error('Rows passed, and none of them could be played through.');
  process.exit(1);
}
const about = write();

const n = (x) => x.toLocaleString('en-GB');
console.log(`${n(passed.rows)} rows read; ${n(passed.kept)} passed the thresholds`);
console.log(`  left out — rating outside ${MIN_RATING}–${MAX_RATING - 1}: ${n(passed.rating)}; rating not settled: ${n(passed.deviation)}; `
  + `not liked enough: ${n(passed.popularity)}; not played enough: ${n(passed.plays)}; too long: ${n(passed.length)}; unreadable: ${n(passed.columns)}`);
console.log(`  refused on the board — position: ${refused.position}; a move that is not legal: ${refused.move}; `
  + `not the solver's last move: ${refused.lastMove}; tagged a mate and is not: ${refused.mate}`);
console.log(`${n(about.count)} puzzles written (${n(about.bytes)} bytes), rated ${about.ratings[0]} to ${about.ratings[1]}`);
for (const theme of AIMED) {
  console.log(`  ${theme.padEnd(18)} ${String(tally.aimed[theme]).padStart(6)} chosen for it, ${String(about.themes[theme] ?? 0).padStart(6)} in the pack`
    + (tally.short[theme] ? `   (${tally.short[theme]} short of its share: the database has too few that pass)` : ''));
}
console.log(`  ${'anything'.padEnd(18)} ${String(tally.mixed).padStart(6)}`);
if (about.count < SIZE) console.log(`THE PACK IS ${n(SIZE - about.count)} SHORT of the ${n(SIZE)} asked for: not enough rows passed.`);
