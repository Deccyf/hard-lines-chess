// An empty copy says that it is one, and an app that could not open its data
// says so on every screen — driven.
//
// WHAT HAPPENED. Somebody whose games were all in the web version — the only
// place an import from Chess.com worked, before 1.6 — installed the Android
// app, opened it, found the Progress page empty, and took that for the loss of
// everything. The app was simply new. Nothing on any screen said so: a copy
// with nothing in it, a copy whose data could not be opened, and a copy whose
// data had been cleared all drew the same empty pages.
//
// What has to be true:
//
//   A. A COPY WITH NOTHING IN IT SAYS SO, at the top of Today and on the
//      Progress page: that it holds nothing yet, that other copies keep their
//      own data and still have it, and how a history is brought across — with
//      the button that does it, which does.
//
//   B. IT GOES AS SOON AS ANYTHING HAS BEEN MADE HERE, whatever kind of thing
//      it is. A setting is not a thing made.
//
//   C. THE ANDROID APP SAYS WHEN IT WAS PUT ON THE PHONE, which is what settles
//      whether an empty app is a new one — and says nothing about it, rather
//      than something wrong, where the app will not tell it.
//
//   D. A COPY THAT COULD NOT OPEN ITS DATA DOES NOT SAY THAT IT IS EMPTY. It
//      says, above every screen, that the data is still there and could not be
//      reached, and offers to try again — which works.
//
//   E. A SAVE THAT STARTS FAILING IS SAID ON THE SCREEN THAT IS OPEN, at once,
//      and stops being said when the saves catch up.
//
//   F. A DATABASE THE BROWSER HAS CLEARED IS SAID TO BE THAT, above every
//      screen, and not passed off as a new copy until the person has said to
//      carry on without it.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 8347;
const base = `http://127.0.0.1:${PORT}/`;
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 HardLinesAndroid/1.6.1';
const played = fs.readFileSync(path.join(__dirname, '..', 'tools', 'rating-games.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));
const MOVES = played.find((r) => r.elo === 300 && r.game === 0).pgn;

// Ways to make the large database misbehave, switched by a flag in
// localStorage so that they survive a reload and can be turned off again.
const SABOTAGE = () => {
  const flag = (name) => { try { return localStorage.getItem(`test:${name}`); } catch { return null; } };
  const realPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function put(value, key) {
    if (flag('puts') === 'refuse') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    return realPut.call(this, value, key);
  };
  const realGet = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function get(key) {
    if (flag('gets') === key) throw new DOMException('The record could not be read.', 'UnknownError');
    return realGet.call(this, key);
  };
  const realOpen = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function open(...args) {
    if (flag('database') === 'shut') throw new DOMException('The database could not be opened.', 'UnknownError');
    return realOpen.apply(this, args);
  };
};

// The Android app's side of the page, as far as this needs it: a file to
// restore from, and what the phone says about when the app arrived. `arrived`
// is { first, updated }, the text the app is to answer with, or null for an
// app that has no such answer to give.
const PRETEND_APP = ({ file, arrived }) => {
  const app = { opened: 0, restore: null };
  window.__app = app;
  const whole = (slot) => Boolean(slot) && slot.at >= slot.text.length;
  window.HardLinesAndroid = {
    beginBackup() {}, appendBackup() {}, saveBackup() {},
    openBackup: () => { app.opened += 1; setTimeout(() => { app.restore = { text: file, at: 0 }; window.hardLinesRestoreReady(); }, 30); },
    openRestore: () => (app.restore ? 1 : 0),
    restoreChunk: () => {
      const slot = app.restore;
      if (!slot || slot.at >= slot.text.length) return '';
      const out = slot.text.slice(slot.at, slot.at + 200000);
      slot.at += out.length;
      return out;
    },
    clearRestore: () => { const all = whole(app.restore); app.restore = null; return all; },
    beginKeep() {}, appendKeep() {}, commitKeep: () => false,
    openKept: () => 0, keptChunk: () => '', closeKept: () => false,
    reminder: () => JSON.stringify({ on: false, hour: 18, minute: 0, allowed: true }), setReminder() {}, sessionDone() {},
    ...(arrived === null ? {} : { installed: () => (typeof arrived === 'string' ? arrived : JSON.stringify(arrived)) }),
  };
};

(async () => {
  const srv = serve(path.join(DIST, 'pwa'), PORT);
  await srv.ready;
  const browser = await launch();
  const say = (k, v) => console.log(String(k).padEnd(70), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got).slice(0, 100) : `${String(got).slice(0, 500)}   <- expected ${String(want).slice(0, 500)}`);
    if (!ok) failures.push(what);
  };
  const errors = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-newcopy-'));

  const open = async ({ init = [], userAgent } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, acceptDownloads: true, ...(userAgent ? { userAgent } : {}) });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    for (const script of init) {
      if (Array.isArray(script)) await page.addInitScript(script[0], script[1]); else await page.addInitScript(script);
    }
    await page.goto(base);
    await page.waitForSelector('#tab-today', { timeout: 20000 });
    await page.waitForFunction(() => typeof Backup !== 'undefined' && Backup.ready);
    return page;
  };
  const restarted = async (page, action) => {
    await Promise.all([page.waitForEvent('load'), action()]);
    await page.waitForSelector('#tab-today', { timeout: 20000 });
    await page.waitForFunction(() => typeof Backup !== 'undefined' && Backup.ready);
  };
  const reload = (page) => restarted(page, () => page.reload());
  const flag = (page, name, value) => page.evaluate(([n, v]) => {
    if (v === null) localStorage.removeItem(`test:${n}`); else localStorage.setItem(`test:${n}`, v);
  }, [name, value]);
  const text = (page, id) => page.$eval(`#${id}`, (e) => e.textContent);
  const shown = (page, id) => page.$eval(`#${id}`, (e) => !e.hidden && e.getClientRects().length > 0);
  const progressNotes = async (page) => {
    await gotoSection(page, 'progress');
    return page.$$eval('#progressOut p.note', (all) => all.map((p) => p.textContent).join(' | '));
  };
  const review = async (page) => {
    await gotoSection(page, 'review');
    await page.fill('#pgnInput', `[White "Me"] [Black "Them"] [Date "2026.11.01"]\n${MOVES}`);
    await page.fill('#reviewName', 'Me');
    await page.selectOption('#reviewDepth', '7');
    await page.click('#reviewRun');
    await page.waitForFunction(() => document.getElementById('reviewStatus').textContent.startsWith('Done'), null, { timeout: 300000 });
  };
  const NEW_PROGRESS = 'Nothing is stored in this copy of the app.';

  // ── A. a copy with nothing in it says so ───────────────────────────────────
  const a = await open({ init: [SABOTAGE] });
  check('A: a new copy in a browser says so at the top of Today', await shown(a, 'newCopy'), true);
  check('A: under a heading that says what it is', await text(a, 'newCopyTitle'), 'Nothing is stored in this browser yet');
  const webNote = await text(a, 'newCopyNote');
  check('A: it says the copies keep their own data',
    webNote.startsWith('This copy keeps its own data, apart from the Android app and from any other browser or device.'), true);
  check('A: that games in another copy are still there, and not lost',
    webNote.includes('If your games are in another copy, they are still there: nothing has been lost, they are just not in this one.'), true);
  check('A: and how they are brought across',
    webNote.endsWith('A backup file brings them across. In the other copy, go to Today, find “Your data” and press “Save a backup file”. Then press the button below and choose that file.'), true);
  check('A: it is above the day\'s work, not under it', await a.evaluate(() => {
    const first = [...document.querySelectorAll('#section-today > *')].find((e) => !e.hidden && e.getClientRects().length > 0 && !e.classList.contains('lede'));
    return first?.id;
  }), 'newCopy');
  check('A: “Your data” says what this copy holds, in so many words', await text(a, 'storeHolds'), 'This copy holds nothing yet.');
  check('A: no warning is shown: nothing is wrong', await shown(a, 'storeAlert'), false);
  const webProgress = await progressNotes(a);
  check('A: the Progress page says the same, after what it always said', webProgress,
    'Review a game and this fills in: how often each kind of mistake shows up, and whether it is getting rarer.'
    + ' | Nothing is stored in this copy of the app. If your games are in another copy of it — the Android app, another browser — they are still there, and Today says how to bring them here.');

  // A backup to bring across: made by another copy, which has a game in it.
  const other = await open({ init: [SABOTAGE] });
  await review(other);
  const [download] = await Promise.all([other.waitForEvent('download'), (async () => { await gotoSection(other, 'today'); await other.click('#backupSave'); })()]);
  const file = path.join(tmp, download.suggestedFilename());
  await download.saveAs(file);
  const backup = fs.readFileSync(file, 'utf8');
  const held = await other.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(Store.snapshot()).map(([k, v]) => [k, v.payload]))));
  check('A: (a backup was made by another copy, with a game in it)', JSON.parse(backup).areas.reviews.payload.games.length, 1);
  await other.context().close();

  await gotoSection(a, 'today');
  const [chooser] = await Promise.all([a.waitForEvent('filechooser'), a.click('#newCopyRestore')]);
  await chooser.setFiles(file);
  await a.waitForFunction(() => !document.getElementById('backupConfirm').hidden);
  check('A: the button on that panel opens a backup, and the app asks before it does anything',
    /^This backup was saved on .* in the web version\. It holds 1 imported or reviewed game \(1 analysed\), .*This app now holds nothing yet\./.test(await text(a, 'backupConfirmText')), true);
  await restarted(a, () => a.click('#backupReplace'));
  check('A: restored, the copy holds what the other one did',
    await a.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(Store.snapshot()).map(([k, v]) => [k, v.payload])))), held);
  check('A: and no longer says it is empty', await shown(a, 'newCopy'), false);
  check('A: “Your data” says what it holds now', (await text(a, 'storeHolds')).startsWith('This copy holds 1 imported or reviewed game (1 analysed), '), true);
  check('A: nor does the Progress page', (await progressNotes(a)).includes(NEW_PROGRESS), false);
  await a.context().close();

  // ── B. it goes as soon as anything has been made here ──────────────────────
  const b = await open({ init: [SABOTAGE] });
  const made = await b.evaluate(() => {
    const out = {};
    const was = { ...Store.cache };
    const tried = {
      'a game reviewed': ['reviews', { games: [{ at: 1, reviewed: true }] }],
      'a game imported and not yet analysed': ['reviews', { games: [{ at: 1, reviewed: false }] }],
      'a drill': ['drills', { items: [{ id: 'x' }] }],
      'a puzzle from a game': ['puzzles', { items: [{ id: 'x' }], scanned: [] }],
      'a game played here': ['history', { bands: {}, games: [{ at: 1 }] }],
      'an opening practised': ['openings', { cards: { italian: { seen: 1 } } }],
      'a game played with the teacher': ['teaching', { games: [{ at: 1 }] }],
      'an endgame tried': ['endgames', { kpk: { won: 1 } }],
      'a round of naming squares': ['vision', { squares: 12 }],
      'a timed round': ['storm', { score: 9 }],
      'a puzzle from the pack': ['weakspots', { level: 1200, done: ['00abc'], again: [], log: [] }],
      'a set from the pack, logged': ['weakspots', { level: 1200, done: [], again: [], log: [{ at: 1 }] }],
      'a day\'s session': ['daily', { days: { '2026-11-14': { done: true } }, best: 1 }],
    };
    out.empty = copyHoldsNothing();
    for (const [what, [area, value]] of Object.entries(tried)) {
      Store.cache[area] = value;
      out[what] = copyHoldsNothing();
      Store.cache[area] = was[area];
    }
    Store.cache.prefs = { ...Store.cache.prefs, theme: 'dark', chessComUser: 'somebody' };
    out.setting = copyHoldsNothing();
    Store.cache.prefs = was.prefs;
    // What an area is left as when it was looked at and nothing was done.
    Store.cache.weakspots = { level: 1200, counted: 0, done: [], again: [], log: [] };
    Store.cache.daily = { days: {}, best: 0 };
    out.untouched = copyHoldsNothing();
    return out;
  });
  check('B: a new copy holds nothing', made.empty, true);
  for (const what of Object.keys(made).filter((k) => !['empty', 'setting', 'untouched'].includes(k))) {
    check(`B: ${what} is something`, made[what], false);
  }
  check('B: a setting changed is not', made.setting, true);
  check('B: nor is a part of the app that was opened and left', made.untouched, true);
  await b.context().close();

  const b2 = await open({ init: [SABOTAGE] });
  await review(b2);
  await gotoSection(b2, 'today');
  check('B: after a game has been reviewed, Today no longer says the copy is empty', await shown(b2, 'newCopy'), false);
  check('B: nor does Progress', (await progressNotes(b2)).includes(NEW_PROGRESS), false);
  await reload(b2);
  check('B: nor after a reload', await shown(b2, 'newCopy'), false);

  // ── D. a copy that could not open its data does not say it is empty ────────
  await flag(b2, 'database', 'shut');
  await reload(b2);
  check('D: a copy whose data would not open is stopped', await b2.evaluate(() => `${Store.mode} ${Store.failure}`), 'none unopened');
  check('D: it does not say that it is a new, empty copy', await shown(b2, 'newCopy'), false);
  check('D: it says what happened, above the screen', await shown(b2, 'storeAlert'), true);
  const unopened = await text(b2, 'storeAlertText');
  check('D: in the words Today uses', unopened, await b2.evaluate(() => Store.where()));
  check('D: which say the data is still there',
    unopened.startsWith('YOUR SAVED DATA COULD NOT BE OPENED THIS TIME, AND NOTHING IS BEING SAVED. What you see is an empty app, not a lost one'), true);
  check('D: and “Your data” does not say what the copy holds, because it is not known', await text(b2, 'storeHolds'), '');
  for (const screen of ['progress', 'play', 'puzzles', 'settings', 'openings']) {
    await gotoSection(b2, screen);
    check(`D: the warning is above the ${screen} screen too`, await shown(b2, 'storeAlert'), true);
  }
  check('D: the Progress page does not call the copy empty', (await progressNotes(b2)).includes(NEW_PROGRESS), false);
  check('D: it is at the top of the page, above the screen', await b2.evaluate(() => {
    const alert = document.getElementById('storeAlert').getBoundingClientRect();
    const screen = document.getElementById('section-progress').getBoundingClientRect();
    return alert.bottom <= screen.top;
  }), true);
  check('D: its button offers to try again', await text(b2, 'storeAlertGo'), 'Try again');
  await flag(b2, 'database', null);
  await restarted(b2, () => b2.click('#storeAlertGo'));
  check('D: and trying again, once the data will open, brings it back', await b2.evaluate(() => `${Store.mode} ${App.reviews.games.length}`), 'large 1');
  check('D: with no warning left', await shown(b2, 'storeAlert'), false);

  await flag(b2, 'gets', 'reviews');
  await reload(b2);
  check('D: one part that would not read stops the copy too', await b2.evaluate(() => `${Store.mode} ${Store.failure}`), 'none unread');
  check('D: and is said above the screen',
    (await text(b2, 'storeAlertText')).startsWith('PART OF YOUR SAVED DATA COULD NOT BE READ THIS TIME, SO NOTHING IS BEING SAVED. What is missing from the screen is not lost'), true);
  check('D: which is not called a new copy either', await shown(b2, 'newCopy'), false);
  await flag(b2, 'gets', null);
  await restarted(b2, () => b2.click('#storeAlertGo'));
  check('D: trying again brings that back as well', await b2.evaluate(() => `${Store.mode} ${App.reviews.games.length}`), 'large 1');

  // ── E. a save that starts failing is said on the screen that is open ───────
  await gotoSection(b2, 'settings');
  check('E: while saves work, nothing is said', await shown(b2, 'storeAlert'), false);
  await flag(b2, 'puts', 'refuse');
  await b2.evaluate(() => savePrefs());
  check('E: a save that fails is said at once, without leaving the screen', await shown(b2, 'storeAlert'), true);
  check('E: on the screen that was open', await b2.evaluate(() => App.section), 'settings');
  const failing = await text(b2, 'storeAlertText');
  check('E: in the words Today uses', failing, await b2.evaluate(() => Store.where()));
  check('E: which say nothing is being saved', failing.startsWith('NOTHING IS BEING SAVED: the device refused the last save because it has no room left.'), true);
  check('E: its button goes to where a backup is saved', await text(b2, 'storeAlertGo'), 'Go to “Your data”');
  await b2.click('#storeAlertGo');
  check('E: which is Today', await b2.evaluate(() => App.section), 'today');
  // Today opens at its top, and “Your data” is at its foot: the page has to
  // have been moved down to it, not merely be tall enough to show it.
  check('E: moved down to “Your data”', await b2.evaluate(() => {
    const box = document.getElementById('dataPanel').getBoundingClientRect();
    return window.scrollY > 0 && box.top >= 0 && box.top < window.innerHeight / 2;
  }), true);
  await flag(b2, 'puts', null);
  await b2.evaluate(() => savePrefs());
  check('E: when the saves catch up the warning goes', await shown(b2, 'storeAlert'), false);

  // And where the account's store is taking the saves, nothing is at risk,
  // and a warning above every screen would be a false alarm.
  const ACCOUNT = () => {
    window.claude = { use: async (name) => (name !== 'db' ? null : ({
      doc: () => ({ get: async () => ({ exists: false, data: () => null }), set: async () => {} }),
    })) };
  };
  const e2 = await open({ init: [SABOTAGE, ACCOUNT] });
  await flag(e2, 'puts', 'refuse');
  await e2.evaluate(() => savePrefs());
  check('E: with the account\'s store taking the saves, a save this device refuses is known of',
    await e2.evaluate(() => `${Boolean(Store.db)} ${Store.localFailed}`), 'true true');
  check('E: and is not put above every screen, because nothing is at risk', await shown(e2, 'storeAlert'), false);
  await gotoSection(e2, 'settings');
  await gotoSection(e2, 'today');
  check('E: Today says where the progress is going instead', (await text(e2, 'storeNote')).startsWith('This device is refusing to store anything'), true);
  await e2.context().close();

  // ── F. a database the browser has cleared is said to be that ───────────────
  await b2.evaluate(() => new Promise((resolve) => {
    Store.local.close();
    const request = indexedDB.deleteDatabase('hardlines');
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  }));
  await reload(b2);
  check('F: a cleared database is known to have been cleared', await b2.evaluate(() => `${Store.mode} ${Store.lost} ${App.reviews.games.length}`), 'large true 0');
  check('F: and that is said above the screen', await shown(b2, 'storeAlert'), true);
  check('F: for what it is', await text(b2, 'storeAlertText'),
    'This browser has cleared what the app had saved here. “Your data” on Today says what can be done about it.');
  check('F: with the way to it', await text(b2, 'storeAlertGo'), 'Go to “Your data”');
  check('F: it is not passed off as a new copy', await shown(b2, 'newCopy'), false);
  check('F: nor on the Progress page', (await progressNotes(b2)).includes(NEW_PROGRESS), false);
  await b2.click('#storeAlertGo');
  check('F: the button goes to Today', await b2.evaluate(() => App.section), 'today');
  await b2.click('#backupKeep');
  await b2.waitForFunction(() => document.getElementById('storeAlert').hidden);
  check('F: told to carry on without it, the warning goes', await shown(b2, 'storeAlert'), false);
  await gotoSection(b2, 'progress');
  await gotoSection(b2, 'today');
  check('F: and the copy is then what it is: an empty one', await shown(b2, 'newCopy'), true);
  await b2.context().close();

  // ── C. the Android app says when it was put on the phone ───────────────────
  const today = new Date(2026, 10, 14, 18, 55).getTime();
  const september = new Date(2026, 8, 6, 9, 30).getTime();
  const c = await open({ userAgent: ANDROID_UA, init: [SABOTAGE, [PRETEND_APP, { file: backup, arrived: { first: today, updated: today } }]] });
  check('C: a new Android app says so at the top of Today', await shown(c, 'newCopy'), true);
  check('C: under a heading that says what it is', await text(c, 'newCopyTitle'), 'Nothing is stored in this app yet');
  const appNote = await text(c, 'newCopyNote');
  check('C: it says when the app was put on the phone', appNote.startsWith('This app was put on this phone on 14 November 2026. '), true);
  check('C: that the web version keeps its own data, and still has it',
    appNote.includes('It keeps its own data, apart from the web version and from any other phone. If your games are in the web version, they are still there: nothing has been lost, they are just not in this app.'), true);
  check('C: and how they are brought across',
    appNote.endsWith('A backup file brings them across. In the web version, go to Today, find “Your data” and press “Save a backup file”. Then press the button below and choose that file.'), true);
  check('C: the Progress page names the web version', (await progressNotes(c)).includes('If your games are in another copy of it — the web version, another phone — they are still there'), true);
  await gotoSection(c, 'today');
  check('C: “Your copy” says which version this is and when it arrived', await text(c, 'installNote'),
    'Running as the Android app, version 1.6.1. It was put on this phone on 14 November 2026.');
  await c.click('#newCopyRestore');
  await c.waitForFunction(() => !document.getElementById('backupConfirm').hidden);
  check('C: the button asks the app for a file', await c.evaluate(() => window.__app.opened), 1);
  check('C: and the app asks before it does anything',
    /^This backup was saved on .* in the web version\. It holds 1 imported or reviewed game \(1 analysed\), .*This app now holds nothing yet\./.test(await text(c, 'backupConfirmText')), true);
  await restarted(c, () => c.click('#backupReplace'));
  check('C: restored, the app holds what the web version did',
    await c.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(Store.snapshot()).map(([k, v]) => [k, v.payload])))), held);
  check('C: and no longer says it is empty', await shown(c, 'newCopy'), false);
  await c.context().close();

  const c2 = await open({ userAgent: ANDROID_UA, init: [SABOTAGE, [PRETEND_APP, { file: backup, arrived: { first: september, updated: today } }]] });
  check('C: an app that has been on the phone for a while says when it arrived, not when it was updated',
    (await text(c2, 'newCopyNote')).startsWith('This app was put on this phone on 6 September 2026. '), true);
  check('C: and “Your copy” says both', await text(c2, 'installNote'),
    'Running as the Android app, version 1.6.1. It was put on this phone on 6 September 2026 and last updated on 14 November 2026.');
  await c2.context().close();

  for (const [what, arrived] of [['will not say', ''], ['says something that is not an answer', '{"first":"soon"}'], ['says it arrived at no time', '{"first":0,"updated":0}'], ['has no such answer to give', null]]) {
    const c3 = await open({ userAgent: ANDROID_UA, init: [SABOTAGE, [PRETEND_APP, { file: backup, arrived }]] });
    check(`C: an app that ${what}: no date is given, and nothing else is lost`,
      (await text(c3, 'newCopyNote')).startsWith('It keeps its own data, apart from the web version and from any other phone.'), true);
    check(`C: an app that ${what}: “Your copy” still says what it is`, await text(c3, 'installNote'), 'Running as the Android app, version 1.6.1.');
    await c3.context().close();
  }

  // And the web version, once it is installed, says that it is the web
  // version: "an installed app" is what the Android app is too.
  // (A browser says it is running an installed page in one of two ways; this
  // is the one a test can give it.)
  const w = await open({ init: [SABOTAGE, () => { Object.defineProperty(navigator, 'standalone', { get: () => true }); }] });
  check('C: the web version, installed as an app, says which of the two it is', await text(w, 'installNote'), 'Running as the web version, installed as an app.');
  await w.context().close();

  await browser.close();
  srv.stop();
  fs.rmSync(tmp, { recursive: true, force: true });

  check('no page errors anywhere', errors.join(' | '), '');
  console.log(failures.length ? `\nFAILED: ${failures.length}\n  ${failures.join('\n  ')}` : '\nall checks passed');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
