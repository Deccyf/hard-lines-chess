const { launch, app, serve, DIST } = require('./browser.cjs');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('net::ERR_')) errors.push('console: ' + m.text()); });
  await page.goto(app('hard-lines-chess.html'));
  await page.waitForSelector('#tab-today');
  const say = (k, v) => console.log(k.padEnd(34), v);
  say('tabs', await page.locator('.tab').allInnerTexts().then((t) => t.join('|')));

  // ---- Board (practice)
  await page.click('#tab-board');
  say('practice squares', await page.locator('#practiceBoard .sq').count());
  say('practice turn', await page.locator('#practiceTurn').innerText());
  // move e2e4 by tapping
  const tap = async (boardSel, name) => page.click(`${boardSel} .sq[aria-label="${name}"]`);
  await tap('#practiceBoard', 'e2'); await tap('#practiceBoard', 'e4');
  await page.waitForTimeout(300);
  say('practice moves', await page.locator('#practiceMoves').innerText());
  await page.click('#practiceSuggest');
  await page.waitForFunction(() => document.querySelectorAll('#practiceLines .line-row').length > 0, null, { timeout: 8000 });
  say('lines', await page.locator('#practiceLines .line-row').allInnerTexts().then((t) => t.join(' || ')));
  say('verdict', await page.locator('#practiceVerdict').innerText());
  say('arrows drawn', await page.locator('#practiceBoard .arrows .arrow-head').count());
  say('eval bar height', await page.locator('#practiceEval .evalbar-white').evaluate((e) => e.style.height));
  await page.check('#practiceThreats'); await page.waitForTimeout(600);
  say('threat note', await page.locator('#practiceThreatNote').innerText());
  say('threat arrow', await page.locator('#practiceBoard .arrow-threat').count());
  await page.check('#practiceHanging'); await page.waitForTimeout(400);
  say('hang note', await page.locator('#practiceHangNote').innerText());
  // right-click highlight, right-drag arrow
  const box = await page.locator('#practiceBoard .sq[aria-label="d4"]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  say('highlight after right-click', await page.locator('#practiceBoard .sq.hl-1').count());
  const from = await page.locator('#practiceBoard .sq[aria-label="g1"]').boundingBox();
  const to = await page.locator('#practiceBoard .sq[aria-label="f3"]').boundingBox();
  await page.mouse.move(from.x + 10, from.y + 10); await page.mouse.down({ button: 'right' });
  await page.mouse.move(to.x + 10, to.y + 10, { steps: 4 }); await page.mouse.up({ button: 'right' });
  say('user arrow', await page.locator('#practiceBoard .arrow-user').count());
  await page.click('#practiceClearMarks');
  say('after clear', (await page.locator('#practiceBoard .sq.hl-1').count()) + '/' + (await page.locator('#practiceBoard .arrow-user').count()));
  // FEN load: bad then good
  await page.fill('#practiceFenIn', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w KQkq - 0 1');
  await page.click('#practiceLoad'); say('bad fen', await page.locator('#practiceFenNote').innerText());
  await page.fill('#practiceFenIn', '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
  await page.click('#practiceLoad'); say('good fen turn', await page.locator('#practiceTurn').innerText());
  await page.click('#practiceSuggest');
  await page.waitForFunction(() => document.querySelectorAll('#practiceLines .line-row').length > 0, null, { timeout: 8000 });
  say('mate line', await page.locator('#practiceLines .line-row').first().innerText());
  say('bar title', await page.locator('#practiceEval').getAttribute('title'));
  // play from here
  await page.click('#practicePlay');
  say('play from note hidden?', await page.locator('#playFrom').isHidden());
  say('play status', await page.locator('#playHead').innerText());

  // ---- Play: new game while thinking, as black
  await page.click('#asBlack');
  await page.waitForTimeout(100);
  await page.click('#playNew');
  await page.waitForTimeout(1500);
  say('black game moves', await page.locator('#playMoves').innerText());
  say('black head', await page.locator('#playHead').innerText());
  say('playAfter hidden', await page.locator('#playAfter').isHidden());
  // lock while thinking: play e7e5 then tap a white piece immediately
  await page.click('#asWhite'); await page.waitForTimeout(200);
  await tap('#playBoard', 'e2'); await tap('#playBoard', 'e4');
  await tap('#playBoard', 'e7');
  say('selected while thinking', await page.locator('#playBoard .sq.sel').count());
  await page.waitForTimeout(1500);
  say('white game moves', await page.locator('#playMoves').innerText());

  // ---- Openings
  await page.click('#tab-openings');
  say('opening cards', await page.locator('.opening').count());
  await page.locator('.opening .btn:has-text("Learn it")').first().click();
  say('chips', await page.locator('#openingChips .chip').count());
  say('branches', await page.locator('#openingBranches .branch').count());
  say('arrow in learn', await page.locator('#openingBoard .arrow-best').count());
  await page.locator('#openingChips .chip').nth(2).hover();
  await page.waitForTimeout(100);
  say('tooltip', (await page.locator('.tip').innerText()).slice(0, 80));
  await page.locator('#openingChips .chip').nth(3).click();
  say('jumped progress', await page.locator('#openingProgress').innerText());
  // walk to end
  for (let i = 0; i < 40; i++) { if (await page.locator('#openingNext').isHidden()) break; await page.click('#openingNext'); await page.waitForTimeout(30); }
  say('learn end result', await page.locator('#openingResult').innerText());
  say('test now visible', await page.locator('#openingTestNow').isVisible());
  await page.click('#openingTestNow');
  await page.waitForTimeout(600);
  say('drill mode', await page.locator('#openingMode').innerText() + ' / ' + await page.locator('#openingWho').innerText());
  await page.click('#openingClose');
  await page.waitForTimeout(700);
  say('after back errors', errors.length);
  say('card state', await page.locator('.opening-state').first().innerText());
  // branch
  await page.locator('.opening .btn:has-text("Learn it")').first().click();
  const branchCount = await page.locator('#openingBranches .branch').count();
  if (branchCount > 1) {
    await page.locator('#openingBranches .branch').nth(1).click();
    await page.waitForTimeout(200);
    say('branch progress', await page.locator('#openingProgress').innerText());
    say('branch who', await page.locator('#openingWho').innerText());
  }
  await page.click('#openingClose');

  // ---- Review with names containing html + truncated
  await page.click('#tab-review');
  await page.fill('#pgnInput', '[White "<b>Bob</b>"]\n[Black "Alice"]\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# Zz9');
  await page.fill('#reviewName', 'nobody');
  await page.selectOption('#reviewDepth', '7');
  await page.click('#reviewRun');
  await page.waitForFunction(() => document.getElementById('reviewStatus').textContent.startsWith('Done'), null, { timeout: 60000 });
  say('review status', await page.locator('#reviewStatus').innerText());
  say('escaped name', (await page.locator('#reviewOut h3').first().innerText()));
  say('bold in dom?', await page.locator('#reviewOut h3 b').count());
  say('move list', await page.locator('#reviewMoves .mv').allInnerTexts().then((t) => t.join(' ')));
  say('classes', await page.locator('#reviewMoves .mv').evaluateAll((els) => els.map((e) => e.dataset.class).join(' ')));
  await page.locator('#reviewMoves .mv').nth(5).click();
  await page.waitForTimeout(300);
  say('review note', await page.locator('#reviewBoardNote').innerText());
  say('review bar', await page.locator('#reviewEval').getAttribute('title'));
  const addBtn = page.locator('button:has-text("to drills")');
  if (await addBtn.count()) { await addBtn.click(); await page.waitForTimeout(200); say('add said', await page.locator('#reviewOut .row .note').innerText()); }
  await page.click('#reviewExplore');
  say('explore section', await page.locator('#section-board').isVisible());

  // ---- Settings
  await page.click('#tab-settings');
  say('swatches', await page.locator('#settingBoards .swatch').count());
  await page.locator('#settingBoards .swatch').nth(1).click();
  say('root board', await page.evaluate(() => document.documentElement.dataset.board));
  say('sq colour', await page.locator('#settingSample .sq.dark').first().evaluate((e) => getComputedStyle(e).backgroundColor));
  await page.locator('#settingPieces .style-card').nth(2).click();
  say('letters piece', await page.locator('#settingSample .piece').first().innerText());
  await page.selectOption('#settingTheme', 'dark');
  say('root theme', await page.evaluate(() => document.documentElement.dataset.theme));
  say('prefs stored', await page.evaluate(() => localStorage.getItem('hardlines:prefs')));
  await page.click('#settingReset');
  say('after reset', await page.evaluate(() => document.documentElement.dataset.board + '/' + document.documentElement.dataset.pieces));

  // Today
  await page.click('#tab-today');
  say('download wrap hidden', await page.locator('#downloadWrap').isHidden());
  say('download note', await page.locator('#downloadNote').innerText());
  say('snapshot length', await page.evaluate(() => SOURCE_SNAPSHOT.length));
  say('snapshot has boot', await page.evaluate(() => SOURCE_SNAPSHOT.includes('function boot()') && !SOURCE_SNAPSHOT.includes('class="sq ')));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#tab-board'); await page.waitForTimeout(300);
  await page.screenshot({ path: 'v2-board-phone.png', fullPage: true });
  await page.click('#tab-openings'); await page.locator('.opening .btn:has-text("Learn it")').first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'v2-opening-phone.png', fullPage: true });
  console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 8).join('\n') : 'no page errors');
  await browser.close();
})().catch((e) => { console.error('DRIVER FAILED', e.message); process.exit(1); });
