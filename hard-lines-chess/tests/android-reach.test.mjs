// The Android app connects to one place. This holds the things that say so to
// each other.
//
// Until version 1.6 the APK held no permission to connect at all, and the
// system enforced it. It now holds that permission for one thing — reading
// Chess.com's public archive of a player's games — and Android cannot grant a
// permission for one address. So the limit is the app's own, and a limit kept
// in three files can come apart in any of them: the manifest could gain a
// second permission, MainActivity could let out a second address, or the page
// could start asking for one the app refuses. Each of those would pass every
// test of the others.
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');

let checks = 0;
let failures = 0;
const check = (what, got, want) => {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) { failures++; console.log(`     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`); }
};

// ── what the system is asked for ────────────────────────────────────────────
const manifest = read('android/app/src/main/AndroidManifest.xml').replace(/<!--[\s\S]*?-->/g, '');
const permissions = [...manifest.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map((m) => m[1]);
check('the app asks for one permission: to connect', permissions, ['android.permission.INTERNET']);
check('and never without https', /android:usesCleartextTraffic="false"/.test(manifest), true);

// ── what the app lets out ───────────────────────────────────────────────────
const activity = read('android/app/src/main/java/chess/hardlines/MainActivity.java');
const code = activity.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const host = /ARCHIVE_HOST = "([^"]+)"/.exec(code)?.[1];
const path = /ARCHIVE_PATH = "([^"]+)"/.exec(code)?.[1];
const asked = /const CHESSCOM_API = '([^']+)'/.exec(read('src/import.js'))?.[1];
check('the address the app lets out is the one the page asks for', `https://${host}${path}`, `${asked}/`);
const intercept = /public WebResourceResponse shouldInterceptRequest\([\s\S]*?\n            \}/.exec(code)?.[0] ?? '';
check('one kind of request is let out, and only as a read of that archive',
  [...intercept.matchAll(/return null;/g)].length === 1 && /if \(isGameArchive\(request\)\) return null;/.test(intercept), true);
const rule = /private static boolean isGameArchive\([\s\S]*?\n    \}/.exec(code)?.[0] ?? '';
for (const [what, has] of [
  ['over https', /"https"\.equalsIgnoreCase\(url\.getScheme\(\)\)/],
  ['to that host exactly', /ARCHIVE_HOST\.equalsIgnoreCase\(url\.getHost\(\)\)/],
  ['on the ordinary port', /url\.getPort\(\) == -1 \|\| url\.getPort\(\) == 443/],
  ['under that path', /path\.startsWith\(ARCHIVE_PATH\)/],
  ['and only to read', /"GET"\.equalsIgnoreCase\(request\.getMethod\(\)\)/],
]) check(`a read of the archive is ${what}`, has.test(rule), true);
check('everything else ends in a refusal', /return new WebResourceResponse\("text\/plain", "utf-8", 404, "Not Found"/.test(intercept), true);

// ── what the page is told ───────────────────────────────────────────────────
check('the rule the page is given names where it came from, that host, and nowhere else',
  /PAGE_POLICY = "connect-src 'self' https:\/\/" \+ ARCHIVE_HOST;/.test(code), true);
check('and is attached to everything served from the app', /if \(local != null\) return sealed\(local\);/.test(intercept), true);

// ── and nothing else is named ───────────────────────────────────────────────
const hosts = [...new Set([...code.matchAll(/"([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|dev))"/g)].map((m) => m[1]))].sort();
check('the only hosts the app names are its own, the typefaces’ and the archive’s',
  hosts, ['api.chess.com', 'appassets.androidplatform.net', 'fonts.googleapis.com']);

// ── the page asks for nothing the app would refuse ──────────────────────────
// (Reckless is a download the page offers on the website only; in the app it
// says so instead of asking — recklessStatus() answers 'apk' before any fetch.)
const reckless = read('src/reckless-driver.js');
check('Reckless is not asked for inside the app',
  /if \(typeof IN_ANDROID_APP !== 'undefined' && IN_ANDROID_APP\) return \{ state: 'apk' \};/.test(reckless), true);

console.log(`${checks} checks, ${failures} failed`);
if (failures) process.exit(1);
