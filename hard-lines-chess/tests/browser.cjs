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
