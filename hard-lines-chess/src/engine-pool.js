// ── this app's engine, in workers, several at once ─────────────────────────
//
// A review asks about every position in a game: a hundred searches or so, and
// EACH ONE STANDS ALONE. Every search starts from a cleared table — that is
// what makes the same position come back with the same answer — so none of
// them depends on the one before it, and nothing says they have to be asked
// one after another, or on the thread that draws the page.
//
// So the reviewer's searches are done here: in workers, as many at once as
// the device has cores to spare. Two things follow, and they are the point.
//
//   THE PAGE STAYS A PAGE. A deep search is most of a second on a laptop and
//   more on a phone, and on the page's own thread that is a screen that will
//   not scroll and a Stop button that does not answer until it is over.
//
//   AND IT IS QUICKER BY ABOUT THE NUMBER OF CORES. Measured here with
//   Stockfish, four at once did the same games 3.45 times faster.
//
// THE ANSWERS ARE THE SAME ONES. A worker runs the same engine source the page
// does — the build hands it over as text, see ENGINE_SOURCE — on the same
// position, with the same budget, from the same cleared table. Which worker
// did it, and in what order, is not an input. tests/lanes-drive.cjs holds a
// review done here to the same review done on the page, figure for figure.
//
// AND IT CAN BE MISSING. Where a worker cannot be started — an old browser, a
// page somewhere that forbids them — ownEngineLanes() answers nought and the
// reviewer searches on the page exactly as it always did. Slower, and the
// same answers.

/**
 * How many searches this device should run at once.
 *
 * One core is left for the page. And no more than four, or two on a device
 * that says it is short of memory: each engine is its own copy, tables and
 * all, and a phone that runs out of memory closes the app rather than slowing
 * it down.
 */
function engineLanes() {
  const cores = Number(navigator.hardwareConcurrency) || 2;
  const memory = Number(navigator.deviceMemory) || 4;
  return Math.max(1, Math.min(cores - 1, memory >= 4 ? 4 : 2));
}

/** How long a worker may take to say it has started before it counts as not starting. */
const OWN_ENGINE_START_MS = 8000;

/**
 * The backstop on one search, which is not its budget: the engine stops itself
 * after twenty seconds and says so (see BACKSTOP_MS in the engine). This only
 * frees the lane if a worker ever stops answering altogether.
 */
const OWN_ENGINE_SEARCH_MS = 60000;

const OwnEngine = {
  workers: [],        // started, and answering
  free: [],           // of those, the ones not searching
  waiting: [],        // searches that are waiting for one
  starting: null,     // the promise every caller shares while they start
  url: null,
  jobs: 0,
  patience: OWN_ENGINE_SEARCH_MS,
};

/** What the worker does besides being the engine: one search per message. */
const OWN_ENGINE_LOOP = `
const engine = new Engine();
onmessage = (e) => {
  const { id, fen, nodes, maxDepth, lines } = e.data;
  try {
    const board = new Board(fen);
    engine.reset();
    const found = engine.search(board, { nodes, maxDepth, lines });
    const one = (l) => ({ move: l.move ? moveToUci(l.move) : null, score: l.score, pv: (l.line || []).map(moveToUci) });
    postMessage({ id, ok: true, result: {
      move: found.move ? moveToUci(found.move) : null,
      score: found.score,
      pv: (found.line || []).map(moveToUci),
      lines: (found.lines || []).map(one),
      depth: found.depth,
      nodes: found.nodes,
      ranOutOfTime: Boolean(found.ranOutOfTime),
    } });
  } catch (error) {
    postMessage({ id, ok: false, why: String((error && error.message) || error) });
  }
};
postMessage({ ready: true });
`;

function startOwnEngineWorker() {
  return new Promise((resolve) => {
    let worker;
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!value) { try { worker?.terminate(); } catch { /* already gone */ } }
      resolve(value);
    };
    const timer = setTimeout(() => done(null), OWN_ENGINE_START_MS);
    try {
      OwnEngine.url ??= URL.createObjectURL(new Blob([ENGINE_SOURCE, '\n', OWN_ENGINE_LOOP], { type: 'text/javascript' }));
      worker = new Worker(OwnEngine.url);
    } catch {
      done(null);
      return;
    }
    worker.onerror = () => done(null);
    worker.onmessage = (e) => {
      if (e.data?.ready) {
        worker.onerror = null;
        worker.onmessage = null;
        done(worker);
      }
    };
  });
}

/**
 * Start this app's engine in workers, and say how many are running: nought
 * when none could be started, and the reviewer then searches on the page.
 * Every later call gets the same answer without starting more.
 */
function ownEngineLanes() {
  OwnEngine.starting ??= (async () => {
    if (typeof Worker === 'undefined' || typeof ENGINE_SOURCE !== 'string' || !ENGINE_SOURCE) return 0;
    // One first: if that will not start, the rest will not either, and there
    // is no reason to wait for each of them to say so.
    const first = await startOwnEngineWorker();
    if (!first) return 0;
    const rest = await Promise.all(Array.from({ length: engineLanes() - 1 }, startOwnEngineWorker));
    OwnEngine.workers = [first, ...rest.filter(Boolean)];
    OwnEngine.free = [...OwnEngine.workers];
    return OwnEngine.workers.length;
  })();
  return OwnEngine.starting.then(() => OwnEngine.workers.length);
}

/** A free worker, now or when one comes free. Null when there are none left at all. */
function takeOwnEngine() {
  if (OwnEngine.free.length) return Promise.resolve(OwnEngine.free.shift());
  if (!OwnEngine.workers.length) return Promise.resolve(null);
  return new Promise((resolve) => OwnEngine.waiting.push(resolve));
}

function giveBackOwnEngine(worker) {
  if (!OwnEngine.workers.includes(worker)) {
    // It was retired while it searched. Anyone waiting must not wait for ever
    // on a lane that no longer exists.
    if (!OwnEngine.workers.length) for (const waiter of OwnEngine.waiting.splice(0)) waiter(null);
    return;
  }
  const waiter = OwnEngine.waiting.shift();
  if (waiter) waiter(worker); else OwnEngine.free.push(worker);
}

/**
 * Search one position with this app's engine, in a worker.
 *
 * Answers in the shape Engine.search() does — the move and the line as this
 * board's own moves, scores in the engine's own units — so that what the
 * reviewer does with the answer does not depend on where the search was done.
 * `pv` is the line as the engine wrote it, before it was read back as moves.
 *
 * @param {Board} at  the position
 * @returns {Promise<{move, score, line, lines, depth, nodes, ranOutOfTime, pv}>}
 */
async function ownEngineSearch(at, { nodes, maxDepth, lines = 1 }) {
  const worker = await takeOwnEngine();
  if (!worker) throw new Error('This app’s engine stopped answering.');
  const id = ++OwnEngine.jobs;
  try {
    const found = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // A worker that has stopped answering is finished with: left running,
        // its late answer would be read as the answer to another position.
        worker.onmessage = null;
        try { worker.terminate(); } catch { /* already gone */ }
        OwnEngine.workers = OwnEngine.workers.filter((w) => w !== worker);
        OwnEngine.free = OwnEngine.free.filter((w) => w !== worker);
        reject(new Error('This app’s engine stopped answering in the middle of a search.'));
      }, OwnEngine.patience);
      worker.onmessage = (e) => {
        if (e.data?.id !== id) return;
        clearTimeout(timer);
        worker.onmessage = null;
        if (e.data.ok) resolve(e.data.result); else reject(new Error(e.data.why));
      };
      worker.postMessage({ id, fen: at.fen(), nodes, maxDepth, lines });
    });
    const asMoves = (l) => ({ move: moveFromUci(at, l.move), score: l.score, line: movesFromUci(at, l.pv), pv: l.pv });
    const top = asMoves(found);
    return { ...top, move: top.move ?? 0, lines: found.lines.map(asMoves), depth: found.depth, nodes: found.nodes, ranOutOfTime: found.ranOutOfTime };
  } finally {
    giveBackOwnEngine(worker);
  }
}
