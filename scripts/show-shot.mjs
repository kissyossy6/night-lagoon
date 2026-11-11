/**
 * Screenshot the show player at given times.
 *   node scripts/show-shot.mjs --t=10,40 --out=shots/show --extra="light=ideal" [--perf] [--size=1280x720]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : true];
  }),
);
const times = String(args.t ?? '10').split(',');
const out = args.out ?? 'shots/show';
const [w, h] = String(args.size ?? '1280x720').split('x').map(Number);
mkdirSync(out, { recursive: true });
const launchArgs = ['--use-gl=angle', '--ignore-gpu-blocklist'];
// Playwright's own Chromium can be missing after an upgrade; fall back to the installed Chrome
const browser = await chromium
  .launch({ args: launchArgs })
  .catch(() => chromium.launch({ channel: 'chrome', headless: true, args: launchArgs }));
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const extra = args.extra ? `&${args.extra}` : '';
const tag = args.tag ? `_${args.tag}` : '';
for (const t of times) {
  errors.length = 0;
  const url = `http://localhost:5199/play.html?t=${t}&shot=1${extra}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const file = `${out}/t${t}${tag}.png`;
  await page.screenshot({ path: file });
  let ms = '';
  if (args.perf) {
    await page.goto(url + '&perf=1');
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
    ms = `  ${(await page.evaluate(() => window.__perf)).toFixed(2)} ms`;
  }
  console.log(file + ms + (errors.length ? '  ⚠ ' + errors.join(' | ').slice(0, 1500) : ''));
}
await browser.close();
