// Cuts the Reckless build into the pieces the website serves.
//
//   node tools/split-reckless.mjs <wasm-bindgen out dir> <vendor dir> [--commit …] [--network …] …
//
// WHY PIECES. The engine is 64 MB, almost all of it network weights, and it is
// fetched by a phone. One 64 MB request that stalls at 40 MB starts again from
// nothing; sixteen pieces that are each kept as they arrive start again from
// the last one. So the file is cut into 4 MiB slices, each is gzipped on its
// own (a quarter smaller, and each piece can be checked alone), and each is
// named by the checksum of its contents, so a piece is never mistaken for a
// piece of another build.
//
// The manifest says what the whole thing is and what each piece must hash to.
// The page checks every piece against it before keeping it, and the whole
// engine against its own checksum before starting it.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [from, to, ...rest] = process.argv.slice(2);
if (!from || !to) {
  console.error('usage: node tools/split-reckless.mjs <wasm-bindgen out dir> <vendor dir> [--commit …]');
  process.exit(1);
}
const opts = {};
for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, '')] = rest[i + 1];

const PIECE = 4 * 1024 * 1024;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const wasm = readFileSync(join(from, 'reckless_bg.wasm'));
const glue = readFileSync(join(from, 'reckless.js'));

// A clean slate: a piece of the last build left beside this one would be
// published and never asked for.
rmSync(join(to, 'pieces'), { recursive: true, force: true });
mkdirSync(join(to, 'pieces'), { recursive: true });
for (const f of readdirSync(to)) if (/^reckless-[0-9a-f]+\.js$/.test(f)) rmSync(join(to, f));

const pieces = [];
for (let at = 0, n = 0; at < wasm.length; at += PIECE, n++) {
  const raw = wasm.subarray(at, Math.min(at + PIECE, wasm.length));
  const hash = sha256(raw);
  const packed = gzipSync(raw, { level: 9 });
  const file = `pieces/${String(n).padStart(2, '0')}-${hash.slice(0, 12)}.bin`;
  writeFileSync(join(to, file), packed);
  pieces.push({ file, bytes: packed.length, raw: raw.length, sha256: hash });
}

const glueHash = sha256(glue);
const glueFile = `reckless-${glueHash.slice(0, 12)}.js`;
writeFileSync(join(to, glueFile), glue);

const manifest = {
  engine: 'Reckless',
  version: opts.version ?? '0.10.0-dev',
  source: 'https://github.com/codedeliveryservice/reckless',
  commit: opts.commit ?? null,
  network: { name: opts.network ?? null, sha256: opts['network-sha256'] ?? null },
  built: { rust: opts.rust ?? null, wasmBindgen: opts['wasm-bindgen'] ?? null, features: opts.features ?? null },
  wasm: { bytes: wasm.length, sha256: sha256(wasm) },
  glue: { file: glueFile, sha256: glueHash },
  pieces,
};
writeFileSync(join(to, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const packed = pieces.reduce((n, p) => n + p.bytes, 0);
console.log(`${pieces.length} pieces, ${(wasm.length / 1e6).toFixed(1)} MB of engine as ${(packed / 1e6).toFixed(1)} MB to download`);
console.log(`engine sha256 ${manifest.wasm.sha256}`);
