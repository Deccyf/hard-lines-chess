// Several engines at once — and the same answers as one.
//
// A review asks about every position in a game, and no answer depends on
// another: every search starts from a cleared table. So the reviewer shares
// the positions out among as many engines as the device has cores to spare —
// several Stockfish workers, or this app's own engine in several workers
// rather than on the page's own thread. That is quicker, and it leaves the
// page free to be a page. What it must not do is change a single figure.
//
// What has to be true:
//
//   A. THIS APP'S ENGINE IN WORKERS GIVES THE REVIEW IT GIVES ON THE PAGE —
//      every evaluation, mistake, class of move, line and tactic — at each
//      setting. And a browser that cannot start a worker still reviews, on
//      the page, to the same figures.
//
//   B. THE PAGE STAYS A PAGE. During a deep review the page's own thread is
//      never held for long; searched on the page, it is held for the length
//      of every search.
//
//   C. SEVERAL STOCKFISH GIVE THE REVIEW ONE GIVES, and sooner. The extra
//      ones are let go when there has been nothing for them to do for a
//      while, and started again by the next review.
//
//   D. THE WALK STORES THE SAME FIGURES EITHER WAY — the whole path, through
//      the screen, not only the function underneath it.
//
//   E. AN ENGINE THAT STOPS ANSWERING ENDS THE REVIEW WITH THE REASON, hangs
//      nothing, and is not used again; the next review runs on the ones left,
//      or on the page when none are, to the same figures.
//
//   F. A COPY OPENED FROM A FILE reviews to the same figures too, wherever its
//      searching ends up being done.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');
const fs = require('fs');
const path = require('path');

const PORT = 8316;
const base = `http://127.0.0.1:${PORT}/`;
const played = fs.readFileSync(path.join(__dirname, '..', 'tools', 'rating-games.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));
const GAMES = [[300, 0], [600, 1], [900, 1]].map(([elo, g]) => played.find((r) => r.elo === elo && r.game === g).pgn);

(async () => {
  const srv = serve(path.join(DIST, 'pwa'), PORT);
  await srv.ready;
  const browser = await launch();
  const say = (k, v) => console.log(String(k).padEnd(64), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got).slice(0, 100) : `${String(got).slice(0, 300)}   <- expected ${String(want).slice(0, 300)}`);
    if (!ok) failures.push(what);
  };
  const errors = [];

  const open = async ({ init = [], url = base } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    for (const script of init) await page.addInitScript(script);
    await page.goto(url);
    await page.waitForSelector('#tab-today', { timeout: 20000 });
    return page;
  };
  // A browser with no workers at all.
  const NO_WORKERS = () => { delete window.Worker; window.Worker = undefined; };

  // Everything a review decides, as text, and how long it took.
  const review = (page, pgn, { nodes, depth, judge = null, plies = 0 }) => page.evaluate(async ({ pgn, nodes, depth, judge, plies }) => {
    const parsed = parsePgn(pgn);
    if (plies) parsed.plies.length = Math.min(parsed.plies.length, plies);
    const asked = judge === 'stockfish' ? JUDGES.stockfish
      : (judge === 'stockfish, one at a time' ? { name: 'stockfish', analyse: JUDGES.stockfish.analyse } : null);
    const t0 = performance.now();
    const r = await reviewGame(parsed, 'white', { nodes, depth, judge: asked });
    const ms = Math.round(performance.now() - t0);
    return { ms, positions: r.evals.length, late: r.ranOutOfTime, text: JSON.stringify({
      evals: r.evals, mistakes: r.mistakes, accuracy: r.accuracy, counted: r.counted, judged: r.judged, whiteCp: r.whiteCp,
      tactics: r.tactics, capped: r.capped, passed: r.tacticsPassed, unchecked: r.tacticsUnchecked, meanLoss: r.meanLoss, judge: r.judge,
    }) };
  }, { pgn, nodes, depth, judge, plies });

  // ── A. this app's engine: in workers, and on the page ─────────────────────
  const inWorkers = await open();
  const onPage = await open({ init: [NO_WORKERS] });
  const lanes = await inWorkers.evaluate(async () => ({ running: await ownEngineLanes(), wanted: engineLanes(), cores: navigator.hardwareConcurrency }));
  say('A: this device', `${lanes.cores} cores, ${lanes.wanted} searches at once`);
  check('A: this app\'s engine starts in as many workers as the device should run', lanes.running, lanes.wanted);
  check('A: a browser with no workers has none, and says so rather than failing', await onPage.evaluate(() => ownEngineLanes()), 0);

  const SETTINGS = [['Quick', 25000, 7, 0], ['Normal', 80000, 9, 1], ['Deep', 250000, 12, 2]];
  const reviews = {};
  for (const [name, nodes, depth, g] of SETTINGS) {
    // Deep is a quarter of a million positions a move: forty plies of it is enough to tell.
    const plies = name === 'Deep' ? 40 : 0;
    const there = await review(inWorkers, GAMES[g], { nodes, depth, plies });
    const here = await review(onPage, GAMES[g], { nodes, depth, plies });
    reviews[name] = { there, here };
    say(`A: ${name}, ${there.positions} positions`, `${there.ms} ms in workers, ${here.ms} ms on the page (${(here.ms / there.ms).toFixed(2)}× quicker)`);
    check(`A: ${name}: the review in workers is the review on the page, to the last figure`, there.text === here.text, true);
    check(`A: ${name}: and no search was cut short by the clock either way`, `${there.late} ${here.late}`, '0 0');
    check(`A: ${name}: with something in it to compare`, JSON.parse(there.text).mistakes.length > 0 && JSON.parse(there.text).judged.length > 20, true);
  }
  if (lanes.running >= 3) {
    check('A: and with three or more at once it is more than one and a half times as quick', reviews.Normal.here.ms / reviews.Normal.there.ms > 1.5, true);
  }
  const twice = await review(inWorkers, GAMES[1], { nodes: 80000, depth: 9 });
  check('A: asked again, the same review comes back', twice.text === reviews.Normal.there.text, true);

  // ── B. the page stays a page ───────────────────────────────────────────────
  //
  // The longest the page's own thread went without a turn while a deep review
  // ran: a timer set for every ten milliseconds says how late it was.
  const longestHold = (page) => page.evaluate(async (pgn) => {
    const parsed = parsePgn(pgn);
    parsed.plies.length = Math.min(parsed.plies.length, 24);
    let last = performance.now();
    let longest = 0;
    const ticking = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 10);
    await reviewGame(parsed, 'white', { nodes: 250000, depth: 12, withTactics: false });
    clearInterval(ticking);
    return Math.round(longest);
  }, GAMES[2]);
  const heldThere = await longestHold(inWorkers);
  const heldHere = await longestHold(onPage);
  say('B: the longest the page was held during a deep review', `${heldThere} ms in workers, ${heldHere} ms on the page`);
  check('B: in workers the page is never held for a quarter of a second', heldThere < 250, true);
  check('B: on the page it is held for the length of a search, which is the fault this removes', heldHere > heldThere * 2, true);

  // ── C. Stockfish: several, and one ─────────────────────────────────────────
  const several = await inWorkers.evaluate(() => stockfishLanes());
  say('C: Stockfish engines started', several);
  check('C: as many as the device should run', several, lanes.wanted);
  const shared = await review(inWorkers, GAMES[1], { nodes: 80000, depth: 9, judge: 'stockfish' });
  const single = await review(inWorkers, GAMES[1], { nodes: 80000, depth: 9, judge: 'stockfish, one at a time' });
  say(`C: ${shared.positions} positions`, `${shared.ms} ms shared out, ${single.ms} ms one at a time (${(single.ms / shared.ms).toFixed(2)}× quicker)`);
  check('C: the review shared out is the review done one at a time, to the last figure', shared.text === single.text, true);
  check('C: and it is Stockfish\'s', JSON.parse(shared.text).judge, 'stockfish');
  if (several >= 3) check('C: and with three or more it is more than one and a half times as quick', single.ms / shared.ms > 1.5, true);
  const again = await review(inWorkers, GAMES[1], { nodes: 80000, depth: 9, judge: 'stockfish' });
  check('C: asked again, the same review comes back', again.text === shared.text, true);
  // With nothing to do, the extra ones are let go — and come back when wanted.
  await inWorkers.evaluate(() => { Stockfish.restAfter = 300; restStockfishSoon(); });
  await inWorkers.waitForFunction(() => Stockfish.workers.length === 1, null, { timeout: 10000 });
  check('C: left idle, all but the first are let go', await inWorkers.evaluate(() => `${Stockfish.workers.length} ${Stockfish.free.length} ${Stockfish.worker === Stockfish.workers[0]}`), '1 1 true');
  await inWorkers.evaluate(() => { Stockfish.restAfter = 60000; });
  const rested = await review(inWorkers, GAMES[1], { nodes: 80000, depth: 9, judge: 'stockfish' });
  check('C: the next review starts them again', await inWorkers.evaluate(() => Stockfish.workers.length), several);
  check('C: and gives the same review', rested.text === shared.text, true);

  // ── D. the walk, through the screen ────────────────────────────────────────
  const JUDGED = ['reviewed', 'accuracy', 'meanLoss', 'mistakes', 'tactics', 'depth', 'nodes', 'judge', 'curve', 'marks', 'counted', 'estimate'];
  const walked = async (page) => {
    await gotoSection(page, 'review');
    await page.evaluate((games) => {
      App.reviews.games = games.map((text, i) => ({ at: Date.UTC(2026, 8, 1) + i * 86400000, white: 'you', black: 'them', result: '*', side: 'white',
        plies: parsePgn(text).plies.length, reviewed: false, accuracy: null, mistakes: [], pgn: text, source: 'chess.com', url: `lanes-${i}` }));
      App.drills.items = [];
      App.puzzles.items = [];
      App.puzzles.scanned = [];
      return Promise.all([Store.set('reviews', App.reviews), Store.set('drills', App.drills), Store.set('puzzles', App.puzzles)]);
    }, GAMES);
    await page.selectOption('#walkJudge', 'app');
    await page.selectOption('#walkDepth', '7');
    const t0 = Date.now();
    await page.evaluate(() => walkImported());
    return { ms: Date.now() - t0, note: await page.$eval('#walkNote', (e) => e.textContent),
      stored: await page.evaluate((JUDGED) => JSON.stringify(App.reviews.games.map((g) => Object.fromEntries(JUDGED.map((k) => [k, g[k] ?? null])))), JUDGED),
      drills: await page.evaluate(() => JSON.stringify(App.drills.items.map((d) => `${d.fen} ${d.best?.uci}`).sort())),
      puzzles: await page.evaluate(() => JSON.stringify(App.puzzles.items.map((p) => `${p.fen} ${p.best?.uci}`).sort())) };
  };
  const walkThere = await walked(inWorkers);
  const walkHere = await walked(onPage);
  say('D: three games walked', `${walkThere.ms} ms in workers, ${walkHere.ms} ms on the page`);
  check('D: the walk stores the same figures either way', walkThere.stored === walkHere.stored, true);
  check('D: makes the same drills', walkThere.drills === walkHere.drills && JSON.parse(walkThere.drills).length > 0, true);
  check('D: files the same puzzles', walkThere.puzzles === walkHere.puzzles, true);
  check('D: and says the same thing about it', walkThere.note === walkHere.note && /^3 reviewed\./.test(walkThere.note), true);

  // ── E. an engine that stops answering ──────────────────────────────────────
  const stopped = await inWorkers.evaluate(async (pgn) => {
    const before = OwnEngine.workers.length;
    OwnEngine.patience = 400;
    // One of them takes its question and never answers.
    const dead = OwnEngine.free[0];
    dead.postMessage = () => {};
    const parsed = parsePgn(pgn);
    let why = null;
    const t0 = performance.now();
    try { await reviewGame(parsed, 'white', { nodes: 25000, depth: 7 }); } catch (e) { why = e.message; }
    const ms = Math.round(performance.now() - t0);
    OwnEngine.patience = 60000;
    return { why, ms, before, after: OwnEngine.workers.length, free: OwnEngine.free.length, waiting: OwnEngine.waiting.length, kept: OwnEngine.workers.includes(dead) };
  }, GAMES[0]);
  check('E: a review whose engine stops answering ends, with the reason', stopped.why, 'This app’s engine stopped answering in the middle of a search.');
  check('E: promptly, rather than hanging', stopped.ms < 20000, true);
  check('E: the one that stopped is not used again', `${stopped.before - stopped.after} ${stopped.kept}`, '1 false');
  await inWorkers.waitForFunction(() => OwnEngine.free.length === OwnEngine.workers.length && OwnEngine.waiting.length === 0, null, { timeout: 30000 });
  const after = await review(inWorkers, GAMES[0], { nodes: 25000, depth: 7 });
  check('E: the next review runs on the ones left, to the same figures', after.text === reviews.Quick.there.text, true);
  const none = await inWorkers.evaluate(async (pgn) => {
    OwnEngine.patience = 400;
    for (const worker of OwnEngine.workers) worker.postMessage = () => {};
    let why = null;
    try { await reviewGame(parsePgn(pgn), 'white', { nodes: 25000, depth: 7 }); } catch (e) { why = e.message; }
    OwnEngine.patience = 60000;
    await new Promise((r) => setTimeout(r, 1500));
    return { why, left: OwnEngine.workers.length, lanes: await ownEngineLanes() };
  }, GAMES[0]);
  check('E: with every one of them stopped, the review still ends with the reason', /stopped answering/.test(none.why ?? ''), true);
  check('E: and none is left', `${none.left} ${none.lanes}`, '0 0');
  const fallen = await review(inWorkers, GAMES[0], { nodes: 25000, depth: 7 });
  check('E: after which the reviewer searches on the page, to the same figures', fallen.text === reviews.Quick.there.text, true);

  // ── F. a copy opened from a file ───────────────────────────────────────────
  const copy = await open({ url: `file://${path.join(DIST, 'hard-lines-chess-app.html')}` });
  const fileLanes = await copy.evaluate(() => ownEngineLanes());
  say('F: opened from a file, this app\'s engine runs in', fileLanes ? `${fileLanes} workers` : 'the page');
  const fromFile = await review(copy, GAMES[0], { nodes: 25000, depth: 7 });
  check('F: and reviews to the same figures', fromFile.text === reviews.Quick.there.text, true);

  console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
  if (errors.length) failures.push('page errors');
  await browser.close();
  srv.stop?.();
  if (failures.length) { console.log(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1); }
  console.log('ok');
  process.exit(0);
})().catch((e) => { console.error(e); console.log('FAILED'); process.exit(1); });
