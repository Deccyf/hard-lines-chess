// A history judged again is the history that judge would have made — on every
// screen that reads it.
//
// Changing judge re-walks every stored game. The worry this driver answers is
// that something is left over from the judge before: a field the walk did not
// replace, a cache that did not notice, a drill still asking for the old
// judge's move. So the same games are judged two ways —
//
//   A: walked by this app's engine, looked at, then judged again by Stockfish
//   B: judged by Stockfish from the start, in a fresh browser
//
// — and everything A ends up with must be what B has: every stored figure,
// every chart and panel on Progress, the reopened review, the drills.
//
// And around that, the ways a judgement can go wrong:
//
//   - the judge stopping halfway through a walk leaves every game it had not
//     finished exactly as it was, and never marks a game as unreadable;
//   - a game reviewed again on the Review screen replaces its earlier review
//     rather than being counted twice, and keeps where it came from;
//   - a game walked before the move by move record was kept is offered, and
//     walked again at its own setting, coming back with the same figures;
//   - the strength estimate on Progress comes from the calibration, not from
//     whatever was stored with the game;
//   - a drill says whose answer it asks for.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');
const fs = require('fs');
const path = require('path');

const PORT = 8313;
const base = `http://127.0.0.1:${PORT}/`;

// Four games from the rating calibration: short, lively, with mistakes enough
// for drills. Clocks are added so "Where your time goes" has something to say.
const played = fs.readFileSync(path.join(__dirname, '..', 'tools', 'rating-games.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));
const PICK = [[300, 0], [300, 1], [600, 1], [0, 3]];      // [level, game]
const MOVES = PICK.map(([elo, g]) => played.find((r) => r.elo === elo && r.game === g).pgn);

(async () => {
  const srv = serve(path.join(DIST, 'pwa'), PORT);
  await srv.ready;
  const browser = await launch();
  const say = (k, v) => console.log(String(k).padEnd(58), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got) : `${String(got).slice(0, 300)}   <- expected ${String(want).slice(0, 300)}`);
    if (!ok) failures.push(what);
  };
  const errors = [];

  const open = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.waitForSelector('#tab-today', { timeout: 20000 });
    await gotoSection(page, 'review');
    return page;
  };

  /** The four games, stored as an import leaves them: clocked, rated, not yet walked. */
  const seed = (page) => page.evaluate((moves) => {
    const DAY = 86400000;
    App.reviews.games = moves.map((text, i) => {
      const plies = parsePgn(text).plies;
      const pace = [3, 12, 25, 7, 2, 18, 5];
      let mine = 600, theirs = 600;
      const clocked = plies.map((p, k) => {
        const white = k % 2 === 0;
        if (white) mine -= pace[k % pace.length]; else theirs -= 6;
        const left = Math.max(1, white ? mine : theirs);
        const clock = `0:${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
        return `${white ? `${k / 2 + 1}. ` : ''}${p.san} {[%clk ${clock}]}`;
      });
      return {
        at: Date.UTC(2026, 8, 1) + i * DAY, white: 'you', black: 'them', result: '*', side: 'white',
        plies: plies.length, reviewed: false, accuracy: null, mistakes: [],
        pgn: `[White "you"]\n[Black "them"]\n[Result "*"]\n[TimeControl "600"]\n\n${clocked.join(' ')} *`,
        source: 'chess.com', url: `rejudge-${i}`, myRating: 900 + i * 25, timeControl: '600', timeClass: 'rapid',
      };
    });
    App.drills.items = [];
    return Promise.all([Store.set('reviews', App.reviews), Store.set('drills', App.drills)]).then(() => renderImport());
  }, MOVES);

  const walk = async (page, judge, depth = '7') => {
    await gotoSection(page, 'review');
    await page.selectOption('#walkJudge', judge);
    await page.selectOption('#walkDepth', depth);
    await page.evaluate(() => walkImported());
    return page.$eval('#walkNote', (e) => e.textContent);
  };

  // Everything a judge decides about a game, as stored.
  const JUDGED = ['reviewed', 'accuracy', 'meanLoss', 'mistakes', 'tactics', 'depth', 'nodes', 'judge', 'curve', 'marks', 'counted', 'estimate', 'walkFailed'];
  // And what the game is, which judging must never touch.
  const IDENTITY = ['at', 'white', 'black', 'side', 'plies', 'pgn', 'source', 'url', 'myRating', 'timeControl', 'timeClass'];
  const stored = (page) => page.evaluate(({ JUDGED, IDENTITY }) => App.reviews.games
    .map((g) => ({
      url: g.url,
      judged: JSON.stringify(Object.fromEntries(JUDGED.map((k) => [k, g[k] ?? null]))),
      identity: JSON.stringify(Object.fromEntries(IDENTITY.map((k) => [k, g[k] ?? null]))),
    }))
    .sort((a, b) => a.url.localeCompare(b.url)), { JUDGED, IDENTITY });

  // Every chart and panel on Progress, for each measure: the words and the drawing.
  const progress = async (page) => {
    await gotoSection(page, 'progress');
    return page.evaluate(() => {
      const out = {};
      for (const m of ['accuracy', 'mistakes', 'estimate']) {
        Progress.measure = m;
        renderProgress();
        const box = document.getElementById('progressOut');
        out[m] = {
          text: box.textContent.replace(/\s+/g, ' ').trim(),
          drawn: [...box.querySelectorAll('svg *')].map((e) => e.outerHTML).join(''),
        };
      }
      Progress.measure = 'accuracy';
      return out;
    });
  };

  const reopened = (page, url) => page.evaluate((url) => {
    openStoredReview(App.reviews.games.find((g) => g.url === url));
    const out = document.getElementById('reviewOut');
    return { text: out.textContent.replace(/\s+/g, ' ').trim(), drawn: [...out.querySelectorAll('svg *')].map((e) => e.outerHTML).join('') };
  }, url);

  const drills = (page) => page.evaluate(() => App.drills.items.map((d) => ({
    key: `${d.fen}|${d.playedUci}`, best: d.best?.uci, judge: d.judge ?? 'app', severity: d.severity,
  })));

  const mistakesOf = (page) => page.evaluate(() => App.reviews.games.flatMap((g) => (g.mistakes ?? [])
    .map((m) => ({ key: `${m.fen}|${m.uci}`, best: m.best?.uci, severity: m.severity, url: g.url }))));

  // ── 1. the same history, two ways ─────────────────────────────────────────
  const A = await open();
  await seed(A);
  await walk(A, 'app');
  const appStored = await stored(A);
  const appProgress = await progress(A);          // looked at: every cache on it filled
  const appDrills = await drills(A);
  const appReopened = await reopened(A, 'rejudge-1');
  check('walked by this app\'s engine first', appStored.every((g) => JSON.parse(g.judged).judge === 'app'), true);
  check('with drills made from its mistakes', appDrills.length > 3, true);

  const offered = await (async () => {
    await gotoSection(A, 'review');
    await A.selectOption('#walkJudge', 'stockfish');
    return A.$eval('#walkNote', (e) => e.textContent);
  })();
  check('picking Stockfish offers all four to judge again', /4 were judged by this app's engine, and will be judged again by Stockfish/.test(offered), true);
  const rejudgedNote = await walk(A, 'stockfish');
  say('the walk said', rejudgedNote);
  const aStored = await stored(A);
  const aProgress = await progress(A);
  const aDrills = await drills(A);
  const aReopened = await reopened(A, 'rejudge-1');

  const B = await open();
  await seed(B);
  await walk(B, 'stockfish');
  const bStored = await stored(B);
  const bProgress = await progress(B);
  const bDrills = await drills(B);
  const bReopened = await reopened(B, 'rejudge-1');
  const bMistakes = await mistakesOf(B);

  check('four games either way', `${aStored.length} ${bStored.length}`, '4 4');
  aStored.forEach((g, i) => {
    check(`${g.url}: every figure is Stockfish's, as if judged fresh`, g.judged, bStored[i].judged);
  });
  check('and what each game is was not touched', JSON.stringify(aStored.map((g) => g.identity)), JSON.stringify(appStored.map((g) => g.identity)));
  check('the judgement did change', JSON.stringify(aStored.map((g) => g.judged)) !== JSON.stringify(appStored.map((g) => g.judged)), true);
  for (const m of ['accuracy', 'mistakes', 'estimate']) {
    check(`Progress, ${m}: the same words as a fresh history`, aProgress[m].text, bProgress[m].text);
    check(`Progress, ${m}: the same charts`, aProgress[m].drawn, bProgress[m].drawn);
  }
  check('and not the ones it showed before', aProgress.accuracy.text !== appProgress.accuracy.text, true);
  const timePanel = (p) => (/Where your time goes(.*?)(How strong|Games reviewed|$)/.exec(p.accuracy.text) ?? [])[1] ?? '';
  check('"Where your time goes" is Stockfish\'s, with no reload', timePanel(aProgress), timePanel(bProgress));
  check('and it changed from this app\'s engine\'s', timePanel(aProgress) !== timePanel(appProgress) && timePanel(aProgress) !== '', true);
  check('a reopened game: the same review', aReopened.text, bReopened.text);
  check('with the same chart', aReopened.drawn, bReopened.drawn);
  check('which is not the one it had before', aReopened.drawn !== appReopened.drawn, true);

  // Drills: every one Stockfish's answer, and none it would not have made.
  const stockfishSays = new Map(bMistakes.map((m) => [m.key, m]));
  const wrong = aDrills.filter((d) => {
    const m = stockfishSays.get(d.key);
    return !m || m.best !== d.best || d.judge !== 'stockfish';
  });
  check('every drill asks for Stockfish\'s move', wrong.length, 0);
  const aByKey = new Map(aDrills.map((d) => [d.key, d]));
  check('every drill a fresh Stockfish history has, this one has too',
    bDrills.every((d) => aByKey.get(d.key)?.best === d.best), true);
  const gone = appDrills.filter((d) => !aByKey.has(d.key)).length;
  const changed = appDrills.filter((d) => aByKey.has(d.key) && aByKey.get(d.key).best !== d.best).length;
  say('drills from this app\'s engine: answer changed / removed', `${changed} / ${gone}`);
  check('and the walk says when it changed any', /brought into line with the new judgement/.test(rejudgedNote), gone + changed > 0);

  // ── 2. a drill says whose answer it is ────────────────────────────────────
  await gotoSection(B, 'drills');
  const answer = await B.evaluate(async () => {
    Drill.current = null;
    startDrill();
    if (!Drill.current) return null;
    const board = new Board(Drill.current.fen);
    const move = board.legalMoves().find((m) => moveToUci(m) !== Drill.current.best.uci);
    await onDrillMove({ move, san: toSan(new Board(Drill.current.fen), move) });
    return document.getElementById('drillAnswer').textContent;
  });
  say('a wrong answer to a Stockfish drill', answer);
  check('names Stockfish', /^Not quite\. Stockfish wanted /.test(answer ?? ''), true);

  // ── 3. the estimate is the calibration's, not what was stored ──────────────
  const estimate = await B.evaluate(() => {
    const g = App.reviews.games.find((x) => x.url === 'rejudge-3');
    g.estimate = { elo: 1234, band: '1234–1235', clamped: false };
    Progress.measure = 'estimate';
    renderProgress();
    const text = document.getElementById('progressOut').textContent;
    const truth = estimateRating(g.meanLoss, g.depth, 'stockfish');
    Progress.measure = 'accuracy';
    return { shown: text.includes('1234'), truth: estimateWords(truth, { short: true }), listed: text.includes(`looked like ${estimateWords(truth, { short: true })}`) };
  });
  check('a stored estimate that is wrong is not what Progress shows', estimate.shown, false);
  check('it shows what the calibration says', estimate.listed, true);

  // ── 4. the same game reviewed again replaces its review ────────────────────
  await gotoSection(B, 'review');
  const bare = MOVES[1];
  await B.fill('#pgnInput', `[White "you"] [Black "somebody"]\n${bare}`);
  await B.fill('#reviewName', 'you');
  await B.selectOption('#reviewJudge', 'app');
  await B.selectOption('#reviewDepth', '7');
  const beforeReview = await B.evaluate(() => ({ n: App.reviews.games.length, drills: App.drills.items.map((d) => `${d.fen}|${d.playedUci}|${d.best?.uci}|${d.judge}`) }));
  const oldMistakes = (await mistakesOf(B)).filter((m) => m.url === 'rejudge-1');
  await B.click('#reviewRun');
  await B.waitForFunction(() => /^Done/.test(document.getElementById('reviewStatus').textContent), null, { timeout: 120000 });
  const status = await B.$eval('#reviewStatus', (e) => e.textContent);
  say('the review said', status.slice(0, 160));
  const afterReview = await stored(B);
  check('still four games, not five', afterReview.length, 4);
  check('and it says it replaced the earlier review', /replaced the earlier one rather than counting it twice/.test(status), true);
  const one = afterReview.find((g) => g.url === 'rejudge-1');
  check('the stored game is now this app\'s engine\'s review', one.judged, appStored.find((g) => g.url === 'rejudge-1').judged);
  check('and is still the imported game: clocks, rating, date', one.identity, bStored.find((g) => g.url === 'rejudge-1').identity);
  const newMistakes = (await mistakesOf(B)).filter((m) => m.url === 'rejudge-1');
  const others = new Set((await mistakesOf(B)).filter((m) => m.url !== 'rejudge-1').map((m) => m.key));
  const nowDrills = await drills(B);
  const wasKeys = new Set(oldMistakes.map((m) => m.key));
  const appSays = new Map(newMistakes.map((m) => [m.key, m]));
  const stale = nowDrills.filter((d) => wasKeys.has(d.key) && !others.has(d.key)
    && (!appSays.has(d.key) || appSays.get(d.key).best !== d.best || d.judge !== 'app'));
  check('its drills follow the new review', stale.length, 0);
  check('and no other drill was touched', nowDrills.filter((d) => !wasKeys.has(d.key)).map((d) => `${d.key}|${d.best}|${d.judge}`).every((k) => beforeReview.drills.includes(k)), true);

  // ── 5. the judge stops halfway: nothing it had not finished is touched ────
  const C = await open();
  await seed(C);
  await walk(C, 'app');
  const cBefore = await stored(C);
  const target = await C.evaluate(() => {
    const games = [...App.reviews.games].sort((a, b) => a.at - b.at);
    const ucis = games.map((g) => parsePgn(g.pgn).plies.map((p) => p.uci));
    const prefix = (u) => u.slice(0, 10).join(' ');
    const distinct = new Set(ucis.map(prefix)).size === ucis.length;
    // The third game, ten moves in.
    window.realAnalyse = stockfishAnalyse;
    window.stockfishAnalyse = (fen, o = {}) => {
      const m = o.moves ?? [];
      if (m.length >= 10 && ucis[2].slice(0, m.length).join(' ') === m.join(' ')) {
        return Promise.reject(new Error('It stopped answering (this is the test).'));
      }
      return window.realAnalyse(fen, o);
    };
    return { distinct, url: games[2].url };
  });
  check('the games can be told apart by their first ten moves', target.distinct, true);
  const stoppedNote = await walk(C, 'stockfish');
  say('when Stockfish stopped, the walk said', stoppedNote);
  const cAfter = await stored(C);
  const judges = cAfter.map((g) => JSON.parse(g.judged).judge).join(' ');
  check('the two before it were judged', judges, 'stockfish stockfish app app');
  check('the one it stopped on is exactly as it was', cAfter[2].judged, cBefore[2].judged);
  check('and so is the one after it', cAfter[3].judged, cBefore[3].judged);
  check('none is marked as a game that will not read', cAfter.every((g) => JSON.parse(g.judged).walkFailed === null), true);
  check('and the walk said the judge stopped, not the games', /Then Stockfish stopped, on you vs them: It stopped answering \(this is the test\)\. That game and the ones after it were left exactly as they were/.test(stoppedNote), true);
  const waiting = await C.evaluate(() => walkWaiting());
  check('the two it did not reach are still offered', /2 were judged by this app's engine, and will be judged again by Stockfish/.test(waiting ?? ''), true);
  await C.evaluate(() => { window.stockfishAnalyse = window.realAnalyse; });
  await walk(C, 'stockfish');
  const cDone = await stored(C);
  check('pressed again, it finishes them', cDone.map((g) => JSON.parse(g.judged).judge).join(' '), 'stockfish stockfish stockfish stockfish');
  check('and they match a fresh Stockfish history', JSON.stringify(cDone.map((g) => g.judged)), JSON.stringify(bStored.map((g) => g.judged)));

  // ── 6. a game walked before the record was kept ───────────────────────────
  const D = await open();
  await seed(D);
  await walk(D, 'app', '9');
  const dFull = await stored(D);
  await D.evaluate(() => {
    for (const g of App.reviews.games) { delete g.curve; delete g.marks; delete g.counted; }
    return Store.set('reviews', App.reviews);
  });
  const dWaiting = await D.evaluate(() => { renderImport(); return walkWaiting(); });
  say('games with no record, the walk offers', dWaiting);
  check('they are offered, and why', /4 were analysed before the move by move record was kept/.test(dWaiting ?? ''), true);
  const dProgress = await progress(D);
  check('"Where your time goes" says why they are missing', /4 of them were reviewed before the move by move record was kept/.test(dProgress.accuracy.text), true);
  await walk(D, 'app', '7');             // Quick picked — but they were measured at Normal
  const dBack = await stored(D);
  check('walked again at their own setting, the same figures come back', JSON.stringify(dBack.map((g) => g.judged)), JSON.stringify(dFull.map((g) => g.judged)));
  const dAfter = await progress(D);
  check('and "Where your time goes" counts them', /moves across 4 games/.test(dAfter.accuracy.text), true);

  console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
  if (errors.length) failures.push('page errors');
  await browser.close();
  srv.close?.();
  if (failures.length) { console.log(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1); }
  console.log('ok');
  process.exit(0);
})().catch((e) => { console.error(e); console.log('FAILED'); process.exit(1); });
