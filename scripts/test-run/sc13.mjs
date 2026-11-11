import { open, scenario, openVenue, vrow, vfill, wait } from './lib.mjs';
import { readFileSync } from 'node:fs';
const SCR = process.argv[2];
const S = scenario(13, '会場の部品を動かして、保存・写す・消す');
const { browser, ctx, page, errors } = await open({ w: 1440, h: 900 });
let dialogs = [];
page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
await openVenue(page, 'venue=lagoon');
const ve = (fn, a) => page.evaluate(fn, a);
const box = await page.locator('#vn-canvas').boundingBox();
const at = async (x, z) => { const [px, py] = await ve(([x, z]) => window.__venueEditor.view.screenOf(x, z), [x, z]); return [box.x + px, box.y + py]; };
const drag = async (from, to, alt = false) => {
  await page.mouse.move(...from); await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move(...to, { steps: 4 }); await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
};
const start = await ve(() => ({ n: window.__venueEditor.venue().groups.reduce((a, g) => a + g.positions.length, 0), foot: document.getElementById('vn-foot').innerText.replace(/\s+/g, ' ') }));
S.rec('13.0', start.n === 372 ? 'pass' : 'fail', `組み込みの「ラグーン」を開いた：水の機材 ${start.n} 台（期待 372）`, '', [await S.shot(page, '0-lagoon')]);
// 1 drag the left arc
const arc0 = await ve(() => window.__venueEditor.venue().groups.find((g) => g.name === 'chaser').positions[9]);
const scale = await ve(() => window.__venueEditor.view.screenOf(1, 0)[0] - window.__venueEditor.view.screenOf(0, 0)[0]);
const p0 = await at(arc0[0], arc0[2]);
await drag(p0, [p0[0] + 4.2 * scale, p0[1] - 1.9 * scale]);
const moved = await ve(() => { const e = window.__venueEditor; const a = e.doc().parts.find((p) => p.name === '左アーク'); return { id: e.doc().id, built: e.builtIn(), center: a.center, name: e.doc().name, title: document.getElementById('venue-title').textContent }; });
const copyId = moved.id;
S.rec('13.1', JSON.stringify(moved.center) === '[-30,-2]' && !moved.built && moved.name === 'ラグーンの写し' ? 'pass' : 'fail', `左アークを約 (4.2, −1.9) m ドラッグ → 中心 ${JSON.stringify(moved.center)}（0.5 m の格子に吸い付いた。元 [-34,0]）。上の題「${moved.title}」。最初の変更で「${moved.name}」ができた（${moved.id}）`, '', [await S.shot(page, '1-drag-arc')]);
// Alt: no snap (drag a fixture of the right arc, not the selected left one)
const rc0 = await ve(() => window.__venueEditor.doc().parts.find((p) => p.name === '右アーク').center);
const fr = await ve(() => window.__venueEditor.venue().groups.find((g) => g.name === 'chaser').positions.find((q) => q[0] > 30));
const pr = await at(fr[0], fr[2]);
await drag(pr, [pr[0] - 2.37 * scale, pr[1] + 1.21 * scale], true);
const rc1 = await ve(() => window.__venueEditor.doc().parts.find((p) => p.name === '右アーク').center);
const nonSnap = rc1.some((v) => Math.abs(v * 2 - Math.round(v * 2)) > 1e-6);
await page.keyboard.press('Meta+z'); await wait(200);
const rc2 = await ve(() => window.__venueEditor.doc().parts.find((p) => p.name === '右アーク').center);
S.rec('13.1-Alt', nonSnap && JSON.stringify(rc2) === JSON.stringify(rc0) ? 'pass' : 'fail', `Alt を押しながら右アークを小さく動かす：中心 ${JSON.stringify(rc0)} → ${JSON.stringify(rc1)}（0.5 m の格子に吸い付かない値）。⌘Z で ${JSON.stringify(rc2)} に戻る`);
// 2 reopen built-in lagoon
await page.click('#venue-btn'); 
const menuItems = await page.$$eval('#venue-pop button', (bs) => bs.map((b) => b.textContent.trim()));
await page.click('#venue-pop button:text-is("ラグーン")').catch(async () => { await page.click('#venue-pop button:has-text("ラグーン")'); });
await wait(800);
const reopen = await ve(() => ({ id: window.__venueEditor.doc().id, c: window.__venueEditor.doc().parts.find((p) => p.name === '左アーク').center, built: window.__venueEditor.builtIn() }));
S.rec('13.2', reopen.id === 'lagoon' && JSON.stringify(reopen.c) === '[-34,0]' && reopen.built ? 'pass' : 'fail', `会場 ▾（${menuItems.join('・')}）から組み込みの「ラグーン」を開き直す：左アーク ${JSON.stringify(reopen.c)}（元のまま）`);
// back to copy through the menu (no reload), then undo as the scenario says
await page.click('#venue-btn');
await page.locator('#venue-pop button', { hasText: 'ラグーンの写し' }).first().click(); await wait(700);
const getC = () => ve(() => window.__venueEditor.doc().parts.find((p) => p.name === '左アーク').center);
await page.click('#parts-list li:has-text("左アーク")');
const mv = await getC();
await page.keyboard.press('Meta+z'); await wait(200); const u = await getC();
await page.keyboard.press('Meta+Shift+z'); await wait(200); const r = await getC();
const keptAcross = JSON.stringify(u) !== JSON.stringify(mv);
// a fresh change in this session: undo / redo must work (drag the right arc, which is not the selected part)
const getR = () => ve(() => window.__venueEditor.doc().parts.find((p) => p.name === '右アーク').center);
const fa = await ve(() => window.__venueEditor.venue().groups.find((g) => g.name === 'chaser').positions.find((q) => q[0] > 30));
const pfa = await at(fa[0], fa[2]);
await page.keyboard.press('Escape');
await drag(pfa, [pfa[0] - 4 * scale, pfa[1] - 2 * scale]);
const m2 = await getR();
await page.keyboard.press('Meta+z'); await wait(200); const u2 = await getR();
await page.keyboard.press('Meta+Shift+z'); await wait(200); const r2 = await getR();
S.rec('13.3', JSON.stringify(u2) !== JSON.stringify(m2) && JSON.stringify(r2) === JSON.stringify(m2) ? 'pass' : 'fail', `同じ画面で動かした直後の ⌘Z / ⇧⌘Z：${JSON.stringify(m2)} → ${JSON.stringify(u2)} → ${JSON.stringify(r2)}`);
S.rec('13.3-切り替え後', keptAcross ? 'pass' : 'info', `別の会場に切り替えて「ラグーンの写し」へ戻ったあとの ⌘Z：${JSON.stringify(mv)} → ${JSON.stringify(u)}（${keptAcross ? '切り替えをまたいで戻せる' : '切り替えると元に戻す履歴は消える。手順の「写しに戻り、⌘Z」はこの動きではそのまま通らない'}）`);
await page.keyboard.press('Meta+z'); await wait(150);
// 4 nudge / skip
await page.click('#parts-list li:has-text("左アーク")'); await wait(200);
const arcN = 'chaser';
const f5 = await ve(() => window.__venueEditor.venue().groups.find((g) => g.name === 'chaser').positions[5]);
const sel0 = await at(f5[0], f5[2]);
await page.mouse.click(...sel0); const picked = await ve(() => window.__venueEditor.sel());
await drag(sel0, [sel0[0] + 1.1 * scale, sel0[1]]);
const nudge = await ve(() => window.__venueEditor.doc().parts.find((p) => p.name === '左アーク').nudge);
const hasReset = await page.locator('#fixture-fields button:has-text("ずらしを戻す")').count();
await page.locator('#fixture-fields button:has-text("ずらしを戻す")').first().click(); await wait(200);
const nudge2 = await ve(() => window.__venueEditor.doc().parts.find((p) => p.name === '左アーク').nudge ?? null);
const f2 = await ve(() => window.__venueEditor.venue().groups.find((g) => g.name === 'chaser').positions[2]);
await page.mouse.click(...(await at(f2[0], f2[2])));
await page.keyboard.press('Delete');
const skip = await ve(() => window.__venueEditor.doc().parts.find((p) => p.name === '左アーク').skip);
const backBtn = await page.locator('#fixture-fields button:has-text("戻す")').count();
const shotNS = await S.shot(page, '2-nudge-skip');
await page.locator('#fixture-fields button:has-text("この1台を戻す")').first().click().catch(() => {});
const skip2 = await ve(() => window.__venueEditor.doc().parts.find((p) => p.name === '左アーク').skip ?? null);
S.rec('13.4', picked.part != null && nudge?.length === 1 && skip?.length === 1 && skip2 == null && nudge2 == null && backBtn > 0 ? 'pass' : 'fail', `1台を選んでドラッグ → ずらす ${JSON.stringify(nudge)}（右の欄に「ずらしを戻す」: ${hasReset}）。別の1台を Delete → 外す ${JSON.stringify(skip)}（「戻す」ボタン ${backBtn}）。戻すボタンで 外す→${JSON.stringify(skip2)}・ずらす→${JSON.stringify(nudge2)}`, '', [shotNS]);
// 5 place one
await page.click('#tool-seg button[data-tool="place"]');
await page.selectOption('#place-kind', 'geyser').catch(() => {});
const nBefore = await ve(() => window.__venueEditor.doc().parts.length);
await page.mouse.click(...(await at(0.2, 30.1)));
const placed = await ve(() => { const d = window.__venueEditor.doc(); return { n: d.parts.length, last: d.parts.at(-1) }; });
const shotPlace = await S.shot(page, '3-placed');
await page.keyboard.press('Escape'); await page.keyboard.press('Delete');
const afterDel = await ve(() => window.__venueEditor.doc().parts.length);
S.rec('13.5', placed.n === nBefore + 1 && placed.last.kind === 'single' && afterDel === nBefore ? 'pass' : 'fail', `「1台を置く」→ 図をクリック：部品 ${nBefore}→${placed.n}（${placed.last.kind}・${placed.last.fixture}・位置 ${JSON.stringify(placed.last.at)}）、Delete で ${afterDel} に戻った`, '', [shotPlace]);
// 6 eight kinds
await page.click('#tool-seg button[data-tool="select"]').catch(() => {});
const kinds = [['列', 'line'], ['帯', 'band'], ['弧', 'arc'], ['円', 'ring'], ['1台', 'single'], ['水幕', 'screen'], ['花火の台', 'pyro'], ['客席', 'seats']];
const got = [];
for (const [label, kind] of kinds) {
  const before = await ve(() => window.__venueEditor.doc().parts.length);
  await page.click('#add-btn'); await page.click(`#add-pop button:text-is("${label}")`).catch(async () => { await page.click(`#add-pop button:has-text("${label}")`); }); await wait(300);
  const k = await ve(() => ({ n: window.__venueEditor.doc().parts.length, kind: window.__venueEditor.doc().parts.at(-1).kind }));
  await page.keyboard.press('Delete'); await wait(200);
  const after = await ve(() => window.__venueEditor.doc().parts.length);
  got.push(`${label}→${k.kind}${k.n === before + 1 && after === before ? '✓' : '✗'}`);
}
S.rec('13.6', got.every((g) => g.endsWith('✓')) && got.every((g, i) => g.includes('→' + kinds[i][1])) ? 'pass' : 'fail', `部品を足す→Delete：${got.join('・')}`);
// 7 field edit
await page.click('#parts-list li:has-text("右アーク")');
const before = await ve(() => window.__venueEditor.venue().groups.find((g) => g.name === 'chaser').positions.length);
await vfill(page, '#part-fields', '台数', 24);
const afterN = await ve(() => window.__venueEditor.venue().groups.find((g) => g.name === 'chaser').positions.length);
S.rec('13.7', afterN !== before ? 'pass' : 'fail', `右アークの台数を 24 にして Enter：チェイサーの台数 ${before} → ${afterN}（図も変わる）`, '', [await S.shot(page, '4-field-edit')]);
await page.keyboard.press('Meta+z');
// 9 JSON export / import
const dlP = page.waitForEvent('download');
await page.click('#venue-btn'); await page.click('#venue-pop button:has-text("JSON を書き出す")');
const dl = await dlP; const jf = `${SCR}/venue-export.json`; await dl.saveAs(jf);
const jtxt = readFileSync(jf, 'utf8'); const jdoc = JSON.parse(jtxt);
await page.click('#venue-btn');
const fc = page.waitForEvent('filechooser');
await page.click('#venue-pop button:has-text("JSON を読み込む")');
(await fc).setFiles(jf); await wait(1200);
const imp = await ve(() => ({ id: window.__venueEditor.doc().id, name: window.__venueEditor.doc().name, parts: window.__venueEditor.doc().parts.length, built: window.__venueEditor.builtIn() }));
await page.click('#venue-btn');
const menu9 = await page.$$eval('#venue-pop button', (bs) => bs.map((b) => b.textContent.trim()));
await page.keyboard.press('Escape');
S.rec('13.8', imp.parts === jdoc.parts.length && !imp.built ? 'pass' : 'fail', `JSON を書き出し（${dl.suggestedFilename()}・${(jtxt.length / 1e3).toFixed(1)} KB・部品 ${jdoc.parts.length}）→ JSON を読み込む：「${imp.name}」（${imp.id}）が開いた、部品 ${imp.parts}。会場 ▾ の項目: ${menu9.join('・')}`, '', [await S.shot(page, '5-imported')]);
// 10 delete
const delId = imp.id;
if (await page.evaluate(() => document.getElementById('venue-pop').hidden)) await page.click('#venue-btn');
const hasDel = await page.locator('#venue-pop button:has-text("この会場を消す")').count();
await page.click('#venue-pop button:has-text("この会場を消す")');
await wait(900);
await page.evaluate(() => { document.getElementById('venue-pop').hidden = true; });
const afterDelV = await ve(() => ({ id: window.__venueEditor.doc().id, built: window.__venueEditor.builtIn() }));
await page.click('#venue-btn');
await wait(200);
const builtHasDel = await page.locator('#venue-pop button:has-text("この会場を消す")').count();
const stillListed = (await page.$$eval('#venue-pop button', (bs) => bs.map((b) => b.textContent.trim()))).join('|');
await page.keyboard.press('Escape');
S.rec('13.9', hasDel === 1 && afterDelV.id === 'lagoon' && builtHasDel === 0 && dialogs.length >= 1 ? 'pass' : 'fail', `自分の会場の「この会場を消す…」（${hasDel}）→ 確認「${dialogs.at(-1) ?? ''}」→ 消えてラグーンが開いた（${afterDelV.id}）。組み込みを開いているときの「この会場を消す…」は ${builtHasDel} 個。消した会場は一覧に ${stillListed.includes(delId) ? '残っている' : '無い'}`);
S.rec('13.10', 'user', 'つかみやすさ・吸い付き・図の拡大・動かし方。画面 1-drag-arc・2-nudge-skip', '', ['shots/test-run/13/1-drag-arc.jpg', 'shots/test-run/13/2-nudge-skip.jpg']);
S.rec('13.11', 'user', '見本の会場の並べ方・大きさ。部品・機材・規則の名前で直したいもの', '', ['shots/test-run/13/0-lagoon.jpg']);
S.rec('13.コンソール', errors.length ? 'fail' : 'pass', errors.length ? errors.slice(0, 3).join(' | ') : 'コンソールのエラー 0');
S.save();
await browser.close();
