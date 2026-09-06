// Runs every browser driver in turn and fails on the first non-zero exit or
// any line containing "ERRORS" / "FAILED". Each driver prints its own checks.
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const dir = __dirname;
const drivers = fs.readdirSync(dir).filter((f) => f.endsWith('.cjs') && !['browser.cjs', 'run-browser.cjs', 'rv-lib.cjs'].includes(f)).sort();
let failed = 0;
for (const d of drivers) {
  process.stdout.write(`\n=== ${d}\n`);
  const r = spawnSync(process.execPath, [path.join(dir, d)], { cwd: dir, encoding: 'utf8', timeout: 600000 });
  process.stdout.write(r.stdout + r.stderr);
  if (r.status !== 0 || /(^|\n)(ERRORS|FAILED)/.test(r.stdout + r.stderr)) { failed++; process.stdout.write(`--- ${d} FAILED\n`); }
}
console.log(`\n${drivers.length - failed} of ${drivers.length} drivers passed`);
process.exit(failed ? 1 : 0);
