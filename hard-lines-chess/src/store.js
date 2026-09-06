// ── where progress lives ───────────────────────────────────────────────────
//
// The page asks the viewer's Claude for a document store, and falls back to
// this browser's own storage when there isn't one. BOTH ARE REAL PATHS: the
// store may be absent because it was never granted, or because the page is
// open somewhere it cannot reach — indistinguishable by design — so the app
// has to work either way rather than treating one as an error.
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
const STORE_VERSION = 2;

const Store = {
  db: null,
  ready: false,
  cache: {},
  // Names whose last db write failed; retried on the next set() or init().
  // Kept in local storage as well, so a reload does not forget the debt.
  dirty: new Set(),

  async init() {
    try {
      this.db = await window.claude?.use?.('db') ?? null;
    } catch {
      this.db = null;
    }
    this.ready = true;
    try {
      const owed = JSON.parse(localStorage.getItem(this.key('__dirty')) ?? '[]');
      for (const name of owed) this.dirty.add(name);
    } catch { /* nothing owed, or storage unreadable */ }
    if (this.db) await this.flushDirty();
    return this.db !== null;
  },

  key(name) {
    return `hardlines:${name}`;
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

    let fromLocal = null;
    try {
      const raw = localStorage.getItem(this.key(name));
      fromLocal = raw ? this.unwrap(JSON.parse(raw)) : null;
    } catch {
      fromLocal = null;
    }

    // THE NEWER COPY WINS, wherever it is. Equal dates (two undated legacy
    // copies, say) keep the old preference for the store.
    let chosen = null;
    if (fromDb && fromLocal) chosen = fromLocal.updated > fromDb.updated ? fromLocal : fromDb;
    else chosen = fromDb ?? fromLocal;

    if (chosen && chosen.payload !== null && chosen.payload !== undefined) {
      const payload = chosen.version < STORE_VERSION ? this.migrate(name, chosen.payload, chosen.version) : chosen.payload;
      this.cache[name] = payload;
      // A migrated or one-sided document is written back so both copies agree
      // and the next load does not migrate again.
      if (chosen.version < STORE_VERSION || (fromDb && fromLocal && fromLocal !== fromDb && fromLocal.updated !== fromDb.updated)) {
        await this.set(name, payload, chosen.updated || Date.now());
      }
      return this.cache[name];
    }

    this.cache[name] = fallback;
    return this.cache[name];
  },

  async set(name, value, updated = Date.now()) {
    this.cache[name] = value;
    const doc = { payload: value, updated, version: STORE_VERSION };

    // Written to both when both exist. The local copy is what makes the page
    // usable the instant it opens, before any round trip; the store is what
    // makes it survive a new device.
    try {
      localStorage.setItem(this.key(name), JSON.stringify(doc));
    } catch { /* private mode, quota, a browser set to block site data */ }

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
      let doc = null;
      try {
        const raw = localStorage.getItem(this.key(name));
        doc = raw ? JSON.parse(raw) : null;
      } catch { doc = null; }
      if (!doc) { this.markDirty(name, false); continue; }
      try {
        await this.db.doc(`state/${name}`).set(doc);
        this.markDirty(name, false);
      } catch { /* still owed */ }
    }
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
