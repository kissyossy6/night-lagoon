/** Screenshot one page of the dev server: node scripts/page-shot.mjs <path> <out.png> [w] [h] [readyFlag] */
import { chromium } from 'playwright';
const [, , path, out, w = 1440, h = 900, flag = ''] = process.argv;
const launch = { headless: true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
await page.goto(`http://localhost:5199/${path}`);
if (flag) await page.waitForFunction((f) => window[f] === true, flag, { timeout: 60000 });
await page.waitForTimeout(800);
await page.screenshot({ path: out });
console.log(out);
await browser.close();
