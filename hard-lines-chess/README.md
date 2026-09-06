# Hard Lines Chess

A single-file chess trainer that runs entirely in the browser: its own engine, a
22-band opponent ladder, a practice board with engine suggestions and insight
modes, 25 openings with branches and per-move explanations, game review with a
win-chance curve and motif classification, tactics puzzles mined from your own
games, spaced-repetition drills, a teaching opponent that sets traps, and a
coach that explains positions from engine output.

Everything is one HTML file. It works offline once loaded and can be installed
as an app from any web address.

## The one rule

**The engine is the source of truth. The model is the narrator.**

Nothing on screen is a model's opinion about a position. Evaluations, best
moves, tactics, motifs and traps are all measured by the engine on the board;
the coach turns verified engine output into English and is never asked to
evaluate anything. Where a measurement cannot support a figure, the screen says
so instead of printing one.

## Layout

```
src/            the app, as concatenated by build.py (order matters; see build.py)
src/engine/     0x88 board, alpha-beta search with TT/LMR/quiescence, the bands
src/openings.js 25 openings, 79 branches — verified by tests/verify-openings.mjs
pwa/            manifest, service-worker template, icons
android/        the WebView wrapper that makes the APK (see android/README.md)
tools/          rating calibration, icon generator, self-play PGN generator
tests/          node unit tests (*.mjs) and Playwright browser drivers (*.cjs)
dist/           build output (committed so the repo is usable without building)
```

Two workflows in `.github/workflows/` publish it: `pages.yml` serves the
installable kit at a web address, `android.yml` builds the APK. Both build from
source rather than from the committed `dist/`, because a build that ships
whatever happens to be committed can ship an older game than the source.

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

## Tests

```
npm install            # playwright, for the browser drivers
npm test               # unit tests: perft, motifs, traps, mate cap, multi-line search
npm run test:browser   # every Playwright driver against dist/
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

**As a file.** An Android APK is attached to a release at an address that does
not change:

```
https://github.com/Deccyf/hard-lines-chess/releases/download/android-latest/hard-lines-chess.apk
```

Tap it once downloaded and allow your browser to install apps when Android
asks. This one holds no internet permission at all, so it is the same app on a
plane as at home. See [`android/README.md`](android/README.md) for how it is
built, and for what the committed signing key is and is not for.

There is no iOS equivalent of the second route: Apple has no sideloading, so an
iPhone takes the first one. Either way, a page opened from a Files app cannot
be installed — that is a browser rule, and the page says so.

Serving `dist/pwa/` from any other https address (or localhost) works the same
way.

## What was measured, and what was not

- **Band strength** is a target, not a rating. Self-play shows the ladder
  climbs (band 800 beat band 0 six of six; 1600 scored 5½/6 against 800) but
  neighbouring bands were not separated.
- **The per-game strength estimate** is calibrated: eight bands played
  themselves, 96 reviews, log-linear fit of mean centipawn loss against band,
  R² 0.75–0.81. Above 1200 (1500 at the Careful setting) the reviewer cannot
  tell bands apart, so the page says "or above". See `tools/calibrate-rating.mjs`.
- **Traps** are measured as shallow-search preference against deep-search
  truth. That finds material traps and not positional ones.
- **Every counted claim in the openings prose** is checked on the board by
  `tests/verify-openings.mjs`.

## Conventions

UK English throughout. Colours mean the same thing everywhere: red is the move
you played, green is the engine's move, blue is a move played at you.
