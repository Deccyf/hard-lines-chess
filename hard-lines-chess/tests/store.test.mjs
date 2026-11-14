// One list of what the app keeps, and everything held to it.
//
// The app's data is ten separate areas — settings, drills, reviewed games and
// so on — and three things have to know all of them: the store, which moves
// each out of the small store; the backup file, which has to carry each; and
// the start of the app, which has to load each. An area added to one and not
// the others is an area that is used, saved, and then missing from every
// backup, which nobody would find out until the day they needed it.
//
// So there is one list, STORE_AREAS, and this reads the source to check that
// every area the code saves or loads is on it, that the backup knows the shape
// of each, and that the app loads each when it starts.
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../src/', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');

let checks = 0;
let failures = 0;
const check = (what, got, want) => {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) { failures++; console.log(`     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`); }
};

const store = read('store.js');
const areas = JSON.parse(/const STORE_AREAS = (\[[^\]]*\]);/.exec(store)[1].replace(/'/g, '"'));
check('there is a list of areas, with no area twice', new Set(areas).size === areas.length && areas.length > 0, true);

// Every name the app's own code saves or loads.
const used = new Set();
for (const file of readdirSync(root).filter((f) => f.endsWith('.js'))) {
  for (const m of read(file).matchAll(/Store\.(?:get|set)\(\s*'([A-Za-z_]+)'/g)) used.add(m[1]);
}
check('every area the code saves or loads is on the list', [...used].filter((n) => !areas.includes(n)), []);
check('and nothing is on the list that the code never touches', areas.filter((n) => !used.has(n)), []);

// The backup has to know what each looks like, or it cannot check a file.
const backup = read('backup.js');
const shapes = /const BACKUP_SHAPES = \{([\s\S]*?)\n\};/.exec(backup)[1];
const shaped = [...shapes.matchAll(/^\s{2}([A-Za-z_]+):/gm)].map((m) => m[1]);
check('the backup knows the shape of every area', areas.filter((n) => !shaped.includes(n)), []);
check('and of nothing else', shaped.filter((n) => !areas.includes(n)), []);

// And the app has to load each when it starts — and again after a restore.
const boot = /async function loadStored\(\) \{([\s\S]*?)\n\}/.exec(read('app-c.js'))[1];
const loaded = [...boot.matchAll(/Store\.get\('([A-Za-z_]+)'/g)].map((m) => m[1]);
check('the app loads every area when it starts', areas.filter((n) => !loaded.includes(n)), []);

// The names kept beside the data are not areas, and must never look like one.
const beside = [...new Set([...store.matchAll(/'(__[a-z]+)'/g), ...backup.matchAll(/'(__[a-z]+)'/g)].map((m) => m[1]))].sort();
check('what is kept beside the data is named so that it cannot be mistaken for an area', beside.every((n) => !areas.includes(n)) && beside.length > 0, true);

// ── the page and the Android app have to mean the same names ───────────────
//
// The page's half of the bridge is driven in a browser against a pretend app,
// and the app's half on a JVM against a pretend page. Each is tested against
// its own idea of what the other is called — so a name spelt two ways would
// pass both, and fail only on a phone. This holds the three to each other.
const activity = readFileSync(new URL('../android/app/src/main/java/chess/hardlines/MainActivity.java', import.meta.url), 'utf8');
const offered = [...activity.matchAll(/@JavascriptInterface\s+public\s+[\w.\[\]<>]+\s+(\w+)\s*\(/g)].map((m) => m[1]).sort();
const called = [...new Set([...backup.matchAll(/\bbridge\.(\w+)\b/g)].map((m) => m[1]))].sort();
check('the Android app offers the page some ways in', offered.length > 0, true);
check('every way into the Android app that the page calls is one the app offers', called.filter((n) => !offered.includes(n)), []);
check('and the app offers none that the page never calls', offered.filter((n) => !called.includes(n)), []);
const told = [...new Set([...activity.matchAll(/tellPage\("(\w+)"/g)].map((m) => m[1]))].sort();
const heard = [...new Set([...backup.matchAll(/window\.(hardLines\w+)\s*=/g)].map((m) => m[1]))].sort();
check('everything the Android app tells the page is something the page listens for', told.filter((n) => !heard.includes(n)), []);
check('and the page listens for nothing the app never says', heard.filter((n) => !told.includes(n)), []);
const drive = readFileSync(new URL('./storage-drive.cjs', import.meta.url), 'utf8');
const pretend = /window\.HardLinesAndroid = \{([\s\S]*?)\n    \};/.exec(drive)[1];
const pretended = [...pretend.matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1]).sort();
check('the pretend app the browser test drives offers exactly what the real one does', pretended, offered);

console.log(`${checks} checks, ${failures} failed`);
if (failures) process.exit(1);
