/**
 * The pictures of the first page (index.html, docs/projects-plan.md):
 *   public/home-bg.jpg                 the lagoon at night behind the start screen
 *   projects/sample-<id>/thumb.jpg     each sample's card in the project list
 * Requires the dev server (npm run dev).
 *
 *   node scripts/home-assets.mjs                 all
 *   node scripts/home-assets.mjs --only=hanabi   one sample (or bg)
 *   node scripts/home-assets.mjs --try=hanabi:180,190,200   candidates into shots/home/
 *   --base=http://localhost:5202
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : true];
  }),
);
const BASE = args.base ?? 'http://localhost:5199';
/** Which moment shows each sample best. */
const SAMPLES = { lagoon: '68.5', fantasia: '30', hanabi: '203&cam=sky' };

const launchArgs = ['--use-gl=angle', '--ignore-gpu-blocklist'];
const browser = await chromium
  .launch({ args: launchArgs })
  .catch(() => chromium.launch({ channel: 'chrome', headless: true, args: launchArgs }));

async function still(qs, size, path, quality) {
  const page = await browser.newPage({ viewport: size });
  await page.goto(`${BASE}/play.html?shot=1&quality=high&${qs}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await page.screenshot({ path, type: 'jpeg', quality });
  await page.close();
  console.log('wrote', path);
}

if (args.try) {
  mkdirSync('shots/home', { recursive: true });
  const [id, times] = String(args.try).split(':'); // e.g. hanabi:203&cam=sky,207
  for (const t of times.split(',')) await still(`show=${id}&t=${t}`, { width: 960, height: 540 }, `shots/home/${id}-${t.replace(/[^0-9a-z.]+/gi, '_')}.jpg`, 80);
} else {
  if (!args.only || args.only === 'bg') await still('show=lagoon&t=1', { width: 1920, height: 1080 }, 'public/home-bg.jpg', 72);
  for (const [id, t] of Object.entries(SAMPLES)) {
    if (args.only && args.only !== id) continue;
    await still(`show=${id}&t=${t}`, { width: 960, height: 540 }, `projects/sample-${id}/thumb.jpg`, 82);
  }
}
await browser.close();
