// ── the import screen ──────────────────────────────────────────────────────
//
// The fetching half of import.js: archives newest first, a month at a time,
// stopping when it has enough. Serial rather than parallel — Chess.com asks
// for that, and a burst of thirty requests is how an app gets rate-limited
// into looking broken.
//
// AND IT SAYS WHAT IT IS DOING WHILE IT DOES IT. Fetching a year of games is
// twelve requests and can take twenty seconds; a button that goes quiet for
// twenty seconds is a button that did nothing as far as anybody watching can
// tell.

const Import = {
  running: false,
  cancelled: false,
  found: 0,
  added: 0,
  duplicate: 0,
  unusable: 0,
  // Games already stored that gained a field they were missing — see
  // chessComMonth. Not an addition and not nothing.
  updated: 0,
  months: 0,
};

/** Where the games go, and what has to be told they arrived. */
async function storeImported(rows) {
  App.reviews.games.push(...rows);
  // Newest last, the way the rest of the app stores them.
  App.reviews.games.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  forgetDeviations();
  await Store.set('reviews', App.reviews);
}

function importNote(text, kind = 'note') {
  const box = $('importNote');
  box.textContent = text;
  box.className = kind;
}

async function runImport() {
  if (Import.running) return;

  // THE ANDROID APP CANNOT DO THIS AND SAYS SO RATHER THAN FAILING. The APK
  // holds no INTERNET permission — that is the promise that makes everything
  // else in it trustworthy — so there is no request to make and no error worth
  // showing. Pasting a game still works there, and so does everything else.
  if (IN_ANDROID_APP) {
    importNote('The Android app has no internet permission, which is what lets it promise nothing leaves your device. Import in the web version — same address you installed this from — or paste a game below.', 'note');
    return;
  }

  const username = $('importUser').value.trim();
  if (!username) { importNote('Type your Chess.com username first.', 'note bad-note'); return; }
  const wanted = Number($('importCount').value) || 100;

  Import.running = true;
  Import.cancelled = false;
  Import.found = 0; Import.added = 0; Import.duplicate = 0; Import.unusable = 0; Import.updated = 0; Import.months = 0;
  $('importRun').hidden = true;
  $('importStop').hidden = false;
  importNote(`Asking Chess.com which months ${username} has games in…`);

  try {
    const listed = await fetch(archivesUrl(username), { headers: { Accept: 'application/json' } });
    if (listed.status === 404) {
      importNote(`Chess.com has no public player called "${username}". Check the spelling — it is the name in your profile address, not your display name.`, 'note bad-note');
      return;
    }
    if (!listed.ok) { importNote(`Chess.com answered ${listed.status}. Try again in a minute.`, 'note bad-note'); return; }

    const { archives = [] } = await listed.json();
    if (!archives.length) { importNote('That account has no public games to fetch.', 'note'); return; }

    const fresh = [];
    // Newest month first, so a small import is your recent games rather than
    // your first ever ones.
    for (const url of [...archives].reverse()) {
      if (Import.cancelled || fresh.length >= wanted) break;
      Import.months++;
      importNote(`Reading ${url.slice(-7)} — ${fresh.length} of ${wanted} games so far…`);

      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) continue;
      const { games = [] } = await response.json();

      const month = chessComMonth(games, username, [...App.reviews.games, ...fresh]);
      Import.found += month.found;
      Import.duplicate += month.duplicate;
      Import.unusable += month.unusable;
      // chessComMonth fills these into the stored rows where they were
      // missing; the count is how many it reached.
      Import.updated += month.updated ?? 0;
      // Anything past the limit is not brought in and is not counted as
      // anything else either: it was simply not asked for.
      fresh.push(...month.rows.slice(0, wanted - fresh.length));

      // A breath between requests. Chess.com asks for serial access and this
      // is a personal trainer, not a scraper.
      await new Promise((r) => setTimeout(r, 120));
    }

    Import.added = fresh.length;
    if (fresh.length) await storeImported(fresh);
    // A RUN THAT ADDED NOTHING CAN STILL HAVE CHANGED SOMETHING. Backfilling
    // ratings into games already stored happens in place, so without this the
    // whole point of running the import again would be thrown away on reload.
    else if (Import.updated) await Store.set('reviews', App.reviews);

    importNote(importSummary({
      found: Import.found, added: Import.added, months: Import.months,
      duplicate: Import.duplicate, unusable: Import.unusable, updated: Import.updated,
    }) + (fresh.length ? ' They are in Review, and the repertoire report has already been walked against them.' : ''),
    fresh.length || Import.updated ? 'note good-note' : 'note');

    if (fresh.length) renderDeviations();
  } catch (error) {
    // THE FAILURE THAT ACTUALLY HAPPENS is not an error code, it is the
    // request never arriving: a browser extension, an offline phone, or a
    // network that blocks the host. Saying "check your connection" is more use
    // than printing the exception.
    importNote(`Could not reach Chess.com. Usually a connection, an extension blocking it, or the page opened from a file rather than a web address. Pasting below always works. (${error?.message ?? 'no detail'})`, 'note bad-note');
  } finally {
    Import.running = false;
    $('importRun').hidden = false;
    $('importStop').hidden = true;
    renderImport();
  }
}

function stopImport() {
  if (!Import.running) return;
  Import.cancelled = true;
  importNote('Stopping after this month…');
}

function renderImport() {
  const imported = (App.reviews?.games ?? []).filter((g) => g.source === 'chess.com');
  const unreviewed = imported.filter((g) => g.reviewed === false).length;
  const box = $('importState');
  if (!imported.length) { box.textContent = ''; return; }
  // SAID ONCE. The paragraph below this one already explains what importing is
  // not; repeating it here put the same sentence on the screen twice.
  box.textContent = `${imported.length} imported ${imported.length === 1 ? 'game' : 'games'} stored`
    + (unreviewed ? `, ${unreviewed} of them not yet walked by the engine.` : ', all walked.');
}

// ── walking the imported games ─────────────────────────────────────────────
//
// Importing brings the moves. Everything on the Progress page, and every drill
// mined from a mistake, needs the engine to have WALKED the game — and doing
// that one game at a time through the panel below is the same bottleneck the
// import was built to remove, moved somewhere else.
//
// So this walks them in a queue: oldest first, one at a time, saving after
// each, with a Stop that takes effect between games rather than losing the one
// in progress. A hundred games at the quick setting is several minutes of a
// phone thinking, which is why it says how far through it is and why it can be
// stopped and picked up later — a game already walked is never walked again.
//
// THE QUICK SETTING IS THE DEFAULT HERE and it is a different trade from a
// single review. One game at 650ms a position is worth waiting for; a hundred
// of them is forty minutes. The estimate a review prints is calibrated per
// depth, so a shallower walk is not a worse measurement, it is a measurement
// of a different thing, and the depth is stored beside the result.

const Walk = { running: false, cancelled: false, done: 0, total: 0, failed: 0, drills: 0 };

/** The imported games with no review behind them, oldest first. */
function unwalkedGames() {
  return App.reviews.games.filter((g) => g.reviewed === false && g.pgn)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

function walkNote(text, kind = 'note') {
  const box = $('walkNote');
  box.textContent = text;
  box.className = kind;
}

async function walkImported() {
  if (Walk.running) return;
  const queue = unwalkedGames();
  if (!queue.length) { walkNote('Every imported game has been walked.', 'note good-note'); return; }

  Walk.running = true;
  Walk.cancelled = false;
  Walk.done = 0; Walk.failed = 0; Walk.drills = 0; Walk.total = queue.length;
  $('walkRun').hidden = true;
  $('walkStop').hidden = false;
  $('walkBar').hidden = false;

  const depth = Number($('walkDepth').value) || 7;
  const budget = REVIEW_BUDGET[depth] ?? REVIEW_BUDGET[7];

  for (const game of queue) {
    if (Walk.cancelled) break;
    walkNote(`Walking ${Walk.done + 1} of ${Walk.total} — ${game.white} vs ${game.black}…`);
    try {
      const parsed = parsePgn(game.pgn);
      if (!parsed.plies.length) throw new Error('no moves');
      const result = await reviewGame(parsed, game.side, {
        movetime: budget.movetime,
        depth,
        onProgress: (at, of) => {
          $('walkFill').style.width = `${Math.round(((Walk.done + at / of) / Walk.total) * 100)}%`;
        },
      });
      // Written onto the row that is already stored, so the game is not
      // duplicated and its Chess.com identity is kept.
      game.reviewed = true;
      game.accuracy = result.accuracy;
      game.meanLoss = result.meanLoss;
      game.mistakes = result.mistakes;
      game.tactics = result.tactics.length;
      game.depth = depth;
      game.estimate = result.meanLoss === null ? null : estimateRating(result.meanLoss, depth);
      // AND THE MISTAKES BECOME DRILLS, which is the whole point of walking
      // them. This did not happen: addMistakesToDrills had exactly one caller,
      // a button on the single-game review screen, so importing and walking
      // thirty-six games produced two hundred and thirty-one mistakes and not
      // one drill. Inaccuracies are left out here — see the function.
      Walk.drills += await addMistakesToDrills(result.mistakes, { worstOnly: true });
    } catch {
      // A game that will not walk is MARKED so the queue does not offer it
      // again for ever, and counted so the summary is not silently short.
      game.reviewed = true;
      game.accuracy = null;
      game.walkFailed = true;
      Walk.failed++;
    }
    Walk.done++;
    // Saved after each, so stopping — or closing the tab — keeps what was done.
    await Store.set('reviews', App.reviews);
    forgetDeviations();
  }

  $('walkFill').style.width = '0%';
  $('walkBar').hidden = true;
  Walk.running = false;
  $('walkRun').hidden = false;
  $('walkStop').hidden = true;

  const left = unwalkedGames().length;
  walkNote(`${Walk.done} walked${Walk.failed ? `, ${Walk.failed} of them would not read` : ''}.`
    + (Walk.drills ? ` ${Walk.drills} new ${Walk.drills === 1 ? 'position' : 'positions'} added to your drills.` : '')
    + (left ? ` ${left} still to go — press it again to carry on.` : ''),
    left ? 'note' : 'note good-note');
  renderImport();
  renderDrills();
  refreshBook();
}

function stopWalk() {
  if (!Walk.running) return;
  Walk.cancelled = true;
  walkNote('Stopping after this game…');
}
