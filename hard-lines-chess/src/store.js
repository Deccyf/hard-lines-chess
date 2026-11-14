// ── where progress lives ───────────────────────────────────────────────────
//
// The page asks the viewer's Claude for a document store, and keeps a copy on
// this device either way. BOTH ARE REAL PATHS: the store may be absent because
// it was never granted, or because the page is open somewhere it cannot reach
// — indistinguishable by design — so the app has to work either way rather
// than treating one as an error.
//
// Everything is written under one document per area, because these are small
// and always read whole. A collection per drill would buy queries this app
// never makes.
//
// EVERY DOCUMENT IS WRAPPED — { payload, updated, version } — in BOTH places.
// The wrapper is what lets a load choose between the two copies by which is
// newer, rather than by which store answered: a db write that failed once
// (offline, refused) used to leave an older copy in the db that beat the newer
// local one on the next load, and the next write then made the loss permanent.
// A bare value with no wrapper is a document from before this, and is read as
// version 1 with no date.
//
// THE COPY ON THIS DEVICE LIVES IN THE BROWSER'S LARGE DATABASE (IndexedDB).
// It used to live in localStorage, which holds about five million characters
// for the whole app. Measured: an analysed game is about 6,400 of them, so the
// next save was refused at around 800 analysed games — while the import offers
// a thousand — and from then on every save failed while the page went on
// looking fine. The large database is limited by the device's free space.
//
// THE MOVE IS MADE ONE AREA AT A TIME, AND NOTHING IS REMOVED UNTIL ITS COPY
// HAS BEEN READ BACK. An area found in the small store is written to the large
// one, read back, compared character for character, and only then removed
// from the small one. If any step fails the small copy stays where it is and
// is what the session uses, and the move is tried again on the next load.
//
// AND ONCE THE LARGE DATABASE HAS BEEN USED HERE, THE SMALL STORE IS NEVER
// FALLEN BACK ON. If the database cannot be opened one day, falling back would
// show an empty app, let it be used, and save that near-empty state under
// today's date — which the next good load would then prefer over the real
// history, as the newer copy. So on that day nothing is read and nothing is
// written, and the page says so. The same goes for one area that will not
// read: the session stops there, rather than open that part of the app empty
// and let its first save put the emptiness where the history is.
//
// AND THE LARGE DATABASE CAN BE TAKEN AWAY. A browser may clear it when the
// device runs very short of space, and inside the Android app it cannot be
// asked not to. The small store is not cleared with it — which is how the
// page tells "cleared" from "first time here": the note that the large
// database has been used is still in the small store, and the database is
// new. Where the page runs inside an app that keeps a copy of its own outside
// the browser's storage (the Android app does, in its private files, which
// the phone does not clear), that copy is what puts it back — see `keeper`.
const STORE_VERSION = 2;

/**
 * Every area the app keeps. One list, so that the backup file, the restore and
 * the move between stores cannot each forget a different one —
 * tests/store.test.mjs holds every Store.get and Store.set in the source to it.
 */
const STORE_AREAS = ['prefs', 'openings', 'drills', 'history', 'reviews', 'puzzles', 'teaching', 'endgames', 'vision', 'storm', 'weakspots'];

/** Where the copy on this device is kept, and how long opening it may take. */
const LOCAL_DB = { name: 'hardlines', table: 'state', openMs: 8000 };

/**
 * Open this device's large database: { db, created } — `created` when there
 * was none here before this — or reject with why it would not open.
 */
function openLocalDb() {
  return new Promise((resolve, reject) => {
    let settled = false;
    let created = false;
    const finish = (how, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      how(value);
    };
    // A database that never answers is a page that never opens: the app loads
    // its progress before it draws anything. Some browsers have shipped
    // exactly that fault, so the wait has an end.
    const timer = setTimeout(() => finish(reject, new Error('The database did not open in time.')), LOCAL_DB.openMs);
    let request;
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('This browser has no database to open.');
      request = indexedDB.open(LOCAL_DB.name, 1);
    } catch (e) {
      finish(reject, e);
      return;
    }
    request.onupgradeneeded = (event) => {
      // No database here before this: the app's first time in this browser,
      // or one that was here has been removed. init() tells which.
      if (event.oldVersion === 0) created = true;
      if (!request.result.objectStoreNames.contains(LOCAL_DB.table)) request.result.createObjectStore(LOCAL_DB.table);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Opened after the wait ran out: nobody is going to use it.
      if (settled) { db.close(); return; }
      // Another copy of the page wanting to change or remove the database
      // must not be held up by this one. Saves after that fail, and are said
      // to have failed.
      db.onversionchange = () => db.close();
      finish(resolve, { db, created });
    };
    request.onerror = () => finish(reject, request.error ?? new Error('The database would not open.'));
    request.onblocked = () => finish(reject, new Error('The database is held open elsewhere.'));
  });
}

/**
 * One piece of work on the large database, resolved when it is safely done.
 *
 * A WRITE IS DONE WHEN ITS TRANSACTION IS, not when the request is. A request
 * can succeed and its transaction still be abandoned — a disk that fills
 * between the two, for one — and what was "written" is then not there. So this
 * resolves on the transaction, and with the first request's result.
 *
 * `strict` asks for the write to be on the disk before it counts, for the
 * moments where being wrong costs the most: the move out of the small store,
 * and a restore.
 */
function localDbWork(db, mode, run, { strict = false } = {}) {
  return new Promise((resolve, reject) => {
    let tx, request;
    try {
      tx = strict ? db.transaction(LOCAL_DB.table, mode, { durability: 'strict' }) : db.transaction(LOCAL_DB.table, mode);
      request = run(tx.objectStore(LOCAL_DB.table));
    } catch (e) {
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve(request?.result ?? null);
    tx.onabort = () => reject(tx.error ?? request?.error ?? new Error('The save was abandoned.'));
    tx.onerror = () => reject(tx.error ?? request?.error ?? new Error('The save failed.'));
  });
}

const Store = {
  db: null,          // the viewer's Claude document store, when one was granted
  local: null,       // this device's large database, once it has opened
  // WHERE THE COPY ON THIS DEVICE IS:
  //   'large'  — the large database. The ordinary case.
  //   'legacy' — the small store, because this browser has no large one and
  //              never has had. Everything works as it did, limit included.
  //   'none'   — the large database has been used here and would not open
  //              this time. Nothing is read or written; see the top of the file.
  mode: 'legacy',
  // The large database did not exist before this load…
  created: false,
  // …although it has been used here, so the device removed it. Stays true,
  // across loads, until what was in it has been put back or let go of.
  lost: false,
  // THE APP'S OWN COPY. Where the page runs inside an app that can keep a
  // file of its own, src/backup.js sets this to { read(), write(text) }: a
  // copy of everything, in the backup file's layout, outside the browser's
  // storage. It is written when the app is left, and read on a load only when
  // it may hold something this device's database does not — the database is
  // new, or the last copy made was told to hold something newer than the
  // database now does (a save the device refused, or one that never reached
  // the disk). Then THE NEWER COPY WINS, area by area, exactly as it does
  // between this device and the account's store.
  keeper: null,
  kept: null,          // the copy, once read this load: { exported, areas }
  keptPulled: false,
  // The copy is there and could not be read. It is not written over this
  // session, so that whatever it holds is still there to read next time.
  keptUnread: false,
  // What the last copy made was told to hold: { area: updated }.
  keptStamps: null,
  // What this load took from the copy, for the page to say:
  // { exported, lost, created, names }.
  recovered: null,
  ready: false,
  cache: {},
  // When each area's cached value was last written, for the backup file.
  stamps: {},
  // A SAVE TO THIS DEVICE CAN FAIL, AND THE PAGE LOOKS FINE WHEN IT DOES.
  // set() puts the value in `cache` first, so every screen goes on reading the
  // new state for the rest of the session — and on the next load it is simply
  // gone. That happens when the device is full, in a private window, and on a
  // browser set to block site data.
  //
  // There is nowhere honest to put an error at the moment it happens: it
  // happens during a save nobody asked for. So it is remembered here, and the
  // one screen that makes a promise about your data reads it and says what is
  // actually true.
  //
  // WHICH AREAS, not just whether: every area is written whole, so an area
  // whose save failed is put right by its next save that works — and when one
  // does work, the others that are owed are tried again there and then. The
  // warning goes when nothing is owed, and not before.
  unsaved: new Set(),
  localFailed: false,
  // Why nothing is being saved: 'full', 'refused' or 'failed' for a save
  // that did not work; 'unopened' or 'unread' for a session that was stopped
  // because what is stored here could not be reached.
  failure: null,
  // Names whose last db write failed; retried on the next set() or init().
  // Kept in the small store as well, so a reload does not forget the debt.
  dirty: new Set(),

  async init() {
    try {
      this.db = await window.claude?.use?.('db') ?? null;
    } catch {
      this.db = null;
    }
    try {
      const opened = await openLocalDb();
      this.local = opened.db;
      this.mode = 'large';
      this.created = opened.created;
      // A new database where one has been used: the device removed it.
      if (this.created && this.marked()) this.lose();
      this.mark();
    } catch {
      this.local = null;
      if (this.marked()) this.shut('unopened'); else this.mode = 'legacy';
    }
    this.lost = this.lost || this.flagged('__lost');
    try {
      this.keptStamps = JSON.parse(localStorage.getItem(this.key('__kept')) ?? 'null')?.stamps ?? null;
    } catch {
      this.keptStamps = null;
    }
    this.ready = true;
    try {
      const owed = JSON.parse(localStorage.getItem(this.key('__dirty')) ?? '[]');
      for (const name of owed) this.dirty.add(name);
    } catch { /* nothing owed, or storage unreadable — set() reports the write */ }
    if (this.db) await this.flushDirty();
    return this.db !== null;
  },

  key(name) {
    return `hardlines:${name}`;
  },

  /** Whether the large database has ever been opened in this browser. */
  marked() {
    try { return localStorage.getItem(this.key('__large')) === '1'; } catch { return false; }
  },

  /** Remember that it has. Tried again after each area moves out, because a small store that is full has no room even for this. */
  mark() {
    try { localStorage.setItem(this.key('__large'), '1'); } catch { /* full for now */ }
  },

  /** Whether the small store holds one of the notes kept beside the data. */
  flagged(name) {
    try { return localStorage.getItem(this.key(name)) !== null; } catch { return false; }
  },

  /** The database that was here is gone. Noted in the small store, which is not cleared with it. */
  lose() {
    this.lost = true;
    try { localStorage.setItem(this.key('__lost'), JSON.stringify({ at: Date.now() })); } catch { /* said for this session at least */ }
  },

  /** What was lost has been put back, or let go of. */
  found() {
    this.lost = false;
    try { localStorage.removeItem(this.key('__lost')); } catch { /* asked again next load */ }
  },

  /**
   * Stop reading and writing for the rest of this session. Something stored
   * here could not be reached, and a session that carried on would save its
   * own emptiness over it.
   */
  shut(why) {
    this.mode = 'none';
    this.localFailed = true;
    this.failure = why;
  },

  /** Record how one save to this device went. */
  settle(name, saved, error = null) {
    if (saved) this.unsaved.delete(name);
    else {
      this.unsaved.add(name);
      this.failure = error?.name === 'QuotaExceededError' ? 'full' : (this.mode === 'large' ? 'failed' : 'refused');
    }
    this.localFailed = this.mode === 'none' || this.unsaved.size > 0;
  },

  /** Where your progress is actually kept, in a sentence, whatever is true. */
  where() {
    const inApp = typeof IN_ANDROID_APP !== 'undefined' && IN_ANDROID_APP;
    if (this.localFailed) {
      if (this.db) {
        return 'This device is refusing to store anything — a private window, site data blocked, or no room left. Your progress is going to your Claude account, which is what will bring it back; nothing is being kept on this device.';
      }
      const again = `Close the app completely and open it again. If it keeps happening, restart the ${inApp ? 'phone' : 'device'} and make sure it has some free space.`;
      if (this.failure === 'unopened') {
        return `YOUR SAVED DATA COULD NOT BE OPENED THIS TIME, AND NOTHING IS BEING SAVED. What you see is an empty app, not a lost one: your games are still stored, and this session cannot reach them. ${again}`;
      }
      if (this.failure === 'unread') {
        return `PART OF YOUR SAVED DATA COULD NOT BE READ THIS TIME, SO NOTHING IS BEING SAVED. What is missing from the screen is not lost: it is still stored, and this session could not read it. ${again}`;
      }
      if (this.failure === 'full') {
        return this.mode === 'legacy'
          ? 'NOTHING IS BEING SAVED: this browser’s small store is full, and it has no larger one to use. This session is intact, but what you have done since the last save that worked will be gone when the page closes. Save a backup file now — that still works — and open the app in a browser that can keep more.'
          : 'NOTHING IS BEING SAVED: the device refused the last save because it has no room left. This session is intact, but what you have done since the last save that worked will be gone when the app closes. Save a backup file now — that still works — then free some space, and the next save will catch up.';
      }
      if (this.failure === 'failed') {
        return 'NOTHING IS BEING SAVED: the last save to this device failed. This session is intact, but what you have done since the last save that worked will be gone when the app closes. Save a backup file now — that still works — then close the app completely and open it again.';
      }
      return 'NOTHING IS BEING SAVED. This browser refused to store data — usually a private window, or site data blocked for this site. The app works and this session is intact, but everything will be gone when the page is closed. Open it in a normal window, or allow site data, to keep your games.';
    }
    if (this.db) return 'Saved to your Claude account, so it follows you to another device, with a copy in this browser.';
    if (this.mode === 'legacy') {
      return 'Saved in this browser only, in its small store — this browser would not open a larger one — which holds a few hundred analysed games and no more. It survives closing the tab, but not clearing site data or moving to another device. Keep a backup file.';
    }
    return inApp
      ? 'Saved inside this app, on this phone only. It survives closing the app, but not uninstalling it or clearing its data. A backup file is what brings it back, and what moves it to another phone.'
      : 'Saved in this browser, on this device only. It survives closing the tab, but not clearing site data or moving to another device. A backup file is what brings it back.';
  },

  /** Read a stored value as { payload, updated, version }, whatever shape it was written in. */
  unwrap(value) {
    if (value === null || value === undefined) return null;
    if (value && typeof value === 'object' && !Array.isArray(value) && 'payload' in value) {
      return { payload: value.payload, updated: Number.isFinite(value.updated) ? value.updated : 0, version: Number.isFinite(value.version) ? value.version : 1 };
    }
    return { payload: value, updated: 0, version: 1 };
  },

  /**
   * Bring a document written by an older version up to the current shape.
   * Cards are the thing that has changed: a drill row without one, or a card
   * with an ease that is not a number, used to either throw on review or be
   * scheduled for a day that is not a number — and never come back.
   */
  migrate(name, payload, version) {
    let out = payload;
    if (version < 2 && out && typeof out === 'object') {
      if (Array.isArray(out.items) && (name === 'drills' || name === 'puzzles')) {
        out = { ...out, items: out.items.map((item) => (item && typeof item === 'object') ? { ...item, card: SRS.normalise(item.card) } : item) };
      }
      if (name === 'openings' && out.cards && typeof out.cards === 'object') {
        const cards = {};
        for (const [id, card] of Object.entries(out.cards)) cards[id] = SRS.normalise(card);
        out = { ...out, cards };
      }
    }
    return out;
  },

  /** What the small store holds for an area, as a document, or null. */
  small(name) {
    try {
      const raw = localStorage.getItem(this.key(name));
      return raw ? this.unwrap(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  },

  /** Whether the small store still holds anything under an area's name. */
  hasSmall(name) {
    try { return localStorage.getItem(this.key(name)) !== null; } catch { return false; }
  },

  dropSmall(name) {
    try { localStorage.removeItem(this.key(name)); } catch { /* it stays, and loses to the newer copy on every load */ }
  },

  /**
   * What the large database holds for an area, as a document; null when it
   * holds none; undefined when it could not be read — which is not the same
   * thing, and must not be treated as "nothing there".
   */
  async large(name) {
    if (!this.local) return null;
    let raw;
    try {
      raw = await localDbWork(this.local, 'readonly', (table) => table.get(name));
    } catch {
      return undefined;
    }
    if (raw === null || raw === undefined) return null;
    try {
      return this.unwrap(typeof raw === 'string' ? JSON.parse(raw) : raw);
    } catch {
      return undefined;
    }
  },

  /** The document as this device holds it now, without moving anything. */
  async localDoc(name) {
    if (this.mode === 'none') return null;
    if (this.mode === 'large') {
      const large = await this.large(name);
      if (large) return large;
    }
    return this.small(name);
  },

  /**
   * The copy of an area on this device, or null — and, on the way, its move
   * out of the small store. The top of this file says why it is made the way
   * it is.
   */
  async readLocal(name) {
    if (this.mode === 'none') return null;
    const small = this.small(name);
    if (this.mode === 'legacy') return small;

    let large = await this.large(name);
    // A read can fail for a moment and work the next, so it is asked once
    // more before anything is concluded from it.
    if (large === undefined) large = await this.large(name);
    if (!small) {
      if (large === undefined) {
        // WHAT IS STORED UNDER THIS NAME WOULD NOT READ. Taking that for
        // "nothing there" would open this part of the app empty, and its
        // first save would put the emptiness where the history is.
        this.shut('unread');
        return null;
      }
      return large;
    }
    // A large copy that will not read leaves the small one as all there is,
    // and it stays exactly where it is.
    if (large === undefined) return small;
    if (large && large.updated >= small.updated) {
      // The small copy lost to a newer one, and only takes up room.
      this.dropSmall(name);
      this.mark();
      return large;
    }

    // Write it, read it back, compare, and only then remove it.
    const text = JSON.stringify(small);
    try {
      await localDbWork(this.local, 'readwrite', (table) => table.put(text, name), { strict: true });
      const back = await localDbWork(this.local, 'readonly', (table) => table.get(name));
      if (back !== text) throw new Error('The copy read back differently.');
      this.dropSmall(name);
      this.mark();
    } catch {
      // The small copy is whole and is what this session uses. Nothing is
      // flagged, because nothing has been lost: the next load tries again,
      // and so does the next save of this area.
    }
    return small;
  },

  /** Write an area's document to this device. Resolves true once it is safely there. */
  async writeLocal(name, doc) {
    if (this.mode === 'none') return false;
    let text;
    try {
      text = JSON.stringify(doc);
    } catch (e) {
      this.settle(name, false, e);
      return false;
    }
    try {
      if (this.mode === 'large') {
        await localDbWork(this.local, 'readwrite', (table) => table.put(text, name));
        // A copy still in the small store is one whose move failed earlier.
        // This save is newer than it, so it has nothing left to offer — but it
        // goes on the same terms as any other: only once what the large
        // database holds has been read back and is what was written.
        if (this.hasSmall(name)) {
          const back = await localDbWork(this.local, 'readonly', (table) => table.get(name));
          if (back !== text) throw new Error('The save read back differently.');
          this.dropSmall(name);
          this.mark();
        }
      } else {
        localStorage.setItem(this.key(name), text);
      }
    } catch (e) {
      this.settle(name, false, e);
      return false;
    }
    this.settle(name, true);
    return true;
  },

  /** After a save that worked: the areas whose saves did not, tried again. */
  async retryUnsaved(except) {
    for (const name of [...this.unsaved]) {
      if (name === except || this.cache[name] === undefined) continue;
      const doc = { payload: this.cache[name], updated: this.stamps[name] || Date.now(), version: STORE_VERSION };
      if (!(await this.writeLocal(name, doc))) return;
    }
  },

  async get(name, fallback) {
    if (this.cache[name] !== undefined) return this.cache[name];

    let fromDb = null;
    if (this.db) {
      try {
        const snapshot = await this.db.doc(`state/${name}`).get();
        // `data` is a METHOD on the snapshot, not a field, and `exists` is
        // what says whether there is anything to read. Treating `data` as a
        // property yields the function itself, which is truthy — so the page
        // would look like it had loaded something and quietly hold a function
        // where its progress should be.
        fromDb = this.unwrap(snapshot?.exists ? (snapshot.data() ?? null) : null);
      } catch {
        fromDb = null;
      }
    }

    const fromLocal = await this.readLocal(name);

    // THE NEWER COPY WINS, wherever it is. Equal dates (two undated legacy
    // copies, say) keep the old preference for the store.
    let chosen = null;
    if (fromDb && fromLocal) chosen = fromLocal.updated > fromDb.updated ? fromLocal : fromDb;
    else chosen = fromDb ?? fromLocal;

    // And the app's own copy, where there is one and it is newer still.
    const fromKept = this.keptDoc(name, chosen);
    if (fromKept) chosen = fromKept;

    if (chosen && chosen.payload !== null && chosen.payload !== undefined) {
      const payload = chosen.version < STORE_VERSION ? this.migrate(name, chosen.payload, chosen.version) : chosen.payload;
      this.cache[name] = payload;
      this.stamps[name] = chosen.updated;
      if (fromKept) this.took(name);
      // A migrated or one-sided document is written back so every copy agrees
      // and the next load does not migrate, or reach for the app's copy, again.
      if (chosen.version < STORE_VERSION || fromKept || (fromDb && fromLocal && fromLocal !== fromDb && fromLocal.updated !== fromDb.updated)) {
        await this.set(name, payload, chosen.updated || Date.now());
      }
      return this.cache[name];
    }

    // Nothing stored — or an area a restore emptied, which keeps the date it
    // was emptied on so that an older copy of it does not come back.
    this.cache[name] = fallback;
    this.stamps[name] = chosen?.updated ?? 0;
    return this.cache[name];
  },

  /**
   * What the app's own copy holds for an area, when that is newer than the
   * newest found anywhere else — otherwise null, without the copy being read.
   */
  keptDoc(name, best) {
    if (!this.keeper || this.mode !== 'large') return null;
    const have = best?.updated ?? 0;
    const told = this.keptStamps?.[name] ?? 0;
    // The copy is a few million characters and is only fetched when it can
    // matter: it was told to hold something newer, or the database is new,
    // or was lost and has not been put back yet.
    if (!(told > have) && !this.created && !this.lost) return null;
    const doc = this.unwrap(this.pullKept()?.areas?.[name]);
    if (!doc || doc.payload === null || doc.payload === undefined) return null;
    return doc.updated > have ? doc : null;
  },

  /** The app's own copy, read at most once a load: { exported, areas }, or null when there is none to use. */
  pullKept() {
    if (this.keptPulled) return this.kept;
    this.keptPulled = true;
    let got = null;
    try { got = this.keeper.read(); } catch { got = { state: 'unread' }; }
    this.kept = got?.state === 'ok' ? got.file : null;
    if (got?.state !== 'unread') {
      this.tally('__blind', 0);
      return this.kept;
    }

    // THE COPY IS THERE AND WOULD NOT READ. It is not written over this
    // session. And where the database was cleared, the copy is all there is:
    // a session that carried on empty would date its own saves after it, and
    // those would then be taken for the newer ones. So that session stops.
    //
    // ONLY WHERE SOMETHING IS KNOWN TO HAVE BEEN LOST. A database that is
    // simply new — the first time this version opens, above all — has the
    // history still to move across from the small store, and nothing about
    // the app's copy, or about the way to it, may get in the way of that.
    //
    // AND ONLY TWICE. A copy that will not read a third time running is
    // damaged, and an app that stopped for it for ever would be no use to
    // anyone: from then on it is given up, the page says what was lost, and
    // the next copy made takes its place.
    const before = this.tally('__blind');
    if (before >= 2) {
      this.forgetKept();
    } else {
      this.keptUnread = true;
      if (this.lost) this.shut('unread');
    }
    return null;
  },

  /** A small count kept beside the data: returns what it was, and adds one — or sets it, when told what to. */
  tally(name, to) {
    try {
      const was = Number(localStorage.getItem(this.key(name))) || 0;
      if (to === 0) localStorage.removeItem(this.key(name)); else localStorage.setItem(this.key(name), String(to ?? was + 1));
      return was;
    } catch {
      return 0;
    }
  },

  /** Stop expecting anything of the app's own copy as it stands: the next one made replaces it. */
  forgetKept() {
    this.keptUnread = false;
    this.keptStamps = null;
    this.tally('__blind', 0);
    try { localStorage.removeItem(this.key('__kept')); } catch { /* the next copy made rewrites it */ }
  },

  /** An area has been taken from the app's own copy. */
  took(name) {
    this.recovered ??= { exported: this.kept?.exported ?? null, lost: this.lost, created: this.created, names: [] };
    this.recovered.names.push(name);
    if (this.lost) this.found();
  },

  /** A copy has been handed to the app to keep: remember what it was told to hold. */
  noteKept() {
    this.keptStamps = { ...this.stamps };
    // Whatever would not read before, this one is new.
    this.tally('__blind', 0);
    try {
      localStorage.setItem(this.key('__kept'), JSON.stringify({ at: Date.now(), stamps: this.keptStamps }));
    } catch { /* the copy is made all the same */ }
  },

  /** Whether the app's own copy was already told to hold everything as it now stands. */
  keptCurrent() {
    return Boolean(this.keptStamps) && STORE_AREAS.every((name) => (this.stamps[name] ?? 0) === (this.keptStamps[name] ?? 0));
  },

  async set(name, value, when) {
    // A DATE THAT ONLY GOES FORWARD. Which copy is the newer one is decided
    // by these dates, and a device's clock can be put back: without this,
    // everything saved after that would lose to a copy made before it.
    const updated = when ?? Math.max(Date.now(), (this.stamps[name] ?? 0) + 1);
    this.cache[name] = value;
    this.stamps[name] = updated;
    const doc = { payload: value, updated, version: STORE_VERSION };

    // Written to both when both exist. The copy on this device is what makes
    // the page usable the instant it opens, before any round trip; the store
    // is what makes it survive a new device.
    if (await this.writeLocal(name, doc)) await this.retryUnsaved(name);

    if (this.db) {
      if (this.dirty.size) await this.flushDirty(name);
      try {
        await this.db.doc(`state/${name}`).set(doc);
        this.markDirty(name, false);
      } catch {
        // Offline or refused: the local copy stands, and the debt is
        // remembered so the store catches up on the next write or load.
        this.markDirty(name, true);
      }
    }
  },

  markDirty(name, owed) {
    if (owed) this.dirty.add(name); else this.dirty.delete(name);
    try {
      if (this.dirty.size) localStorage.setItem(this.key('__dirty'), JSON.stringify([...this.dirty]));
      else localStorage.removeItem(this.key('__dirty'));
    } catch { /* the in-memory set still stands for this session */ }
  },

  /** Push every owed local copy to the store; `except` is the name about to be written anyway. */
  async flushDirty(except = null) {
    if (!this.db) return;
    for (const name of [...this.dirty]) {
      if (name === except) continue;
      const doc = await this.localDoc(name);
      if (!doc) { this.markDirty(name, false); continue; }
      try {
        await this.db.doc(`state/${name}`).set(doc);
        this.markDirty(name, false);
      } catch { /* still owed */ }
    }
  },

  /**
   * Ask the browser not to clear this site's data when the device runs short.
   * Asked when something worth keeping has just been made — an import, a
   * review, a backup — and never on load, where one browser answers the
   * question by putting a prompt in front of a page nobody has used yet.
   */
  keep() {
    try { navigator.storage?.persist?.().catch(() => {}); } catch { /* not offered here */ }
  },

  // ── the whole of it, at once: what a backup file is made from ────────────

  /** Every area as it stands in this session, wrapped the way it is stored. */
  snapshot() {
    const areas = {};
    for (const name of STORE_AREAS) {
      if (this.cache[name] === undefined) continue;
      areas[name] = { payload: this.cache[name], updated: this.stamps[name] ?? 0, version: STORE_VERSION };
    }
    return areas;
  },

  /**
   * Replace what is stored with these areas — ALL OF THEM OR NONE.
   *
   * A restore that stopped halfway would leave last month's games beside this
   * month's drills, and nothing on any screen would say so. In the large
   * database every area goes in under one transaction, together with a copy of
   * what was there before, so either the whole restore is on the disk or none
   * of it is — and the copy is what "Undo" puts back. The small store has
   * neither the room for that copy nor a transaction to give, so there each
   * area is written in turn and put back by hand if a later one fails.
   *
   * AND EVERYTHING IS REPLACED. An area the file does not hold is emptied,
   * not left as it was beside a history it does not belong to. It is stored
   * as an empty document with today's date rather than removed, so that an
   * older copy of it kept elsewhere stays the older one.
   *
   * `areas` maps a name to { payload, version }; anything not in STORE_AREAS
   * is ignored. Resolves { ok, undo } — `undo` saying whether a copy of what
   * was here has been kept — or { ok: false, why }.
   */
  async replaceWith(areas, { keepUndo = true } = {}) {
    if (this.mode === 'none') return { ok: false, why: 'unopened' };
    // Newer than anything here, whatever the clock says.
    const now = Math.max(Date.now(), ...STORE_AREAS.map((name) => (this.stamps[name] ?? 0) + 1));
    const incoming = {};
    let held = 0;
    for (const name of STORE_AREAS) {
      const doc = this.unwrap(areas?.[name]);
      if (doc) held += 1;
      const payload = !doc ? null : (doc.version < STORE_VERSION ? this.migrate(name, doc.payload, doc.version) : doc.payload);
      incoming[name] = { payload: payload ?? null, updated: now, version: STORE_VERSION };
    }
    const names = Object.keys(incoming);
    if (!held) return { ok: false, why: 'empty' };

    let undo = false;
    try {
      if (this.mode === 'large') {
        const before = keepUndo ? JSON.stringify({ at: now, areas: this.snapshot() }) : null;
        await localDbWork(this.local, 'readwrite', (table) => {
          if (before) table.put(before, '__undo'); else table.delete('__undo');
          let last = null;
          for (const name of names) last = table.put(JSON.stringify(incoming[name]), name);
          return last;
        }, { strict: true });
        undo = Boolean(before);
        for (const name of names) this.dropSmall(name);
      } else {
        const was = {};
        try {
          for (const name of names) {
            was[name] = localStorage.getItem(this.key(name));
            localStorage.setItem(this.key(name), JSON.stringify(incoming[name]));
          }
        } catch (e) {
          // Put back whatever had already been replaced, as it was.
          for (const [name, raw] of Object.entries(was)) {
            try {
              if (raw === null) localStorage.removeItem(this.key(name)); else localStorage.setItem(this.key(name), raw);
            } catch { /* nothing more can be done from here */ }
          }
          throw e;
        }
      }
    } catch (e) {
      return { ok: false, why: e?.name === 'QuotaExceededError' ? 'full' : 'failed' };
    }

    for (const name of names) {
      // An emptied area is left out of the cache, so that whoever asks for it
      // next is given their own idea of empty.
      if (incoming[name].payload === null) delete this.cache[name]; else this.cache[name] = incoming[name].payload;
      this.stamps[name] = now;
      this.settle(name, true);
    }
    // Whatever the device had removed, this is what is here now.
    this.found();
    // And to the account's store, where there is one: the restored copies
    // carry today's date, so they are the newer ones there too.
    if (this.db) {
      for (const name of names) {
        try {
          await this.db.doc(`state/${name}`).set(incoming[name]);
          this.markDirty(name, false);
        } catch {
          this.markDirty(name, true);
        }
      }
    }
    return { ok: true, undo };
  },

  /** What a restore replaced, if it is still being kept: { at, areas } or null. */
  async undoCopy() {
    if (this.mode !== 'large') return null;
    try {
      const raw = await localDbWork(this.local, 'readonly', (table) => table.get('__undo'));
      const copy = typeof raw === 'string' ? JSON.parse(raw) : null;
      return copy && typeof copy === 'object' && copy.areas ? copy : null;
    } catch {
      return null;
    }
  },

  /** Put back what the last restore replaced, and stop keeping it. */
  async undoReplace() {
    const copy = await this.undoCopy();
    if (!copy) return { ok: false, why: 'nothing' };
    return this.replaceWith(copy.areas, { keepUndo: false });
  },

  /** Stop keeping what the last restore replaced. */
  async forgetUndo() {
    if (this.mode !== 'large') return;
    try { await localDbWork(this.local, 'readwrite', (table) => table.delete('__undo')); } catch { /* it stays, and is offered again */ }
  },
};

// ── spaced repetition ──────────────────────────────────────────────────────
//
// SM-2, with the two corrections the sibling app needed. Ease RISES on a
// success as well as falling on a failure — otherwise it is a one-way ratchet
// downwards and every long-lived card drifts to the floor. And a due date gets
// a little jitter, because cards created together otherwise come due together
// forever.
const SRS = {
  fresh() {
    return { interval: 0, ease: 2.5, due: 0, lapses: 0, seen: 0 };
  },

  /**
   * A card with every field a finite number, whatever it was given: a missing
   * card, a row from an older version without an ease, a NaN from a previous
   * bad write. Arithmetic on undefined produced a card due on day NaN, which
   * is never — the drill vanished with "the next comes back later".
   */
  normalise(card) {
    const base = SRS.fresh();
    const src = card && typeof card === 'object' ? card : {};
    const num = (value, fallback) => (Number.isFinite(value) ? value : fallback);
    return {
      ...src,
      interval: Math.max(0, num(src.interval, base.interval)),
      ease: Math.min(2.5, Math.max(1.3, num(src.ease, base.ease))),
      due: num(src.due, base.due),
      lapses: Math.max(0, num(src.lapses, base.lapses)),
      seen: Math.max(0, num(src.seen, base.seen)),
    };
  },

  review(card, correct) {
    const next = { ...SRS.normalise(card) };
    next.seen += 1;

    if (!correct) {
      next.interval = 1;
      next.ease = Math.max(1.3, Math.round((next.ease - 0.2) * 100) / 100);
      next.lapses += 1;
    } else {
      next.interval = next.interval === 0 ? 1 : (next.interval === 1 ? 6 : Math.round(next.interval * next.ease));
      next.ease = Math.min(2.5, Math.round((next.ease + 0.1) * 100) / 100);
    }

    const fuzz = next.interval > 6 ? Math.round((next.interval * 0.05)) : 0;
    const offset = fuzz > 0 ? (Math.floor(Math.random() * (2 * fuzz + 1)) - fuzz) : 0;
    const days = Math.max(1, next.interval + offset);

    const due = new Date();
    due.setHours(0, 0, 0, 0);
    due.setDate(due.getDate() + days);
    next.due = due.getTime();

    return next;
  },

  isDue(card) {
    if (!card || typeof card !== 'object') return true;
    if (!Number.isFinite(card.seen) || card.seen === 0) return true;
    // A due date that is not a number is not "never": it is a card that was
    // written badly, and the only safe reading is that it is owed now.
    if (!Number.isFinite(card.due)) return true;
    return card.due <= Date.now();
  },
};
