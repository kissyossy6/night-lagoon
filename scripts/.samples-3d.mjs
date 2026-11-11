import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-gl=angle', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
for (const v of ['desk', 'garden', 'plaza']) for (const [cam, t] of [['audience', 70], ['aerial', 70]]) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('ERR', v, String(e)));
  await p.goto(`http://localhost:5199/play.html?venue=${v}&shot=1&t=${t}&cam=${cam}&quality=medium`);
  await p.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await p.screenshot({ path: `shots/stage5/samples/3d-${v}-${cam}.png` });
  await p.close();
}
await browser.close();
