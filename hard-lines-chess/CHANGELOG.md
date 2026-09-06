# Changelog

## 1.4.1 — 2026-09-06

### "Looked like 0", and the thing it was hiding
- **A game below the measured scale said "looked like 0".** estimateRating()
  clamps to the lowest band the calibration played, which is 0, so a rough game
  came back as elo 0 and the Progress page printed the number. Read on a phone
  that is not a strength, it is a missing value. The review panel described the
  identical estimate correctly as "under 300" — two places turned the same
  object into words and only one of them knew the floor existed. One function
  does it now, and all three readouts use it.
- **And the wording was hiding a real limit.** At the quick setting the weakest
  opponent this app has ever measured loses about 0.94 pawns a move. A player
  losing more than that lands below the entire scale, so every one of their
  games reads the same and the figure separates nothing. That is a fact about
  the measurement, not about the player, and the panel now says so — quoting
  the measured figure, which is carried through from the calibration at build
  time rather than typed into the sentence beside it.
- **No band is recommended off a floored estimate.** The nearest rung to elo 0
  is the weakest opponent on the ladder, which plays a random move three times
  in five. Offering that to somebody whose games the scale could not measure is
  the app acting on a number it has just finished explaining it does not have.
  It points at the ladder record instead, where the wins and losses are real.
- "They ranged under 300 to under 300" is a range of one thing said twice, and
  now reads "all under 300".

## 1.4.0 — 2026-09-06

### Your Chess.com games, brought in
- **Type your username and the app fetches your games.** Chess.com publishes
  every public game through an endpoint that needs no password and no account
  to connect. Archives are read newest month first, serially, up to a limit you
  pick, and the games are stored here.
- **This replaced a paragraph that said it was impossible.** The Review screen
  read "this page cannot reach Chess.com or Lichess directly — it is not
  allowed to make requests to other sites". That was true of Lichess and had
  stopped being true of Chess.com, whose archive endpoint sends the header a
  browser needs to read it. A page that tells you something is impossible while
  it is possible is worse than one that never mentioned it.
- **Not in the Android app, and it says so instead of failing.** The APK holds
  no `INTERNET` permission — that is the promise that makes everything else in
  it trustworthy — so there is nothing to fetch with. Pasting still works, and
  so does importing in the web version at the same address.
- Chess960, bughouse, games with no movetext and games you are not in are
  refused, and the summary says how many of each. **The numbers add up**: found
  is added plus already-here plus refused. The first version rolled two of
  those into one subtraction and announced, on a device that had never held a
  game, that three of them were already here.
- **Importing is not reviewing**, and nothing pretends otherwise. An imported
  game arrives with its moves, which is everything the repertoire report needs;
  Progress counts only games the engine has actually walked, and says how many
  are waiting.
- **"Walk the imported games"** does the reviewing in a queue: oldest first,
  saved after each, stoppable, and a game already walked is never walked twice.

### Where you leave the book
- **Every game you have played or pasted, walked against your own repertoire.**
  The app has had both halves of this since the openings went in and never
  joined them: 25 verified lines with 79 branches on one side, and every game
  stored with its moves on the other. Nothing asked whether the games were the
  lines.
- It is the question worth asking. Studying an opening you already play
  correctly is time spent on something that was not costing you anything; the
  move worth knowing is the one where you stopped following your own
  preparation, and you cannot remember it, because at the time you did not
  notice.
- The report names the opening the game followed **furthest**, which is the
  only defensible answer to "which opening was this" — nobody records what they
  meant to play, and the moves are what there is.
- **A transposition is not a deviation.** 1.e4 e5 2.Nc3 is not the Italian; it
  is the Vienna, which is also in the repertoire, and a player who plays it has
  not left their preparation. This was found by the test, which called the
  correct behaviour a failure until the test was fixed.
- **Whose divergence it was is not guessed.** A move of yours the book does not
  play is preparation you have not learnt. A move of *theirs* the book has no
  answer for is a gap in the repertoire rather than a gap in you, and is
  counted separately and never called a mistake.
- **What it cost is measured**: two searches of equal depth, one after your
  move and one after the book's, and the difference between them. The answer is
  allowed to be nothing — leaving your preparation is not automatically an
  error, and a screen that implied it was would be teaching obedience rather
  than chess.
- The same mistake in four games is one row saying four, commonest first, ties
  broken by the earlier move. "Learn this line" opens that opening at the
  branch and the move it went wrong on, rather than at the top of a line whose
  first six moves you clearly already know.
- Today carries the top row when it has happened more than once — the only row
  on that page derived from what you actually did rather than from a schedule.
- A game from a set-up position is left out: a line that did not start at move
  one cannot be compared with one that did. The most recent sixty games are
  walked, and the screen says sixty rather than printing a total from half a
  sample.

## 1.3.0 — 2026-09-06

Two screens for watching and reading, a navigation that fits a phone, and four
faults that measurement found rather than reading.

### Watch
- **Two bots, a move at a time, with the reason for each one.** Two bands off
  the ladder, drawn at random, given opposite colours and an opening neither
  picked; inside the search each side chooses freely among the moves it rates
  equal. Four dice, so the same two bands do not play the same game twice — the
  drive test plays three and checks all three differ.
- **Seven famous games, every move replayed before it ships.** The move lists
  came from outside this repository, which makes them the least trustworthy
  data in it: one wrong character in eighty-seven plies is a game that is not
  the game it says it is. tests/famous.test.mjs replays all 398 plies through
  the app's own move generator, and where the record says checkmate the final
  position has to BE checkmate. Where a player resigned, nothing here can check
  that — a resignation is a fact about a room — and both the file and the
  screen say so instead of implying the board proves it.
- The commentary has three sources and all of them are measured: the opening
  book's own note for the move just played, a curated note on a famous game at
  the moves that have one, and after every move a search deeper than the band
  that played it, printed as the difference in pawns. What it will not say is
  what the player was thinking.
- The pairing is capped at the 1700 band on purpose. The top bands get up to
  2.4 seconds a move, and a 2.4-second search on the page's own thread is 2.4
  seconds of frozen board — on a screen whose whole purpose is watching, that
  reads as a crash.

### Notation
- **A screen that explains algebraic, derived rather than written out.** You
  move a piece; the app writes the move down with the same toSan() the rest of
  it uses, and spellMove() takes that string apart and says why each character
  is there — from the position. The reason "Nbd2" has a b in it is that the app
  looked and found another knight that could also reach d2, and it names the
  square that knight is standing on.
- Fourteen lessons, each a position and a move in coordinates. The notation
  beside them is not typed into the app: it is written at render time, so a
  lesson whose claim stopped being true fails the build rather than teaching
  the wrong rule.
- A free board underneath: every move you play on it is named and broken apart,
  whether or not it was the one a lesson asked for. Refusing to name a legal
  move would be the screen failing at the one thing it is for.

### The navigation
- **Six tabs, not fourteen.** What is off the end of a scrolling strip is
  invisible, so a feature nobody scrolls to is a feature nobody has. The
  screens are grouped by what you came to do — Today, Play, Learn, Train,
  Watch, You — with a second row inside the groups holding more than one.
  Measured at 390px: 293px of buttons in a 358px strip.
- tests/nav-test.cjs walks every button there is and checks the set of screens
  it arrives at is all of them, so a screen added to SECTIONS and left out of
  every group fails the build instead of shipping unreachable.

### Four faults, and what found each one
- **Castling that gave check was written without the +.** toSan() returned
  early for castling, before the check mark was appended, so "O-O" where
  "O-O+" was correct — in the move list, in the review, in an exported game.
  Found by spellMove(), which is a second implementation of the same rules;
  tests/notation.test.mjs spells 1.4 million moves both ways and holds them to
  each other.
- **The evaluation had a colour bias.** Turn a position upside down, swap every
  piece's colour, and the score must negate exactly. It did not: one centipawn,
  on 337 of 7166 positions, always favouring White, because Math.round sends a
  half towards positive infinity. A comment already claimed the rounding was
  done to prevent exactly this. It said so; it did not do so, and nothing
  measured it. tests/eval-symmetry.test.mjs now does, at a tolerance of zero.
- **A timed round left running finished without you.** Leaving the Clock or
  Vision screen mid-round did not stop the interval: three minutes later the
  run ended on a screen nobody was looking at, wrote its summary and filed the
  result.
- **The service worker was registered where none exists.** The code leaned on a
  .catch() with a comment calling the failure "fine and silent". It was fine.
  It was not silent: a registration that 404s is logged by the browser before
  any promise can catch it, so every load of the single-file copy over http
  printed console errors nothing in the page could suppress. Found by
  tests/every-screen.cjs, which opens all fourteen screens twice — once empty,
  once with a week of use in the store — and fails on any error or any request
  the page made and did not get.

### Measuring the engine, which had to come before changing it
- **tools/match.mjs** plays two builds off against each other, colours
  alternating, each opening twice, and reports an Elo difference with a 95%
  interval — saying "NOT SEPARATED" when the interval spans zero rather than
  reporting a small win as a win.
- **tools/verify-candidate.mjs** asks what a match cannot: perft on the five
  standard positions, no illegal move across several hundred searches, and all
  42 forced mates in the bank still found and still reported as mates.
- **tools/depth-probe.mjs** says WHERE a change paid, in twenty seconds rather
  than an hour.
- A candidate carrying null-move pruning, principal variation search and check
  evasions in quiescence is in tools/engine-candidates/. It is correct by the
  verifier. It is **not shipped**: see ENGINE-NOTES.md for what it measured and
  why that is a reason to fix it rather than to install it.

## 1.2.0 — 2026-09-06

Four new screens, and the coach now works where there is no model to ask.

### Endgames
- Positions with a technique attached, played out against a defence that does
  not help. It grades the MOVE rather than the result: in a king and pawn
  ending the app knows the exact value of every position, so the moment a win
  becomes a draw it says so on that move, and a take-back puts the win back.
- **King and pawn against king is solved rather than searched.** All 393,216
  positions are worked out by backward induction in about a second the first
  time one is needed. This was not an optimisation. The search is not merely
  imprecise in these endings, it is wrong: shown the textbook drawn opposition
  it calls it +10.3 for White, and asked to defend it, it answered 1.Kf6 with
  1...Kd7?? and was mated. A trainer refereed by that hands out wins in drawn
  positions and calls bad technique good.
- Where an endgame is refereed by the search instead — a rook or a queen up,
  where the advantage is enormous and the goal is a fact about the board — the
  screen says so rather than implying a precision it does not have.
- Writing the bank corrected it twice. The opposition position was described as
  being about who moves first; it is not. Two of its eight moves win and six
  draw, and the natural pawn push is one of the six. And the first rook-pawn
  position had two legal moves, both drawing — a lesson with no choice in it is
  not a lesson.

### The lessons, checked rather than written
- **The rook ending came out.** The Lucena was the eighth endgame and the app
  cannot referee it: asked to convert it the search gives the pawn away, the
  bridge the lesson taught costs it two hundred centipawns of its own
  evaluation, and the goal the exercise set — promote the pawn — is not reached
  by best play. A lesson whose method the app disagrees with and whose goal it
  cannot reach is not a lesson. Rook endings need either a table this app does
  not have or an engine it is not, and the file says so where the lesson was.
- **Every exercise is now played out to its goal in a test.** Everything else
  checks the starting position — its material, its side to move, its result —
  and none of it asked whether playing well from there reaches the goal within
  the moves allowed. That is the check that found the Lucena, and it found a
  second thing on its first run: the rook mate allowed twenty moves, which is
  what good technique needs and not what this app's own best play manages. It
  takes twenty-one, so the exercise was one the app itself could not pass.

### The clock
- Three minutes, one position after another. A wrong move costs ten seconds
  rather than ending the run, because the thing that improves is how many
  positions you get through, so the punishment is in the same currency as the
  reward.
- Your own tactics come first, then a starting bank generated by the app's
  engine playing itself and mined by the same review that mines your games —
  each one re-checked at greater depth than the review that found it. The
  screen says which of the two every position came from, every time.

### Progress over time
- The Progress tab said what your mistakes had in common and never whether
  there were fewer of them than there used to be. Accuracy, mistakes a game and
  the strength estimate are now plotted across reviewed games; all three were
  already stored on every review and none had ever been shown against time.
- It refuses to overclaim: under three scored games it draws nothing, under six
  it calls a difference a difference rather than a trend, and where the halves
  are close it says flat instead of finding a direction in noise.

### Board vision
- Thirty seconds of three questions: tap a named square, name a ringed one, and
  say whether a square is light or dark without looking. Either way up, because
  the coordinates people lose are the ones on the other side of the board.

### The coach knows what the board knows
- The bundle the coach answers from contained the search and nothing else, so
  three things the app already measures were being inferred instead of read:
  **what the opponent is threatening** (found by passing the turn, which is
  what the board's own Insight mode draws in blue), **what is attacked and
  undefended**, and **what kind of mistake a named move is** (found by the same
  classifier the review uses). All three are in the bundle now, which means
  both narrators get them — the model was guessing at forks and pins too.
- "Why not Ng5?" used to answer with a number. It now answers "their queen on
  g5 pins your pawn on d2 against your bishop on c1", because that was
  measured on the board rather than deduced from a line.
- Asked what the opponent threatened, the on-device coach used to give the
  second move of its own best line — which is a reply to a move you have not
  made — and said so, because it was not an answer.
- And the answer now comes first. A question about a threat was opening with
  the material count and reaching the threat three sentences later; the rules
  the model is given say to lead with the answer, and the function has to do
  the same or it is a worse coach than the one it replaced.

### The coach, without a model
- The coach was hidden wherever Claude could not be reached, which is every
  installed copy: the APK holds no internet permission and a saved file has no
  runtime to ask. It is now answered on the device instead.
- The model was never the part that knew anything. The bundle it was sent
  already contained the search, the material, the top four lines and every
  named move's refutation, each turned into English by the same function the
  review uses. Choosing which of those answers the question and writing it as
  sentences is a function, and now it is one. Same bundle, same search, plainer
  prose, no network.

### Wrong on screen
- **A timed round was mostly below the fold.** Both new clock screens put an
  explanatory panel and their settings above the board, so the clock, the
  score, the question and the board itself were all off a phone screen while
  the clock ran — thirty seconds of a thirty-second round spent scrolling. The
  setup collapses while a round is running and the live panel comes first.
- **The clock screen contradicted itself**, still reading "there are no
  positions to run" in the middle of a run, because nothing asked it to say
  otherwise once one had started.
- **Every point on the progress chart was an ellipse.** The chart is stretched
  to the width of its panel with `preserveAspectRatio="none"`, so with nine
  games one unit across is about ninety times one unit down, and a `<circle>`
  drawn in those units came out as a red bar the width of the panel. Points are
  zero-length lines with round caps and a non-scaling stroke now, which is a
  circle measured in screen pixels. The review curve's own dots had the same
  fault for the same reason and are fixed with it.
- The chart's axis labels read "oldest · 62%" at one end and "86% · newest" at
  the other, which parses as the oldest game having scored 62%.
- **The tab strip was cut through the middle of a word.** Twelve sections do
  not fit across a phone; the strip has always scrolled, but nothing said so,
  and the selected tab was regularly off the side after any screen sent you
  somewhere. There is a fade while there is more to the right, and selecting a
  section scrolls its tab into view.
- The endgame verdict — the whole point of that screen — sat in a side panel
  below a full-height board, so on a phone the one thing worth reading was the
  one thing off screen. The goal is above the board now, and the verdict, the
  move count and the buttons are directly under it.
- The endgame verdict counted in plies. Nobody sitting at a board counts in
  half-moves.
- Coach lines came out as dead text rather than as buttons that play them.
  `lineToSan()` writes lines the way a human reads them — "4... Qxg5 5. O-O" —
  and the renderer feeds each token to `sanToMove()`, where "4..." is not a
  move. The model was told to strip the numbers; nothing was telling the app.
- A take-back in the endgame trainer, pressed while the defence was thinking,
  did nothing at all and then had a reply land on the move it was trying to
  undo.

### Moved
- `lineToSan()` from `app-d.js` to `notation.js`. It is notation written from a
  position, like `toSan()` beside it, and it was in a file that cannot be
  loaded without a DOM — which the puzzle generator, which walks games in node,
  needs it to be.
- `build.py` strips `export` from every file it concatenates rather than only
  the two engine ones, so a file can be both a module the tests import and a
  fragment of the page's one script.

## 1.1.1 — 2026-09-06

Both ways of getting the app onto a phone were broken in ways the build called
a success.

### The site served a 404
- The Pages deployment reported success and served nothing. The repository's
  Pages source was still "Deploy from a branch", so GitHub's own Jekyll builder
  ran alongside the workflow, built the repository root — which has no
  `index.html` — and, finishing last, won. Nothing in either run said so.
  The source has to be **GitHub Actions**; the README says so now, and the
  workflow **fetches the deployed page** and fails with that instruction when
  what comes back is not the app. A deployment nobody fetches is a deployment
  nobody has checked.

### The download stuck
- The APK was published only as a release asset, which GitHub serves from a
  different host to the page. A VPN, a filtered DNS or a captive network can
  stall that redirect with no error — a download that sits at nothing for ever.
  The APK is now also a plain file beside the page, on the same origin, so a
  phone that can reach the site can reach the app. Both links are given, and
  the workflow checks the served file really is a zip.

### Wrong on screen
- The service worker cached **every** successful navigation under the shell's
  name, whatever came back. One navigation to anything else on the origin
  replaced the app in the cache with that thing, and the next opening without a
  signal served it — so after tapping the download link, an offline open showed
  the download instead of the app. Only an HTML answer is the shell now, and a
  `.apk` is not the worker's business at all. Pinned both ways by
  `tests/sw-shell-test.cjs`, which fails against the old worker.

### The next update would not have installed
- `versionCode` came from the workflow's run number, which is per-workflow and
  restarts when a workflow file is renamed. Merging `pages.yml` and
  `android.yml` into `publish.yml` reset it, so the build after the rename
  shipped versionCode 2 to phones already holding 5 — and Android refuses a
  lower code as a downgrade, with no useful message. It now comes from the
  commit's own timestamp, which cannot restart and is the same for every build
  of a given commit.

### Housekeeping
- `pages.yml` and `android.yml` are one `publish.yml`, because the site now
  carries the APK and the two could not be built independently.

## 1.1.0 — 2026-09-06

The app becomes an app you can install on a phone, by two routes. The chess is
unchanged; the engine, the ladder, the openings and the review are the same
code, built the same way.

### Two ways to get it on a phone
- The installable kit is published to a web address on every push, so a phone
  can install it. It was buildable before and served nowhere, and a browser
  will not install an app from a file — which meant the whole `pwa/` directory
  did nothing that a saved copy did not.
- An Android APK: the same single-file app inside a WebView, attached to a
  release at an address that does not change. It carries **no internet
  permission at all**, so the claim that everything runs on your own device is
  enforced by the system rather than promised in a README. The two fonts the
  page linked from Google are bundled and answered locally, and every other
  request is refused rather than fetched.
- Both build from source rather than from the committed `dist/`. Publishing
  what happens to be committed is how a stale page ships with a fresh service
  worker, which is the one thing that worker's version stamp exists to prevent.

### Wrong on screen
- Inside the Android app the "Take it with you" panel offered to install an app
  that was already installed, and to save a copy of the app you were holding.
  Neither could be detected from the address, because the wrapper serves the
  page over https on purpose — a `file:` page has an opaque origin and the
  browser storage every saved game lives in is unreliable there. The wrapper
  marks its user agent instead and the panel says the true thing, pinned by
  `tests/android-app-test.cjs` on both sides of the marker.

### Android specifics
- Rotating the phone, or the system turning dark at sunset, no longer restarts
  the activity — a restart reloads the page, and the game on the board goes
  with it.
- A WebView answers `prefers-color-scheme` with "light" whatever the phone is
  set to unless the app opts in, so the app opened in daylight on a dark phone.
- From Android 15 an app draws behind the status bar whether it asks to or not,
  and the page has no safe-area padding, so its top row sat under the clock.
  The bars are padded around instead.
- Back goes back in the page, then asks a second time before leaving; a game in
  progress lives in the page rather than on disk.
- The engine's timers stop when the app is not in front.
- Every build is signed with the same committed key, so an update installs over
  the old app and the saved games survive. The key is public and protects
  nothing; `android/README.md` says exactly what that does and does not mean.

## 1.0.0 — 2026-09-05

First release. A review by four independent passes found 38 reproducible bugs
in the pre-release code; every one is fixed here and pinned by a test or a
reproduction script under `tests/`.

### Data and game integrity
- A game was recorded twice when the opponent's clock flagged during its reply pause; `finishPlay` is now the only place a game ends and every deferred callback checks for it.
- A checkmated final position was scored as equal; it now scores as mate, a mating move is never a mistake, and the curve, bar and readout show it.
- The promotion picker could outlive its position and place a colourless piece; the board refuses moves by the wrong side and the picker is tied to the position it opened on.
- Drills with a missing or partial spaced-repetition card threw or retired themselves; cards are normalised on read and documents are versioned.
- An older copy in the account store could overwrite a newer local one; both carry timestamps and the newer wins, with failed writes retried.
- Castling rights were never reconciled with the board; a FEN with rights but no rook is now corrected and the correction reported.
- Take-back returned clock increment; clocks are stored per ply and restored.
- Changing the band mid-game changed the opponent; the opponent is frozen at the start of a game and the picker starts a new one.
- Fewer than ten judged moves produced a perfect accuracy and a strength estimate; both are now withheld and the reason stated.
- The installable kit's service worker never updated; its version is a content hash stamped at build time and the shell is served network-first.
- After any finished game, the first "New game" gave a board with no legal moves.

### Wrong on screen
- The coach's "back to the position you asked about" button did nothing.
- A failed coach call left a dangling turn, so the next question was refused.
- "Why not X?" was asked on the position after X.
- On a checkmated position the coach bundle claimed "roughly equal, 0 plies deep".
- The threat readout dropped the sign of the evaluation.
- The hanging-piece ring was the same colour as the dark square.
- In Test-me mode the branch panel printed the line under test.
- Opening cards were re-scheduled on every clean run, including same-day repeats; cards are now per branch and confirm rather than advance within a day.
- An unfinished game (`*`) was reported as truncated; so were `0-0` and `e8Q`.
- Blunder rates under one percent were rounded up in the band notes.
- The settings specimen promised a check it did not draw.
- The opponent book stayed off for the session after the first game was stored, and filed set-up games under standard-start keys.
- A floor-clamped estimate of zero fell out of the rolling median.
- A tactic whose reply was unreadable was reported as "the game ended".

### Robustness and strength leaks
- The teaching coach's look ran on the player's clock and could flag them; it now runs on nobody's.
- The coach's deep searches primed the opponent's transposition table; the coach has its own engine.
- A problem taken back past its ply was orphaned; it is withdrawn and the spacing gate re-armed.
- Threefold repetition was missed after a double pawn push; the en-passant square is only hashed when a capture is possible.
- Transposition-table keys were 32-bit and mate scores were stored ply-relative; entries carry a verification word and mate scores are adjusted at the boundary.
- Two coach line buttons pressed quickly interleaved into a line neither offered.
- A copy saved from the installed kit was itself uninstallable.
- The board rebuilt all 64 squares on every tap; it now diffs in place.
