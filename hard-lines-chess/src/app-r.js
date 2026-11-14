// ── today's session: the screen ────────────────────────────────────────────
//
// src/daily.js lays a session out and counts the days. This takes one across
// the screens that already do the work: Drills asks your own mistakes,
// Puzzles your own chances, Weak spots the puzzles aimed at what goes wrong,
// Openings a line from memory. The session does not ask anything itself. It
// says which screen is next, how far through you are, and when it is over.
//
// EACH SCREEN KEEPS ITS OWN RULES. A drill answered in a session is scheduled
// exactly as one answered from the Drills tab, a puzzle solved moves your
// level the same way, and everything is saved by the screen that asked it,
// when it is answered. So a session abandoned half way loses nothing that was
// done; it simply is not a finished session.
//
// THE BAR ACROSS THE TOP IS THE SESSION. It is there on every screen while
// one is under way — which part, how many of how many — with the way out, and
// the way back if you have wandered off to look at something.

const Session = {
  running: false,
  parts: [],        // the plan, each part gaining { n, ok } as it is answered
  at: -1,
  waiting: false,   // the part on screen is finished and is waiting to be left
};

/** Which screen does each part. */
const SESSION_SCREEN = { drills: 'drills', puzzles: 'puzzles', weak: 'weak', opening: 'openings' };

/** A part, as the list of what is in a session says it. */
const SESSION_PART_WORDS = {
  drills: (n) => `${n} of your own ${n === 1 ? 'mistake' : 'mistakes'}`,
  puzzles: (n) => `${n} ${n === 1 ? 'chance' : 'chances'} from your own games`,
  weak: (n) => `${n} ${n === 1 ? 'puzzle' : 'puzzles'} for your weak spots`,
  opening: () => 'one opening line from memory',
};

/** A part, as the bar names the one you are in. */
const SESSION_PART_NAME = {
  drills: 'your own mistakes',
  puzzles: 'chances from your own games',
  weak: 'puzzles for your weak spots',
  opening: 'an opening line from memory',
};

/** "a", "a and b", "a, b and c". */
function listWords(items) {
  if (items.length < 2) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const daysWords = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;

/**
 * The opening line a session asks for: one that is due and has been met
 * before — walked through, or tested — the longest overdue first. A line
 * never looked at is not something to be asked from memory.
 */
function sessionOpening() {
  const met = OPENINGS
    .map((o) => ({ opening: o, card: App.openings.cards[o.id] }))
    .filter(({ card }) => card && (card.seen > 0 || card.learned) && SRS.isDue(card));
  met.sort((a, b) => (a.card.due ?? 0) - (b.card.due ?? 0));
  return met[0]?.opening ?? null;
}

/** Today's session, laid out from what there is to do right now. */
function sessionPlanNow() {
  return planDailySession({
    drills: dueDrills().length,
    puzzles: duePuzzles().length,
    weak: Boolean(Weak.about),
    opening: sessionOpening()?.id ?? null,
  });
}

const sessionPart = () => (Session.running ? Session.parts[Session.at] ?? null : null);
/** Whether a session is under way and this is the part it is on. */
const sessionIs = (kind) => sessionPart()?.kind === kind;

function startSession() {
  if (Session.running) { backToSession(); return; }
  const parts = sessionPlanNow().map((p) => ({ ...p, n: 0, ok: 0 }));
  if (!parts.length) { renderToday(); return; }
  Session.running = true;
  Session.parts = parts;
  Session.at = -1;
  advanceSession();
}

/** On to the next part, or the end. */
function advanceSession() {
  if (!Session.running) return;
  Session.waiting = false;
  Session.at += 1;
  const part = Session.parts[Session.at];
  if (!part) { finishSession(); return; }
  openSessionPart(part);
}

/** Put a part on the screen that does it. A part with nothing left to ask is passed over. */
function openSessionPart(part) {
  show(SESSION_SCREEN[part.kind]);
  if (part.kind === 'drills') {
    Drill.current = null;
    startDrill();
    if (!Drill.current) { advanceSession(); return; }
  } else if (part.kind === 'puzzles') {
    Puzzles.current = null;
    startPuzzle();
    if (!Puzzles.current) { advanceSession(); return; }
  } else if (part.kind === 'weak') {
    // If the puzzles cannot be fetched, the Weak spots screen says why, and
    // the bar's "Skip this part" is the way on.
    if (Weak.current) stopWeakSet();
    startWeakSet({ size: part.want - part.n });
  } else if (part.kind === 'opening') {
    const opening = OPENINGS.find((o) => o.id === part.id);
    if (!opening) { advanceSession(); return; }
    if (Openings.current) closeOpening();
    startOpening(opening, 'drill');
  }
  renderSessionBar();
}

/** A screen says a question of this kind was answered, and whether rightly. */
function sessionAnswered(kind, ok) {
  const part = sessionPart();
  if (!part || part.kind !== kind) return;
  part.n += 1;
  if (ok) part.ok += 1;
  // A line from memory is one question; when it is over the part is, and the
  // result stays up until it is left.
  if (kind === 'opening') Session.waiting = true;
  renderSessionBar();
}

/**
 * A screen asks, as its "Next" is pressed: has the session had what it wanted
 * from here? `left` is how many more this screen could still ask. True means
 * the session has moved on and the screen should ask nothing more.
 */
function sessionPartOver(kind, left) {
  const part = sessionPart();
  if (!part || part.kind !== kind) return false;
  if (part.n < part.want && left > 0) return false;
  advanceSession();
  return true;
}

/** Leave the part that is on the screen, the way it would be left by hand. */
function leaveSessionPart(part) {
  if (part?.kind === 'weak' && Weak.current) stopWeakSet();
  if (part?.kind === 'opening' && Openings.current) closeOpening();
  if (part?.kind === 'drills') Drill.current = null;
  if (part?.kind === 'puzzles') Puzzles.current = null;
}

/** On from a part that is finished and has been left up to be read — the opening line. */
function leaveFinishedPart() {
  if (!Session.running) return;
  leaveSessionPart(sessionPart());
  advanceSession();
}

function skipSessionPart() {
  if (!Session.running) return;
  leaveSessionPart(sessionPart());
  advanceSession();
}

/** Leave the session. What was answered stays answered; the day is not counted. */
function stopSession() {
  if (!Session.running) return;
  const part = sessionPart();
  Session.running = false;
  Session.waiting = false;
  leaveSessionPart(part);
  renderSessionBar();
  show('today');
}

/** Back to the screen the session is on, from wherever. */
function backToSession() {
  const part = sessionPart();
  if (!part) return;
  const section = SESSION_SCREEN[part.kind];
  const idle = (part.kind === 'drills' && !Drill.current) || (part.kind === 'puzzles' && !Puzzles.current)
    || (part.kind === 'weak' && !Weak.current) || (part.kind === 'opening' && !Openings.current && !Session.waiting);
  if (idle) openSessionPart(part); else { show(section); renderSessionBar(); }
}

/**
 * The end. The day counts if anything at all was answered: a session skipped
 * from end to end is not a session.
 */
async function finishSession() {
  Session.running = false;
  Session.waiting = false;
  const answered = Session.parts.reduce((n, p) => n + p.n, 0);
  if (answered > 0) {
    markDay(App.daily, dayKey(), {
      done: true,
      at: Date.now(),
      parts: Session.parts.map(({ kind, n, ok, want }) => ({ kind, n, ok, want })),
    });
    await Store.set('daily', App.daily);
    tellReminder();
  }
  renderSessionBar();
  show('today');
}

// ── the bar ────────────────────────────────────────────────────────────────

function renderSessionBar() {
  const bar = $('sessionBar');
  if (!bar) return;
  const part = sessionPart();
  bar.hidden = !part;
  if (!part) return;
  const here = App.section === SESSION_SCREEN[part.kind];
  const count = part.kind === 'opening' ? '' : ` · ${Math.min(part.n, part.want)} of ${part.want}`;
  const name = SESSION_PART_NAME[part.kind];
  $('sessionWhere').textContent = `Today's session · part ${Session.at + 1} of ${Session.parts.length}`;
  $('sessionPart').textContent = `${name.charAt(0).toUpperCase()}${name.slice(1)}${count}`;
  const last = Session.at === Session.parts.length - 1;
  $('sessionNext').hidden = !(here && Session.waiting);
  $('sessionNext').textContent = last ? 'Finish' : 'Next part';
  $('sessionBack').hidden = here;
  $('sessionSkip').hidden = !here || Session.waiting;
  // The last part's skip ends the session, and says so to anything that reads it out.
  $('sessionSkip').setAttribute('aria-label', last ? 'Skip this part and finish the session' : 'Skip this part of the session');
}

// ── the card on Today ──────────────────────────────────────────────────────

/** What a finished session did, in words. */
function sessionDoneWords(parts) {
  const said = [];
  for (const p of parts ?? []) {
    if (!p.n) continue;
    if (p.kind === 'drills') said.push(`${p.ok} of ${p.n} of your own mistakes put right`);
    if (p.kind === 'puzzles') said.push(`${p.ok} of ${p.n} ${p.n === 1 ? 'chance' : 'chances'} from your own games taken`);
    if (p.kind === 'weak') said.push(`${p.ok} of ${p.n} weak-spot puzzles solved`);
    if (p.kind === 'opening') said.push(p.ok ? 'an opening line from memory without a prompt' : 'an opening line from memory, with prompts');
  }
  return said.length ? `${listWords(said).replace(/^./, (c) => c.toUpperCase())}.` : '';
}

function renderSessionCard() {
  const card = $('sessionCard');
  if (!card) return;
  card.innerHTML = '';
  const plan = sessionPlanNow();
  // Whether there are puzzles beside the page is still being found out, and
  // they are most of a session: nothing is said about today until it is known.
  if (!plan.length && Weak.about === undefined && !Session.running) { card.hidden = true; return; }
  // A day marked as having nothing to do, on which something has since turned
  // up — new games came in — is an ordinary day again.
  if (plan.length && App.daily.days[dayKey()]?.rest) {
    delete App.daily.days[dayKey()];
    Store.set('daily', App.daily);
  }
  const state = dailyRun(App.daily.days);
  const best = App.daily.best ?? 0;
  const today = App.daily.days[dayKey()];
  const button = (label, primary, go) => {
    const b = el('button', primary ? 'btn primary' : 'btn', label);
    b.type = 'button';
    b.id = 'sessionStart';
    b.addEventListener('click', go);
    const row = el('div', 'row');
    row.style.marginTop = '10px';
    row.appendChild(b);
    return row;
  };
  card.hidden = false;

  if (Session.running) {
    card.appendChild(el('h3', null, 'Today\'s session'));
    card.appendChild(el('p', 'note', `Under way: part ${Session.at + 1} of ${Session.parts.length}, ${SESSION_PART_NAME[sessionPart().kind]}.`));
    card.appendChild(button('Back to it', true, backToSession));
    return;
  }

  if (state.today === 'done') {
    card.appendChild(el('h3', null, 'Done for today'));
    const run = el('p', 'session-run', `${daysWords(state.run)} running.`);
    card.appendChild(run);
    const did = sessionDoneWords(today?.parts);
    if (did) card.appendChild(el('p', 'note', did));
    if (best > state.run) card.appendChild(el('p', 'note', `Your longest run is ${daysWords(best)}.`));
    if (plan.length) card.appendChild(button('Another session', false, startSession));
    renderReminder(card);
    return;
  }

  if (!plan.length) {
    // Nothing to do is said — and where there is a run of days, the day is
    // marked so that it does not end it.
    //
    // ONLY WHERE THERE IS A RUN. The mark exists to carry a run across a quiet
    // day, and with no run there is nothing for it to carry: writing one
    // anyway would mean that merely opening the app changed what is stored,
    // on every quiet day, for nothing.
    card.appendChild(el('h3', null, 'Today\'s session'));
    card.appendChild(el('p', 'note', state.run
      ? `Nothing is due today, so there is no session. A day like this does not end a run: it stands at ${daysWords(state.run)}.`
      : 'Nothing is due today, so there is no session. Play a game or analyse one, and tomorrow there will be.'));
    if (state.run > 0 && state.today !== 'rest') {
      markDay(App.daily, dayKey(), { rest: true });
      Store.set('daily', App.daily);
    }
    renderReminder(card);
    return;
  }

  card.appendChild(el('h3', null, 'Today\'s session'));
  card.appendChild(el('p', 'note', `${listWords(plan.map((p) => SESSION_PART_WORDS[p.kind](p.want))).replace(/^./, (c) => c.toUpperCase())}, one after another.`));
  const run = state.run
    ? `${daysWords(state.run)} running. Today's makes it ${state.run + 1}.`
    : (best ? `Your longest run is ${daysWords(best)}. Today starts a new one.` : 'Finish one every day and the days are counted.');
  card.appendChild(el('p', 'session-run', run));
  card.appendChild(button('Start', true, startSession));
  renderReminder(card);
}

// ── the reminder, in the Android app ───────────────────────────────────────
//
// A page cannot remind anybody of anything once it is closed, so the reminder
// is the Android app's: it keeps the time, sets the alarm and shows the
// notification (Reminder.java). The page's part is the switch, and telling
// the app when a session has been done — which is how the reminder knows to
// say nothing that day. In a browser there is no app to ask, and no switch.

/** The Android app's reminder, where the page is running inside an app that has one. */
function reminderBridge() {
  const bridge = typeof window !== 'undefined' ? window.HardLinesAndroid : null;
  return bridge && typeof bridge.setReminder === 'function' ? bridge : null;
}

/** How the reminder stands, as the app tells it: { on, hour, minute, allowed } — or null. */
function reminderState() {
  const bridge = reminderBridge();
  if (!bridge) return null;
  try {
    const state = JSON.parse(bridge.reminder());
    return state && typeof state.on === 'boolean' && Number.isInteger(state.hour) && Number.isInteger(state.minute) ? state : null;
  } catch {
    return null;
  }
}

const clockWords = (hour, minute) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

/** Tell the app which day a session was last finished on, and the run then: it is what the reminder goes by. */
function tellReminder() {
  const bridge = reminderBridge();
  if (!bridge) return;
  const last = Object.keys(App.daily.days).filter((key) => App.daily.days[key]?.done).sort().pop() ?? '';
  try { bridge.sessionDone(last, dailyRun(App.daily.days).run); } catch { /* nothing to be done about it from here */ }
}

function renderReminder(card) {
  const bridge = reminderBridge();
  const state = reminderState();
  if (!bridge || !state) return;
  const box = el('details', 'more');
  box.id = 'reminderBox';
  box.open = Session.reminderOpen === true;
  box.addEventListener('toggle', () => { Session.reminderOpen = box.open; });
  const at = clockWords(state.hour, state.minute);
  box.appendChild(el('summary', null, state.on ? `Reminder: on, at ${at}` : 'Reminder: off'));

  const row = el('div', 'row');
  const time = document.createElement('input');
  time.type = 'time';
  time.id = 'reminderTime';
  time.value = at;
  time.setAttribute('aria-label', 'When to be reminded');
  const toggle = el('button', 'btn', state.on ? 'Turn it off' : 'Turn it on');
  toggle.type = 'button';
  toggle.id = 'reminderToggle';
  const set = (on) => {
    const [hour, minute] = (time.value || at).split(':').map(Number);
    Session.reminderOpen = true;
    bridge.setReminder(on, Number.isInteger(hour) ? hour : state.hour, Number.isInteger(minute) ? minute : state.minute);
  };
  toggle.addEventListener('click', () => set(!state.on));
  // Changing the time of a reminder that is on moves it; of one that is off, it waits for the switch.
  time.addEventListener('change', () => { if (state.on) set(true); });
  row.appendChild(time);
  row.appendChild(toggle);
  box.appendChild(row);

  const say = !state.on
    ? 'Turned on, the phone reminds you once a day, about this time, that the session has not been done — and says nothing on a day when it has.'
    : (state.allowed
      ? `The phone reminds you at ${at} or a few minutes after, on any day the session has not been done by then.`
      : 'It is on, but this phone is not letting the app show notifications, so nothing will appear. Allow them for Hard Lines in the phone\'s settings, under Apps.');
  const note = el('p', state.on && !state.allowed ? 'note bad-note' : 'note', say);
  note.id = 'reminderNote';
  box.appendChild(note);
  card.appendChild(box);
}

/** The app says the reminder has changed — it was set, or the phone answered the question about notifications. */
window.hardLinesReminderChanged = () => { if (App.section === 'today') renderToday(); };
