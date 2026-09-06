// One place every browser driver gets its Chromium from. `npm install` gives
// Playwright its own; CHROME_PATH points it at an existing binary instead.
const { chromium } = require('playwright');
const path = require('path');

const DIST = path.resolve(__dirname, '..', 'dist');

async function launch(options = {}) {
  return chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox'],
    ...options,
  });
}

/** file:// URL of a built page in dist/. */
const app = (name = 'hard-lines-chess-app.html') => 'file://' + path.join(DIST, name);

module.exports = { launch, app, DIST };

/**
 * A throwaway static server over a directory, for the drivers that need a
 * real origin (the service worker, downloads, the installable kit). Python's
 * http.server is used because it is on every machine the tests run on.
 */
function serve(dir, port) {
  const { spawn } = require('child_process');
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' });
  const ready = new Promise((resolve) => setTimeout(resolve, 900));
  return { url: `http://127.0.0.1:${port}`, ready, stop: () => proc.kill() };
}
module.exports.serve = serve;

/**
 * Click through to a screen, at both levels of the strip.
 *
 * The nav is two rows: six groups, and — for a group holding more than one
 * screen — a second row of that group's screens. A screen in a group of one is
 * a top-level button and there is no second row. So this opens the group and
 * then the screen, which is what a person does, and it keeps every driver
 * honest about the nav actually working rather than reaching past it into
 * show().
 */
async function gotoSection(page, id) {
  await page.evaluate((section) => {
    const group = GROUPS.find((g) => g.sections.includes(section));
    if (!group || group.sections.length === 1) return;
    document.getElementById('gtab-' + group.id).click();
  }, id);
  await page.click('#tab-' + id);
}
module.exports.gotoSection = gotoSection;

/**
 * The same, by touch. Phones tap; the drivers that emulate one need the two
 * levels reached the way a thumb reaches them, not through a synthetic click.
 */
async function tapSection(page, id) {
  const group = await page.evaluate((section) => {
    const g = GROUPS.find((x) => x.sections.includes(section));
    return g && g.sections.length > 1 ? 'gtab-' + g.id : null;
  }, id);
  if (group) { await page.tap('#' + group); await page.waitForTimeout(120); }
  await page.tap('#tab-' + id);
}
module.exports.tapSection = tapSection;
