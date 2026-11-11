/**
 * The 花火版 against Night Lagoon at the same times, from one seat: one page
 * per version, rendered at each time (the picture depends on the time
 * alone). Sheets with scripts/hanabi-sheet.py.
 *   node scripts/hanabi-shots.mjs --t=162,163.2 [--shows=lagoon,hanabi] [--cam=sky] [--light=real] [--out=shots/stage3/hanabi/compare]
 *   --from=160.6 --to=164 --step=0.4   a run of frames instead of --t
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const out = arg('out', 'shots/stage3/hanabi/compare');
const cam = arg('cam', 'sky');
const light = arg('light', 'real');
const shows = arg('shows', 'lagoon,hanabi').split(',');
// --extra=gfx=off: the value may hold '=' itself
const extraArg = process.argv.find((a) => a.startsWith('--extra='))?.slice('--extra='.length) ?? '';
const extra = extraArg ? `&${extraArg}` : '';
let times = arg('t', '').split(',').filter(Boolean).map(Number);
if (!times.length) {
  const [from, to, step] = ['from', 'to', 'step'].map((k) => Number(arg(k, '0')));
  for (let t = from; t <= to + 1e-6; t += step) times.push(Math.round(t * 100) / 100);
}
mkdirSync(out, { recursive: true });
const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
for (const show of shows) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // ?show=lagoon is not a version name: anything else plays Night Lagoon
  await page.goto(`http://localhost:5199/play.html?show=${show}&cam=${cam}&light=${light}&t=${times[0]}&shot=1${extra}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  for (const t of times) {
    await page.evaluate(async (t) => {
      const rt = window.__rt;
      await rt.prepare(t);
      rt.render(t);
    }, t);
    const file = `${out}/${show}_t${t.toFixed(2)}.png`;
    await page.screenshot({ path: file });
    console.log(file);
  }
  if (errors.length) console.log('errors', errors.join('\n'));
  await page.close();
}
await browser.close();
