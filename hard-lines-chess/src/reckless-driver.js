// ── Reckless, the other engine ─────────────────────────────────────────────
//
// One of the two strongest chess engines there are, playing Stockfish on the
// Watch screen. It is here only in the website version of the app: it is a
// 44 MB download, fetched the first time somebody asks for it, and the APK
// has no internet permission to fetch it with and no reason to carry it for
// everybody. vendor/reckless/README.md says what the build is.
//
// The work happens in reckless-worker.js — the download, the checks, the
// engine. This is the page's side of it: finding out where things stand
// without downloading anything, starting it with a progress report, and
// asking it questions one at a time.
//
// THE SAME RULES AS STOCKFISH. A number of positions, never seconds; the
// engine cleared before every search; the game from its first move. And the
// same budget as Stockfish, so neither side of a game between them is given
// more to work with than the other.

const Reckless = {
  worker: null,
  loading: null,     // the promise every caller shares while it starts
  queue: Promise.resolve(),
  version: null,
  nextId: 1,
  onProgress: null,  // the latest caller's progress report
};

/** The cache the worker keeps the engine in; the service worker leaves it alone. */
const RECKLESS_CACHE = 'reckless-engine';
const RECKLESS_NODES = STOCKFISH_NODES;
const RECKLESS_SEARCH_MS = 120000;

const recklessUrl = (path) => new URL(`reckless/${path}`, location.href).href;

/**
 * Where Reckless stands on this device, found without downloading it.
 *
 *   'apk'         the Android app, which cannot fetch it
 *   'file'        a copy of the page opened from a file, which cannot run it
 *   'unsupported' a browser without what the download needs
 *   'missing'     a build of the app without Reckless in it
 *   'offline'     never downloaded, and no connection to do it now
 *   'none' | 'partial' | 'ready'  how much of it is kept: `need` bytes to go of `total`
 */
async function recklessStatus() {
  if (typeof IN_ANDROID_APP !== 'undefined' && IN_ANDROID_APP) return { state: 'apk' };
  if (location.protocol === 'file:') return { state: 'file' };
  if (typeof Worker === 'undefined' || typeof caches === 'undefined'
      || typeof DecompressionStream === 'undefined' || !globalThis.crypto?.subtle) {
    return { state: 'unsupported' };
  }
  const cache = await caches.open(RECKLESS_CACHE);
  let manifest = null;
  let answered = false;
  try {
    const response = await fetch(recklessUrl('manifest.json'), { cache: 'no-cache' });
    answered = true;
    if (response.ok) manifest = await response.json();
  } catch { /* offline */ }
  if (!manifest) {
    const kept = await cache.match(recklessUrl('manifest.json'));
    if (kept) manifest = await kept.json();
  }
  if (!manifest) return { state: answered ? 'missing' : 'offline' };
  let need = 0;
  const total = manifest.pieces.reduce((n, p) => n + p.bytes, 0);
  for (const piece of manifest.pieces) {
    if (!(await cache.match(recklessUrl(piece.file)))) need += piece.bytes;
  }
  if (need && !answered) return { state: 'offline', need, total };
  return { state: need === 0 ? 'ready' : need === total ? 'none' : 'partial', need, total, version: manifest.version };
}

/** What a stopped start tells the person, from the worker's report of it. */
function recklessFailureText(m) {
  if (m.code === 'download') {
    const mb = (n) => (n / 1e6).toFixed(1);
    return `The download stopped at ${mb(m.saved)} of ${mb(m.total)} MB (${m.message}). What arrived is kept — press the button to carry on from there.`;
  }
  return m.message;
}

/**
 * Get Reckless onto the device if it is not, and start it. Every caller gets
 * the same promise; a failure clears it, so asking again carries on the
 * download from the last piece kept.
 *
 * @param {(p: {phase: string, saved: number, total: number}) => void} onProgress
 */
function loadReckless(onProgress) {
  Reckless.onProgress = onProgress ?? null;
  if (Reckless.loading) return Reckless.loading;
  Reckless.loading = new Promise((resolve, reject) => {
    let worker;
    const fail = (message, extra = {}) => {
      try { worker?.terminate(); } catch { /* already gone */ }
      Reckless.worker = null;
      Reckless.loading = null;
      reject(Object.assign(new Error(message), extra));
    };
    try {
      worker = new Worker('reckless-worker.js', { type: 'module' });
    } catch (e) {
      fail(`Reckless could not be started here (${e?.message ?? e}).`);
      return;
    }
    worker.onerror = (e) => fail(`Reckless could not be started${e?.message ? ` (${e.message})` : ''}.`);
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') Reckless.onProgress?.(m);
      else if (m.type === 'failed') fail(recklessFailureText(m), { code: m.code, saved: m.saved, total: m.total });
      else if (m.type === 'ready') {
        worker.onmessage = null;
        worker.onerror = null;
        Reckless.worker = worker;
        Reckless.version = m.version;
        resolve(m);
      }
    };
    worker.postMessage({ type: 'load' });
  });
  return Reckless.loading;
}

/**
 * Search one position — the same question, and the same shape of answer, as
 * stockfishAnalyse(): `moves` are the game's moves from `fen`, in UCI.
 */
function recklessAnalyse(fen, { nodes = RECKLESS_NODES, multipv = 3, moves = [] } = {}) {
  const job = Reckless.queue.then(() => runRecklessSearch(fen, moves, nodes, multipv));
  Reckless.queue = job.catch(() => {});
  return job;
}

async function runRecklessSearch(fen, moves, nodes, multipv) {
  await loadReckless(Reckless.onProgress);
  const worker = Reckless.worker;
  const id = Reckless.nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.onmessage = null;
      try { worker.terminate(); } catch { /* already gone */ }
      Reckless.worker = null;
      Reckless.loading = null;
      reject(new Error('Reckless stopped answering in the middle of a search.'));
    }, RECKLESS_SEARCH_MS);
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.id !== id) return;
      clearTimeout(timer);
      worker.onmessage = null;
      if (m.type === 'error') {
        // An engine that failed mid-search is not asked again: this one goes,
        // and the next question starts a fresh one from the copy kept here.
        try { worker.terminate(); } catch { /* already gone */ }
        Reckless.worker = null;
        Reckless.loading = null;
        reject(new Error(`Reckless stopped working (${m.message}).`));
        return;
      }
      // Its output is standard UCI, so it is read the way Stockfish's is.
      const infos = m.lines.map(parseStockfishInfo).filter(Boolean);
      resolve(summariseStockfish(m.best && m.best !== '(none)' ? m.best : null, infos));
    };
    worker.postMessage({ type: 'go', id, fen, moves, nodes, multipv });
  });
}
