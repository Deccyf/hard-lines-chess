// ── Reckless, in a worker of its own ───────────────────────────────────────
//
// A module worker, loaded as a file beside the page (build.py copies it; it is
// not part of the page's own script). It does two jobs: it gets the engine
// onto the device, and then it runs it. Nothing here touches the page.
//
// GETTING IT HERE. The engine is 64 MB, almost all network weights, cut by
// tools/split-reckless.mjs into gzipped pieces listed in reckless/manifest.json.
// Each piece is fetched, unpacked, checked against the manifest's checksum and
// only then kept, in a cache of its own ('reckless-engine'). So:
//
//   A DOWNLOAD THAT STOPS IS NOT LOST. Every piece already kept stays kept, and
//   the next attempt starts at the first one missing.
//
//   A STALL IS AN ERROR. A connection that stops sending often never says so —
//   the request just sits there — so a piece that goes twenty seconds without
//   a byte is abandoned and asked for again, up to three times.
//
//   THE KEPT MANIFEST IS ALWAYS A COMPLETE ENGINE. A new build's manifest is
//   held in memory while its pieces arrive and written down only when every
//   one of them has, so a phone halfway through an update still has the old
//   engine, whole, to start offline.
//
// RUNNING IT. The same rules as Stockfish's driver: a number of positions, never
// seconds, and the engine cleared before every search, so a position gets the
// same answer every time. It is told the game from the start so it can see a
// repetition coming.
//
// Messages in:  {type: 'load'}
//               {type: 'go', id, fen, moves, nodes, multipv}
// Messages out: {type: 'progress', phase, saved, total}
//               {type: 'ready', version, commit, total, fetched}
//               {type: 'failed', code, message, saved, total}
//               {type: 'result', id, lines, best} | {type: 'error', id, message}

const CACHE = 'reckless-engine';
const BASE = new URL('reckless/', self.location.href);
const MANIFEST = new URL('manifest.json', BASE).href;
/** How long a piece may go without a byte before the connection counts as stalled. */
const STALL_MS = 20000;
/** How many times a piece is asked for before the download stops. */
const TRIES = 3;

let engine = null;
let loading = null;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'load') {
    loading ??= load().then(
      (info) => postMessage({ type: 'ready', ...info }),
      (err) => {
        loading = null;
        postMessage({ type: 'failed', code: err.code ?? 'start', message: String(err.message ?? err), saved: err.saved ?? 0, total: err.total ?? 0 });
      },
    );
  } else if (msg.type === 'go') {
    try {
      if (!engine) throw new Error('Reckless is not running.');
      const lines = [];
      engine.reset();
      engine.set_position(msg.fen);
      for (const move of msg.moves ?? []) engine.make_move(move);
      engine.go_uci(0, msg.nodes, msg.multipv ?? 1, (line) => { lines.push(String(line)); });
      postMessage({ type: 'result', id: msg.id, lines, best: engine.last_bestmove() });
    } catch (err) {
      // A trap inside the engine leaves it in no state to be asked again.
      engine = null;
      postMessage({ type: 'error', id: msg.id, message: String(err?.message ?? err) });
    }
  }
};

const failure = (code, message, extra = {}) => Object.assign(new Error(message), { code }, extra);

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A piece's bytes, unpacked. Stored gzipped; but a server or proxy that
 * decoded it on the way leaves plain bytes, and those are taken as they are —
 * the checksum is what decides whether they are right.
 */
async function unpack(bytes) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The manifest from the network if it answers, else the one kept last time. */
async function readManifest(cache) {
  let response = null;
  try { response = await fetch(MANIFEST, { cache: 'no-cache' }); } catch { /* offline */ }
  if (response?.ok) return response.json();
  const kept = await cache.match(MANIFEST);
  if (kept) return kept.json();
  throw response
    ? failure('missing', 'This copy of the app was built without Reckless.')
    : failure('offline', 'Reckless needs a connection the first time, to download it.');
}

/** One file, with a watchdog on the bytes and a few more tries if it fails. */
async function download(url, onBytes) {
  let lastError = null;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    const controller = new AbortController();
    let timer = null;
    const watch = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), STALL_MS); };
    try {
      watch();
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`the website answered ${response.status}`);
      const reader = response.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        watch();
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        onBytes(got);
      }
      clearTimeout(timer);
      const out = new Uint8Array(got);
      let at = 0;
      for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
      return out;
    } catch (err) {
      clearTimeout(timer);
      lastError = controller.signal.aborted ? new Error('the connection stalled') : err;
      onBytes(0);
      if (attempt < TRIES) await new Promise((done) => setTimeout(done, 1500 * attempt));
    }
  }
  throw lastError;
}

async function keep(cache, url, bytes, type) {
  try {
    await cache.put(url, new Response(bytes, { headers: { 'Content-Type': type } }));
  } catch (err) {
    if (err?.name === 'QuotaExceededError') {
      throw failure('storage', 'There is not enough space on this device to keep Reckless.');
    }
    throw err;
  }
}

async function load() {
  const cache = await caches.open(CACHE);
  const manifest = await readManifest(cache);
  const total = manifest.pieces.reduce((n, p) => n + p.bytes, 0);
  let saved = 0;
  let fetched = 0;
  let lastPost = 0;
  const progress = (extra = 0, force = false) => {
    const now = Date.now();
    if (!force && now - lastPost < 150) return;
    lastPost = now;
    postMessage({ type: 'progress', phase: 'download', saved: saved + extra, total });
  };
  const stopped = (err) => failure(err.code ?? 'download', err.message, { saved, total });

  // The bindings first: small, and a failure here is better found before
  // forty megabytes than after.
  const glueUrl = new URL(manifest.glue.file, BASE).href;
  let glueResponse = await cache.match(glueUrl);
  let glueText;
  if (glueResponse) {
    glueText = await glueResponse.text();
  } else {
    let bytes;
    try { bytes = await download(glueUrl, () => {}); } catch (err) { throw stopped(err); }
    if (await sha256(bytes) !== manifest.glue.sha256) throw stopped(new Error('a file arrived damaged'));
    await keep(cache, glueUrl, bytes, 'text/javascript');
    glueText = new TextDecoder().decode(bytes);
  }

  const wasm = new Uint8Array(manifest.wasm.bytes);
  let offset = 0;
  progress(0, true);
  for (const piece of manifest.pieces) {
    const url = new URL(piece.file, BASE).href;
    let raw = null;
    const kept = await cache.match(url);
    if (kept) {
      raw = await unpack(new Uint8Array(await kept.arrayBuffer()));
      // Checked when it arrived; its length is checked again, because a
      // truncated write is the one damage a cache can do without saying so.
      if (raw.length !== piece.raw) { await cache.delete(url); raw = null; }
    }
    if (!raw) {
      let packed;
      try { packed = await download(url, (n) => progress(n)); } catch (err) { throw stopped(err); }
      raw = await unpack(packed);
      if (raw.length !== piece.raw || await sha256(raw) !== piece.sha256) {
        throw stopped(new Error('a piece arrived damaged'));
      }
      await keep(cache, url, packed, 'application/octet-stream');
      fetched += piece.bytes;
    }
    wasm.set(raw, offset);
    offset += piece.raw;
    saved += piece.bytes;
    progress(0, true);
  }

  // Every piece was checked on its own; this proves they are the right pieces
  // in the right order. Only after a download — the kept set passed it before.
  if (fetched && await sha256(wasm) !== manifest.wasm.sha256) {
    for (const p of manifest.pieces) await cache.delete(new URL(p.file, BASE).href);
    throw failure('download', 'Reckless arrived damaged and has been thrown away. Press the button to download it again.', { saved: 0, total });
  }

  // Complete: now this is the manifest to remember, and anything a previous
  // build left in the cache can go.
  await keep(cache, MANIFEST, JSON.stringify(manifest), 'application/json');
  const wanted = new Set([MANIFEST, glueUrl, ...manifest.pieces.map((p) => new URL(p.file, BASE).href)]);
  for (const request of await cache.keys()) if (!wanted.has(request.url)) await cache.delete(request);

  postMessage({ type: 'progress', phase: 'start', saved: total, total });
  try {
    const bindings = await import(URL.createObjectURL(new Blob([glueText], { type: 'text/javascript' })));
    await bindings.default({ module_or_path: wasm });
    engine = new bindings.Engine();
    engine.set_threads(1);
  } catch (err) {
    throw failure('start', `Reckless is downloaded but would not start here (${err?.message ?? err}). This device may not have the memory for it.`);
  }
  return { version: manifest.version, commit: manifest.commit, total, fetched };
}
