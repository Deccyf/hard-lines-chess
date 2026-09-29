#!/usr/bin/env bash
# Builds Reckless for the Watch screen and writes vendor/reckless/.
#
# Everything that decides the output is pinned here — the source commit, the
# network and its checksum, the compiler, the bindings generator and the
# target features — so running this again gives the same engine. See
# vendor/reckless/README.md for what each choice is and why.
#
# Needs: git, curl, node, and Rust with the wasm32-unknown-unknown target.
# wasm-bindgen is installed at the pinned version if it is not on the path.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)

COMMIT=31d9cd6fd2bea6d9f72eeb35e0bac70daa295fb1
NETWORK=v60-7f587dfb.nnue
NETWORK_SHA256=7f587dfb1fe5d74d53909328afa6fd51650c8c7f45907602db7fbb1e52948c61
RUST=1.94.1
WASM_BINDGEN=0.2.123
# ONE THREAD, AND NO SHARED MEMORY. Reckless's own web build is multi-threaded,
# which needs SharedArrayBuffer, which needs cross-origin isolation headers
# that GitHub Pages cannot send. Setting RUSTFLAGS replaces the repository's
# own wasm32 flags (atomics, shared and imported memory) with these. SIMD
# stays: relaxed-simd is what its network code is written for.
FEATURES="-C target-feature=+simd128,+relaxed-simd"

WORK=${RECKLESS_WORK:-$(mktemp -d)}
echo "building in $WORK"

have=$(rustc --version | awk '{print $2}')
if [ "$have" != "$RUST" ] && [ -z "${RECKLESS_ANY_RUST:-}" ]; then
  echo "rustc is $have; this build is pinned to $RUST (set RECKLESS_ANY_RUST=1 to use it anyway)" >&2
  exit 1
fi
rustup target add wasm32-unknown-unknown >/dev/null

if [ ! -d "$WORK/.git" ]; then
  git -C "$WORK" init -q
  git -C "$WORK" remote add origin https://github.com/codedeliveryservice/reckless
fi
git -C "$WORK" fetch -q --depth 1 origin "$COMMIT"
git -C "$WORK" checkout -q --force FETCH_HEAD
git -C "$WORK" apply "$ROOT/vendor/reckless/reset.patch"

# The network, checked before anything is built with it. Reckless's build
# script would fetch it too, but without looking at what arrived.
mkdir -p "$WORK/networks"
if ! echo "$NETWORK_SHA256  $WORK/networks/$NETWORK" | sha256sum -c --status - 2>/dev/null; then
  curl -sfL -o "$WORK/networks/$NETWORK" \
    "https://github.com/codedeliveryservice/RecklessNetworks/releases/download/networks/$NETWORK"
  echo "$NETWORK_SHA256  $WORK/networks/$NETWORK" | sha256sum -c -
fi

# Paths remapped so the binary does not carry this machine's directories.
CARGO_HOME=${CARGO_HOME:-$HOME/.cargo}
(cd "$WORK" && RUSTFLAGS="$FEATURES --remap-path-prefix=$WORK=/reckless --remap-path-prefix=$CARGO_HOME=/cargo" \
  cargo build --lib --target wasm32-unknown-unknown --release --no-default-features)

if [ "$(wasm-bindgen --version 2>/dev/null | awk '{print $2}')" != "$WASM_BINDGEN" ]; then
  cargo install wasm-bindgen-cli --version "$WASM_BINDGEN" --locked
fi
rm -rf "$WORK/pkg"
wasm-bindgen "$WORK/target/wasm32-unknown-unknown/release/reckless.wasm" --target web --out-dir "$WORK/pkg"

cp "$WORK/LICENSE" "$ROOT/vendor/reckless/LICENSE"
node "$ROOT/tools/split-reckless.mjs" "$WORK/pkg" "$ROOT/vendor/reckless" \
  --commit "$COMMIT" --network "$NETWORK" --network-sha256 "$NETWORK_SHA256" \
  --rust "$RUST" --wasm-bindgen "$WASM_BINDGEN" --features "$FEATURES"
