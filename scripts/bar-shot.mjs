/**
 * Photograph the player with its bottom bar showing (start screen removed),
 * for judging the bar's look. Needs the dev server on :5199.
 *   node scripts/bar-shot.mjs --out=shots/bar.png [--url=/?t=50] [--scope]
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...r] = a.replace(/^--/, '').split('='); return [k, r.length ? r.join('=') : true]; }));
const launch = { headless: true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript((scope) => localStorage.setItem('water-show-scope', scope ? '1' : '0'), !!args.scope);
await page.goto(`http://localhost:5199${args.url ?? '/?t=50'}`);
await page.waitForTimeout(4000);
await page.evaluate(() => document.getElementById('start')?.remove());
if (args.open) await page.click(args.open);
await page.waitForTimeout(800);
await page.screenshot({ path: args.out ?? 'shots/bar.png' });
await browser.close();
