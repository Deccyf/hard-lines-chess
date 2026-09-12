// The navigation, since it went to two levels.
//
// THE FAULT THIS EXISTS TO CATCH is a screen with no way in. Adding a section
// to SECTIONS and forgetting to put it in a GROUP builds cleanly, renders
// cleanly and ships a feature nobody can reach — and no other test would
// notice, because every other test knows the name of the screen it wants. So
// this one walks the nav the way a person does: it clicks every button there
// is, and then checks that the set of screens it arrived at is ALL of them.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');

(async () => {
  const srv = serve(DIST, 8276);
  await srv.ready;
  const browser = await launch();
  // A narrow viewport on purpose: the point of the change was that the strip
  // fits a phone, and a check taken at desktop width would not know.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const say = (k, v) => console.log(String(k).padEnd(38), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got) : `${got}   <- expected ${want}`);
    if (!ok) failures.push(what);
  };

  await page.goto('http://127.0.0.1:8276/hard-lines-chess-app.html');
  await page.waitForSelector('#tab-today', { timeout: 20000 });

  const top = await page.$$eval('#tabs .tab', (e) => e.map((x) => x.textContent));
  say('the top row', top.join(' · '));
  check('six groups, not fourteen screens', top.length, 6);

  // ── the row fits the phone it is on ──────────────────────────────────────
  // MEASURED FROM THE BUTTONS, not from scrollWidth, which is clamped to the
  // container and so reports "exactly fits" for a row that is over by 40px.
  const fits = await page.$eval('#tabs', (nav) => {
    const tabs = [...nav.querySelectorAll('.tab')];
    const gap = parseFloat(getComputedStyle(nav).gap) || 0;
    const content = tabs.reduce((n, t) => n + t.getBoundingClientRect().width, 0) + gap * (tabs.length - 1);
    return { content: Math.ceil(content), client: nav.clientWidth };
  });
  say('strip width', `${fits.content}px of buttons in ${fits.client}px`);
  // The bar fills the width of a phone by design — six buttons that flex to
  // share it — so the question is no longer whether there is room to spare
  // but whether it overflows. A pixel over is the row scrolling again.
  check('the top row fits a 390px phone without overflowing', fits.content <= fits.client, true);

  // ── every screen is reachable, and every screen reached is a real one ─────
  const reached = new Set();
  const sections = await page.evaluate(() => SECTIONS.map(([id]) => id));
  for (const id of sections) {
    await gotoSection(page, id);
    const state = await page.evaluate((s) => ({
      shown: !document.getElementById('section-' + s).hidden,
      current: App.section,
    }), id);
    if (state.shown && state.current === id) reached.add(id);
  }
  check('every screen has a way in', reached.size, sections.length);
  const orphans = sections.filter((s) => !reached.has(s));
  if (orphans.length) say('unreachable', orphans.join(', '));

  // ── a section left out of every group would be unreachable ───────────────
  const grouped = await page.evaluate(() => GROUPS.flatMap((g) => g.sections));
  check('no screen is missing from the groups', sections.every((s) => grouped.includes(s)), true);
  check('and no group names a screen that does not exist',
    grouped.every((s) => sections.includes(s)), true);
  check('and no screen is in two groups at once', new Set(grouped).size, grouped.length);

  // ── the second row appears only where there is a choice to make ───────────
  await gotoSection(page, 'today');
  check('a group of one shows no second row', await page.$eval('#subtabsWrap', (e) => e.hidden), true);
  await gotoSection(page, 'openings');
  check('a group of several shows one', await page.$eval('#subtabsWrap', (e) => !e.hidden), true);
  check('and the screen you are on is marked',
    await page.$eval('#tab-openings', (e) => e.classList.contains('on')), true);
  check('and its group is marked above it',
    await page.$eval('#gtab-learn', (e) => e.classList.contains('on')), true);

  // ── coming back to a group returns you where you were ────────────────────
  await gotoSection(page, 'vision');
  await gotoSection(page, 'today');
  await page.click('#gtab-learn');
  await page.waitForTimeout(120);
  check('a group remembers where you were', await page.evaluate(() => App.section), 'vision');

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
