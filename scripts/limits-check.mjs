/**
 * Export ceilings in a real browser: open tools/limits.html, wait, save the
 * result. Requires the dev server (npm run dev) on :5199.
 *
 *   node scripts/limits-check.mjs [--channel=chrome|msedge] [--out=shots/vr180/limits-chrome.json]
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const channel = args.channel ?? 'chrome';
const browser = await chromium.launch({ channel, headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error(String(e)));
await page.goto('http://localhost:5199/tools/limits.html');
await page.waitForFunction(() => window.__limits, null, { timeout: 600000 });
const r = await page.evaluate(() => window.__limits);
const out = args.out ?? `shots/vr180/limits-${channel}.json`;
writeFileSync(out, JSON.stringify(r, null, 2));
console.log(await page.evaluate(() => document.getElementById('out').textContent));
await browser.close();
