import { open, scenario, openPlayer, wait, BASE } from './lib.mjs';
const S = scenario(3, '水面の新しい画質');
const { browser, page, errors } = await open({ w: 1024, h: 576 });
const gfx = () => page.evaluate(() => JSON.stringify(window.__rt.drawnGraphics));
async function frame(qs, name) {
  await page.goto(`${BASE}/play.html?${qs}&shot=1`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  return { file: await S.shot(page, name), gfx: await gfx() };
}
const ALL = '{"impact":true,"surface":true,"mist":true}', NONE = '{"impact":false,"surface":false,"mist":false}';
const a = await frame('show=hanabi&t=100&cam=low', 'hanabi100-low-on');
const b = await frame('show=hanabi&t=100&cam=eye', 'hanabi100-eye-on');
const c = await frame('show=fantasia&t=20&cam=screen', 'fantasia20-screen-on');
S.rec('3.1', a.gfx === ALL && b.gfx === ALL && c.gfx === ALL ? 'pass' : 'fail', `\`?gfx\` を付けない：描く設定 ${a.gfx}（3版・3席とも 全部入）`);
S.rec('3.2', 'user', '花火版 100 秒・席「水面」の波紋・しぶき・泡。強すぎず弱すぎずか、水の柱が落ちる所の泡が自然か', '', [a.file]);
S.rec('3.3', 'user', '花火版 100 秒・席「目線」の映り込み（光の粒）が水面らしいか、ざらざらしすぎないか', '', [b.file]);
S.rec('3.4', 'user', 'ファンタジア版 20 秒・席「スクリーン前」の水幕の細かい霧が、絵を読みにくくしていないか', '', [c.file]);
const a0 = await frame('show=hanabi&t=100&cam=low&gfx=off', 'hanabi100-low-off');
const b0 = await frame('show=hanabi&t=100&cam=eye&gfx=off', 'hanabi100-eye-off');
const c0 = await frame('show=fantasia&t=20&cam=screen&gfx=off', 'fantasia20-screen-off');
S.rec('3.5', a0.gfx === NONE && b0.gfx === NONE && c0.gfx === NONE ? 'pass' : 'fail', `\`?gfx=off\`：描く設定 ${a0.gfx}。全部入りと並べた画面を3組撮った（違いが分かるかはあなたが見て決める）`, '', [a0.file, b0.file, c0.file]);
const low = await frame('show=hanabi&t=100&cam=low&quality=low', 'hanabi100-low-qualitylow');
S.rec('3.6-URL', low.gfx === NONE ? 'pass' : 'fail', `\`?quality=low\`（\`?gfx\` は何も付けず）：描く設定 ${low.gfx}`, '', [low.file]);
// via the bar: 表示▾ → 画質
await openPlayer(page, 'show=hanabi&t=100');
await page.click('#go'); await wait(500);
await page.evaluate(() => window.__clock.pause());
const states = {};
for (const [lab, v] of [['低', 'low'], ['高', 'high'], ['中', 'medium'], ['自動', 'auto']]) {
  if (await page.evaluate(() => document.getElementById('view').hidden)) await page.click('#view-open');
  await page.click(`#quality button[data-v="${v}"]`);
  await wait(900);
  states[v] = JSON.parse(await gfx());
  states[v].now = await page.textContent('#view-now');
}
const lowOff = !states.low.impact && !states.low.surface && !states.low.mist;
const highOn = states.high.impact && states.high.surface && states.high.mist;
S.rec('3.6', lowOff && highOn && states.medium.impact ? 'pass' : 'fail', `画質ボタン：低→全部切(${JSON.stringify(states.low)}) 高→全部入(${highOn}) 中→${JSON.stringify(states.medium)}。「表示」の表示: ${states.low.now} / ${states.high.now}`);
S.rec('3.6-shot', 'info', '画質「低」にした画面（最後に自動へ戻した）', '', [await S.shot(page, 'bar-quality')]);
// 3.7 performance, 1280x720, hanabi 205.99
const perf = {};
await page.setViewportSize({ width: 1280, height: 720 });
for (const [k, qs] of [['入（高）', 'quality=high'], ['切（高・gfx=off）', 'quality=high&gfx=off'], ['入（中）', 'quality=medium'], ['低', 'quality=low']]) {
  await page.goto(`${BASE}/play.html?show=hanabi&t=205.99&shot=1&perf=1&${qs}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  perf[k] = await page.evaluate(() => window.__perf);
}
S.rec('3.7', 'info', `花火版 205.99、1280×720、このマシンのヘッドレス描画での 1 コマの時間：` + Object.entries(perf).map(([k, v]) => `${k} ${v.toFixed(1)} ms`).join('／') + '（記録の値：高 切 10.6 → 入 14.6〜16.9、中 8.5 → 10.9、低 7.3）。カクつきの体感はあなたが見て決める');
// 3.8 editor
const ed = await page.goto(`${BASE}/edit.html?fresh&t=100`);
await page.waitForFunction(() => window.__editorReady === true, null, { timeout: 90000 });
const edInfo = await page.evaluate(async () => {
  const e = window.__editor;
  const rt = e.preview?.rt ?? e.preview?.runtime ?? null;
  const out = { hasRt: !!rt };
  const sel = document.getElementById('quality-sel');
  const get = () => (rt ? JSON.stringify(rt.drawnGraphics) : 'n/a');
  out.initial = [sel.value, get()];
  for (const v of ['high', 'low', 'medium']) { sel.value = v; sel.dispatchEvent(new Event('change')); await new Promise((r) => setTimeout(r, 700)); out[v] = get(); }
  return out;
});
S.rec('3.8', edInfo.hasRt && edInfo.high === ALL && edInfo.low === NONE ? 'pass' : (edInfo.hasRt ? 'fail' : 'skip'), edInfo.hasRt ? `エディタの画質：初期 ${edInfo.initial.join(' / ')}・高 ${edInfo.high}・低 ${edInfo.low}・中 ${edInfo.medium}` : 'エディタのプレビューの runtime に触れず、確かめられなかった', '', [await S.shot(page, 'editor-quality')]);
S.rec('3.9', 'user', '前の見た目に戻す道が `?gfx=off` だけでよいか（画面の切り替えは作らないと決めた）。気になるかはあなたが決める');
S.rec('3.コンソール', errors.length ? 'fail' : 'pass', errors.length ? errors.slice(0, 3).join(' | ') : 'コンソールのエラー 0');
S.save({ perf });
await browser.close();
