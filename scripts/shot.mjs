/**
 * Screenshot the nozzle lab: every nozzle × technique × camera at fixed times.
 * Requires the dev server (npm run dev) on :5199.
 *
 *   node scripts/shot.mjs                        all combos -> shots/lab
 *   node scripts/shot.mjs --nozzle=ring --tech=D  filter
 *   node scripts/shot.mjs --perf                 also time each combo
 *   node scripts/shot.mjs --out=shots/x --extra="lm=0"
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : true];
  }),
);
const NOZZLES = ['vertical', 'shooter', 'oscillating', 'fan', 'ring', 'mist'];
const TECHS = ['A', 'B', 'C', 'D', 'E'];
const CAMS = ['audience', 'close'];
// times picked to show each fixture mid-motion (shooter: shot top reached)
const TIMES = { vertical: 9, shooter: 9.3, oscillating: 9.5, fan: 9, ring: 9, mist: 9 };

const out = args.out ?? 'shots/lab';
mkdirSync(out, { recursive: true });

const launchArgs = ['--use-gl=angle', '--ignore-gpu-blocklist'];
// Playwright's own Chromium can be missing after an upgrade; fall back to the installed Chrome
const browser = await chromium
  .launch({ args: launchArgs })
  .catch(() => chromium.launch({ channel: 'chrome', headless: true, args: launchArgs }));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

const report = [];
for (const nozzle of NOZZLES) {
  if (args.nozzle && !String(args.nozzle).split(',').includes(nozzle)) continue;
  for (const tech of TECHS) {
    if (args.tech && !String(args.tech).split(',').includes(tech)) continue;
    for (const cam of CAMS) {
      if (args.cam && args.cam !== cam) continue;
      const t = args.t ?? TIMES[nozzle];
      const extra = args.extra ? `&${args.extra}` : '';
      const url = `http://localhost:5199/lab.html?nozzle=${nozzle}&tech=${tech}&cam=${cam}&t=${t}&shot=1${extra}`;
      errors.length = 0;
      await page.goto(url);
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
      const file = `${out}/${nozzle}_${tech}_${cam}.png`;
      await page.screenshot({ path: file });
      if (args.dt) {
        // second frame 1/60 s later, for flicker measurement
        const t2 = Number(t) + 1 / 60;
        await page.goto(url.replace(`t=${t}`, `t=${t2}`));
        await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
        await page.screenshot({ path: file.replace('.png', '_dt.png') });
      }
      let ms = null;
      if (args.perf && cam === 'audience') {
        await page.goto(url.replace('shot=1', 'shot=1&perf=1'));
        await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
        ms = await page.evaluate(() => window.__perf);
      }
      report.push({ nozzle, tech, cam, file, ms, errors: [...errors] });
      console.log(`${file}${ms ? `  ${ms.toFixed(2)} ms` : ''}${errors.length ? '  ⚠ ' + errors[0].slice(0, 300) : ''}`);
    }
  }
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
