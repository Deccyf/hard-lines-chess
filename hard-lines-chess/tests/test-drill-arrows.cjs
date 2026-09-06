const { launch, app, serve, DIST } = require('./browser.cjs');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 430, height: 1400 } });
  await page.goto(app());
  await page.waitForTimeout(600);

  // Seed a drill straight into storage so this test is about the board only.
  await page.evaluate(async () => {
    App.drills.items = [{
      id: 'x', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 1',
      side: 'black', played: 'Nf6', playedUci: 'g8f6',
      best: { uci: 'g7g6', san: 'g6' }, severity: 'blunder', loss: 900, card: SRS.fresh(),
    }];
    await Store.set('drills', App.drills);
  });

  await page.locator('#tab-drills').click();
  await page.waitForTimeout(200);
  await page.locator('#drillStart').click();
  await page.waitForTimeout(300);

  const attempt = await page.evaluate(() => {
    const legal = Drill.view.board.legalMoves().map(moveToUci);
    const wrong = legal.find((u) => u !== Drill.current.best.uci);
    const m = Drill.view.board.legalMoves().find((mv) => moveToUci(mv) === wrong);
    Drill.view.play(m);
    return { legalCount: legal.length, wrong, best: Drill.current.best.uci };
  });
  console.log('attempt:', JSON.stringify(attempt));
  await page.waitForTimeout(600);

  const info = await page.evaluate(() => {
    const svg = document.querySelector('#drillBoard .arrows');
    const board = document.querySelector('#drillBoard .board');
    const frame = document.querySelector('#drillBoard .board-frame');
    const r = (e) => e ? { x: Math.round(e.getBoundingClientRect().x), y: Math.round(e.getBoundingClientRect().y), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) } : null;
    return {
      svg: r(svg), board: r(board), frame: r(frame),
      framePosition: frame ? getComputedStyle(frame).position : null,
      svgParent: svg ? svg.parentElement.className : null,
      svgPosition: svg ? getComputedStyle(svg).position : null,
    };
  });
  console.log('svg matches board:', info.svg.x===info.board.x && info.svg.y===info.board.y && info.svg.w===info.board.w && info.svg.h===info.board.h);
  const drawn = await page.evaluate(() => [...document.querySelectorAll('#drillBoard .arrows line')].map((l) => ({
    kind: l.getAttribute('class'), stroke: getComputedStyle(l).stroke,
    x1: +Number(l.getAttribute('x1')).toFixed(2), y1: +Number(l.getAttribute('y1')).toFixed(2),
    x2: +Number(l.getAttribute('x2')).toFixed(2), y2: +Number(l.getAttribute('y2')).toFixed(2),
  })));
  console.log('arrows drawn:', drawn.length);
  for (const d of drawn) console.log('  ', d.kind, `(${d.x1},${d.y1}) -> (${d.x2},${d.y2})`, d.stroke);
  console.log('answer text:', await page.locator('#drillAnswer').innerText());
  await page.screenshot({ path: 'arrows.png', clip: { x: 0, y: 180, width: 430, height: 620 } });
  await browser.close();
})();
