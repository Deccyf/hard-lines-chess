const { launch, app, serve, DIST, tapSection } = require('./browser.cjs');
(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_')) errors.push('console: ' + m.text()); });

  await page.goto(app());
  await page.waitForSelector('#tab-today', { timeout: 20000 });
  const say = (k, v) => console.log(String(k).padEnd(28), v);

  say('charset / mode', await page.evaluate(() => document.characterSet + ' / ' + document.compatMode));
  say('layout width', await page.evaluate(() => document.documentElement.clientWidth));
  say('mojibake anywhere', await page.evaluate(() => document.body.innerText.includes('Â') || document.body.innerText.includes('â€')));
  say('save button on file://', await page.locator('#downloadRow').isHidden() ? 'hidden (correct)' : 'VISIBLE');
  say('note', await page.locator('#downloadNote').innerText());
  await page.screenshot({ path: 'standalone-today.png', fullPage: false });

  // EVERY section, read off the page rather than listed here, so a screen
  // added later is opened by this driver without anybody remembering to add it.
  const sections = await page.evaluate(() => SECTIONS.map(([id]) => id));
  let broken = 0;
  for (const id of sections) {
    await tapSection(page, id);
    await page.waitForTimeout(150);
    if (!await page.locator('#section-' + id).isVisible()) { say('SECTION BROKEN', id); broken++; }
  }
  say('all sections open by touch', broken === 0 ? `yes (${sections.length})` : `NO — ${broken} broken`);

  await tapSection(page, 'play'); await page.waitForTimeout(200);
  await page.tap('#playBoard .sq[aria-label="e2"]'); await page.tap('#playBoard .sq[aria-label="e4"]');
  await page.waitForTimeout(1800);
  say('a game plays', (await page.locator('#playMoves').innerText()).replace(/\s+/g, ' '));

  await tapSection(page, 'board'); await page.waitForTimeout(200);
  await page.tap('#practiceSuggest');
  await page.waitForFunction(() => document.querySelectorAll('#practiceLines .line-row').length > 0, null, { timeout: 20000 });
  say('engine suggests', (await page.locator('#practiceLines .line-row').first().innerText()).replace(/\s+/g, ' '));

  await tapSection(page, 'openings'); await page.waitForTimeout(200);
  say('openings', await page.locator('.opening').count());
  await tapSection(page, 'settings'); await page.waitForTimeout(200);
  await page.locator('#settingBoards .swatch').nth(2).tap();
  say('theme applies', await page.evaluate(() => document.documentElement.dataset.board));
  say('colour-scheme', await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme));
  await page.selectOption('#settingTheme', 'dark'); await page.waitForTimeout(150);
  say('dark colour-scheme', await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme));
  await page.screenshot({ path: 'standalone-settings-dark.png', fullPage: false });

  console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 5).join('\n') : 'no page errors');
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
