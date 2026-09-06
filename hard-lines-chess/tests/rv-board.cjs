const { launch, app, serve, DIST, gotoSection } = require('./browser.cjs');
(async () => {
  const browser = await launch();
  const url = app();
  const say = (k, v) => console.log(k.padEnd(44), v);
  const tap = async (page, boardSel, name) => page.click(`${boardSel} .sq[aria-label="${name}"]`);
  let failed = 0; const expect = (k, ok) => { say(k, ok ? 'ok' : 'FAIL'); if (!ok) failed++; };

  // ── A. promotion overlay: focus trap, Escape, stale board ──
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url); await page.waitForSelector('#tab-today');
    await gotoSection(page, 'board');
    const open = async () => { await page.fill('#practiceFenIn', '4k3/1P6/8/8/8/8/8/4K3 w - - 0 1'); await page.click('#practiceLoad'); await tap(page, '#practiceBoard', 'b7'); await tap(page, '#practiceBoard', 'b8'); };
    await open();
    expect('A: overlay opens', !(await page.locator('#promo').isHidden()));
    let escaped = false;
    for (let i = 0; i < 12; i++) { await page.keyboard.press('Shift+Tab'); if (!(await page.evaluate(() => document.getElementById('promo').contains(document.activeElement)))) { escaped = true; break; } }
    expect('A: focus stays inside the overlay (Shift+Tab x12)', !escaped);
    await page.keyboard.press('Tab');
    expect('A: Tab cycles to the next choice', await page.evaluate(() => document.activeElement.getAttribute('aria-label')) !== 'Queen');
    await page.keyboard.press('Escape');
    expect('A: Escape closes it', await page.locator('#promo').isHidden());
    expect('A: nothing selected after Escape', (await page.locator('#practiceBoard .sq.sel').count()) === 0);
    // the board changes underneath an open overlay (any code path: a reset, a clock flag)
    await open();
    await page.evaluate(() => document.getElementById('practiceReset').click());
    expect('A: overlay closed by the board being replaced', await page.locator('#promo').isHidden());
    // the position moves on (same Board object, different hash) while the overlay is open
    await open();
    await page.evaluate(() => { const b = Practice.view.board; b.make(b.legalMoves().find((m) => (m & 0xff) === 4)); });
    const fenBefore = await page.evaluate(() => Practice.view.board.fen());
    await page.click('#promoChoices button[aria-label="Queen"]');
    expect('A: stale choice is dropped and the overlay closed', await page.locator('#promo').isHidden() && (await page.evaluate(() => Practice.view.board.fen())) === fenBefore);
    // and the normal path still works
    await open();
    await page.click('#promoChoices button[aria-label="Knight"]');
    expect('A: a live choice promotes', (await page.evaluate(() => Practice.view.board.fen())).startsWith('1N2k3'));
    say('A: page errors', errors.join(' | ') || 'none'); if (errors.length) failed++;
    await page.close();
  }

  // ── B. arrows on a flipped board ──
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    await page.goto(url); await page.waitForSelector('#tab-today');
    await gotoSection(page, 'board'); await page.click('#practiceFlip'); await page.click('#practiceSuggest');
    await page.waitForFunction(() => document.querySelectorAll('#practiceLines .line-row').length > 0, null, { timeout: 15000 });
    const r = await page.evaluate(() => {
      const best = Practice.lastLines.lines[0].move; const to = (best >> 8) & 0xff;
      const cell = document.querySelector(`#practiceBoard .sq[data-sq="${to}"]`).getBoundingClientRect();
      const poly = document.querySelector('#practiceBoard .arrow-head.arrow-best');
      const pt = poly.ownerSVGElement.createSVGPoint(); const [x, y] = poly.getAttribute('points').split(' ')[0].split(',').map(Number); pt.x = x; pt.y = y;
      const s = pt.matrixTransform(poly.getScreenCTM());
      return Math.abs(s.x - (cell.left + cell.width / 2)) < cell.width / 2 && Math.abs(s.y - (cell.top + cell.height / 2)) < cell.height / 2;
    });
    expect('B: flipped arrow head lands on its square', r);
    // in-place draw: the grid element survives a selection tap and a highlight
    const same = await page.evaluate(async () => { const g = document.querySelector('#practiceBoard .board'); const pawn = g.querySelector('.sq[aria-label="e2"] .piece'); document.querySelector('#practiceBoard .sq[aria-label="e2"]').click(); return { grid: g === document.querySelector('#practiceBoard .board'), dots: g.querySelectorAll('.dot').length, piece: pawn === g.querySelector('.sq[aria-label="e2"] .piece'), sel: g.querySelectorAll('.sq.sel').length }; });
    say('B: after tapping e2', JSON.stringify(same));
    expect('B: grid, piece span kept; dots and selection drawn in place', same.grid && same.piece && same.dots === 2 && same.sel === 1);
    await page.close();
  }

  // ── C. older drills documents ──
  for (const shape of ['no card', 'card without ease']) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((shape) => {
      const item = { id: 'old-1', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 2 3', side: 'white', played: 'Qh5', playedUci: 'd1h5', best: { san: 'Nf3', uci: 'g1f3' }, severity: 'blunder', label: 'x', loss: 300 };
      if (shape === 'card without ease') item.card = { interval: 3, seen: 2, due: 0 };
      localStorage.setItem('hardlines:drills', JSON.stringify({ items: [item] }));
    }, shape);
    await page.goto(url); await page.waitForSelector('#tab-today');
    await gotoSection(page, 'drills');
    say(`C[${shape}]: count`, await page.locator('#drillCount').innerText());
    await page.click('#drillStart');
    await tap(page, '#drillBoard', 'g1'); await tap(page, '#drillBoard', 'f3'); await page.waitForTimeout(400);
    const card = await page.evaluate(() => App.drills.items[0].card);
    expect(`C[${shape}]: card written with finite numbers`, card && [card.interval, card.ease, card.due, card.seen].every(Number.isFinite));
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hardlines:drills')));
    expect(`C[${shape}]: local copy is versioned`, stored.version === 2 && Number.isFinite(stored.updated));
    await page.click('#drillNext'); await page.waitForTimeout(200);
    say(`C[${shape}]: after next`, await page.locator('#drillCount').innerText());
    expect(`C[${shape}]: comes back tomorrow, not "later"`, /tomorrow|in \d+ days/.test(await page.locator('#drillCount').innerText()));
    say(`C[${shape}]: page errors`, errors.join(' | ') || 'none'); if (errors.length) failed++;
    await page.close();
  }

  // ── D. older db document vs newer local; failed db write retried ──
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    await page.addInitScript(() => {
      const older = { bands: { 800: { w: 1, d: 0, l: 0 } }, games: [{ at: 1, band: 800, colour: 'white', result: 'w', plies: 2, control: 'none', pgn: '1. e4' }] };
      const newer = { bands: { 800: { w: 2, d: 0, l: 0 } }, games: [older.games[0], { at: 2, band: 800, colour: 'white', result: 'w', plies: 2, control: 'none', pgn: '1. d4' }] };
      localStorage.setItem('hardlines:history', JSON.stringify({ payload: newer, updated: 2000, version: 2 }));
      window.__dbWrites = []; window.__dbFail = true;
      window.claude = { use: async (name) => name !== 'db' ? null : ({
        doc: (path) => ({
          get: async () => path === 'state/history' ? { exists: true, data: () => ({ payload: older, updated: 1000, version: 2 }) } : { exists: false, data: () => null },
          set: async (v) => { if (window.__dbFail) throw new Error('offline'); window.__dbWrites.push([path, v.payload]); },
        }),
      }) };
    });
    await page.goto(url); await page.waitForSelector('#tab-today'); await page.waitForTimeout(300);
    expect('D: newer local copy wins over older db copy', (await page.evaluate(() => App.history.games.length)) === 2);
    await page.evaluate(async () => { App.history.games.push({ at: 3, band: 800, colour: 'white', result: 'l', plies: 0, control: 'none', pgn: '' }); await Store.set('history', App.history); });
    say('D: dirty after a failed db write', await page.evaluate(() => localStorage.getItem('hardlines:__dirty')));
    expect('D: failed write marked dirty', (await page.evaluate(() => JSON.parse(localStorage.getItem('hardlines:__dirty') ?? '[]'))).includes('history'));
    await page.evaluate(() => { window.__dbFail = false; });
    await page.evaluate(async () => { await Store.set('prefs', App.prefs); });
    const writes = await page.evaluate(() => window.__dbWrites.map(([p, v]) => p + ':' + (v.games ? v.games.length : '-')));
    say('D: db writes after recovery', writes.join(' '));
    expect('D: owed history pushed on the next write', writes.some((w) => w.startsWith('state/history:3')));
    expect('D: dirty cleared', (await page.evaluate(() => localStorage.getItem('hardlines:__dirty'))) === null);
    await page.close();
  }
  await browser.close();
  console.log(failed ? `${failed} FAILED` : 'rv-board: all pass');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('DRIVER FAILED', e.message); process.exit(1); });
