// The puzzle pack: the tool that makes it, and the pack itself when there is one.
//
// THE TOOL IS RUN FOR REAL, on a file in the layout the Lichess puzzle
// database has — ten columns, the themes in one of them, the moves in another
// — and what it writes is read back the way the app reads it. The file is
// made here rather than downloaded: six positions that are what their tags
// say, repeated under different ids and ratings, and one row each of every
// kind the tool has to turn down. A row that should have been refused and was
// kept is a puzzle the app would put in front of somebody and then be unable
// to play.
//
// AND THE PACK THAT SHIPS, if vendor/puzzles has one, is held to its own
// description — the size and the hash the build also checks — and one row in
// every ten is set up and played through on the app's board.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const src = ['src/engine/bundle.js', 'src/notation.js', 'src/pgn.js', 'src/weak-spots.js']
  .map((f) => readFileSync(join(root, f), 'utf8')).join('\n');
const S = new Function('window', 'localStorage', src
  + '; return { WEAK_AIMS, parsePuzzlePack, readPackRow, openPackPuzzle, packRowId };')({}, undefined);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL', name, extra); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ── a file in the database's layout ───────────────────────────────────────
const BASE = [
  ['rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2', 'g2g4 d8h4', 'mate mateIn1 oneMove opening'],
  ['r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3', 'g8f6 h5f7', 'attackingF2F7 mate mateIn1 oneMove opening'],
  ['rn1qkbnr/ppp2p1p/3p2p1/4N3/2B1P1b1/2N5/PPPP1PPP/R1BQK2R b KQkq - 0 5', 'g4d1 c4f7 e8e7 c3d5', 'mate mateIn2 opening sacrifice short'],
  ['r3k3/p7/8/3N4/8/8/8/4K3 b - - 0 1', 'a7a6 d5c7 e8e7 c7a8', 'crushing endgame fork short'],
  ['r5k1/5ppp/8/8/8/8/5PPP/1R4K1 b - - 0 1', 'a8a2 b1b8', 'backRankMate endgame mate mateIn1 oneMove'],
  ['4k3/8/8/8/3q4/8/8/3RK3 b - - 0 1', 'e8e7 d1d4', 'crushing endgame hangingPiece oneMove'],
];
let seed = 7;
const rng = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const line = (id, fen, moves, rating, deviation, popularity, plays, themes) =>
  [id, fen, moves, rating, deviation, popularity, plays, themes, 'https://lichess.org/abcdefgh#20', ''].join(',');

const rows = ['PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags'];
const GOOD = 600;
for (let i = 0; i < GOOD; i++) {
  const [fen, moves, themes] = BASE[i % BASE.length];
  rows.push(line('t' + String(i).padStart(4, '0'), fen, moves, 400 + Math.floor(rng() * 1900), 75, 92, 1500, themes));
}
const F = BASE[0][0];
// Left out before they are looked at, each for one reason.
rows.push(line('few00', F, 'g2g4 d8h4', 1000, 75, 92, 100, 'mate mateIn1'));          // not played enough
rows.push(line('dis00', F, 'g2g4 d8h4', 1000, 75, 40, 5000, 'mate mateIn1'));         // not liked
rows.push(line('uns00', F, 'g2g4 d8h4', 1000, 300, 92, 5000, 'mate mateIn1'));        // rating not settled
rows.push(line('hig00', F, 'g2g4 d8h4', 2600, 75, 92, 5000, 'mate mateIn1'));         // rated above the pack
rows.push(line('low00', F, 'g2g4 d8h4', 399, 75, 92, 5000, 'mate mateIn1'));          // and below it
rows.push(line('odd00', F, 'g2g4 d8h4 a2a3', 1000, 75, 92, 5000, 'fork'));            // ends on the other side's move
rows.push(line('lon00', BASE[3][0], 'a7a6 d5c7 e8e7 c7a8 e7d7 a8b6 d7c6 b6c4 c6c5 c4e3', 1000, 75, 92, 5000, 'fork veryLong'));  // five moves to find
rows.push('short,row');                                                                 // not a row at all
// Turned down on the board.
rows.push(line('nom00', F, 'g2g4 d8g5', 1000, 75, 92, 5000, 'mate mateIn1'));         // tagged a mate, and is not
rows.push(line('mis00', BASE[2][0], BASE[2][1], 1000, 75, 92, 5000, 'mate mateIn3')); // a mate in two tagged as three
rows.push(line('ill00', F, 'g2g4 d8h5', 1000, 75, 92, 5000, 'fork'));                 // a move that is not legal
rows.push(line('kin00', '8/8/8/8/8/8/8/8 w - - 0 1', 'g2g4 d8h4', 1000, 75, 92, 5000, 'fork'));  // no kings
// And one that is fine once its castling is read: the king written onto its own rook.
rows.push(line('cas00', 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1', 'e1h1 e8a8', 1000, 75, 92, 5000, 'castling'));

const work = mkdtempSync(join(tmpdir(), 'puzzle-pack-'));
const csv = join(work, 'sample.csv');
writeFileSync(csv, rows.join('\n') + '\n');

const make = (out, ...more) => execFileSync(process.execPath,
  [join(root, 'tools/make-puzzle-pack.mjs'), csv, '--out', join(work, out), ...more], { encoding: 'utf8' });
const packIn = (out) => {
  const text = readFileSync(join(work, out, 'pack.txt'), 'utf8');
  return { text, pack: S.parsePuzzlePack(text), about: JSON.parse(readFileSync(join(work, out, 'pack.json'), 'utf8')) };
};

try {
  // ── asked for more than there is: every row is tried ────────────────────
  const said = make('all', '--size', '5000', '--snapshot', '2026-01-01');
  const all = packIn('all');
  const ids = all.pack.rows.map(S.packRowId);

  same('every row that is what it says is kept, and the castling one with them', all.pack.count, GOOD + 1);
  ok('none of the rows that had to be left out is in it',
    !ids.some((id) => /^(few|dis|uns|hig|low|odd|lon|nom|mis|ill|kin)00$/.test(id)), ids.filter((id) => !/^t\d{4}$/.test(id)).join(' '));
  ok('it says how many it left out, and why',
    /rating outside 400–2299: 2; rating not settled: 1; not liked enough: 1; not played enough: 1; too long: 2; unreadable: 1/.test(said), said);
  ok('and how many it turned down on the board, each counted once',
    /position: 1; a move that is not legal: 1; not the solver's last move: 0; tagged a mate and is not: 2/.test(said), said);
  ok('it says the pack came out short of what was asked', /THE PACK IS 4,399 SHORT/.test(said), said);

  const castled = S.readPackRow(all.pack.rows[ids.indexOf('cas00')], all.pack.themes);
  same('castling written as king-onto-rook is stored the way the app writes it', castled.moves, ['e1g1', 'e8c8']);
  ok('and plays on the app\'s board', S.openPackPuzzle(castled) !== null);

  ok('every puzzle kept sets up and plays through on the app\'s board',
    all.pack.rows.every((r) => S.openPackPuzzle(S.readPackRow(r, all.pack.themes)) !== null));
  ok('the rows are in order of rating', all.pack.rows.every((r, i) => i === 0 || all.pack.rating[i] >= all.pack.rating[i - 1]));
  ok('no puzzle is in it twice', new Set(ids).size === ids.length);
  ok('themes the app has no use for are left behind',
    !all.pack.themes.includes('oneMove') && !all.pack.themes.includes('crushing') && !all.pack.themes.includes('short'));
  ok('and every theme a mistake can be aimed at is one the pack can carry',
    [...new Set(Object.values(S.WEAK_AIMS).flat())].every((t) => all.pack.themes.includes(t)));
  same('a row keeps the themes that are kept',
    S.readPackRow(all.pack.rows[ids.indexOf('t0001')], all.pack.themes).themes.sort(), ['attackingF2F7', 'mate', 'mateIn1', 'opening']);

  same('the description is of this pack: how many, how big, and its hash',
    [all.about.count, all.about.bytes, all.about.sha256],
    [all.pack.count, Buffer.byteLength(all.text), createHash('sha256').update(all.text).digest('hex')]);
  same('and says where it came from and of what date', [all.about.format, /Lichess/.test(all.about.source), all.about.snapshot], [1, true, '2026-01-01']);
  same('and what was read, what passed, and what was turned down on the board',
    [all.about.read, all.about.refused], [{ rows: 613, passed: 605 }, { position: 1, move: 1, lastMove: 0, mate: 2 }]);

  // ── asked for fewer: a share for each theme, and the rest a mix ─────────
  make('few', '--size', '200');
  const few = packIn('few');
  same('asked for 200, it writes 200', few.pack.count, 200);
  // 200 × 0.66 / 11 themes = 12 each, for the themes the file has any of.
  same('each theme that can be aimed at gets the same share, where the file has it',
    ['hangingPiece', 'fork', 'backRankMate', 'mateIn1', 'mateIn2'].map((t) => few.about.aimed[t]), [12, 12, 12, 12, 12]);
  same('and a theme the file has none of gets none', [few.about.aimed.pin, few.about.aimed.skewer], [0, 0]);
  ok('the shelf of each is at least its share', ['hangingPiece', 'fork', 'backRankMate', 'mateIn1', 'mateIn2'].every((t) => few.pack.byTheme.get(t).length >= 12));
  ok('it is spread over the ratings, not taken from one end',
    few.pack.rating[0] < 700 && few.pack.rating[few.pack.count - 1] > 2000, `${few.pack.rating[0]}..${few.pack.rating[few.pack.count - 1]}`);

  // ── the same file gives the same pack ───────────────────────────────────
  make('again', '--size', '200');
  same('made twice from one file, it is the same pack', packIn('again').about.sha256, few.about.sha256);

  // ── a file that is not the database says so ─────────────────────────────
  writeFileSync(join(work, 'not.csv'), 'this,is,not\nthe,puzzle,file\n');
  let refused = null;
  try {
    execFileSync(process.execPath, [join(root, 'tools/make-puzzle-pack.mjs'), join(work, 'not.csv'), '--out', join(work, 'not')], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) { refused = String(e.stderr); }
  ok('a file with no puzzles in it writes nothing and says so', refused !== null && /No row passed/.test(refused) && !existsSync(join(work, 'not', 'pack.txt')), refused);
} finally {
  rmSync(work, { recursive: true, force: true });
}

// ── the pack that ships ───────────────────────────────────────────────────
const shipped = join(root, 'vendor/puzzles/pack.txt');
if (existsSync(shipped)) {
  const text = readFileSync(shipped, 'utf8');
  const about = JSON.parse(readFileSync(join(root, 'vendor/puzzles/pack.json'), 'utf8'));
  const pack = S.parsePuzzlePack(text);
  same('the pack that ships is the one its description is of',
    [pack.count, Buffer.byteLength(text), createHash('sha256').update(text).digest('hex')], [about.count, about.bytes, about.sha256]);
  let broken = 0, looked = 0;
  for (let i = 0; i < pack.count; i += 10) {
    looked++;
    if (!S.openPackPuzzle(S.readPackRow(pack.rows[i], pack.themes))) broken++;
  }
  ok(`one in ten of its puzzles (${looked}) sets up and plays through`, broken === 0, `${broken} did not`);
  for (const theme of new Set(Object.values(S.WEAK_AIMS).flat())) {
    ok(`it has a shelf of ${theme}`, (pack.byTheme.get(theme)?.length ?? 0) >= 500, `${pack.byTheme.get(theme)?.length ?? 0}`);
  }
  console.log(`puzzle pack: the shipped pack has ${pack.count} puzzles`);
} else {
  console.log('puzzle pack: vendor/puzzles has no pack yet, so only the tool was checked');
}

console.log(`puzzle pack: ${pass} checks passed${fail ? `, ${fail} FAILED` : ''}`);
if (fail) process.exit(1);
