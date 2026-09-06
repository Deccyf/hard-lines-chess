const { launch, app, serve, DIST } = require('./browser.cjs');
module.exports = async function open(opts = {}) {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1200 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(app());
  await page.waitForSelector('#tab-play');
  await page.click('#tab-play');
  const say = (k, v) => console.log(String(k).padEnd(34), v);
  return { browser, page, errors, say };
};
