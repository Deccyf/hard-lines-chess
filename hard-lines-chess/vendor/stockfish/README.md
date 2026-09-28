# Stockfish, vendored

The engine the Watch screen plays and explains with.

| | |
|---|---|
| what | Stockfish 19 **Lite**, single-threaded, WebAssembly |
| from | the npm package `stockfish@19.0.0` (nmrugg/stockfish.js), files `bin/stockfish-19-lite-single.js` and `bin/stockfish-19-lite-single.wasm` |
| renamed to | `stockfish.js` and `stockfish.wasm` — the loader finds its `.wasm` by swapping its own extension, so the two must share a name |
| sha256 | `stockfish.js`  `d3344124ab067fb0b90ee77873bb8e9fbf5fc01bc525fe714b0f942581e889e6` |
| | `stockfish.wasm` `57ac2d72312aba346760e3f173f687a8c211208e97a87268436f7f0e10bb5387` |
| licence | GPL-3.0 — `Copying.txt` beside these files |

## Why this build

**Lite**, because the full network makes the engine 99 MB and this one is 1.8 MB
— and it is still far stronger than any person. **Single-threaded**, because a
multi-threaded WebAssembly engine needs `SharedArrayBuffer`, which needs
cross-origin isolation headers that neither GitHub Pages nor the Android
WebView's asset loader sends.

## How it is used

It runs in a Web Worker, spoken to in UCI (see `src/stockfish-driver.js`),
and every search is given a fixed number of positions with the hash cleared
first — the same rule as the app's own engine, so the same position gets the
same answer on any device.

`build.py` copies both files next to every build of the page, the service
worker precaches them, and the Android build copies them into its assets. A
copy of the page opened straight from a file cannot start a worker, and the
Watch screen says so rather than failing silently.

## Updating it

Replace both files from the same package version, update the hashes above,
and run the suites — `tests/stockfish-watch.cjs` plays a real game with it.
