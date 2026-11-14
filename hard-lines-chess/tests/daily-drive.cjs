// One session a day, driven in a real browser: across Drills, Puzzles, Weak
// spots and Openings and back to Today, by clicks.
//
// The counting of days is held to the calendar in node (daily.test.mjs). What
// that cannot show is the session itself: that the four screens hand on to
// one another, that each takes what the session wants from it and no more,
// that stopping or wandering off loses nothing, and that a day is counted
// when a session is seen through and not otherwise.
//
// What has to be true:
//
//   - with nothing to do, Today says so; where there is a run of days, the
//     day is marked as one that does not end it — until something turns up,
//     when it is an ordinary day again — and where there is none, opening the
//     app writes nothing;
//   - Today says what today's session holds, in the order it will be done;
//   - Start goes to the first part; the bar across the top says which part
//     and how far, on every screen; each screen's own Next goes on to the
//     next part when the session has had what it wanted, leaving the rest of
//     what is due still due;
//   - leaving for another screen keeps the session, and the bar brings it
//     back to the same question;
//   - Stop ends it without counting the day, and what was answered stays
//     answered; a session skipped from end to end is not counted either;
//   - seeing it through counts the day, says what was done, and the count of
//     days is right the day after a run, and after a day missed;
//   - it is still there after a reload, and is in a backup;
//   - inside the Android app there is a reminder switch, which tells the app
//     the time and hears back; the app is told when a session is finished;
//     and in a browser there is no switch.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');
const path = require('path');

const PORT = 8337;
const base = `http://127.0.0.1:${PORT}/`;

// A small pack, as tools/make-puzzle-pack.mjs writes one (see weak-spots-drive.cjs).
const CODES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const THEMES = ['fork', 'hangingPiece', 'mateIn1', 'mate', 'opening', 'endgame'];
const code = (names) => names.map((n) => CODES[THEMES.indexOf(n)]).join('');
const POSITIONS = [
  ['rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2', 'g2g4 d8h4', ['mateIn1', 'mate', 'opening']],
  ['4k3/8/8/8/3q4/8/8/3RK3 b - - 0 1', 'e8e7 d1d4', ['hangingPiece', 'endgame']],
  ['r3k3/p7/8/3N4/8/8/8/4K3 b - - 0 1', 'a7a6 d5c7 e8e7 c7a8', ['fork', 'endgame']],
];
const rows = [];
for (const [i, [fen, moves, themes]] of POSITIONS.entries()) {
  for (let rating = 600; rating <= 1400; rating += 20) rows.push(`${'abc'[i]}${rating}`.padEnd(5, 'x') + `\t${rating}\t${code(themes)}\t${fen}\t${moves}`);
}
rows.sort((a, b) => Number(a.split('\t')[1]) - Number(b.split('\t')[1]) || (a < b ? -1 : 1));
const PACK = { text: ['# a pack for the tests', `# themes ${THEMES.join(' ')}`, ...rows].join('\n') + '\n', about: { format: 1, count: rows.length } };

// The two requests for the pack, answered from here: a pack, or none.
const STAND_IN = (pack) => {
  const flag = (name, fallback) => { try { return localStorage.getItem(`test:${name}`) ?? fallback; } catch { return fallback; } };
  const real = window.fetch;
  window.fetch = async (url, options) => {
    const which = /puzzle-pack\.(json|txt)$/.exec(String(url))?.[1];
    if (!which) return real(url, options);
    if (flag('pack', 'none') === 'none') return which === 'json' ? new Response('{"format": 1, "count": 0}') : new Response('', { status: 404 });
    return which === 'json' ? new Response(JSON.stringify(pack.about)) : new Response(pack.text);
  };
};

// The Android app, as far as the reminder goes: it keeps the time, answers how
// things stand, and tells the page when something has changed.
const PRETEND_APP = () => {
  const kept = () => JSON.parse(localStorage.getItem('test:reminder') ?? '{"on":false,"hour":18,"minute":0,"allowed":true}');
  const note = (what) => {
    const said = JSON.parse(localStorage.getItem('test:app') ?? '[]');
    said.push(what);
    localStorage.setItem('test:app', JSON.stringify(said));
  };
  window.HardLinesAndroid = {
      reminder: () => JSON.stringify(kept()),
      setReminder: (on, hour, minute) => {
        note(`setReminder ${on} ${hour} ${minute}`);
        localStorage.setItem('test:reminder', JSON.stringify({ ...kept(), on, hour, minute }));
        setTimeout(() => window.hardLinesReminderChanged && window.hardLinesReminderChanged(), 0);
      },
      sessionDone: (day, run) => { note(`sessionDone ${day} ${run}`); },
    };
};

(async () => {
  const srv = serve(path.join(DIST, 'pwa'), PORT);
  await srv.ready;
  const browser = await launch();
  const say = (k, v) => console.log(String(k).padEnd(74), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    say(what, ok ? String(typeof got === 'string' ? got : JSON.stringify(got)).slice(0, 120)
      : `${JSON.stringify(got).slice(0, 600)}   <- expected ${JSON.stringify(want).slice(0, 600)}`);
    if (!ok) failures.push(what);
  };
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(STAND_IN, PACK);

  // ── helpers ──────────────────────────────────────────────────────────────
  const drive = (p) => ({
    flag: (name, value) => p.evaluate(([n, v]) => { if (v === null) localStorage.removeItem(`test:${n}`); else localStorage.setItem(`test:${n}`, v); }, [name, value]),
    up: async () => {
      await p.waitForSelector('#tab-today', { timeout: 20000 });
      await p.waitForFunction(() => typeof Weak !== 'undefined' && Weak.about !== undefined, null, { timeout: 20000 });
      await p.evaluate(() => { let seed = 5; Weak.rng = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; });
    },
    card: () => p.$eval('#sessionCard', (e) => (e.hidden ? null : e.innerText.replace(/\s*\n\s*/g, ' | ').trim())),
    bar: () => p.$eval('#sessionBar', (e) => (e.hidden ? null : {
      where: `${e.querySelector('#sessionWhere').textContent} | ${e.querySelector('#sessionPart').textContent}`,
      buttons: [...e.querySelectorAll('button')].filter((b) => !b.hidden).map((b) => b.textContent).join(' / '),
    })),
    section: () => p.evaluate(() => App.section),
    days: () => p.evaluate(() => JSON.parse(JSON.stringify(App.daily))),
    click: async (board, uci) => {
      await p.click(`#${board} .sq[aria-label="${uci.slice(0, 2)}"]`);
      await p.click(`#${board} .sq[aria-label="${uci.slice(2, 4)}"]`);
    },
  });
  const d = drive(page);
  const today = () => page.evaluate(() => dayKey());
  const open = async (pack) => { await d.flag('pack', pack); await page.reload(); await d.up(); };

  /** Answer the drill on the board: rightly, or with another move. */
  const drill = async (right) => {
    await page.waitForFunction(() => Drill.current && !Drill.answered && Drill.view.interactive);
    await d.click('drillBoard', right ? 'g1f3' : 'b1c3');
    await page.waitForFunction(() => Drill.answered && !document.getElementById('drillNext').hidden);
  };
  const puzzle = async (right) => {
    await page.waitForFunction(() => Puzzles.current && !Puzzles.answered && Puzzles.view.interactive);
    await d.click('puzzleBoard', right ? 'h5f7' : 'h5h4');
    await page.waitForFunction(() => Puzzles.answered && !document.getElementById('puzzleNext').hidden);
  };
  /** Solve the weak-spot puzzle on the board, or ask for its answer. */
  const weak = async (right) => {
    await page.waitForFunction(() => Weak.current && !Weak.current.over && Weak.view.interactive, null, { timeout: 15000 });
    if (!right) {
      await page.click('#weakShow');
    } else {
      for (;;) {
        await page.waitForFunction(() => Weak.current && !Weak.current.over && Weak.view.interactive);
        const step = await page.evaluate(() => ({ uci: Weak.current.opened.line[Weak.current.step].uci, last: Weak.current.step >= Weak.current.opened.line.length - 1 }));
        await d.click('weakBoard', step.uci);
        if (step.last) break;
      }
    }
    await page.waitForFunction(() => Weak.current?.over && !document.getElementById('weakNext').hidden);
  };
  /** Play the opening line on the board from memory, without a slip. */
  const openingLine = async () => {
    for (;;) {
      await page.waitForFunction(() => document.getElementById('openingResult').textContent !== ''
        || (Openings.current && Openings.ply < Openings.line.length && openingStudentToMove() && !Openings.view.locked && Openings.view.interactive), null, { timeout: 15000 });
      if (await page.evaluate(() => document.getElementById('openingResult').textContent !== '')) break;
      const uci = await page.evaluate(() => moveToUci(sanToMove(Openings.view.board, Openings.line[Openings.ply])));
      await d.click('openingBoard', uci);
    }
  };

  // What is due: six of your own mistakes, five chances, and a line met before.
  const seed = () => page.evaluate(async () => {
    const drillAt = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    App.drills.items = [0, 1, 2, 3, 4, 5].map((i) => ({
      id: `d${i}`, fen: drillAt, side: 'white', played: 'Qh5', best: { san: 'Nf3', uci: 'g1f3' }, judge: 'app', card: SRS.fresh(),
    }));
    const puzzleAt = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    App.puzzles.items = [0, 1, 2, 3, 4].map((i) => ({
      id: `p${i}`, fen: puzzleAt, side: 'white', moveNumber: 4, theirMove: 'Nf6', best: { san: 'Qxf7#', uci: 'h5f7' }, line: '4. Qxf7#',
      mate: 1, edge: null, found: false, yourMove: 'Qh4', label: 'You vs Them', source: 'review', at: 1000 + i, against: 'elsewhere', judge: 'app', card: SRS.fresh(),
    }));
    App.openings.cards[OPENINGS[0].id] = { ...SRS.fresh(), seen: 1, interval: 1, due: Date.now() - 86400000 };
    await Store.set('drills', App.drills);
    await Store.set('puzzles', App.puzzles);
    await Store.set('openings', App.openings);
    show('today');
    return OPENINGS[0].name;
  });

  // ── A: nothing to do ─────────────────────────────────────────────────────
  await page.goto(base);
  await d.up();
  await open('none');
  check('A: with nothing due and no puzzles, Today says there is no session',
    await d.card(), 'Today\'s session | Nothing is due today, so there is no session. Play a game or analyse one, and tomorrow there will be.');
  check('A: with no run of days to protect, nothing is written for it', await page.evaluate(() => [App.daily.days, Store.stamps.daily ?? 0]), [{}, 0]);
  check('A: a browser has no reminder to offer', await page.$('#reminderBox'), null);
  // Two days running, ending yesterday — and today, nothing to do.
  await page.evaluate(async () => {
    for (const back of [2, 1]) markDay(App.daily, dayKey(Date.now() - back * 86400000), { done: true, at: 0, parts: [] });
    await Store.set('daily', App.daily);
    show('today');
  });
  check('A: with a run, Today says the quiet day does not end it',
    await d.card(), 'Today\'s session | Nothing is due today, so there is no session. A day like this does not end a run: it stands at 2 days.');
  check('A: and the day is marked as one that does not', (await d.days()).days[await today()], { rest: true });
  await page.reload();
  await d.up();
  check('A: which is still so after a reload', [(await d.days()).days[await today()], (await d.card()).includes('it stands at 2 days')], [{ rest: true }, true]);

  // ── B: puzzles, and nothing of your own ──────────────────────────────────
  await open('usual');
  check('B: with a pack of puzzles, they are the session, and it would make three days',
    await d.card(), 'Today\'s session | 12 puzzles for your weak spots, one after another. | 2 days running. Today\'s makes it 3. | Start');
  check('B: and the day is an ordinary one again', (await d.days()).days[await today()], undefined);
  // The rest of this starts from no days at all.
  await page.evaluate(async () => { App.daily = dailyData(null); await Store.set('daily', App.daily); show('today'); });

  // ── C: a session, stopped ────────────────────────────────────────────────
  const line = await seed();
  check('C: Today says what the session holds, in the order it is done', (await d.card()).split(' | ')[1],
    '4 of your own mistakes, 3 chances from your own games, 5 puzzles for your weak spots and one opening line from memory, one after another.');
  check('C: no bar until a session is under way', await d.bar(), null);
  await page.click('#sessionStart');
  check('C: Start goes to your own mistakes', await d.section(), 'drills');
  check('C: and the bar says which part and how far',
    await d.bar(), { where: 'Today\'s session · part 1 of 4 | Your own mistakes · 0 of 4', buttons: 'Skip / Stop' });
  await drill(true);
  check('C: an answer is counted on the bar', (await d.bar()).where, 'Today\'s session · part 1 of 4 | Your own mistakes · 1 of 4');
  await page.click('#sessionStop');
  check('C: Stop goes back to Today', [await d.section(), await d.bar()], ['today', null]);
  check('C: the day is not counted', (await d.days()).days[await today()], undefined);
  check('C: what was answered stays answered', await page.evaluate(() => dueDrills().length), 5);
  check('C: and the session is offered again, from what is still due', (await d.card()).split(' | ')[1],
    '4 of your own mistakes, 3 chances from your own games, 5 puzzles for your weak spots and one opening line from memory, one after another.');

  // ── D: a session skipped from end to end ─────────────────────────────────
  await page.click('#sessionStart');
  await page.click('#sessionSkip');
  check('D: skipping a part goes to the next', [await d.section(), (await d.bar()).where], ['puzzles', 'Today\'s session · part 2 of 4 | Chances from your own games · 0 of 3']);
  await page.click('#sessionSkip');
  await page.waitForFunction(() => App.section === 'weak');
  await page.waitForFunction(() => Weak.current && Weak.view.interactive, null, { timeout: 15000 });
  check('D: inside a session the puzzles have no stop button of their own', await page.$eval('#weakStop', (e) => e.hidden), true);
  await page.click('#sessionSkip');
  check('D: the last part\'s skip says, to anything reading it out, that it finishes the session',
    [await d.section(), (await d.bar()).buttons, await page.$eval('#sessionSkip', (e) => e.getAttribute('aria-label'))],
    ['openings', 'Skip / Stop', 'Skip this part and finish the session']);
  await page.click('#sessionSkip');
  await page.waitForFunction(() => App.section === 'today');
  check('D: a session with nothing answered is not a day done', [(await d.days()).days[await today()], (await d.card()).split(' | ')[0]], [undefined, 'Today\'s session']);
  check('D: and nothing was used up by skipping', await page.evaluate(() => [dueDrills().length, duePuzzles().length, App.weak.log.length]), [5, 5, 0]);

  // ── E: a session seen through ────────────────────────────────────────────
  await page.click('#sessionStart');
  for (const right of [true, false, true, false]) {
    await drill(right);
    await page.click('#drillNext');
  }
  check('E: after four of your mistakes, their Next goes on to the next part', await d.section(), 'puzzles');
  check('E: leaving one of them still due, for the Drills tab or tomorrow', await page.evaluate(() => dueDrills().length), 1);
  check('E: the bar has moved on', (await d.bar()).where, 'Today\'s session · part 2 of 4 | Chances from your own games · 0 of 3');

  await puzzle(true);
  // Wander off, and come back.
  const asked = await page.evaluate(() => Puzzles.current.id);
  await gotoSection(page, 'progress');
  check('E: on another screen the bar is still there, with the way back', await d.bar(),
    { where: 'Today\'s session · part 2 of 4 | Chances from your own games · 1 of 3', buttons: 'Back to it / Stop' });
  await gotoSection(page, 'today');
  check('E: and Today says a session is under way', await d.card(), 'Today\'s session | Under way: part 2 of 4, chances from your own games. | Back to it');
  await page.click('#sessionBack');
  check('E: back is the same screen and the same question', [await d.section(), await page.evaluate(() => Puzzles.current?.id)], ['puzzles', asked]);
  await page.click('#puzzleNext');
  await puzzle(true);
  await page.click('#puzzleNext');
  await puzzle(true);
  await page.click('#puzzleNext');
  await page.waitForFunction(() => App.section === 'weak');
  check('E: after three chances, on to the puzzles for your weak spots', (await d.bar()).where, 'Today\'s session · part 3 of 4 | Puzzles for your weak spots · 0 of 5');
  for (const right of [true, true, false, true, true]) {
    await weak(right);
    if (right === false) check('E: a set inside a session is as long as the session wants', await page.$eval('#weakWhere', (e) => e.textContent.slice(0, 13)), 'Puzzle 3 of 5');
    await page.click('#weakNext');
  }
  await page.waitForFunction(() => App.section === 'openings');
  check('E: after the fifth, on to the opening line — the one met before', [await page.$eval('#openingTitle', (e) => e.textContent), (await d.bar()).where],
    [line, 'Today\'s session · part 4 of 4 | An opening line from memory']);
  await openingLine();
  check('E: the line done, the bar offers the way out and the result stays up',
    [(await d.bar()).buttons, (await page.$eval('#openingResult', (e) => e.textContent)).startsWith('Clean run.')], ['Finish / Stop', true]);
  await page.click('#sessionNext');
  await page.waitForFunction(() => App.section === 'today');
  check('E: Finish goes back to Today, which says the day is done and what was done', await d.card(),
    'Done for today | 1 day running. | 2 of 4 of your own mistakes put right, 3 of 3 chances from your own games taken, 4 of 5 weak-spot puzzles solved and an opening line from memory without a prompt. | Another session');
  check('E: the bar is gone', await d.bar(), null);
  let kept = await d.days();
  check('E: the day is stored as done, with what was done and the run it made',
    [kept.days[await today()].done, kept.days[await today()].run, kept.days[await today()].parts.map((p) => `${p.kind} ${p.ok}/${p.n}`).join(', '), kept.best],
    [true, 1, 'drills 2/4, puzzles 3/3, weak 4/5, opening 1/1', 1]);
  check('E: the puzzles set counts as today\'s on its own screen too', await page.evaluate(() => weakSetDoneToday()), true);

  // ── F: kept ──────────────────────────────────────────────────────────────
  await page.reload();
  await d.up();
  check('F: after a reload the day is still done', (await d.card()).split(' | ').slice(0, 2), ['Done for today', '1 day running.']);
  check('F: and it is in a backup file', await page.evaluate(() => {
    const file = JSON.parse(buildBackup().text);
    return [Object.keys(file.areas).includes('daily'), Object.keys(file.areas.daily.payload.days).length, readBackup(buildBackup().text).ok];
  }), [true, 1, true]);

  // ── G: runs of days ──────────────────────────────────────────────────────
  // Three days running, ending yesterday; today's not done.
  await page.evaluate(async () => {
    const day = (back) => dayKey(Date.now() - back * 86400000);
    App.daily = dailyData(null);
    for (const back of [3, 2, 1]) markDay(App.daily, day(back), { done: true, at: 0, parts: [] });
    await Store.set('daily', App.daily);
    show('today');
  });
  check('G: with a run behind it, Today says what today\'s makes it', (await d.card()).split(' | ')[2], '3 days running. Today\'s makes it 4.');
  await page.click('#sessionStart');
  await drill(true);
  await page.click('#drillNext');
  // What is left is one of each kind or none; see it through quickly.
  for (;;) {
    const where = await d.section();
    if (where === 'today') break;
    if (where === 'puzzles') { await puzzle(true); await page.click('#puzzleNext'); }
    else if (where === 'weak') { await weak(true); await page.click('#weakNext'); }
    else if (where === 'drills') { await drill(true); await page.click('#drillNext'); }
    else throw new Error(`the session went to ${where}`);
    await page.waitForTimeout(50);
  }
  check('G: seen through, it is four days running', (await d.card()).split(' | ').slice(0, 2), ['Done for today', '4 days running.']);
  check('G: and that is the longest', (await d.days()).best, 4);
  // A day missed: the last session was the day before yesterday.
  await page.evaluate(async () => {
    const day = (back) => dayKey(Date.now() - back * 86400000);
    const best = App.daily.best;
    App.daily = dailyData(null);
    for (const back of [4, 3, 2]) markDay(App.daily, day(back), { done: true, at: 0, parts: [] });
    App.daily.best = Math.max(best, App.daily.best);
    App.weak.lastSet = 0;
    await Store.set('daily', App.daily);
    show('today');
  });
  check('G: after a day missed, the run is gone and the longest is remembered', (await d.card()).split(' | ')[2], 'Your longest run is 4 days. Today starts a new one.');

  // ── H: the reminder, inside the Android app ──────────────────────────────
  const phone = await ctx.newPage();
  phone.on('pageerror', (e) => errors.push(e.message));
  await phone.addInitScript(STAND_IN, PACK);
  await phone.addInitScript(PRETEND_APP);
  await phone.goto(base);
  const h = drive(phone);
  await h.up();
  const told = () => phone.evaluate(() => JSON.parse(localStorage.getItem('test:app') ?? '[]'));
  check('H: when the app opens it is told the last day a session was finished, and the run then',
    (await told())[0], `sessionDone ${await phone.evaluate(() => dayKey(Date.now() - 2 * 86400000))} 0`);
  check('H: in the app, Today has a reminder, off to begin with', await phone.$eval('#reminderBox summary', (e) => e.textContent), 'Reminder: off');
  await phone.click('#reminderBox summary');
  await phone.fill('#reminderTime', '07:30');
  await phone.click('#reminderToggle');
  await phone.waitForFunction(() => document.querySelector('#reminderBox summary')?.textContent.includes('on'));
  check('H: turning it on tells the app the time picked', (await told()).slice(-1)[0], 'setReminder true 7 30');
  check('H: and Today says it is on, and when', await phone.$eval('#reminderBox summary', (e) => e.textContent), 'Reminder: on, at 07:30');
  check('H: with what that means', await phone.$eval('#reminderNote', (e) => e.textContent),
    'The phone reminds you at 07:30 or a few minutes after, on any day the session has not been done by then.');
  check('H: the switch stays open across the change', await phone.$eval('#reminderBox', (e) => e.open), true);
  await phone.fill('#reminderTime', '21:05');
  await phone.dispatchEvent('#reminderTime', 'change');
  await phone.waitForFunction(() => document.querySelector('#reminderBox summary')?.textContent.includes('21:05'));
  check('H: changing the time while it is on moves it', (await told()).slice(-1)[0], 'setReminder true 21 5');
  // The phone is not letting the app show notifications.
  await phone.evaluate(() => {
    localStorage.setItem('test:reminder', JSON.stringify({ on: true, hour: 21, minute: 5, allowed: false }));
    window.hardLinesReminderChanged();
  });
  check('H: when the phone will not show it, that is said, and where to change it', await phone.$eval('#reminderNote', (e) => [e.textContent, e.classList.contains('bad-note')]),
    ['It is on, but this phone is not letting the app show notifications, so nothing will appear. Allow them for Hard Lines in the phone\'s settings, under Apps.', true]);
  await phone.click('#reminderToggle');
  await phone.waitForFunction(() => document.querySelector('#reminderBox summary')?.textContent === 'Reminder: off');
  check('H: and it can be turned off', (await told()).slice(-1)[0], 'setReminder false 21 5');
  // A session finished in the app is told to the app.
  await phone.evaluate(() => { App.weak.lastSet = 0; show('today'); });
  await phone.click('#sessionStart');
  for (;;) {
    const where = await h.section();
    if (where === 'today') break;
    if (where === 'weak') {
      await phone.waitForFunction(() => Weak.current && !Weak.current.over && Weak.view.interactive, null, { timeout: 15000 });
      await phone.click('#weakShow');
      await phone.waitForFunction(() => Weak.current?.over);
      await phone.click('#weakNext');
    } else if (where === 'drills') {
      await phone.waitForFunction(() => Drill.current && !Drill.answered && Drill.view.interactive);
      await h.click('drillBoard', 'g1f3');
      await phone.waitForFunction(() => Drill.answered);
      await phone.click('#drillNext');
    } else if (where === 'puzzles') {
      await phone.waitForFunction(() => Puzzles.current && !Puzzles.answered && Puzzles.view.interactive);
      await h.click('puzzleBoard', 'h5f7');
      await phone.waitForFunction(() => Puzzles.answered);
      await phone.click('#puzzleNext');
    } else throw new Error(`the session went to ${where}`);
    await phone.waitForTimeout(50);
  }
  check('H: a session finished in the app is told to the app, with the day and the run', (await told()).slice(-1)[0], `sessionDone ${await phone.evaluate(() => dayKey())} 1`);
  await phone.close();

  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
  if (errors.length) failures.push('page errors');
  srv.stop();
  await browser.close();
  if (failures.length) { console.log('FAILED\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
