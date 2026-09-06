// Every element the code reaches for, against every element the page has.
//
// THE FAULT THIS CATCHES is a typo in an id. `$('watchStgae')` returns null,
// and the next line — .textContent, .hidden, .addEventListener — throws, which
// in a concatenated single-file app means the rest of boot() never runs and
// the whole page is dead. It is a one-character mistake with a total failure
// mode, and neither the build nor any unit test would see it: the build is
// string concatenation, and a unit test only reaches the screens it knows to
// open.
//
// So this reads both sides. Every literal id asked for in the source has to be
// an id the markup declares. Ids built by concatenation ('tab-' + id) are not
// literals and are not checked here — the nav test walks those instead.
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const body = readFileSync(new URL('src/body.html', root), 'utf8');
const head = readFileSync(new URL('src/head.html', root), 'utf8');

const declared = new Set();
for (const markup of [body, head]) {
  for (const m of markup.matchAll(/\bid="([^"]+)"/g)) declared.add(m[1]);
}

const sources = readdirSync(new URL('src/', root))
  .filter((f) => f.endsWith('.js'))
  .filter((f) => f !== 'bundle.js');

let asked = 0, missing = [];
for (const file of sources) {
  const src = readFileSync(new URL('src/' + file, root), 'utf8');
  for (const m of src.matchAll(/(?:\$|document\.getElementById)\((['"])([A-Za-z][\w-]*)\1\)/g)) {
    asked++;
    if (!declared.has(m[2])) {
      // Line number, so the report points at the line rather than the file.
      const line = src.slice(0, m.index).split('\n').length;
      missing.push(`${file}:${line}  $('${m[2]}')`);
    }
  }
}

// AND THE OTHER DIRECTION, as a warning rather than a failure: an id in the
// markup that nothing ever reaches for is usually dead markup, but it is also
// how a CSS hook or an aria target legitimately looks, so it is reported and
// not enforced.
const usedInJs = new Set();
for (const file of sources) {
  const src = readFileSync(new URL('src/' + file, root), 'utf8');
  for (const m of src.matchAll(/(['"])([A-Za-z][\w-]*)\1/g)) usedInJs.add(m[2]);
}
const unreferenced = [...declared].filter((id) => !usedInJs.has(id)
  && !head.includes('#' + id)
  && !body.includes('#' + id));

console.log(`${asked} literal ids asked for, ${declared.size} declared in the markup`);
if (unreferenced.length) console.log(`  not reached from JS or CSS (may be fine): ${unreferenced.join(', ')}`);
if (missing.length) {
  console.log('\nASKED FOR BUT NOT IN THE MARKUP:');
  for (const m of missing) console.log('  ' + m);
  process.exit(1);
}
console.log('every id the code reaches for exists.');
