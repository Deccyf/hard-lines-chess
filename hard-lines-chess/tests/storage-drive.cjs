// Where your progress is kept, and the file that brings it back — driven.
//
// The app's data used to live in localStorage, which refused the next save at
// about 800 analysed games and went on looking fine. It lives in the browser's
// large database now, and there is a backup file. This driver is about the two
// ways that could go wrong: losing something on the way across, and a backup
// that does not bring back what it was made from.
//
// What has to be true:
//
//   A. A HISTORY IN THE SMALL STORE MOVES ACROSS WHOLE — every shape an older
//      version left there — and is gone from the small store only afterwards.
//
//   B. THE OLD LIMIT IS GONE. Far more games than the small store ever held
//      save, and are there after a reload. In a browser with no large
//      database the old limit is still there, and the page says so truthfully.
//
//   C. THE MOVE NEVER LOSES THE SMALL COPY. If the large database refuses the
//      write, or hands back something other than what was written, the small
//      copy stays exactly as it was and the session runs on it.
//
//   D. ONCE THE LARGE DATABASE HAS BEEN USED, THE SMALL STORE IS NEVER FALLEN
//      BACK ON. A database that will not open one day must not lead to a
//      near-empty session being saved over the real history — and nor must
//      one area of it that will not read.
//
//   E. A FAILED SAVE IS SAID, AND HEALS: the next save that works writes what
//      is owed, and the warning goes.
//
//   F. A BACKUP BRINGS BACK WHAT IT WAS MADE FROM, exactly; restoring asks
//      first and says what each side holds; it can be undone; and a file that
//      is not a backup changes nothing.
//
//   G. THE ANDROID APP SAVES AND OPENS THE FILE ITSELF, through its own
//      bridge, a piece at a time, without cutting a character in two. The app
//      here is a pretend one that behaves as MainActivity does; MainActivity's
//      own half is tested by tests/android-bridge.test.mjs.
//
//   H. A PHONE THAT CLEARS THE DATABASE DOES NOT TAKE THE HISTORY WITH IT. The
//      Android app keeps a copy of everything in its own files, made when the
//      app is left; a load that finds the database new, or behind, takes what
//      the copy holds — the newer of the two, area by area — and says so. A
//      copy that cannot be read is never written over, and a session with no
//      data open never makes one. In a browser, with no app to keep a copy,
//      the page says the data was cleared and what brings it back.
const { launch, serve, DIST, gotoSection } = require('./browser.cjs');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 8315;
const base = `http://127.0.0.1:${PORT}/`;
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 HardLinesAndroid/1.6.0';
const played = fs.readFileSync(path.join(__dirname, '..', 'tools', 'rating-games.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));
const MOVES = [[300, 0], [600, 1], [900, 1]].map(([elo, g]) => played.find((r) => r.elo === elo && r.game === g).pgn);

// Ways for a test to make the large database misbehave, switched by a flag in
// localStorage so that they survive a reload and can be turned off again.
const SABOTAGE = () => {
  const flag = (name) => { try { return localStorage.getItem(`test:${name}`); } catch { return null; } };
  const realPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function put(value, key) {
    if (flag('puts') === 'refuse') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    if (flag('puts') === 'garble' && typeof value === 'string') return realPut.call(this, `${value} `, key);
    return realPut.call(this, value, key);
  };
  // One area that will not read: every time, or the next `getsleft` times.
  const realGet = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function get(key) {
    if (flag('gets') === key) {
      const left = flag('getsleft');
      if (left === null) throw new DOMException('The record could not be read.', 'UnknownError');
      if (Number(left) > 0) {
        localStorage.setItem('test:getsleft', String(Number(left) - 1));
        throw new DOMException('The record could not be read.', 'UnknownError');
      }
    }
    return realGet.call(this, key);
  };
  const realOpen = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function open(...args) {
    if (flag('database') === 'shut') throw new DOMException('The database could not be opened.', 'UnknownError');
    return realOpen.apply(this, args);
  };
};

(async () => {
  const srv = serve(path.join(DIST, 'pwa'), PORT);
  await srv.ready;
  const browser = await launch();
  const say = (k, v) => console.log(String(k).padEnd(62), v);
  const failures = [];
  const check = (what, got, want) => {
    const ok = got === want;
    say(what, ok ? String(got).slice(0, 110) : `${String(got).slice(0, 400)}   <- expected ${String(want).slice(0, 400)}`);
    if (!ok) failures.push(what);
  };
  const errors = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-storage-'));

  // `init` is a list of functions to run in the page before its own scripts,
  // each either bare or as [function, argument].
  const open = async ({ init = [], userAgent } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 }, acceptDownloads: true, ...(userAgent ? { userAgent } : {}) });
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
  // Do something that makes the page start again, and wait until it has.
  const restarted = async (page, action) => {
    await Promise.all([page.waitForEvent('load'), action()]);
    await page.waitForSelector('#tab-today', { timeout: 20000 });
    await page.waitForFunction(() => typeof Backup !== 'undefined' && Backup.ready);
  };
  const reload = (page) => restarted(page, () => page.reload());
  const flag = (page, name, value) => page.evaluate(([n, v]) => {
    if (v === null) localStorage.removeItem(`test:${n}`); else localStorage.setItem(`test:${n}`, v);
  }, [name, value]);
  // The small store's own keys (not the test's flags), and the large database's.
  const smallKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hardlines:')).sort().join(' '));
  const largeKeys = (page) => page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open('hardlines', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => {
      const all = request.result.transaction('state').objectStore('state').getAllKeys();
      all.onsuccess = () => { request.result.close(); resolve(all.result.sort().join(' ')); };
    };
    request.onerror = () => resolve('(would not open)');
  }));
  // What the large database holds under one name, as stored. (getAll, because
  // the sabotage above is of get.)
  const largeRaw = (page, name) => page.evaluate((n) => new Promise((resolve) => {
    const request = indexedDB.open('hardlines', 1);
    request.onsuccess = () => {
      const all = request.result.transaction('state').objectStore('state').getAll(IDBKeyRange.only(n));
      all.onsuccess = () => { request.result.close(); resolve(all.result[0] ?? null); };
    };
    request.onerror = () => resolve('(would not open)');
  }), name);
  const areas = (page) => page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(Store.snapshot()).map(([k, v]) => [k, v.payload]))));
  const note = (page) => page.$eval('#backupNote', (e) => e.textContent);

  // ── A. a history in the small store moves across whole ────────────────────
  const SEED = () => {
    if (localStorage.getItem('test:seeded')) return;
    localStorage.setItem('test:seeded', '1');
    // As three different versions left them: bare, bare with a card missing,
    // and wrapped.
    localStorage.setItem('hardlines:history', JSON.stringify({ bands: { 800: { w: 2, d: 0, l: 1 } },
      games: [{ at: 1, band: 800, colour: 'white', result: 'w', plies: 2, control: 'none', pgn: '1. e4 e5' }] }));
    localStorage.setItem('hardlines:drills', JSON.stringify({ items: [{ id: 'old-1', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 2 3',
      side: 'white', played: 'Qh5', playedUci: 'd1h5', best: { san: 'Nf3', uci: 'g1f3' }, severity: 'blunder', label: 'x', loss: 300 }] }));
    localStorage.setItem('hardlines:reviews', JSON.stringify({ updated: 5000, version: 2, payload: { games: [
      { at: 10, white: 'me', black: 'Łukasz ♞', result: '1-0', side: 'white', plies: 4, reviewed: true, accuracy: 91, meanLoss: 22.5, mistakes: [],
        pgn: '1. e4 e5 2. Nf3 Nc6', curve: [20, 25, 18, 30, 22], marks: '*.*.', nodes: 25000, depth: 7 },
      { at: 11, white: 'me', black: 'rook🏰fan', result: '0-1', side: 'white', plies: 2, reviewed: false, accuracy: null, mistakes: [], pgn: '1. d4 d5' },
    ] } }));
    localStorage.setItem('hardlines:prefs', JSON.stringify({ updated: 6000, version: 2, payload: { theme: 'dark', judge: 'stockfish' } }));
  };
  const a = await open({ init: [SABOTAGE, SEED] });
  const moved = await a.evaluate(async () => ({
    mode: Store.mode, failed: Store.localFailed,
    played: App.history.games.length, record: JSON.stringify(App.history.bands),
    drills: App.drills.items.length, card: [App.drills.items[0]?.card?.interval, App.drills.items[0]?.card?.ease].every(Number.isFinite),
    games: App.reviews.games.map((g) => g.black).join(' | '), curve: JSON.stringify(App.reviews.games[0].curve),
    theme: App.prefs.theme, judge: App.prefs.judge,
    stored: typeof (await new Promise((resolve) => {
      const tx = Store.local.transaction('state').objectStore('state').get('reviews');
      tx.onsuccess = () => resolve(tx.result);
    })),
    versions: (await Promise.all(['history', 'drills', 'reviews', 'prefs'].map((n) => Store.localDoc(n)))).map((d) => d?.version).join(' '),
    where: Store.where(),
  }));
  check('A: it opened on the large database', moved.mode, 'large');
  check('A: the games played here came across', `${moved.played} ${moved.record}`, '1 {"800":{"w":2,"d":0,"l":1}}');
  check('A: the drill came across, and was given the card it lacked', `${moved.drills} ${moved.card}`, '1 true');
  check('A: the reviewed games came across, names and all', moved.games, 'Łukasz ♞ | rook🏰fan');
  check('A: with their curves', moved.curve, '[20,25,18,30,22]');
  check('A: and the settings', `${moved.theme} ${moved.judge}`, 'dark stockfish');
  check('A: each is stored as the text it always was, in the current version', `${moved.stored} ${moved.versions}`, 'string 2 2 2 2');
  check('A: nothing is left in the small store but the note that it has moved', await smallKeys(a), 'hardlines:__large');
  check('A: no save is said to have failed', moved.failed, false);
  check('A: and the page says where it is kept', /^Saved in this browser, on this device only\./.test(moved.where), true);
  const before = await areas(a);
  await reload(a);
  check('A: after a reload it is all still there', await areas(a), before);

  // ── B. the old limit is gone ───────────────────────────────────────────────
  const big = await a.evaluate(async () => {
    const one = (i) => ({ at: 1000 + i, white: 'you', black: `opponent_${i}`, result: '1-0', side: 'white', plies: 77, reviewed: true, accuracy: 80, meanLoss: 40,
      pgn: `[Event "Live Chess"]\n[Site "Chess.com"]\n[White "you"]\n[Black "opponent_${i}"]\n\n${'1. e4 {[%clk 0:09:58]} e5 {[%clk 0:09:57]} '.repeat(38)}`,
      curve: Array.from({ length: 78 }, (_, k) => (k * 37) % 400), marks: '.'.repeat(77), counted: 39, nodes: 25000, depth: 7, judge: 'stockfish',
      mistakes: Array.from({ length: 7 }, (_, k) => ({ ply: k * 9 + 1, moveNumber: k * 5, san: 'Nf3', uci: 'g1f3', side: 'white', severity: 'mistake', loss: 150,
        fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', reason: 'You left the knight on c3 defended too lightly.',
        best: { uci: 'b1c3', san: 'Nc3', line: ['b1c3', 'g8f6', 'f1c4', 'f8c5', 'd2d3', 'd7d6', 'c1g5', 'h7h6'] } })) });
    App.reviews.games = Array.from({ length: 1500 }, (_, i) => one(i));
    const t0 = performance.now();
    await Store.set('reviews', App.reviews);
    return { ms: Math.round(performance.now() - t0), chars: JSON.stringify(App.reviews).length, failed: Store.localFailed };
  });
  say('B: 1,500 analysed games', `${(big.chars / 1e6).toFixed(1)} million characters, saved in ${big.ms} ms`);
  check('B: which is more than the small store ever held', big.chars > 5200000, true);
  check('B: and the save did not fail', big.failed, false);
  await reload(a);
  check('B: after a reload all 1,500 are there', await a.evaluate(() => `${App.reviews.games.length} ${App.reviews.games[0].black} ${App.reviews.games[1499].black}`), '1500 opponent_0 opponent_1499');
  await a.close();

  // The same thing in a browser with no large database: the old limit, said truthfully.
  const legacy = await open({ init: [SABOTAGE, () => localStorage.setItem('test:database', 'shut')] });
  check('B: a browser with no large database uses the small store, as before', await legacy.evaluate(() => Store.mode), 'legacy');
  check('B: and says so, with the limit', await legacy.evaluate(() => /small store/.test(Store.where()) && /Keep a backup file/.test(Store.where())), true);
  await legacy.evaluate(async () => { App.prefs.theme = 'dark'; await Store.set('prefs', App.prefs); });
  await reload(legacy);
  check('B: what it saves there survives a reload', await legacy.evaluate(() => App.prefs.theme), 'dark');
  const full = await legacy.evaluate(async () => {
    App.reviews.games = Array.from({ length: 1500 }, (_, i) => ({ at: i, side: 'white', pgn: 'x'.repeat(4000) }));
    await Store.set('reviews', App.reviews);
    return { failed: Store.localFailed, why: Store.failure, where: Store.where() };
  });
  check('B: there, too many games still do not fit, and it is said', `${full.failed} ${full.why}`, 'true full');
  check('B: as the store being full, not as a private window', /small store is full/.test(full.where) && !/private window/.test(full.where), true);
  await legacy.close();

  // ── C. the move never loses the small copy ─────────────────────────────────
  for (const how of ['refuse', 'garble']) {
    // Armed once, before the first load, and disarmed by the test afterwards.
    const arm = (h) => { if (!localStorage.getItem('test:armed')) { localStorage.setItem('test:armed', '1'); localStorage.setItem('test:puts', h); } };
    const c = await open({ init: [SABOTAGE, SEED, [arm, how]] });
    const kept = await c.evaluate(() => ({
      games: App.reviews.games.length, drills: App.drills.items.length, failed: Store.localFailed,
      small: ['history', 'reviews', 'prefs'].every((n) => typeof localStorage.getItem(`hardlines:${n}`) === 'string'),
    }));
    check(`C[${how}]: the session still has everything`, `${kept.games} ${kept.drills}`, '2 1');
    check(`C[${how}]: the small copies are exactly where they were`, kept.small, true);
    check(`C[${how}]: and the reviewed games there are untouched, to the character`,
      await c.evaluate(() => JSON.parse(localStorage.getItem('hardlines:reviews')).payload.games[1].black), 'rook🏰fan');
    await flag(c, 'puts', null);
    await reload(c);
    check(`C[${how}]: next time, with the database behaving, it moves`, await smallKeys(c), 'hardlines:__large');
    check(`C[${how}]: with everything in it`, await c.evaluate(() => `${App.reviews.games.length} ${App.drills.items.length} ${App.history.games.length} ${App.prefs.theme}`), '2 1 1 dark');
    await c.close();
  }

  // ── D. never fallen back on, once the large database has been used ─────────
  const d = await open({ init: [SABOTAGE, SEED] });
  const real = await areas(d);
  await flag(d, 'database', 'shut');
  await reload(d);
  const shut = await d.evaluate(async () => {
    App.prefs.theme = 'light';
    await Store.set('prefs', App.prefs);
    App.reviews.games.push({ at: 99, side: 'white', pgn: '1. c4' });
    await Store.set('reviews', App.reviews);
    return { mode: Store.mode, failed: Store.localFailed, why: Store.failure, games: App.reviews.games.length, where: Store.where(),
      save: document.getElementById('backupSave').disabled, open: document.getElementById('backupOpen').disabled, note: document.getElementById('backupNote').textContent };
  });
  check('D: a database that will not open is not replaced by the small store', shut.mode, 'none');
  check('D: the page says the data could not be opened, and is not being saved', /COULD NOT BE OPENED THIS TIME/.test(shut.where) && /not a lost one/.test(shut.where), true);
  check('D: what was done meanwhile was written nowhere', await smallKeys(d), 'hardlines:__large');
  check('D: and no backup can be made of an empty session, or restored into it', `${shut.save} ${shut.open}`, 'true true');
  check('D: with the reason', /until the app has been closed and opened again/.test(shut.note), true);
  await flag(d, 'database', null);
  await reload(d);
  check('D: next time the real history is there, untouched', await areas(d), real);

  // One area that will not read is not opened as an empty one either.
  const reviewsAsStored = await largeRaw(d, 'reviews');
  await flag(d, 'gets', 'reviews');
  await reload(d);
  const unread = await d.evaluate(async () => {
    App.reviews.games.push({ at: 99, side: 'white', pgn: '1. c4' });
    await Store.set('reviews', App.reviews);
    App.prefs.theme = 'light';
    await Store.set('prefs', App.prefs);
    renderToday();
    return { mode: Store.mode, why: Store.failure, where: document.getElementById('storeNote').textContent,
      save: document.getElementById('backupSave').disabled, open: document.getElementById('backupOpen').disabled };
  });
  check('D: one area that will not read stops the session as well', `${unread.mode} ${unread.why}`, 'none unread');
  check('D: the page says part of the data could not be read, and is not lost', /PART OF YOUR SAVED DATA COULD NOT BE READ THIS TIME, SO NOTHING IS BEING SAVED/.test(unread.where) && /is not lost/.test(unread.where), true);
  check('D: what was done meanwhile did not go over the area that would not read', await largeRaw(d, 'reviews'), reviewsAsStored);
  check('D: and no backup can be made of a half-open app, or restored into it', `${unread.save} ${unread.open}`, 'true true');
  await flag(d, 'gets', null);
  await reload(d);
  check('D: next time everything is there, untouched', await areas(d), real);
  // A read that fails once and works the next time is simply asked again.
  await flag(d, 'gets', 'reviews');
  await flag(d, 'getsleft', '1');
  await reload(d);
  check('D: a read that fails once is asked again, and nothing is stopped', await d.evaluate(() => `${Store.mode} ${Store.localFailed}`), 'large false');
  check('D: with everything there', await areas(d), real);
  await flag(d, 'gets', null);
  await flag(d, 'getsleft', null);
  await d.close();

  // ── E. a failed save is said, and heals ────────────────────────────────────
  const e = await open({ init: [SABOTAGE, SEED] });
  await flag(e, 'puts', 'refuse');
  const failed = await e.evaluate(async () => {
    App.drills.items.push({ id: 'new', fen: 'x', side: 'white', played: 'a3', playedUci: 'a2a3', best: { san: 'e4', uci: 'e2e4' }, card: SRS.fresh() });
    await Store.set('drills', App.drills);
    renderToday();
    return { failed: Store.localFailed, why: Store.failure, owed: [...Store.unsaved].join(' '), where: document.getElementById('storeNote').textContent,
      backup: JSON.parse(buildBackup().text).areas.drills.payload.items.length };
  });
  check('E: a save the device refuses is noticed', `${failed.failed} ${failed.why} ${failed.owed}`, 'true full drills');
  check('E: and said on the Today screen, as the device being full', /NOTHING IS BEING SAVED: the device refused the last save because it has no room left/.test(failed.where), true);
  check('E: a backup can still be made, and has what was not saved', failed.backup, 2);
  await flag(e, 'puts', null);
  const healed = await e.evaluate(async () => {
    await Store.set('prefs', App.prefs);          // any save that works
    renderToday();
    return { failed: Store.localFailed, owed: Store.unsaved.size, where: document.getElementById('storeNote').textContent };
  });
  check('E: the next save that works writes what was owed', `${healed.failed} ${healed.owed}`, 'false 0');
  check('E: and the warning goes', /^Saved in this browser/.test(healed.where), true);
  await reload(e);
  check('E: after a reload the drill that was owed is there', await e.evaluate(() => App.drills.items.length), 2);
  await e.close();

  // ── F. a backup brings back what it was made from ──────────────────────────
  const f = await open({ init: [SABOTAGE] });
  await gotoSection(f, 'review');
  await f.evaluate(async (moves) => {
    App.reviews.games = moves.map((text, i) => ({ at: Date.UTC(2026, 8, 1) + i * 86400000, white: 'you', black: i === 1 ? 'rook🏰fan' : 'them', result: '*', side: 'white',
      plies: parsePgn(text).plies.length, reviewed: false, accuracy: null, mistakes: [], pgn: text, source: 'chess.com', url: `s-${i}`, myRating: 900 + i }));
    App.prefs.judge = 'app';
    document.getElementById('walkDepth').value = '7';
    await walkImported();
    App.history.games.push({ at: 5, band: 800, colour: 'white', result: 'w', plies: 2, control: 'none', pgn: '1. e4 e5' });
    App.history.bands[800] = { w: 1, d: 0, l: 0 };
    await Store.set('history', App.history);
    App.prefs.theme = 'dark';
    await Store.set('prefs', App.prefs);
  }, MOVES);
  const original = await areas(f);
  const originalCounts = await f.evaluate(() => JSON.stringify(backupCounts(Store.snapshot())));
  say('F: a real history', originalCounts);
  await gotoSection(f, 'today');
  check('F: before any backup, it says none has been saved', await note(f), 'No backup file has been saved from here yet.');
  const [download] = await Promise.all([f.waitForEvent('download'), f.click('#backupSave')]);
  const file = path.join(tmp, download.suggestedFilename());
  await download.saveAs(file);
  check('F: the file is named for the day it was made', /^hard-lines-chess-backup-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()), true);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  check('F: it says what it is', `${saved.app} ${saved.kind} ${saved.format} ${saved.from}`, 'hard-lines-chess backup 1 the web version');
  check('F: and holds every area the app keeps', Object.keys(saved.areas).sort().join(' '), 'drills endgames history openings prefs puzzles reviews storm teaching vision');
  check('F: the page says what was saved', /^Asked your browser to save hard-lines-chess-backup-.*\.json: 3 imported or reviewed games \(3 analysed\), \d+ drills?, 0 puzzles and 1 game played here\./.test(await note(f)), true);
  await reload(f);
  await gotoSection(f, 'today');
  check('F: afterwards it says when the last backup was', /^Last backup file saved on \d+ \w+ \d{4}\.$/.test(await note(f)), true);
  await f.close();

  // Into another browser that has a little data of its own.
  const g = await open({ init: [SABOTAGE] });
  await g.evaluate(async () => {
    App.drills.items.push({ id: 'mine', fen: 'here', side: 'white', played: 'a3', playedUci: 'a2a3', best: { san: 'e4', uci: 'e2e4' }, card: SRS.fresh() });
    await Store.set('drills', App.drills);
  });
  const own = await areas(g);
  const choose = async (page, pathOrPayload) => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#backupOpen')]);
    await chooser.setFiles(pathOrPayload);
  };

  // Files that are not backups change nothing.
  const bad = {
    'not a backup at all': 'this is a text file',
    'some other program\'s file': JSON.stringify({ app: 'something-else', areas: {} }),
    'a backup from a newer version': JSON.stringify({ ...saved, format: 99 }),
    'a damaged backup': JSON.stringify({ ...saved, areas: { ...saved.areas, reviews: { payload: { games: 'not a list' }, updated: 1, version: 2 } } }),
    'a backup with nothing in it': JSON.stringify({ ...saved, areas: {} }),
  };
  for (const [what, text] of Object.entries(bad)) {
    const p = path.join(tmp, `bad-${Object.keys(bad).indexOf(what)}.json`);
    fs.writeFileSync(p, text);
    await g.evaluate(() => { document.getElementById('backupNote').textContent = ''; });
    await choose(g, p);
    await g.waitForFunction(() => document.getElementById('backupNote').textContent !== '');
    check(`F: ${what} is said to have changed nothing`, /[Nn]othing was changed\.$/.test(await note(g)), true);
    say(`F: ${what}`, (await note(g)).slice(0, 100));
    check(`F: ${what} is refused without a question`, await g.$eval('#backupConfirm', (el) => el.hidden), true);
    check(`F: ${what} changes nothing`, await areas(g), own);
  }

  // The real one: asked first, with both sides counted.
  await choose(g, file);
  await g.waitForFunction(() => !document.getElementById('backupConfirm').hidden);
  const question = await g.$eval('#backupConfirmText', (el) => el.textContent);
  say('F: the question', question.slice(0, 200));
  check('F: it says what the file holds', /It holds 3 imported or reviewed games \(3 analysed\), \d+ drills?, 0 puzzles and 1 game played here\./.test(question), true);
  check('F: and what is here now', /This app now holds 0 imported or reviewed games, 1 drill, 0 puzzles and 0 games played here\./.test(question), true);
  check('F: and that it replaces rather than combines, and can be undone', /the two are not combined/.test(question) && /can be undone/.test(question), true);
  await g.click('#backupCancel');
  check('F: saying no changes nothing', await areas(g), own);
  check('F: and says so', await note(g), 'Nothing was restored.');

  await choose(g, file);
  await g.waitForFunction(() => !document.getElementById('backupConfirm').hidden);
  await restarted(g, () => g.click('#backupReplace'));
  check('F: saying yes brings back exactly what the backup was made from', await areas(g), original);
  check('F: names with their characters whole', await g.evaluate(() => App.reviews.games[1].black), 'rook🏰fan');
  await gotoSection(g, 'today');
  await g.waitForFunction(() => !document.getElementById('backupRestored').hidden);
  check('F: and the page says what happened', /^Restored from the backup saved on \d+ \w+ \d{4} in the web version\. What was here before is still being kept/.test(await g.$eval('#backupRestoredText', (el) => el.textContent)), true);
  await reload(g);
  check('F: it is there after a reload too', await areas(g), original);
  // Undo — which is asked about too, because by then the app may have been used.
  await gotoSection(g, 'today');
  await g.waitForFunction(() => !document.getElementById('backupUndo').hidden);
  await g.click('#backupUndo');
  await g.waitForFunction(() => !document.getElementById('backupConfirm').hidden);
  const undoQuestion = await g.$eval('#backupConfirmText', (el) => el.textContent);
  say('F: the undo question', undoQuestion.slice(0, 200));
  check('F: undoing asks first, saying what comes back and what is lost',
    /^This puts back what was here before the restore: 0 imported or reviewed games, 1 drill, 0 puzzles and 0 games played here\./.test(undoQuestion)
    && /which is 3 imported or reviewed games \(3 analysed\)/.test(undoQuestion) && /anything done since the restore is lost/.test(undoQuestion), true);
  check('F: on a button that says what it does', await g.$eval('#backupReplace', (el) => el.textContent), 'Put it back');
  await g.click('#backupCancel');
  check('F: saying no to the undo changes nothing', await areas(g), original);
  check('F: and says so', await note(g), 'Nothing was changed.');
  await g.click('#backupUndo');
  await g.waitForFunction(() => !document.getElementById('backupConfirm').hidden);
  await restarted(g, () => g.click('#backupReplace'));
  check('F: saying yes puts back exactly what was here before', await areas(g), own);
  await gotoSection(g, 'today');
  check('F: and stops offering to', await g.$eval('#backupRestored', (el) => el.hidden), true);

  // A file that does not hold an area empties it: restoring replaces everything.
  const partial = path.join(tmp, 'partial.json');
  fs.writeFileSync(partial, JSON.stringify({ ...saved, areas: Object.fromEntries(Object.entries(saved.areas).filter(([name]) => name !== 'drills' && name !== 'history')) }));
  await choose(g, partial);
  await g.waitForFunction(() => !document.getElementById('backupConfirm').hidden);
  await restarted(g, () => g.click('#backupReplace'));
  const emptied = () => g.evaluate(() => `${App.reviews.games.length} ${App.drills.items.length} ${App.history.games.length}`);
  check('F: an area the file does not hold is emptied, not left beside the restored history', await emptied(), '3 0 0');
  await reload(g);
  check('F: and is still empty after a reload', await emptied(), '3 0 0');
  await gotoSection(g, 'today');
  await g.waitForFunction(() => !document.getElementById('backupUndo').hidden);
  await g.click('#backupUndo');
  await g.waitForFunction(() => !document.getElementById('backupConfirm').hidden);
  await restarted(g, () => g.click('#backupReplace'));
  check('F: undoing that puts back what was emptied', await areas(g), own);
  await gotoSection(g, 'today');
  // Restore again, and keep it.
  await choose(g, file);
  await g.waitForFunction(() => !document.getElementById('backupConfirm').hidden);
  check('F: a restore after an undo is labelled as a restore again', await g.$eval('#backupReplace', (el) => el.textContent), 'Replace with the backup');
  await restarted(g, () => g.click('#backupReplace'));
  await gotoSection(g, 'today');
  await g.waitForFunction(() => !document.getElementById('backupRestored').hidden);
  await g.click('#backupKeep');
  await g.waitForFunction(() => document.getElementById('backupRestored').hidden);
  check('F: keeping it stops keeping what it replaced', await g.evaluate(async () => (await Store.undoCopy()) === null), true);
  check('F: the large database then holds the areas and nothing else', await largeKeys(g), 'drills endgames history openings prefs puzzles reviews storm teaching vision');
  check('F: and the restored history is still what the backup held', await areas(g), original);
  await g.close();

  // ── G. the Android app ──────────────────────────────────────────────────────
  //
  // A pretend app, behaving as MainActivity's FileBridge does: text taken and
  // given 200,000 characters at a time, never ending a piece on half a pair,
  // and its answers arriving later, as a chooser's do.
  const PRETEND_APP = () => {
    const app = { name: null, pieces: [], savedAs: null, saved: null, restore: null, opened: 0, next: { save: 'ok', open: null }, keep: null };
    window.__app = app;
    const later = (fn) => setTimeout(fn, 30);
    // A text handed out as the app hands one out: opened, then a piece at a
    // time until there is no more, then closed — which says whether all of it
    // went across. `fault` makes it go wrong the way a file can.
    const given = (text, fault) => ({ text, at: 0, fault });
    const open = (slot) => (slot && slot.text !== null ? (slot.fault === 'shut' ? -1 : 1) : 0);
    const next = (slot) => {
      if (!slot || slot.text === null || slot.at >= slot.text.length) return '';
      // Cut: half of it comes across, and then no more does.
      if (slot.fault === 'cut' && slot.at > 0) { slot.broke = true; return ''; }
      const most = slot.fault === 'cut' ? Math.max(1, Math.floor(slot.text.length / 2)) : 200000;
      let end = Math.min(slot.text.length, slot.at + most);
      const last = slot.text.charCodeAt(end - 1);
      if (end < slot.text.length && last >= 0xD800 && last <= 0xDBFF) end -= 1;
      const out = slot.text.slice(slot.at, end);
      slot.at = end;
      return out;
    };
    const whole = (slot) => Boolean(slot) && slot.text !== null && !slot.broke && slot.at >= slot.text.length;
    window.HardLinesAndroid = {
      beginBackup: (name) => { app.name = String(name); app.pieces = []; },
      appendBackup: (piece) => { app.pieces.push(String(piece)); },
      saveBackup: () => later(() => {
        if (app.next.save === 'cancel') { window.hardLinesBackupSaved(false, 'cancelled'); return; }
        app.savedAs = app.name;
        app.saved = app.pieces.join('');
        window.hardLinesBackupSaved(true, '');
      }),
      openBackup: () => {
        app.opened += 1;
        later(() => {
          if (app.next.open === null) { window.hardLinesRestoreCancelled(); return; }
          app.restore = given(app.next.open, app.next.fault);
          window.hardLinesRestoreReady();
        });
      },
      openRestore: () => { if (app.restore) app.restore.at = 0; return open(app.restore); },
      restoreChunk: () => next(app.restore),
      clearRestore: () => { const all = whole(app.restore); app.restore = null; return all; },
      // Its own copy of the page's data. The real app keeps it in a file of
      // its own; here it is kept where a reload of the page will not lose it.
      beginKeep: () => { app.keep = []; },
      appendKeep: (text) => { if (app.keep) app.keep.push(String(text)); },
      commitKeep: () => {
        const text = app.keep ? app.keep.join('') : '';
        app.keep = null;
        if (!text || localStorage.getItem('test:keepfails')) return false;
        localStorage.setItem('test:kept', text);
        localStorage.setItem('test:keeps', String(Number(localStorage.getItem('test:keeps') ?? 0) + 1));
        return true;
      },
      openKept: () => {
        app.kept = given(localStorage.getItem('test:kept'), localStorage.getItem('test:keptfault'));
        return open(app.kept);
      },
      keptChunk: () => next(app.kept),
      closeKept: () => { const all = whole(app.kept); app.kept = null; return all; },
    };
    // A file chosen just before the app was restarted underneath its chooser.
    const waiting = sessionStorage.getItem('test:waiting');
    if (waiting) { app.restore = given(waiting); sessionStorage.removeItem('test:waiting'); }
  };
  const h = await open({ init: [SABOTAGE, PRETEND_APP], userAgent: ANDROID_UA });
  await h.evaluate(async (original) => {
    const from = JSON.parse(original);
    // Two long runs of characters that take two units each, starting on an odd
    // and an even position, so that a piece boundary falls inside one of them.
    from.prefs.noteA = `a${'🏰'.repeat(120000)}`;
    from.prefs.noteB = `ab${'🏰'.repeat(120000)}`;
    for (const [name, payload] of Object.entries(from)) await Store.set(name, payload);
    await loadStored();
    renderToday();
  }, original);
  const inApp = await areas(h);
  check('G: in the app, the page says it is kept inside the app', /^Saved inside this app, on this phone only\./.test(await h.$eval('#storeNote', (el) => el.textContent)), true);
  await h.click('#backupSave');
  await h.waitForFunction(() => window.__app.saved !== null);
  const handed = await h.evaluate(() => ({
    name: window.__app.savedAs, pieces: window.__app.pieces.length, longest: Math.max(...window.__app.pieces.map((p) => p.length)),
    halved: window.__app.pieces.slice(0, -1).some((p) => { const c = p.charCodeAt(p.length - 1); return c >= 0xD800 && c <= 0xDBFF; }),
    shortened: window.__app.pieces.slice(0, -1).some((p) => p.length === 199999),
    text: window.__app.saved, note: document.getElementById('backupNote').textContent, busy: document.getElementById('backupSave').disabled,
  }));
  check('G: the app is handed the file under its name', /^hard-lines-chess-backup-\d{4}-\d{2}-\d{2}\.json$/.test(handed.name), true);
  check('G: a piece at a time, none longer than the app takes', handed.pieces >= 3 && handed.longest <= 200000, true);
  check('G: no piece ends halfway through a character', handed.halved, false);
  check('G: because the one that would have was stopped a unit short', handed.shortened, true);
  const fromApp = JSON.parse(handed.text);
  check('G: put together, it is a backup made in the Android app', `${fromApp.app} ${fromApp.kind} ${fromApp.from}`, 'hard-lines-chess backup the Android app');
  check('G: holding exactly what the app holds', JSON.stringify(Object.fromEntries(Object.entries(fromApp.areas).map(([k, v]) => [k, v.payload]))), inApp);
  check('G: and the page says it was saved, and to keep it off the phone', /^Saved as hard-lines-chess-backup-.*Keep it somewhere other than this phone\.$/.test(handed.note), true);
  check('G: with the buttons live again', handed.busy, false);

  await h.evaluate(() => { window.__app.next.save = 'cancel'; });
  await h.click('#backupSave');
  await h.waitForFunction(() => document.getElementById('backupNote').textContent === 'Not saved.');
  check('G: backing out of the app\'s chooser is said as that', await note(h), 'Not saved.');
  await h.click('#backupOpen');
  await h.waitForFunction(() => document.getElementById('backupNote').textContent === 'Nothing was restored.');
  check('G: and so is backing out of choosing a file', await h.evaluate(() => window.__app.opened), 1);

  // Into the app, from the app's own file: wipe first, so the restore has to do the work.
  await h.evaluate(async () => {
    for (const name of STORE_AREAS) await Store.set(name, name === 'storm' ? null : {});
    await loadStored();
  });
  check('G: emptied', await h.evaluate(() => App.reviews.games.length + App.drills.items.length), 0);
  await h.evaluate((text) => { window.__app.next.open = text; }, handed.text);
  await h.click('#backupOpen');
  await h.waitForFunction(() => !document.getElementById('backupConfirm').hidden);
  check('G: the app\'s file is collected whole and the question asked', /saved on \d+ \w+ \d{4} in the Android app\./.test(await h.$eval('#backupConfirmText', (el) => el.textContent)), true);
  check('G: and the app is told it has been collected', await h.evaluate(() => window.__app.restore), null);
  await restarted(h, () => h.click('#backupReplace'));
  check('G: restoring brings back exactly what the app held', await areas(h), inApp);

  // A file that does not come across whole changes nothing, and asks nothing.
  await gotoSection(h, 'today');
  for (const [fault, what] of [['cut', 'breaks off partway'], ['shut', 'will not open']]) {
    await h.evaluate(([text, f]) => { window.__app.next.open = text; window.__app.next.fault = f; document.getElementById('backupNote').textContent = ''; }, [handed.text, fault]);
    await h.click('#backupOpen');
    await h.waitForFunction(() => /could not be read in full/.test(document.getElementById('backupNote').textContent));
    check(`G: a file that ${what} is said to have changed nothing`, await note(h), 'That file could not be read in full. Nothing was changed.');
    check(`G: a file that ${what} is refused without a question`, `${await h.$eval('#backupConfirm', (el) => el.hidden)} ${await h.evaluate(() => Backup.pending)}`, 'true null');
    check(`G: a file that ${what} changes nothing`, await areas(h), inApp);
  }
  await h.evaluate(() => { window.__app.next.fault = undefined; });

  // A file that was ready when the app was restarted is offered when the page comes up.
  await h.evaluate((text) => sessionStorage.setItem('test:waiting', text), handed.text);
  await reload(h);
  await h.waitForFunction(() => !document.getElementById('backupConfirm').hidden);
  check('G: a file left waiting by a restart is asked about when the page opens', await h.evaluate(() => Backup.pending !== null && window.__app.restore === null), true);
  await h.close();

  // ── H. the app's own copy ───────────────────────────────────────────────────
  const leave = (page) => page.evaluate(() => { window.hardLinesLeaving(); });
  const keptFile = (page) => page.evaluate(() => localStorage.getItem('test:kept'));
  const keeps = (page) => page.evaluate(() => Number(localStorage.getItem('test:keeps') ?? 0));
  // What a phone short of space does: the database goes, and the small store stays.
  const clearDatabase = (page) => page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('hardlines');
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  }));
  const saidBelow = (page) => page.$eval('#backupRestoredText', (el) => el.textContent);
  const payloads = (text) => JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(text).areas).map(([n, v]) => [n, v.payload])));

  const k = await open({ init: [SABOTAGE, SEED, PRETEND_APP], userAgent: ANDROID_UA });
  check('H: the first time, there is no copy, and nothing is said', `${await keptFile(k)} ${await k.$eval('#backupRestored', (el) => el.hidden)}`, 'null true');
  const heldInApp = await areas(k);
  await leave(k);
  const firstCopy = await keptFile(k);
  check('H: leaving the app hands it a copy of everything', payloads(firstCopy), heldInApp);
  const asFile = JSON.parse(firstCopy);
  check('H: laid out as a backup file is', `${asFile.app} ${asFile.kind} ${asFile.format} ${asFile.from}`, 'hard-lines-chess backup 1 the Android app');
  await leave(k);
  check('H: leaving again with nothing changed makes no second copy', await keeps(k), 1);
  await k.evaluate(async () => { App.prefs.theme = 'light'; await Store.set('prefs', App.prefs); });
  await leave(k);
  check('H: leaving after a change makes one', await keeps(k), 2);
  await reload(k);
  check('H: an ordinary load does not read the copy at all', await k.evaluate(() => Store.keptPulled), false);
  await leave(k);
  check('H: nor make another, nothing having changed', await keeps(k), 2);

  // The phone clears the database.
  const beforeCleared = await areas(k);
  await clearDatabase(k);
  await reload(k);
  check('H: the phone clears the database, and everything is there all the same', await areas(k), beforeCleared);
  const back = await k.evaluate(async () => ({ lost: Store.lost, flag: localStorage.getItem('hardlines:__lost'), took: Store.recovered?.names.join(' '),
    stored: (await Store.localDoc('reviews'))?.payload.games.length, failed: Store.localFailed }));
  check('H: taken from the app\'s own copy', back.took, 'drills history reviews prefs');
  check('H: and written back to the database', `${back.stored} ${back.failed}`, '2 false');
  check('H: with nothing left marked as lost', `${back.lost} ${back.flag}`, 'false null');
  await gotoSection(k, 'today');
  await k.waitForFunction(() => !document.getElementById('backupRestored').hidden);
  say('H: what the page says', await saidBelow(k));
  check('H: the page says what happened, and when the copy was made',
    /^This phone had cleared what the app had saved\. It can do that when the phone is very short of space, or when the stored copy is damaged\. It has been put back from the app’s own copy, made on \d+ \w+ \d{4} at \d\d:\d\d\. Anything done after that is gone\.$/.test(await saidBelow(k)), true);
  check('H: under one button, with nothing to undo', `${await k.$eval('#backupUndo', (el) => el.hidden)} ${await k.$eval('#backupKeep', (el) => el.textContent)}`, 'true Done');
  check('H: and where the data is kept is said as usual', /^Saved inside this app, on this phone only\./.test(await k.$eval('#storeNote', (el) => el.textContent)), true);
  await reload(k);
  await gotoSection(k, 'today');
  check('H: it is still said after a reload, until it has been read', await k.$eval('#backupRestored', (el) => el.hidden), false);
  check('H: and that load did not need the copy', await k.evaluate(() => Store.keptPulled), false);
  await k.click('#backupKeep');
  await k.waitForFunction(() => document.getElementById('backupRestored').hidden);
  check('H: then it is not said again', await k.evaluate(() => localStorage.getItem('hardlines:__recovered')), null);

  // A save the phone refused.
  await flag(k, 'puts', 'refuse');
  await k.evaluate(async () => {
    App.drills.items.push({ id: 'refused', fen: 'x', side: 'white', played: 'a3', playedUci: 'a2a3', best: { san: 'e4', uci: 'e2e4' }, card: SRS.fresh() });
    await Store.set('drills', App.drills);
  });
  check('H: a save the phone refuses is owed', await k.evaluate(() => [...Store.unsaved].join(' ')), 'drills');
  await leave(k);
  await flag(k, 'puts', null);
  await reload(k);
  check('H: but it was in the copy made on leaving, and is there next time', await k.evaluate(() => App.drills.items.map((item) => item.id).join(' ')), 'old-1 refused');
  check('H: and in the database, now that it takes it', await k.evaluate(async () => `${(await Store.localDoc('drills')).payload.items.length} ${Store.localFailed}`), '2 false');
  await gotoSection(k, 'today');
  await k.waitForFunction(() => !document.getElementById('backupRestored').hidden);
  check('H: said as a save that had not reached the phone\'s storage', /^Some of what was last saved had not reached this phone’s storage\. It was held in the app’s own copy, and has been put back\.$/.test(await saidBelow(k)), true);
  await k.click('#backupKeep');
  await k.waitForFunction(() => document.getElementById('backupRestored').hidden);

  // What the database holds is never replaced by an older copy.
  await leave(k);
  await k.evaluate(async () => { App.prefs.judge = 'app'; await Store.set('prefs', App.prefs); });
  await reload(k);
  check('H: a database that is ahead of the copy is left alone', await k.evaluate(() => `${App.prefs.judge} ${Store.keptPulled}`), 'app false');
  const clock = await k.evaluate(async () => {
    const before = Store.stamps.prefs;
    const real = Date.now;
    Date.now = () => 1000;             // a clock put back to 1970
    try { await Store.set('prefs', App.prefs); } finally { Date.now = real; }
    return Store.stamps.prefs - before;
  });
  check('H: and a clock put back does not date a save before the one it follows', clock, 1);
  await leave(k);

  // A copy that cannot be read — will not open, or breaks off partway.
  const beforeBlind = await areas(k);
  const copyBefore = await keptFile(k);
  for (const fault of ['shut', 'cut']) {
    await clearDatabase(k);
    await flag(k, 'keptfault', fault);
    await reload(k);
    const blind = await k.evaluate(async () => {
      App.history.games.push({ at: 7, band: 800, colour: 'white', result: 'l', plies: 2, control: 'none', pgn: '1. f3 e5' });
      await Store.set('history', App.history);
      renderToday();
      return { state: `${Store.mode} ${Store.failure} ${Store.lost} ${App.reviews.games.length}`, where: document.getElementById('storeNote').textContent,
        shut: document.getElementById('backupSave').disabled && document.getElementById('backupOpen').disabled };
    });
    check(`H[${fault}]: with the database cleared, a copy that cannot be read stops the session`, blind.state, 'none unread true 0');
    check(`H[${fault}]: the page says part of the data could not be read, and to open the app again`, /PART OF YOUR SAVED DATA COULD NOT BE READ THIS TIME, SO NOTHING IS BEING SAVED/.test(blind.where) && /Close the app completely and open it again/.test(blind.where), true);
    check(`H[${fault}]: nothing can be backed up from it or restored into it`, blind.shut, true);
    await leave(k);
    check(`H[${fault}]: the copy is not written over`, (await keptFile(k)) === copyBefore, true);
    check(`H[${fault}]: and what was done meanwhile was written nowhere`, await largeRaw(k, 'history'), null);
    await flag(k, 'keptfault', null);
    await reload(k);
    check(`H[${fault}]: next time, with the copy readable, everything it held is back`, await areas(k), beforeBlind);
    check(`H[${fault}]: and nothing is marked as lost`, await k.evaluate(() => `${Store.lost} ${Store.mode} ${localStorage.getItem('hardlines:__blind')}`), 'false large null');
    await gotoSection(k, 'today');
    await k.click('#backupKeep');
    await k.waitForFunction(() => document.getElementById('backupRestored').hidden);
  }

  // A copy that will not read time after time is given up, not waited on for ever.
  await clearDatabase(k);
  await flag(k, 'keptfault', 'shut');
  await reload(k);
  await reload(k);
  check('H: a second time running, the session still stops for it', await k.evaluate(() => `${Store.mode} ${Store.failure}`), 'none unread');
  await reload(k);
  check('H: the third time, the app opens without it', await k.evaluate(() => `${Store.mode} ${Store.lost} ${Store.keptUnread} ${App.reviews.games.length}`), 'large true false 0');
  await gotoSection(k, 'today');
  await k.waitForFunction(() => !document.getElementById('backupRestored').hidden);
  check('H: saying what was lost, and that the app could not put it back',
    /^This phone has cleared what the app had saved\. It can do that when the phone is very short of space, or when the stored copy is damaged\. The app had no copy of its own that it could put back\. A backup file brings it back: use “Restore from a backup”\.$/.test(await saidBelow(k)), true);
  await flag(k, 'keptfault', null);
  // …and a backup file does bring it back.
  await k.evaluate((text) => { window.__app.next.open = text; }, copyBefore);
  await k.click('#backupOpen');
  await k.waitForFunction(() => !document.getElementById('backupConfirm').hidden);
  await restarted(k, () => k.click('#backupReplace'));
  check('H: a backup file brings it back', await areas(k), beforeBlind);
  check('H: and ends it', await k.evaluate(() => `${Store.lost} ${localStorage.getItem('hardlines:__lost')}`), 'false null');
  await leave(k);
  check('H: and the next copy made takes the damaged one\'s place', payloads(await keptFile(k)), beforeBlind);
  await gotoSection(k, 'today');
  await k.click('#backupKeep');
  await k.waitForFunction(() => document.getElementById('backupRestored').hidden);

  // A copy the app cannot take leaves the page still owing one.
  await flag(k, 'keepfails', '1');
  await k.evaluate(async () => { App.prefs.theme = 'light'; await Store.set('prefs', App.prefs); });
  const keepsBefore = await keeps(k);
  await leave(k);
  check('H: a copy the app could not take is not counted as made', await k.evaluate(() => Store.keptCurrent()), false);
  await flag(k, 'keepfails', null);
  await leave(k);
  check('H: and is made the next time the app is left', `${await keeps(k) - keepsBefore} ${await k.evaluate(() => Store.keptCurrent())}`, '1 true');

  // A session that could not open its data makes no copy of its emptiness.
  // (The page being reloaded is itself a moment it is left, so the session
  // before this one has just made its copy; the one to watch is this one.)
  await flag(k, 'database', 'shut');
  await reload(k);
  const copyThen = await keptFile(k);
  await k.evaluate(async () => { App.prefs.theme = 'dark'; await Store.set('prefs', App.prefs); });
  await leave(k);
  check('H: a session with its data shut makes no copy', `${await k.evaluate(() => Store.mode)} ${(await keptFile(k)) === copyThen}`, 'none true');
  await flag(k, 'database', null);
  await reload(k);
  check('H: nor does being closed, and the next load has everything', `${(await keptFile(k)) === copyThen} ${await k.evaluate(() => `${Store.mode} ${App.reviews.games.length}`)}`, 'true large 2');
  await k.close();

  // In a browser there is no app to keep a copy: the page says what happened.
  const w = await open({ init: [SABOTAGE, SEED] });
  check('H: a browser has no copy-keeper', await w.evaluate(() => Store.keeper), null);
  await clearDatabase(w);
  await reload(w);
  await gotoSection(w, 'today');
  await w.waitForFunction(() => !document.getElementById('backupRestored').hidden);
  say('H: in a browser', await saidBelow(w));
  check('H: in a browser, a cleared database is said to be that, with what brings it back',
    /^This browser has cleared what the app had saved here\. It can do that when the device is very short of space, or when the stored copy is damaged\. A backup file brings it back: use “Restore from a backup”\.$/.test(await saidBelow(w)), true);
  check('H: as a warning, under a button that lets it go', `${await w.$eval('#backupRestoredText', (el) => el.className)} | ${await w.$eval('#backupKeep', (el) => el.textContent)}`, 'note bad-note | Carry on without it');
  await reload(w);
  check('H: it is still said on the next load', await w.evaluate(() => Store.lost), true);
  await gotoSection(w, 'today');
  await choose(w, file);
  await w.waitForFunction(() => !document.getElementById('backupConfirm').hidden);
  await restarted(w, () => w.click('#backupReplace'));
  check('H: restoring a backup ends it', await w.evaluate(() => `${Store.lost} ${localStorage.getItem('hardlines:__lost')} ${App.reviews.games.length}`), 'false null 3');
  await w.close();

  const w2 = await open({ init: [SABOTAGE, SEED] });
  await clearDatabase(w2);
  await reload(w2);
  await gotoSection(w2, 'today');
  await w2.waitForFunction(() => !document.getElementById('backupRestored').hidden);
  await w2.click('#backupKeep');
  await w2.waitForFunction(() => document.getElementById('backupRestored').hidden);
  check('H: and so does choosing to carry on without it', await w2.evaluate(() => `${Store.lost} ${localStorage.getItem('hardlines:__lost')}`), 'false null');
  await reload(w2);
  check('H: for good', await w2.evaluate(() => Store.lost), false);
  await w2.close();

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
  if (errors.length) failures.push('page errors');
  await browser.close();
  srv.stop?.();
  if (failures.length) { console.log(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1); }
  console.log('ok');
  process.exit(0);
})().catch((e) => { console.error(e); console.log('FAILED'); process.exit(1); });
