import { wake, open, scenario, openVenue, vrow, vfill, openEditor, wait, BASE } from './lib.mjs';
const S = scenario(10, '自分の庭の池の会場を作って演出を開く');
const { browser, ctx, page, errors } = await open({ w: 1440, h: 900 });
await openVenue(page, 'venue=lagoon');
const ve = (fn, a) => page.evaluate(fn, a);
// 1 garden sample
await page.click('#venue-btn');
const menu = await page.$$eval('#venue-pop button', (bs) => bs.map((b) => b.textContent.trim()));
await page.click('#venue-pop button:has-text("庭の池")'); await wait(800);
const g = await ve(() => ({ id: window.__venueEditor.doc().id, built: window.__venueEditor.builtIn(), fnd: window.__venueEditor.findings().map((f) => f.level + ':' + f.rule), foot: document.getElementById('vn-foot').textContent, parts: document.getElementById('parts-count').textContent, warn: document.getElementById('warn-list').innerText }));
S.rec('10.1', g.id === 'garden' && g.fnd.length === 0 ? 'pass' : 'fail', `会場 ▾ の項目: ${menu.join('・')}。「庭の池」を開いた（${g.id}）。部品 ${g.parts}。警告 ${g.fnd.length ? g.fnd.join(',') : '0（止める 0・赤 0・黄 0）'}。下の欄「${g.foot.replace(/\s+/g, ' ').slice(0, 120)}」`, '', [await S.shot(page, '1-garden')]);
// 2 new venue
await page.click('#venue-btn'); await page.click('#venue-pop button:has-text("新しい会場")'); await wait(800);
const n = await ve(() => { const d = window.__venueEditor.doc(); return { id: d.id, name: d.name, scale: d.scale, water: d.water, seats: (d.seats ?? d.parts.filter((p) => p.kind === 'seats')).length, parts: d.parts.map((p) => p.kind) }; });
S.rec('10.2', n.name === '新しい会場' && n.scale === 'garden' && n.water.kind === 'rect' && n.water.width === 3 && n.water.depth === 2 ? 'pass' : 'fail', `「新しい会場」：名前「${n.name}」・規模 ${n.scale}・水面 ${JSON.stringify(n.water)}・部品 ${n.parts.join(',')}`, '', [await S.shot(page, '2-new')]);
// 3 name, shape, radius
await vfill(page, '#venue-fields', '名前', 'うちの庭');
await vrow(page, '#venue-fields', '水面').locator('select').selectOption({ label: '円' }); await wait(300);
await vfill(page, '#venue-fields', '半径', 1.5);
const d3 = await ve(() => { const d = window.__venueEditor.doc(); return { name: d.name, water: d.water }; });
S.rec('10.2-直す', d3.name === 'うちの庭' && d3.water.kind === 'circle' && d3.water.radius === 1.5 ? 'pass' : 'fail', `名前「${d3.name}」・水面 ${JSON.stringify(d3.water)}`, '', [await S.shot(page, '3-named')]);
// 4 add ring
await page.click('#add-btn'); await page.click('#add-pop button:has-text("円")'); await wait(500);
const addedRing = await ve(() => window.__venueEditor.doc().parts.at(-1));
const fixOpts = await page.$$eval('#part-fields .row:has(label:text("機材")) option', (os) => os.map((o) => o.textContent));
await vrow(page, '#part-fields', '機材').locator('select').selectOption({ label: fixOpts.find((o) => o.includes('庭の噴き上げ')) }); await wait(300);
await vfill(page, '#part-fields', 'グループ', 'grid');
await vfill(page, '#part-fields', '台数', 8);
await vfill(page, '#part-fields', '半径', 1);
const ring = await ve(() => ({ last: window.__venueEditor.doc().parts.at(-1), n: window.__venueEditor.venue().groups.find((x) => x.name === 'grid')?.positions.length, foot: document.getElementById('vn-foot').textContent }));
S.rec('10.3', ring.last.kind === 'ring' && ring.last.fixture.includes('garden') || ring.last.group === 'grid' && ring.n === 8 && ring.last.radius === 1 ? 'pass' : 'fail', `部品「円」：機材 ${ring.last.fixture}・グループ ${ring.last.group}・台数 ${ring.last.count}（図の台 ${ring.n}）・半径 ${ring.last.radius}。足す前の初期値 ${JSON.stringify({ f: addedRing.fixture, c: addedRing.count })}`, '', [await S.shot(page, '4-ring')]);
// 5 single
await page.click('#add-btn'); await page.click('#add-pop button:has-text("1台")'); await wait(500);
await vrow(page, '#part-fields', '機材').locator('select').selectOption({ label: fixOpts.find((o) => o.includes('庭の噴き上げ')) }); await wait(300);
await vfill(page, '#part-fields', 'グループ', 'geyser');
const sing = await ve(() => ({ ringC: window.__venueEditor.doc().parts.find((p) => p.kind === 'ring')?.center, last: window.__venueEditor.doc().parts.at(-1), n: window.__venueEditor.venue().groups.find((x) => x.name === 'geyser')?.positions.length, groups: window.__venueEditor.venue().groups.map((x) => x.name + ':' + x.positions.length).join(' '), fnd: window.__venueEditor.findings().map((f) => f.level + ':' + f.rule + (f.text ? '(' + f.text.slice(0, 40) + ')' : '')) }));
S.rec('10.3-1台', sing.last.kind === 'single' && sing.last.group === 'geyser' ? 'pass' : 'fail', `部品「1台」：機材 ${sing.last.fixture}・グループ ${sing.last.group}・位置 ${JSON.stringify(sing.last.at)}。グループの台数 ${sing.groups}`, '', [await S.shot(page, '5-single')]);
// 6 warnings
const warnText = await page.locator('#warn-list').innerText();
S.rec('10.6', 'info', `右下の警告: 「${warnText.replace(/\s+/g, ' ').slice(0, 220)}」。findings: ${sing.fnd.length ? sing.fnd.join(' / ') : '0'}（円の中心 ${JSON.stringify(sing.ringC)}、水面は半径 1.5 m の円）`, '', [await S.shot(page, '6-warnings')]);
const stopCount = sing.fnd.filter((x) => x.startsWith('stop')).length;
// 7 3D
const btnDisabled = await page.locator('#view3d-btn').isDisabled();
const venueId = await ve(() => window.__venueEditor.doc().id);
let play = null;
if (!btnDisabled) {
  const popP = ctx.waitForEvent('page');
  await page.click('#view3d-btn');
  const pp = await popP;
  await pp.waitForFunction(() => document.getElementById('go') && !document.getElementById('go').disabled, null, { timeout: 90000 });
  await pp.click('#go'); await wait(3000); await pp.evaluate(() => window.__clock.pause()); await wake(pp);
  const info = await pp.evaluate(() => ({ url: location.search, fixtures: window.__rt.layout.fixtures.length, t: window.__clock.time(), playing: window.__clock.playing }));
  const camLabels = await (async () => { await pp.click('#cam-open'); const l = await pp.$$eval('#cam button', (bs) => bs.map((b) => b.textContent.trim().replace(/[0-9]$/, ''))); await pp.keyboard.press('Escape'); return l; })();
  await pp.evaluate(() => { window.__clock.pause(); window.__clock.seek(100); });
  await wait(1200);
  play = { ...info, camLabels, shot: await S.shot(pp, '7-player-garden'), shots: [] };
  for (const v of ['wide', 'eye', 'aerial', 'left']) { await pp.click('#cam-open').catch(() => {}); const b = await pp.$(`#cam button[data-v="${v}"]`); if (b) { await b.click(); await wait(700); play.shots.push(await S.shot(pp, `8-cam-${v}`)); } }
  await pp.close();
}
S.rec('10.4', !btnDisabled && play && play.url.includes('venue=' + venueId) && play.t > 1 && play.fixtures === 9 ? 'pass' : 'fail', play ? `「3Dで見る」→ 本番画面 ${play.url}、機材 ${play.fixtures} 台（8+1）、再生 ${play.t.toFixed(1)} 秒まで進んだ。席: ${play.camLabels.join('・')}` : `「3Dで見る」が押せない（止める ${stopCount} 個）`, '', play ? [play.shot, ...play.shots] : []);
S.rec('10.5', 'user', '庭の池の大きさで、噴水が白く飛ばないか（段階 7 の直し）。画面 7-player-garden と 8-cam-*', '', play ? [play.shot, ...play.shots] : []);
S.rec('10.9', 'user', '3D の水の見え方（庭の規模の物理は合わせていない。左に「まだ実物に合わせていません」の説明が出る: ' + (await page.locator('#venue-fields .vn-note').count() ? '出ている' : '出ていない') + '）', '', play ? [play.shot] : []);
// 9 editor: venue switch
const ed = await ctx.newPage();
ed.on('pageerror', (e) => errors.push(String(e)));
await openEditor(ed, 'fresh');
const lagoonLanes = await ed.evaluate(() => window.__editor.lanes().map((l) => l.name).join(','));
await ed.click('#venue-btn');
const vlist = await ed.$$eval('#venue-pop button', (bs) => bs.map((b) => b.textContent.trim()));
await ed.click('#venue-pop button:has-text("うちの庭")'); await wait(1200);
const sw = await ed.evaluate(() => { const e = window.__editor; const f = e.state.file; return { venue: f.venue, lanes: e.lanes().map((l) => l.name).join(','), missing: f.cues.filter((c) => e.lanes()[e.laneOf(c)]?.missing).length, toast: document.getElementById('toast').textContent, foot: document.body.innerText.match(/動かないキュー[^\n]*/)?.[0] ?? '' }; });
// hover a block in the missing lane
const hov = await ed.evaluate(() => { const e = window.__editor; const li = e.lanes().findIndex((l) => l.missing); const cue = e.state.file.cues.findIndex((c) => e.laneOf(c) === li); if (li < 0 || cue < 0) return null; e.timeline.reveal(cue); const b = e.timeline.blockRect(cue); return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null; });
let tip = '';
if (hov) { await ed.mouse.move(hov.x, hov.y); await wait(500); await ed.mouse.move(hov.x + 2, hov.y + 1); await wait(500); tip = (await ed.evaluate(() => document.body.innerText)).includes('この会場に狙う台がありません') ? 'あり' : (await ed.evaluate(() => [...document.querySelectorAll('[title]')].map((e) => e.title).filter((t) => t.includes('この会場')).join('|'))) || 'なし'; }
const sh9 = await S.shot(ed, '9-editor-garden');
S.rec('10.6-エディタ', sw.venue === venueId && /grid/.test(sw.lanes) && /geyser/.test(sw.lanes) && sw.lanes.endsWith('この会場に無い') ? 'pass' : 'fail', `エディタの会場 ▾：${vlist.join('・')}。「うちの庭」を選ぶとレーン ${sw.lanes}（前: ${lagoonLanes.slice(0, 60)}…）。この会場に無いキュー ${sw.missing} 個。知らせ「${sw.toast.slice(0, 100)}」。下の知らせ「${sw.foot.slice(0, 80)}」。ブロックに乗せた説明「この会場に狙う台がありません」: ${tip}`, '', [sh9]);
await ed.keyboard.press('Control+z'); await wait(900);
const back = await ed.evaluate(() => ({ venue: window.__editor.state.file.venue, lanes: window.__editor.lanes().map((l) => l.name).join(',') }));
S.rec('10.7', back.lanes === lagoonLanes ? 'pass' : 'fail', `⌘Z（Ctrl+Z）でラグーンに戻る：レーンが前と${back.lanes === lagoonLanes ? '同じ' : '違う'}（venue=${back.venue}）`, '', [await S.shot(ed, '10-editor-back')]);
S.rec('10.8', 'user', '部品の足し方・図のつかみやすさ。画面 4-ring・5-single', '', ['shots/test-run/10/4-ring.jpg', 'shots/test-run/10/5-single.jpg']);
S.rec('10.コンソール', errors.length ? 'fail' : 'pass', errors.length ? errors.slice(0, 3).join(' | ') : 'コンソールのエラー 0');
S.save({ venueId });
await browser.close();
