// One session a day, and how many days running: the counting and the laying
// out, held to their rules.
//
// A RUN OF DAYS IS A CLAIM ABOUT THE CALENDAR, and the calendar is where this
// goes wrong: midnight, a month's end, a year's end, the night the clocks
// change, a day on which there was nothing to do. Every one of those is a case
// here, with the moment written out, because "six days running" on a screen
// is either true or it is a number.
import { readFileSync } from 'node:fs';

// THE CALENDAR IS THE DEVICE'S OWN, so this is run somewhere that is not
// Greenwich — thirteen hours ahead of it, with clocks that change twice a
// year. On a machine keeping Greenwich time, a day cut by the wrong clock
// gives the right answer to every question here, and the test proves nothing.
process.env.TZ = 'Pacific/Auckland';

const src = readFileSync(new URL('../src/daily.js', import.meta.url), 'utf8');
const S = new Function(src + '; return { SESSION_POSITIONS, SESSION_DRILLS, SESSION_PUZZLES, SESSION_WEAK_LEAST, DAILY_KEEP_DAYS,'
  + ' dayKey, dayBefore, dailyData, dailyRun, dailyBest, markDay, planDailySession };')();
// A fresh one each time: marking a day writes on it.
const finished = () => ({ done: true });

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL', name, extra); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const done = { done: true };
const rest = { rest: true };

// ── a day, by the calendar ────────────────────────────────────────────────
same('a day is written year, month, day', S.dayKey(at(2026, 11, 4)), '2026-11-04');
same('a minute before midnight is still that day', S.dayKey(at(2026, 11, 4, 23, 59)), '2026-11-04');
same('and midnight is the next', S.dayKey(at(2026, 11, 5, 0, 0)), '2026-11-05');
same('the day before the first of a month', S.dayBefore('2026-03-01'), '2026-02-28');
same('and of a leap year\'s March', S.dayBefore('2028-03-01'), '2028-02-29');
same('and of a year', S.dayBefore('2027-01-01'), '2026-12-31');
// Every day of two years has exactly one day before it, and they chain: this
// is the walk the run is counted by, across both clock changes of each year.
{
  let key = '2027-12-31';
  let steps = 0;
  const seen = new Set([key]);
  while (key !== '2026-01-01' && steps < 800) { key = S.dayBefore(key); seen.add(key); steps++; }
  same('walking back day by day across two years takes one step a day', [steps, seen.size], [729, 730]);
}

// ── how many days running ─────────────────────────────────────────────────
const now = at(2026, 11, 14, 9);
same('nothing done is no run', S.dailyRun({}, now), { run: 0, today: 'open', atRisk: false });
same('today done is a run of one', S.dailyRun({ '2026-11-14': done }, now), { run: 1, today: 'done', atRisk: false });
same('yesterday done and today not yet: the run stands, and today keeps it',
  S.dailyRun({ '2026-11-13': done, '2026-11-12': done }, now), { run: 2, today: 'open', atRisk: true });
same('today done on top of it',
  S.dailyRun({ '2026-11-14': done, '2026-11-13': done, '2026-11-12': done }, now), { run: 3, today: 'done', atRisk: false });
same('a day missed ends it',
  S.dailyRun({ '2026-11-14': done, '2026-11-12': done, '2026-11-11': done }, now), { run: 1, today: 'done', atRisk: false });
same('missed yesterday, nothing today: there is no run to keep',
  S.dailyRun({ '2026-11-12': done, '2026-11-11': done }, now), { run: 0, today: 'open', atRisk: false });
same('a day with nothing to do is stepped over: it neither counts nor ends the run',
  S.dailyRun({ '2026-11-14': done, '2026-11-13': rest, '2026-11-12': done }, now), { run: 2, today: 'done', atRisk: false });
same('today with nothing to do leaves the run where it was',
  S.dailyRun({ '2026-11-14': rest, '2026-11-13': done }, now), { run: 1, today: 'rest', atRisk: true });
same('days of nothing alone are not a run', S.dailyRun({ '2026-11-14': rest, '2026-11-13': rest }, now), { run: 0, today: 'rest', atRisk: false });
same('a run goes across the end of a month and of a year',
  S.dailyRun({ '2027-01-02': done, '2027-01-01': done, '2026-12-31': done, '2026-12-30': done }, at(2027, 1, 2, 20)).run, 4);
same('the same days, asked a minute after midnight, are still a run — today\'s is simply not done yet',
  S.dailyRun({ '2026-11-13': done, '2026-11-12': done }, at(2026, 11, 14, 0, 1)), { run: 2, today: 'open', atRisk: true });
same('and two midnights later it is gone', S.dailyRun({ '2026-11-13': done, '2026-11-12': done }, at(2026, 11, 15, 0, 1)).run, 0);
same('a day stored as something else is a day not done', S.dailyRun({ '2026-11-14': { done: false }, '2026-11-13': done }, now).run, 1);
same('no days at all is no run', S.dailyRun(undefined, now).run, 0);

// ── the longest there has been ────────────────────────────────────────────
same('the best run is the longest stretch, wherever it was',
  S.dailyBest({ '2026-10-01': done, '2026-10-02': done, '2026-10-03': done, '2026-10-05': done, '2026-10-06': done }), 3);
same('a day of nothing inside a stretch does not break it or add to it',
  S.dailyBest({ '2026-10-01': done, '2026-10-02': rest, '2026-10-03': done, '2026-10-04': done }), 3);
same('no days, no best', S.dailyBest({}), 0);
{
  const data = S.dailyData(null);
  S.markDay(data, '2026-11-12', finished());
  S.markDay(data, '2026-11-13', finished());
  same('marking days keeps the best up to date', data.best, 2);
  same('and each finished day knows how long the run was', [data.days['2026-11-12'].run, data.days['2026-11-13'].run], [1, 2]);
  S.markDay(data, '2026-11-14', { rest: true });
  S.markDay(data, '2026-11-15', finished());
  same('a day of nothing between two finished ones carries the run across', [data.days['2026-11-15'].run, data.best], [3, 3]);
  S.markDay(data, '2026-11-20', finished());
  same('and a later, shorter run does not lower the best', [data.best, S.dailyRun(data.days, at(2026, 11, 20)).run], [3, 1]);
}
{
  // Five hundred days in a row, one after another, the way they happen.
  const data = S.dailyData(null);
  const first = at(2026, 1, 1);
  for (let i = 0; i < 500; i++) S.markDay(data, S.dayKey(first + i * 86400000), finished());
  same('no more days are kept than are counted back over', Object.keys(data.days).length, S.DAILY_KEEP_DAYS);
  same('and the ones let go are the oldest', Object.keys(data.days).sort()[0], S.dayKey(first + 100 * 86400000));
  same('the best survives the days it was made of being let go', data.best, 500);
  same('and so does the run itself, which is longer than the days kept', S.dailyRun(data.days, first + 499 * 86400000).run, 500);
  same('the day after, with today\'s not done, it still stands', S.dailyRun(data.days, first + 500 * 86400000), { run: 500, today: 'open', atRisk: true });
}

// ── what is stored ────────────────────────────────────────────────────────
same('with nothing stored, it starts', S.dailyData(null), { days: {}, best: 0 });
same('what is stored is kept, and what is not a day is dropped',
  S.dailyData({ days: { '2026-11-14': done, nonsense: done, '2026-11-13': null }, best: 4 }), { days: { '2026-11-14': done }, best: 4 });
same('something stored that is not this at all starts again', [S.dailyData('yes'), S.dailyData([1, 2]), S.dailyData({ days: 7, best: 'lots' })],
  [{ days: {}, best: 0 }, { days: {}, best: 0 }, { days: {}, best: 0 }]);

// ── today's session, laid out ─────────────────────────────────────────────
const shape = (parts) => parts.map((p) => `${p.kind} ${p.want}${p.id ? ` ${p.id}` : ''}`).join(', ');
same('with nothing to do there is no session', S.planDailySession({}), []);
same('plenty of everything: four mistakes, three chances, weak spots to make twelve, and a line',
  shape(S.planDailySession({ drills: 30, puzzles: 30, weak: true, opening: 'italian' })), 'drills 4, puzzles 3, weak 5, opening 1 italian');
same('nothing of your own due: the weak spots are the session',
  shape(S.planDailySession({ weak: true })), 'weak 12');
same('a little of your own due: the weak spots make it up to twelve',
  shape(S.planDailySession({ drills: 1, puzzles: 2, weak: true })), 'drills 1, puzzles 2, weak 9');
same('the parts are in the order they are done',
  S.planDailySession({ drills: 9, puzzles: 9, weak: true, opening: 'x' }).map((p) => p.kind), ['drills', 'puzzles', 'weak', 'opening']);
same('with no pack, what is due takes the room, mistakes first',
  shape(S.planDailySession({ drills: 30, puzzles: 30 })), 'drills 9, puzzles 3');
same('and chances fill what mistakes leave',
  shape(S.planDailySession({ drills: 2, puzzles: 30 })), 'drills 2, puzzles 10');
same('never more than is due', shape(S.planDailySession({ drills: 2, puzzles: 1 })), 'drills 2, puzzles 1');
same('a line on its own is a session', shape(S.planDailySession({ opening: 'caro-kann' })), 'opening 1 caro-kann');
for (const [d, p] of [[0, 0], [1, 0], [4, 3], [50, 50], [3, 9], [9, 1]]) {
  for (const weak of [true, false]) {
    const parts = S.planDailySession({ drills: d, puzzles: p, weak });
    const total = parts.reduce((n, x) => n + x.want, 0);
    const drills = parts.find((x) => x.kind === 'drills')?.want ?? 0;
    const puzzles = parts.find((x) => x.kind === 'puzzles')?.want ?? 0;
    if (total > S.SESSION_POSITIONS || drills > d || puzzles > p || (weak && total !== S.SESSION_POSITIONS)) {
      ok(`a session is never more than twelve positions, nor more of anything than is due (${d}, ${p}, ${weak})`, false, shape(parts));
    }
  }
}
ok('a session is never more than twelve positions, nor more of anything than is due', true);

console.log(`daily: ${pass} checks passed${fail ? `, ${fail} FAILED` : ''}`);
if (fail) process.exit(1);
