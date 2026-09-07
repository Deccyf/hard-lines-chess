// What the screen actually looks like on a phone, measured rather than read.
//
// Every fault this pins was invisible in the source and obvious in a
// screenshot, which is why it is measured here with real geometry on a real
// viewport instead of asserted about the markup:
//
//   - A timed round put the clock, the score, the question and the board all
//     below the fold, behind an explanatory panel and two dropdowns. Thirty
//     seconds of a thirty-second round spent scrolling.
//   - The progress chart drew its points as <circle> inside a viewBox stretched
//     to the panel width, so every one rendered as an ellipse about ninety
//     times wider than it was tall.
//   - The clock screen's setup panel said "there are no positions to run" in
//     the middle of a run, because nothing asked it to say otherwise.
const { launch, serve, DIST } = require('./browser.cjs');

const PHONE = { width: 390, height: 844 };

(async () => {
  const srv = serve(DIST, 8291);
  await srv.ready;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: PHONE });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const say = (k, v) => console.log(String(k).padEnd(34), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got) : `${got}   <- expected ${want}`);
    if (!ok) failures.push(what);
  };

  await page.goto('http://127.0.0.1:8291/hard-lines-chess-app.html');
  await page.waitForSelector('#tab-today', { timeout: 20000 });

  /** Is this element inside the first screenful, without scrolling? */
  const aboveTheFold = async (selector) => page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node || node.hidden) return false;
    const rect = node.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight && rect.height > 0;
  }, selector);

  // ── a vision round ────────────────────────────────────────────────────────
  await page.evaluate(() => { show('vision'); window.scrollTo(0, 0); Vision.seconds = 30; startVision(); });
  await page.waitForTimeout(300);
  check('vision: the clock is on screen', await aboveTheFold('#visionClock'), true);
  check('vision: the score is on screen', await aboveTheFold('#visionScore'), true);
  check('vision: the question is on screen', await aboveTheFold('#visionPrompt'), true);
  check('vision: the setup is out of the way', await page.$eval('#visionSetup', (e) => e.hidden), true);
  // The board has to be reachable: at least its top edge inside the viewport.
  check('vision: the board has started', await page.evaluate(() => {
    const r = document.querySelector('#visionBoard .board')?.getBoundingClientRect();
    return !!r && r.top < window.innerHeight;
  }), true);
  await page.evaluate(() => stopVision());
  await page.waitForTimeout(200);
  check('vision: the setup comes back', await page.$eval('#visionSetup', (e) => !e.hidden), true);

  // ── a clock run ───────────────────────────────────────────────────────────
  await page.evaluate(() => {
    App.puzzles.items = [{ fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', best: { uci: 'a1a8', san: 'Ra8#' }, mate: 1, label: 'the 1200 band', line: 'Ra8#' }];
    show('storm'); window.scrollTo(0, 0); renderStorm(); startStorm();
  });
  await page.waitForTimeout(300);
  check('clock: the timer is on screen', await aboveTheFold('#stormClock'), true);
  check('clock: the prompt is on screen', await aboveTheFold('#stormPrompt'), true);
  check('clock: the board has started', await page.evaluate(() => {
    const r = document.querySelector('#stormBoard .board')?.getBoundingClientRect();
    return !!r && r.top < window.innerHeight;
  }), true);
  // The panel that used to contradict the run is not on screen to do it.
  check('clock: the setup is out of the way', await page.$eval('#stormSetup', (e) => e.hidden), true);
  await page.evaluate(() => stopStorm());

  // ── the endgame verdict sits with the board ───────────────────────────────
  await page.evaluate(() => {
    show('endgames');
    startEndgame(ENDGAMES.find((e) => e.id === 'opposition-fifth'));
  });
  await page.waitForTimeout(300);
  const order = await page.evaluate(() => {
    const y = (id) => document.getElementById(id).getBoundingClientRect().top;
    return { goal: y('endgameGoal'), board: y('endgameBoard'), verdict: y('endgameVerdict'), method: y('endgameMethod') };
  });
  check('endgame: the goal is above the board', order.goal < order.board, true);
  check('endgame: the verdict is under the board', order.verdict > order.board, true);
  check('endgame: the method is below both', order.method > order.verdict, true);
  const verdict = await page.$eval('#endgameVerdict', (e) => e.textContent);
  say('endgame: the verdict reads', verdict);
  check('endgame: it counts in moves, not plies', /plies/.test(verdict), false);

  // ── the chart draws round dots ────────────────────────────────────────────
  //
  // Nine games is under the cap, so they are drawn individually here. Past the
  // cap the chart stops drawing them at all and the band carries the spread
  // instead — that switch is checked in progress-drive.cjs.
  await page.evaluate(() => {
    App.reviews.games = Array.from({ length: 9 }, (_, i) => ({
      at: i, white: 'You', black: 'Them', result: '1-0', side: 'white',
      accuracy: 62 + i * 3, plies: 60, mistakes: [{ kind: 'material', severity: 'blunder', ply: 3 }],
      pgn: '1. e4 e5', tactics: 0, meanLoss: 40, depth: 9, estimate: { elo: 1200, ceilingHit: false },
    }));
    show('progress'); renderProgress();
  });
  await page.waitForTimeout(300);
  // A ZERO-LENGTH LINE HAS NO BOUNDING BOX, so there is nothing to measure with
  // getBoundingClientRect — it returns 0x0 whatever the stroke does, and an
  // assertion that width equals height would pass without looking at anything.
  // What is checked instead is the mechanism that makes the mark round, and
  // then that it does not change when the chart is stretched, which is exactly
  // the property the old <circle> lacked.
  const mark = await page.evaluate(() => {
    const node = document.querySelector('#progressOut .chart-dot');
    if (!node) return null;
    const style = getComputedStyle(node);
    return { tag: node.tagName.toLowerCase(), cap: style.strokeLinecap, effect: style.vectorEffect, width: style.strokeWidth };
  });
  say('chart: a point is drawn as', mark ? `<${mark.tag}> cap:${mark.cap} ${mark.effect} ${mark.width}` : 'nothing');
  check('chart: points are drawn', !!mark, true);
  check('chart: not a circle in stretched units', mark?.tag, 'line');
  check('chart: with a round cap', mark?.cap, 'round');
  check('chart: a stroke that does not scale', mark?.effect, 'non-scaling-stroke');

  // Stretch the chart to well over twice the width. A mark measured in screen
  // pixels is the same size afterwards; one measured in viewBox units is not.
  const narrow = mark.width;
  await page.setViewportSize({ width: 900, height: 844 });
  await page.waitForTimeout(250);
  const wide = await page.$eval('#progressOut .chart-dot', (n) => getComputedStyle(n).strokeWidth);
  say('chart: stroke at 390px vs 900px', `${narrow} / ${wide}`);
  check('chart: the mark does not stretch with the panel', narrow === wide, true);
  await page.setViewportSize(PHONE);
  await page.waitForTimeout(250);

  // And the first point sits inside the frame rather than half outside it. Its
  // centre is transformed out of the SVG's own coordinates, since the element
  // reports no box of its own.
  check('chart: the first point is not clipped', await page.evaluate(() => {
    const node = document.querySelector('#progressOut .chart-dot');
    const frame = document.querySelector('#progressOut .chart-frame');
    if (!node || !frame) return false;
    const point = new DOMPoint(Number(node.getAttribute('x1')), Number(node.getAttribute('y1')))
      .matrixTransform(node.getScreenCTM());
    const radius = parseFloat(getComputedStyle(node).strokeWidth) / 2;
    const box = frame.getBoundingClientRect();
    return point.x - radius >= box.left - 0.5 && point.x + radius <= box.right + 0.5;
  }), true);

  // ── the tab strip, and the fade that has to tell the truth about it ───────
  //
  // THIS CHECK USED TO ASSERT THE OPPOSITE. It read "the strip overflows a
  // phone" — true when there were fourteen tabs in one row, and the fade at the
  // right-hand edge existed to say so. The strip is six now and does not
  // overflow, so the old check was holding the app to the fault the fade was
  // built to cope with. What is actually worth enforcing is that the fade
  // AGREES WITH THE STRIP: shown when there is more off the end, absent when
  // there is not. A fade that lies is worse than no fade, whichever way it lies.
  await page.evaluate(() => { show('today'); window.scrollTo(0, 0); });
  await page.waitForTimeout(200);
  const strip = await page.evaluate(() => {
    const nav = document.getElementById('tabs');
    return { overflows: nav.scrollWidth > nav.clientWidth + 4, fade: document.getElementById('tabsWrap').classList.contains('more') };
  });
  say('tabs: the top row overflows', String(strip.overflows));
  check('tabs: six tabs fit a phone', strip.overflows, false);
  check('tabs: and the fade agrees', strip.fade, strip.overflows);

  // The second row is where a group with five screens lives, so it is the one
  // that can still run off the edge — and the same rule applies to it.
  await page.evaluate(() => show('openings'));
  await page.waitForTimeout(200);
  const sub = await page.evaluate(() => {
    const nav = document.getElementById('subtabs');
    return { shown: !document.getElementById('subtabsWrap').hidden, overflows: nav.scrollWidth > nav.clientWidth + 4,
      fade: document.getElementById('subtabsWrap').classList.contains('more') };
  });
  say('tabs: the second row overflows', String(sub.overflows));
  check('tabs: the second row is there', sub.shown, true);
  // Selecting a far tab scrolls it into view rather than leaving it off the side.
  await page.evaluate(() => show('settings'));
  await page.waitForTimeout(300);
  check('tabs: the selected tab is visible', await page.evaluate(() => {
    const tab = document.getElementById('tab-settings');
    const nav = document.getElementById('tabs');
    const t = tab.getBoundingClientRect(), n = nav.getBoundingClientRect();
    return t.left >= n.left - 1 && t.right <= n.right + 1;
  }), true);

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
