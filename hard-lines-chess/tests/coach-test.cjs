const { launch, app, serve, DIST, gotoSection } = require('./browser.cjs');

// A fake Claude that records exactly what it was sent, so the grounding rules
// can be asserted on the real prompt rather than on the intention.
const STUB = () => {
  window.__asked = [];
  window.claude = {
    use: async (name) => {
      if (name !== 'sample') return null;
      const fn = async (input, opts) => {
        window.__asked.push(input);
        const text = window.__reply ?? 'The move is [[Nf3]] because it develops. A bad line: [[Qd4]]. And a longer one [[Nf3 d5 exd5]].';
        if (opts?.onText) { opts.onText({ text: text.slice(0, 10) }); opts.onText({ text }); }
        return { text, truncated: false };
      };
      fn.limits = async () => ({ images: false });
      return fn;
    },
  };
};

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(STUB);
  await page.goto(app());
  await page.waitForSelector('#tab-today');
  const say = (k, v) => console.log(String(k).padEnd(26), v);

  await gotoSection(page, 'board');
  await page.waitForTimeout(400);
  say('panel shown', await page.locator('#coachPanel').isVisible());
  say('absent panel hidden', await page.locator('#coachAbsent').isHidden());
  say('suggestions', (await page.locator('#coachSuggestions .chip').allInnerTexts()).join(' | '));

  // Ask something that names a legal move and an illegal one.
  await page.fill('#coachQuestion', 'why not Qh5, and is Nf3 better than Bb5?');
  await page.click('#coachAsk');
  await page.waitForFunction(() => window.__asked.length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(800);

  const sent = await page.evaluate(() => window.__asked[0]);
  const first = sent[0].content;
  say('turns sent', sent.length + ' (' + sent.map((t) => t.role).join(',') + ')');
  say('rules present', first.includes('sole source of truth') && first.includes('no clear reason'));
  say('inventory present', /White pieces: King on e1/.test(first));
  say('bare FEN only?', !first.includes('White pieces:') ? 'YES (BAD)' : 'no — inventory included');
  say('material line', (first.match(/Material: .*/) ?? ['none'])[0]);
  say('named-move section', /THE MOVE THE QUESTION ASKED ABOUT|MOVES THE QUESTION NAMED/.test(first));
  say('which moves searched', (first.match(/^(\w+[\w\-+#=]*) \(a \w+ move\)/gm) ?? []).join(' '));
  say('illegal reported', /NOT LEGAL HERE\n([^\n]*)/.exec(first)?.[1] ?? 'none');
  const data = first.slice(first.indexOf('POSITION\nFEN:')).split('QUESTION\n')[0];
  say('no raw decimals in data', !/[-+]?\d+\.\d\d\b/.test(data));
  say('eval in words', (first.match(/Position: .*/) ?? ['none'])[0]);
  say('question at end', first.trim().endsWith('why not Qh5, and is Nf3 better than Bb5?'));

  say('answer rendered', (await page.locator('.coach-answer').last().innerText()).slice(0, 60));
  say('playable buttons', (await page.locator('.coach-line').allInnerTexts()).join(' | '));
  say('unplayable marked', (await page.locator('.coach-bad').allInnerTexts()).join(' | ') || '(none)');

  // A follow-up carries the conversation, on the SAME position.
  await page.fill('#coachQuestion', 'and what about the knight?');
  await page.click('#coachAsk');
  await page.waitForFunction(() => window.__asked.length > 1, null, { timeout: 60000 });
  await page.waitForTimeout(400);
  const second = await page.evaluate(() => window.__asked[1]);
  say('follow-up turns', second.length + ' (' + second.map((t) => t.role).join(',') + ')');
  say('rules only on first', second[0].content.includes('sole source of truth') && !second[2].content.includes('sole source of truth'));

  // A line button plays it on the board, and the way back is offered.
  const before = await page.locator('#practiceMoves').innerText();
  await page.locator('.coach-line').first().click();
  await page.waitForTimeout(1200);
  say('line played', (await page.locator('#practiceMoves').innerText()).replace(/\s+/g, ' ') + ' (was: ' + before.replace(/\s+/g, ' ') + ')');
  say('log explains move', (await page.locator('#coachLog').innerText()).slice(0, 60));
  say('back offered', await page.locator('#coachBack').isVisible());
  await page.click('#coachBack');
  await page.waitForTimeout(400);
  say('back restores thread', (await page.locator('.coach-you').count()) + ' questions visible again');

  // Sessions are per position.
  await page.evaluate(() => { const b = new Board(); b.make(sanToMove(b, 'd4')); openPractice(b.fen()); });
  await page.waitForTimeout(400);
  const log = await page.locator('#coachLog').innerText();
  say('other position, own log', log.includes('Ask about this position') ? 'empty, as it should be' : 'LEAKED: ' + log.slice(0, 40));

  // A FINISHED POSITION carries no figure at all. The engine answers a mated
  // board with score 0 at depth 0, which once reached the prompt as "roughly
  // equal, 0 plies deep" under the heading that calls itself the truth.
  await page.evaluate(() => openPractice('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'));
  await page.waitForTimeout(300);
  const askedBefore = await page.evaluate(() => window.__asked.length);
  await page.fill('#coachQuestion', 'why did I lose?');
  await page.click('#coachAsk');
  await page.waitForFunction((n) => window.__asked.length > n, askedBefore, { timeout: 60000 });
  await page.waitForTimeout(300);
  const mated = await page.evaluate(() => window.__asked[window.__asked.length - 1][0].content);
  // The data section only: the rules prepended to turn one mention figures on purpose.
  const matedData = mated.slice(mated.indexOf('POSITION\nFEN:')).split('QUESTION\n')[0];
  say('mated: position line', (mated.match(/Position: .*/) ?? ['none'])[0]);
  say('mated: states checkmate', /checkmate — Black has won/.test(matedData));
  say('mated: no false figure', !/roughly equal|0 plies|Best moves for|slightly better|clearly better|is winning/.test(matedData));

  console.log(errors.length ? 'ERRORS ' + errors.slice(0, 4).join(' | ') : 'no page errors');
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
