// ── Stockfish, spoken to in UCI ────────────────────────────────────────────
//
// The Watch screen's strong side, and the reference that explains every move
// played in front of it. It is Stockfish 19 Lite, single-threaded, compiled to
// WebAssembly and run in a Web Worker — see vendor/stockfish/README.md for why
// that build — and this is the whole of the conversation with it.
//
// SAME QUESTION, SAME ANSWER, the rule the rest of the app lives by. Every
// search here is given a number of POSITIONS, never a number of seconds, and
// starts from a cleared table (`ucinewgame`), so a position analysed twice
// comes back with the same move, the same score and the same line — on a phone
// or a laptop, today or next month. A time limit would make the explanation of
// a move depend on how busy the device was when it was written.
//
// ONE SEARCH AT A TIME, PER ENGINE. A worker is one engine with one board;
// two searches sent to it together would interleave their output. So each
// worker does one search and then the next — and there can be several
// workers. A review is a hundred searches that do not depend on each other,
// every one from a cleared table, so they are shared out among as many engines
// as the device has cores to spare: measured here, four did the same games
// 3.45 times faster, with the same answers. Which engine answered is not an
// input. The Watch screen asks one question at a time and never starts more
// than the first.
//
// AND IT CAN BE MISSING. A copy of the page opened straight from a file cannot
// start a worker, and a build that lost the .wasm cannot compile one. Neither
// is an error to hide: loadStockfish() rejects with a sentence the Watch
// screen can put in front of the person.

const Stockfish = {
  worker: null,       // the first one started: whether there is an engine at all
  workers: [],        // every one that has started and is still answering
  free: [],           // of those, the ones not searching
  waiting: [],        // searches waiting for one to come free
  loading: null,      // the promise every caller shares while the first starts
  more: null,         // and the one they share while the rest start
  failed: null,       // why it could not start, once it has not
  name: null,         // what it calls itself, from `id name`
  resting: null,      // the timer that lets the extra ones go
  restAfter: 60000,   // how long they are kept with nothing to do, in milliseconds
};

/**
 * How hard Stockfish looks at every position on the Watch screen.
 *
 * Measured in this repository's browser on 2026-09-28: a quarter of a million
 * positions takes about 0.6 s on a laptop, a few seconds on a phone, and puts
 * the engine at depth 13–15 — far beyond any person, and still quick enough
 * that a game can be watched rather than waited for. Positions rather than
 * seconds, so the game played and its explanations are the same on every
 * device.
 */
const STOCKFISH_NODES = 250000;

/** How long a start-up may take before it counts as not starting. */
const STOCKFISH_START_MS = 30000;

/**
 * The backstop on one search, which is not its budget — see Engine.search for
 * the same distinction. A search is ended by its node count; this only frees
 * the queue if a worker ever stops answering altogether.
 */
const STOCKFISH_SEARCH_MS = 120000;

/** Start the engine once. Every later call gets the same promise. */
function loadStockfish() {
  if (Stockfish.loading) return Stockfish.loading;
  Stockfish.loading = startStockfishWorker().then((worker) => {
    Stockfish.worker = worker;
    Stockfish.workers = [worker];
    Stockfish.free = [worker];
    Stockfish.failed = null;
    return worker;
  }, (error) => {
    Stockfish.worker = null;
    Stockfish.failed = error.message;
    throw error;
  });
  return Stockfish.loading;
}

/**
 * Start as many engines as this device should run at once, and say how many
 * are running. The first has to start, or this rejects with why; any of the
 * others that will not start is simply one fewer.
 */
async function stockfishLanes(want = engineLanes()) {
  await loadStockfish();
  Stockfish.more ??= (async () => {
    const extra = await Promise.all(Array.from({ length: Math.max(0, want - 1) }, () => startStockfishWorker().catch(() => null)));
    for (const worker of extra) {
      if (!worker) continue;
      Stockfish.workers.push(worker);
      giveBackStockfish(worker);
    }
  })();
  await Stockfish.more;
  return Math.max(1, Stockfish.workers.length);
}

/** One engine, started and ready — or a rejection with the reason it is not. */
function startStockfishWorker() {
  return new Promise((resolve, reject) => {
    let worker;
    let settled = false;
    const fail = (why) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { worker?.terminate(); } catch { /* already gone */ }
      reject(new Error(why));
    };
    const timer = setTimeout(() => fail('Stockfish did not answer within 30 seconds of starting.'), STOCKFISH_START_MS);

    // A page opened from a file has no origin to start a worker from, and says
    // so by throwing here or by failing to fetch the script; both are caught.
    if (location.protocol === 'file:') {
      fail('Stockfish runs in a background worker, and a copy of the page opened straight from a file cannot start one. It works in the installed app and on the website.');
      return;
    }
    try {
      worker = new Worker('stockfish.js');
    } catch (e) {
      fail(`Stockfish could not be started here (${e?.message ?? e}).`);
      return;
    }
    worker.onerror = (e) => {
      fail(`Stockfish could not be loaded${e?.message ? ` (${e.message})` : ''}. The engine files may be missing from this copy of the app.`);
    };
    worker.onmessage = (e) => {
      const line = String(e.data);
      if (line.startsWith('id name ')) Stockfish.name = line.slice(8).trim();
      if (line === 'uciok') worker.postMessage('isready');
      else if (line === 'readyok' && !settled) {
        settled = true;
        clearTimeout(timer);
        worker.onmessage = null;
        worker.onerror = null;
        resolve(worker);
      }
    };
    worker.postMessage('uci');
  });
}

/** An engine that is not searching, now or when one comes free. Starts one if there are none left. */
async function takeStockfish() {
  for (;;) {
    if (Stockfish.free.length) return Stockfish.free.shift();
    if (!Stockfish.workers.length) {
      // Every one has been retired. The next question starts again from none.
      Stockfish.loading = null;
      Stockfish.more = null;
      await loadStockfish();
      continue;
    }
    await new Promise((resolve) => Stockfish.waiting.push(resolve));
  }
}

/** An engine has finished its search — or been retired during it. Whoever is waiting looks again. */
function giveBackStockfish(worker) {
  if (Stockfish.workers.includes(worker) && !Stockfish.free.includes(worker)) Stockfish.free.push(worker);
  const waiter = Stockfish.waiting.shift();
  if (waiter) waiter();
  restStockfishSoon();
}

/**
 * Let the extra engines go once there has been nothing for them to do for a
 * while. Each is its own copy of Stockfish, tables and all, and on a phone
 * that memory is better given back than held for a walk that finished ten
 * minutes ago. The first is kept: the Watch screen uses it, and starting one
 * takes a moment. The next review starts the others again.
 */
function restStockfishSoon() {
  clearTimeout(Stockfish.resting);
  Stockfish.resting = setTimeout(() => {
    if (Stockfish.workers.length < 2) return;
    if (Stockfish.waiting.length || Stockfish.free.length !== Stockfish.workers.length) return;
    for (const worker of Stockfish.workers.slice(1)) {
      try { worker.terminate(); } catch { /* already gone */ }
    }
    Stockfish.workers = Stockfish.workers.slice(0, 1);
    Stockfish.free = [...Stockfish.workers];
    Stockfish.worker = Stockfish.workers[0];
    Stockfish.more = null;
  }, Stockfish.restAfter);
}

/**
 * One line of `info` output, or null for the lines that carry no line.
 *
 * `score cp 13` is centipawns and `score mate 3` is mate in three, both from
 * the side to move. A score marked `lowerbound` or `upperbound` is the engine
 * saying the true value lies beyond that number — a search that the node
 * budget stopped halfway through an iteration — and it is kept, but flagged,
 * so the summary can prefer a finished one.
 */
function parseStockfishInfo(line) {
  if (!line.startsWith('info ') || line.indexOf(' pv ') === -1) return null;
  const words = line.split(/\s+/);
  const out = { depth: 0, multipv: 1, score: null, bound: false, nodes: 0, pv: [] };
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (w === 'depth') out.depth = Number(words[++i]);
    else if (w === 'multipv') out.multipv = Number(words[++i]);
    else if (w === 'nodes') out.nodes = Number(words[++i]);
    else if (w === 'score') {
      const kind = words[++i];
      const value = Number(words[++i]);
      out.score = kind === 'mate' ? { mate: value } : { cp: value };
    } else if (w === 'lowerbound' || w === 'upperbound') out.bound = true;
    else if (w === 'pv') { out.pv = words.slice(i + 1).filter(Boolean); break; }
  }
  return out.score && out.pv.length ? out : null;
}

/**
 * A score as one number to compare, from the side to move: centipawns, or a
 * mate pushed beyond any centipawn figure, sooner mates further out.
 */
function stockfishValue(score) {
  if (!score) return 0;
  if (score.mate !== undefined) {
    if (score.mate === 0) return -100000;              // mated on the board already
    return score.mate > 0 ? 100000 - score.mate : -100000 - score.mate;
  }
  return score.cp;
}

/**
 * What the search found, one entry per candidate move.
 *
 * THE LAST FINISHED LINE WINS, where there is one. The node budget stops a
 * search wherever it happens to be, which is usually partway through an
 * iteration: the move reported there is sound — Stockfish only ever reports
 * a move it has proved at least as good as the last — but its score is a
 * bound and its line is often cut to a move or two. For each candidate the
 * deepest line that was not cut short is used, provided it starts with the
 * same move; otherwise the cut one stands, flagged.
 */
function summariseStockfish(best, infos) {
  const byRank = new Map();
  for (const info of infos) {
    const list = byRank.get(info.multipv) ?? [];
    list.push(info);
    byRank.set(info.multipv, list);
  }
  const lines = [];
  for (const rank of [...byRank.keys()].sort((a, b) => a - b)) {
    const list = byRank.get(rank);
    const last = list[list.length - 1];
    const whole = [...list].reverse().find((l) => !l.bound && l.pv[0] === last.pv[0]);
    const pick = whole ?? last;
    lines.push({ rank, move: pick.pv[0], pv: pick.pv, score: pick.score, depth: pick.depth, bound: pick.bound });
  }
  // THE BEST LINE IS THE BEST MOVE. If an unfinished iteration moved the best
  // move to a new one, the first entry is rebuilt from whatever line that move
  // was last seen at the head of, so the list never leads with a move the
  // engine did not choose.
  if (best && lines.length && lines[0].move !== best) {
    const seen = [...infos].reverse().find((l) => l.pv[0] === best);
    if (seen) {
      const others = lines.filter((l) => l.move !== best);
      lines.length = 0;
      lines.push({ rank: 1, move: best, pv: seen.pv, score: seen.score, depth: seen.depth, bound: seen.bound }, ...others);
    }
  }
  const nodes = infos.reduce((n, l) => Math.max(n, l.nodes), 0);
  return { best, lines, nodes, depth: lines[0]?.depth ?? 0 };
}

/**
 * Search one position.
 *
 * GIVE IT THE GAME, NOT JUST THE POSITION, where there is a game: `moves` are
 * the moves played from `fen` to reach the position to search, and with them
 * Stockfish knows which positions have been on the board before. From a bare
 * FEN it cannot see a repetition coming, and will walk a won game into a draw
 * it did not know was there.
 *
 * @param {string} fen  the position searched — or, with `moves`, the one the game started from
 * @param {{nodes?: number, multipv?: number, moves?: string[]}} opts  `moves` in UCI
 * @returns {Promise<{best: string, lines: Array<{move, pv, score, depth, bound}>, nodes: number, depth: number}>}
 *   Moves are UCI strings. Scores are from the side to move.
 */
async function stockfishAnalyse(fen, { nodes = STOCKFISH_NODES, multipv = 3, moves = [] } = {}) {
  const position = moves.length ? `position fen ${fen} moves ${moves.join(' ')}` : `position fen ${fen}`;
  await loadStockfish();
  const worker = await takeStockfish();
  try {
    return await runStockfishSearch(worker, position, nodes, multipv);
  } finally {
    giveBackStockfish(worker);
  }
}

function runStockfishSearch(worker, position, nodes, multipv) {
  return new Promise((resolve, reject) => {
    const infos = [];
    const timer = setTimeout(() => {
      // AND THAT ENGINE IS FINISHED WITH. Left running, it could still answer
      // the search it abandoned — and that late "bestmove" would be read as
      // the answer to whichever position was asked next. The next question
      // starts a fresh one.
      worker.onmessage = null;
      try { worker.terminate(); } catch { /* already gone */ }
      Stockfish.workers = Stockfish.workers.filter((w) => w !== worker);
      Stockfish.free = Stockfish.free.filter((w) => w !== worker);
      if (Stockfish.worker === worker) Stockfish.worker = Stockfish.workers[0] ?? null;
      reject(new Error('Stockfish stopped answering in the middle of a search.'));
    }, STOCKFISH_SEARCH_MS);
    worker.onmessage = (e) => {
      const line = String(e.data);
      if (line.startsWith('info ')) {
        const info = parseStockfishInfo(line);
        if (info) infos.push(info);
      } else if (line.startsWith('bestmove')) {
        clearTimeout(timer);
        worker.onmessage = null;
        const best = line.split(/\s+/)[1];
        // "(none)" is the engine's word for a position with no legal move.
        resolve(summariseStockfish(best && best !== '(none)' ? best : null, infos));
      }
    };
    // A cleared table first, every time: the same position must not be judged
    // differently for having been reached after a different search.
    worker.postMessage('ucinewgame');
    worker.postMessage(`setoption name MultiPV value ${multipv}`);
    worker.postMessage(position);
    worker.postMessage(`go nodes ${nodes}`);
  });
}
