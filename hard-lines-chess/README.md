# Hard Lines Chess

A single-file chess trainer that runs entirely in the browser: its own engine, a
22-level opponent ladder, an analysis board with engine suggestions and insight
modes, 25 openings with variations and per-move explanations, game review with a
win-chance curve and motif classification, tactics puzzles mined from your own
games, spaced-repetition drills, a teaching opponent that sets traps, an endgame
trainer refereed by a solved table, a three-minute timed mode, a board-vision
drill, a screen that explains chess notation by taking your own moves apart, a
watch mode that puts Stockfish on the board — against Reckless, any level, or
itself — and explains every move it and its opponent make, plays two levels
against each other and replays seven famous games move by move, a report that
checks your own games against your repertoire
and names the move you keep leaving it on, an importer that fetches your public
Chess.com games — with their ratings and clocks — and a coach that explains
positions from engine output, with or without a model to write the sentences.

Everything is one HTML file, except the two engines the Watch screen puts on
the board: Stockfish is two more files beside it, and Reckless is a 44 MB
download the website version fetches the first time somebody asks for it.
They are the one part of the app that needs a real web address rather than a
file opened from disk. It all works offline once loaded and can be installed
as an app from any web address.

## Two rules

**The engine is the source of truth. The model is the narrator.**

Nothing on screen is a model's opinion about a position. Evaluations, best
moves, tactics, motifs and traps are all measured by the engine on the board;
the coach turns verified engine output into English and is never asked to
evaluate anything. Where a measurement cannot support a figure, the screen says
so instead of printing one.

**The engine is budgeted in positions, never in milliseconds.**

Every search — the opponent's, the reviewer's, the coach's, the trap-setter's —
is given a number of positions to look at. Not a number of seconds. A budget of
seconds is a budget of whatever the machine manages in them, and two things
followed from that:

- Reviewing the same game twice gave a different accuracy and a strength
  estimate that moved by **up to 220 rating points**, measured over five runs
  at one setting. A progress chart built out of those is partly a chart of the
  machine.
- A level labelled 1500 was a materially weaker opponent on a phone than on a
  laptop. One word, two different players.
- The trap coach needed 30,000 positions to see the refutation of the oldest
  trap in chess. In 150 milliseconds a phone was nowhere near it, so the lesson
  was silence on a phone and a lesson on a laptop — and at the shallow end it
  offered the trap itself as the answer.

Same position, same budget, same answer, on any device. `tests/repeatable.test.mjs`
holds it to that: 48 searches repeated four times, and the same game reviewed
three times agreeing to the last move, the last mark on the curve and the last
rating point. The wall clock survives only as a twenty-second backstop, and a
search it stops says so rather than passing off short measure as the answer.

## What it says about you

Four screens answer "am I getting better", and they are careful about which of
them is this app's opinion and which is not.

- **Your Chess.com rating** is the one line on the Progress chart this app did
  not produce. Imported games carry the rating you held for each, and it plots
  over every game rather than only the analysed ones.
- **The strength estimate** compares a game's average loss per move with games
  this app's own opponents played against each other. It is a comparison with
  this app's levels, not a rating, and the screen says so every time.
- **What your own games say** is the better answer when there is enough to give
  it: your own rated games that lost about as much per move as this one, and
  what you were actually rated in them. Nearest neighbours rather than a fitted
  curve, because a curve has to be extrapolated to answer anything outside the
  range it was fitted on — and one player's rating over one season is a narrow
  range. It also checks its own premise: if the games where you lose less are
  not the games where you are rated higher, it says so rather than printing a
  number, and what counts as evidence scales with the sample.
- **Where your time goes** joins the clock in the movetext to what each move
  cost, grouped by seconds spent and by time left. Bullet, blitz and rapid
  filter apart across the whole screen, because averaging them describes
  nothing anybody played.

The three review settings are 25,000, 80,000 and 250,000 positions a move, with
a depth cap of 7, 9 and 12 behind them that rarely binds — measured here, a
depth-9 search ranges from 15,607 positions to 15,026,933, so the work budget is
what decides. The ladder runs from 6,000 positions at the bottom to 240,000 at
the top: what a mid-range phone got through under the old millisecond ceilings,
so the phone plays the ladder it always played and every other device now plays
that same ladder instead of a stronger one wearing its labels.

Games reviewed before this change have no budget recorded, and the strength
panel says how many of them are in the figure rather than averaging the two
kinds together in silence.

A reviewed game keeps the evaluation after every move and one character per
move saying what the reviewer called it — about 180 bytes for a 33-ply game,
against about five kilobytes to store the judged moves whole. That matters
because games live in local storage, which holds about five megabytes in total.
Everything else is replayed from the moves the game already had, so any game in
your history reopens with its curve, its move list and its board, without being
analysed again.

## Interface

Quiet surfaces, hairline rules, soft corners, one accent, and a green board
that keeps its colours at night. Inter for text; monospace (JetBrains Mono) only
for notation, where fixed-width glyphs earn their place. On a phone the six
sections are a bar fixed to the bottom of the screen with an icon over each
label; the second level is a segmented control at the top of the content. On a
wide screen the same nav is a row of text tabs under the brand.

Short labels first, long explanations behind an ⓘ. Everything this app knows
about why a number means what it means is still on the screen that shows it —
it is no longer between you and the button.

## Layout

```
src/            the app, as concatenated by build.py (order matters; see build.py)
src/engine/     0x88 board, alpha-beta search with TT/LMR/quiescence, the levels
src/openings.js 25 openings, 79 variations — verified by tests/verify-openings.mjs
src/famous.js   7 famous games, every ply replayed by tests/famous.test.mjs
src/notation-lessons.js  14 notation lessons, each checked against the engine
src/store.js    where progress is kept: the large database, the move out of
                localStorage, and the spaced-repetition scheduler
src/backup.js   the backup file: saving, checking, restoring, undoing
src/pgn.js      the PGN reader, and the clocks in the movetext that it strips
src/review.js   the reviewer, the compact per-game format, and what your own
                rated games say about a game (see "What it says about you")
src/engine-pool.js  this app's engine in workers, several searches at once
src/weak-spots.js   puzzles aimed at what your games go wrong in: reading the
                pack, what to aim at, which puzzle next, your level on them
src/daily.js    one session a day: what goes in it, and how many days running
src/patterns.js what keeps happening: how often each kind of mistake comes up,
                whether it is getting rarer, positions gone wrong in twice
src/maia-net.js a small neural network, read and run: the file the human-like
                opponent is, and the sums, with no chess in them
src/maia.js     the chess on either side of that: how a game is shown to the
                network, which number is which move, how a move is chosen
src/deviation.js where your games leave your repertoire, and what it cost
src/import.js   the Chess.com archive reader (browser only; the APK has no network)
src/pawn-tb.js  king and pawn against king, solved exactly (see below)
src/endgames.js the endgame positions, each with the referee that grades it
src/puzzle-bank.js  generated by tools/make-puzzles.mjs; committed, not built
vendor/puzzles/ the puzzle pack for the Weak spots screen, chosen from the
                Lichess puzzle database by tools/make-puzzle-pack.mjs
vendor/maia/    the nine Maia networks the human-like levels are, as published
src/head.html   the design system: tokens, components, both themes
pwa/            manifest, service-worker template, icons
android/        the WebView wrapper that makes the APK (see android/README.md)
tools/          rating calibration, icon generator, self-play PGN generator,
                and the engine measurement kit — match.mjs, verify-candidate.mjs,
                depth-probe.mjs (see ENGINE-NOTES.md)
tests/          node unit tests (*.mjs) and Playwright browser drivers (*.cjs)
dist/           build output (committed so the repo is usable without building)
```

`.github/workflows/publish.yml` builds both and publishes them together: the
installable kit and the APK go to the same web address, and the APK is also
attached to a release. It builds from source rather than from the committed
`dist/`, because a build that ships whatever happens to be committed can ship
an older game than the source — and it fetches the deployed page afterwards,
because a deployment nobody fetches is a deployment nobody has checked. It also
checks the APK contains the app and every font the page asks for, because a
wrapper that installs and opens on a blank screen is invisible from a green
build, and that the networks the human-like levels are (below) are in it byte
for byte.

The node suite runs there too, beside the APK build rather than in front of it,
and nothing is published until it passes. Building proves the page builds; it
does not prove the page works, and a suite that only ever runs on someone's
laptop is not protecting the thing that reaches the phone.

The repository's Pages source must be set to **GitHub Actions**
(Settings → Pages → Build and deployment → Source). On the default, "Deploy
from a branch", GitHub runs its own Jekyll build of the repository root
alongside this workflow, and — having no `index.html` there — serves a 404 over
the top of whatever was deployed.

## Build

```
python3 build.py
```

Produces three things in `dist/`:

| file | what it is |
|---|---|
| `hard-lines-chess-app.html` | the standalone app — one file, open anywhere |
| `hard-lines-chess.html` | the same as a body fragment, for hosts that wrap it |
| `pwa/` | the installable kit: index.html + manifest + service worker + icons |
| `stockfish.js`, `stockfish.wasm` | Stockfish, beside the app and in `pwa/` — see below |

The rating estimate's fit is read from `tools/rating-calibration.json` at build
time. Without it, no estimate is shown anywhere.

The two fonts are the only thing the page fetches from elsewhere, and it works
without them. The APK, which has no network at all, bundles them in
`android/app/src/main/assets/fonts/` and answers the page's own request for the
stylesheet from inside itself.

## Stockfish

The Watch screen's strong side is Stockfish 19 — the Lite, single-threaded
WebAssembly build, 1.8 MB, run in a Web Worker so the page never waits on it.
The files are vendored in `vendor/stockfish/` with their provenance, checksums
and licence; `build.py` copies them beside the app, the service worker caches
them, and the Android build packs them into the APK, where `MainActivity`
serves the `.wasm` with the type WebAssembly insists on.

It plays by the same rule as everything else here: **positions, not seconds.**
Every search is 250,000 positions from a cleared table, so a game explained on a
phone is explained in the same words on a laptop. It is told the whole game,
not just the position, so it can see a repetition coming. Each position is
searched once, with its three best lines, and that one analysis is both where
Stockfish's move comes from and half of the explanation of the move that led
there.

**Every move is explained from things that were measured.** Stockfish's own
analysis either side of the move — its choice, the line it expects, how it
scores the position and its next two candidates — and the board: what the move
takes, attacks and threatens, counted with the move generator, and any fork,
pin, skewer or mate that the motif classifier proves by replaying the line. A
motif that is true but beside the point (a pawn pinned to a knight, a knight
"skewered" with a pawn behind it) is not said. What the screen will not do is
give a strong move a plan the line does not show; its honest explanation is
the line and the number. `tests/explain.test.mjs` pins the wording from canned
analysis, and `tests/stockfish-watch.cjs` plays real games with the real engine
and reads every explanation back off the screen.

## Reckless

Stockfish's opponent at the top: Reckless, one of the two strongest engines
there are, built for one thread in WebAssembly from a pinned commit with one
six-line change, and vendored in `vendor/reckless/` with the build script,
checksums and licence (AGPL). It gets the same budget as Stockfish, 250,000
positions a move, from a cleared engine, told the whole game. Its moves are
explained from its own analysis — its line is its reason — and Stockfish's
opinion of each is the verdict; neither is called a mistake for disagreeing.

**Website only, fetched when asked for.** It is 64 MB, almost all network
weights, so it is not in the APK (which may connect to nothing but Chess.com's
archive of games, and so has nowhere to fetch it from) and not in anybody's
download until they pick it. Then it arrives as 16
gzipped pieces, 43.8 MB, each checked against its checksum and kept as it
arrives, so a connection that drops loses only the piece in flight and the
next press of the button carries on from there. A piece that goes twenty
seconds without a byte counts as stalled and is asked for again. It is kept in
a cache of its own that app updates leave alone, and it works offline after
that. `tests/reckless.test.mjs` checks the vendored pieces and runs the engine
in node; `tests/reckless-watch.cjs` cuts a download off halfway, carries it on,
publishes a new version of the app under it, takes it offline and plays.

## An opponent that plays like a person

The ladder's levels are this app's engine turned down: it calculates, and now
and then it is made to play a random move. That is a way of being weak, and
it is not how people are weak. Nobody rated 1100 plays a random move one time
in fourteen. They miss the fork, take the pawn that was bait, and play the
natural move in the position where it loses.

So the Play screen has a second kind of level, "Human-like 1100" to
"Human-like 1900". Each is a network from the [Maia project](https://maiachess.com)
(McIlroy-Young, Sen, Kleinberg and Anderson, 2020), trained on Lichess games
between players of one rating to say which move such a player makes. It does
not search and has no view of who is winning; it gives, for every legal move,
the share of those players it expects to play it. The nine files are in
`vendor/maia/` exactly as published (GPL-3.0), each checked against its hash
by the build.

**The number is theirs, not its own.** A ladder level's number is a target a
setting was aimed at. This one is the Lichess rating of the players the
network learned from — not a strength anyone measured for it, and not a
Chess.com number. The screen says so where the level is chosen.

**It is run here, not by an engine.** The files are in the format of the
Leela Chess Zero engine, which is what they were made to be run by. The
network is small — six blocks of sixty-four filters, about forty million
multiplications a position — so `src/maia-net.js` reads the file and does the
sums in ordinary JavaScript: a few hundredths of a second a move on a laptop,
on the page's own thread, after the player's piece has finished sliding. No
library, no WebAssembly, nothing that is different on a phone.

**It has to be shown the game exactly as Leela shows it,** because a network
shown a position any other way still answers, with a legal move, every time —
a worse one, and nothing on the screen says so. `src/maia.js` draws the
position Leela's way (eight boards of history from the mover's side) and
numbers the moves Leela's way, and three things hold it to that:

- which number is which move is checked against Leela's own table of all
  1,858 moves, kept in `tests/fixtures/lc0-policy.json`;
- the sums are checked against the same sums done the plain way, on made-up
  networks small enough for every number in the file to be known;
- and the real networks are asked what people are known to do. Every one
  opens 1.e4 most often — about two games in three at 1100, falling to 56% at
  1900 as more of them play something else. A mate in one on f7 is found by
  seven in ten of the 1100s and nine in ten of the 1900s. And nearly all of
  what a network says is about moves that can be played: in the usual
  position from seven master games, over 98%. Shown the board wrongly, it is
  not.

**From a set-up position there is no history,** and what stands in for it
matters. Shown an empty past in the middle of a game, a network's first
choice was the one it makes with the real past in about three positions in
ten; shown the position repeated, which is what Leela does, in about eight in
ten (107 positions, three networks). So that is what is done.

**It does not always answer the same way.** Maia's own bots play the
likeliest move every time, which makes them the same game for ever. Here the
move is drawn from the likely ones — those at least one such player in twenty
would make — in proportion to how likely each is. Beside the board, where the
ladder shows an evaluation, it shows what share of such players make the move
it just made.

**Where the networks are.** The Android app has all nine inside it, 11.6 MB,
because it can fetch nothing. The website fetches one the first time its
level is chosen, 1.2 to 1.3 MB, and keeps it in a cache of its own that an
update of the app leaves alone, so it works with no connection after that. A
network that cannot be fetched is said, by name, and the next game tries
again. A copy of the page opened from a file has none, and its list is the
ladder alone.

Games against these levels are kept as what they were: a record of their own
on Today, never mixed into the ladder's, and named on Progress. The opening
book of your own games, the coach, take-backs and set-up positions all work
as they do against the ladder.

`tests/maia.test.mjs` is the first three of those checks. `tests/maia-drive.cjs`
plays against the real networks in a browser and holds every reply to the
same network run outside the page on the same moves — including one move
chosen because the history changes the answer, so that a page showing the
network only the last position would fail. What has not been measured is how
strong each level actually is, and how long a move takes on a real phone:
with the browser's processor slowed sixfold to stand in for one, it was about
a sixth of a second.

## Who judges a review

A game can be judged by this app's own engine, by Stockfish, or by Reckless —
picked beside the depth setting, on Review and on the walk, and remembered.
`reviewGame()` asks each the same two questions — what is this position worth
and what would you play; and, where a tactic is claimed, how far apart are the
best two moves — and treats the answers identically, so reviews by two judges
differ only in how right the answers are. `tests/judge.test.mjs` holds that to
account: a stand-in judge answering in UCI from this app's own engine must
produce a review identical to the engine's direct one, to the centipawn.

**A stronger judge finds more.** The same game scores a lower accuracy under
Stockfish than under this app's engine, so the judge is stored with every
game, Progress says when the games in view were judged by more than one, the
comparison with your own rated games only ever uses games judged the same way,
and the walk offers to judge again any game judged by someone else. Each judge
has its own strength-estimate calibration, measured on the same games (see
below): Stockfish's reaches level 1800 where this app's engine stops at 1200
— 1500 at the Deep setting —
and Reckless's reaches as far but fits more loosely. A judge without a
calibration gives no estimate rather than another judge's.

**The same rules otherwise.** A number of positions a move, never seconds; the
engine cleared before every position; the game from its first move. A game
judged twice by Stockfish is judged the same way twice. Reckless as a judge is
the website's, as on Watch — downloaded the first time it is picked.

**Judging again replaces everything, together.** Whether a game is judged
again by the walk or reviewed again on Review, one function writes the new
judgement onto the stored game: accuracy, mistakes, the curve and the marks
behind every chart, the setting, the budget and the judge, all at once, so no
screen can read one judge's curve beside another judge's accuracy. What the
game is (when it was played, where it came from, the rating and the clocks)
is kept. A game reviewed again takes the place of its earlier review instead
of being counted twice, and a game pasted into Review and later imported from
Chess.com is recognised by its moves and joined to that review, gaining the
link, the rating and the clocks. Its drills follow: a drill made from the old
judgement asks for the new judge's move, or goes if the new judge does not call
that move a mistake, and says whose answer it is. The strength estimate on
every screen is worked out from the calibration when it is shown, for every
game measured under the budget the calibration was measured at, rather than
read back from when the game was stored. If the judge stops partway through a walk, the
walk stops there and every game it had not finished is left exactly as it
was. The walk also offers games analysed before the move by move record was
kept, and walks them again at the setting they were measured at, so they
reappear in "Where your time goes" with the same figures.
`tests/rejudge-drive.cjs` checks this: a history walked by this app's engine
and then judged again by Stockfish must end up identical to the same games
judged by Stockfish from the start. That covers every stored figure, every
chart and panel on Progress, the reopened review and the drills.

## Where your data is kept

Everything the app knows about you — games, drills, puzzles, openings
progress, settings — lives on the device, in twelve areas listed once as
`STORE_AREAS` in `src/store.js`.

**In the browser's large database, not localStorage.** localStorage holds about
five million characters for a whole site. Measured: an analysed game takes
about 6,400, so the next save was refused at around 800 analysed games — the
import offers 1,000 — and from then on the app carried on and saved nothing.
IndexedDB is limited by free space instead: 1,500 analysed games (6.9 million
characters) save in 45 ms and are there after a reload.

**The move is made one area at a time, and nothing is removed until its copy
has been read back.** An area found in localStorage is written to the database,
read back, compared character for character, and only then removed. If the
database refuses the write, or hands back something else, the old copy stays
where it is and the session runs on it. And once the database has been used on
a device the app never falls back on localStorage: if the database would not
open one day, falling back would show an empty app, let it be used, and save
that state under today's date — which the next good load would prefer to the
real history, as the newer copy. It says the data could not be opened instead,
and saves nothing. One area that will not read is treated the same way: the
session stops there rather than open that part of the app empty.

**A save that fails is said, and heals.** The "Your data" line on Today reads
the true state every time it is drawn. Every area is written whole, so when a
later save works the areas that were owed are written there and then, and the
warning goes when nothing is owed.

**A backup file.** "Save a backup file" writes all twelve areas to one JSON file.
"Restore from a backup" checks the file before touching anything, says what it
holds and what is in the app now, and replaces one with the other under a
single transaction — all of it or none — keeping what was there so the restore
can be undone. It replaces rather than merges on purpose: merging two histories
means guessing, for every game and drill in both, which copy is the real one,
and a wrong guess is a game counted twice on every chart. The web version and
the Android app are separate places that cannot see each other, and the file is
what carries a history from one to the other.

**A copy with nothing in it says so.** A newly installed copy is empty, and it
used to look exactly like one whose history had gone — the same empty Progress
page, the same "No games reviewed yet". That was taken, once, for the loss of
everything: the games were in the web version and the Android app had just been
installed. So a copy that holds nothing anybody has made in it (`copyHoldsNothing()`
in `src/backup.js`: no game, drill, puzzle, opening practised or session — a
setting is not a thing made) says at the top of Today that nothing is stored in
it yet, that other copies keep their own data and still have it, and how a
backup file brings a history across, with the button that restores one. The
Android app adds the date it was put on the phone, which it asks Android for:
an app that arrived today has never held anything. "Your data" says what the
copy holds in numbers, and the Progress page says in a sentence that the copy
is empty. And each copy names itself at the bottom of Today — "the web
version, installed as an app" or "the Android app, version …" — because "an
installed app" describes both and they keep their data apart.

**And a copy that could not open its data says that instead, on every screen.**
A session that is stopped because its data would not open draws every screen
empty, by design. What had happened was said in one line at the bottom of
Today. It is now above whichever screen is open (`renderStoreAlert()`), with a
button that tries again; a session whose saves have started failing and a
database that has been cleared are said there too. The store tells the page
whenever any of that changes (`Store.onState`), so the warning appears on the
screen that is open when a save fails, and goes when the saves catch up.

In the Android app, where a page can neither start a download nor open a file,
`MainActivity` does both through the system's own file chooser, which needs no
permission. Text crosses between the page and the app 200,000 characters at a
time, in both directions, and a piece never ends halfway through a character.
On the app's side nothing is ever held whole in memory: each text goes to a
file as its pieces arrive and comes back from one a piece at a time, so a
backup can be made of a history of any size.

**A phone can clear the database, so the Android app keeps a copy of its own.**
A browser may clear a site's database when the device is very short of space.
A website can ask to be spared (the app asks, after an import, a review or a
backup); a page inside an Android app cannot. What a phone does leave alone is
an app's own files. So whenever the Android app is left, and every ten minutes
while it stays open and something has changed, the page hands the app a copy
of everything, in the backup file's layout, and the app keeps it in its
private files. A load reads it back only when it may hold something the
database does not — the database is new, or the last copy was told to hold
something newer than the database now does, which is what a refused save looks
like afterwards — and then the newer of the two wins, area by area. Nothing is
asked, because there is no decision in it; the page says what happened. Dates
only go forward, so a clock put back cannot make an older copy look newer. A
copy that would not read is never written over, and where the database was
cleared the session stops rather than carry on empty — twice; a copy that will
not read a third time running is given up, and the page says what was lost.
Only where something is known to have been lost, though: the first time a
version with the database opens, the history still has to move across from
localStorage, and no trouble with the copy, or with the way to the app, can
stop that. It is not a backup: it is on the same phone and goes when the app
goes.

Where there is no such copy — any browser — a database that has been cleared
is at least said to have been: the note that it was once used is kept in
localStorage, which is not cleared with it, so the page can tell "cleared"
from "first time here" and says what brings the history back.

`tests/storage-drive.cjs` does all of this in a real browser, deliberate
failures included — a database that will not open, one area that will not
read, a save refused, a database cleared, a copy that will not read — and
fails when any of the rules above is taken out. `tests/android-bridge.test.mjs`
compiles the real `MainActivity.java` against stand-ins for Android and runs
its file handling on an ordinary JVM. That shows the app's own logic is right;
it cannot show that a real phone's file chooser behaves as documented.
`tests/store.test.mjs` holds every area the code saves or loads to the one
list, so a new area cannot be left out of the backup — and holds the page, the
app and the pretend app the browser test drives to the same names for every
way across between them, since each half is otherwise tested against its own
idea of the other.

## A review, on the board

A review opens on the board rather than under two lists: at the first of your
mistakes, with the move played in red, the move wanted in green and the reason
under them. Back and Next (and the arrow keys) step through the game; Next
mistake goes to the next of yours, in the order they were made, and round
again.

"Try it yourself" takes the answer off the board and asks for a better move.
What is tried is judged by the judge that judged the game, at the same amount
of work, against where the game stood before the move, through the same
`costOf()` the review used — so "that works too" (under half a point, the
reviewer's own threshold) and "that loses 1.2 points" mean what the review's
figures mean. `tests/review-board-drive.cjs` holds that to the one case with a
known answer: the move that was played, judged as a try, must come back with
exactly the loss the review gave it — for this app's engine, for Stockfish,
and for a game opened again from the store.

The analysis board's three lines can be Stockfish's as well as this app's
engine's; both are searched in a worker, and
`tests/analysis-engine-drive.cjs` holds this app's engine's lines to the ones
a search on the page gives.

## Catching up

Importing used to be asked for every time: open Game review, type the name
again — it was not kept — press Import, press Analyse. The name is now
remembered from the first import, and whenever the app is opened (or comes
back into view, on a phone where it stays open for days) it asks Chess.com for
anything newer than the newest game already here, brings that in, and analyses
it with the judge and depth picked on the walk. Today says what arrived and
what came of it.

It asks at most once every three hours, and makes two requests when there is
nothing new: the list of months and the newest month. It never reaches back: a
game older than the newest one stored is an import's to fetch, and games that
were waiting to be analysed are left waiting — opening the app analyses the
three games that just arrived, not a history somebody chose to leave for
later. No connection, or Chess.com not answering, says nothing and is tried
again next time. It is a setting, on by default, beside the name.
`tests/catchup-drive.cjs` drives all of that against a stand-in for Chess.com
that counts what it is asked.

## Weak spots

The Puzzles screen asks about moments out of your own games, and there are
only as many of those as you have played. The Weak spots screen is the other
half: ten puzzles at a time out of a pack chosen from the Lichess puzzle
database — millions of positions from real games, each tagged with its themes
and rated by how people did on it, released into the public domain — and a
rule for which of them you get.

**The rule is your own games.** Every mistake the reviewer finds is replayed
on the board and named where it can be (`src/motifs.js`): a fork you allowed, a
piece you left loose. Those names are counted over your latest fifty analysed
games — the way the Progress page counts them — and about seven of every ten
puzzles are of the kinds that come up most, shared out in proportion among the
leading four. The rest is a mix. With nothing analysed, all ten are a mix and
the screen says that is why.

**Two vocabularies, kept apart.** A mistake's name says what was done *to*
you; a puzzle's theme says what the solver *does*. "Allowing a fork" is
trained by puzzles where a fork wins, and the screen says both halves — "Forks
· you allowed a fork 6 times" — rather than one label for the two. `WEAK_AIMS`
in `src/weak-spots.js` is the whole of the crossing; a loss with no trick
behind it crosses to nothing.

**Your level is on the puzzles' own scale.** It starts at 1000 and moves
after every new puzzle by how surprising the result was, quickly at first.
Puzzles are picked a little under it — the nearest one not yet seen to a
rating about a hundred below, give or take — so that roughly two in three are
solved. It is a level on these puzzles and the screen says it is nothing else.

**A miss is not the end of the puzzle.** The first wrong move counts it as
missed, but the position stays for another look, and the answer is there to be
asked for. A second way to give mate is as right as the one the database
recorded. A puzzle solved first time is never asked again; a missed one comes
back the next day, first in the set and said to be one missed before, then
about a week later, and is finished with once solved twice running. Meeting
one again does not move the level.

**The pack is two files beside the page**: `puzzle-pack.txt`, one puzzle a
line in order of rating, and `puzzle-pack.json`, which says what is in it.
`tools/make-puzzle-pack.mjs` makes them from the database file and they are
committed under `vendor/puzzles/` (see the README there for the thresholds). It
keeps only puzzles played and liked enough for their rating to mean something,
gives each theme the app can aim at an equal shelf across the ratings, and
plays every puzzle through on this app's own move generator before keeping it
— a move the app would refuse never reaches the pack. `build.py` copies the
pack beside the kit and into the Android app, refuses a pack that is not the
one its description is of, and always writes the description: a build made
without a pack says so in it, and the screen then says there are no puzzles
rather than offering a button that does nothing. A copy of the page opened
from a file cannot read a second file, and says that instead.

**The pack that ships** is 50,000 puzzles from the database of 1 November
2026, rated 400 to 2299, 4.6 MB. The database had 6.2 million puzzles; 2.2
million passed the thresholds, and the pack was drawn from those — 3,000 for
each of the eleven themes the app can aim at, and the rest anything. None of
the fifty thousand was refused on the board, and all of them, not the one in
ten the test replays on every run, have been played through once here on the
app's own move generator: 228,540 moves, every one legal, and each of the
21,047 puzzles tagged as a mate ending in mate in the number of moves it
says.

`tests/weak-spots.test.mjs` holds the choosing and the judging to their rules;
`tests/puzzle-pack.test.mjs` runs the tool on a file in the database's layout,
with a row of every kind it has to turn down, and plays through one in ten of
the pack that ships; `tests/weak-spots-drive.cjs` takes sets across a board in
a browser — aims, misses, puzzles coming back, a pack that cannot be had.

## What keeps happening

A review says what went wrong in one game, and Progress added the games up: so
many forks allowed, so many pieces left loose. Neither said what a coach
would: which of these is costing you most often now, whether it is getting
rarer, and whether you keep going wrong in the same place. The panel that
listed counts now says those three things (`src/patterns.js` counts,
`src/app-s.js` says it).

**How often is a rate.** "Fourteen forks" means one thing over twenty games
and another over two hundred, so every kind of mistake is said per game:
"about once every 2 games".

**Whether it is getting rarer is two windows of the same size** — your latest
twenty-five analysed games against the twenty-five before them, or fewer when
there are fewer, and nothing at all under sixteen games. Each kind carries
both counts, and "rarer" or "more often" is said only when they are further
apart than the luck of which games those were: the two counts are set against
the spread two such counts would show if nothing had changed, about the
square root of their sum, and have to be a clear step and a half of that
apart. Nine and then three is rarer; six and then three is not; three in all
is too few to say, and the page says "too few to say". Windows that were not
all judged the same way — one judge, one setting — are said to be, because a
different judge finds different things. The sentence at the top is about the
latest window: what came up most in it, at its rate there. What it names is
not named again underneath, and when none of these came up in the latest
window at all, that is what it says.

**The same place** is the same position, in the first twelve moves, gone
wrong in more than one game — the board, whose move, castling and en passant,
so the same position by another order of moves is the same place. Each is
listed with how one game got there, how many games reached it and how many
went wrong in it, what you played and how often, what the reviewer wanted,
and what it cost — and opens on the analysis board with both moves drawn. How
often it was reached is read from the games' own moves, once a game; a game
whose moves were not kept still reached whatever it went wrong in. A position
needs no name for the mistake made in it, so the list is there even when no
mistake could be given one.

Everything follows the page's choice of time control, and where there are
puzzles beside the page there is a way straight to ten aimed at these.
`tests/patterns.test.mjs` holds the counting to its rules — counts that
differ by luck and counts that differ by more, a game listed twice, a game
whose moves were not kept, the same position by another road — and
`tests/patterns-drive.cjs` holds the page to the numbers in the games.

## One session a day

Today is a list: drills due, puzzles due, an opening to run through, ten
puzzles for your weak spots. Each row is another screen, and working down the
list means choosing four times. A session is the same work as one thing with a
beginning and an end: up to four of your own mistakes, up to three chances
from your own games, puzzles for your weak spots to make it up to twelve
positions, and one opening line from memory — in that order, without asking
what is next. With no puzzle pack, what is due takes the room instead.

**The session asks nothing itself.** It takes the screens that already do the
work, one after another: each keeps its own rules, schedules what it asks
exactly as it would from its own tab, and saves each answer when it is given.
The session only decides how many it wants from each, says so on a bar that is
there on every screen while one is under way — which part, how far, the way
out, and the way back if you have wandered off — and moves on when a screen's
own Next is pressed and it has had what it wanted. What is due beyond that is
left due. An opening line is only asked for if it has been met before: a line
never looked at is not something to be asked from memory.

**A day counts when the session is seen through**, and the days are counted:
"six days running". Stopping counts nothing and loses nothing — whatever was
answered stays answered. A session skipped from end to end is not a session.
A run is not lost at midnight; it is lost by a day going past. A day on which
there was nothing at all to do is marked as that, and neither adds to a run
nor ends one; if something turns up later the same day — new games arrive —
it is an ordinary day again. Each finished day is told how long the run was
when it was marked, because only four hundred days are kept and a longer run
would otherwise be counted back to the oldest one and no further.

**The reminder is the Android app's**, since a page cannot remind anybody of
anything once it is closed. In the app, Today has a switch and a time; the app
sets a daily alarm, and shows one notification when it rings unless the page
has told it that today's session is done (see `android/README.md`). In a
browser there is no switch.

`tests/daily.test.mjs` holds the counting to the calendar — midnight, the ends
of months and years, both clock changes, a day of nothing, a run longer than
the days kept — in a time zone far from Greenwich, where a day cut by the
wrong clock shows. `tests/daily-drive.cjs` takes sessions across the four
screens in a browser: stopped, skipped, wandered away from and seen through,
with the reminder switch driven against a pretend app.

## Speed

Everything the app knows about a game it reads back out of the game's own PGN,
and reading a PGN means replaying it through the move generator. With a few
dozen games that is free; with a few hundred it was the whole experience.
Measured on a history of 243 stored games:

| | before | after |
|---|---|---|
| opening the app | 1.6 s | 0.6 s |
| pressing New game | 0.5 s, every time | 1 ms after the first |
| opening Progress | 184 ms | 21 ms |
| reading all 243 games | 1.8 s | 0.26 s |
| the deviation report | most recent 60 games | all 243, in 120 ms |

Three changes, and none of them changes an answer:

- **A move is matched by spelling only the moves that could be it.** Writing a
  move out means playing it to see whether it gives check, so finding the move
  a PGN token names used to cost a spelling of all thirty-odd legal moves.
  Every move but castling ends in the square the text names, so only the moves
  that go there are candidates — and the match is still made by spelling them.
- **Mate is a check with no reply.** Writing a move used to ask the board for
  its outcome, which generates every legal move and then tests the fifty-move
  rule, repetition and material — none of which spell anything. Asking "is this
  a check" first costs nothing and answers no almost every time.
- **Work done per game is remembered per game.** The opening book and the
  deviation report each keep what they read out of each game, keyed to the
  record it came from, so a rebuild reads only what is new. Both also stop
  reading at the depth they can actually see: sixteen plies for the book, and
  the length of the longest line in the repertoire for the report.

Two of the three are checked by holding the old implementation and the new one
to each other — 213,108 moves written both ways, and the whole opening book
built both ways on sixteen awkward histories. The third is checked exhaustively
over every one- and two-piece ending.

### Analysing a game

A review asks about every position in a game — a hundred searches or so — and
no answer depends on another: every search starts from a cleared table, which
is what makes the same position come back with the same answer. So the
reviewer shares the positions out among as many engines as the device has
cores to spare (one core is left for the page; at most four engines, two on a
device short of memory): several Stockfish workers, or this app's own engine
in several workers rather than on the page's own thread. Measured here, on
four cores, three at once:

| | one at a time | shared out |
|---|---|---|
| a review by this app's engine, Normal | 3.2 s | 1.3 s |
| the same at Deep, 41 positions | 11.9 s | 4.2 s |
| a review by Stockfish, Normal | 5.1 s | 2.0 s |
| the longest the page is held during a deep review | 565 ms | 12 ms |

Which engine looked at a position, and in what order, is not an input to what
it found: `tests/lanes-drive.cjs` holds a review done in workers to the same
review done on the page, and one shared among several Stockfish to one done
one at a time, to the last figure, at every setting. The build hands the page
its own engine a second time, as text, to start those workers from — made from
the same two files in the same build as the engine the page runs, so the two
cannot drift apart. Where a worker cannot be started the reviewer searches on
the page as it always did, to the same figures. An engine that stops
answering ends the review with the reason and is not used again. The extra
Stockfish engines are let go after a minute with nothing to do.

And the walk no longer does its work twice: the chances it finds while judging
are filed as puzzles as it goes, instead of every game being gone through
again by Puzzles.

## Tests

```
npm install            # playwright, for the browser drivers
npm test               # 29 node suites: perft, motifs, the move explainer, Reckless, the judges, traps,
                       # mate cap, multi-line search, the solved table, endgame
                       # and opening prose, notation, clocks, the stored areas,
                       # the weak-spot puzzles and the tool that makes their pack,
                       # the daily session and its count of days, what keeps
                       # happening across games, the human-like opponent's
                       # networks and their numbering,
                       # the Android app's file handling (needs a Java compiler),
                       # evaluation symmetry, the fast paths against the long
                       # way round, repeatability, interface vocabulary
npm run test:browser   # 59 Playwright drivers against dist/
npm run verify:openings
```

Browser drivers need Chromium. `npm install` fetches one via Playwright; or set
`CHROME_PATH` to an existing binary.

## Getting it onto a phone

Two routes. Both give an app with its own icon that opens without a browser
around it and needs no connection; they differ only in where it comes from.

**From the web.** The kit is served at
<https://deccyf.github.io/hard-lines-chess/>. Open it on the phone: Chrome
offers "Install app", iOS uses Share → Add to Home Screen. This route updates
itself — the service worker is network-first, so the next opening with a signal
is the newest build.

**As a file.** The Android APK sits beside the page, on the same host:

```
https://deccyf.github.io/hard-lines-chess/hard-lines-chess.apk
```

Tap it once downloaded and allow your browser to install apps when Android
asks. It works with no connection — the engine, the openings, review and all
the rest are inside it — and the one thing it ever connects to is Chess.com's
public archive of your games, to bring new ones in. See
[`android/README.md`](android/README.md) for how it is built, and for what the
committed signing key is and is not for.

The identical file is attached to a release, at
`/releases/download/android-latest/hard-lines-chess.apk`. That copy is served
from a different host to the page, which some VPNs and filtered networks stall
without an error — so the link above is the one to give a phone first.

The two keep their data separately — an installed web app and the APK are
different places on the phone — and a backup file, saved in one and restored in
the other, is what moves a history between them (see "Where your data is
kept").

There is no iOS equivalent of the second route: Apple has no sideloading, so an
iPhone takes the first one. Either way, a page opened from a Files app cannot
be installed — that is a browser rule, and the page says so.

Serving `dist/pwa/` from any other https address (or localhost) works the same
way.

## What was measured, and what was not

- **Level strength** is a target, not a rating. Self-play shows the ladder
  climbs (level 800 beat level 0 six of six; 1600 scored 5½/6 against 800) but
  neighbouring levels were not separated.
- **The per-game strength estimate** is calibrated once for each judge: eight
  levels played themselves eight games each, and every game was reviewed at
  each of the three
  settings by this app's engine, by Stockfish and by Reckless (the same games
  for all three), with a log-linear fit of mean centipawn loss against level
  for each judge. Above some level a judge cannot tell levels apart, so the
  page says "or above" instead of a number. That ceiling is the level whose
  games lost least, or the level from which the losses sink under the noise,
  whichever is lower, and never above what a slower setting reaches. See
  `tools/calibrate-rating.mjs`. Measured:

  | judge | ceiling: Quick / Normal / Deep | fit (R²): Quick / Normal / Deep |
  |---|---|---|
  | this app's engine | 1200 / 1200 / 1500 | 0.78 / 0.75 / 0.74 |
  | Stockfish | 1800 / 1800 / 1800 | 0.71 / 0.70 / 0.69 |
  | Reckless | 1500 / 1800 / 2100 | 0.47 / 0.49 / 0.46 |

  Reckless counts smaller losses than Stockfish on the same games (38
  centipawns a move against 56, on average, at Normal) and its losses barely
  move between levels 600 and 1200, so its fit is the loosest of the three,
  and the page says so. It puts the games in a similar order to Stockfish:
  rank correlation with level −0.78 against Stockfish's −0.85 at Normal.

  It was four games a level until 1.6, and is eight. What twice the games
  bought is a steadier line, not a tighter one: the line each estimate is read
  off moved by up to fifty points at the ends of the scale and ten or twenty
  in the middle, its own uncertainty at mid-scale came down by about a fifth
  (33 points to 25 for this app's engine at Quick; 51 to 41 for Stockfish),
  and at Deep this app's engine can now tell levels apart up to 1500 where
  four games stopped it at 1200. R² went down, not up, and that is the honest
  direction: it measures how far single games scatter round the line — about
  two hundred points for this app's engine — and more games show more of a
  scatter that was always there. One game is still one game.

  The Play screen's own account of all this ("About the levels") is written
  from the fit the page was built with — `calibrationWords()` in
  `src/review.js` — rather than typed in. It was typed in once, and went on
  describing the first measurement through two re-measurements.

  The top of the ladder is thin for every judge: level 2100 plays the same
  game every time and 1800 only three different ones in eight, so the
  ceilings up there rest on very few games. Even at eight games a level the
  calibration is a small sample, which is why the estimate from your own
  rated games sits beside it and is the better answer whenever there is
  enough of your own history to give it. The budgets
  it was measured under are written into `tools/rating-calibration.json`, and
  `tests/repeatable.test.mjs` holds the app's own review settings to them: a
  fit maps a loss onto a rating, and a loss measured under a different amount
  of work is a different loss.
- **Traps** are measured as shallow-search preference against deep-search
  truth. That finds material traps and not positional ones.
- **Every counted claim in the openings prose** is checked on the board by
  `tests/verify-openings.mjs` — 25 openings, 342 main-line plies and 730 branch
  plies replayed, 115 counted claims verified — and every claim in the endgame
  prose by `tests/endgames.test.mjs`: the material each name promises, the side
  to move, the result, and the move counts ("two moves here win and the other
  six draw" is counted, not asserted).
- **King and pawn against king is solved, not searched.** All 393,216 positions
  are worked out by backward induction in about a second, checked against
  published results and by playing 400 random positions out through the app's
  own move generator. This exists because the search is not merely imprecise
  here but wrong: shown the drawn opposition it calls it +10.3 for White, and
  asked to defend it, it loses. Where an endgame is refereed by the search
  instead, the screen says so.
- **The starting puzzle bank** is the app's engine playing itself, mined by the
  same review that mines your games and re-checked at greater depth than the
  review that found it. Your own tactics still come first everywhere both are
  offered.
- **The clock is read, or refused.** A game whose clocks cannot be matched to
  its moves one for one — some moves unclocked, or variations carrying clocks
  of their own — gets no answer rather than a wrong one, because a clock
  attached to the wrong move reports time trouble in the wrong half of the game.

## Conventions

UK English throughout. Standard chess vocabulary: analysis, game review, level.
Colours mean the same thing everywhere: red is the move you played, green is
the engine's move, blue is a move played at you — and each is told apart by
shape as well as hue, because a difference carried only by colour does not
survive a colour-blind reader.
