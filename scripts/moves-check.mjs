/**
 * 動きの型 (src/editor/moves.ts): the editor's buttons for the moves. Checked
 * in a fresh editor (Rhapsody in Blue, the lake): every button adds its move
 * on the beat nearest the playhead, on fixtures it suits (whips for the head
 * moves, flowers for the bloom, the grid for the rest), selected; a move on a
 * selected cue's fixtures; water brought on with a sway where it is dark;
 * ⌘Z takes it back; on the 8-jet desk the head moves and the bloom are off,
 * with the reason. A still of the panel goes to shots/moves/.
 *
 *   node scripts/moves-check.mjs    (needs the dev server on :5199)
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:5199';
mkdirSync('shots/moves', { recursive: true });
let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) failed++;
};

const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--mute-audio'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => void d.dismiss());
await page.goto(`${BASE}/edit.html?fresh`);
await page.waitForFunction(() => window.__editorReady === true, null, { timeout: 90000 });
await page.waitForFunction(() => window.__editor.transport.music !== 'loading', null, { timeout: 90000 }).catch(() => {});

const state = () =>
  page.evaluate(() => {
    const { state } = window.__editor;
    const f = state.file;
    return { n: f.cues.length, sel: state.selected(), primary: state.primary, cues: state.selected().map((i) => f.cues[i]) };
  });
const at = (c, f) => {
  if (typeof c.t === 'number') return c.t;
  const [bar, beat] = String(c.t).split(':').map(Number);
  return f.offset + ((bar - 1) * f.beatsPerBar + (beat - 1)) * (60 / f.bpm);
};
const timing = await page.evaluate(() => {
  const f = window.__editor.state.file;
  return { bpm: f.bpm, beatsPerBar: f.beatsPerBar, offset: f.offset };
});

// nothing selected, the playhead at 30.2 s
await page.evaluate(() => {
  window.__editor.state.setSelection([], -1);
  window.__editor.transport.seek(30.2);
});
await page.waitForTimeout(200);
const buttons = await page.locator('#inspector .moves button').evaluateAll((bs) => bs.map((b) => ({ id: b.dataset.move, text: b.textContent, disabled: b.disabled, title: b.title })));
ok(buttons.length >= 10 && buttons.every((b) => !b.disabled), `ボタン ${buttons.length} 個、湖では全部押せる（${buttons.map((b) => b.text).join('・')}）`);
await page.locator('#inspector').screenshot({ path: 'shots/moves/panel-show.png' });

const want = { fan: 'whip', cross: 'whip', sway: 'whip', ripple: 'whip', bloom: 'flower', chase: 'grid', wave: 'grid', burst: 'grid', hit: 'grid', follow: 'grid', rainbow: 'grid' };
for (const b of buttons) {
  const before = await state();
  await page.evaluate(() => window.__editor.state.setSelection([], -1));
  await page.locator(`#inspector .moves button[data-move="${b.id}"]`).click();
  await page.waitForTimeout(120);
  const s = await state();
  const cue = s.cues[s.cues.length - 1];
  const t = at(cue, timing);
  const beat = (t - timing.offset) / (60 / timing.bpm);
  const onBeat = Math.abs(beat - Math.round(beat)) < 1e-3 && Math.abs(t - 30.2) <= 60 / timing.bpm;
  ok(s.n > before.n && cue.label === b.text && cue.target === want[b.id] && onBeat, `「${b.text}」→ ${cue.target}・${cue.macro}・${t.toFixed(2)} 秒${s.n - before.n > 1 ? `（水も ${s.n - before.n - 1}）` : ''}`);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(80);
  ok((await state()).n === before.n, `  ⌘Z で戻る`);
}

// where the whips are dark (2 s, the seed only), a sway brings the water on with it
await page.evaluate(() => {
  window.__editor.state.setSelection([], -1);
  window.__editor.transport.seek(2);
});
await page.waitForTimeout(150);
{
  const before = (await state()).n;
  await page.locator('#inspector .moves button[data-move="sway"]').click();
  await page.waitForTimeout(150);
  const w = await state();
  const water = w.cues.find((c) => c.set?.pressure && !c.macro);
  ok(w.n === before + 2 && water && water.target === 'whip', `暗い所の「左右に揺れる」は水も出す（${w.n - before} キュー、選択 ${w.sel.length}）`);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(100);
  ok((await state()).n === before, '  ⌘Z 1回で2つとも戻る');
}

// on a selected cue's fixtures: a fan cue of the lake (a head move goes there)
const fanCue = await page.evaluate(() => {
  const { state } = window.__editor;
  const i = state.file.cues.findIndex((c) => c.target.startsWith('fan') && !c.fire);
  state.setSelection([i], i);
  return state.file.cues[i].target;
});
await page.waitForTimeout(150);
await page.locator('#inspector .moves button[data-move="cross"]').click();
await page.waitForTimeout(120);
let s = await state();
ok(s.cues[s.cues.length - 1].target === fanCue, `選んだキューの台に足す（${fanCue}）`);
await page.locator('#inspector').screenshot({ path: 'shots/moves/panel-cue.png' });
await page.keyboard.press('ControlOrMeta+z');

// on the desk: the head moves and the bloom cannot go, and say why
await page.evaluate(() => window.__editor.state.setSelection([], -1));
await page.click('#venue-btn');
await page.locator('#venue-pop button', { hasText: '机の試作（8台）' }).click();
await page.waitForTimeout(400);
const desk = await page.locator('#inspector .moves button').evaluateAll((bs) => bs.map((b) => ({ id: b.dataset.move, disabled: b.disabled, title: b.title })));
const off = desk.filter((b) => b.disabled).map((b) => b.id).sort();
ok(off.join() === ['bloom', 'cross', 'fan', 'ripple', 'sway'].join(), `机では首振りと花が押せない（${off.join('・')}）`);
ok(desk.find((b) => b.id === 'fan').title.includes('首の動く機材'), `理由が出る：${desk.find((b) => b.id === 'fan').title}`);
await page.locator('#inspector .moves button[data-move="chase"]').click();
await page.waitForTimeout(120);
s = await state();
ok(s.cues[s.cues.length - 1].target === 'grid', `机でも「端から走る」は足せる（${s.cues[s.cues.length - 1].target}）`);

ok(errors.length === 0, `ページのエラーなし${errors.length ? '：' + errors.slice(0, 2).join(' / ') : ''}`);
await browser.close();
console.log(failed ? `\n${failed} failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
