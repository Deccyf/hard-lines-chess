const { chromium } = require('/home/user/chess/node_modules/playwright-core');
// The Hard Lines mark: a 2x2 checker, vermilion and bone, on ink.
// `inset` is the ink margin as a fraction — a maskable icon needs a wide one,
// because Android crops the icon to whatever shape the launcher uses and only
// the middle 80% is guaranteed to survive.
const page = (size, inset) => {
  const m = Math.round(size * inset);
  const box = size - m * 2;
  return `<html><body style="margin:0;background:#14110d">
    <div style="position:absolute;left:${m}px;top:${m}px;width:${box}px;height:${box}px;
                display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr">
      <i style="background:#fbfaf7"></i><i style="background:#e8412a"></i>
      <i style="background:#e8412a"></i><i style="background:#fbfaf7"></i>
    </div></body></html>`;
};
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  for (const [size, inset, name] of [[192, 0.10, 'icon-192.png'], [512, 0.10, 'icon-512.png'], [512, 0.22, 'icon-maskable-512.png']]) {
    const p = await browser.newPage({ viewport: { width: size, height: size } });
    await p.setContent(page(size, inset));
    await p.screenshot({ path: 'pwa/' + name });
    await p.close();
  }
  await browser.close();
  console.log('icons written');
})();
