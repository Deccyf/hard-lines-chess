# Reckless, vendored

The engine that plays Stockfish on the Watch screen, in the website version of
the app only.

| | |
|---|---|
| what | Reckless 0.10.0-dev, single-threaded, WebAssembly with SIMD |
| source | <https://github.com/codedeliveryservice/reckless> at `31d9cd6fd2bea6d9f72eeb35e0bac70daa295fb1` |
| changed | `reset.patch`, below — one function, six lines |
| network | `v60-7f587dfb.nnue`, sha256 `7f587dfb1fe5d74d53909328afa6fd51650c8c7f45907602db7fbb1e52948c61` |
| built with | Rust 1.94.1, wasm-bindgen 0.2.123, `-C target-feature=+simd128,+relaxed-simd` |
| engine | 64,454,914 bytes, sha256 `10aad950888c3d53cec2ab357ae8cfa1600b5e92a1b2696daf832e3d51d945a8` |
| served as | 16 gzipped pieces, 43.8 MB — `manifest.json` lists each with its checksum |
| licence | AGPL-3.0 — `LICENSE` beside these files |

## Why this build

**One thread.** Reckless's own web build is multi-threaded, which needs
`SharedArrayBuffer`, which needs cross-origin isolation headers that GitHub
Pages cannot send. Building it for one thread on stable Rust gives an engine
that runs in an ordinary Web Worker anywhere. At a quarter of a million
positions a move it searches as far as Stockfish Lite does in the same time.

**Not in the APK.** Almost all of the 64 MB is network weights. The APK would
grow by 44 MB for everybody, and it has no internet permission to fetch
Reckless when asked for, so Reckless is a website feature: the Watch screen in
the APK says so.

**In pieces.** A phone that loses its connection 40 MB into one 64 MB request
starts again from nothing. Sixteen pieces, each kept as it arrives and checked
against its own checksum, start again from the last one kept. See
`src/reckless-worker.js`.

**Vendored rather than built on every publish.** It takes a Rust toolchain, a
network download and a bindings generator; built here once, from a pinned
commit, and checked in, every build of the app ships the same engine and the
tests test the bytes that ship. `tests/reckless.test.mjs` checks every piece
against the manifest and runs the engine.

## The change

`reset.patch` makes the WebAssembly interface's `reset()` do what its own
`ucinewgame` does. It cleared the threads and the transposition table but not
the correction histories, which are shared between threads rather than owned
by one — so the same position, asked twice, came back with a different score
from the very first ply, and a different move. The app asks every question
from a cleared engine so that it gets the same answer every time; with the
patch it does.

## Rebuilding it

```
tools/build-reckless.sh
```

Fetches the pinned commit, applies the patch, downloads the network and checks
its checksum, builds, generates the bindings and cuts the result into pieces
with `tools/split-reckless.mjs`, writing everything here. Built twice, in two
different directories, it produced byte-identical output. To move to a newer
Reckless, change the pins at the top of the script, check that the patch still
applies, and run the suites.
