/**
 * The screens of the project flow (docs/projects-plan.md), for the manual and
 * the screen-flow diagram (docs/screen-flow.html):
 *   docs/manual/img/00-home.jpg   start screen
 *   docs/manual/img/00-list.jpg   project list
 *   docs/manual/img/00-new.jpg    新規プロジェクト dialog
 *   docs/manual/img/00-editor.jpg the editor on a project
 *   docs/manual/img/00-play.jpg   the player's start (本番再生)
 * Needs the dev server and at least one project (the first in the list is used).
 *   node scripts/flow-shots.mjs [--base=http://localhost:5199]
 */
import { chromium } from 'playwright';

const base = process.argv.find((a) => a.startsWith('--base='))?.slice(7) ?? 'http://localhost:5199';
const out = 'docs/manual/img';
const launchArgs = ['--use-gl=angle', '--ignore-gpu-blocklist', '--mute-audio'];
const browser = await chromium
  .launch({ args: launchArgs })
  .catch(() => chromium.launch({ channel: 'chrome', headless: true, args: launchArgs }));
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const shot = (name) => page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 82 });
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(`${base}/`);
await wait(1200);
await shot('00-home');

await page.click('#open-list');
await page.waitForFunction(() => window.__home && document.querySelectorAll('#samples .card img').length > 0);
await page.waitForFunction(() => [...document.images].every((i) => i.complete));
await wait(400);
await shot('00-list');
const id = await page.evaluate(() => window.__home.mine()[0]?.id);
if (!id) throw new Error('no project to show: make one first');

await page.click('#new-btn');
await page.check('input[name="from"][value="sample-hanabi"]');
await wait(300);
await shot('00-new');
await page.keyboard.press('Escape');

await page.goto(`${base}/edit.html?project=${id}&t=100`);
await page.waitForFunction(() => window.__editor?.preview, null, { timeout: 60000 });
await wait(6000);
await shot('00-editor');

await page.goto(`${base}/play.html?project=${id}`);
await page.waitForFunction(() => !document.getElementById('go').disabled, null, { timeout: 60000 });
await wait(500);
await shot('00-play');

console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
