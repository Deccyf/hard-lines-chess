// ── one session a day, and how many days running ───────────────────────────
//
// Today is a list: drills due, puzzles due, an opening to run through, ten
// puzzles for your weak spots. Each row is a different screen, and working
// down the list means choosing four times. A session is the same work as one
// thing with a beginning and an end: a few of your own mistakes, a few chances
// from your own games, puzzles for what your games go wrong in, and one
// opening line from memory — in that order, without asking what is next.
//
// A SESSION IS SHORT ON PURPOSE. About a dozen positions and one line. What
// is due beyond that is still on Today, underneath; the session is the part
// that is done every day, and a part that takes forty minutes is not.
//
// A DAY COUNTS WHEN THE SESSION IS SEEN THROUGH, and the days are counted:
// "six days running" is the only thing here that is about tomorrow rather
// than today. A day on which there was nothing at all to do is neither
// counted nor held against the run. A day that was simply missed ends it.
//
// Nothing in this file touches the page. tests/daily.test.mjs holds it to
// what it says.

/** How many positions a session asks, across its parts. */
const SESSION_POSITIONS = 12;
/** Of those, at most this many of your own mistakes, and of chances from your own games. */
const SESSION_DRILLS = 4;
const SESSION_PUZZLES = 3;
/** The weak-spot puzzles are never fewer than this when there is a pack. */
const SESSION_WEAK_LEAST = 5;
/** How many days of sessions are kept. */
const DAILY_KEEP_DAYS = 400;

/** A day as the calendar on this device has it: 2026-11-14. */
function dayKey(at = Date.now()) {
  const d = new Date(at);
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** The day before a day, by the calendar: clocks going forward or back do not make it two days or none. */
function dayBefore(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1, 12).getTime());
}

/** The stored area as it starts, and with anything an older copy lacks filled in. */
function dailyData(stored) {
  const src = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  const days = {};
  if (src.days && typeof src.days === 'object' && !Array.isArray(src.days)) {
    for (const [key, day] of Object.entries(src.days)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && day && typeof day === 'object') days[key] = day;
    }
  }
  return {
    ...src,
    days,
    best: Number.isFinite(src.best) && src.best > 0 ? Math.floor(src.best) : 0,
  };
}

/** What a day is marked as: a session finished, nothing to do, or neither. */
function dayMark(days, key) {
  return days?.[key]?.done ? 'done' : (days?.[key]?.rest ? 'rest' : 'open');
}

/** The last day at or before this one that was not a day of nothing to do. */
function lastWorkingDay(days, key) {
  for (let i = 0; i < DAILY_KEEP_DAYS + 1 && dayMark(days, key) === 'rest'; i++) key = dayBefore(key);
  return key;
}

/** The run that ends on a finished day, counted back day by day. */
function runEndingOn(days, key) {
  let run = 0;
  for (let i = 0; i < DAILY_KEEP_DAYS + 1; i++) {
    const mark = dayMark(days, key);
    if (mark === 'open') break;
    if (mark === 'done') {
      // A day that knows how long the run was when it was marked settles it.
      if (Number.isFinite(days[key].run)) return run + days[key].run;
      run++;
    }
    key = dayBefore(key);
  }
  return run;
}

/**
 * How many days running, as of a moment.
 *
 *   run     the days in a row a session was finished, ending today if today's
 *           is done and yesterday if it is not — a run is not lost at
 *           midnight, it is lost by a day going past
 *   today   'done' | 'rest' | 'open'
 *   atRisk  there is a run, and today's session is what keeps it
 *
 * A day marked as having had nothing to do is stepped over: it adds nothing
 * and ends nothing.
 */
function dailyRun(days, now = Date.now()) {
  const todayKey = dayKey(now);
  const today = dayMark(days, todayKey);
  const end = lastWorkingDay(days, today === 'done' ? todayKey : dayBefore(todayKey));
  const run = dayMark(days, end) === 'done' ? runEndingOn(days, end) : 0;
  return { run, today, atRisk: today !== 'done' && run > 0 };
}

/** The longest run there has been, among the days that are kept. */
function dailyBest(days) {
  let best = 0;
  for (const key of Object.keys(days ?? {})) {
    if (days[key]?.done) best = Math.max(best, runEndingOn(days, key));
  }
  return best;
}

/**
 * Write a day in, and let go of days older than are kept.
 *
 * A FINISHED DAY IS TOLD HOW LONG THE RUN IS, counted as it is marked. Only so
 * many days are kept, and a run longer than that would otherwise be counted
 * back as far as the oldest day kept and no further.
 */
function markDay(data, key, day) {
  data.days[key] = day;
  if (day?.done) {
    day.run = 1 + (() => {
      const before = lastWorkingDay(data.days, dayBefore(key));
      return dayMark(data.days, before) === 'done' ? runEndingOn(data.days, before) : 0;
    })();
    data.best = Math.max(data.best ?? 0, day.run);
  }
  const keys = Object.keys(data.days).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - DAILY_KEEP_DAYS))) delete data.days[old];
  return data;
}

/**
 * Lay out today's session from what there is to do.
 *
 *   drills    how many of your own mistakes are due
 *   puzzles   how many chances from your own games are due
 *   weak      whether there is a pack of puzzles to choose from
 *   opening   the id of an opening line that is due and has been met before,
 *             or null
 *
 * Your own mistakes come first and are never crowded out; the weak-spot
 * puzzles make the session up to its size, and with no pack the first two
 * may take the room instead. Returns the parts in the order they are done —
 * an empty list when there is nothing at all.
 *
 * @returns {Array<{ kind: 'drills'|'puzzles'|'weak'|'opening', want: number, id?: string }>}
 */
function planDailySession({ drills = 0, puzzles = 0, weak = false, opening = null } = {}) {
  const parts = [];
  let d = Math.min(drills, SESSION_DRILLS);
  let p = Math.min(puzzles, SESSION_PUZZLES);
  let w = 0;
  if (weak) {
    w = Math.max(SESSION_WEAK_LEAST, SESSION_POSITIONS - d - p);
  } else {
    // No pack: what would have been its room goes to what is due, mistakes first.
    d = Math.min(drills, SESSION_POSITIONS - p);
    p = Math.min(puzzles, SESSION_POSITIONS - d);
  }
  if (d > 0) parts.push({ kind: 'drills', want: d });
  if (p > 0) parts.push({ kind: 'puzzles', want: p });
  if (w > 0) parts.push({ kind: 'weak', want: w });
  if (opening) parts.push({ kind: 'opening', want: 1, id: opening });
  return parts;
}
