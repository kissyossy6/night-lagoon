/**
 * Smoke test for the timeline editor (edit.html). Needs the dev server on :5199.
 *
 *   node scripts/editor-check.mjs [--out=shots/editor] [--headed]
 *
 * Opens the editor fresh, screenshots it, drags a cue block, edits a value in
 * the inspector, adds / deletes / undoes a cue, screenshots again and fails on
 * console errors or broken expectations.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : true];
  }),
);
const out = args.out ?? 'shots/editor';
mkdirSync(out, { recursive: true });

const launch = { headless: !args.headed, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
// Playwright's own Chromium can be missing after an upgrade; fall back to the installed Chrome
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

const failures = [];
const expect = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

await page.goto('http://localhost:5199/edit.html?fresh&t=50');
await page.waitForFunction(() => window.__editorReady === true, null, { timeout: 60000 });
// let the score render (or fail) so the waveform shows
await page.waitForFunction(() => window.__editor.transport.music !== 'loading', null, { timeout: 90000 }).catch(() => {});
const music = await page.evaluate(() => window.__editor.transport.music);
console.log(`music: ${music}`);
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/editor.png` });

// ------------------------------------------------------------ drag a block
// the first plain 'fan' cue (bar 3, colour set) — move it one bar to the right
const target = await page.evaluate(() => {
  const { state, timeline } = window.__editor;
  const i = state.file.cues.findIndex((c) => c.target === 'fan' && !c.macro && c.set?.pressure !== undefined);
  timeline.viewT = 0;
  timeline.pps = 40;
  timeline.relayout();
  timeline.reveal(i);
  timeline.draw();
  return { i, t: state.file.cues[i].t, rect: timeline.blockRect(i), pxBar: 2 * timeline.pps };
});
expect(target.i >= 0 && target.rect, `found fan cue #${target.i} at t=${target.t}`);
{
  const { rect, pxBar } = target;
  const x = rect.x + Math.min(rect.w / 2, 30);
  const y = rect.y + rect.h / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(x + (pxBar * k) / 10 + 3, y);
  await page.mouse.up();
}
const moved = await page.evaluate((i) => window.__editor.state.file.cues[i].t, target.i);
expect(typeof moved === 'string' && moved !== target.t, `drag moved cue: ${target.t} -> ${moved}`);
const sel = await page.evaluate(() => window.__editor.state.primary);
expect(sel === target.i, 'dragged cue is selected');

// ----------------------------------------------------- edit in inspector
const pIn = page.locator('#inspector input[data-param="pressure"]');
await pIn.fill('0.33');
await page.waitForTimeout(250);
const p = await page.evaluate((i) => window.__editor.state.file.cues[i].set?.pressure, target.i);
expect(p === 0.33, `inspector set pressure = ${p}`);
const applied = await page.evaluate((i) => window.__editor.preview.rt.show.file.cues[i].set?.pressure, target.i);
expect(applied === 0.33, 'preview runtime received the edit');

// colour via the hex field
const hexIn = page.locator('#inspector .prow input.num[placeholder="#rrggbb"]');
await hexIn.fill('#ff2fb0');
await page.waitForTimeout(150);
const col = await page.evaluate((i) => window.__editor.state.file.cues[i].set?.color, target.i);
expect(col === '#ff2fb0', `inspector set colour = ${col}`);

// --------------------------------------------- add via double-click, delete, undo
const before = await page.evaluate(() => window.__editor.state.file.cues.length);
const spot = await page.evaluate(() => {
  const { timeline } = window.__editor;
  timeline.viewT = 18;
  const lane = timeline.laneRect(6); // screen lane: empty around t = 26 s
  return { x: timeline.canvas.getBoundingClientRect().left + timeline.tx(26), y: lane.y + 12 };
});
await page.mouse.dblclick(spot.x, spot.y);
await page.waitForTimeout(100);
const afterAdd = await page.evaluate(() => window.__editor.state.file.cues.length);
expect(afterAdd === before + 1, `double-click added a cue (${before} -> ${afterAdd})`);
const added = await page.evaluate(() => {
  const s = window.__editor.state;
  return s.file.cues[s.primary];
});
console.log('      added:', JSON.stringify(added));
await page.keyboard.press('Delete');
await page.waitForTimeout(100);
const afterDel = await page.evaluate(() => window.__editor.state.file.cues.length);
expect(afterDel === before, 'Delete removed it');
await page.keyboard.press('ControlOrMeta+z');
await page.waitForTimeout(100);
const afterUndo = await page.evaluate(() => window.__editor.state.file.cues.length);
expect(afterUndo === before + 1, 'undo restored it');
await page.keyboard.press('ControlOrMeta+Shift+z');
await page.waitForTimeout(100);
expect((await page.evaluate(() => window.__editor.state.file.cues.length)) === before, 'redo removed it again');

// ---------------------------------------------------- play for a moment
await page.evaluate(() => {
  const { state, timeline } = window.__editor;
  const i = state.file.cues.findIndex((c) => c.target === 'fan' && !c.macro && c.set?.pressure !== undefined);
  state.setSelection([i], i);
  timeline.reveal(i);
});
await page.keyboard.press('Space');
await page.waitForTimeout(1200);
await page.keyboard.press('Space');
const playT = await page.evaluate(() => window.__editor.transport.now());
expect(playT > 50.5, `playback advanced the playhead (t=${playT.toFixed(2)})`);
await page.evaluate(() => window.__editor.transport.seek(6.5));
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/editor-edited.png` });

// ------------------------------------- macro cue + shift multi-select + arg edit
const macroIdx = await page.evaluate(() => {
  const { state, timeline } = window.__editor;
  // with music the built-in show follows the waveform ('follow'), without it the floor waves
  const a = state.file.cues.findIndex((c) => (c.macro === 'follow' || c.macro === 'wave') && c.target === 'grid[0-87]' && Number(c.t) >= 14 && Number(c.t) < 30);
  // a second macro block in the same view: the whips' sway (no chasers before the first tutti)
  const b = state.file.cues.findIndex((c) => c.macro && c.target.startsWith('whip') && Number(c.t) >= 14 && Number(c.t) < 30);
  state.setSelection([], -1);
  timeline.viewT = 14;
  timeline.scrollY = 0; // the screen-lane step scrolled the lanes down
  timeline.draw();
  return { a, b, ra: timeline.blockRect(a), rb: timeline.blockRect(b) };
});
await page.mouse.click(macroIdx.ra.x + 40, macroIdx.ra.y + macroIdx.ra.h / 2);
await page.keyboard.down('Shift');
await page.mouse.click(macroIdx.rb.x + 10, macroIdx.rb.y + macroIdx.rb.h / 2);
await page.keyboard.up('Shift');
const multi = await page.evaluate(() => [...window.__editor.state.selection].sort((x, y) => x - y));
expect(multi.length === 2 && multi.includes(macroIdx.a) && multi.includes(macroIdx.b), `shift-click multi-select ${JSON.stringify(multi)}`);
// click the wave again to make it primary, then edit its amplitude arg
await page.keyboard.down('Shift');
await page.mouse.click(macroIdx.rb.x + 10, macroIdx.rb.y + macroIdx.rb.h / 2);
await page.keyboard.up('Shift');
const prim = await page.evaluate(() => window.__editor.state.primary);
expect(prim === macroIdx.a, 'shift-click toggled the second cue off');
// edit one of its arguments: 'max' of a follow (default 0.8), 'amp' of a wave (default 0.3)
const kind = await page.evaluate((i) => window.__editor.state.file.cues[i].macro, macroIdx.a);
const [argKey, def] = kind === 'follow' ? ['max', '0.8'] : ['amp', '0.3'];
await page.locator(`#inspector input[placeholder="既定 ${def}"]`).first().fill('0.4');
await page.waitForTimeout(200);
const argVal = await page.evaluate(([i, k]) => window.__editor.state.file.cues[i].args?.[k], [macroIdx.a, argKey]);
expect(argVal === 0.4, `macro arg ${argKey} = ${argVal}`);
await page.evaluate(() => window.__editor.transport.seek(20));
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/editor-macro.png` });

// autosave
const saved = await page.evaluate(() => {
  try {
    return JSON.parse(localStorage.getItem('water-show-editor:v1')).cues.length;
  } catch {
    return -1;
  }
});
expect(saved === before, `autosaved (${saved} cues)`);

expect(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ').slice(0, 1500) : ''}`);
await browser.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
