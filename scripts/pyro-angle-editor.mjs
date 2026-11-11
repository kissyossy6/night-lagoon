/**
 * The editor's lean controls (傾き 左右・前後, 角度の型, 広さ): picks a pattern
 * and a front-back lean through the inspector, checks the cue and the
 * warnings follow, and screenshots the red (toward the audience) and yellow
 * (too steep) notes.  node scripts/pyro-angle-editor.mjs [--out=shots/stage3/angles/editor]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=shots/stage3/angles/editor').slice(6);
mkdirSync(out, { recursive: true });
const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5199/edit.html?fresh&t=8');
await page.waitForFunction(() => window.__editorReady === true, null, { timeout: 60000 });

const failures = [];
const check = (ok, what) => (ok ? console.log(`ok    ${what}`) : (failures.push(what), console.log(`FAIL  ${what}`)));

const base = { shell: 'kiku', size: 4, colors: ['#ffb050'] };
const file = {
  title: '角度の確かめ',
  bpm: 120,
  beatsPerBar: 4,
  offset: 0,
  duration: 60,
  cues: [
    { t: 10, target: '@奥の台', fire: { ...base }, label: '扇にする' },
    { t: 20, target: '@奥の台 中央', fire: { ...base, angle: 40 }, label: '傾きが大きい' },
  ],
};
// the editor may still swap in its own show once the music is in: load until ours stays
await page.waitForTimeout(1500);
await page.evaluate((file) => {
  const { state, timeline } = window.__editor;
  state.load(file);
  timeline.viewT = 0;
  timeline.pps = 30;
  timeline.relayout();
  timeline.draw();
}, file);
const select = (label) =>
  page.evaluate((label) => {
    const { state, timeline } = window.__editor;
    if (!state.file.cues.some((c) => c.label === label)) throw new Error(`not loaded: ${state.file.title}`);
    const i = state.file.cues.findIndex((c) => c.label === label);
    state.setSelection([i], i);
    timeline.reveal(i);
    timeline.draw();
  }, label);
const row = (label) => page.locator('.row', { has: page.locator(`text="${label}"`) });
const notes = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.note')].filter((n) => n.style.display !== 'none' && n.textContent).map((n) => n.textContent),
  );

await select('扇にする');
await row('角度の型').locator('select').selectOption('fan');
await row('広さ').locator('input').fill('30');
await row('広さ').locator('input').press('Enter');
await row('傾き 前後').locator('input').fill('10');
await row('傾き 前後').locator('input').press('Enter');
await page.waitForTimeout(300);
const cue = await page.evaluate(() => window.__editor.state.file.cues.find((c) => c.label === '扇にする')?.fire ?? {});
check(cue.pattern === 'fan' && cue.spread === 30 && cue.tilt === 10, `inspector set pattern/spread/tilt ${JSON.stringify(cue)}`);
let n = await notes();
check(n.some((t) => t.includes('客席の側へ傾いています')), 'red note: toward the audience');
check(n.some((t) => t.includes('開く位置が客席に近すぎます')), 'red note: burst too near (4号 at 155 m, leaned 10° toward)');
await page.screenshot({ path: `${out}/editor-toward.png` });

await row('傾き 前後').locator('input').fill('-15');
await row('傾き 前後').locator('input').press('Enter');
await page.waitForTimeout(300);
n = await notes();
check(!n.some((t) => t.includes('⚠')), 'leaning away: no red note');
await page.screenshot({ path: `${out}/editor-away.png` });

await select('傾きが大きい');
await page.waitForTimeout(300);
n = await notes();
check(n.some((t) => t.startsWith('△ 傾きが大きい')), 'yellow note: steeper than 30°');
await page.screenshot({ path: `${out}/editor-steep.png` });

check(!errors.length, errors.length ? `console errors: ${errors.join('\n')}` : 'no console errors');
await browser.close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
