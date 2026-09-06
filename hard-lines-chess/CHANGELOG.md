# Changelog

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
