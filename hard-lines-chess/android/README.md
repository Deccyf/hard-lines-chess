# The Android app

The trainer, on a phone, as a file you download and install.

There is nothing chess-related in this directory. `build.py` writes the whole
app — engine, ladder, openings, review, drills, coach and styles — into one
HTML file; everything here is the window that file opens in.

```
android/
  app/src/main/java/chess/hardlines/MainActivity.java   the window
  app/src/main/assets/fonts/                            the two faces, bundled
  app/src/main/res/                                     icon, colours, theme
  app/hard-lines.keystore                               the signing key (public — see below)
  app/build.gradle                                      where the app gets copied in
```

## Getting it

You do not have to build this. Every push to `main` produces an APK at a link
that does not change:

**https://github.com/Deccyf/hard-lines-chess/releases/download/android-latest/hard-lines-chess.apk**

Open it on the phone, tap the file when it lands, and allow your browser to
install apps when Android asks.

## The three decisions

### It has no internet permission

Look at `AndroidManifest.xml`: there is no `android.permission.INTERNET`, and
that is the point. The app has no accounts, no sync and no telemetry, and the
one remote thing the page asks for — a Google Fonts stylesheet — is answered
from `assets/fonts/` by `MainActivity.fontStylesheet()`. Without the permission
the claim that everything runs on your own device is enforced by the system
rather than promised by a README. The app could not phone home if a later
change tried to.

That also means the app behaves identically on a plane and at home, which a
chess trainer that plays its own engine ought to.

### The page is served over https, not opened as a file

`WebViewAssetLoader` answers requests to `https://appassets.androidplatform.net/`
out of the APK's assets. Loading `file:///android_asset/index.html` would have
been one line shorter and wrong: a `file:` page has an opaque origin, its
`localStorage` is unreliable, and `window.isSecureContext` is false — which the
page itself checks before it registers anything. Every game, drill, opening and
setting the trainer keeps lives in that storage, so it needs to be storage that
behaves like storage.

### The signing key is in this repository, and is not a secret

`app/hard-lines.keystore` — alias `hard-lines`, password `hardlines`.

Android installs an update over an existing app only when both were signed by
the same key. An app installed over keeps its data; an app that has to be
uninstalled first does not, and uninstalling takes every saved game with it. A
key generated afresh on each CI run would mean every new version arrived as a
different app.

So the key is committed, and it protects nothing. Anyone can sign anything with
it. For an app you sideload onto your own phone from a release you built that
is an acceptable trade — the signature was never what you were trusting; the
download was. It would **not** be acceptable on Google Play. Point these at a
real key if it ever goes there:

```
ANDROID_KEYSTORE_FILE  ANDROID_KEYSTORE_PASSWORD  ANDROID_KEY_ALIAS  ANDROID_KEY_PASSWORD
```

The key in the repo has fingerprint
`4F:71:75:E9:02:F6:C0:8F:49:C9:38:CF:24:E1:B4:98:9D:28:49:5C:AE:4B:D1:67:0E:D0:DD:98:83:90:DB:92`,
which is printed in every release so you can check what you installed:

```
apksigner verify --print-certs hard-lines-chess.apk
```

## Building it

Needs a JDK 17 and an Android SDK with platform 35.

```
cd hard-lines-chess
python3 build.py                       # writes dist/hard-lines-chess-app.html
cd android
./gradlew assembleRelease              # app/build/outputs/apk/release/
```

The Gradle build **copies the app in** rather than keeping a second copy of it
here, and fails with the command above if `dist/` has not been built. The APK
is named for the version, which comes from `package.json` so that only one file
in the repo says what version this is.

`ANDROID_VERSION_CODE` is the integer Android compares when deciding whether an
APK may install over the one already on the phone. It must go up every time or
the install is refused, unhelpfully. CI passes the run number; a local build
gets `1`.

## What it does beyond showing the page

- **Back** goes back in the page if it can, then asks a second time before
  leaving. A game in progress lives in the page, not on disk, and one stray
  edge-swipe should not end it.
- **Rotation and the system's sunset switch to dark** do not restart the
  activity (`android:configChanges`), because a restart reloads the page and
  the game on the board goes with it.
- **Dark mode** reaches the page. A WebView answers `prefers-color-scheme` with
  "light" unless the app opts in, so without
  `setAlgorithmicDarkeningAllowed` the app would sit in daylight on a dark
  phone. The page's own theme picker still overrides it.
- **The system bars** are padded around rather than drawn under. From Android
  15 an app draws edge-to-edge whether it asks to or not, and the page has no
  safe-area padding of its own, so its top row would sit under the clock.
- **The engine's timers stop** when the app is not in front, so a search left
  running does not warm a pocket.
- **Anything that is not the bundled app is refused**, not fetched. Nothing
  asks for anything else; if something ever does, failing loudly is better than
  quietly acquiring a network dependency.

## What is missing, compared with the web app

- **The coach** — the part that explains a position in English — needs the
  Claude runtime the page is published into. It is absent here, and the page
  hides that panel rather than showing a button that cannot work. Everything
  the coach narrates is measured by the engine, and all of that still runs: the
  evaluations, the best moves, the threats, the hanging pieces, the motif
  classification in review.
- **Save a copy of the app** is hidden, because you are holding one.

Both are the same two absences the app already handles anywhere it is opened
outside that runtime.
