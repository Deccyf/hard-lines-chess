// The Android app's half of saving and opening a backup file.
//
// MainActivity.java — the real file — is compiled against the stand-ins for
// Android in tests/android-bridge/stand-ins/ and run on an ordinary JVM by
// tests/android-bridge/BridgeTest.java, which says what it shows and what it
// cannot. This only builds and runs it.
//
// It needs a Java compiler. The published build has one, because it builds the
// APK, so there a missing compiler is a failure; on a machine without one the
// test says it was not run rather than pretending it passed.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'android-bridge');
// Every file of the app's own: the activity, and the reminder it reaches.
const app = join(here, '..', 'android', 'app', 'src', 'main', 'java', 'chess', 'hardlines');

// The sandbox this is developed in sets options for every JVM and each one
// announces them on stderr; they have nothing to do with the test.
const env = { ...process.env };
delete env.JAVA_TOOL_OPTIONS;
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', env });

if (run('javac', ['-version']).error) {
  if (process.env.CI) {
    console.log('FAIL there is no Java compiler here, so the Android file handling was not tested');
    process.exit(1);
  }
  console.log('(no Java compiler on this machine: the Android file handling was NOT tested here)');
  process.exit(0);
}

const javaFiles = (root) => readdirSync(root).flatMap((name) => {
  const path = join(root, name);
  return statSync(path).isDirectory() ? javaFiles(path) : (name.endsWith('.java') ? [path] : []);
});

const out = mkdtempSync(join(tmpdir(), 'hl-bridge-'));
try {
  const sources = join(out, 'sources.txt');
  writeFileSync(sources, [...javaFiles(join(dir, 'stand-ins')), ...javaFiles(app), join(dir, 'BridgeTest.java')].join('\n'));
  const compiled = run('javac', ['-nowarn', '-d', join(out, 'classes'), `@${sources}`]);
  if (compiled.status !== 0) {
    console.log('FAIL the app does not compile against the stand-ins');
    console.log(compiled.stdout + compiled.stderr);
    process.exit(1);
  }
  const ran = run('java', ['-cp', join(out, 'classes'), 'chess.hardlines.BridgeTest']);
  process.stdout.write(ran.stdout);
  if (ran.status !== 0) {
    process.stdout.write(ran.stderr);
    process.exit(1);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
