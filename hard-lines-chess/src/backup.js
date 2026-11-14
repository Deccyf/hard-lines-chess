// ── a backup file ──────────────────────────────────────────────────────────
//
// Everything the app keeps, in one file that can be put somewhere else.
//
// The app's data lives on one device, inside one browser or one installed
// app, and nowhere else: uninstalling the app, clearing its data or losing
// the phone ends it. And the web version and the Android app are two separate
// places that cannot see each other. A file is the answer to both — it is
// what brings a history back, and what carries it from one to the other.
//
// RESTORING REPLACES, IT DOES NOT MERGE. Merging two histories means deciding,
// for every game and drill in both, which copy is the real one — and a wrong
// guess is a duplicate game counted twice on every chart, or a drill whose
// schedule went backwards. Replacing is one decision, made once, by the person
// whose data it is, after being told what each side holds. What was there is
// kept until they say otherwise, so that decision can be taken back.
//
// THE FILE IS CHECKED BEFORE ANYTHING IS TOUCHED. A file that is not a backup,
// that a newer version of the app wrote, or whose contents are not in the
// shape this app writes is refused whole, with the reason, and the app is
// left exactly as it was.

/** The newest file layout this version can read. */
const BACKUP_FORMAT = 1;

/** How much is handed across to the Android app at a time, in characters. */
const BACKUP_CHUNK = 200000;

/** How often, at most, the app's own copy is refreshed while the app stays open. */
const KEEP_EVERY_MS = 10 * 60 * 1000;

const Backup = {
  busy: false,
  // A file that has been read and checked, waiting for a yes or a no.
  pending: null,
  // The backup the Android app has been handed and is being asked to save.
  saving: null,
  // The panel is wired up and the app's data is loaded. Until then a file the
  // Android app has ready is left with it, and collected when this turns true.
  ready: false,
  // When the app's own copy was last handed over, this session.
  keptAt: 0,
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const listOrAbsent = (v) => v === undefined || Array.isArray(v);

/**
 * What each area has to look like for the app to open on it. Not a full
 * description — the app fills in what is missing as it loads — but the things
 * that would stop it loading at all: a list that is not a list.
 */
const BACKUP_SHAPES = {
  prefs: isPlainObject,
  openings: (v) => isPlainObject(v) && (v.cards === undefined || isPlainObject(v.cards)),
  drills: (v) => isPlainObject(v) && listOrAbsent(v.items),
  history: (v) => isPlainObject(v) && listOrAbsent(v.games) && (v.bands === undefined || isPlainObject(v.bands)),
  reviews: (v) => isPlainObject(v) && listOrAbsent(v.games),
  puzzles: (v) => isPlainObject(v) && listOrAbsent(v.items) && listOrAbsent(v.scanned),
  teaching: (v) => isPlainObject(v) && listOrAbsent(v.games),
  endgames: isPlainObject,
  vision: isPlainObject,
  storm: (v) => v === null || isPlainObject(v),
};

/** The Android app's own file handling, where the page is running inside it. */
function androidFiles() {
  const bridge = typeof window !== 'undefined' ? window.HardLinesAndroid : null;
  return bridge && typeof bridge.saveBackup === 'function' ? bridge : null;
}

function backupFileName(now = new Date()) {
  const two = (n) => String(n).padStart(2, '0');
  return `hard-lines-chess-backup-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}.json`;
}

/** What a set of areas holds, counted — both sides of "replace this with that?". */
function backupCounts(areas) {
  const of = (name) => Store.unwrap(areas?.[name])?.payload ?? null;
  const games = of('reviews')?.games ?? [];
  return {
    games: games.length,
    analysed: games.filter((g) => g && g.reviewed !== false).length,
    drills: (of('drills')?.items ?? []).length,
    puzzles: (of('puzzles')?.items ?? []).length,
    played: (of('history')?.games ?? []).length,
  };
}

function backupCountsWords(c) {
  const n = (count, one, many) => `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`;
  if (!c.games && !c.drills && !c.puzzles && !c.played) return 'nothing yet';
  const parts = [
    `${n(c.games, 'imported or reviewed game', 'imported or reviewed games')}${c.games ? ` (${c.analysed.toLocaleString('en-GB')} analysed)` : ''}`,
    n(c.drills, 'drill', 'drills'),
    n(c.puzzles, 'puzzle', 'puzzles'),
    n(c.played, 'game played here', 'games played here'),
  ];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function backupDate(iso) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? 'an unknown date' : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** The same, to the minute: the app's own copy is made many times a day. */
function backupMoment(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'an unknown date';
  return `${backupDate(iso)} at ${at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** The backup as text, with its name and what it holds. */
function buildBackup() {
  const areas = Store.snapshot();
  const file = {
    app: 'hard-lines-chess',
    kind: 'backup',
    format: BACKUP_FORMAT,
    exported: new Date().toISOString(),
    from: IN_ANDROID_APP ? 'the Android app' : 'the web version',
    areas,
  };
  return { text: JSON.stringify(file), name: backupFileName(), counts: backupCounts(areas) };
}

/**
 * A file's text, read as a backup: { ok: true, file, counts }, or
 * { ok: false, why } with a sentence for the screen. Nothing is changed here.
 */
function readBackup(text) {
  const notOne = 'That file is not a Hard Lines Chess backup, so nothing was changed.';
  let file;
  try {
    file = JSON.parse(String(text ?? '').replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, why: notOne };
  }
  if (!isPlainObject(file) || file.app !== 'hard-lines-chess' || file.kind !== 'backup' || !isPlainObject(file.areas)) {
    return { ok: false, why: notOne };
  }
  if (!Number.isFinite(file.format) || file.format > BACKUP_FORMAT) {
    return { ok: false, why: 'That backup was made by a newer version of this app than the one you are using. Update the app, then restore it. Nothing was changed.' };
  }
  const areas = {};
  for (const name of STORE_AREAS) {
    if (!(name in file.areas)) continue;
    const doc = Store.unwrap(file.areas[name]);
    if (!doc || !BACKUP_SHAPES[name](doc.payload)) {
      return { ok: false, why: `That backup is damaged: its ${name} are not in the shape this app writes. Nothing was changed.` };
    }
    areas[name] = doc;
  }
  if (!Object.keys(areas).length) return { ok: false, why: 'That backup holds nothing this app keeps, so nothing was changed.' };
  return { ok: true, file: { ...file, areas }, counts: backupCounts(areas) };
}

// ── small things remembered beside the data, not in it ─────────────────────
//
// When the last backup was saved and whether a restore has just happened are
// facts about this device, not part of the history, so they are not areas and
// do not travel in the file.
function backupMeta(name) {
  try { return JSON.parse(localStorage.getItem(Store.key(name)) ?? 'null'); } catch { return null; }
}
function setBackupMeta(name, value) {
  try {
    if (value === null) localStorage.removeItem(Store.key(name)); else localStorage.setItem(Store.key(name), JSON.stringify(value));
  } catch { /* the reminder is lost, the data is not */ }
}

function backupSay(text, kind = 'note') {
  const note = $('backupNote');
  note.textContent = text;
  note.className = kind;
}

function backupBusy(busy) {
  Backup.busy = busy;
  for (const id of ['backupSave', 'backupOpen', 'backupReplace', 'backupCancel', 'backupUndo', 'backupKeep']) $(id).disabled = busy;
}

/** The panel as it should stand now: when the last backup was, and any restore still open to undo. */
async function renderBackup() {
  const note = $('backupNote');
  if (!note || Backup.busy) return;
  const mine = ++renderBackup.asked;

  // AN APP THAT COULD NOT OPEN ITS DATA HAS NOTHING TO BACK UP — what it holds
  // this session is an empty history, and a file made from that is a backup
  // of nothing with today's date on it, waiting to be restored over the real
  // one. Nor is it somewhere to restore into. Both are refused, with why.
  const shut = Store.mode === 'none';
  $('backupSave').disabled = shut;
  $('backupOpen').disabled = shut;
  if (shut) {
    $('backupRestored').hidden = true;
    $('backupConfirm').hidden = true;
    note.textContent = 'No backup can be saved or restored until the app has been closed and opened again.';
    note.className = 'note bad-note';
    return;
  }

  // What has happened to the data that is still to be acknowledged. One thing
  // at a time, the most serious first: it was cleared and is still gone; it
  // was cleared, or fell behind, and the app's own copy put it back; a backup
  // was restored and can still be undone.
  const recovered = backupMeta('__recovered');
  const restored = backupMeta('__restored');
  const copy = !Store.lost && !recovered && restored ? await Store.undoCopy() : null;
  if (mine !== renderBackup.asked) return;
  const said = $('backupRestoredText');
  $('backupRestored').hidden = !(Store.lost || recovered || restored);
  $('backupUndo').hidden = !copy;
  said.className = Store.lost ? 'note bad-note' : 'note good-note';
  const how = `It can do that when the ${IN_ANDROID_APP ? 'phone' : 'device'} is very short of space, or when the stored copy is damaged.`;
  if (Store.lost) {
    const place = IN_ANDROID_APP ? 'This phone' : 'This browser';
    said.textContent = `${place} has cleared what the app had saved${IN_ANDROID_APP ? '' : ' here'}. ${how} `
      + `${Store.keeper ? 'The app had no copy of its own that it could put back. ' : ''}A backup file brings it back: use “Restore from a backup”.`;
    $('backupKeep').textContent = 'Carry on without it';
  } else if (recovered) {
    const made = backupMoment(recovered.exported);
    said.textContent = recovered.lost
      ? `This phone had cleared what the app had saved. ${how} It has been put back from the app’s own copy, made on ${made}. Anything done after that is gone.`
      : (recovered.created
        ? `What the app had saved was not here, and has been put back from the app’s own copy, made on ${made}.`
        : 'Some of what was last saved had not reached this phone’s storage. It was held in the app’s own copy, and has been put back.');
    $('backupKeep').textContent = 'Done';
  } else if (restored) {
    said.textContent = `Restored from the backup saved on ${backupDate(restored.exported)}${restored.from ? ` in ${restored.from}` : ''}.`
      + (copy ? ' What was here before is still being kept, so this can be undone.' : '');
    $('backupKeep').textContent = copy ? 'Keep the restored data' : 'Done';
  }

  if ($('backupConfirm').hidden && !note.dataset.said) {
    const last = backupMeta('__backup');
    const held = backupCounts(Store.snapshot());
    const worthKeeping = held.games + held.drills + held.puzzles + held.played > 0;
    if (Number.isFinite(last?.at)) {
      const days = Math.floor((Date.now() - last.at) / 86400000);
      note.textContent = `Last backup file saved on ${backupDate(last.at)}${days >= 30 && worthKeeping ? `, ${days} days ago` : ''}.`;
    } else {
      note.textContent = worthKeeping ? 'No backup file has been saved from here yet.' : '';
    }
    note.className = 'note';
  }
}
renderBackup.asked = 0;

/** Say something that should stay on screen until the next thing is said. */
function backupSayAndHold(text, kind = 'note') {
  backupSay(text, kind);
  $('backupNote').dataset.said = '1';
}

// ── saving ─────────────────────────────────────────────────────────────────

/** A text a piece at a time, never cutting a character in two. */
function inPieces(text, hand) {
  for (let at = 0; at < text.length;) {
    let end = Math.min(text.length, at + BACKUP_CHUNK);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xD800 && last <= 0xDBFF) end -= 1;
    hand(text.slice(at, end));
    at = end;
  }
}

/** Hand the backup to the Android app, under its name. */
function sendBackupToAndroid(bridge, name, text) {
  bridge.beginBackup(name);
  inPieces(text, (piece) => bridge.appendBackup(piece));
}

function backupSaved(made) {
  setBackupMeta('__backup', { at: Date.now() });
  backupBusy(false);
  backupSayAndHold(`Saved as ${made.name}: ${backupCountsWords(made.counts)}. Keep it somewhere other than this ${IN_ANDROID_APP ? 'phone' : 'device'}.`, 'note good-note');
}

async function saveBackup() {
  if (Backup.busy) return;
  let made;
  try {
    made = buildBackup();
  } catch (e) {
    backupSayAndHold(`The backup could not be put together (${e?.message ?? e}). Nothing was saved.`, 'note bad-note');
    return;
  }
  Store.keep();

  // Route one: inside the Android app, the app itself saves it — a page in a
  // WebView cannot start a download — and asks where it should go. Nothing on
  // the page is locked meanwhile: the chooser covers it, and a chooser that
  // never answered would otherwise leave the buttons dead until a restart.
  const bridge = androidFiles();
  if (bridge) {
    try {
      Backup.saving = made;
      sendBackupToAndroid(bridge, made.name, made.text);
      backupSayAndHold('Choose where to keep the backup…');
      bridge.saveBackup();
    } catch (e) {
      Backup.saving = null;
      backupSayAndHold(`The backup could not be handed to the app (${e?.message ?? e}). Nothing was saved.`, 'note bad-note');
    }
    return;
  }
  backupBusy(true);

  // Route two: the viewer's platform saves it, with its own confirmation.
  if (App.downloads) {
    try {
      await App.downloads.save({ filename: made.name, data: made.text });
      backupSaved(made);
      return;
    } catch (e) {
      const code = e?.code ?? 'unavailable';
      if (code === 'declined') { backupBusy(false); backupSayAndHold('Not saved.'); return; }
      if (code === 'rate_limited') {
        backupBusy(false);
        backupSayAndHold('A save prompt is already open — answer that one, then try again.');
        return;
      }
      // Anything else falls through to the browser's own download.
    }
  }

  // Route three: an ordinary download. Where downloads are blocked this does
  // nothing and throws nothing, so the sentence is written for that case too.
  try {
    const url = URL.createObjectURL(new Blob([made.text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = made.name;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    setBackupMeta('__backup', { at: Date.now() });
    backupBusy(false);
    backupSayAndHold(`Asked your browser to save ${made.name}: ${backupCountsWords(made.counts)}. If no file appeared, downloads are blocked here. Keep it somewhere other than this device.`, 'note good-note');
  } catch (e) {
    backupBusy(false);
    backupSayAndHold('This page cannot save a file here, so no backup was made.', 'note bad-note');
  }
}

// What the Android app says back when its save has finished, one way or the other.
if (typeof window !== 'undefined') {
  window.hardLinesBackupSaved = (ok, why) => {
    const made = Backup.saving;
    Backup.saving = null;
    if (ok && made) { backupSaved(made); return; }
    backupBusy(false);
    if (ok) {
      // The file was written, and the page had been started again meanwhile.
      setBackupMeta('__backup', { at: Date.now() });
      backupSayAndHold('The backup file was saved. Keep it somewhere other than this phone.', 'note good-note');
      return;
    }
    backupSayAndHold(why === 'cancelled' ? 'Not saved.'
      : (why === 'lost' ? 'The app was restarted while the file was being chosen, so nothing was saved. Try again.'
        : `The file could not be written${why ? ` (${why})` : ''}. Nothing was saved.`), why === 'cancelled' ? 'note' : 'note bad-note');
  };
  // (Before the page is ready the file stays with the app, and is collected when the page looks.)
  window.hardLinesRestoreReady = () => { if (Backup.ready) collectAndroidRestore(); };
  window.hardLinesRestoreCancelled = () => { backupBusy(false); backupSayAndHold('Nothing was restored.'); };
  window.hardLinesRestoreFailed = (why) => {
    backupBusy(false);
    backupSayAndHold(`That file could not be read${why ? ` (${why})` : ''}. Nothing was changed.`, 'note bad-note');
  };
  // The app is about to go into the background.
  window.hardLinesLeaving = () => { keepOwnCopy(); };
}

// ── the app's own copy ─────────────────────────────────────────────────────
//
// A PHONE CAN CLEAR THE DATABASE THE PAGE KEEPS EVERYTHING IN. It does so when
// it is very short of space; a website can ask to be spared, and a page inside
// an app cannot. So the Android app keeps a second copy of everything in its
// own private files, which the phone leaves alone until the app is
// uninstalled or its data is cleared.
//
// It is the backup file, written without being asked: made when the app is
// left, and every few minutes while it stays open and something has changed.
// It is read back on a load only when it may hold something the database does
// not, and then the newer copy wins, area by area — see `keeper` in
// src/store.js. Nothing asks the person anything: there is no decision in it.
// The database is empty, or behind, and this is what it held.
//
// IT IS NOT A BACKUP. It is on the same phone, inside the same app, and goes
// when the app goes. The file saved somewhere else is still the only thing
// that survives the phone.

/** The Android app's way of keeping that copy, or null where there is no app around the page. */
function ownCopyKeeper() {
  const bridge = androidFiles();
  if (!bridge || typeof bridge.commitKeep !== 'function' || typeof bridge.openKept !== 'function') return null;
  return {
    /** What the app holds: { state: 'ok', file }, { state: 'none' }, or { state: 'unread' } when it is there and would not read. */
    read() {
      const got = collectPieces(() => bridge.openKept(), () => bridge.keptChunk(), () => bridge.closeKept());
      if (got.state !== 'ok') return got;
      // A copy that is not in the shape this app writes is no copy.
      const read = readBackup(got.text);
      return read.ok ? { state: 'ok', file: read.file } : { state: 'none' };
    },
    /** Hand the app a copy to keep. True when the app says it is now the one it keeps. */
    write(text) {
      try {
        bridge.beginKeep();
        inPieces(text, (piece) => bridge.appendKeep(piece));
        return bridge.commitKeep() === true;
      } catch {
        return false;
      }
    },
  };
}
if (typeof window !== 'undefined') Store.keeper = ownCopyKeeper();

/**
 * Refresh the app's own copy, if there is anything it does not already hold.
 *
 * NOT WHILE THE APP'S DATA IS ONLY HALF THERE — before it has loaded, during a
 * restore, or in a session that could not open what is stored: a copy made
 * then would be a copy of an empty or part-loaded app, written over the real
 * one. And not while the copy itself could not be read, for the same reason.
 */
function keepOwnCopy() {
  if (!Store.keeper || !Backup.ready || Backup.busy || Store.mode !== 'large' || Store.keptUnread) return false;
  if (Store.keptCurrent()) return false;
  let made;
  try { made = buildBackup(); } catch { return false; }
  if (!Store.keeper.write(made.text)) return false;
  Store.noteKept();
  Backup.keptAt = Date.now();
  return true;
}

// ── restoring ──────────────────────────────────────────────────────────────

/**
 * Collect a text the Android app hands out a piece at a time:
 * { state: 'ok', text }, { state: 'none' } when it has none to give, or
 * { state: 'unread' } when it has one and it did not come across whole.
 *
 * "None" and "would not read" are told apart with care, because what follows
 * is different: where there is none, a new one may be made; one that would
 * not read is still there, and must not be written over.
 */
function collectPieces(open, next, close) {
  const opened = open();
  if (opened === 0) return { state: 'none' };
  if (!(opened > 0)) return { state: 'unread' };
  let text = '';
  let whole = false;
  try {
    for (;;) {
      const piece = next();
      if (!piece) break;        // the end — or a failure, which closing tells apart
      text += piece;
    }
  } finally {
    whole = close() === true;
  }
  return whole ? { state: 'ok', text } : { state: 'unread' };
}

/** A file the Android app has taken in and is holding for the page. */
function takeRestoreFromAndroid(bridge) {
  try {
    return collectPieces(() => bridge.openRestore(), () => bridge.restoreChunk(), () => bridge.clearRestore());
  } catch {
    return { state: 'unread' };
  }
}

/** Collect it and ask the question. `waiting` is the look taken when the page starts, where finding nothing is ordinary. */
function collectAndroidRestore(waiting = false) {
  const bridge = androidFiles();
  if (!bridge) return;
  const got = takeRestoreFromAndroid(bridge);
  // Nobody has asked for anything yet: whatever is not a file ready to be
  // offered is nothing to say.
  if (waiting && got.state !== 'ok') return;
  backupBusy(false);
  if (got.state !== 'ok') {
    backupSayAndHold('That file could not be read in full. Nothing was changed.', 'note bad-note');
    return;
  }
  offerRestore(got.text);
}

function chooseBackup() {
  if (Backup.busy) return;
  $('backupConfirm').hidden = true;
  Backup.pending = null;
  const bridge = androidFiles();
  if (bridge) {
    backupSayAndHold('Choose the backup file…');
    try {
      bridge.openBackup();
    } catch (e) {
      backupSayAndHold(`The app could not open a file chooser (${e?.message ?? e}).`, 'note bad-note');
    }
    return;
  }
  const input = $('backupFile');
  input.value = '';
  input.click();
}

async function backupFileChosen() {
  const file = $('backupFile').files?.[0];
  if (!file) return;
  let text;
  try {
    text = await file.text();
  } catch (e) {
    backupSayAndHold(`That file could not be read (${e?.message ?? e}). Nothing was changed.`, 'note bad-note');
    return;
  }
  offerRestore(text);
}

/** A file has been read: check it, and ask the one question. */
function offerRestore(text) {
  const read = readBackup(text);
  if (!read.ok) {
    Backup.pending = null;
    $('backupConfirm').hidden = true;
    backupSayAndHold(read.why, 'note bad-note');
    return;
  }
  Backup.pending = read;
  const here = backupCounts(Store.snapshot());
  const keeps = Store.mode === 'large';
  backupSayAndHold('');
  $('backupReplace').textContent = 'Replace with the backup';
  $('backupConfirmText').textContent = `This backup was saved on ${backupDate(read.file.exported)}${read.file.from ? ` in ${read.file.from}` : ''}. `
    + `It holds ${backupCountsWords(read.counts)}. This app now holds ${backupCountsWords(here)}. `
    + 'Restoring replaces what is here with what is in the file; the two are not combined. '
    + (keeps ? 'What is here now is kept until you say otherwise, so it can be undone.' : 'This browser has no room to keep what is here now, so it cannot be undone: save a backup of it first if you want one.');
  $('backupConfirm').hidden = false;
  $('backupConfirm').scrollIntoView({ block: 'nearest' });
}

function cancelRestore() {
  const undoing = Boolean(Backup.pending?.undo);
  Backup.pending = null;
  $('backupConfirm').hidden = true;
  backupSayAndHold(undoing ? 'Nothing was changed.' : 'Nothing was restored.');
}

async function confirmRestore() {
  const read = Backup.pending;
  if (!read || Backup.busy) return;
  if (read.undo) { putBackBeforeRestore(); return; }
  backupBusy(true);
  backupSayAndHold('Restoring…');
  const done = await Store.replaceWith(read.file.areas);
  if (!done.ok) {
    backupBusy(false);
    backupSayAndHold({
      full: 'The device has no room for the restore, so nothing was changed.',
      unopened: 'This app’s saved data could not be opened this time, so nothing was restored. Close the app completely, open it again, and try once more.',
      empty: 'That backup holds nothing this app keeps, so nothing was changed.',
    }[done.why] ?? 'The restore failed, and nothing was changed.', 'note bad-note');
    return;
  }
  Backup.pending = null;
  $('backupConfirm').hidden = true;
  setBackupMeta('__recovered', null);
  setBackupMeta('__restored', { at: Date.now(), exported: read.file.exported, from: read.file.from ?? null });
  restartOnStored();
}

/**
 * Start again on what is now stored.
 *
 * Every screen was drawn from what was here before, and several keep working
 * copies of it, so the page is reloaded. BUT THE APP'S OWN REFERENCES ARE
 * MOVED FIRST. They still point at the history that was replaced, and the
 * next thing to save any of them would write the old history back over the
 * new one — so if the reload does not happen (a viewer that will not let a
 * page reload itself), what is in memory is at least what is stored.
 */
async function restartOnStored() {
  await loadStored();
  try { location.reload(); } catch { /* said below */ }
  setTimeout(() => {
    backupBusy(false);
    backupSayAndHold('Done. Close the app completely and open it again, so that every screen shows it.', 'note good-note');
  }, 3000);
}

/**
 * Undoing a restore is itself a replacement, and is asked about like one.
 *
 * What was here before the restore is kept until it is let go of, which may
 * be days — and by then the app has been used. Putting the old history back
 * discards everything done since, so the button does not do it: it asks, and
 * says what each side holds, the same way a restore does.
 */
async function undoRestore() {
  if (Backup.busy) return;
  const copy = await Store.undoCopy();
  if (!copy) {
    backupSayAndHold('There is nothing left to put back.', 'note bad-note');
    renderBackup();
    return;
  }
  Backup.pending = { undo: true };
  backupSayAndHold('');
  $('backupReplace').textContent = 'Put it back';
  $('backupConfirmText').textContent = `This puts back what was here before the restore: ${backupCountsWords(backupCounts(copy.areas))}. `
    + `It replaces what is here now, which is ${backupCountsWords(backupCounts(Store.snapshot()))}, so anything done since the restore is lost.`;
  $('backupConfirm').hidden = false;
  $('backupConfirm').scrollIntoView({ block: 'nearest' });
}

async function putBackBeforeRestore() {
  backupBusy(true);
  backupSayAndHold('Putting it back…');
  const done = await Store.undoReplace();
  Backup.pending = null;
  $('backupConfirm').hidden = true;
  if (!done.ok) {
    backupBusy(false);
    backupSayAndHold(done.why === 'nothing' ? 'There is nothing left to put back.' : 'The undo failed, and nothing was changed.', 'note bad-note');
    renderBackup();
    return;
  }
  setBackupMeta('__restored', null);
  restartOnStored();
}

/** The button under whatever the panel is saying has happened: acknowledge that one thing. */
async function keepRestore() {
  if (Backup.busy) return;
  if (Store.lost) {
    Store.found();
  } else if (backupMeta('__recovered')) {
    setBackupMeta('__recovered', null);
  } else {
    // An undo that was being asked about has just been answered: no.
    if (Backup.pending?.undo) { Backup.pending = null; $('backupConfirm').hidden = true; }
    await Store.forgetUndo();
    setBackupMeta('__restored', null);
  }
  delete $('backupNote').dataset.said;
  renderBackup();
}

function setupBackup() {
  $('backupSave').addEventListener('click', saveBackup);
  $('backupOpen').addEventListener('click', chooseBackup);
  $('backupFile').addEventListener('change', backupFileChosen);
  $('backupReplace').addEventListener('click', confirmRestore);
  $('backupCancel').addEventListener('click', cancelRestore);
  $('backupUndo').addEventListener('click', undoRestore);
  $('backupKeep').addEventListener('click', keepRestore);
  // What this load took from the app's own copy is said until it has been read.
  if (Store.recovered) {
    setBackupMeta('__recovered', { at: Date.now(), exported: Store.recovered.exported, lost: Store.recovered.lost, created: Store.recovered.created });
  }
  Backup.ready = true;
  renderBackup();
  if (Store.keeper) {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') keepOwnCopy(); });
    setInterval(() => { if (Date.now() - Backup.keptAt >= KEEP_EVERY_MS) keepOwnCopy(); }, 60000);
  }
  // A file chosen just before the Android app was restarted underneath its own
  // file chooser is still waiting there to be collected.
  collectAndroidRestore(true);
}
