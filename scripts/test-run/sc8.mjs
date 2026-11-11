import { open, scenario, openEditor, wait, BASE } from './lib.mjs';
const S = scenario(8, 'エディタで探す');
const { browser, ctx, page, errors } = await open({ w: 1440, h: 900 });
await openEditor(page, 'fresh&t=175', 'lagoon');
const title = await page.evaluate(() => document.title + ' | ' + (document.querySelector('.brand')?.textContent ?? '') + ' | ' + (document.getElementById('music-status')?.textContent ?? ''));
const counts = await page.evaluate(() => {
  const c = window.__editor.checks();
  const k = (x) => c.filter((y) => y.kind === x).length;
  return { total: window.__editor.state.file.cues.length, danger: c.filter((y) => y.level === 'danger').length, head: k('head'), water: k('water'), led: k('led'), missing: k('missing') };
});
// 8.1 tabs
const tabs = await page.$$eval('.ws-tabs .tab', (bs) => bs.map((b) => [b.dataset.tab, b.textContent.trim()]));
const per = [];
for (const [id] of tabs) {
  await page.click(`.ws-tabs .tab[data-tab="${id}"]`); await wait(600);
  per.push(await page.evaluate((i) => {
    const e = window.__editor; const cam = e.preview.getCamera();
    return { id: i, tab: e.view.tab, open: ['water', 'screen', 'pyro'].map((f) => f + ':' + e.view.isOpen(f)).join(','), cam: JSON.stringify(cam).slice(0, 70) };
  }, id));
}
const distinct = new Set(per.map((p) => p.open + '|' + p.cam)).size;
S.rec('8.1', tabs.length === 5 && per.every((p, i) => p.tab === tabs[i][0]) && distinct >= 3 ? 'pass' : 'fail', `タブ: ${tabs.map((t) => t[1]).join('・')}。押すたびの「開くフォルダ｜視点」: ` + per.map((p) => `${p.id}[${p.open}]`).join(' '), `見方が違う組は ${distinct} 通り`, [await S.shot(page, '1-tabs')]);
// 8.2 S / M by real mouse
await page.click('.ws-tabs .tab[data-tab="water"]'); await wait(600);
const box = await page.evaluate(() => {
  const t = window.__editor.timeline; const c = t.canvas.getBoundingClientRect();
  const fb = t.folders.find((f) => f.folder === 'water');
  const headW = t.tx(t.viewT);
  const by = t.laneTop + fb.y - t.scrollY + (fb.open ? 4 : 5);
  return { sx: c.left + headW - 44 + 8, mx: c.left + headW - 24 + 8, y: c.top + by + 8, open: fb.open, hx: c.left + 60, hy: c.top + t.laneTop + fb.y - t.scrollY + 12 };
});
const full = await page.evaluate(() => window.__editor.preview.rt.file.cues.length);
await page.mouse.click(box.sx, box.y); await wait(500);
const solo = await page.evaluate(() => ({ s: window.__editor.view.solo(), n: window.__editor.preview.rt.file.cues.length, same: JSON.stringify(window.__editor.state.file).length }));
const shotS = await S.shot(page, '2-solo');
await page.mouse.click(box.sx, box.y); await wait(400);
const solo2 = await page.evaluate(() => window.__editor.view.solo());
await page.mouse.click(box.mx, box.y); await wait(500);
const mute = await page.evaluate(() => ({ m: window.__editor.view.muted('water'), n: window.__editor.preview.rt.file.cues.length }));
const shotM = await S.shot(page, '3-mute');
await page.mouse.click(box.mx, box.y); await wait(400);
const mute2 = await page.evaluate(() => window.__editor.view.muted('water'));
S.rec('8.2', solo.s === 'water' && solo.n < full && solo2 === null && mute.m && mute.n < full && !mute2 ? 'pass' : 'fail', `S（これだけ見る）：押すと「水」だけ（3D のキュー ${full}→${solo.n}）、もう一度で戻る。M（3Dで消す）：押すと水を除く（${mute.n}）、もう一度で戻る。マウスで押した`, '押したときの説明の札は、この確認では見ていない', [shotS, shotM]);
// 8.3 fold
await page.mouse.click(box.hx, box.hy); await wait(500);
const folded = await page.evaluate(() => ({ open: window.__editor.view.isOpen('water'), pf: window.__editor.timeline.folders.find((f) => f.folder === 'water')?.h }));
const shotF = await S.shot(page, '4-folded');
S.rec('8.3', !folded.open ? 'pass' : 'fail', `フォルダの見出しを押すと${folded.open ? '開いたまま' : 'たたまれ'}、細い帯になった（高さ ${folded.pf} px）`, '警告のあるキューに赤・黄の三角が付くかは画面で（4-folded）', [shotF]);
S.rec('8.3-三角', 'user', 'たたんだ帯で、警告のあるキューに小さな三角（赤・黄）が付いているか', '', [shotF]);
await page.mouse.click(box.hx, box.hy); await wait(300);
// 8.4 warning list
await page.click('#warn-tab'); await wait(500);
const wl = await page.evaluate(() => ({ sum: document.querySelector('.w-sum')?.textContent, grps: [...document.querySelectorAll('.w-grp')].map((g) => g.textContent), foot: document.querySelector('.w-foot')?.textContent }));
const shotW = await S.shot(page, '5-warn-list');
const rowInfo = await page.evaluate(() => { const r = [...document.querySelectorAll('.w-row')].find((x) => x.textContent.includes('あと')); return r ? { i: Number(r.dataset.i), txt: r.textContent } : null; });
await page.evaluate(() => { window.__editor.view.setOpen('water', false); });
await page.locator(`.w-row[data-i="${rowInfo.i}"]`).first().click(); await wait(500);
const go = await page.evaluate((i) => {
  const e = window.__editor; const c = e.state.file.cues[i];
  return { prim: e.state.primary, open: e.view.isOpen('water'), t: e.transport.time, ct: c.t };
}, rowInfo.i);
S.rec('8.4', wl.grps.length === 3 && go.prim === rowInfo.i && go.open ? 'pass' : 'fail', `「警告」：${wl.sum}。見出し ${wl.grps.join('／')}。行「${rowInfo.txt.slice(0, 50)}」を押す → キュー #${go.prim}（期待 #${rowInfo.i}）が選ばれ、水のフォルダが${go.open ? '開き' : '開かず'}、時刻 ${(go.t ?? 0).toFixed?.(2) ?? go.t} 秒へ（キューは ${go.ct} 秒）`, '', [shotW, await S.shot(page, '6-warn-go')]);
S.rec('8.警告の数', counts.danger === 0 && counts.head === 5 && counts.water === 36 && counts.led === 111 ? 'pass' : 'info', `この画面の数（音楽を読んだあと、キュー ${counts.total}）：危ない ${counts.danger}・首振りが速すぎる ${counts.head}・水が上がりきらない ${counts.water}（書いたとおりに動かない ${counts.head + counts.water + counts.missing}）・お知らせ ${counts.led}（記録の目安: 0・41=5+36・111）`);
S.rec('8.8', 'user', '警告の文が平易で、「どこを直せばいいか」が分かるか', '', [shotW]);
S.rec('8.9', 'user', '注意の黄と差し色の琥珀が近い（分かっている問題）。紛らわしいか', '', [shotW]);
// 8.5 3D click
await page.click('.side-tabs button[data-pane="cue"]');
await page.click('.ws-tabs .tab[data-tab="all"]'); await wait(300);
const pickPos = await page.evaluate(async () => {
  const ed = window.__editor;
  ed.preview.resetCamera();
  ed.transport.seek(175.3);
  await new Promise((r) => setTimeout(r, 500));
  const cam = ed.preview.rt.stage.camera; const cv = ed.preview.rt.stage.renderer.domElement; const rect = cv.getBoundingClientRect();
  const fx = ed.preview.rt.layout.fixtures.find((f) => f.group === 'grid' && Math.abs(f.position[0]) < 3);
  const v = cam.position.clone().set(fx.position[0], fx.position[1] + 3, fx.position[2]).project(cam);
  return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
});
await page.mouse.click(pickPos.x, pickPos.y); await wait(700);
const pick = await page.evaluate(() => {
  const e = window.__editor; const sel = e.preview.outline.sel;
  return { prim: e.state.primary, t: e.state.file.cues[e.state.primary]?.t, tag: document.getElementById('pick-tag').textContent, tagVis: !document.getElementById('pick-tag').hidden, out: [sel.active.length, sel.others.length] };
});
const shotPick = await S.shot(page, '7-3d-click');
S.rec('8.5', pick.prim >= 0 && pick.tagVis ? 'pass' : 'fail', `3D の水の柱をクリック（マウスは動かさず）：キュー #${pick.prim}（${pick.t} 秒）が選ばれ、札「${pick.tag}」`, '', [shotPick]);
S.rec('8.10', pick.out[0] === 1 && pick.out[1] > 0 ? 'pass' : 'fail', `縁取り（追記19）：クリックした台 ${pick.out[0]} 台が明るく、同じキューのほか ${pick.out[1]} 台が暗い縁で囲まれる。3D の絵は 7-3d-click`, '', [shotPick]);
// lane name click
const lanePos = await page.evaluate(() => { const t = window.__editor.timeline; const r = t.laneRect(0); const c = t.canvas.getBoundingClientRect(); return { x: c.left + 30, y: r.y + 10 }; });
await page.mouse.click(lanePos.x, lanePos.y); await wait(500);
const ln = await page.evaluate(() => ({ active: window.__editor.preview.outline.sel.active.length, none: window.__editor.state.selection.size === 0 }));
const shotLane = await S.shot(page, '8-lane-outline');
await page.keyboard.press('Escape'); await wait(300);
const cleared = await page.evaluate(() => !window.__editor.preview.outline.active);
S.rec('8.10-行', ln.active > 0 && ln.none && cleared ? 'pass' : 'fail', `行の名前を押す → その行の ${ln.active} 台を縁取り、キューは選ばない（${ln.none}）。Esc で消える（${cleared}）`, '', [shotLane]);
S.rec('8.11', 'user', '縁取りが分かりやすいか（選んだ台が見つかる、うるさくない）', '', [shotPick, shotLane]);
const prodOutline = await (async () => {
  const p2 = await ctx.newPage(); const errs = [];
  p2.on('pageerror', (e) => errs.push(String(e)));
  await p2.goto(`${BASE}/play.html?show=lagoon&t=100&shot=1`); await p2.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  const has = await p2.evaluate(() => !!window.__rt.outline || !!document.getElementById('pick-tag'));
  await p2.close(); return has;
})();
S.rec('8.10-本番', !prodOutline ? 'pass' : 'fail', `本番画面（?show=lagoon）には縁取り・札の部品が無い: ${!prodOutline}`);
// 8.6 light tab
await page.click('.ws-tabs .tab[data-tab="light"]'); await wait(700);
S.rec('8.6', 'user', '光のタブで、色や明るさを変えないキューが薄くなるか', '', [await S.shot(page, '9-light-tab')]);
// 8.7 reset tab and reload, then 本番で再生
await page.click('.ws-tabs .tab[data-tab="water"]'); await wait(300);
await page.evaluate(() => window.__editor.view.setOpen('pyro', true));
const beforeReload = await page.evaluate(() => ({ tab: window.__editor.view.tab, open: ['water', 'screen', 'pyro'].map((f) => window.__editor.view.isOpen(f)).join(), store: localStorage.getItem('water-show-editor-view:v1')?.length }));
await page.click('.ws-tabs .link'); await wait(300);
const afterReset = await page.evaluate(() => ['water', 'screen', 'pyro'].map((f) => window.__editor.view.isOpen(f)).join());
S.rec('8.7-戻す', afterReset !== beforeReload.open ? 'pass' : 'fail', `「このタブを最初の見方に戻す」：開き方 ${beforeReload.open} → ${afterReset}`);
await page.evaluate(() => window.__editor.view.setOpen('pyro', true));
await wait(300);
const keep = await page.evaluate(() => ['water', 'screen', 'pyro'].map((f) => window.__editor.view.isOpen(f)).join());
await page.reload();
await page.waitForFunction(() => window.__editorReady === true, null, { timeout: 90000 });
await wait(800);
const afterReload = await page.evaluate(() => ({ tab: window.__editor.view.tab, open: ['water', 'screen', 'pyro'].map((f) => window.__editor.view.isOpen(f)).join() }));
S.rec('8.7', afterReload.open === keep && afterReload.tab === 'water' ? 'pass' : 'fail', `再読み込み：タブ ${afterReload.tab}、開き方 ${keep} → ${afterReload.open}（残った）`);
// S not in saved show / player
await page.click('.ws-tabs .tab[data-tab="water"]');
await page.evaluate(() => window.__editor.view.toggleSolo('pyro')); await wait(300);
const saved = await page.evaluate(() => ({ same: localStorage.getItem('water-show-editor:v1') === JSON.stringify(window.__editor.state.file), n: window.__editor.state.file.cues.length, solo: window.__editor.view.solo() }));
const popupP = ctx.waitForEvent('page');
await page.click('#show-btn');
const pp = await popupP;
await pp.waitForFunction(() => window.__rt && window.__clock, null, { timeout: 90000 }).catch(() => {});
await wait(1500);
const play = await pp.evaluate(() => ({ cues: window.__rt?.file?.cues?.length, url: location.search }));
S.rec('8.7-本番', saved.same && play.cues === saved.n ? 'pass' : 'fail', `S（花火だけ）を入れたまま「本番で再生 ↗」：自動保存は演出そのもの（${saved.same}）、本番画面のキュー ${play.cues} 個（演出は ${saved.n} 個＝S は入らない）。URL ${play.url}`);
await pp.close();
S.rec('8.コンソール', errors.length ? 'fail' : 'pass', errors.length ? errors.slice(0, 3).join(' | ') : 'コンソールのエラー 0');
S.save({ counts, pageTitle: title });
await browser.close();
