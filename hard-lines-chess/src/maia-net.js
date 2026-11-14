// ── a small neural network, read and run ───────────────────────────────────
//
// The human-like opponent is a network: a file of numbers, made by the Maia
// project by showing a network millions of games between people of one
// rating and asking it, each time, which move the person played. What comes
// out is not an engine. It does not search and it does not know who is
// winning; it says how likely each move is to be the one a person of that
// rating would play here. See vendor/maia/README.md for whose it is.
//
// This file is the whole of what running one needs: reading the file, and the
// sums. It knows nothing about chess — a position goes in as 112 grids of
// eight by eight and 73 grids come out — so that it can run on the page, in a
// worker, or under a test, as the same text. What the grids MEAN is
// src/maia.js.
//
// WHY IT IS WRITTEN OUT HERE rather than handed to a library. The network is
// small: six blocks of sixty-four filters, about forty million multiplications
// a position, a tenth of a second on a laptop. A library that runs networks
// is megabytes, wants WebAssembly or a graphics card, and is one more thing
// that is different on a phone. This is three hundred lines that are the same
// everywhere, and a test holds them to the answers the network is known to
// give (tests/maia.test.mjs).
//
// THE FILE IS THE ONE THE MAIA PROJECT PUBLISHED, byte for byte: weights in
// the format of the Leela Chess Zero engine, which is a protobuf — numbered
// fields, each a number or a run of bytes — gzipped. Nothing converts it on
// the way, so there is no second copy of the numbers to go stale, and the
// build checks each file against the hash it had upstream.

/** What a position is shown as: 112 grids of 8 by 8. */
const MAIA_INPUT_PLANES = 112;
/** What comes back: for each of 64 squares a piece could leave, 73 kinds of move. */
const MAIA_MOVE_KINDS = 73;

/**
 * The bytes of a network file, unpacked if they are packed.
 *
 * Told by the first two bytes, not by the name or by what the server said: a
 * server that announces the packing has the browser undo it on the way, and
 * one that does not hands the file over as it is, and both are the same
 * request from here.
 */
async function maiaUnpack(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot unpack the file');
  const unpacked = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(unpacked).arrayBuffer());
}

/**
 * Read a network from its unpacked bytes.
 *
 * Only what the opponent needs is kept: the layers that lead to the moves.
 * The file also holds a second ending that guesses who will win, and it is
 * walked past. Anything that is not the kind of network this file can run —
 * another way of showing the position, another kind of ending — is refused
 * here, by name, rather than run into nonsense.
 *
 * @returns {{ filters: number, residual: object[], input: object, policy1: object, policy: object }}
 */
function maiaReadNet(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (why) => { throw new Error(`not a network this app can run: ${why}`); };

  // A protobuf message is a run of fields: a number saying which field and
  // what shape it has, then the value. Four shapes are used here.
  const fields = (start, end) => {
    const out = [];
    let p = start;
    const varint = () => {
      let value = 0, scale = 1;
      for (;;) {
        if (p >= end) fail('it ends in the middle of a number');
        const byte = bytes[p++];
        value += (byte & 0x7f) * scale;
        if (!(byte & 0x80)) return value;
        scale *= 128;
        if (scale > 2 ** 56) fail('a number in it is too long');
      }
    };
    while (p < end) {
      const key = varint();
      const no = Math.floor(key / 8), shape = key % 8;
      if (shape === 0) out.push({ no, value: varint() });
      else if (shape === 1) { out.push({ no, at: p, len: 8 }); p += 8; }
      else if (shape === 5) { out.push({ no, at: p, len: 4 }); p += 4; }
      else if (shape === 2) { const len = varint(); out.push({ no, at: p, len }); p += len; }
      else fail(`a field has a shape (${shape}) the format does not have`);
      if (p > end) fail('a field runs past the end');
    }
    return out;
  };
  const inside = (f) => fields(f.at, f.at + f.len);

  // A layer is its numbers squeezed into sixteen bits each, between a lowest
  // and a highest value that are written beside them.
  const layer = (f) => {
    let min = 0, max = 0, at = 0, len = 0;
    for (const x of inside(f)) {
      if (x.no === 1) min = view.getFloat32(x.at, true);
      else if (x.no === 2) max = view.getFloat32(x.at, true);
      else if (x.no === 3) { at = x.at; len = x.len; }
      else if (x.no === 4 && x.value !== 1) fail('its numbers are packed in a way this app does not read');
    }
    if (len % 2) fail('a layer has half a number in it');
    const out = new Float32Array(len / 2);
    const range = (max - min) / 65535;
    for (let i = 0; i < out.length; i++) out[i] = view.getUint16(at + 2 * i, true) * range + min;
    return out;
  };

  // A convolution, with the normalising that followed it in training folded
  // in — so that running it is one multiplication and one addition, as the
  // engine these files were made for does it.
  const conv = (f, ins, what) => {
    const L = {};
    for (const x of inside(f)) {
      const name = { 1: 'w', 2: 'b', 3: 'means', 4: 'vars', 5: 'gammas', 6: 'betas' }[x.no];
      if (name) L[name] = layer(x);
    }
    const outs = (L.means ?? L.b ?? []).length;
    if (!L.w || !outs) fail(`${what} is missing`);
    if (L.w.length !== outs * ins * 9) fail(`${what} is the wrong size`);
    const w = L.w, b = new Float32Array(outs);
    if (L.means) {
      if (!L.vars || L.vars.length !== outs) fail(`${what} is the wrong size`);
      for (let o = 0; o < outs; o++) {
        const g = (L.gammas ? L.gammas[o] : 1) / Math.sqrt(L.vars[o] + 1e-5);
        for (let i = o * ins * 9; i < (o + 1) * ins * 9; i++) w[i] *= g;
        b[o] = -g * (L.means[o] - (L.b ? L.b[o] : 0)) + (L.betas ? L.betas[o] : 0);
      }
    } else {
      b.set(L.b);
    }
    return { w, b, ins, outs };
  };

  const top = fields(0, bytes.length);
  // What the file says about itself, where it says anything.
  const format = top.find((f) => f.no === 4 && f.len !== undefined);
  if (format) {
    for (const f of inside(format)) {
      if (f.no === 1 && f.value !== 1) fail('its numbers are packed in a way this app does not read');
      if (f.no === 2 && f.len !== undefined) {
        const said = {};
        for (const x of inside(f)) said[x.no] = x.value;
        if (said[1] !== 1) fail(`it is shown the position in a way (${said[1]}) this app does not draw`);
        if (said[3] !== 4) fail(`it is built in a way (${said[3]}) this app does not run`);
        if (said[4] !== 2) fail(`it answers with its moves in a way (${said[4]}) this app does not read`);
      }
    }
  }
  const weights = top.find((f) => f.no === 10 && f.len !== undefined);
  if (!weights) fail('it has no weights in it');

  const parts = inside(weights);
  const first = parts.find((f) => f.no === 1);
  if (!first) fail('its first layer is missing');
  const input = conv(first, MAIA_INPUT_PLANES, 'its first layer');
  const filters = input.outs;

  const residual = [];
  for (const f of parts.filter((x) => x.no === 2)) {
    const block = {};
    for (const g of inside(f)) {
      if (g.no === 1) block.conv1 = conv(g, filters, 'a layer');
      else if (g.no === 2) block.conv2 = conv(g, filters, 'a layer');
      else if (g.no === 3) {
        const se = {};
        for (const h of inside(g)) { const name = { 1: 'w1', 2: 'b1', 3: 'w2', 4: 'b2' }[h.no]; if (name) se[name] = layer(h); }
        block.se = se;
      }
    }
    const { conv1, conv2, se } = block;
    if (!conv1 || !conv2 || !se?.w1 || !se.b1 || !se.w2 || !se.b2) fail('a block is missing a part');
    if (conv1.outs !== filters || conv2.outs !== filters) fail('a block is the wrong size');
    se.mid = se.b1.length;
    if (se.w1.length !== se.mid * filters || se.w2.length !== 2 * filters * se.mid || se.b2.length !== 2 * filters) fail('a block is the wrong size');
    residual.push(block);
  }
  if (!residual.length) fail('it has no blocks');

  const ending1 = parts.find((f) => f.no === 11), ending = parts.find((f) => f.no === 3);
  if (!ending1 || !ending) fail('the layers that lead to its moves are missing');
  const policy1 = conv(ending1, filters, 'the layer before its moves');
  if (policy1.outs !== filters) fail('the layer before its moves is the wrong size');
  const policy = conv(ending, filters, 'the layer of its moves');
  if (policy.outs < MAIA_MOVE_KINDS) fail('it answers with too few kinds of move');

  return { filters, input, residual, policy1, policy };
}

/**
 * One three-by-three convolution over the board: `x` is `L.ins` grids of 64,
 * `out` gets `outs` grids of 64 — the weighted sum only, with nothing added
 * and nothing cut off; the caller does both.
 *
 * `pad` is room for the input with a border of noughts round each grid, ten
 * by ten, so that the sum at the edge of the board needs no special case: the
 * squares off the board are there and are nought.
 */
function maiaConv(x, L, out, pad, outs = L.outs) {
  const { w, ins } = L;
  for (let c = 0; c < ins; c++) {
    const from = c * 64, to = c * 100 + 11;
    for (let y = 0; y < 8; y++) for (let f = 0; f < 8; f++) pad[to + y * 10 + f] = x[from + y * 8 + f];
  }
  for (let o = 0; o < outs; o++) {
    const base = o * 64;
    for (let i = 0; i < 64; i++) out[base + i] = 0;
    for (let c = 0; c < ins; c++) {
      const k = (o * ins + c) * 9;
      const k0 = w[k], k1 = w[k + 1], k2 = w[k + 2], k3 = w[k + 3], k4 = w[k + 4], k5 = w[k + 5], k6 = w[k + 6], k7 = w[k + 7], k8 = w[k + 8];
      const grid = c * 100;
      for (let y = 0; y < 8; y++) {
        const a = grid + y * 10, b = a + 10, d = b + 10, row = base + y * 8;
        for (let f = 0; f < 8; f++) {
          out[row + f] += k0 * pad[a + f] + k1 * pad[a + f + 1] + k2 * pad[a + f + 2]
            + k3 * pad[b + f] + k4 * pad[b + f + 1] + k5 * pad[b + f + 2]
            + k6 * pad[d + f] + k7 * pad[d + f + 1] + k8 * pad[d + f + 2];
        }
      }
    }
  }
}

/**
 * Run the network on a position.
 *
 * `planes` is the position as src/maia.js draws it: 112 grids of 64. What
 * comes back is 73 grids of 64 — for each square a piece could leave, a
 * number for each kind of move from it, higher for likelier. They are not
 * yet chances: most of them are moves that cannot be played here, and making
 * chances of the ones that can is the caller's.
 */
function maiaForward(net, planes) {
  const C = net.filters;
  // Room to work in, made once a network and used for every position.
  const room = net.room ?? (net.room = {
    a: new Float32Array(C * 64), t: new Float32Array(C * 64), u: new Float32Array(C * 64),
    pad: new Float32Array(Math.max(MAIA_INPUT_PLANES, C) * 100), pool: new Float32Array(C),
  });
  const { a, t, u, pad, pool } = room;
  const settle = (grid, bias) => {
    for (let o = 0; o < C; o++) {
      const b = bias[o];
      for (let i = o * 64; i < o * 64 + 64; i++) { const v = grid[i] + b; grid[i] = v > 0 ? v : 0; }
    }
  };

  maiaConv(planes, net.input, a, pad);
  settle(a, net.input.b);

  for (const block of net.residual) {
    maiaConv(a, block.conv1, t, pad);
    settle(t, block.conv1.b);
    maiaConv(t, block.conv2, u, pad);
    // The block looks at its own answer as a whole — the average of each grid —
    // and from that decides how much of each grid to pass on, and what to add.
    const { w1, b1, w2, b2, mid } = block.se;
    const bias = block.conv2.b;
    for (let o = 0; o < C; o++) {
      let sum = 0;
      for (let i = o * 64; i < o * 64 + 64; i++) sum += u[i];
      pool[o] = sum / 64 + bias[o];
    }
    const squeezed = new Float32Array(mid);
    for (let m = 0; m < mid; m++) {
      let sum = b1[m];
      for (let o = 0; o < C; o++) sum += w1[m * C + o] * pool[o];
      squeezed[m] = sum > 0 ? sum : 0;
    }
    for (let o = 0; o < C; o++) {
      let scale = b2[o], add = b2[o + C];
      for (let m = 0; m < mid; m++) { scale += w2[o * mid + m] * squeezed[m]; add += w2[(o + C) * mid + m] * squeezed[m]; }
      const gate = 1 / (1 + Math.exp(-scale));
      const plus = add + gate * bias[o];
      for (let i = o * 64; i < o * 64 + 64; i++) { const v = gate * u[i] + a[i] + plus; a[i] = v > 0 ? v : 0; }
    }
  }

  maiaConv(a, net.policy1, t, pad);
  settle(t, net.policy1.b);
  const out = new Float32Array(MAIA_MOVE_KINDS * 64);
  maiaConv(t, net.policy, out, pad, MAIA_MOVE_KINDS);
  for (let o = 0; o < MAIA_MOVE_KINDS; o++) {
    const b = net.policy.b[o];
    for (let i = o * 64; i < o * 64 + 64; i++) out[i] += b;
  }
  return out;
}
