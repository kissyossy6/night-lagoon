/**
 * Stereo 180° bench: stills and short clips from tools/vr180.html in Chrome.
 * Requires the dev server (npm run dev) on :5199. Files land in --out.
 *
 *   node scripts/vr180.mjs still --eye=2048,4096 --t=63
 *   node scripts/vr180.mjs clip --eye=4096 --from=60 --to=70 --fps=30
 *   node scripts/vr180.mjs still --eye=4096 --t=63 --venue=plaza --seat=near   (seat: near | an angle; --show=hanabi; --port=5199)
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const [mode, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.map((a) => a.replace(/^--/, '').split('=')));
const out = args.out ?? 'shots/vr180';
mkdirSync(out, { recursive: true });
const eyes = String(args.eye ?? '4096').split(',').map(Number);

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ acceptDownloads: true });
const report = [];
for (const eye of eyes) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror', String(e)));
  page.on('console', (m) => m.type() === 'error' && console.error('console', m.text()));
  const saving = [];
  page.on('download', (d) => saving.push(d.saveAs(`${out}/${d.suggestedFilename()}`)));
  // the projector picture grows with the eye so the screen is not the soft spot
  const pw = Math.max(1536, Math.round((eye * 0.75) / 2) * 2);
  const ph = Math.round((pw * 288) / 1536 / 2) * 2;
  const extra = ['venue', 'seat', 'show'].filter((k) => args[k]).map((k) => `&${k}=${args[k]}`).join('');
  await page.goto(`http://localhost:${args.port ?? 5199}/tools/vr180.html?pw=${pw}&ph=${ph}${args.light ? `&light=${args.light}` : ''}${extra}`);
  await page.waitForFunction(() => window.__vr, null, { timeout: 60000 });
  await page.evaluate(() => window.__vr.ready);
  for (const t of String(args.t ?? '63').split(',').map(Number)) {
    let r;
    if (mode === 'clip') {
      r = await page.evaluate((o) => window.__vr.clip(o), { from: Number(args.from ?? 60), to: Number(args.to ?? 70), fps: Number(args.fps ?? 30), eye, tag: args.tag });
    } else {
      r = await page.evaluate((o) => window.__vr.still(o), { t, eye, tag: args.tag });
    }
    r.pw = pw;
    r.t = t;
    console.log(JSON.stringify(r));
    report.push(r);
    if (mode === 'clip') break;
  }
  await new Promise((res) => setTimeout(res, 1000));
  await Promise.all(saving);
  await page.close();
}
writeFileSync(`${out}/${mode}-${args.tag ?? 'run'}.json`, JSON.stringify(report, null, 2));
await browser.close();
