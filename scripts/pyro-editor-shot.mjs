/**
 * The editor with the 花火版 loaded: the fireworks lane, a selected shell,
 * and the red safety warning.  node scripts/pyro-editor-shot.mjs [--out=shots/stage2/editor]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=shots/stage2/editor').slice(6);
mkdirSync(out, { recursive: true });
const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5199/edit.html?fresh&t=23');
await page.waitForFunction(() => window.__editorReady === true, null, { timeout: 60000 });
const pick = async (label, file) => {
  const r = await page.evaluate(async (label) => {
    const { buildPyroTest: buildHanabi } = await import('/src/show/pyrotest.ts');
    const { state, timeline } = window.__editor;
    if (state.file.title !== buildHanabi().title) state.load(buildHanabi());
    const i = state.file.cues.findIndex((c) => c.label === label);
    state.setSelection([i], i);
    timeline.viewT = 0;
    timeline.pps = 9;
    timeline.relayout();
    timeline.reveal(i);
    timeline.draw();
    return { i, warn: document.querySelector('.note.danger')?.textContent, shown: document.querySelector('.note.danger')?.style.display };
  }, label);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${file}.png` });
  return r;
};
console.log(JSON.stringify(await pick('10号 菊', 'editor-10go')));
console.log(JSON.stringify(await pick('保安距離の確認 (近すぎる)', 'editor-warning')));
console.log(errors.length ? `errors: ${errors.join('\n')}` : 'no console errors');
await browser.close();
