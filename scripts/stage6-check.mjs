/**
 * Stage-6 editor checks (docs/detailed-design.md 7). Needs the dev server on :5199.
 *
 *   node scripts/stage6-check.mjs [--shots=shots/stage6/check]
 *
 * Folding, tabs and S/M never change the show file; S/M change only the 3D;
 * the exports stay whole; the 警告 list counts match the three versions;
 * a row and a click in the 3D select the cue.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const launch = { headless: true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const failures = [];
const ok = (c, msg) => {
  console.log(`${c ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!c) failures.push(msg);
};

await page.goto('http://localhost:5199/edit.html?fresh&t=175');
await page.evaluate(() => localStorage.removeItem('water-show-editor-view:v1'));
await page.reload();
await page.waitForFunction(() => window.__editorReady === true, null, { timeout: 60000 });
await page.waitForFunction(() => window.__editor.transport.music !== 'loading', null, { timeout: 90000 }).catch(() => {});

// counts per version (before any music-following: built without music)
const counts = await page.evaluate(async () => {
  const { buildShow } = await import('/src/show/choreography.ts');
  const ed = window.__editor;
  const out = {};
  for (const v of ['lagoon', 'fantasia', 'hanabi']) {
    ed.state.load(buildShow(undefined, v));
    await new Promise((r) => setTimeout(r, 400));
    const c = ed.checks();
    out[v] = Object.fromEntries(['head', 'water', 'led', 'pyro', 'missing'].map((k) => [k, c.filter((x) => x.kind === k).length]));
  }
  return out;
});
console.log(JSON.stringify(counts));
// お知らせ (LED fades slowed): 2026-11-08 the screens' brightness moved to the projector, which is not an LED (115 -> 113, 174 -> 171)
ok(counts.lagoon.head === 6 && counts.lagoon.water === 6 && counts.lagoon.led === 113 && counts.lagoon.pyro === 0, 'Night Lagoon: 首振り 6・水 6・お知らせ 113・花火 0');
ok(counts.fantasia.head === 6 && counts.fantasia.water === 60 && counts.fantasia.led === 171, 'ファンタジア版: 首振り 6・水 60・お知らせ 171');
ok(counts.hanabi.head === 6 && counts.hanabi.water === 6 && counts.hanabi.pyro === 0, '花火版: 首振り 6・水 6・花火 0');

// folding, tabs, S/M: the file does not change; S/M only the 3D
const r = await page.evaluate(async () => {
  const ed = window.__editor;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const before = JSON.stringify(ed.state.file);
  const undo = ed.state.canUndo;
  const out = {};
  for (const id of ['all', 'water', 'light', 'screen', 'pyro']) document.querySelector(`.ws-tabs .tab[data-tab="${id}"]`)?.click();
  ed.view.setOpen('water', true);
  ed.view.setOpen('water', false);
  ed.view.toggleSolo('pyro');
  await wait(300);
  out.solo = ed.preview.rt.file.cues.length;
  out.soloAll = ed.preview.rt.file.cues.every((c) => c.target.startsWith('pyro'));
  const exp = (await import('/src/show/cues.ts')).compileShow(ed.state.file, ed.preview.rt.layout);
  out.full = exp.plain.length;
  ed.view.toggleSolo('pyro');
  ed.view.toggleMute('water');
  await wait(300);
  out.mute = ed.preview.rt.file.cues.length;
  ed.view.toggleMute('water');
  await wait(300);
  out.back = ed.preview.rt.file === ed.state.file;
  out.same = JSON.stringify(ed.state.file) === before && ed.state.canUndo === undo;
  out.saved = localStorage.getItem('water-show-editor:v1') === JSON.stringify(ed.state.file);
  out.view = !!localStorage.getItem('water-show-editor-view:v1');
  return out;
});
ok(r.solo > 0 && r.soloAll, `S（花火）: 3D は花火のキュー ${r.solo} 個だけ`);
ok(r.mute > 0 && r.mute < 447, `M（水）: 3D は水を除いた ${r.mute} 個`);
ok(r.back, 'S/M を戻すと 3D は演出そのもの');
ok(r.same, 'タブ・たたむ・S/M で演出ファイルも ⌘Z の履歴も変わらない');
ok(r.saved, '自動保存は演出そのもの（S/M は入らない）');
ok(r.view, '見方はエディタの保存（water-show-editor-view:v1）に入る');

// a 警告 row and a click in the 3D select their cue
const s = await page.evaluate(async () => {
  const ed = window.__editor;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  document.querySelector('.side-tabs button[data-pane="warn"]').click();
  const row = document.querySelector('.w-row');
  row.click();
  await wait(200);
  const i = Number(row.dataset.i);
  const out = { row: ed.state.primary === i && row.classList.contains('cur'), shown: !!ed.timeline.blockRect(i) };
  document.querySelector('.ws-tabs .tab[data-tab="all"]').click();
  await wait(200);
  ed.preview.resetCamera();
  ed.transport.seek(175.3);
  await wait(300);
  const cam = ed.preview.rt.stage.camera;
  const cv = ed.preview.rt.stage.renderer.domElement;
  const rect = cv.getBoundingClientRect();
  const fx = ed.preview.rt.layout.fixtures.find((f) => f.group === 'grid' && Math.abs(f.position[0]) < 3);
  const v = cam.position.clone().set(fx.position[0], fx.position[1] + 3, fx.position[2]).project(cam);
  const o = { clientX: rect.left + ((v.x + 1) / 2) * rect.width, clientY: rect.top + ((1 - v.y) / 2) * rect.height, button: 0, bubbles: true, pointerId: 1 };
  cv.dispatchEvent(new PointerEvent('pointerdown', o));
  cv.dispatchEvent(new PointerEvent('pointerup', o));
  await wait(300);
  out.pick = ed.state.primary;
  out.pickT = ed.state.file.cues[ed.state.primary]?.t;
  out.tag = document.getElementById('pick-tag').textContent;
  out.open = ed.view.isOpen('water');
  const sel = ed.preview.outline.sel;
  out.outline = { active: sel.active.length, others: sel.others.length };
  // a lane's name: its fixtures, no cue
  const r = ed.timeline.laneRect(0);
  const c = ed.timeline.canvas;
  const o2 = { clientX: r.x - 60, clientY: r.y + 10, button: 0, bubbles: true, pointerId: 2 };
  c.dispatchEvent(new PointerEvent('pointerdown', o2));
  c.dispatchEvent(new PointerEvent('pointerup', o2));
  await wait(100);
  out.lane = { active: ed.preview.outline.sel.active.length, none: ed.state.selection.size === 0 };
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await wait(100);
  out.cleared = !ed.preview.outline.active;
  return out;
});
ok(s.row && s.shown, '警告の行を押すとそのキューを選び、時間軸で見える');
ok(s.outline.active === 1 && s.outline.others > 0, `3D の縁取り：クリックした1台が明るく、同じキューのほか ${s.outline.others} 台が暗く`);
ok(s.lane.active > 0 && s.lane.none, `行の名前を押すとその行の台（${s.lane.active} 台）を縁取り、キューは選ばない`);
ok(s.cleared, 'Esc で縁取りが消える');
ok(s.pick >= 0 && s.open, `3D でグリッドをクリック → キュー #${s.pick}（t=${s.pickT}）・水のフォルダが開く「${s.tag}」`);

if (args.shots) {
  mkdirSync(args.shots, { recursive: true });
  await page.screenshot({ path: `${args.shots}/after-pick.png` });
}
ok(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
