/**
 * Stage-6 editor shots: the editor with the 花火版 loaded at one time, for the
 * 今｜案 sheets. Needs the dev server on :5199.
 *
 *   node scripts/stage6-shots.mjs --out=shots/stage6/now [--t=175] [--show=hanabi] [--w=1440 --h=900]
 *     [--eval="js run in the page after loading"]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : true];
  }),
);
const out = args.out ?? 'shots/stage6/now';
const t = Number(args.t ?? 175);
const show = args.show ?? 'hanabi';
mkdirSync(out, { recursive: true });

const launch = { headless: !args.headed, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: Number(args.w ?? 1440), height: Number(args.h ?? 900) } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(`http://localhost:5199/edit.html?fresh&t=${t}${args.q ? `&${args.q}` : ""}`);
await page.waitForFunction(() => window.__editorReady === true, null, { timeout: 60000 });
await page.waitForFunction(() => window.__editor.transport.music !== 'loading', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(500);
await page.evaluate(async ({ show, t }) => {
  const { buildShow } = await import('/src/show/choreography.ts');
  const ed = window.__editor;
  ed.state.load(buildShow(undefined, show));
  ed.transport.seek(t);
}, { show, t });
if (args.eval) await page.evaluate(args.eval);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/editor.png` });
console.log(`${out}/editor.png`);
console.log(JSON.stringify(await page.evaluate(() => { const tl = window.__editor.timeline; return { viewT: tl.viewT, pps: tl.pps }; })));
if (errors.length) console.log('errors:\n' + errors.join('\n'));
await browser.close();
