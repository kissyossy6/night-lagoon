/**
 * The video export carries the fireworks: export 21.5-24.5 s of the 花火版
 * (the 10号) from the 花火 seat and save the mp4.
 *   node scripts/pyro-export-check.mjs [--out=shots/stage2/export]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=shots/stage2/export').slice(6);
mkdirSync(out, { recursive: true });
const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5199/play.html?show=pyrotest&cam=pyro');
await page.waitForFunction(() => window.__rt && window.__rt.show, null, { timeout: 60000 });
const download = page.waitForEvent('download', { timeout: 300000 });
await page.evaluate(() => {
  document.getElementById('export-open').click();
  const f = document.getElementById('export-form');
  f.querySelector('input[name=range][value=part]').checked = true;
  document.getElementById('export-from').value = '21.5';
  document.getElementById('export-to').value = '24.5';
  const size = document.getElementById('export-size');
  size.value = [...size.options].map((o) => o.value).find((v) => v.startsWith('1280')) ?? size.value;
  document.getElementById('export-angle').value = 'pyro';
  f.requestSubmit();
});
const d = await download;
const file = `${out}/${d.suggestedFilename()}`;
await d.saveAs(file);
console.log(file, JSON.stringify(await page.evaluate(() => window.__export)));
console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
