import { open, scenario, openEditor, inspRow, wait } from './lib.mjs';
const S = scenario(7, '花火を足して警告を見る');
const { browser, page, errors } = await open({ w: 1440, h: 900 });
await openEditor(page, 'fresh&t=150', 'hanabi');
const orig = await page.evaluate(() => JSON.stringify(window.__editor.state.file));
const dangerCount = () => page.evaluate(() => window.__editor.checks().filter((c) => c.level === 'danger').length);
S.rec('7.前提', 'info', `花火版を読み込んだ。キュー ${JSON.parse(orig).cues.length} 個、危ない ${await dangerCount()}`);
// 1 tab 花火
await page.click('.ws-tabs .tab[data-tab="pyro"]'); await wait(800);
const t1 = await page.evaluate(() => {
  const e = window.__editor;
  const lanes = e.lanes().map((l, i) => ({ i, name: l.name, missing: !!l.missing, group: l.group }));
  return { tab: e.view.tab, open: e.view.isOpen('pyro'), tag: document.getElementById('preview-tag')?.textContent, lanes: lanes.filter((l) => /花火|奥の|pyro|台|陸/.test(l.name)) };
});
S.rec('7.1', t1.tab === 'pyro' && t1.open ? 'pass' : 'fail', `タブ「花火」：タブ=${t1.tab}、花火のフォルダ開=${t1.open}、プレビューの札「${t1.tag}」。花火のレーン: ${t1.lanes.map((l) => l.name).join('・')}`, '', [await S.shot(page, '1-tab-pyro')]);
// 2 add a cue with a real double-click in the pyro lane at t=100 (no shells there)
const lane = t1.lanes.find((l) => !l.missing);
const pos = await page.evaluate(({ l, t }) => {
  const e = window.__editor;
  e.timeline.viewT = Math.max(0, t - 20);
  const r = e.timeline.laneRect(l);
  e.timeline.viewT = Math.max(0, t - 20);
  e.timeline.draw();
  const c = e.timeline.canvas.getBoundingClientRect();
  return { x: c.left + e.timeline.tx(t), y: r.y + r.h / 2 };
}, { l: lane.i, t: 100 });
const before = await page.evaluate(() => window.__editor.state.file.cues.length);
await page.mouse.dblclick(pos.x, pos.y); await wait(600);
const added = await page.evaluate(() => {
  const e = window.__editor; const i = e.state.primary; const c = e.state.file.cues[i];
  return { n: e.state.file.cues.length, i, cue: c, danger: e.checks().filter((x) => x.level === 'danger' && x.source === i).length };
});
S.rec('7.2', added.n === before + 1 && added.cue?.fire ? 'pass' : 'fail', `ダブルクリックで花火のキューが1つ増えた（${before}→${added.n}）。ターゲット「${added.cue?.target}」、号数 ${added.cue?.fire?.size}、危ない ${added.danger}（期待 0＝初めは赤い注意なし）`, '', [await S.shot(page, '2-added')]);
const idx = added.i;
const fields = await page.$$eval('#inspector .row label', (ls) => ls.map((l) => l.textContent.trim()).filter(Boolean));
const needF = ['種類', '号数', '数', '間隔', '傾き 左右', '傾き 前後', '角度の型', '広さ'];
S.rec('7.2-欄', needF.every((f) => fields.includes(f)) ? 'pass' : 'fail', `キューの設定の欄: ${fields.join('・')}`);
// 3 preset 奥の台 中央 + size 10
const danger = page.locator('#inspector .note.danger');
await page.selectOption('#inspector select.preset', { label: '奥の台 中央' }); await wait(400);
await inspRow(page, '号数').locator('input').fill('10'); await wait(500);
const d3 = { text: (await danger.first().textContent()).trim(), vis: await danger.first().isVisible(), reach: await page.locator('#inspector .hint', { hasText: 'この筒からは' }).first().textContent() };
S.rec('7.3', d3.vis && d3.text.includes('保安距離が足りません') ? 'pass' : 'fail', `「奥の台 中央」・10 号：赤い注意「${d3.text.slice(0, 120)}…」、「${d3.reach}」`, '', [await S.shot(page, '3-danger-10go')]);
// 7: warnings list
await page.click('#warn-tab'); await wait(500);
const w = await page.evaluate((i) => {
  const rows = [...document.querySelectorAll('.w-row')].filter((r) => r.dataset.i === String(i));
  const sum = document.querySelector('.w-sum')?.textContent;
  const grp = [...document.querySelectorAll('.w-grp')].map((g) => g.textContent);
  const dangerGrp = document.querySelector('.w-grp.danger')?.textContent;
  return { n: rows.length, sum, grp, dangerGrp, text: rows[0]?.textContent };
}, idx);
const shotW = await S.shot(page, '7-warn-list');
if (w.n) {
  await page.evaluate(() => window.__editor.state.setSelection([], -1));
  await page.locator(`.w-row[data-i="${idx}"]`).first().click(); await wait(400);
}
const prim = await page.evaluate(() => window.__editor.state.primary);
S.rec('7.5', w.n > 0 && prim === idx ? 'pass' : 'fail', `「警告」の一覧：${w.sum}。「危ない」に新しい花火の行が ${w.n} 本。行「${(w.text ?? '').slice(0, 80)}」を押すと選ばれるキュー #${prim}（期待 #${idx}）`, '', [shotW]);
const frameInfo = await page.evaluate(() => 'timeline-frame');
await page.click('.side-tabs button[data-pane="cue"]'); await wait(300);
// 4 back to 奥の陸 中央 → gone
await page.selectOption('#inspector select.preset', { label: '奥の陸 中央' }); await wait(500);
const gone = !(await danger.first().isVisible());
S.rec('7.3-消える', gone ? 'pass' : 'fail', `「奥の陸 中央」に戻すと赤い注意が${gone ? '消えた' : '消えない'}。危ない ${await dangerCount()}（花火版の元は 0）`);
await page.selectOption('#inspector select.preset', { label: '奥の台 中央' }); await wait(300);
await inspRow(page, '号数').locator('input').fill('3'); await wait(400);
const small = !(await danger.first().isVisible());
S.rec('7.3-号数を下げる', small ? 'pass' : 'fail', `「奥の台 中央」のまま号数を 3 に下げると赤い注意が${small ? '消えた' : '消えない'}`);
// 5 tilt
await inspRow(page, '号数').locator('input').fill('4'); 
const tilt = async (v) => { await inspRow(page, '傾き 前後').locator('input').fill(String(v)); await wait(450); };
await page.selectOption('#inspector select.preset', { label: '奥の陸 中央' }); await wait(300);
await tilt(20);
const tx1 = (await danger.first().isVisible()) ? (await danger.first().textContent()).trim() : '';
const shotTilt = await S.shot(page, '5-tilt-plus20');
await tilt(-35);
const cautionEl = page.locator('#inspector .note', { hasText: '傾きが大きい' });
const c35 = (await cautionEl.count()) ? (await cautionEl.first().isVisible() ? (await cautionEl.first().textContent()).trim() : '') : '';
const shotSteep = await S.shot(page, '6-tilt-minus35');
await tilt(-50);
const c50 = (await cautionEl.count()) ? (await cautionEl.first().textContent()).trim() : '';
const clamped = await page.evaluate((i) => window.__editor.state.file.cues[i].fire.tilt, idx);
S.rec('7.4', tx1.includes('客席の側へ傾いています') && c35.includes('傾きが大きい') && c50.includes('45°で止めています') ? 'pass' : 'fail', `傾き 前後 +20：赤「${tx1.slice(0, 40)}」／−35（奥へ）：黄「${c35.slice(0, 40)}」／−50：「${c50.slice(-24)}」。入れた値 ${clamped}`, '', [shotTilt, shotSteep]);
// patterns + spread
await tilt(0);
const patOpts = await page.$$eval('#inspector .row', (rs) => { const r = rs.find((x) => x.querySelector('label')?.textContent === '角度の型'); return [...r.querySelectorAll('option')].map((o) => o.textContent); });
const pshots = [];
const patRow = inspRow(page, '角度の型').locator('select');
for (const label of patOpts.filter((o) => o && /扇|V|X|順/.test(o)).slice(0, 4)) {
  await patRow.selectOption({ label }); await wait(500);
  await inspRow(page, '広さ').locator('input').fill(label.includes('V') ? '60' : '40'); await wait(300);
}
S.rec('7.2-型', patOpts.length >= 4 ? 'pass' : 'fail', `角度の型の選び肢: ${patOpts.join('・')}。順に替えて「広さ」も入れた（エラーなし: ${!errors.length}）`, '3D とキューの絵が変わるかは目で確かめる', [await S.shot(page, '7-pattern')]);
// 8 undo back to the original
await page.evaluate(() => document.activeElement?.blur?.());
await page.mouse.click(700, 400).catch(() => {});
let guard = 0;
while (guard++ < 60 && (await page.evaluate(() => window.__editor.state.canUndo))) { await page.keyboard.press('Control+z'); await wait(60); if (await page.evaluate((o) => JSON.stringify(window.__editor.state.file) === o, orig)) break; }
const back = await page.evaluate((o) => JSON.stringify(window.__editor.state.file) === o, orig);
S.rec('7.7', back && (await dangerCount()) === 0 ? 'pass' : 'fail', `⌘Z（Ctrl+Z）を ${guard - 1} 回押して、元の花火版に戻った: ${back}。危ない ${await dangerCount()}`, '', [await S.shot(page, '8-undone')]);
S.rec('7.6', 'user', '赤・黄の出方（言葉・色・場所）が分かりやすいか。画面は 3-danger-10go（赤）と 6-tilt-minus35（黄）、一覧は 7-warn-list', '', ['shots/test-run/7/3-danger-10go.jpg', 'shots/test-run/7/6-tilt-minus35.jpg', 'shots/test-run/7/7-warn-list.jpg']);
S.rec('7.コンソール', errors.length ? 'fail' : 'pass', errors.length ? errors.slice(0, 3).join(' | ') : 'コンソールのエラー 0');
S.save();
await browser.close();
