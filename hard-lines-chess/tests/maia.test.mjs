// The human-like opponent: reading a network, running it, showing it a game,
// and reading its answer back as a move.
//
// THE FAULT WORTH CATCHING IS THE QUIET ONE. A network shown a position the
// wrong way round does not fail. It answers, with a legal move, every time —
// a worse one. Nothing on the screen says so; the opponent is simply not the
// player on the label. So nothing here is allowed to rest on "it plays
// chess":
//
//   - the sums are held to the same sums done the plain way, on made-up
//     networks small enough to do them by hand;
//   - which number belongs to which move is held to the Leela engine's own
//     table of all 1,858 moves (tests/fixtures/lc0-policy.json);
//   - how a game is drawn is held to Leela's rules, case by case — whose
//     pieces come first, which way up, what stands in for history there is
//     none of;
//   - and then the real networks are asked things people are known to do: the
//     first move, a mate in one a beginner misses and a club player does not,
//     and whether what they say is about moves that can be played at all.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const read = (path) => readFileSync(new URL(path, import.meta.url));
const src = ['../src/engine/bundle.js', '../src/notation.js', '../src/pgn.js', '../src/maia-net.js', '../src/maia.js']
  .map((f) => read(f).toString('utf8')).join('\n');
const S = new Function('window', 'localStorage', src
  + '; return { Board, parsePgn, sanToMove, toSan, moveToUci, mkMove, nameToSquare, KNIGHT, BISHOP, ROOK, QUEEN, FLAG_CASTLE,'
  + ' MAIA_INPUT_PLANES, MAIA_MOVE_KINDS, MAIA_LEAST, maiaUnpack, maiaReadNet, maiaForward, maiaSquares, maiaPlanes, maiaSlot, maiaChances, maiaChoose };')({}, undefined);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL', name, extra); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const refused = (name, bytes, saying) => {
  let said = null;
  try { S.maiaReadNet(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); } catch (e) { said = e.message; }
  ok(name, said !== null && said.includes(saying), `said ${JSON.stringify(said)}, wanted something with ${JSON.stringify(saying)}`);
};

// A seeded source of numbers, so a failure is the same failure every time.
const rng = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

// ── a network file, written here ──────────────────────────────────────────
//
// The format is fields: a number saying which field and what shape, then the
// value. Writing one here means the reader is tested on files whose every
// number is known, and on files that are wrong in one known way.
const varint = (n) => { const out = []; while (n > 127) { out.push((n % 128) + 128); n = Math.floor(n / 128); } out.push(n); return out; };
const field = (no, shape, bytes) => [...varint(no * 8 + shape), ...(shape === 2 ? varint(bytes.length) : []), ...bytes];
const number = (no, n) => field(no, 0, varint(n));
const float = (x) => [...new Uint8Array(new Float32Array([x]).buffer)];
/**
 * A layer: numbers squeezed into sixteen bits between a lowest and a highest.
 * Comes back with the bytes, and with the numbers as they will be read — which
 * are the squeezed ones, not the ones asked for.
 */
const layer = (values) => {
  const min = Math.fround(Math.min(...values)), max = Math.fround(Math.max(...values));
  const span = max - min || 1;
  const squeezed = values.map((v) => Math.max(0, Math.min(65535, Math.round(((v - min) / span) * 65535))));
  const packed = [];
  for (const u of squeezed) packed.push(u % 256, Math.floor(u / 256));
  const top = max === min ? min + 1 : max;
  const range = (Math.fround(top) - min) / 65535;
  return {
    bytes: [...field(1, 5, float(min)), ...field(2, 5, float(top)), ...field(3, 2, packed)],
    read: squeezed.map((u) => Math.fround(u * range + min)),
  };
};
/** A convolution as the file holds it; `norm` adds the normalising that training left beside it. */
const convBlock = (random, outs, ins, { norm = true, bias = !norm } = {}) => {
  const some = (n, lo, hi) => Array.from({ length: n }, () => lo + random() * (hi - lo));
  const parts = { w: layer(some(outs * ins * 9, -0.5, 0.5)) };
  if (bias) parts.b = layer(some(outs, -0.3, 0.3));
  if (norm) {
    parts.means = layer(some(outs, -0.4, 0.4));
    parts.vars = layer(some(outs, 0.2, 1.5));
    parts.gammas = layer(some(outs, 0.5, 1.5));
    parts.betas = layer(some(outs, -0.3, 0.3));
  }
  const no = { w: 1, b: 2, means: 3, vars: 4, gammas: 5, betas: 6 };
  return { bytes: Object.entries(parts).flatMap(([name, l]) => field(no[name], 2, l.bytes)), parts, outs, ins };
};
/** A whole made-up network: `filters` wide, `blocks` deep, answering with `kinds` kinds of move. */
const makeNet = (seed, { filters = 3, blocks = 2, mid = 2, kinds = 80, said = { 1: 1, 2: 2, 3: 4, 4: 2, 5: 2 }, leave = [], addToo = false, oddBlock = false } = {}) => {
  const random = rng(seed);
  const some = (n, lo, hi) => Array.from({ length: n }, () => lo + random() * (hi - lo));
  // `addToo`: every layer has something added to it AND is normalised, which
  // the real files do not do and the format allows.
  const how = { bias: addToo };
  const net = { filters, mid, kinds, input: convBlock(random, filters, 112, how), residual: [] };
  for (let i = 0; i < blocks; i++) {
    const se = { w1: layer(some(mid * filters + (oddBlock ? 1 : 0), -0.5, 0.5)), b1: layer(some(mid, -0.2, 0.2)), w2: layer(some(2 * filters * mid, -0.5, 0.5)), b2: layer(some(2 * filters, -0.2, 0.2)) };
    net.residual.push({ conv1: convBlock(random, filters, filters, how), conv2: convBlock(random, filters, filters, how), se });
  }
  net.policy1 = convBlock(random, filters, filters, how);
  net.policy = convBlock(random, kinds, filters, { norm: false });
  const weights = [
    ...(leave.includes('input') ? [] : field(1, 2, net.input.bytes)),
    ...net.residual.flatMap((r) => field(2, 2, [
      ...field(1, 2, r.conv1.bytes), ...field(2, 2, r.conv2.bytes),
      ...(leave.includes('se') ? [] : field(3, 2, [...field(1, 2, r.se.w1.bytes), ...field(2, 2, r.se.b1.bytes), ...field(3, 2, r.se.w2.bytes), ...field(4, 2, r.se.b2.bytes)])),
    ])),
    ...(leave.includes('policy1') ? [] : field(11, 2, net.policy1.bytes)),
    ...(leave.includes('policy') ? [] : field(3, 2, net.policy.bytes)),
    // The other ending, which guesses who will win. It is in every real file and is walked past.
    ...field(6, 2, convBlock(random, 2, filters).bytes), ...field(7, 2, layer(some(8, -1, 1)).bytes),
  ];
  const format = field(4, 2, [...number(1, 1), ...field(2, 2, Object.entries(said).flatMap(([no, v]) => number(Number(no), v)))]);
  net.bytes = new Uint8Array([...field(1, 5, [0xc0, 0x01, 0, 0]), ...field(3, 2, [...number(1, 0), ...number(2, 21)]), ...format, ...field(10, 2, weights)]);
  return net;
};

// ── the sums, done the plain way ──────────────────────────────────────────
//
// Nothing clever: every square, every neighbour, asked whether it is on the
// board. Slow, and obviously what a convolution is.
const fold = (c) => {
  const { w, b, means, vars, gammas, betas } = Object.fromEntries(Object.entries(c.parts).map(([k, l]) => [k, l.read]));
  const weights = Float64Array.from(w), bias = new Float64Array(c.outs);
  for (let o = 0; o < c.outs; o++) {
    if (!means) { bias[o] = b[o]; continue; }
    const g = gammas[o] / Math.sqrt(vars[o] + 1e-5);
    for (let i = o * c.ins * 9; i < (o + 1) * c.ins * 9; i++) weights[i] *= g;
    bias[o] = -g * (means[o] - (b ? b[o] : 0)) + betas[o];
  }
  return { weights, bias, outs: c.outs, ins: c.ins };
};
const plainConv = (x, c) => {
  const out = new Float64Array(c.outs * 64);
  for (let o = 0; o < c.outs; o++) for (let y = 0; y < 8; y++) for (let f = 0; f < 8; f++) {
    let sum = 0;
    for (let i = 0; i < c.ins; i++) for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) {
      const yy = y + ky - 1, ff = f + kx - 1;
      if (yy < 0 || yy > 7 || ff < 0 || ff > 7) continue;
      sum += c.weights[((o * c.ins + i) * 3 + ky) * 3 + kx] * x[i * 64 + yy * 8 + ff];
    }
    out[o * 64 + y * 8 + f] = sum + c.bias[o];
  }
  return out;
};
const relu = (x) => x.map((v) => Math.max(0, v));
const plainForward = (net, planes) => {
  const C = net.filters;
  let a = relu(plainConv(planes, fold(net.input)));
  for (const r of net.residual) {
    const t = relu(plainConv(a, fold(r.conv1)));
    const u = plainConv(t, fold(r.conv2));
    const pooled = Array.from({ length: C }, (_, o) => u.subarray(o * 64, o * 64 + 64).reduce((s, v) => s + v, 0) / 64);
    const [w1, b1, w2, b2] = [r.se.w1.read, r.se.b1.read, r.se.w2.read, r.se.b2.read];
    const squeezed = Array.from({ length: net.mid }, (_, m) => Math.max(0, b1[m] + pooled.reduce((s, v, o) => s + w1[m * C + o] * v, 0)));
    const full = Array.from({ length: 2 * C }, (_, k) => b2[k] + squeezed.reduce((s, v, m) => s + w2[k * net.mid + m] * v, 0));
    const next = new Float64Array(C * 64);
    for (let o = 0; o < C; o++) {
      const gate = 1 / (1 + Math.exp(-full[o]));
      for (let i = 0; i < 64; i++) next[o * 64 + i] = Math.max(0, gate * u[o * 64 + i] + full[o + C] + a[o * 64 + i]);
    }
    a = next;
  }
  return plainConv(relu(plainConv(a, fold(net.policy1))), fold(net.policy)).subarray(0, 73 * 64);
};
const farthest = (a, b) => { let worst = Math.abs(a.length - b.length) ? Infinity : 0; for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i])); return worst; };
const somePlanes = (seed) => {
  const random = rng(seed);
  const planes = new Float32Array(112 * 64);
  for (let i = 0; i < planes.length; i++) planes[i] = random() < 0.15 ? 1 : 0;
  planes.fill(17, 109 * 64, 110 * 64);
  return planes;
};

// ── 1. reading a file ─────────────────────────────────────────────────────
{
  const made = makeNet(11);
  const net = S.maiaReadNet(made.bytes);
  same('a network is read as it was written: how wide, how deep', [net.filters, net.residual.length, net.policy.outs, net.residual[0].se.mid], [3, 2, 80, 2]);
  // The last layer has no normalising to fold in, so its numbers are the file's numbers exactly.
  ok('a layer\'s numbers are unsqueezed exactly: lowest, plus so many steps of the range over 65,535',
    net.policy.w.length === made.policy.parts.w.read.length && net.policy.w.every((v, i) => v === made.policy.parts.w.read[i]),
    `first differs at ${net.policy.w.findIndex((v, i) => v !== made.policy.parts.w.read[i])}`);
  ok('and so are what is added to them', net.policy.b.every((v, i) => v === made.policy.parts.b.read[i]));
  // A layer that was normalised has the normalising folded in.
  const folded = fold(made.input);
  ok('the normalising after a layer is folded into the layer', farthest(net.input.w, folded.weights) < 1e-6 && farthest(net.input.b, folded.bias) < 1e-6,
    `${farthest(net.input.w, folded.weights)} ${farthest(net.input.b, folded.bias)}`);
  ok('a network with exactly the 73 kinds of move is read', S.maiaReadNet(makeNet(12, { kinds: 73 }).bytes).policy.outs === 73);

  refused('nothing at all is not a network', [], 'no weights');
  refused('a file of noise is not a network', Array.from({ length: 400 }, (_, i) => (i * 37 + 11) % 256), 'not a network this app can run');
  refused('half a network is not a network', made.bytes.subarray(0, made.bytes.length >> 1), 'not a network this app can run');
  refused('a network shown the position another way is refused, and says which', makeNet(13, { said: { 1: 3, 3: 4, 4: 2 } }).bytes, 'shown the position in a way (3)');
  refused('a network built another way is refused', makeNet(13, { said: { 1: 1, 3: 6, 4: 2 } }).bytes, 'built in a way (6)');
  refused('a network that answers another way is refused', makeNet(13, { said: { 1: 1, 3: 4, 4: 1 } }).bytes, 'answers with its moves in a way (1)');
  // Cut short in the two ways a file can be: in the middle of a number, and
  // in the middle of a run of bytes whose length was written before it.
  refused('a file that stops in the middle of a number says so', [0x08, 0x80], 'ends in the middle of a number');
  refused('a file that stops before the end of what it said was coming says so', [...varint(10 * 8 + 2), ...varint(1000), 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'a field runs past the end');
  refused('a network with no first layer is refused', makeNet(14, { leave: ['input'] }).bytes, 'first layer is missing');
  refused('a network with no blocks at all is refused', makeNet(14, { blocks: 0 }).bytes, 'it has no blocks');
  refused('a network with a block missing a part is refused', makeNet(14, { leave: ['se'] }).bytes, 'a block is missing a part');
  refused('a network with a block of the wrong size is refused', makeNet(14, { oddBlock: true }).bytes, 'a block is the wrong size');
  refused('a network with no ending is refused', makeNet(14, { leave: ['policy'] }).bytes, 'lead to its moves are missing');
  refused('and so is one missing the layer before it', makeNet(14, { leave: ['policy1'] }).bytes, 'lead to its moves are missing');
  refused('a network that answers with too few kinds of move is refused', makeNet(15, { kinds: 72 }).bytes, 'too few kinds of move');
  {
    // The first layer made for 111 grids instead of 112: every other number in the file is right.
    const short = makeNet(16);
    const random = rng(99);
    const wrong = convBlock(random, 3, 111);
    const rebuilt = makeNet(16);
    const at = rebuilt.bytes;
    const weights = [...field(1, 2, wrong.bytes), ...field(11, 2, short.policy1.bytes), ...field(3, 2, short.policy.bytes)];
    refused('a first layer of the wrong size is refused', new Uint8Array([...field(10, 2, weights)]), 'first layer is the wrong size');
    ok('(and the network it was made from is fine)', S.maiaReadNet(at).filters === 3);
  }
}

// ── 2. unpacking ──────────────────────────────────────────────────────────
{
  const packed = read('../vendor/maia/maia-1100.pb.gz');
  const plain = gunzipSync(packed);
  const unpacked = await S.maiaUnpack(packed);
  ok('a packed file is unpacked to what it holds', unpacked.length === plain.length && Buffer.compare(Buffer.from(unpacked), plain) === 0, `${unpacked.length} against ${plain.length}`);
  const twice = await S.maiaUnpack(plain);
  ok('a file that is not packed is left as it is', twice.length === plain.length && Buffer.compare(Buffer.from(twice), plain) === 0);
  ok('and so is one too short to tell', (await S.maiaUnpack(new Uint8Array([0x1f]))).length === 1);
  same('and one that only begins like a packed file', Array.from(await S.maiaUnpack(new Uint8Array([0x1f, 0x00, 5, 6]))), [0x1f, 0, 5, 6]);
  ok('an ArrayBuffer is as good as bytes', (await S.maiaUnpack(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength))).length === plain.length);
}

// ── 3. the sums ───────────────────────────────────────────────────────────
for (const [seed, shape] of [[21, {}], [22, { filters: 5, blocks: 3, mid: 3 }], [23, { filters: 2, blocks: 1, mid: 1, kinds: 73 }], [24, { addToo: true }]]) {
  const made = makeNet(seed, shape);
  const net = S.maiaReadNet(made.bytes);
  for (const p of [1, 2]) {
    const planes = somePlanes(seed * 10 + p);
    const got = S.maiaForward(net, planes);
    const want = plainForward(made, planes);
    ok(`a made-up network ${made.filters} wide and ${made.residual.length} deep gives what the plain sums give (position ${p})`,
      got.length === 73 * 64 && farthest(got, want) < 2e-4, `${got.length} numbers, the farthest out by ${farthest(got, want)}`);
  }
  // Room is kept between positions; nothing of one position may be left in it for the next.
  const a = somePlanes(seed + 100), b = somePlanes(seed + 200);
  const first = Array.from(S.maiaForward(net, a));
  S.maiaForward(net, b);
  ok('the same position gets the same answer whatever was asked before it', farthest(S.maiaForward(net, a), first) === 0);
  ok('and the position asked about is not written on', a.every((v, i) => v === somePlanes(seed + 100)[i]));
}

// ── 4. which number is which move ─────────────────────────────────────────
const lc0 = JSON.parse(read('./fixtures/lc0-policy.json').toString('utf8'));
{
  same('Leela\'s table is the size it says', [lc0.moves.length, lc0.slots.length], [1858, 73 * 64]);
  const TYPE = { q: S.QUEEN, r: S.ROOK, b: S.BISHOP };
  const plain = (text, promo = 0, flags = 0) => S.mkMove(S.nameToSquare(text.slice(0, 2)), S.nameToSquare(text.slice(2, 4)), promo, flags);
  const wrong = [];
  lc0.moves.forEach((text, i) => { if (lc0.slots[S.maiaSlot(plain(text, text[4] ? TYPE[text[4]] : 0), false)] !== i) wrong.push(text); });
  same('every one of the 1,858 moves is where Leela\'s table puts it', wrong.slice(0, 8), []);
  const named = (move, black) => lc0.moves[lc0.slots[S.maiaSlot(move, black)]];
  same('castling is the king to its own rook\'s square, short and long',
    [named(plain('e1g1', 0, S.FLAG_CASTLE), false), named(plain('e1c1', 0, S.FLAG_CASTLE), false)], ['e1h1', 'e1a1']);
  same('and for Black, seen from Black\'s side',
    [named(plain('e8g8', 0, S.FLAG_CASTLE), true), named(plain('e8c8', 0, S.FLAG_CASTLE), true)], ['e1h1', 'e1a1']);
  same('a king that simply moves two squares along is not castling', named(plain('e1g1'), false), 'e1g1');
  same('a pawn becoming a knight is the plain move; rook, bishop and queen are marked',
    ['a7a8', 'a7b8', 'h7g8'].map((m) => [named(plain(m, S.KNIGHT), false), named(plain(m, S.ROOK), false), named(plain(m, S.BISHOP), false), named(plain(m, S.QUEEN), false)]),
    [['a7a8', 'a7a8r', 'a7a8b', 'a7a8q'], ['a7b8', 'a7b8r', 'a7b8b', 'a7b8q'], ['h7g8', 'h7g8r', 'h7g8b', 'h7g8q']]);
  same('Black\'s moves are numbered as White\'s would be from the other side of the board',
    [named(plain('e7e5'), true), named(plain('g8f6'), true), named(plain('a2a1', S.QUEEN), true), named(plain('h2g1', S.KNIGHT), true)],
    ['e2e4', 'g1f3', 'a7a8q', 'h7g8']);
  // Every legal move of real positions has a number, and no two share one.
  let clash = 0, missing = 0, moves = 0;
  for (const fen of ['r3k2r/pPppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPpP/R3K2R w KQkq - 0 1', 'r3k2r/pPppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPpP/R3K2R b KQkq - 0 1',
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8']) {
    const board = new S.Board(fen);
    const seen = new Set();
    for (const move of board.legalMoves()) {
      const slot = S.maiaSlot(move, fen.split(' ')[1] === 'b');
      moves++;
      if (!(slot >= 0 && slot < 73 * 64) || lc0.slots[slot] < 0) missing++;
      if (seen.has(slot)) clash++;
      seen.add(slot);
    }
  }
  // A pawn reaching the last rank shares its number between "knight" and nothing else: four promotions, four numbers.
  same('every legal move in four busy positions has a number of its own', [missing, clash, moves > 150], [0, 0, true]);
}

// ── 5. how a game is drawn ────────────────────────────────────────────────
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** The positions of a game from the usual start — or, with no moves, the one position `from` — as FENs. */
const game = (moves, from) => {
  const board = new S.Board(from);
  const fens = [board.fen()];
  for (const ply of S.parsePgn(moves || '*').plies) { board.make(S.sanToMove(board, ply.san)); fens.push(board.fen()); }
  return fens;
};
/** The positions of a game from a set-up position, its moves given one by one. */
const gameFrom = (from, sans) => {
  const board = new S.Board(from);
  const fens = [board.fen()];
  for (const san of sans) { board.make(S.sanToMove(board, san)); fens.push(board.fen()); }
  return fens;
};
const squaresOn = (planes, grid) => {
  const out = [];
  for (let i = 0; i < 64; i++) if (planes[grid * 64 + i] === 1) out.push('abcdefgh'[i % 8] + ((i >> 3) + 1));
  return out.join(' ');
};
const all = (planes, grid, value) => { for (let i = 0; i < 64; i++) if (planes[grid * 64 + i] !== value) return false; return true; };
const empty = (planes, from, to) => { for (let g = from; g <= to; g++) if (!all(planes, g, 0)) return false; return true; };
{
  same('the squares of a position are read off a1 first', [S.maiaSquares(START).slice(0, 8).join(''), S.maiaSquares(START)[60], S.maiaSquares(START).filter(Boolean).length], ['RNBQKBNR', 'k', 32]);

  const p = S.maiaPlanes([START]);
  same('it is 112 grids of 64', p.length, 112 * 64);
  same('the first six grids are the mover\'s own pieces: pawns, knights, bishops, rooks, queen, king',
    [0, 1, 2, 3, 4, 5].map((g) => squaresOn(p, g)), ['a2 b2 c2 d2 e2 f2 g2 h2', 'b1 g1', 'c1 f1', 'a1 h1', 'd1', 'e1']);
  same('the next six are the other side\'s',
    [6, 7, 8, 9, 10, 11].map((g) => squaresOn(p, g)), ['a7 b7 c7 d7 e7 f7 g7 h7', 'b8 g8', 'c8 f8', 'a8 h8', 'd8', 'e8']);
  ok('at the start of a game from the usual position there is no history, and none is made up', empty(p, 12, 103));
  ok('all four castlings are on', [104, 105, 106, 107].every((g) => all(p, g, 1)));
  ok('White to move leaves the "I am Black" grid empty', all(p, 108, 0));
  ok('the count of quiet moves is nought, the spare grid is noughts and the last is ones', all(p, 109, 0) && all(p, 110, 0) && all(p, 111, 1));

  // Black to move: everything is seen from Black's side.
  const q = S.maiaPlanes(game('1. e4'));
  same('for Black the board is turned round: Black\'s pieces come first, on the near ranks',
    [squaresOn(q, 0), squaresOn(q, 4), squaresOn(q, 5)], ['a2 b2 c2 d2 e2 f2 g2 h2', 'd1', 'e1']);
  same('and White\'s pawn on e4 is seen on what is, from there, the fifth rank', squaresOn(q, 6), 'e5 a7 b7 c7 d7 f7 g7 h7');
  ok('the "I am Black" grid is all ones', all(q, 108, 1));
  same('the board before is drawn the same way up — Black\'s pieces first, though it was White\'s move then',
    [squaresOn(q, 13), squaresOn(q, 19), squaresOn(q, 18)], ['a2 b2 c2 d2 e2 f2 g2 h2', 'a7 b7 c7 d7 e7 f7 g7 h7', 'e1']);
  ok('and before that there is nothing, a game from the usual start being two positions old', empty(q, 26, 103));

  // Castling, one at a time, from each side.
  const rooks = 'r3k2r/8/8/8/8/8/8/R3K2R';
  const rights = (fen) => [104, 105, 106, 107].map((g) => (all(S.maiaPlanes([fen]), g, 1) ? 1 : 0)).join('');
  same('the castling grids are: I long, I short, they long, they short',
    [rights(`${rooks} w Q - 0 1`), rights(`${rooks} w K - 0 1`), rights(`${rooks} w q - 0 1`), rights(`${rooks} w k - 0 1`), rights(`${rooks} w - - 0 1`)],
    ['1000', '0100', '0010', '0001', '0000']);
  same('and for Black "I" is Black',
    [rights(`${rooks} b q - 0 1`), rights(`${rooks} b k - 0 1`), rights(`${rooks} b Q - 0 1`), rights(`${rooks} b K - 0 1`), rights(`${rooks} b Kq - 0 1`)],
    ['1000', '0100', '0010', '0001', '1001']);

  ok('the count of moves since a capture or a pawn move is written in every square', all(S.maiaPlanes(['8/8/4k3/8/8/4K3/4R3/8 w - - 37 60']), 109, 37));

  // A position that has been on the board before.
  const back = S.maiaPlanes(game('1. Nf3 Nf6 2. Ng1 Ng8'));
  ok('a position the game has been in before is marked as seen', all(back, 12, 1));
  ok('and the ones on the way there, which had not been, are not', [1, 2, 3, 4].every((b) => all(back, b * 13 + 12, 0)));
  const again = S.maiaPlanes(game('1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3'));
  ok('a move later, both this position and the one before it have been seen', all(again, 12, 1) && all(again, 25, 1) && all(again, 38, 0));

  // Eight boards and no more.
  const long = S.maiaPlanes(game('1. a3 a6 2. b3 b6 3. c3 c6 4. d3 d6 5. e3'));
  // Ten positions, Black to move in the last. Seven back is the one after 1.a3 a6;
  // the two before it, where Black's a-pawn was still at home, are not shown.
  same('the eighth board back is the position seven moves ago, and nothing older is shown',
    [squaresOn(long, 7 * 13), squaresOn(long, 7 * 13 + 6)], ['b2 c2 d2 e2 f2 g2 h2 a3', 'a6 b7 c7 d7 e7 f7 g7 h7']);

  // A position set up on the board: there is no history, and the position stands in for it.
  const MID = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
  const setUp = S.maiaPlanes([MID]);
  same('from a set-up position, all eight boards are that position',
    [0, 1, 2, 3, 4, 5, 6, 7].map((b) => squaresOn(setUp, b * 13 + 2)), Array(8).fill('c1 c4'));
  ok('and none of them is marked as seen before', [0, 1, 2, 3, 4, 5, 6, 7].every((b) => all(setUp, b * 13 + 12, 0)));
  const two = S.maiaPlanes(gameFrom(MID, ['d3', 'Bc5']));
  same('two moves on from a set-up position, three boards are real and the rest are the first one',
    [0, 1, 2, 3, 7].map((b) => squaresOn(two, b * 13)), ['a2 b2 c2 f2 g2 h2 d3 e4', 'a2 b2 c2 f2 g2 h2 d3 e4', 'a2 b2 c2 d2 f2 g2 h2 e4', 'a2 b2 c2 d2 f2 g2 h2 e4', 'a2 b2 c2 d2 f2 g2 h2 e4']);
  same('with the other side\'s bishop where it was on each', [0, 1, 3].map((b) => squaresOn(two, b * 13 + 8)), ['c5 c8', 'c8 f8', 'c8 f8']);
  ok('the usual starting position, set up, is the usual start: no history is made up for it', empty(S.maiaPlanes([START.replace(' 0 1', ' 0 7')]), 12, 103));

  // A pawn that has just moved two squares, in a set-up position: the made-up
  // boards show it where it came from, which is how the capture in passing is seen.
  const whiteJustMoved = S.maiaPlanes(['rnbqkbnr/pppp1ppp/8/8/3Pp3/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 3']);
  same('Black to move after d2-d4: this board has the pawn on d4 (the fifth rank from Black\'s side), the made-up ones have it at home',
    [squaresOn(whiteJustMoved, 6), squaresOn(whiteJustMoved, 13 + 6), squaresOn(whiteJustMoved, 7 * 13 + 6)],
    ['d5 a7 b7 c7 e7 f7 g7 h7', 'a7 b7 c7 d7 e7 f7 g7 h7', 'a7 b7 c7 d7 e7 f7 g7 h7']);
  const blackJustMoved = S.maiaPlanes(['rnbqkbnr/pppp1ppp/8/3Pp3/8/8/PPP1PPPP/RNBQKBNR w KQkq e6 0 3']);
  same('White to move after ...e7-e5: the same, for Black\'s pawn',
    [squaresOn(blackJustMoved, 6), squaresOn(blackJustMoved, 13 + 6)], ['e5 a7 b7 c7 d7 f7 g7 h7', 'a7 b7 c7 d7 e7 f7 g7 h7']);
  ok('and the mover\'s own pawns are left alone', squaresOn(blackJustMoved, 0) === squaresOn(blackJustMoved, 13) && squaresOn(blackJustMoved, 0) === 'a2 b2 c2 e2 f2 g2 h2 d5');
  // One move on from that first position: the board before is a real one now,
  // and shows the pawn where it really was; only the made-up ones behind it move it home.
  const moveOn = S.maiaPlanes(gameFrom('rnbqkbnr/pppp1ppp/8/8/3Pp3/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 3', ['Nc6']));
  same('a real board of history is never altered; only the made-up ones behind it are',
    [squaresOn(moveOn, 0), squaresOn(moveOn, 13), squaresOn(moveOn, 26), squaresOn(moveOn, 7 * 13)],
    ['a2 b2 c2 e2 f2 g2 h2 d4', 'a2 b2 c2 e2 f2 g2 h2 d4', 'a2 b2 c2 d2 e2 f2 g2 h2', 'a2 b2 c2 d2 e2 f2 g2 h2']);
  const noPawn = S.maiaPlanes(['4k3/8/8/8/8/8/8/4K3 w - e6 0 1']);
  same('a square named for a capture in passing with no pawn beside it changes nothing: no pawn is made up',
    [squaresOn(noPawn, 13 + 5), squaresOn(noPawn, 13 + 6), squaresOn(noPawn, 13)], ['e1', '', '']);
  const blocked = S.maiaPlanes(['4k3/4n3/8/3Pp3/8/8/8/4K3 w - e6 0 1']);
  same('nor is a pawn moved back onto a square something else is standing on', [squaresOn(blocked, 13 + 6), squaresOn(blocked, 13 + 7)], ['e5', 'e7']);
}

// ── 6. chances, and choosing ──────────────────────────────────────────────
{
  const board = new S.Board('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  const say = (wanted) => {
    // An answer with a number for each of this position's moves, and a large one where there is no move.
    const answer = new Float32Array(73 * 64).fill(9);
    for (const move of board.legalMoves()) answer[S.maiaSlot(move, false)] = wanted[S.toSan(board, move)] ?? -20;
    return answer;
  };
  const chances = S.maiaChances(board, say({ 'a8=Q': Math.log(6), 'a8=N': Math.log(3), Kb1: Math.log(1) }));
  same('chances are for moves that can be played, likeliest first, whatever is said about the others',
    chances.slice(0, 3).map((c) => [S.toSan(board, c.move), c.uci, c.chance.toFixed(4)]), [['a8=Q', 'a7a8q', '0.6000'], ['a8=N', 'a7a8n', '0.3000'], ['Kb1', 'a1b1', '0.1000']]);
  ok('and they add up to one', Math.abs(chances.reduce((s, c) => s + c.chance, 0) - 1) < 1e-9);
  same('there is one for every legal move', chances.length, board.legalMoves().length);
  same('no legal move, no chances', S.maiaChances(new S.Board('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), new Float32Array(73 * 64)), []);
  same('moves equally likely are in a settled order', S.maiaChances(board, new Float32Array(73 * 64)).slice(0, 3).map((c) => c.uci), ['a1a2', 'a1b1', 'a1b2']);

  const pick = (list, r) => S.maiaChoose(list, () => r);
  const made = (pairs) => pairs.map(([uci, chance, promo = 0]) => ({ move: S.mkMove(S.nameToSquare(uci.slice(0, 2)), S.nameToSquare(uci.slice(2, 4)), promo, 0), uci, chance }));
  const five = made([['e2e4', 0.5], ['d2d4', 0.3], ['c2c4', 0.15], ['g1f3', 0.04], ['b1c3', 0.01]]);
  same('one in twenty is the least a move is chosen at', S.MAIA_LEAST, 0.05);
  same('the move is drawn from the likely ones, in proportion: the first half of the draw is the 50, the next the 30, the last the 15',
    [0, 0.5, 0.526, 0.527, 0.84, 0.843, 0.999999].map((r) => pick(five, r).uci), ['e2e4', 'e2e4', 'e2e4', 'd2d4', 'd2d4', 'c2c4', 'c2c4']);
  same('and it says how many it was drawn from', pick(five, 0.3).among, 3);
  {
    const counts = {};
    for (let i = 0; i < 950; i++) { const c = pick(five, (i + 0.5) / 950); counts[c.uci] = (counts[c.uci] ?? 0) + 1; }
    same('over an even spread of draws, each likely move comes up as often as its share, and no other comes up at all', counts, { e2e4: 500, d2d4: 300, c2c4: 150 });
  }
  same('a move exactly at one in twenty is likely', [...new Set([0, 0.99].map((r) => pick(made([['e2e4', 0.95], ['d2d4', 0.05]]), r).uci))], ['e2e4', 'd2d4']);
  same('the likeliest move is played when nothing reaches one in twenty', [0, 0.5, 0.999].map((r) => pick(made([['e2e4', 0.04], ['d2d4', 0.039], ['c2c4', 0.038]]), r).uci), ['e2e4', 'e2e4', 'e2e4']);
  same('a pawn becoming a knight is not drawn when it is not the likeliest move',
    [0.1, 0.7, 0.9, 0.999].map((r) => pick(made([['a7a8', 0.5, S.QUEEN], ['b7b8', 0.3, S.KNIGHT], ['a1b1', 0.2]]), r).uci), ['a7a8', 'a7a8', 'a1b1', 'a1b1']);
  same('but is played when it is', [0, 0.59, 0.61, 0.99].map((r) => pick(made([['b7b8', 0.6, S.KNIGHT], ['a7a8', 0.4, S.QUEEN]]), r).uci), ['b7b8', 'b7b8', 'a7a8', 'a7a8']);
  same('becoming a rook or a bishop is drawn like any other move', [0.9].map((r) => pick(made([['a1b1', 0.5], ['a7a8', 0.5, S.ROOK]]), r).uci), ['a7a8']);
  same('a draw that comes out at the very top is the last likely move, not nothing', pick(five, 1).uci, 'c2c4');
  same('nothing to choose from is nothing chosen', S.maiaChoose([]), null);
  same('the chosen move comes back with its move, its squares and its share', Object.keys(pick(five, 0)).sort(), ['among', 'chance', 'move', 'uci']);
}

// ── 7. the real networks ──────────────────────────────────────────────────
const listed = JSON.parse(read('../vendor/maia/nets.json').toString('utf8'));
same('nine networks are listed, one for each hundred from 1100 to 1900', listed.nets.map((n) => n.level), [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900]);
const nets = {};
for (const n of listed.nets) {
  const bytes = read(`../vendor/maia/${n.file}`);
  ok(`maia-${n.level} is the published file: its size and its hash are the ones listed`,
    bytes.length === n.bytes && createHash('sha256').update(bytes).digest('hex') === n.sha256);
  nets[n.level] = S.maiaReadNet(await S.maiaUnpack(bytes));
  same(`maia-${n.level} is six blocks of sixty-four, answering with eighty kinds of move`, [nets[n.level].residual.length, nets[n.level].filters, nets[n.level].policy.outs], [6, 64, 80]);
}
const chancesAfter = (level, moves, from) => {
  const fens = game(moves, from);
  const board = new S.Board(fens[fens.length - 1]);
  return { board, chances: S.maiaChances(board, S.maiaForward(nets[level], S.maiaPlanes(fens))) };
};
const sanOf = ({ board, chances }, n = 1) => chances.slice(0, n).map((c) => S.toSan(board, c.move));
const share = ({ board, chances }, san) => chances.find((c) => S.toSan(board, c.move) === san)?.chance ?? 0;
{
  // The Maia project's own example of running maia-1100: asked for a move at the start, it says e2e4.
  same('maia-1100 opens with the king\'s pawn, as its makers show it doing', sanOf(chancesAfter(1100, ''))[0], 'e4');
  const first = chancesAfter(1100, '');
  ok('about two games in three, with the queen\'s pawn about one in five — which is what players of that rating do',
    Math.abs(share(first, 'e4') - 0.661) < 0.01 && Math.abs(share(first, 'd4') - 0.210) < 0.01, `${share(first, 'e4')} ${share(first, 'd4')}`);
  const pawn = Object.keys(nets).map((level) => share(chancesAfter(level, ''), 'e4'));
  ok('every network opens with the king\'s pawn most often', Object.keys(nets).every((level) => sanOf(chancesAfter(level, ''))[0] === 'e4'));
  ok('and the stronger the players, the less often: more of them play something else', pawn[0] > pawn[4] && pawn[4] > pawn[8] && pawn[0] - pawn[8] > 0.05, pawn.map((x) => x.toFixed(3)).join(' '));
  same('after 1.e4 the 1100s answer with the king\'s pawn', sanOf(chancesAfter(1100, '1. e4'))[0], 'e5');

  // A mate in one that beginners miss: 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6, and the queen takes on f7.
  const mate = Object.keys(nets).map((level) => share(chancesAfter(level, '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6'), 'Qxf7#'));
  ok('every network finds the mate on f7 more often than not', mate.every((x) => x > 0.5), mate.map((x) => x.toFixed(2)).join(' '));
  ok('and the three strongest find it more often than the three weakest', (mate[6] + mate[7] + mate[8]) / 3 - (mate[0] + mate[1] + mate[2]) / 3 > 0.1, mate.map((x) => x.toFixed(2)).join(' '));

  // Castling and promoting come out of the answer as themselves.
  const castle = chancesAfter(1500, '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5');
  ok('castling is among the moves a 1500 would play in the Italian, under its own number', share(castle, 'O-O') > 0.05, String(share(castle, 'O-O')));
  const queening = chancesAfter(1500, '', '8/P6k/8/8/8/8/8/K7 w - - 0 1');
  ok('with a pawn about to promote, a 1500 makes a queen', sanOf(queening)[0] === 'a8=Q' && share(queening, 'a8=Q') > 0.5, `${sanOf(queening)[0]} ${share(queening, 'a8=Q')}`);
  ok('for Black too, seen from the other side', sanOf(chancesAfter(1500, '', '7k/8/8/8/8/8/p6K/8 b - - 0 1'))[0] === 'a1=Q');

  // WHY A KNIGHT IS NOT DRAWN. A pawn becoming a knight shares its number with
  // the plain move from that square, and where it is a capture the network can
  // put a great deal on it: here, the 1900s' network, a pawn taking a rook to
  // give mate with a queen. A knight is a likely move by the numbers, and
  // nobody plays it — so it is never drawn.
  const taking = chancesAfter(1900, '', '6k1/5ppp/8/8/8/8/p4PPP/1R4K1 b - - 0 1');
  ok('the 1900s\' network puts more than one in twenty on a knight where a pawn takes a rook on the last rank', share(taking, 'axb1=N') > S.MAIA_LEAST, String(share(taking, 'axb1=N')));
  const drawn = new Set();
  for (let i = 0; i < 200; i++) drawn.add(S.toSan(taking.board, S.maiaChoose(taking.chances, () => (i + 0.5) / 200).move));
  same('and across the whole of the draw the knight is never the move made', [drawn.has('axb1=N'), drawn.has('axb1=Q#')], [false, true]);
}
{
  // WHAT IT SAYS IS ABOUT MOVES THAT CAN BE PLAYED. A network never sees which
  // moves are legal; it was only ever shown moves that were. Run correctly, it
  // has learned the rules well enough that nearly all of what it says lands on
  // legal moves. Shown the board the wrong way up, or the history out of
  // order, it still answers — and what it says lands anywhere.
  const famous = read('../src/famous.js').toString('utf8');
  const games = [...famous.matchAll(/moves: '([^']+)'/g)].map((m) => game(m[1]));
  for (const level of [1100, 1500, 1900]) {
    const shares = [];
    let firstChoiceLegal = 0;
    for (const fens of games) {
      for (let i = 2; i < fens.length; i += 4) {
        const board = new S.Board(fens[i]);
        const moves = board.legalMoves();
        if (!moves.length) continue;
        const answer = S.maiaForward(nets[level], S.maiaPlanes(fens.slice(0, i + 1)));
        let top = 0;
        for (let k = 1; k < answer.length; k++) if (answer[k] > answer[top]) top = k;
        let everything = 0;
        for (let k = 0; k < answer.length; k++) everything += Math.exp(answer[k] - answer[top]);
        const black = fens[i].split(' ')[1] === 'b';
        const slots = moves.map((m) => S.maiaSlot(m, black));
        shares.push(slots.reduce((s, slot) => s + Math.exp(answer[slot] - answer[top]), 0) / everything);
        if (slots.includes(top)) firstChoiceLegal++;
      }
    }
    shares.sort((a, b) => a - b);
    const middle = shares[shares.length >> 1];
    const poor = shares.filter((x) => x < 0.8).length / shares.length;
    ok(`maia-${level}, over ${shares.length} positions from master games: in the usual position 97% or more of what it says is about legal moves`, middle >= 0.97, `the middle one is ${middle.toFixed(4)}`);
    ok(`maia-${level}: and in fewer than one position in ten is it under 80%`, poor < 0.1, `${(100 * poor).toFixed(1)}% of them`);
    ok(`maia-${level}: the single thing it says most is a legal move in nineteen positions of twenty`, firstChoiceLegal / shares.length >= 0.95, `${firstChoiceLegal} of ${shares.length}`);
  }

  // The same position with its real history, and set up with none: much the same answer.
  let agree = 0, asked = 0;
  for (const fens of games) {
    for (let i = 14; i < fens.length - 1; i += 6) {
      const board = new S.Board(fens[i]);
      if (!board.legalMoves().length) continue;
      const real = S.maiaChances(board, S.maiaForward(nets[1500], S.maiaPlanes(fens.slice(0, i + 1))));
      const bare = S.maiaChances(board, S.maiaForward(nets[1500], S.maiaPlanes([fens[i]])));
      asked++;
      if (real[0].uci === bare[0].uci) agree++;
    }
  }
  ok('set up on the board with no history, a position gets the first choice it gets in its game four times in five', agree / asked >= 0.8, `${agree} of ${asked}`);
}

console.log(`maia: ${pass} checks passed${fail ? `, ${fail} FAILED` : ''}`);
if (fail) process.exit(1);
