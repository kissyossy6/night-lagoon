import { wake, open, scenario, openVenue, openEditor, wait, imgStats, ROOT } from './lib.mjs';
const S = scenario(11, '机の会場で3Dを見る');
const { browser, ctx, page, errors } = await open({ w: 1440, h: 900 });
await openVenue(page, 'venue=desk');
const d = await page.evaluate(() => ({ id: window.__venueEditor.doc().id, fnd: window.__venueEditor.findings().length, note: document.querySelector('#venue-fields .vn-note')?.textContent ?? '', parts: document.getElementById('parts-count').textContent, foot: document.getElementById('vn-foot').innerText.replace(/\s+/g, ' ') }));
S.rec('11.1', d.id === 'desk' && d.fnd === 0 && d.note.includes('まだ実物に合わせていません') ? 'pass' : 'fail', `机の水槽（60×30 cm）：警告 ${d.fnd}、左の説明「${d.note}」、部品 ${d.parts}`, '', [await S.shot(page, '1-desk-venue')]);
const popP = ctx.waitForEvent('page');
await page.click('#view3d-btn');
const pp = await popP;
await pp.waitForFunction(() => document.getElementById('go') && !document.getElementById('go').disabled, null, { timeout: 90000 });
await pp.click('#go'); await wait(3000); await pp.evaluate(() => window.__clock.pause()); await wake(pp);
const info = await pp.evaluate(() => ({ url: location.search, fixtures: window.__rt.layout.fixtures.length, t: window.__clock.time() }));
await pp.click('#cam-open');
const cams = await pp.$$eval('#cam button', (bs) => bs.map((b) => [b.dataset.v, b.textContent.trim().replace(/[0-9]$/, '')]));
await pp.keyboard.press('Escape');
await pp.mouse.click(700, 300);
await pp.evaluate(() => window.__clock.pause());
const shots = [];
const stats = [];
for (const t of [60, 100, 140]) {
  await pp.evaluate((x) => window.__clock.seek(x), t); await wait(1200);
  const f = await S.shot(pp, `2-desk-t${t}`); shots.push(f); stats.push([t, imgStats(ROOT + f)]);
}
const front = cams.find(([, l]) => l === '机の前');
let frontShot = null;
if (front) { await pp.click('#cam-open'); await pp.click(`#cam button[data-v="${front[0]}"]`); await wait(900); await pp.evaluate((x) => window.__clock.seek(x), 100); await wait(1000); frontShot = await S.shot(pp, '3-desk-front-seat'); shots.push(frontShot); stats.push(['机の前', imgStats(ROOT + frontShot)]); }
const maxWhite = Math.max(...stats.map(([, s]) => s.white));
S.rec('11.2', maxWhite < 0.05 ? 'pass' : 'fail', `本番画面（${info.url}）で机の水槽、機材 ${info.fixtures} 台（期待 25＝18+7）。3つの時刻と「机の前」の席の画面で、ほぼ白（全色 245 以上）の画素の割合: ` + stats.map(([k, s]) => `${k}: ${(s.white * 100).toFixed(2)}%`).join('・') + `（5% 未満なら白く飛んでいない）。席: ${cams.map((c) => c[1]).join('・')}`, '', shots);
S.rec('11.3', 'user', '柱が小さく、水槽の大きさに見えるか（大きなホースに見えないか）', '', shots);
await pp.close();
// editor
const ed = await ctx.newPage(); ed.on('pageerror', (e) => errors.push(String(e)));
await openEditor(ed, 'fresh');
await ed.click('#venue-btn'); await ed.click('#venue-pop button:has-text("机の水槽")'); await wait(1500);
const lanes = await ed.evaluate(() => window.__editor.lanes().map((l) => l.name).join(','));
S.rec('11.4', lanes.startsWith('ミニ噴き上げ・grid,ミニ噴き上げ・chaser') && lanes.endsWith('この会場に無い') ? 'pass' : 'fail', `エディタで会場を机の水槽にした：レーン ${lanes}`, '', [await S.shot(ed, '4-editor-desk')]);
const nz = await ed.evaluate(() => { const e = window.__editor; const f = e.state.file; return { missing: f.cues.filter((c) => e.lanes()[e.laneOf(c)]?.missing).length, total: f.cues.length }; });
S.rec('11.動かない数', 'info', `エディタ（音楽を読んだあとの演出）：${nz.total} キューのうち、この会場に無いキュー ${nz.missing}（会場の画面の数え方は 430 のうち 316）`);
S.rec('11.コンソール', errors.length ? 'fail' : 'pass', errors.length ? errors.slice(0, 3).join(' | ') : 'コンソールのエラー 0');
S.save();
await browser.close();
