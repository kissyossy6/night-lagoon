/**
 * Render the water-screen projection at fixed times, save a contact sheet and
 * per-frame PNGs, and print render timings. Needs the dev server on :5199.
 *
 *   node scripts/projection-check.mjs
 *   node scripts/projection-check.mjs --times=80,90,100 --out=shots/projection --w=2048 --h=384 --n=200
 *   node scripts/projection-check.mjs --headed     (GPU canvas timings in a visible window)
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : true];
  }),
);
const out = args.out ?? 'shots/projection';
const times = args.times ?? '4,12,24,40,56,70,86,96,106,118,126,136,150,165,176';
mkdirSync(out, { recursive: true });

const launch = { headless: !args.headed, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
// Playwright's own Chromium can be missing after an upgrade; fall back to the installed Chrome
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

const qs = new URLSearchParams({ times: String(times), w: String(args.w ?? 2048), h: String(args.h ?? 384), n: String(args.n ?? 200) });
await page.goto(`http://localhost:5199/tools/projection-check.html?${qs}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const r = await page.evaluate(() => window.__projection);
await browser.close();

const png = (url) => Buffer.from(url.split(',')[1], 'base64');
writeFileSync(`${out}/contact-sheet.png`, png(r.sheet));
for (const f of r.frames) {
  const name = String(f.t).padStart(3, '0');
  writeFileSync(`${out}/t${name}.png`, png(f.screen));
  if (args.raw) writeFileSync(`${out}/t${name}_raw.png`, png(f.raw));
}

const fmt = (v) => v.map((x) => x.toFixed(3)).join(' ');
console.log(`canvas ${r.size.join('x')}  deterministic=${r.deterministic}`);
for (const f of r.frames) console.log(`t=${String(f.t).padStart(3)}  level=${f.level.toFixed(2)}  avg=${fmt(f.avg)}  ref=${fmt(f.refAvg)}`);
const T = r.timing;
console.log(`timing over ${T.calls} calls spread over the show (ms/frame):`);
console.log(`  render() main-thread cost            ${T.cpuMs.toFixed(3)}`);
console.log(`  render() + averageColor() (GPU sync) ${T.withAvgMs.toFixed(3)}`);
console.log(`  readback latency (near-empty frame)  ${T.readbackLatencyMs.toFixed(3)}`);
console.log('  per section:');
for (const [k, v] of Object.entries(T.perSection)) console.log(`    ${k.padEnd(10)} render ${v.cpuMs.toFixed(3)}   render+avg ${v.withAvgMs.toFixed(3)}`);
console.log(`contact sheet: ${out}/contact-sheet.png`);
if (errors.length) {
  console.log('page errors:');
  for (const e of errors) console.log('  ' + e);
  process.exitCode = 1;
}
