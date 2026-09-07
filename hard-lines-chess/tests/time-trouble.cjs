// Where the time goes — the two numbers nothing else puts side by side.
//
// Everybody knows they blunder in time trouble. Almost nobody knows that half
// their lost points go on moves they played in two seconds with twenty minutes
// on the clock, because the clock is in the movetext and what the move cost is
// in the review, and no screen has ever joined them.
//
// WHAT IS CHECKED is the join, and the refusals around it. A game contributes
// nothing unless it has BOTH a clock on every ply and a walk by the engine,
// and a finding drawn from four of two hundred games is a different claim from
// the same sentence drawn from all of them — so what gets left out has to be
// counted and said.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');

(async () => {
  const srv = serve(DIST, 8293);
  await srv.ready;
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 1400 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const say = (k, v) => console.log(String(k).padEnd(48), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got) : `${got}   <- expected ${want}`);
    if (!ok) failures.push(what);
  };

  await page.goto('http://127.0.0.1:8293/hard-lines-chess-app.html');
  await page.waitForSelector('#tab-today', { timeout: 20000 });

  // A history built so the answer is known in advance: White's fast moves are
  // the ones that throw away material, and the slow ones are clean. If the
  // join is wrong by even one ply the two groups swap over.
  const built = await page.evaluate(() => {
    const game = FAMOUS_GAMES.find((g) => g.id === 'opera');
    const plies = parsePgn(`[Result "*"]\n\n${game.moves}`).plies;
    const n = plies.length;

    // A curve where every one of White's moves on an even index loses a lot
    // and the rest lose nothing.
    const curve = [0];
    const marks = [];
    for (let i = 0; i < n; i++) {
      const white = i % 2 === 0;
      const costly = white && (i % 4 === 0);
      // White's loss is a FALL in the curve; Black's moves leave it alone.
      curve.push(curve[i] - (costly ? 320 : 0));
      marks.push(costly ? 'X' : '.');
    }

    // An hour each, because White spends 40s on most of seventeen moves and a
    // three-minute clock would run out — a clock that goes negative is not a
    // clock, and the reader would refuse it rather than report a fast move.
    // White spends 1s on the costly moves and 40s on the others; Black takes
    // 5s throughout. The clock recorded is what is left AFTER the move.
    let wLeft = 3600, bLeft = 3600;
    const clocked = [];
    for (let i = 0; i < n; i++) {
      const white = i % 2 === 0;
      const took = white ? (i % 4 === 0 ? 1 : 40) : 5;
      if (white) { wLeft -= took; } else { bLeft -= took; }
      const left = white ? wLeft : bLeft;
      const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), sec = left % 60;
      clocked.push(`${i % 2 === 0 ? `${i / 2 + 1}. ` : `${(i + 1) / 2}... `}${plies[i].san} {[%clk ${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}]}`);
    }
    const pgn = `[Event "T"]\n[White "you"]\n[Black "them"]\n[Result "1-0"]\n[TimeControl "3600"]\n\n${clocked.join(' ')} 1-0`;

    // Four of them, because nine moves in a group is deliberately not enough
    // for the panel to draw a conclusion from. That guard is the reason the
    // sentence is worth reading, so the test clears it honestly rather than
    // having it lowered.
    App.reviews.games = Array.from({ length: 4 }, (_, k) => ({
      at: 1000 + k, white: 'you', black: 'them', result: '1-0', side: 'white', plies: n,
      reviewed: true, accuracy: 60, meanLoss: 80, depth: 7, mistakes: [], timeClass: 'blitz',
      myRating: 1000, timeControl: '3600', source: 'chess.com',
      pgn, curve, marks: marks.join(''),
    }));
    return { n, clocks: clocksFrom(pgn, n)?.length ?? 0 };
  });
  say('game built', `${built.n} plies, ${built.clocks} clocks`);
  check('every ply carries a clock', built.clocks, built.n);

  const found = await page.evaluate(() => timeTrouble(App.reviews.games));
  say('used / skipped / moves', `${found.used} / ${found.skipped} / ${found.moves}`);
  check('all four are usable', found.used, 4);
  check('and none was skipped', found.skipped, 0);

  const spent = Object.fromEntries(found.spent.filter((r) => r.n).map((r) => [r.label, r]));
  say('by time spent', found.spent.filter((r) => r.n).map((r) => `${r.label}: ${(r.meanLoss / 100).toFixed(2)} x${r.n}`).join('  '));
  // Every costly move took 1s and every clean one took 40s. If the clock is
  // joined to the right move, those are the only two groups that exist.
  check('the 1s moves land in "under 2s"', Boolean(spent['under 2s']), true);
  check('and the 40s ones in "over 30s"', Boolean(spent['over 30s']), true);
  check('nothing lands in between', found.spent.filter((r) => r.n).length, 2);
  check('the fast moves carry the whole cost', Math.round(spent['under 2s'].meanLoss), 300);
  check('and the slow ones none of it', Math.round(spent['over 30s'].meanLoss), 0);
  check('the blunder rate follows them', spent['under 2s'].blunderRate, 1);
  check('and every move of yours is counted once', found.moves, 68);

  // The clock ran down through the game, so the later moves are the ones with
  // little left — a different cut of the same moves.
  say('by clock left', found.left.filter((r) => r.n).map((r) => `${r.label}: ${(r.meanLoss / 100).toFixed(2)} x${r.n}`).join('  '));
  check('the clock-left cut sees the same moves',
    found.left.reduce((s, r) => s + r.n, 0), found.spent.reduce((s, r) => s + r.n, 0));

  // ── and it says so on screen ─────────────────────────────────────────────
  await gotoSection(page, 'progress');
  await page.waitForTimeout(600);
  const text = await page.$eval('#progressOut', (e) => e.textContent);
  check('the panel is on the progress screen', text.includes('Where your time goes'), true);
  // The whole paragraph, not a regex up to the first full stop — "3.00" has
  // one in the middle of it and the first version of this read the sentence as
  // "Your quick moves cost you 3."
  const verdict = await page.$$eval('#progressOut p',
    (ps) => ps.map((p) => p.textContent).find((t) => t.startsWith('Your quick moves')) ?? '(none)');
  say('the verdict reads', verdict);
  // The strongest finding this can make is quick moves throwing away material
  // while the slow ones cost nothing — which is also the case with no ratio to
  // quote. It has to read as the finding it is, not as "about the same".
  check('it names the gap in points', /cost you 3\.00 points each against 0\.00/.test(verdict), true);
  check('and does not claim they are alike', /about the same/.test(verdict), false);
  check('nor quote a multiple of nothing', /times as much/.test(verdict), false);

  // ── the refusals ─────────────────────────────────────────────────────────
  const refused = await page.evaluate(() => {
    const good = App.reviews.games[0];
    const noClock = { ...good, pgn: good.pgn.replace(/\{\[%clk[^}]*\}/g, '') };
    const noWalk = { ...good, curve: undefined, marks: undefined };
    return {
      unclocked: timeTrouble([noClock]),
      unwalked: timeTrouble([noWalk]),
      mixed: timeTrouble([good, noClock, noWalk]),
    };
  });
  check('a game with no clocks is refused', refused.unclocked.moves, 0);
  check('and counted as left out', refused.unclocked.skipped, 1);
  check('a game the engine has not walked is too', refused.unwalked.skipped, 1);
  check('and a mixed history uses only what it can', refused.mixed.used, 1);
  check('while saying how many it could not', refused.mixed.skipped, 2);

  // With nothing usable at all the panel must say what is missing rather than
  // draw empty bars.
  await page.evaluate(() => {
    App.reviews.games = App.reviews.games.map((g) => ({ ...g, curve: undefined, marks: undefined }));
    renderProgress();
  });
  await page.waitForTimeout(400);
  const empty = await page.$eval('#progressOut', (e) => e.textContent);
  check('with nothing usable it says what is needed', empty.includes('needs games that carry a clock'), true);
  check('rather than drawing empty bars', await page.$$eval('#progressOut .timebar', (e) => e.length), 0);

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
