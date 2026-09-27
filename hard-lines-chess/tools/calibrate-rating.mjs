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
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';

const strip = (s) => s.replace(/^export /gm, '').replace(/import \{[\s\S]*?\} from '\.\/core\.js';\n/, '');
const src = strip(readFileSync('../src/engine/core.js', 'utf8')) + '\n' + strip(readFileSync('../src/engine/search.js', 'utf8'))
  + '\n' + readFileSync('../src/engine/bands.js', 'utf8') + '\n' + readFileSync('../src/notation.js', 'utf8')
  + '\n' + readFileSync('../src/pgn.js', 'utf8') + '\n' + readFileSync('../src/motifs.js', 'utf8') + '\n' + readFileSync('../src/review.js', 'utf8');
const ctx = {};
new Function('out', src + '\nout.Board=Board; out.Engine=Engine; out.toSan=toSan; out.BANDS=BANDS; out.WHITE=WHITE; out.parsePgn=parsePgn; out.reviewGame=reviewGame;')(ctx);
const { Board, Engine, toSan, BANDS, WHITE, parsePgn, reviewGame } = ctx;

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
const LOG = process.argv[3] ? `rating-rows.${process.argv[3].replace(/,/g, '-')}.jsonl` : 'rating-rows.jsonl';
const rows = existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const done = new Set(rows.map((r) => `${r.elo}:${r.game}`));

for (const bi of BAND_INDEX) {
  const band = BANDS[bi];
  for (let g = 0; g < GAMES; g++) {
    if (done.has(`${band.elo}:${g}`)) { console.error(`band ${band.elo} game ${g}: already measured`); continue; }
    const pgn = playGame(bi, 1000 + bi * 17 + g);
    const parsed = parsePgn(pgn);
    if (parsed.plies.length < 12) { console.error('short game', bi, g, parsed.plies.length); continue; }
    const fresh = [];
    for (const [depth, nodes] of DEPTHS) {
      for (const side of ['white', 'black']) {
        const r = await reviewGame(parsed, side, { nodes, depth, withTactics: false, yieldEvery: 0 });
        const meanLoss = Number.isFinite(r.meanLoss) ? r.meanLoss : null;
        fresh.push({ elo: band.elo, game: g, depth, side, plies: parsed.plies.length, counted: r.counted, accuracy: r.accuracy, meanLoss });
        console.error(`band ${String(band.elo).padStart(4)}  game ${g}  depth ${depth}  ${side}  acc ${r.accuracy}%  meanLoss ${meanLoss?.toFixed(1)}`);
      }
    }
    for (const row of fresh) { rows.push(row); appendFileSync(LOG, JSON.stringify(row) + '\n'); }
  }
}

// Fit over every rows file present, so parallel runs are merged.
import { readdirSync } from 'node:fs';
const merged = [];
for (const f of readdirSync('.')) if (/^rating-rows.*\.jsonl$/.test(f)) for (const l of readFileSync(f, 'utf8').trim().split('\n')) if (l) merged.push(JSON.parse(l));
rows.length = 0; rows.push(...merged);
console.error(`fitting over ${rows.length} rows from every rating-rows*.jsonl`);

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

  // Still falling: the last level reached before the losses stop going down.
  let turned = bandsSeen[bandsSeen.length - 1];
  for (let i = 1; i < bandsSeen.length; i++) {
    const prev = means[bandsSeen[i - 1]], cur = means[bandsSeen[i]];
    if (prev === null || cur === null) continue;
    if (cur >= prev) { turned = bandsSeen[i - 1]; break; }
  }

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
writeFileSync('rating-calibration.json', JSON.stringify({
  measured: new Date().toISOString().slice(0, 10), games: GAMES, budgets, ceilings, losses, rows, fits,
}, null, 2));
console.error('\n== fits ==');
for (const [d, f] of Object.entries(fits)) console.error(`depth ${d}: elo = (ln(loss) - ${f.c.toFixed(4)}) / ${f.m.toExponential(4)}   R2=${f.r2.toFixed(3)}  n=${f.points}`);
