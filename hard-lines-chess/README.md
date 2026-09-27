# Hard Lines Chess

A single-file chess trainer that runs entirely in the browser: its own engine, a
22-level opponent ladder, an analysis board with engine suggestions and insight
modes, 25 openings with variations and per-move explanations, game review with a
win-chance curve and motif classification, tactics puzzles mined from your own
games, spaced-repetition drills, a teaching opponent that sets traps, an endgame
trainer refereed by a solved table, a three-minute timed mode, a board-vision
drill, a screen that explains chess notation by taking your own moves apart, a
watch mode that plays two levels against each other and replays seven famous
games move by move, a report that checks your own games against your repertoire
and names the move you keep leaving it on, an importer that fetches your public
Chess.com games — with their ratings and clocks — and a coach that explains
positions from engine output, with or without a model to write the sentences.

Everything is one HTML file. It works offline once loaded and can be installed
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
src/pgn.js      the PGN reader, and the clocks in the movetext that it strips
src/review.js   the reviewer, the compact per-game format, and what your own
                rated games say about a game (see "What it says about you")
src/deviation.js where your games leave your repertoire, and what it cost
src/import.js   the Chess.com archive reader (browser only; the APK has no network)
src/pawn-tb.js  king and pawn against king, solved exactly (see below)
src/endgames.js the endgame positions, each with the referee that grades it
src/puzzle-bank.js  generated by tools/make-puzzles.mjs; committed, not built
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
build.

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

The rating estimate's fit is read from `tools/rating-calibration.json` at build
time. Without it, no estimate is shown anywhere.

The two fonts are the only thing the page fetches from elsewhere, and it works
without them. The APK, which has no network at all, bundles them in
`android/app/src/main/assets/fonts/` and answers the page's own request for the
stylesheet from inside itself.

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

## Tests

```
npm install            # playwright, for the browser drivers
npm test               # 18 node suites: perft, motifs, traps, mate cap, multi-line
                       # search, the solved table, endgame and opening prose,
                       # notation, clocks, evaluation symmetry, the fast paths
                       # against the long way round, repeatability, interface
                       # vocabulary
npm run test:browser   # 44 Playwright drivers against dist/
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
asks. This one holds no internet permission at all, so it is the same app on a
plane as at home — and so the Chess.com importer, which is the one feature that
needs a network, is not offered there. See
[`android/README.md`](android/README.md) for how it is built, and for what the
committed signing key is and is not for.

The identical file is attached to a release, at
`/releases/download/android-latest/hard-lines-chess.apk`. That copy is served
from a different host to the page, which some VPNs and filtered networks stall
without an error — so the link above is the one to give a phone first.

There is no iOS equivalent of the second route: Apple has no sideloading, so an
iPhone takes the first one. Either way, a page opened from a Files app cannot
be installed — that is a browser rule, and the page says so.

Serving `dist/pwa/` from any other https address (or localhost) works the same
way.

## What was measured, and what was not

- **Level strength** is a target, not a rating. Self-play shows the ladder
  climbs (level 800 beat level 0 six of six; 1600 scored 5½/6 against 800) but
  neighbouring levels were not separated.
- **The per-game strength estimate** is calibrated: eight levels played
  themselves, every game reviewed at each of the three settings, log-linear fit
  of mean centipawn loss against level. Above some level the reviewer cannot
  tell levels apart, so the page says "or above" instead of a number. See
  `tools/calibrate-rating.mjs`. That calibration is a handful of samples a level
  — which is why the estimate from your own rated games sits beside it and is
  the better answer whenever there is enough of your own history to give it.
  The budgets it was measured under are written into
  `tools/rating-calibration.json`, and `tests/repeatable.test.mjs` holds the
  app's own review settings to them: a fit maps a loss onto a rating, and a
  loss measured under a different amount of work is a different loss.
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
