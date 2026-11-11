/**
 * The fireworks depend on the show time alone: a frame reached by jumping to
 * t must match the same frame reached by playing up to it (30 fps from 4 s
 * before). Writes both shots; compare them with scripts/pixel-diff.py.
 *   node scripts/pyro-seek-check.mjs [--out=shots/stage2/seek] [--t=23,41,61,108]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const out = arg('out', 'shots/stage2/seek');
const times = arg('t', '23,41,61,108').split(',').map(Number);
mkdirSync(`${out}/jump`, { recursive: true });
mkdirSync(`${out}/play`, { recursive: true });
const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const base = 'http://localhost:5199/play.html?show=pyrotest&cam=pyro&shot=1';
for (const t of times) {
  await page.goto(`${base}&t=${t}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  await page.screenshot({ path: `${out}/jump/t${t}.png` });
  await page.goto(`${base}&t=${t - 4}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  await page.evaluate((t) => {
    for (let k = 120; k >= 0; k--) window.__rt.render(t - k / 30);
  }, t);
  await page.screenshot({ path: `${out}/play/t${t}.png` });
}
console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
