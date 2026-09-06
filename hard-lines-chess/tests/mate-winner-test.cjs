const { launch, app, serve, DIST } = require('./browser.cjs');
// A game reviewed as the side that DELIVERED mate, from both colours. The
// mating move is never a mistake, the final position sits at the sentinel,
// the curve ends at the winner's 100%, and every readout says checkmate.
const SELF = JSON.parse(require('fs').readFileSync('selfplay.json', 'utf8')).pgn;   // Black mates on move 18
const WHITE_WINS = '[White "Me"] [Black "Them"]\n1. e4 e5 2. Bc4 Bc5 3. Qh5 Nf6 4. Qxf7#';
const BLACK_WINS = '[White "Them"] [Black "Me"]\n' + SELF;
const BLACK_WINS_SHORT = '[White "Them"] [Black "Me"]\n1. f3 e5 2. g4 Qh4#';
// And the LOSER's view of the same game: the mating move is theirs, still
// best, never a mistake, and the curve ends at his 0%.
const WHITE_LOSES = '[White "Me"] [Black "Them"]\n' + SELF;
let fail = 0;
const ok = (name, cond, detail = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!cond) fail++; };
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1200 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(app());
  await page.waitForSelector('#tab-review'); await page.click('#tab-review');
  for (const [name, pgn, winnerWhite, heWon] of [['white wins', WHITE_WINS, true, true], ['black wins', BLACK_WINS, false, true], ['black wins (short)', BLACK_WINS_SHORT, false, true], ['white loses', WHITE_LOSES, false, false]]) {
    console.log('--- ' + name);
    await page.fill('#pgnInput', pgn); await page.fill('#reviewName', 'Me');
    await page.selectOption('#reviewDepth', '7'); await page.click('#reviewRun');
    await page.waitForFunction(() => document.getElementById('reviewStatus').textContent.startsWith('Done'), null, { timeout: 300000 });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const last = Review.result.judged.at(-1);
      const pts = document.querySelector('svg.curve').querySelector('polyline').getAttribute('points').split(' ');
      return { side: Review.side, last: { san: last.san, cls: last.cls, mates: last.mates, loss: last.loss, mine: last.mine },
        mistakeOnMate: Review.result.mistakes.some((m) => m.ply === last.ply),
        finalWhiteCp: Review.result.whiteCp.at(-1), lastY: Number(pts.at(-1).split(',')[1]),
        dotOnMate: [...document.querySelectorAll('svg.curve circle')].some((c) => Number(c.getAttribute('cx')) === last.ply),
        glyph: document.querySelector(`#reviewMoves .mv[data-ply="${last.ply}"]`).dataset.class,
        title: document.querySelector(`#reviewMoves .mv[data-ply="${last.ply}"]`).title, ply: last.ply };
    });
    ok(heWon ? 'reviewed as the winner' : 'reviewed as the loser', r.side === ((winnerWhite === heWon) ? 'white' : 'black'), r.side);
    ok(heWon ? 'mating move is his and best' : 'mating move is theirs and best', r.last.mine === heWon && r.last.cls === 'best' && r.last.mates && r.last.loss === 0, JSON.stringify(r.last));
    ok('no mistake on the mating move', !r.mistakeOnMate);
    ok('no mistake dot on the mating move', !r.dotOnMate);
    ok('final whiteCp at the sentinel', r.finalWhiteCp === (winnerWhite ? 30000 : -30000), String(r.finalWhiteCp));
    ok(heWon ? 'curve ends at 100% for him' : 'curve ends at 0% for him', r.lastY === (heWon ? 0 : 100), 'y=' + r.lastY);
    ok('move list glyph is best', r.glyph === 'best', r.glyph);
    ok('move title says checkmate', /checkmate\.$/.test(r.title), r.title);
    await page.locator(`#reviewMoves .mv[data-ply="${r.ply}"]`).click(); await page.waitForTimeout(250);
    const evalLine = await page.locator('#reviewBoardEval').innerText();
    const barTitle = await page.locator('#reviewEval').getAttribute('title');
    const labels = await page.locator('#reviewEval .evalbar-label').allInnerTexts();
    const height = await page.locator('#reviewEval .evalbar-white').evaluate((e) => e.style.height);
    ok('readout says checkmate', evalLine === `After the move: checkmate — ${winnerWhite ? 'Black' : 'White'} is checkmated.`, evalLine);
    ok('bar title says checkmate', /^Checkmate/.test(barTitle), barTitle);
    ok('bar label is # not M0', labels.includes('#') && !labels.includes('M0'), labels.join('|'));
    ok('bar full for the winner', height === (winnerWhite ? '100%' : '0%'), height);
    ok('board note says checkmate', /checkmate\.$/.test(await page.locator('#reviewBoardNote').innerText()));
  }
  // Two mates on the board and he played the one the search did not list
  // first. This is the case the walk used to write up as "you had a forced
  // mate and let it go" — and the only one that can tell a mating move
  // apart from the engine's own move, since in every other game above the
  // two coincide.
  console.log('--- two mates, he plays the other one');
  const two = await page.evaluate(async () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R3R1K1 w - - 0 1';
    const out = {};
    for (const mv of ['Ra8#', 'Re8#']) {
      const parsed = parsePgn(`[FEN "${fen}"]\n[SetUp "1"]\n1. ${mv}`);
      const res = await reviewGame(parsed, 'white', { movetime: 120, depth: 7, withTactics: false });
      const j = res.judged[0];
      out[mv] = { engineBest: j.best?.san, cls: j.cls, mates: j.mates, loss: j.loss, mistakes: res.mistakes.length, whiteCp: res.whiteCp[1] };
    }
    return out;
  });
  const other = two['Ra8#'].engineBest === 'Ra8#' ? 'Re8#' : 'Ra8#';
  ok('engine listed one of the two mates', ['Ra8#', 'Re8#'].includes(two['Ra8#'].engineBest), two['Ra8#'].engineBest);
  ok(`the other mate (${other}) is still best`, two[other].cls === 'best' && two[other].mates && two[other].loss === 0, JSON.stringify(two[other]));
  ok('and is not a mistake', two[other].mistakes === 0);
  ok('and sits at the sentinel', two[other].whiteCp === 30000, String(two[other].whiteCp));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fail ? `${fail} FAILED` : 'all passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
