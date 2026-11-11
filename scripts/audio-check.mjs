/**
 * Render the procedural score in Chromium and print the audio report.
 * Requires the dev server on :5199 (npx vite --port 5199 --strictPort).
 *   node scripts/audio-check.mjs
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5199/tools/audio-check.html');
await page.waitForFunction(() => window.__audioReport, null, { timeout: 120000 });
const r = await page.evaluate(() => window.__audioReport);
await browser.close();

console.log(JSON.stringify(r, null, 2));
if (errors.length) console.log('console errors:', errors);
if (r.error) process.exit(1);

const by = Object.fromEntries(r.sections.map((s) => [s.name, s]));
const checks = {
  'render < 10 s': r.renderMs < 10000,
  'peak < 0.9': r.peak < 0.9,
  'no clipping': r.clippedSamples === 0,
  'duration 180 s': Math.abs(r.duration - 180) < 0.01,
  deterministic: r.deterministic,
  'no silent section (> -45 dB)': r.sections.every((s) => s.rmsDb > -45),
  'RMS intro < awakening < theme < finale': by.intro.rms < by.awakening.rms && by.awakening.rms < by.theme.rms && by.theme.rms < by.finale.rms,
  'finale loudest': r.sections.every((s) => s.rms <= by.finale.rms),
  'hits are onsets (ratio > 1.5)': r.hitOnsets.every((h) => h.ratio > 1.5),
  'riser end drops': r.riserEndDrop < 0.6,
};
for (const [k, ok] of Object.entries(checks)) console.log(`${ok ? 'PASS' : 'FAIL'}  ${k}`);
process.exit(Object.values(checks).every(Boolean) ? 0 : 2);
