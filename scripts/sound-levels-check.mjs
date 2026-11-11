/**
 * The player's 音量 menu (src/audio/levels.ts): moves the water slider,
 * checks the level is shown, kept across a reload and reset, and
 * screenshots the menu.  node scripts/sound-levels-check.mjs [--out=shots/sound]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=shots/sound').slice(6);
mkdirSync(out, { recursive: true });
const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const failures = [];
const check = (ok, what) => (ok ? console.log(`ok    ${what}`) : (failures.push(what), console.log(`FAIL  ${what}`)));

await page.goto('http://localhost:5199/play.html?show=hanabi&cam=sky&t=163');
await page.evaluate(() => localStorage.removeItem('water-show-levels-v2'));
await page.reload();
await page.waitForSelector('#vol-open');
// the start screen may cover the bar: get past it if there is one
await page.evaluate(() => document.getElementById('start')?.remove());
await page.click('#vol-open');
const rows = await page.$$eval('#vol label', (ls) => ls.map((l) => [l.firstChild.textContent, l.querySelector('output').value]));
check(JSON.stringify(rows) === JSON.stringify([['音楽', '100%'], ['水音', '100%'], ['花火', '100%']]), `three sliders at 100% ${JSON.stringify(rows)}`);
await page.$eval('#vol input[aria-label="水音の音量"]', (el) => {
  el.value = '0.6';
  el.dispatchEvent(new Event('input'));
});
const shown = await page.$eval('#vol input[aria-label="水音の音量"] + output', (o) => o.value);
check(shown === '60%', `water shows 60% (${shown})`);
await page.screenshot({ path: `${out}/volume-menu.png` });
await page.reload();
await page.waitForSelector('#vol-open');
const kept = await page.$eval('#vol input[aria-label="水音の音量"]', (el) => el.value);
check(kept === '0.6', `kept after reload (${kept})`);
await page.evaluate(() => document.getElementById('start')?.remove());
await page.click('#vol-open');
await page.click('#vol-reset');
const reset = await page.$eval('#vol input[aria-label="水音の音量"]', (el) => el.value);
check(reset === '1', `元に戻す sets 100% (${reset})`);
check(!errors.length, errors.length ? `errors: ${errors.join('\n')}` : 'no console errors');
await browser.close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
