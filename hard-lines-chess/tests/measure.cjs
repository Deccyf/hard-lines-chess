const { launch, app, serve, DIST } = require('./browser.cjs');
(async () => {
  const browser = await launch();
  for (const [w, h, name] of [[390,844,'iPhone'],[430,932,'large phone'],[768,1024,'tablet'],[1100,900,'desktop']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(app('hard-lines-chess.html'));
    await page.waitForTimeout(500);
    await page.locator('#tab-play').click();
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const board = document.querySelector('#playBoard .board');
      const cells = [...document.querySelectorAll('#playBoard .sq')];
      const r = board.getBoundingClientRect();
      const c = cells[0].getBoundingClientRect();
      const piece = document.querySelector('#playBoard .piece');
      const p = piece ? piece.getBoundingClientRect() : null;
      return {
        board: [Math.round(r.width), Math.round(r.height)],
        cell: [Math.round(c.width*10)/10, Math.round(c.height*10)/10],
        ratio: Math.round((c.width / c.height) * 100) / 100,
        piece: p ? [Math.round(p.width), Math.round(p.height)] : null,
        pieceFits: p ? (p.height <= c.height + 1) : true,
      };
    });
    console.log(`${name.padEnd(12)} ${String(w).padStart(4)}px | board ${m.board[0]}x${m.board[1]} | cell ${m.cell[0]}x${m.cell[1]} | w/h ${m.ratio} ${m.ratio === 1 ? 'SQUARE' : '<-- SQUEEZED'} | piece ${m.piece} fits:${m.pieceFits}`);
    await page.close();
  }
  await browser.close();
})();
