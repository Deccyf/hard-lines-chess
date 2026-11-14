// ── weak spots: the screen ─────────────────────────────────────────────────
//
// src/weak-spots.js does the choosing and the judging. This is the page's
// side: finding the pack, saying what the puzzles are aimed at and why, and
// taking a set of ten across a board.
//
// A SET, NOT A STREAM. Ten puzzles, laid out before the first one: so many
// aimed at each thing your games show, the rest a mix, and up to three you
// missed before and are due to meet again. A set has an end, and what it says
// at the end — seven of ten, and where your level went — is the reason to
// start one.
//
// A MISS IS NOT THE END OF THE PUZZLE. The first wrong move counts it as
// missed, and it will be back tomorrow; but the position stays, and finding
// the move on a second look is worth more than being shown it. The answer is
// there to be asked for.
//
// THE PACK CAN BE MISSING, and then this screen says why in a sentence rather
// than offering a button that does nothing: a copy of the page opened from a
// file has no pack beside it, and a build made without one has none at all.

const Weak = {
  view: null,
  about: undefined,   // what puzzle-pack.json says; null when there is no pack here
  why: null,          // and then why not: 'file' | 'missing' | 'unreachable'
  finding: null,      // the promise every caller shares while that is found out
  pack: null,
  loading: null,
  failed: null,       // why the pack itself would not load
  set: null,          // { slots, at, results, from } while a set is going
  current: null,      // the puzzle on the board
  turn: 0,            // which puzzle a late timer belongs to
  rng: Math.random,
};

/** How long their move is left to be seen before the board answers to you. */
const WEAK_REPLY_MS = 450;

/** What you did, for each name a mistake can have, to follow "you" and be followed by how often. */
const WEAK_MISTAKE_WORDS = {
  hangingPiece: 'left a piece loose',
  fork: 'allowed a fork',
  pin: 'got pinned',
  skewer: 'got skewered',
  discoveredAttack: 'walked into a discovery',
  backRankMate: 'were caught on the back rank',
  trappedPiece: 'let a piece get trapped',
  exposedKing: 'opened up your own king',
  mateIn1: 'allowed mate in one',
  mateIn2: 'allowed mate in two',
  mateIn3: 'allowed mate in three',
  missedMate: 'missed a forced mate',
};

const weakTimes = (n) => (n === 1 ? 'once' : (n === 2 ? 'twice' : `${n} times`));
const weakCapital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Find out whether there is a pack beside this page, once. Resolves with what
 * its description says, or null — and Weak.why then says which kind of null.
 */
function findPuzzlePack() {
  Weak.finding ??= (async () => {
    if (location.protocol === 'file:') { Weak.about = null; Weak.why = 'file'; return null; }
    let response;
    try {
      response = await fetch(new URL(WEAK_PACK_ABOUT, location.href).href);
    } catch {
      // No answer at all. Asked again the next time somebody looks, because
      // "no connection a moment ago" is not "no pack".
      Weak.about = null; Weak.why = 'unreachable'; Weak.finding = null;
      return null;
    }
    let about = null;
    if (response.ok) { try { about = await response.json(); } catch { about = null; } }
    if (!about || about.format !== 1 || !(about.count > 0)) { Weak.about = null; Weak.why = 'missing'; return null; }
    Weak.about = about;
    Weak.why = null;
    return about;
  })();
  return Weak.finding;
}

/** Why there are no puzzles here, in a sentence. */
function weakMissingWords() {
  if (Weak.why === 'file') {
    return 'This copy of the app was opened from a file, and the puzzles are a separate file it cannot read from there. They are in the installed app and in the web version.';
  }
  if (Weak.why === 'unreachable' && !IN_ANDROID_APP) {
    return 'The puzzles could not be fetched just now. They are kept on the device once they have been fetched; open this screen again with a connection.';
  }
  return 'This build of the app was made without the puzzle pack, so there is nothing to choose from here.';
}

/** Fetch and read the pack, once. Rejects with a sentence for the screen. */
function loadPuzzlePack() {
  Weak.loading ??= (async () => {
    const about = await findPuzzlePack();
    if (!about) throw new Error(weakMissingWords());
    let text;
    try {
      const response = await fetch(new URL(WEAK_PACK_FILE, location.href).href);
      if (!response.ok) throw new Error('not there');
      text = await response.text();
    } catch {
      throw new Error('The puzzles could not be fetched just now. Open this screen again with a connection.');
    }
    const pack = parsePuzzlePack(text);
    // The two files are made together and must arrive together. A page that
    // has one from before an update and the other from after it would be
    // choosing from a pack it has been told the wrong things about.
    if (pack.count !== about.count) {
      throw new Error('The puzzles on this device are not the ones their description is for. Close the app completely and open it again.');
    }
    Weak.pack = pack;
    Weak.failed = null;
    return pack;
  })().catch((error) => {
    Weak.loading = null;
    Weak.failed = error.message;
    throw error;
  });
  return Weak.loading;
}

/** What the latest analysed games say to aim at. */
function weakAimsNow() {
  return weakSpotAims(App.reviews.games);
}

/** The aims as a short phrase: "forks and loose pieces", "forks, pins and skewers". */
function weakAimsPhrase(aims, most = 3) {
  const names = aims.slice(0, most).map((a) => PUZZLE_THEME_WORDS[a.theme]?.many ?? a.theme);
  if (!names.length) return '';
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Whether a set has been finished since midnight. */
function weakSetDoneToday() {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return (App.weak?.lastSet ?? 0) >= midnight.getTime();
}

/** The missed puzzles that are due to be met again, longest overdue first. */
function weakDueAgain() {
  return App.weak.again.filter((a) => SRS.isDue(a.card)).sort((a, b) => (a.card?.due ?? 0) - (b.card?.due ?? 0));
}

// ── the screen before and after a set ──────────────────────────────────────

function renderWeak() {
  if (Weak.current) return;

  const note = $('weakNote');
  const start = $('weakStart');
  $('weakBoardWrap').hidden = true;
  $('weakStop').hidden = true;
  $('weakSetup').hidden = false;

  // Whether there is a pack at all is found out first, and the screen draws
  // itself again when the answer is in.
  if (Weak.about === undefined) {
    start.hidden = true;
    note.textContent = 'Looking for the puzzles…';
    findPuzzlePack().then(() => {
      // Whatever came back, the question has been answered once: a lookup
      // that settled nothing is "none", not a reason to ask again at once.
      if (Weak.about === undefined) { Weak.about = null; Weak.why = Weak.why ?? 'missing'; }
      if (App.section === 'weak') renderWeak();
    });
    $('weakHead').hidden = true;
    $('weakAims').innerHTML = '';
    return;
  }
  if (!Weak.about) {
    start.hidden = true;
    note.textContent = weakMissingWords();
    $('weakHead').hidden = true;
    $('weakAims').innerHTML = '';
    // Asked again next time when it was only that nothing answered.
    if (Weak.why === 'unreachable') Weak.about = undefined;
    return;
  }

  renderWeakHead();
  renderWeakAims();

  start.hidden = false;
  start.textContent = weakSetDoneToday() ? 'Another ten' : 'Start ten';
  if (Weak.failed && !Weak.loading) {
    note.textContent = Weak.failed;
  } else if (!Weak.set?.summary) {
    const due = weakDueAgain().length;
    note.textContent = `${Weak.about.count.toLocaleString('en-GB')} puzzles to choose from.`
      + (due ? ` ${due} you missed before ${due === 1 ? 'is' : 'are'} due again, and ${due === 1 ? 'comes' : 'come'} first.` : '');
  } else {
    note.textContent = Weak.set.summary;
  }
  // Fetched while the screen is being read, so that Start does not wait.
  if (!Weak.pack && !Weak.loading && !Weak.failed) loadPuzzlePack().catch(() => { if (App.section === 'weak' && !Weak.current) renderWeak(); });
}

function renderWeakHead() {
  const head = $('weakHead');
  const fresh = App.weak.log.filter((r) => r.k !== 'again');
  const solved = fresh.filter((r) => r.ok).length;
  head.hidden = false;
  head.innerHTML = `<div class="readout">
      <div><span class="k">Your level on these</span><span class="v">${App.weak.level}</span></div>
      <div><span class="k">Solved first time</span><span class="v">${fresh.length ? `${solved}/${fresh.length}` : '—'}</span></div>
    </div>
    <p class="note">${App.weak.counted
    ? 'Every puzzle has a rating, from how thousands of people did on it. Your level is on the same scale: it goes up when you solve one and down when you miss, further when the result was a surprise.'
    : 'Every puzzle has a rating, from how thousands of people did on it. Your level starts at 1000 and finds its place over the first ten or so.'}
    It is a level on these puzzles, and says nothing about a rating anywhere else.</p>`;
}

function renderWeakAims() {
  const box = $('weakAims');
  box.innerHTML = '';
  const found = weakAimsNow();
  box.appendChild(el('h3', null, 'What they are aimed at'));

  if (!found.games) {
    box.appendChild(el('p', 'note', 'None of your games has been analysed yet, so these are a mix of everything. Analyse some, and most of each ten will be aimed at what goes wrong in them.'));
    return;
  }
  const span = `your last ${found.games === 1 ? 'analysed game' : `${found.games} analysed games`}`;
  if (!found.aims.length) {
    box.appendChild(el('p', 'note', found.mistakes
      ? `The ${found.mistakes === 1 ? 'one mistake' : `${found.mistakes} mistakes`} in ${span} ${found.mistakes === 1 ? 'has' : 'have'} no pattern behind ${found.mistakes === 1 ? 'it' : 'them'} that a puzzle can be aimed at, so these are a mix of everything.`
      : `No mistakes were found in ${span}, so these are a mix of everything.`));
    return;
  }

  box.appendChild(el('p', 'note', `Counted over ${span}. A puzzle is solved from the side that plays the trick; seeing it from there is how you come to see it coming.`));
  const list = el('div', 'record');
  const inSet = found.aims.slice(0, WEAK_AIMS_IN_A_SET);
  for (const aim of inSet) {
    const row = el('div', 'record-row');
    const why = aim.from.map((f) => `you ${WEAK_MISTAKE_WORDS[f.mistake] ?? f.mistake} ${weakTimes(f.count)}`).join(', and ');
    const mine = App.weak.log.filter((r) => r.a === aim.theme && r.k === 'aimed');
    const sofar = mine.length ? ` · ${mine.filter((r) => r.ok).length} of ${mine.length} solved so far` : '';
    row.innerHTML = `<span class="record-band">${esc(weakCapital(PUZZLE_THEME_WORDS[aim.theme]?.many ?? aim.theme))}</span>
      <span class="record-score">${esc(why)}${esc(sofar)}</span>`;
    list.appendChild(row);
  }
  box.appendChild(list);
  const more = found.aims.length - inSet.length;
  box.appendChild(el('p', 'note', `About seven of every ten are of ${inSet.length === 1 ? 'this kind' : 'these kinds, in that proportion'}; the rest are a mix.`
    + (more > 0 ? ` ${more === 1 ? 'One other pattern' : `${more} other patterns`} came up less often and ${more === 1 ? 'is' : 'are'} left to the mix.` : '')));
}

// ── a set ──────────────────────────────────────────────────────────────────

async function startWeakSet({ size = WEAK_SET_SIZE } = {}) {
  if (Weak.current) return;
  const note = $('weakNote');
  $('weakStart').hidden = true;
  if (!Weak.pack) {
    note.textContent = 'Fetching the puzzles…';
    try { await loadPuzzlePack(); } catch { renderWeak(); return; }
    // The screen may have been left while that was happening.
    if (App.section !== 'weak' || Weak.current) return;
  }
  const aims = weakAimsNow().aims;
  Weak.set = {
    slots: planWeakSet(aims, { size, repeats: weakDueAgain().length, rng: Weak.rng }),
    at: 0,
    results: [],
    from: App.weak.level,
    served: new Set(),
    summary: '',
  };
  nextWeakPuzzle();
}

/** Everything that must not be offered as a new puzzle. */
function weakTaken() {
  const taken = new Set(App.weak.done);
  for (const a of App.weak.again) taken.add(a.puzzle.id);
  for (const id of Weak.set?.served ?? []) taken.add(id);
  return taken;
}

/**
 * The puzzle for one slot of the set: what the slot asked for where the pack
 * has it, and the nearest thing otherwise. `kind` says what was actually
 * given, which is what the screen and the record are told.
 */
function weakPuzzleFor(slot) {
  if (slot.kind === 'again') {
    const entry = weakDueAgain().find((a) => !Weak.set.served.has(a.puzzle.id));
    if (entry) {
      const opened = openPackPuzzle(entry.puzzle);
      if (opened) return { opened, kind: 'again', aim: entry.aim ?? null, entry };
      // A stored puzzle that can no longer be set up is finished with.
      App.weak.again = App.weak.again.filter((a) => a !== entry);
    }
  }
  const pack = Weak.pack;
  const taken = weakTaken();
  for (let tries = 0; tries < 8; tries++) {
    const around = weakTargetRating(App.weak.level, Weak.rng);
    let kind = 'mixed', aim = null, index = -1;
    if (slot.kind === 'aimed') {
      index = pickPackPuzzle(pack, { theme: slot.theme, around, taken, reach: WEAK_REACH });
      if (index >= 0) { kind = 'aimed'; aim = slot.theme; }
    }
    if (index < 0) index = pickPackPuzzle(pack, { around, taken });
    if (index < 0) return null;
    const puzzle = readPackRow(pack.rows[index], pack.themes);
    const opened = puzzle ? openPackPuzzle(puzzle) : null;
    if (opened) return { opened, kind, aim, entry: null };
    // A row that will not set up is passed over for good, and another is found.
    const id = packRowId(pack.rows[index]);
    taken.add(id);
    App.weak.done.push(id);
  }
  return null;
}

function nextWeakPuzzle() {
  const set = Weak.set;
  if (!set || set.at >= set.slots.length) { endWeakSet(); return; }
  const given = weakPuzzleFor(set.slots[set.at]);
  if (!given) { endWeakSet({ ranOut: true }); return; }

  const { opened } = given;
  set.served.add(opened.id);
  const turn = ++Weak.turn;
  Weak.current = { ...given, step: 0, missed: false, shown: false, over: false };

  $('weakSetup').hidden = true;
  $('weakBoardWrap').hidden = false;
  // Inside a session the way out is the session's own, on the bar above.
  $('weakStop').hidden = sessionIs('weak');
  $('weakLegend').hidden = true;
  $('weakNext').hidden = true;
  $('weakShow').hidden = true;
  $('weakExplore').hidden = true;
  $('weakAskWhy').hidden = true;
  $('weakAnswer').textContent = '';

  const Side = opened.side === 'white' ? 'White' : 'Black';
  const what = given.kind === 'again' ? 'one you missed before'
    : (given.kind === 'aimed' ? `aimed at ${PUZZLE_THEME_WORDS[given.aim]?.many ?? given.aim}` : 'one of the mix');
  $('weakWhere').textContent = `Puzzle ${set.at + 1} of ${set.slots.length} · ${what}.`;
  $('weakPrompt').textContent = `They have just played ${opened.theirSan}. Find the best move for ${Side}.`;

  // THE MOVE THAT SET IT UP IS PLAYED IN FRONT OF YOU, from the position
  // before it: what the other side has just done is half of any puzzle, and a
  // position that simply appears has nothing to say about it.
  Weak.view.orientation = opened.side === 'white' ? WHITE : BLACK;
  Weak.view.interactive = false;
  Weak.view.onMove = onWeakMove;
  Weak.view.setFen(opened.before);
  setTimeout(() => {
    if (Weak.turn !== turn || !Weak.current) return;
    weakTheirMove(opened.theirUci);
    $('weakShow').hidden = false;
  }, WEAK_REPLY_MS);
}

/**
 * Play the other side's move on the board, and hand the board over.
 *
 * IN THAT ORDER OF WORDS AND THE OPPOSITE ORDER OF CALLS: a board works out
 * which moves it will accept when it is drawn, and only if it is taking moves
 * at the time — so it is told it is yours first, and the move that follows
 * draws it with your moves in hand.
 */
function weakTheirMove(uci) {
  Weak.view.interactive = true;
  const move = moveFromUci(Weak.view.board, uci);
  if (!move || !Weak.view.apply(move)) Weak.view.refresh();
}

function onWeakMove({ move, san, uci }) {
  const cur = Weak.current;
  if (!cur || cur.over || !Weak.view.interactive) return;
  const step = cur.opened.line[cur.step];

  if (!packMoveIsRight(step, uci)) {
    // The first wrong move is the miss. Nothing was played on the board, so
    // the position is still there for another look.
    cur.missed = true;
    Weak.view.draw();
    $('weakAnswer').textContent = `Not ${san}. Have another look, or ask for the answer — either way this one counts as missed.`;
    return;
  }

  Weak.view.apply(move);
  const last = cur.step === cur.opened.line.length - 1;
  if (last) { finishWeakPuzzle(); return; }

  // Their reply, after a moment in which the move just played can be seen.
  const reply = cur.opened.line[cur.step + 1];
  cur.step += 2;
  Weak.view.interactive = false;
  $('weakAnswer').textContent = '';
  $('weakPrompt').textContent = `Yes, ${san}. They answer ${reply.san}. And now?`;
  const turn = Weak.turn;
  setTimeout(() => {
    if (Weak.turn !== turn || !Weak.current || Weak.current.over) return;
    weakTheirMove(reply.uci);
  }, WEAK_REPLY_MS);
}

/** Put the answer on the board. Asking for it is a miss. */
function showWeakAnswer() {
  const cur = Weak.current;
  if (!cur || cur.over) return;
  cur.missed = true;
  cur.shown = true;
  finishWeakPuzzle();
}

async function finishWeakPuzzle() {
  const cur = Weak.current;
  if (!cur || cur.over) return;
  cur.over = true;
  Weak.turn++;
  Weak.view.interactive = false;
  $('weakShow').hidden = true;

  const { opened } = cur;
  const solved = !cur.missed;
  const step = opened.line[Math.min(cur.step, opened.line.length - 1)];
  const arrows = cur.shown ? arrowsFor(null, step.uci) : [];
  if (cur.shown) {
    Weak.view.setFen(step.fen, { arrows });
    $('weakLegend').hidden = false;
  }

  // ── the record ──────────────────────────────────────────────────────────
  const data = App.weak;
  const before = data.level;
  if (cur.kind === 'again') {
    // Met again: on to the next interval, or back to tomorrow. Solved twice
    // running — a day later, then six days after that — and it is finished.
    cur.entry.card = SRS.review(cur.entry.card, solved);
    if (solved && cur.entry.card.interval > 6) {
      data.again = data.again.filter((a) => a !== cur.entry);
      if (!data.done.includes(opened.id)) data.done.push(opened.id);
    }
  } else {
    data.level = nextWeakLevel(data.level, data.counted, opened.rating, solved);
    data.counted += 1;
    if (solved) {
      data.done.push(opened.id);
    } else {
      data.again.push({
        puzzle: { id: opened.id, rating: opened.rating, themes: opened.themes, fen: opened.fen, moves: opened.moves },
        aim: cur.aim,
        card: SRS.review(SRS.fresh(), false),
      });
    }
  }
  data.log.push({ t: Date.now(), id: opened.id, ok: solved, r: opened.rating, k: cur.kind, a: cur.aim });
  if (data.log.length > WEAK_LOG_KEEP) data.log = data.log.slice(-WEAK_LOG_KEEP);
  Weak.set.results.push({ ok: solved, kind: cur.kind, aim: cur.aim });
  sessionAnswered('weak', solved);

  // ── what the screen says ────────────────────────────────────────────────
  const words = packThemeWords(opened.themes);
  const was = words.length ? ` It was ${words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`}.` : '';
  const line = opened.line.length > 1 ? ` The line runs ${packLineText(opened)}.` : '';
  const back = cur.kind === 'again'
    ? (solved ? (cur.entry.card.interval > 6 ? ' That is twice running, so it is finished with.' : ' It comes back once more, in about a week.') : ' It comes back tomorrow.')
    : (solved ? '' : ' It comes back tomorrow.');
  const level = cur.kind === 'again' ? '' : ` Rated ${opened.rating}; your level ${data.level === before ? `stays at ${before}` : `goes from ${before} to ${data.level}`}.`;
  const head = solved ? 'Solved.'
    : (cur.shown ? `The move is ${step.san}.` : 'Found — on a second look, so it counts as missed.');
  $('weakAnswer').textContent = `${head}${cur.shown ? line : ''}${was}${level}${back}`;
  $('weakPrompt').textContent = solved ? 'That is the one.' : (cur.shown ? 'Here is the answer.' : 'That is the one.');

  const lastOfSet = Weak.set.at >= Weak.set.slots.length - 1;
  $('weakNext').hidden = false;
  $('weakNext').textContent = lastOfSet && !sessionIs('weak') ? 'See how the ten went' : 'Next';
  $('weakExplore').hidden = false;
  $('weakExplore').onclick = () => openPractice(opened.start, { arrows: arrowsFor(null, opened.line[0].uci) });
  $('weakAskWhy').hidden = !Coach.ready;
  $('weakAskWhy').onclick = () => askCoachAbout(opened.start, `Why is ${opened.line[0].san} the move here?`, { arrows: arrowsFor(null, opened.line[0].uci) });

  await Store.set('weakspots', App.weak);
}

function weakNext() {
  if (!Weak.set || !Weak.current?.over) return;
  Weak.current = null;
  Weak.set.at += 1;
  nextWeakPuzzle();
}

/** How a finished set went, in a sentence or two. */
function weakSetSummary(set, { ranOut = false, stopped = false } = {}) {
  const done = set.results.length;
  if (!done) return stopped ? 'Stopped before the first puzzle was answered. Nothing was counted.' : '';
  const solved = set.results.filter((r) => r.ok).length;
  const parts = [];
  const groups = new Map();
  for (const r of set.results) {
    const key = r.kind === 'aimed' ? r.aim : r.kind;
    if (!groups.has(key)) groups.set(key, { kind: r.kind, aim: r.aim, ok: 0, n: 0 });
    const g = groups.get(key);
    g.n++;
    if (r.ok) g.ok++;
  }
  for (const g of groups.values()) {
    const name = g.kind === 'aimed' ? (PUZZLE_THEME_WORDS[g.aim]?.many ?? g.aim) : (g.kind === 'again' ? 'ones you missed before' : 'the mix');
    parts.push(`${name} ${g.ok} of ${g.n}`);
  }
  const level = App.weak.level === set.from ? `Your level stays at ${set.from}.` : `Your level went from ${set.from} to ${App.weak.level}.`;
  const how = stopped ? `Stopped after ${done}. ` : (ranOut ? 'That is every puzzle in the pack. ' : '');
  return `${how}${solved} of ${done} solved: ${parts.join(', ')}. ${level}`;
}

/**
 * The set is over: say how it went, and note that today's has been done.
 *
 * THE SCREEN FIRST, THE SAVE AFTER. The summary is the thing that was waited
 * for, and it does not depend on the save having landed.
 */
function endWeakSet({ ranOut = false, stopped = false } = {}) {
  const set = Weak.set;
  Weak.current = null;
  Weak.turn++;
  let saved = null;
  if (set) {
    set.summary = weakSetSummary(set, { ranOut, stopped });
    // A set counts as today's once it has been seen through.
    if (!stopped && set.results.length) {
      App.weak.lastSet = Date.now();
      saved = Store.set('weakspots', App.weak);
    }
  }
  // A set that was part of today's session hands on to the session's next part.
  if (!stopped && sessionPartOver('weak', 0)) return saved;
  renderWeak();
  return saved;
}

/** Leave the set. A puzzle that was never answered is not counted, and stays in the pack. */
function stopWeakSet() {
  if (!Weak.set) return;
  endWeakSet({ stopped: true });
}
