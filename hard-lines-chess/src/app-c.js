// ── wiring ─────────────────────────────────────────────────────────────────
function buildTabs() {
  const nav = $('tabs');
  nav.innerHTML = '';
  for (const [id, label] of SECTIONS) {
    const btn = el('button', 'tab', label);
    btn.id = 'tab-' + id;
    btn.type = 'button';
    btn.addEventListener('click', () => show(id));
    nav.appendChild(btn);
  }
}

async function boot() {
  buildTabs();

  // Progress is loaded BEFORE anything renders, so the first paint is the real
  // state rather than an empty one that fills in a moment later.
  const hasStore = await Store.init();
  App.openings = await Store.get('openings', { cards: {} });
  App.drills = await Store.get('drills', { items: [] });
  App.history = await Store.get('history', { bands: {}, games: [] });
  App.reviews = await Store.get('reviews', { games: [] });
  App.puzzles = await Store.get('puzzles', { items: [], scanned: [] });
  App.teaching = await Store.get('teaching', { games: [] });
  Endgames.results = await Store.get('endgames', {});
  Vision.best = await Store.get('vision', {});
  Storm.best = await Store.get('storm', null);
  App.teaching.games ??= [];
  App.prefs = { ...DEFAULT_PREFS, ...(await Store.get('prefs', {})) };

  // Restore anything a stored shape is missing, so a document written by an
  // older version of this page cannot crash a newer one.
  App.openings.cards ??= {};
  App.drills.items ??= [];
  App.history.bands ??= {};
  App.history.games ??= [];
  App.reviews.games ??= [];
  App.puzzles.items ??= [];
  App.puzzles.scanned ??= [];
  Endgames.results ??= {};
  Vision.best ??= {};

  $('storeNote').textContent = hasStore
    ? 'Saved to your Claude account, so it follows you to another device, with a copy in this browser.'
    : 'Saved in this browser only. It survives closing the tab, but not clearing site data or moving to another device.';

  // Boards. All of them share one implementation, so they cannot disagree about
  // what a legal move is.
  Play.view = makeBoardView($('playBoard'), { onMove: onPlayerMove });
  Openings.view = makeBoardView($('openingBoard'), { interactive: false });
  Review.view = makeBoardView($('reviewBoard'), { interactive: false });
  Review.bar = makeEvalBar($('reviewEval'));
  Drill.view = makeBoardView($('drillBoard'), { interactive: false });
  Puzzles.view = makeBoardView($('puzzleBoard'), { interactive: false });
  Endgames.view = makeBoardView($('endgameBoard'), { onMove: onEndgameMove });
  Storm.view = makeBoardView($('stormBoard'), { onMove: onStormMove });
  Practice.view = makeBoardView($('practiceBoard'), { onMove: onPracticeMove });
  Practice.bar = makeEvalBar($('practiceEval'));
  applyPrefs();

  // Play
  renderBandPicker();
  // A band is an opponent, and an opponent is chosen before the game, not
  // during it: the select used to change the engine's strength mid-game and
  // file the result under whichever band it showed at the end. It now starts
  // a new game, like the time control does, and asks first when there is a
  // game to lose.
  $('bandSelect').addEventListener('change', (e) => {
    const band = BANDS.find((b) => b.elo === Number(e.target.value)) ?? BANDS[0];
    if (!confirmAbandon('Changing the band')) {
      e.target.value = String(Play.game.band.elo);
      return;
    }
    Play.band = band;
    describeBand();
    newPlayGame();
  });
  const controls = $('timeControl');
  for (const control of TIME_CONTROLS) {
    const option = el('option', null, control.label);
    option.value = control.id;
    controls.appendChild(option);
  }
  controls.addEventListener('change', (e) => {
    Play.control = TIME_CONTROLS.find((c) => c.id === e.target.value) ?? TIME_CONTROLS[0];
    newPlayGame();
  });
  $('bookToggle').addEventListener('change', (e) => { Play.useBook = e.target.checked; });
  $('teachToggle').addEventListener('change', (e) => { Teach.on = e.target.checked; newPlayGame(); });
  refreshBook();

  $('playNew').addEventListener('click', () => newPlayGame());
  $('playTakeback').addEventListener('click', takeBackPlay);
  $('playFlip').addEventListener('click', () => {
    Play.view.orientation = Play.view.orientation === WHITE ? BLACK : WHITE;
    Play.view.draw();
  });
  $('playResign').addEventListener('click', () => {
    if (Play.over || Play.thinking) return;
    if (!window.confirm('Resign this game?')) return;
    finishPlay('resigned');
  });
  $('asWhite').addEventListener('click', () => {
    Play.myColour = WHITE;
    $('asWhite').classList.add('primary'); $('asBlack').classList.remove('primary');
    newPlayGame();
  });
  $('asBlack').addEventListener('click', () => {
    Play.myColour = BLACK;
    $('asBlack').classList.add('primary'); $('asWhite').classList.remove('primary');
    newPlayGame();
  });
  $('playAnalyse').addEventListener('click', () => {
    openPractice(Play.view.board.fen());
  });

  // Practice board
  $('practiceSuggest').addEventListener('click', suggestPractice);
  $('practiceUndo').addEventListener('click', undoPractice);
  $('practiceReset').addEventListener('click', () => { Practice.view.orientation = WHITE; resetPractice(); });
  $('practiceFlip').addEventListener('click', () => {
    Practice.view.orientation = Practice.view.orientation === WHITE ? BLACK : WHITE;
    Practice.view.draw();
    Practice.bar.orient(Practice.view.orientation);
  });
  $('practiceLoad').addEventListener('click', loadPracticeFen);
  $('practicePlay').addEventListener('click', playFromPractice);
  $('practiceAuto').addEventListener('change', (e) => { Practice.auto = e.target.checked; if (Practice.auto) suggestPractice(); });
  $('practiceThreats').addEventListener('change', (e) => { Practice.threats = e.target.checked; showThreat(); });
  $('practiceHanging').addEventListener('change', (e) => {
    Practice.hanging = e.target.checked;
    if (Practice.hanging) markHanging();
    else { Practice.view.hangs = []; Practice.view.draw(); $('practiceHangNote').textContent = ''; }
  });
  $('coachAsk').addEventListener('click', askCoach);
  $('coachStop').addEventListener('click', stopCoach);
  $('coachBack').addEventListener('click', coachGoBack);
  $('coachQuestion').addEventListener('keydown', (e) => { if (e.key === 'Enter') askCoach(); });
  setupCoach();
  $('practiceClearMarks').addEventListener('click', () => { Practice.view.clearUser(); Practice.view.draw(); });

  // Openings
  $('openingNext').addEventListener('click', advanceOpening);
  $('openingClose').addEventListener('click', closeOpening);
  $('openingFinish').addEventListener('click', closeOpening);
  $('openingTestNow').addEventListener('click', () => {
    const opening = Openings.current;
    const branch = Openings.branch;
    closeOpening();
    startOpening(opening, 'drill', { branch, fromPly: branch === null ? 0 : opening.variations[branch].at });
  });

  // Review
  $('reviewRun').addEventListener('click', runReview);

  // Drills
  $('drillStart').addEventListener('click', startDrill);
  $('drillNext').addEventListener('click', nextDrill);

  // Puzzles
  $('puzzleStart').addEventListener('click', () => startPuzzle());
  $('puzzleNext').addEventListener('click', nextPuzzle);
  $('puzzleScan').addEventListener('click', scanGamesForTactics);
  $('puzzleStop').addEventListener('click', stopScan);

  // Endgames
  $('endgameNext').addEventListener('click', closeEndgame);
  $('endgameTakeBack').addEventListener('click', takeBackEndgame);
  renderEndgames();

  // Clock
  $('stormStart').addEventListener('click', startStorm);
  $('stormStop').addEventListener('click', stopStorm);
  renderStorm();

  // Vision
  $('visionStart').addEventListener('click', startVision);
  $('visionStop').addEventListener('click', stopVision);
  $('visionMode').addEventListener('change', (e) => { Vision.mode = e.target.value; renderVisionBest(); });
  $('visionOrientation').addEventListener('change', (e) => {
    Vision.orientation = e.target.value;
    if (!Vision.running) buildVisionGrid(Vision.orientation !== 'black');
    renderVisionBest();
  });
  renderVision();

  // Settings
  $('settingTheme').addEventListener('change', (e) => { App.prefs.theme = e.target.value; savePrefs(); });
  $('settingDots').addEventListener('change', (e) => { App.prefs.dots = e.target.checked; savePrefs(); });
  $('settingCoords').addEventListener('change', (e) => { App.prefs.coords = e.target.checked; savePrefs(); });
  $('settingAnimate').addEventListener('change', (e) => { App.prefs.animate = e.target.checked; savePrefs(); });
  $('settingLongPress').addEventListener('change', (e) => { App.prefs.longPress = Number(e.target.value); savePrefs(); });
  $('settingThink').addEventListener('change', (e) => { App.prefs.think = e.target.value; savePrefs(); });
  $('settingReset').addEventListener('click', () => { App.prefs = { ...DEFAULT_PREFS }; savePrefs(); renderSettings(); });

  // Taking it with you. The button is hidden in exactly ONE case: the page is
  // already running from a saved file, where offering to save it again is
  // offering a copy of the thing you are looking at. Everywhere else it is
  // shown and pressing it does something, even if what it does is explain why
  // this viewer will not save files.
  $('downloadApp').addEventListener('click', downloadApp);
  $('installApp').addEventListener('click', installApp);
  setupInstall();
  // WHICH PROTOCOLS MEAN "THIS IS ALREADY YOUR COPY". Not just file:. Android
  // opens a downloaded HTML file from the Files app as content:, so a phone
  // reading the saved copy was shown a Save button — which Android then
  // refuses to action, because a page on an opaque origin may not start a
  // download. The button did nothing, and the only honest thing it could have
  // said was that the file it offers is the file you are looking at.
  const saved = ['file:', 'content:', 'blob:', 'android-app:'].includes(location.protocol);
  $('downloadRow').hidden = saved || IN_ANDROID_APP;
  if (saved) {
    // The panel stops explaining how to do the thing that has already been
    // done. Leaving "save a copy and it opens from your Files app" on screen
    // in a copy opened from the Files app is the page not knowing where it is.
    $('downloadTitle').textContent = 'Your copy';
    $('downloadBlurb').hidden = true;
    $('downloadNote').textContent = 'This is your own copy of the app, already saved and running from your device. It needs no connection, and its progress is kept by this browser — separately from any other copy.';
    // Said once, plainly, because "why is there no install option" is the
    // obvious next question and the answer is a browser rule rather than
    // anything this page could do differently.
    $('installNote').textContent = 'A browser will not install an app from a file opened this way, whatever the file contains. Installing needs a web address.';
  } else if (IN_ANDROID_APP) {
    // The same shape of correction as the branch above, for the same reason:
    // the panel is describing a journey this copy has already made. Saving the
    // app out of the app would produce a worse copy of itself — one that keeps
    // its progress somewhere else — and there is nowhere here to open it.
    $('downloadTitle').textContent = 'Your copy';
    $('downloadBlurb').hidden = true;
    $('downloadNote').textContent = 'This is the Android app. The whole trainer is inside it — engine, openings, review and all — and it never asks the network for anything: it holds no permission to. Your progress is kept on this device.';
  }
  (async () => {
    try { App.downloads = await window.claude?.use?.('downloads') ?? null; } catch { App.downloads = null; }
  })();

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    $('promo').hidden = true;
    tipBox.hide();
    for (const view of allViews()) {
      if (view) { view.selected = -1; view.draw(); }
    }
  });

  newPlayGame();
  show('today');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
