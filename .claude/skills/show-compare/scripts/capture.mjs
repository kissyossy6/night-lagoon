/**
 * Shoot two (or more) versions of the show at the same times from the same
 * seat, for 今｜案 sheets, motion strips and the toggle viewer.
 *
 *   node .claude/skills/show-compare/scripts/capture.mjs --out=shots/<topic> \
 *     --src=now:show=lagoon --src=new:file=shots/<topic>/proposal.json \
 *     --t=62.53,66.5            (or --from=91.6 --to=94 --step=0.4) \
 *     [--cam=audience] [--light=real] [--size=1280x720] [--extra=gfx=off]
 *
 * --src=<name>:<spec>   name = file prefix (ascii: now, new, a, b ...)
 *   spec is a query string, joined with &:
 *     show=<lagoon|fantasia|hanabi|pyrotest>   a built-in version
 *     file=<path.json>   a ShowFile (from make-proposal.mjs or an editor export),
 *                        seeded as the editor autosave and played with show=edited
 *     base=<url>         another server, e.g. base=http://localhost:5299 for a
 *                        backup copy of the code (renderer changes)
 *     project=<id>       a saved project (projects/<id>/project.json), once play.html reads it
 *     anything else (venue=plaza, cam=sky, light=ideal, gfx=off) goes on the URL
 * Output: <out>/<name>_t<sec.2>.png and <out>/capture.json (what was shot).
 * Each run uses a throwaway browser: the user's own editor save is never touched.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const a = argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const out = arg('out', 'shots/compare');
const cam = arg('cam', 'audience');
const light = arg('light', 'real');
const [w, h] = arg('size', '1280x720').split('x').map(Number);
const extra = arg('extra', '');
const srcs = argv
  .filter((a) => a.startsWith('--src='))
  .map((a) => {
    const body = a.slice(6);
    const i = body.indexOf(':');
    const name = body.slice(0, i);
    // quote the whole --src in the shell when the spec holds '&'
    const params = new URLSearchParams(body.slice(i + 1));
    return { name, params };
  });
if (!srcs.length) {
  console.error('give at least one --src=<name>:<spec>');
  process.exit(2);
}
let times = arg('t', '').split(',').filter(Boolean).map(Number);
if (!times.length) {
  const [from, to, step] = ['from', 'to', 'step'].map((k) => Number(arg(k, '0')));
  if (!(step > 0)) {
    console.error('give --t=... or --from= --to= --step=');
    process.exit(2);
  }
  for (let t = from; t <= to + 1e-6; t += step) times.push(Math.round(t * 100) / 100);
}

mkdirSync(out, { recursive: true });
const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const record = { cam, light, size: [w, h], extra, times, sources: [] };

for (const { name, params } of srcs) {
  const base = params.get('base') ?? 'http://localhost:5199';
  params.delete('base');
  const file = params.get('file');
  params.delete('file');
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  if (file) {
    const saved = readFileSync(resolve(file), 'utf8');
    const parsed = JSON.parse(saved);
    if (!(parsed.duration >= 217)) console.warn(`⚠ ${file}: duration ${parsed.duration} < 217 — the player swaps in the built-in ending (extendToMusic)`);
    await ctx.addInitScript((s) => localStorage.setItem('water-show-editor:v1', s), saved);
    params.set('show', 'edited');
  }
  if (!params.has('cam')) params.set('cam', cam);
  if (!params.has('light')) params.set('light', light);
  params.set('t', String(times[0]));
  params.set('shot', '1');
  // the player moved to play.html (docs/projects-plan.md); older copies only have /
  const page0 = (await fetch(`${base}/play.html`).then((r) => r.ok).catch(() => false)) ? '/play.html' : '/';
  const url = `${base}${page0}?${params.toString()}${extra ? `&${extra}` : ''}`;
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const title = await page.evaluate(() => window.__rt?.file?.title ?? document.title);
  const shots = [];
  for (const t of times) {
    await page.evaluate(async (t) => {
      const rt = window.__rt;
      await rt.prepare(t);
      rt.render(t);
    }, t);
    const path = `${out}/${name}_t${t.toFixed(2)}.png`;
    await page.screenshot({ path });
    shots.push(path);
  }
  console.log(`${name}: ${title} — ${shots.length} frames  (${url})`);
  if (errors.length) console.log(`  ⚠ page errors:\n  ${errors.join('\n  ')}`);
  record.sources.push({ name, url, title, file, errors });
  await ctx.close();
}
writeFileSync(`${out}/capture.json`, JSON.stringify(record, null, 2));
await browser.close();
