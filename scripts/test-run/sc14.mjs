import { open, scenario, openVenue, vrow, vfill, wait } from './lib.mjs';
const S = scenario(14, '会場の警告を見る');
const { browser, ctx, page, errors } = await open({ w: 1440, h: 900 });
const ve = (fn, a) => page.evaluate(fn, a);
const fnd = () => ve(() => window.__venueEditor.findings().map((f) => ({ level: f.level, rule: f.rule, text: (f.text ?? f.message ?? '').slice(0, 90) })));
const summary = (fs) => ['stop', 'danger', 'note'].map((l) => `${l === 'stop' ? '止める' : l === 'danger' ? '赤' : '黄'} ${fs.filter((f) => f.level === l).length}`).join('・');
await openVenue(page, 'venue=lagoon');
const f0 = await fnd();
const warnTxt = (await page.locator('#warn-list').innerText()).replace(/\s+/g, ' ');
S.rec('14.1', f0.filter((f) => f.level === 'stop').length === 0 && f0.filter((f) => f.level === 'danger').length === 1 && f0.filter((f) => f.level === 'note').length === 2 ? 'pass' : 'fail', `ラグーン：${summary(f0)}。内訳 ${f0.map((f) => f.rule + ':' + f.text).join(' / ')}`, '', [await S.shot(page, '1-lagoon-warnings')]);
S.rec('14.6', warnTxt.includes('警告は目安で、実際の許可の代わりにはなりません。') ? 'pass' : 'fail', `一覧の下の言葉: ${warnTxt.includes('警告は目安で、実際の許可の代わりにはなりません。') ? 'ある' : 'ない'}（一覧の文字「${warnTxt.slice(0, 200)}…」）`);
// 2 overlap
await page.click('#parts-list li:has-text("右アーク")');
let stopCase = null;
for (const n of [30, 40, 60]) {
  await vfill(page, '#part-fields', '台数', n);
  const fs = await fnd();
  const stops = fs.filter((f) => f.level === 'stop');
  if (stops.length) { stopCase = { n, stops: stops.map((s) => s.rule).join(','), txt: stops[0].text }; break; }
}
const btn = page.locator('#view3d-btn');
const dis = await btn.isDisabled(); const title = await btn.getAttribute('title');
const shotStop = await S.shot(page, '2-stop');
await page.keyboard.press('Meta+z'); await wait(300);
const dis2 = await btn.isDisabled(); const f2 = await fnd();
S.rec('14.2', stopCase && dis && !dis2 ? 'pass' : 'fail', stopCase ? `右アークの台数を ${stopCase.n} にすると「止める」（${stopCase.stops}：${stopCase.txt}）が出て、「3Dで見る」は押せない（無効=${dis}）。⌘Z で戻すと押せる（無効=${dis2}、警告 ${summary(f2)}）` : '台数を 30・40・60 にしても「止める」が出なかった', '', [shotStop]);
S.rec('14.6-ボタンの言葉', title && /止める.*警告が.*つあります/.test(title) || (dis && title) ? 'pass' : 'info', `止めるときの「3Dで見る」の説明（title）: 「${title}」`);
// 3 pyro near seats
await page.click('#add-btn'); await page.click('#add-pop button:text-is("花火の台")'); await wait(400);
const seats = await ve(() => window.__venueEditor.doc().parts.find((p) => p.kind === 'seats'));
const notes = [];
for (const dz of [300, 200, 150, 100, 60, 30]) {
  const z = seats.from[1] - dz;
  await vfill(page, '#part-fields', '始め', z, 1); await vfill(page, '#part-fields', '終わり', z, 1);
  const n = (await page.locator('#part-fields .vn-note', { hasText: /客席|打て/ }).first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  const fs = await fnd();
  notes.push(`客席の ${dz} m 手前：${n.slice(0, 70)}｜${summary(fs)}`);
}
const shotPy = await S.shot(page, '3-pyro-near');
const lastNote = notes.at(-1);
S.rec('14.3', /号まで/.test(notes[0] + notes[1]) && /打てる玉がありません/.test(notes.join()) ? 'pass' : 'fail', `花火の台を客席へ近づける：` + notes.join(' ／ '), '', [shotPy]);
await page.keyboard.press('Delete'); await wait(300);
// 4 water outside
await openVenue(page, 'venue=garden');
await page.click('#add-btn'); await page.click('#add-pop button:text-is("1台")'); await wait(400);
const water = await ve(() => window.__venueEditor.doc().water);
await vfill(page, '#part-fields', '位置', 50, 0);
const fo = await fnd();
const outside = fo.filter((f) => f.level === 'stop');
S.rec('14.4', outside.length > 0 ? 'pass' : 'fail', `庭の池（半径の小さい円の水面）に1台を足して水面の外（x=50 m）へ出す：${summary(fo)}（${outside.map((o) => o.rule + ':' + o.text).join(' / ')}）`, '', [await S.shot(page, '4-outside')]);
await page.keyboard.press('Delete'); await wait(300);
// 5 samples
const smp = [];
for (const v of ['desk', 'garden', 'plaza']) {
  await openVenue(page, `venue=${v}`);
  const fs = await fnd();
  smp.push([v, fs.length, await S.shot(page, `5-${v}`)]);
}
S.rec('14.5', smp.every(([, n]) => n === 0) ? 'pass' : 'fail', `机・庭・広場の見本の警告：` + smp.map(([v, n]) => `${v} ${n}`).join('・'), '', smp.map((x) => x[2]));
S.rec('14.7', 'user', '規則の名前と説明が分かるか（「止める」「赤」「黄」の使い分け）。画面 1-lagoon-warnings・2-stop', '', ['shots/test-run/14/1-lagoon-warnings.jpg', 'shots/test-run/14/2-stop.jpg']);
S.rec('14.8', 'user', '仮の数字（ポンプの目安・飛沫の余裕 20% など）に直したいものがあるか', '', ['shots/test-run/14/1-lagoon-warnings.jpg']);
S.rec('14.コンソール', errors.length ? 'fail' : 'pass', errors.length ? errors.slice(0, 3).join(' | ') : 'コンソールのエラー 0');
S.save();
await browser.close();
