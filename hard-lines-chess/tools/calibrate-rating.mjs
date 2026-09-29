// ── what a game's mean centipawn loss is worth, in rating points ───────────
//
// MEASURED, NOT INVENTED. Chess.com shows an estimated rating for a reviewed
// game; the temptation is to make one up out of accuracy with a plausible
// constant. Instead: the app's own bands play each other, every game is walked
// by the app's own reviewer at each of its three depth settings, and the mean
// centipawn loss per band is recorded. The mapping is then fitted to that.
//
// WHAT THIS INHERITS, and it has to be said wherever the figure is shown: the
// band labels are TARGETS, not ratings anyone earned. So the output is an
// estimate calibrated against a ladder whose own numbers are aimed rather than
// measured. What it can honestly claim is ORDERING and rough scale.
//
// ONE FIT PER JUDGE. The reviewer can be this app's engine, Stockfish or
// Reckless, and a stronger judge finds more wrong with the same game — so the
// same loss per move is a different rating under each, and each needs its own
// measurement. JUDGE=stockfish or JUDGE=reckless judges the same calibration
// games with that engine and writes its fit under `judges` in the file,
// leaving every other judge's fit as it was.
//
//   node calibrate-rating.mjs 4                     this app's engine, 4 games a level
//   JUDGE=stockfish node calibrate-rating.mjs 4 0,3,6,9   Stockfish, on some levels
//   GAMES_ONLY=1 node calibrate-rating.mjs 4        just play the games, for parallel runs to share
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdtempSync, copyFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const strip = (s) => s.replace(/^export /gm, '').replace(/import \{[\s\S]*?\} from '\.\/core\.js';\n/, '');
const src = strip(readFileSync('../src/engine/core.js', 'utf8')) + '\n' + strip(readFileSync('../src/engine/search.js', 'utf8'))
  + '\n' + readFileSync('../src/engine/bands.js', 'utf8') + '\n' + readFileSync('../src/notation.js', 'utf8')
  + '\n' + readFileSync('../src/pgn.js', 'utf8') + '\n' + readFileSync('../src/motifs.js', 'utf8') + '\n' + readFileSync('../src/review.js', 'utf8')
  + '\n' + readFileSync('../src/stockfish-driver.js', 'utf8');
const ctx = {};
new Function('out', src + '\nout.Board=Board; out.Engine=Engine; out.toSan=toSan; out.BANDS=BANDS; out.WHITE=WHITE; out.parsePgn=parsePgn; out.reviewGame=reviewGame; out.parseStockfishInfo=parseStockfishInfo; out.summariseStockfish=summariseStockfish;')(ctx);
const { Board, Engine, toSan, BANDS, WHITE, parsePgn, reviewGame, parseStockfishInfo, summariseStockfish } = ctx;

const JUDGE = process.env.JUDGE ?? 'app';
if (!['app', 'stockfish', 'reckless'].includes(JUDGE)) throw new Error(`JUDGE must be app, stockfish or reckless, not ${JUDGE}`);

// ── the judges, run here the way the app runs them ──────────────────────────
//
// The same engines the app ships, from the same files: Stockfish from
// vendor/stockfish as a UCI process, Reckless from vendor/reckless's pieces.
// Each answers analyse(fen, {nodes, multipv, moves}) exactly as the page's
// drivers do, cleared before every question, so a loss measured here is the
// loss the app would measure.

function stockfishJudge() {
  // A classic script, and this package is ESM: node would read it as a module
  // and fail, so it runs from a copy in a directory of its own.
  const dir = mkdtempSync(join(tmpdir(), 'hl-stockfish-'));
  for (const f of ['stockfish.js', 'stockfish.wasm']) copyFileSync(`../vendor/stockfish/${f}`, join(dir, f));
  writeFileSync(join(dir, 'package.json'), '{"type":"commonjs"}');
  const proc = spawn('node', [join(dir, 'stockfish.js')]);
  let buffer = '';
  let infos = [];
  let waiting = null;
  proc.stdout.on('data', (d) => {
    buffer += d;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith('info ')) { const info = parseStockfishInfo(line); if (info) infos.push(info); }
      else if (line.startsWith('bestmove') && waiting) {
        const best = line.split(/\s+/)[1];
        const done = waiting;
        waiting = null;
        done(summariseStockfish(best && best !== '(none)' ? best : null, infos));
      }
    }
  });
  const send = (line) => proc.stdin.write(line + '\n');
  send('uci');
  return {
    name: 'stockfish',
    analyse: (fen, { nodes, multipv = 1, moves = [] }) => new Promise((resolve) => {
      infos = [];
      waiting = resolve;
      send('ucinewgame');
      send(`setoption name MultiPV value ${multipv}`);
      send(moves.length ? `position fen ${fen} moves ${moves.join(' ')}` : `position fen ${fen}`);
      send(`go nodes ${nodes}`);
    }),
    close: () => proc.kill(),
  };
}

async function recklessJudge() {
  const manifest = JSON.parse(readFileSync('../vendor/reckless/manifest.json', 'utf8'));
  const wasm = Buffer.alloc(manifest.wasm.bytes);
  let at = 0;
  for (const piece of manifest.pieces) {
    const raw = gunzipSync(readFileSync(`../vendor/reckless/${piece.file}`));
    raw.copy(wasm, at);
    at += raw.length;
  }
  const bindings = await import(pathToFileURL(`../vendor/reckless/${manifest.glue.file}`).href);
  bindings.initSync({ module: wasm });
  const engine = new bindings.Engine();
  engine.set_threads(1);
  return {
    name: 'reckless',
    analyse: async (fen, { nodes, multipv = 1, moves = [] }) => {
      const lines = [];
      engine.reset();
      engine.set_position(fen);
      for (const m of moves) engine.make_move(m);
      engine.go_uci(0, nodes, multipv, (line) => lines.push(String(line)));
      const best = engine.last_bestmove();
      return summariseStockfish(best && best !== '(none)' ? best : null, lines.map(parseStockfishInfo).filter(Boolean));
    },
    close: () => {},
  };
}

/**
 * The same position asked twice, answered once. A game is reviewed from each
 * side in turn and both walks ask about the same positions; the app's engine
 * is fast enough not to care, a judge in another process is not.
 */
function remembering(judge) {
  const seen = new Map();
  return {
    name: judge.name,
    analyse: (fen, o) => {
      const key = `${fen}|${o.nodes}|${o.multipv ?? 1}|${(o.moves ?? []).join(' ')}`;
      if (!seen.has(key)) seen.set(key, judge.analyse(fen, o));
      return seen.get(key);
    },
  };
}

const seeded = (seed) => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

function playGame(bandIndex, seed) {
  Math.random = seeded(seed);
  const band = BANDS[bandIndex];
  const foil = BANDS[bandIndex];          // like against like, so both sides are the band
  const board = new Board();
  const engine = new Engine();
  const sans = [];
  for (let ply = 0; ply < 100 && !board.outcome(); ply++) {
    const b = board.turn === WHITE ? band : foil;
    engine.reset();
    const r = engine.search(board, { nodes: b.nodes, maxDepth: b.depth, blunder: b.blunder });
    if (!r.move) break;
    sans.push(toSan(board, r.move));
    board.make(r.move);
  }
  return sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + s).join(' ');
}

// The three review settings, as the app has them: depth cap and work budget.
// MUST BE THE SAME PAIRS AS REVIEW_BUDGET in app-b.js, or the fit maps a loss
// measured under one budget onto a rating measured under another. Positions
// rather than milliseconds, so this calibration means the same thing when it
// is re-run on another machine — which is the whole reason the app's own
// reviewer counts positions now.
const DEPTHS = [[7, 25000], [9, 80000], [12, 250000]];
// Which bands THIS process measures — so several can run side by side on
// disjoint sets, each appending to its own file, merged by the fit at the end.
const ALL_BANDS = [0, 3, 6, 9, 12, 15, 18, 21];
const BAND_INDEX = process.argv[3] ? process.argv[3].split(',').map(Number) : ALL_BANDS;
const GAMES = Number(process.argv[2] ?? 2);

// RESUMABLE: every finished (band, game) is appended to a JSONL file as it
// completes, and a restart skips the pairs already there. The first run was
// lost an hour in when its process was killed, with nothing written.
const PREFIX = JUDGE === 'app' ? 'rating-rows' : `rating-rows.${JUDGE}`;
const LOG = process.argv[3] ? `${PREFIX}.${process.argv[3].replace(/,/g, '-')}.jsonl` : `${PREFIX}.jsonl`;
const rows = existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const done = new Set(rows.map((r) => `${r.elo}:${r.game}`));

// THE GAMES ARE PLAYED ONCE AND KEPT, so every judge is measured on the same
// games and several runs side by side do not each play them again.
const GAMES_FILE = 'rating-games.jsonl';
const playedGames = new Map(existsSync(GAMES_FILE)
  ? readFileSync(GAMES_FILE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [`${r.bi}:${r.game}`, r.pgn])
  : []);
function gameFor(bi, g) {
  const key = `${bi}:${g}`;
  if (!playedGames.has(key)) {
    const pgn = playGame(bi, 1000 + bi * 17 + g);
    playedGames.set(key, pgn);
    appendFileSync(GAMES_FILE, JSON.stringify({ bi, game: g, elo: BANDS[bi].elo, pgn }) + '\n');
  }
  return playedGames.get(key);
}

const judge = JUDGE === 'stockfish' ? stockfishJudge() : JUDGE === 'reckless' ? await recklessJudge() : null;

for (const bi of BAND_INDEX) {
  const band = BANDS[bi];
  for (let g = 0; g < GAMES; g++) {
    const pgn = gameFor(bi, g);
    if (process.env.GAMES_ONLY) { console.error(`band ${band.elo} game ${g}: played`); continue; }
    if (done.has(`${band.elo}:${g}`)) { console.error(`band ${band.elo} game ${g}: already measured`); continue; }
    const parsed = parsePgn(pgn);
    if (parsed.plies.length < 12) { console.error('short game', bi, g, parsed.plies.length); continue; }
    const fresh = [];
    const asked = judge ? remembering(judge) : null;
    for (const [depth, nodes] of DEPTHS) {
      for (const side of ['white', 'black']) {
        const r = await reviewGame(parsed, side, { nodes, depth, withTactics: false, yieldEvery: 0, judge: asked });
        const meanLoss = Number.isFinite(r.meanLoss) ? r.meanLoss : null;
        fresh.push({ judge: JUDGE, elo: band.elo, game: g, depth, side, plies: parsed.plies.length, counted: r.counted, accuracy: r.accuracy, meanLoss });
        console.error(`${JUDGE}  band ${String(band.elo).padStart(4)}  game ${g}  depth ${depth}  ${side}  acc ${r.accuracy}%  meanLoss ${meanLoss?.toFixed(1)}`);
      }
    }
    for (const row of fresh) { rows.push(row); appendFileSync(LOG, JSON.stringify(row) + '\n'); }
  }
}
judge?.close();
if (process.env.GAMES_ONLY) process.exit(0);

// Fit over every rows file of THIS judge present, so parallel runs are merged
// and no judge's rows are fitted as another's.
const mine = JUDGE === 'app'
  ? (f) => /^rating-rows(\.[0-9-]+)?\.jsonl$/.test(f)
  : (f) => new RegExp(`^rating-rows\\.${JUDGE}(\\.[0-9-]+)?\\.jsonl$`).test(f);
const merged = [];
for (const f of readdirSync('.')) if (mine(f)) for (const l of readFileSync(f, 'utf8').trim().split('\n')) if (l) merged.push(JSON.parse(l));
rows.length = 0; rows.push(...merged);
console.error(`fitting ${JUDGE} over ${rows.length} rows`);

/**
 * WHERE THE SCALE STOPS SEPARATING, per setting — and it stops for two
 * different reasons, so both are looked for and the lower one wins.
 *
 *   IT RUNS OUT OF ROOM. A level playing the reviewer's own moves scores near
 *   zero loss, so from some strength upward every level looks the same.
 *
 *   IT TURNS AROUND. Past the reviewer's own playing strength the measurement
 *   inverts: the reviewer disagrees with moves better than its own and scores
 *   them as losses, so a STRONGER level measures as a WORSE one. Measured at
 *   the Quick setting: levels 0 to 1500 fall 112, 54, 37, 22, 6.6, 5.7 — and
 *   then 1800 comes back 9.0 and 2100 comes back 16.9, which is roughly what
 *   level 1000 loses. Nothing in the old rule noticed this, because it only
 *   asked whether the losses were small, and 16.9 is not small.
 *
 * Above the ceiling the page says "or above" rather than a number, and the fit
 * below is made only over the levels underneath it — a line drawn through
 * points the reviewer has just been shown it cannot measure is a worse line
 * everywhere, including where it can.
 */
const NOISE = 15;
const bandsSeen = [...new Set(rows.map((r) => r.elo))].sort((a, b) => a - b);
const meanLossAt = (depth, elo) => {
  const xs = rows.filter((r) => r.depth === depth && r.elo === elo && r.meanLoss !== null).map((r) => r.meanLoss);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};
const ceilings = {};
const losses = {};
for (const [depth] of DEPTHS) {
  const means = Object.fromEntries(bandsSeen.map((b) => [b, meanLossAt(depth, b)]));
  losses[depth] = Object.fromEntries(bandsSeen.map((b) => [b, means[b] === null ? null : Math.round(means[b] * 10) / 10]));

  // Where the losses bottom out: the level that measured the least. Every
  // level above it measured at least as badly, so a loss lower than its is
  // off the end of what was measured. On a tie the lower level is taken, so a
  // tie counts against the scale rather than for it.
  //
  // NOT THE FIRST RISE, which is what this used to be. Four games a level
  // leave a level's mean uncertain by three to six points, and "any rise at
  // all" fired on noise: Reckless measured 31.0 at 600 and 32.1 at 900, a
  // rise of one point inside the noise of either, and its scale was cut off
  // at 600 although 1500, 1800 and 2100 all measured well under both. The
  // turn this rule is here for (this app's engine at Quick: 5.7, then 9.0,
  // then 16.9 above 1500) is a rise that keeps going, and the lowest point
  // finds it just the same: for this app's engine and for Stockfish the two
  // rules give the same ceilings, measured.
  let turned = null;
  for (const b of bandsSeen) if (means[b] !== null && (turned === null || means[b] < means[turned])) turned = b;
  turned ??= bandsSeen[bandsSeen.length - 1];

  // Under the noise: the lowest level from which everything above it is flat.
  let flat = bandsSeen[bandsSeen.length - 1];
  for (const b of bandsSeen) {
    if (bandsSeen.filter((h) => h >= b).every((h) => means[h] !== null && means[h] <= NOISE)) { flat = b; break; }
  }

  ceilings[depth] = Math.min(turned, flat);
}

// AND A SETTING CANNOT SEE FURTHER THAN ONE THAT DOES MORE WORK. Measured
// here, Quick came out separating to 1500 and Deep only to 1200 — which cannot
// be true of the same reviewer given three times the positions, and comes from
// the two rules above firing for different reasons on a sample of four games a
// level. A weaker look reaching higher up the scale is a sign the sample moved,
// not that the weaker look is better, so each setting is held to the reach of
// the ones above it.
const byWork = DEPTHS.map(([depth]) => depth);
for (let i = byWork.length - 2; i >= 0; i--) {
  ceilings[byWork[i]] = Math.min(ceilings[byWork[i]], ceilings[byWork[i + 1]]);
}
console.error('\n== ceilings ==');
for (const [d, c] of Object.entries(ceilings)) console.error(`depth ${d}: separates up to ${c}; above that the page says "or above"`);

// Fit ln(meanLoss) = m*elo + c per depth, least squares, over the levels the
// setting can actually tell apart.
const fits = {};
for (const [depth] of DEPTHS) {
  const pts = rows.filter((r) => r.depth === depth && r.meanLoss > 0 && r.elo <= ceilings[depth])
    .map((r) => ({ x: r.elo, y: Math.log(r.meanLoss) }));
  const n = pts.length;
  const sx = pts.reduce((a, p) => a + p.x, 0), sy = pts.reduce((a, p) => a + p.y, 0);
  const sxx = pts.reduce((a, p) => a + p.x * p.x, 0), sxy = pts.reduce((a, p) => a + p.x * p.y, 0);
  const m = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const c = (sy - m * sx) / n;
  const my = sy / n;
  const ssTot = pts.reduce((a, p) => a + (p.y - my) ** 2, 0);
  const ssRes = pts.reduce((a, p) => a + (p.y - (m * p.x + c)) ** 2, 0);
  fits[depth] = { m, c, r2: 1 - ssRes / ssTot, points: n };
}

// THE BUDGETS GO IN THE FILE, so the app can be held to them.
//
// A fit maps a loss onto a rating, and a loss only means anything alongside
// the amount of work that measured it. Nothing connected REVIEW_BUDGET in the
// app to the budgets used here, so the two could drift apart — silently, and
// in the one direction nobody would notice, because a rating that is wrong by
// a bit still looks like a rating. Written out here and checked by
// tests/repeatable.test.mjs.
const budgets = Object.fromEntries(DEPTHS.map(([depth, nodes]) => [depth, nodes]));
const measured = { measured: new Date().toISOString().slice(0, 10), games: GAMES, budgets, ceilings, losses, rows, fits };
// Another judge's fit is written beside this app's engine's and never over it:
// the file is read back, the one entry replaced, and everything else kept.
const previous = existsSync('rating-calibration.json') ? JSON.parse(readFileSync('rating-calibration.json', 'utf8')) : {};
const out = JUDGE === 'app'
  ? { ...measured, judges: previous.judges ?? {} }
  : { ...previous, judges: { ...(previous.judges ?? {}), [JUDGE]: measured } };
writeFileSync('rating-calibration.json', JSON.stringify(out, null, 2));
console.error('\n== fits ==');
for (const [d, f] of Object.entries(fits)) console.error(`depth ${d}: elo = (ln(loss) - ${f.c.toFixed(4)}) / ${f.m.toExponential(4)}   R2=${f.r2.toFixed(3)}  n=${f.points}`);
